//! O que a casca abre fora dela (ADR-0038): endereço `https://` no navegador padrão e arquivo ou
//! pasta dentro das raízes autorizadas, no programa padrão ou no Explorer.
//!
//! Chegam aqui o serviço, pelo canal do sidecar (`{"tipo":"abrir","id","op",…}`), e a interface,
//! pelos comandos `abrir_endereco`, `abrir_arquivo` e `abrir_settings_claude`. Nenhuma ferramenta
//! do catálogo chama `abrir`: só cliques do usuário e o fluxo de autorização. A validação mora
//! aqui, não na interface nem no serviço: quem pede não decide o que pode ser aberto.
//!
//! Raízes: a pasta de dados do Moductus, o `settings.json` do Claude Code e as cópias de segurança
//! dele (só esses arquivos, nunca o resto da pasta, que guarda o login), e as pastas de projeto que
//! o serviço informa, desde que não sejam pastas do sistema. Executável nunca abre, nem dentro
//! delas. O registro leva o endereço sem a query, que pode carregar código de autorização.

use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf, Prefix},
    sync::{Mutex, OnceLock},
    thread,
};

use serde::{Deserialize, Serialize};
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
};

use crate::servico::sem_prefixo_verbatim;

/// Endereço maior que isso não é de página que o Moductus manda abrir.
const LIMITE_ENDERECO: usize = 2048;

/// Pontuação que um endereço pode ter (RFC 3986), além de letras e dígitos. Fora dela ficam
/// espaço, aspas, `<>`, `\`, `^`, `` ` ``, `{|}` e controle: com eles, o endereço poderia sair das
/// aspas da linha de comando do navegador e virar opção dele.
const PONTUACAO_DE_ENDERECO: &str = "-._~:/?#[]@!$&'()*+,;=%";

/// Extensões que executam algo ao abrir, ou levam a outro programa (atalho, instalador, script).
/// Somam-se as do `PATHEXT` da máquina.
const EXECUTAVEIS: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "psd1", "ps1xml", "psc1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "ws", "msc", "msi", "msp", "mst", "scr", "lnk", "url", "pif", "hta", "cpl", "reg", "jar", "appref-ms",
    "application", "inf", "scf", "sct", "shs", "gadget", "msix", "msixbundle", "appx", "appxbundle",
    "appinstaller", "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms", "diagcab", "xll",
    "py", "pyw", "dll", "ocx", "sys", "drv", "chm", "hlp", "website", "job",
];

/// Pastas que nunca viram raiz de projeto: abrir algo ali é mexer no sistema (PRODUCT §11).
const PASTAS_DO_SISTEMA: &[&str] =
    &["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "APPDATA", "LOCALAPPDATA"];

static DADOS: OnceLock<PathBuf> = OnceLock::new();
static PROJETOS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// O que a casca abre, já validado.
#[derive(Debug, PartialEq)]
pub enum Alvo {
    Endereco(String),
    Caminho(PathBuf),
}

/// Onde um arquivo pode estar para abrir.
#[derive(Debug, Default)]
pub struct Raizes {
    /// Pastas inteiras: a de dados do Moductus e as de projeto.
    pub pastas: Vec<PathBuf>,
    /// Pasta do `settings.json` do Claude Code; dela só abrem ele e as cópias de segurança.
    pub claude: Option<PathBuf>,
}

pub fn iniciar(pasta: PathBuf) {
    let _ = DADOS.set(pasta);
}

/* ---------- Endereço ---------- */

/// Só `https://` com servidor, sem usuário no endereço (`https://github.com@outro.site` engana
/// quem lê) e sem caractere fora da RFC. Devolve o endereço com o esquema em minúsculas.
pub fn validar_endereco(endereco: &str) -> Result<String, String> {
    if endereco.len() > LIMITE_ENDERECO {
        return Err("endereço longo demais para abrir".into());
    }
    let (esquema, resto) = endereco.split_once("://").ok_or("só endereço https:// abre no navegador")?;
    if !esquema.eq_ignore_ascii_case("https") {
        return Err("só endereço https:// abre no navegador".into());
    }
    if !endereco.chars().all(|c| c.is_ascii_alphanumeric() || PONTUACAO_DE_ENDERECO.contains(c)) {
        return Err("o endereço tem caractere que não abre".into());
    }
    let servidor = resto.split(['/', '?', '#']).next().unwrap_or_default();
    if servidor.is_empty() || servidor.starts_with(':') {
        return Err("o endereço não diz o site".into());
    }
    if servidor.contains('@') {
        return Err("endereço com usuário não abre".into());
    }
    Ok(format!("https://{resto}"))
}

/// O endereço sem query nem fragmento, para o registro.
pub fn sem_query(endereco: &str) -> &str {
    endereco.split(['?', '#']).next().unwrap_or_default()
}

/* ---------- Arquivo ou pasta ---------- */

/// Caminho completo numa unidade (`C:\…`), sem `..`, sem rede (`\\servidor`), sem `\\?\` e sem
/// fluxo alternativo (`a.txt:outro`).
fn caminho_local(caminho: &Path) -> Result<(), String> {
    let mut partes = caminho.components();
    let unidade = matches!(partes.next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_)));
    if !unidade || partes.next() != Some(Component::RootDir) {
        return Err("só caminho completo numa unidade do PC abre".into());
    }
    for parte in partes {
        match parte {
            Component::Normal(nome) if !nome.to_string_lossy().contains(':') => {}
            _ => return Err("caminho com .. ou : não abre".into()),
        }
    }
    Ok(())
}

