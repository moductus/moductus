//! O serviço em Node como sidecar: a casca sobe, entrega pasta de dados e token,
//! recebe a porta, reinicia com espera crescente quando ele cai e o encerra junto.
//!
//! O processo do serviço entra num Job do Windows com "matar ao fechar": se a casca
//! morrer de repente, o Windows derruba o serviço também.
//!
//! Canal com o serviço pelo stdio, em linhas JSON: o serviço avisa `pronto` com a porta
//! e pede credenciais (`{"tipo":"credencial","id",…}`), variáveis do usuário
//! (`{"tipo":"ambiente","id",…}`) e avisos do Windows (`{"tipo":"notificacao","id",…}`),
//! respondidos no stdin. Pelo stdin também vão avisos da casca sem id, como a retomada da
//! suspensão (`{"tipo":"retomou"}`) e o clique num aviso do Windows (`notificacao-clique`).

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE},
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, TerminateProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

use crate::{ambiente, credenciais, notificacao};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "estado", rename_all = "lowercase")]
pub enum Estado {
    Iniciando,
    Pronto { porta: u16, token: String },
    Reiniciando { tentativa: u32, espera_ms: u64 },
    Parado,
}

static ESTADO: Mutex<Estado> = Mutex::new(Estado::Iniciando);
/// Pid do serviço vivo, para encerrar sem segurar o `Child`, que a thread espera.
static PID: Mutex<Option<u32>> = Mutex::new(None);
static ENTRADA: Mutex<Option<ChildStdin>> = Mutex::new(None);
static SAINDO: AtomicBool = AtomicBool::new(false);
static JOB: OnceLock<isize> = OnceLock::new();

/// Espera antes da tentativa `n` (1, 2, 3…): 0,5 s dobrando até 30 s.
pub fn espera(tentativa: u32) -> Duration {
    let ms = 500u64.saturating_mul(1 << tentativa.saturating_sub(1).min(16));
    Duration::from_millis(ms.min(30_000))
}

fn token() -> String {
    let mut bytes = [0u8; 32];
    unsafe {
        let _ = BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn definir(app: &AppHandle, estado: Estado) {
    *ESTADO.lock().unwrap() = estado.clone();
    let _ = app.emit("servico", estado);
}

/// Tira o prefixo `\\?\` dos caminhos que o Tauri devolve: com ele, o Node não resolve o
/// script (falha com EISDIR em `lstat 'V:'`). Caminho UNC fica como está.
pub fn sem_prefixo_verbatim(caminho: PathBuf) -> PathBuf {
    match caminho.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(resto) if !resto.starts_with("UNC") => PathBuf::from(resto),
        _ => caminho,
    }
}

/// Onde estão o node e o script: no pacote, ao lado do executável; no desenvolvimento,
/// o node do PATH e o bundle em servico/dist.
fn comando(app: &AppHandle) -> Command {
    let pasta_exe = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    let node_empacotado = pasta_exe.as_ref().map(|p| p.join("node.exe")).filter(|p| p.exists());
    let script_empacotado = app.path().resource_dir().ok().map(|p| p.join("servico").join("servico.mjs")).filter(|p| p.exists());
    let (node, script) = match (node_empacotado, script_empacotado) {
        (Some(n), Some(s)) => (n, s),
        _ => {
            let raiz = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let raiz = raiz.parent().map(PathBuf::from).unwrap_or(raiz);
            (PathBuf::from("node"), raiz.join("servico").join("dist").join("servico.mjs"))
        }
    };
    let (node, script) = (sem_prefixo_verbatim(node), sem_prefixo_verbatim(script));
    let pasta_script = script.parent().map(PathBuf::from).unwrap_or_default();
    let mut c = Command::new(node);
    c.current_dir(pasta_script);
    c.arg("--disable-warning=ExperimentalWarning").arg(script);
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

fn job() -> HANDLE {
    let valor = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(None, None).unwrap_or_default();
        let mut limite = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limite.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let _ = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limite as *const _ as _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        job.0 as isize
    });
    HANDLE(valor as _)
}

fn subir(app: &AppHandle, pasta: &std::path::Path, token: &str) -> std::io::Result<Child> {
    let mut filho = comando(app)
        .env("MODUCTUS_PASTA", pasta)
        .env("MODUCTUS_TOKEN", token)
        .env("MODUCTUS_PORTABLE", if crate::dados::portable() { "1" } else { "0" })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    unsafe {
        if let Ok(processo) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, filho.id()) {
            let _ = AssignProcessToJobObject(job(), processo);
            let _ = CloseHandle(processo);
        }
    }
    *ENTRADA.lock().unwrap() = filho.stdin.take();
    if let Some(erro) = filho.stderr.take() {
        thread::spawn(move || {
            for linha in BufReader::new(erro).lines().map_while(Result::ok) {
                crate::registro::info(&format!("servico: {linha}"));
            }
        });
    }
    Ok(filho)
}

#[derive(Deserialize)]
struct Mensagem {
    tipo: String,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    porta: Option<u16>,
}

fn responder(id: u64, resposta: serde_json::Value) {
    let mut linha = resposta;
    linha["id"] = id.into();
    escrever(&linha);
}

/// Aviso da casca sem pedido do serviço (`{"tipo":"retomou"}`), sem id. Sem serviço de pé, some:
/// o que sobe depois começa do zero.
pub fn avisar(aviso: serde_json::Value) {
    escrever(&aviso);
}