fn extensoes_executaveis() -> Vec<String> {
    let mut lista: Vec<String> = EXECUTAVEIS.iter().map(|e| e.to_string()).collect();
    if let Ok(pathext) = std::env::var("PATHEXT") {
        let extras = pathext.split(';').map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase());
        lista.extend(extras.filter(|e| !e.is_empty()));
    }
    lista
}

pub fn executavel(caminho: &Path) -> bool {
    let Some(extensao) = caminho.extension().and_then(OsStr::to_str) else { return false };
    extensoes_executaveis().contains(&extensao.to_ascii_lowercase())
}

/// `settings.json` ou uma cópia de segurança dele (`settings.json.moductus-2026-10-09T12-00-00-000Z.bak`,
/// e `-2.bak`, `-3.bak` na colisão), como o serviço grava (`servico/src/sessoes/ligacao.ts`).
pub fn arquivo_do_claude(nome: &str) -> bool {
    let nome = nome.to_ascii_lowercase();
    if nome == "settings.json" {
        return true;
    }
    let Some(resto) = nome.strip_prefix("settings.json.moductus-").and_then(|r| r.strip_suffix(".bak")) else {
        return false;
    };
    const MOLDE: &str = "0000-00-00t00-00-00-000z";
    if resto.len() < MOLDE.len() || !resto.is_char_boundary(MOLDE.len()) {
        return false;
    }
    let (carimbo, colisao) = resto.split_at(MOLDE.len());
    let carimbo_ok = carimbo.chars().zip(MOLDE.chars()).all(|(c, m)| if m == '0' { c.is_ascii_digit() } else { c == m });
    let colisao_ok = colisao.is_empty()
        || colisao.strip_prefix('-').is_some_and(|n| (1..=4).contains(&n.len()) && n.chars().all(|c| c.is_ascii_digit()));
    carimbo_ok && colisao_ok
}

/// O caminho pedido é o `settings.json` (ou cópia) na pasta do Claude Code. Compara a pasta já
/// resolvida (ela pode ser junção) e o nome, não o arquivo resolvido: o `settings.json` pode ser
/// link para um repositório de configuração, e continua sendo o arquivo que o usuário conhece.
fn e_do_claude(pedido: &Path, pasta: &Path) -> bool {
    let nome_ok = pedido.file_name().and_then(OsStr::to_str).is_some_and(arquivo_do_claude);
    let pai = pedido.parent().and_then(|p| std::fs::canonicalize(p).ok());
    nome_ok && pai.is_some() && pai == std::fs::canonicalize(pasta).ok()
}

/// O caminho que pode abrir, já resolvido (sem `\\?\`), ou o motivo da recusa.
pub fn validar_caminho(caminho: &str, raizes: &Raizes) -> Result<PathBuf, String> {
    let pedido = Path::new(caminho);
    caminho_local(pedido)?;
    let real = std::fs::canonicalize(pedido).map_err(|_| "o arquivo não existe".to_string())?;
    let arquivo = real.is_file();
    // O nome pedido e o resolvido: `a.exe.` e nome curto (`PROGRA~1`) chegam como `.exe` no fim.
    if arquivo && (executavel(pedido) || executavel(&real)) {
        return Err("programa não abre pelo Moductus".into());
    }
    let numa_pasta =
        raizes.pastas.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|raiz| real.starts_with(&raiz));
    let do_claude = arquivo && raizes.claude.as_deref().is_some_and(|pasta| e_do_claude(pedido, pasta));
    if !numa_pasta && !do_claude {
        return Err("fora das pastas que o Moductus pode abrir".into());
    }
    Ok(sem_prefixo_verbatim(real))
}

/* ---------- Pastas de projeto ---------- */

pub fn pastas_do_sistema() -> Vec<PathBuf> {
    let mut pastas: Vec<PathBuf> = PASTAS_DO_SISTEMA.iter().filter_map(std::env::var_os).map(PathBuf::from).collect();
    pastas.extend(std::env::var_os("USERPROFILE").map(PathBuf::from));
    pastas
}

/// Pasta de projeto que pode virar raiz: existe, não é a raiz de uma unidade, não é a pasta do
/// usuário inteira e não fica dentro de uma pasta do sistema.
pub fn raiz_de_projeto(caminho: &str, proibidas: &[PathBuf]) -> Option<PathBuf> {
    let pedido = Path::new(caminho);
    caminho_local(pedido).ok()?;
    let real = std::fs::canonicalize(pedido).ok().filter(|r| r.is_dir())?;
    // Prefixo, raiz e ao menos uma pasta: `C:\` sozinho não vale.
    if real.components().count() < 3 {
        return None;
    }
    let usuario = std::env::var_os("USERPROFILE").and_then(|p| std::fs::canonicalize(p).ok());
    let do_sistema = proibidas
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        // A pasta do usuário só é proibida inteira; o que fica dentro dela pode ser projeto.
        .any(|p| if Some(&p) == usuario.as_ref() { real == p } else { real.starts_with(&p) });
    (!do_sistema).then(|| sem_prefixo_verbatim(real))
}

/// Troca as pastas de projeto pelas que o serviço mandou; as recusadas ficam de fora e vão ao log.
pub fn definir_projetos(pastas: &[String]) -> usize {
    let proibidas = pastas_do_sistema();
    let aceitas: Vec<PathBuf> = pastas.iter().filter_map(|p| raiz_de_projeto(p, &proibidas)).collect();
    if aceitas.len() < pastas.len() {
        crate::registro::info(&format!("abrir: {} pasta(s) de projeto recusada(s)", pastas.len() - aceitas.len()));
    }
    let quantas = aceitas.len();
    *PROJETOS.lock().unwrap() = aceitas;
    quantas
}

/// A pasta do `settings.json` do Claude Code: `CLAUDE_CONFIG_DIR` quando definido, senão
/// `%USERPROFILE%\.claude`, a mesma regra do serviço (`caminhoSettingsClaude`).
pub fn pasta_do_claude() -> Option<PathBuf> {
    match std::env::var("CLAUDE_CONFIG_DIR").map(|p| p.trim().to_string()) {
        Ok(p) if !p.is_empty() => Some(PathBuf::from(p)),
        _ => std::env::var_os("USERPROFILE").map(|casa| PathBuf::from(casa).join(".claude")),
    }
}

fn raizes() -> Raizes {
    let mut pastas: Vec<PathBuf> = DADOS.get().cloned().into_iter().collect();
    pastas.extend(PROJETOS.lock().unwrap().iter().cloned());
    Raizes { pastas, claude: pasta_do_claude() }
}

/* ---------- Abrir no Windows ---------- */