fn escrever(linha: &serde_json::Value) {
    if let Some(entrada) = ENTRADA.lock().unwrap().as_mut() {
        let _ = writeln!(entrada, "{linha}");
        let _ = entrada.flush();
    }
}

/// Lê o stdout do serviço até ele sair.
fn ouvir(app: &AppHandle, saida: std::process::ChildStdout, token: &str) {
    for linha in BufReader::new(saida).lines().map_while(Result::ok) {
        let Ok(mensagem) = serde_json::from_str::<Mensagem>(&linha) else { continue };
        match (mensagem.tipo.as_str(), mensagem.id) {
            ("pronto", _) => {
                let porta = mensagem.porta.unwrap_or(0);
                crate::registro::info(&format!("servico pronto na porta {porta}"));
                definir(app, Estado::Pronto { porta, token: token.to_string() });
            }
            ("aplicar", Some(id)) => {
                let resposta = serde_json::from_str::<crate::config_nativa::PedidoAplicar>(&linha)
                    .map(|p| crate::config_nativa::aplicar(app, p))
                    .unwrap_or_else(|e| serde_json::json!({ "erro": format!("pedido inválido: {e}") }));
                responder(id, resposta);
            }
            ("credencial", Some(id)) => {
                let resposta = serde_json::from_str::<credenciais::Pedido>(&linha)
                    .map(credenciais::atender)
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
                    .unwrap_or_else(|e| serde_json::json!({ "erro": format!("pedido inválido: {e}") }));
                responder(id, resposta);
            }
            ("notificacao", Some(id)) => {
                let resposta = serde_json::from_str::<notificacao::Pedido>(&linha)
                    .map(notificacao::atender)
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
                    .unwrap_or_else(|e| serde_json::json!({ "erro": format!("pedido inválido: {e}") }));
                responder(id, resposta);
            }
            ("ambiente", Some(id)) => {
                let resposta = serde_json::from_str::<ambiente::Pedido>(&linha)
                    .map(ambiente::atender)
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
                    .unwrap_or_else(|e| serde_json::json!({ "erro": format!("pedido inválido: {e}") }));
                responder(id, resposta);
            }
            _ => {}
        }
    }
}

pub fn iniciar(app: AppHandle, pasta: PathBuf) {
    thread::spawn(move || {
        let mut tentativa = 0u32;
        while !SAINDO.load(Ordering::SeqCst) {
            let token = token();
            definir(&app, Estado::Iniciando);
            let inicio = Instant::now();
            match subir(&app, &pasta, &token) {
                Ok(mut filho) => {
                    *PID.lock().unwrap() = Some(filho.id());
                    if let Some(saida) = filho.stdout.take() {
                        ouvir(&app, saida, &token);
                    }
                    let codigo = filho.wait().ok();
                    *PID.lock().unwrap() = None;
                    crate::registro::info(&format!("servico saiu: {codigo:?}"));
                }
                Err(e) => crate::registro::info(&format!("servico não subiu: {e}")),
            }
            *ENTRADA.lock().unwrap() = None;
            if SAINDO.load(Ordering::SeqCst) {
                break;
            }
            // Ficou de pé um bom tempo: a queda é nova, recomeça a espera do início.
            tentativa = if inicio.elapsed() > Duration::from_secs(60) { 1 } else { tentativa + 1 };
            let espera = espera(tentativa);
            crate::registro::info(&format!("servico reiniciando: tentativa {tentativa}, espera {} ms", espera.as_millis()));
            definir(&app, Estado::Reiniciando { tentativa, espera_ms: espera.as_millis() as u64 });
            thread::sleep(espera);
        }
        definir(&app, Estado::Parado);
    });
}

/// Ao sair: fecha o stdin (o serviço sai sozinho) e garante com kill.
pub fn encerrar() {
    SAINDO.store(true, Ordering::SeqCst);
    *ENTRADA.lock().unwrap() = None;
    if let Some(pid) = *PID.lock().unwrap() {
        unsafe {
            if let Ok(processo) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(processo, 0);
                let _ = CloseHandle(processo);
            }
        }
    }
}

#[tauri::command]
pub fn servico_estado() -> Estado {
    ESTADO.lock().unwrap().clone()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn espera_cresce_e_para_em_30_s() {
        assert_eq!(espera(1), Duration::from_millis(500));
        assert_eq!(espera(2), Duration::from_secs(1));
        assert_eq!(espera(3), Duration::from_secs(2));
        assert_eq!(espera(7), Duration::from_secs(30));
        assert_eq!(espera(40), Duration::from_secs(30));
    }

    #[test]
    fn tira_o_prefixo_verbatim_menos_de_unc() {
        assert_eq!(sem_prefixo_verbatim(PathBuf::from(r"\\?\V:\m\s.mjs")), PathBuf::from(r"V:\m\s.mjs"));
        assert_eq!(sem_prefixo_verbatim(PathBuf::from(r"V:\m\s.mjs")), PathBuf::from(r"V:\m\s.mjs"));
        assert_eq!(sem_prefixo_verbatim(PathBuf::from(r"\\?\UNC\srv\x")), PathBuf::from(r"\\?\UNC\srv\x"));
    }

    #[test]
    fn token_tem_64_hex_e_muda() {
        let a = token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, token());
    }
}