/// `ShellExecuteExW` com o verbo padrão, numa thread própria com COM de apartamento (como o Shell
/// pede). Sem caixa de erro do Windows: a falha volta para quem pediu dizer na tela.
fn shell(alvo: &str) -> Result<(), String> {
    let arquivo = HSTRING::from(alvo);
    thread::spawn(move || unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpFile: PCWSTR(arquivo.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        let resultado = ShellExecuteExW(&mut info).map_err(|e| format!("o Windows não abriu: {}", e.message()));
        if com.is_ok() {
            CoUninitialize();
        }
        resultado
    })
    .join()
    .unwrap_or_else(|_| Err("o Windows não abriu".into()))
}

fn abrir(alvo: Alvo) -> Result<(), String> {
    let (texto, descricao) = match &alvo {
        Alvo::Endereco(endereco) => (endereco.clone(), format!("endereço {}", sem_query(endereco))),
        Alvo::Caminho(caminho) => (caminho.to_string_lossy().into_owned(), format!("arquivo {}", caminho.display())),
    };
    let resultado = shell(&texto);
    match &resultado {
        Ok(()) => crate::registro::info(&format!("abriu {descricao}")),
        Err(e) => crate::registro::info(&format!("não abriu {descricao}: {e}")),
    }
    resultado
}

fn recusado(o_que: &str, motivo: String) -> String {
    crate::registro::info(&format!("abrir recusou {o_que}: {motivo}"));
    motivo
}

pub fn abrir_endereco_validado(endereco: &str) -> Result<(), String> {
    let validado =
        validar_endereco(endereco).map_err(|m| recusado(&format!("o endereço {}", sem_query(endereco)), m))?;
    abrir(Alvo::Endereco(validado))
}

pub fn abrir_caminho_validado(caminho: &str) -> Result<(), String> {
    let validado = validar_caminho(caminho, &raizes()).map_err(|m| recusado(&format!("o caminho {caminho}"), m))?;
    abrir(Alvo::Caminho(validado))
}

/* ---------- Canal do serviço e comandos da interface ---------- */

/// Pedido do serviço à casca, pelo canal do sidecar.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Pedido {
    Endereco { endereco: String },
    Arquivo { caminho: String },
    /// As pastas de projeto vivas; substituem as de antes.
    Projetos { pastas: Vec<String> },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Resposta {
    Ok { ok: bool },
    Erro { erro: String },
}

pub fn atender(pedido: Pedido) -> Resposta {
    let resultado = match pedido {
        Pedido::Endereco { endereco } => abrir_endereco_validado(&endereco),
        Pedido::Arquivo { caminho } => abrir_caminho_validado(&caminho),
        Pedido::Projetos { pastas } => {
            definir_projetos(&pastas);
            Ok(())
        }
    };
    resultado.map(|_| Resposta::Ok { ok: true }).unwrap_or_else(|erro| Resposta::Erro { erro })
}

// Assíncronos para o `ShellExecuteExW` não segurar a thread das janelas.

#[tauri::command]
pub async fn abrir_endereco(endereco: String) -> Result<(), String> {
    abrir_endereco_validado(&endereco)
}

#[tauri::command]
pub async fn abrir_arquivo(caminho: String) -> Result<(), String> {
    abrir_caminho_validado(&caminho)
}

/// O `settings.json` do Claude Code, que a interface não sabe onde fica quando a ligação falhou.
#[tauri::command]
pub async fn abrir_settings_claude() -> Result<(), String> {
    let caminho = pasta_do_claude().ok_or("a pasta do usuário não está definida")?.join("settings.json");
    abrir_caminho_validado(&caminho.to_string_lossy())
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::fs;

    /// Pasta descartável com o nome do teste; nada fora dela é criado.
    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("moductus-abrir-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        sem_prefixo_verbatim(fs::canonicalize(&p).unwrap())
    }

    fn texto(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn endereco_https_abre() {
        assert_eq!(
            validar_endereco("https://github.com/moductus/moductus/pull/12").as_deref(),
            Ok("https://github.com/moductus/moductus/pull/12")
        );
        assert_eq!(
            validar_endereco("HTTPS://accounts.google.com/o/oauth2/v2/auth?client_id=a&state=b%20c#x").as_deref(),
            Ok("https://accounts.google.com/o/oauth2/v2/auth?client_id=a&state=b%20c#x")
        );
        assert_eq!(validar_endereco("https://localhost:8443/").as_deref(), Ok("https://localhost:8443/"));
    }

    #[test]
    fn recusa_endereco_que_nao_e_https() {
        for endereco in [
            "http://github.com",
            "file:///C:/Windows/System32/calc.exe",
            "file://servidor/pasta",
            "javascript:alert(1)",
            "JavaScript://%0aalert(1)",
            "ms-settings:privacy",
            "mailto:a@b.c",
            "C:\\Windows\\notepad.exe",
            "github.com",
            "",
            " https://github.com",
        ] {
            assert!(validar_endereco(endereco).is_err(), "deveria recusar {endereco:?}");
        }
    }

    #[test]
    fn recusa_endereco_que_engana_ou_escapa() {
        for endereco in [
            "https://",
            "https:///caminho",
            "https://:443/",
            "https://github.com@outro.site/",
            "https://usuario:senha@github.com/",
            "https://github.com/\" --utility-cmd-prefix=calc",
            "https://github.com/a b",
            "https://github.com/a\nb",
            "https://github.com/a\\b",
            "https://github.com/<script>",
            "https://github.com/a^b",
            "https://github.com/{x}",
            "https://github.com/a|b",
            "https://github.com/ação",
        ] {
            assert!(validar_endereco(endereco).is_err(), "deveria recusar {endereco:?}");
        }
        assert!(validar_endereco(&format!("https://a.com/{}", "x".repeat(LIMITE_ENDERECO))).is_err());
    }

    #[test]
    fn registro_leva_o_endereco_sem_a_query() {
        assert_eq!(sem_query("https://a.com/auth?code=segredo#frag"), "https://a.com/auth");
        assert_eq!(sem_query("https://a.com/auth#frag"), "https://a.com/auth");
        assert_eq!(sem_query("https://a.com/"), "https://a.com/");
    }

    #[test]
    fn arquivo_e_pasta_dentro_da_raiz_abrem() {
        let raiz = pasta("dentro");
        fs::create_dir_all(raiz.join("exportacoes")).unwrap();
        fs::write(raiz.join("exportacoes").join("casa.moductus"), "x").unwrap();
        fs::write(raiz.join("moductus.log"), "x").unwrap();
        let raizes = Raizes { pastas: vec![raiz.clone()], claude: None };
        assert_eq!(validar_caminho(&texto(&raiz.join("moductus.log")), &raizes), Ok(raiz.join("moductus.log")));
        assert_eq!(validar_caminho(&texto(&raiz.join("exportacoes")), &raizes), Ok(raiz.join("exportacoes")));
        assert_eq!(validar_caminho(&texto(&raiz), &raizes), Ok(raiz.clone()));
        // Barra normal e caixa diferente são o mesmo arquivo no Windows.
        let outro_jeito = texto(&raiz.join("exportacoes").join("CASA.moductus")).replace('\\', "/");
        assert!(validar_caminho(&outro_jeito, &raizes).is_ok());
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn recusa_caminho_fora_das_raizes() {
        let raiz = pasta("raiz");
        let fora = pasta("fora");
        fs::write(fora.join("nota.txt"), "x").unwrap();
        fs::create_dir_all(raiz.join("sub")).unwrap();
        let raizes = Raizes { pastas: vec![raiz.clone()], claude: None };
        assert!(validar_caminho(&texto(&fora.join("nota.txt")), &raizes).is_err());
        assert!(validar_caminho(&texto(&fora), &raizes).is_err());
        // Subir com .. não sai da raiz, nem quando o destino existe.
        let nome_fora = fora.file_name().unwrap().to_string_lossy().into_owned();
        let escapando = format!("{}\\sub\\..\\..\\{nome_fora}\\nota.txt", texto(&raiz));
        assert!(validar_caminho(&escapando, &raizes).is_err());
        // Nome que começa igual à raiz não está dentro dela.
        let vizinha = PathBuf::from(format!("{}-vizinha", texto(&raiz)));
        fs::create_dir_all(&vizinha).unwrap();
        fs::write(vizinha.join("nota.txt"), "x").unwrap();
        assert!(validar_caminho(&texto(&vizinha.join("nota.txt")), &raizes).is_err());
        // Sem raiz nenhuma, nada abre.
        assert!(validar_caminho(&texto(&raiz), &Raizes::default()).is_err());
        for p in [raiz, fora, vizinha] {
            let _ = fs::remove_dir_all(p);
        }
    }

    #[test]
    fn recusa_caminho_relativo_de_rede_ou_que_nao_existe() {
        let raiz = pasta("forma");
        fs::write(raiz.join("nota.txt"), "x").unwrap();
        let raizes = Raizes { pastas: vec![raiz.clone()], claude: None };
        for caminho in [
            "nota.txt".to_string(),
            ".\\nota.txt".to_string(),
            "\\nota.txt".to_string(),
            "C:nota.txt".to_string(),
            "\\\\servidor\\pasta\\nota.txt".to_string(),
            format!("\\\\?\\{}", texto(&raiz.join("nota.txt"))),
            format!("{}:fluxo", texto(&raiz.join("nota.txt"))),
            texto(&raiz.join("nao-existe.txt")),
            String::new(),
        ] {
            assert!(validar_caminho(&caminho, &raizes).is_err(), "deveria recusar {caminho:?}");
        }
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn recusa_executavel_mesmo_dentro_da_raiz() {
        let raiz = pasta("executavel");
        let raizes = Raizes { pastas: vec![raiz.clone()], claude: None };
        for nome in ["a.exe", "b.CMD", "c.bat", "d.ps1", "e.lnk", "f.vbs", "g.msi", "h.url", "i.hta", "j.scr", "k.reg"] {
            fs::write(raiz.join(nome), "x").unwrap();
            assert!(validar_caminho(&texto(&raiz.join(nome)), &raizes).is_err(), "deveria recusar {nome}");
        }
        // O Windows tira o ponto do fim: "a.exe." é o a.exe.
        assert!(validar_caminho(&format!("{}.", texto(&raiz.join("a.exe"))), &raizes).is_err());
        // Pasta com nome de programa abre no Explorer, não executa nada.
        fs::create_dir_all(raiz.join("ferramenta.exe")).unwrap();
        assert!(validar_caminho(&texto(&raiz.join("ferramenta.exe")), &raizes).is_ok());
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn da_pasta_do_claude_so_o_settings_e_as_copias() {
        let claude = pasta("claude");
        for nome in [
            "settings.json",
            "settings.json.moductus-2026-10-09T12-00-00-000Z.bak",
            "settings.json.moductus-2026-10-09T12-00-00-000Z-2.bak",
            ".credentials.json",
            "settings.json.bak",
            "settings.local.json",
        ] {
            fs::write(claude.join(nome), "{}").unwrap();
        }
        let raizes = Raizes { pastas: vec![], claude: Some(claude.clone()) };
        let pode = |nome: &str| validar_caminho(&texto(&claude.join(nome)), &raizes).is_ok();
        assert!(pode("settings.json"));
        assert!(pode("SETTINGS.JSON"));
        assert!(pode("settings.json.moductus-2026-10-09T12-00-00-000Z.bak"));
        assert!(pode("settings.json.moductus-2026-10-09T12-00-00-000Z-2.bak"));
        assert!(!pode(".credentials.json"), "o login do Claude Code nunca abre");
        assert!(!pode("settings.json.bak"));
        assert!(!pode("settings.local.json"));
        // A pasta em si também não: ela guarda o login.
        assert!(validar_caminho(&texto(&claude), &raizes).is_err());
        // Um settings.json em outra pasta não é o do Claude Code.
        let outra = pasta("claude-outra");
        fs::write(outra.join("settings.json"), "{}").unwrap();
        assert!(validar_caminho(&texto(&outra.join("settings.json")), &raizes).is_err());
        for p in [claude, outra] {
            let _ = fs::remove_dir_all(p);
        }
    }

    #[test]
    fn nome_da_copia_de_seguranca() {
        assert!(arquivo_do_claude("settings.json.moductus-2026-10-09T12-00-00-000Z.bak"));
        assert!(arquivo_do_claude("settings.json.moductus-2026-10-09T12-00-00-000Z-13.bak"));
        assert!(!arquivo_do_claude("settings.json.moductus-2026-10-09T12-00-00-000Z-.bak"));
        assert!(!arquivo_do_claude("settings.json.moductus-2026-10-09T12-00-00Z.bak"));
        assert!(!arquivo_do_claude("settings.json.moductus-2026-10-09T12-00-00-000Z.bak.exe"));
        assert!(!arquivo_do_claude("settings.json.moductus-ção-10-09T12-00-00-000Z.bak"));
        assert!(!arquivo_do_claude("outro.json"));
    }

    #[test]
    fn pasta_de_projeto_nao_pode_ser_do_sistema() {
        let sistema = pasta("sistema");
        let projeto = pasta("projeto");
        fs::create_dir_all(sistema.join("dentro")).unwrap();
        let proibidas = vec![sistema.clone()];
        assert_eq!(raiz_de_projeto(&texto(&projeto), &proibidas), Some(projeto.clone()));
        assert_eq!(raiz_de_projeto(&texto(&sistema), &proibidas), None);
        assert_eq!(raiz_de_projeto(&texto(&sistema.join("dentro")), &proibidas), None);
        assert_eq!(raiz_de_projeto("C:\\", &[]), None, "a unidade inteira não é projeto");
        assert_eq!(raiz_de_projeto("projeto", &[]), None);
        assert_eq!(raiz_de_projeto(&texto(&projeto.join("nao-existe")), &[]), None);
        fs::write(projeto.join("arquivo.txt"), "x").unwrap();
        assert_eq!(raiz_de_projeto(&texto(&projeto.join("arquivo.txt")), &[]), None, "projeto é pasta");
        for p in [sistema, projeto] {
            let _ = fs::remove_dir_all(p);
        }
    }

    #[test]
    fn as_pastas_do_windows_estao_entre_as_proibidas() {
        let proibidas = pastas_do_sistema();
        let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap();
        assert!(raiz_de_projeto(&texto(&windows), &proibidas).is_none());
        assert!(raiz_de_projeto(&texto(&windows.join("System32")), &proibidas).is_none());
        // A pasta do usuário inteira não vira projeto.
        let usuario = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap();
        assert!(raiz_de_projeto(&texto(&usuario), &proibidas).is_none());
    }

    #[test]
    fn pedidos_do_canal() {
        let p: Pedido =
            serde_json::from_str(r#"{"tipo":"abrir","id":4,"op":"endereco","endereco":"https://a.com"}"#).unwrap();
        assert!(matches!(p, Pedido::Endereco { endereco } if endereco == "https://a.com"));
        let p: Pedido = serde_json::from_str(r#"{"tipo":"abrir","id":5,"op":"arquivo","caminho":"C:\\x"}"#).unwrap();
        assert!(matches!(p, Pedido::Arquivo { caminho } if caminho == "C:\\x"));
        let p: Pedido =
            serde_json::from_str(r#"{"tipo":"abrir","id":6,"op":"projetos","pastas":["C:\\a","D:\\b"]}"#).unwrap();
        assert!(matches!(p, Pedido::Projetos { pastas } if pastas.len() == 2));
        assert!(serde_json::from_str::<Pedido>(r#"{"tipo":"abrir","id":7,"op":"terminal","comando":"x"}"#).is_err());
    }

    /// O canal recusa antes de chegar ao Windows: nada abre neste teste.
    #[test]
    fn o_canal_recusa_com_o_motivo() {
        let r = atender(Pedido::Endereco { endereco: "http://github.com".into() });
        assert!(matches!(r, Resposta::Erro { erro } if erro.contains("https://")));
        let r = atender(Pedido::Arquivo { caminho: "C:\\Windows\\System32\\notepad.exe".into() });
        assert!(matches!(r, Resposta::Erro { .. }));
        let r = atender(Pedido::Arquivo { caminho: "C:\\Windows\\win.ini".into() });
        assert!(matches!(r, Resposta::Erro { erro } if erro.contains("fora das pastas")));
        assert_eq!(
            serde_json::to_value(Resposta::Erro { erro: "x".into() }).unwrap(),
            serde_json::json!({ "erro": "x" })
        );
    }
}
