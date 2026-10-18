//! O que a casca abre fora dela (ADR-0038): endereço `https://` no navegador padrão, arquivo ou
//! pasta dentro das raízes autorizadas, no programa padrão ou no Explorer, e o terminal com o login
//! de um CLI da lista fixa ([`LOGINS_CLI`]), escolhido por chave e só pela interface
//! (`abrir_terminal`).
//!
//! Chegam aqui o serviço, pelo canal do sidecar (`{"tipo":"abrir","id","op",…}`), e a interface,
//! pelos comandos `abrir_endereco`, `abrir_arquivo`, `abrir_settings_claude` e `abrir_terminal`.
//! Nenhuma ferramenta do catálogo chama `abrir`: só cliques do usuário e o fluxo de autorização.
//! A validação mora aqui, não na interface nem no serviço: quem pede não decide o que pode ser
//! aberto.
//!
//! Raízes: a pasta de dados do Moductus, o `settings.json` do Claude Code e as cópias de segurança
//! dele (só esses arquivos, nunca o resto da pasta, que guarda o login; vale para a pasta do
//! `CLAUDE_CONFIG_DIR` e para `%USERPROFILE%\.claude`), e as pastas de projeto que o serviço
//! informa, desde que não fiquem dentro nem acima de uma pasta do sistema, de uma pasta do Claude
//! Code ou da pasta do usuário inteira.
//!
//! Arquivo só abre se a extensão estiver na lista do que o Moductus abre ([`PERMITIDAS`]: texto,
//! dados, registro, exportação, imagem, PDF) e o Windows não a marcar como perigosa; pasta abre no
//! Explorer. É lista do que pode, não do que não pode: a de executáveis ficou para trás duas vezes
//! (`.pyz`, depois `.sh` pelo Git Bash, `.msstyles`, `.xaml`, `.vsix`…). O registro leva o endereço
//! sem a query, que pode carregar código de autorização, e o recusado só com esquema e servidor.

use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf, Prefix},
    sync::{Mutex, OnceLock},
    thread,
};

use serde::{Deserialize, Serialize};
use windows::{
    core::{HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::CloseHandle,
        System::{
            Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
            Threading::{CreateProcessW, CREATE_NEW_CONSOLE, PROCESS_INFORMATION, STARTUPINFOW},
        },
        UI::{
            Shell::{AssocIsDangerous, ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW},
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

/// O que o Moductus abre (ADR-0038): texto, dados, registro, exportação, imagem e PDF. Qualquer
/// outra extensão, ou nenhuma, não abre; pasta abre no Explorer.
pub const PERMITIDAS: &[&str] =
    &["txt", "md", "json", "jsonl", "log", "csv", "moductus", "png", "jpg", "jpeg", "gif", "webp", "pdf"];

/// Pastas que nunca viram raiz de projeto: abrir algo ali é mexer no sistema (PRODUCT §11). Soma-se
/// `%USERPROFILE%\AppData` inteira, que tem também o `LocalLow`.
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

/// Pastas que pasta de projeto não pode tocar.
#[derive(Debug, Default)]
pub struct Protegidas {
    /// Do sistema (Windows, Program Files, ProgramData, AppData): projeto não fica dentro nem acima
    /// delas, e arquivo resolvido dentro delas não abre por pasta de projeto.
    pub sistema: Vec<PathBuf>,
    /// A do usuário: projeto não é ela inteira nem fica acima dela; dentro dela, pode.
    pub usuario: Option<PathBuf>,
    /// As do Claude Code ([`pastas_do_claude`]), que guardam o login: delas só abrem o
    /// `settings.json` e as cópias de segurança, por qualquer raiz, e projeto não fica dentro nem
    /// acima delas.
    pub claude: Vec<PathBuf>,
}

impl Protegidas {
    pub fn da_maquina() -> Self {
        let usuario = std::env::var_os("USERPROFILE").map(PathBuf::from);
        let mut sistema: Vec<PathBuf> = PASTAS_DO_SISTEMA.iter().filter_map(std::env::var_os).map(PathBuf::from).collect();
        sistema.extend(usuario.as_ref().map(|u| u.join("AppData")));
        Protegidas { sistema, usuario, claude: pastas_do_claude() }
    }
}

/// Onde um arquivo pode estar para abrir.
#[derive(Debug, Default)]
pub struct Raizes {
    /// A pasta de dados do Moductus, que abre inteira (fica no AppData de propósito).
    pub dados: Option<PathBuf>,
    /// As pastas de projeto que passaram por [`raiz_de_projeto`].
    pub projetos: Vec<PathBuf>,
    pub protegidas: Protegidas,
}

/// Algum caminho da lista, resolvido, contém `real` (ou é ele).
fn dentro_de<'a>(real: &Path, pastas: impl IntoIterator<Item = &'a PathBuf>) -> bool {
    pastas.into_iter().filter_map(|p| std::fs::canonicalize(p).ok()).any(|p| real.starts_with(p))
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

/// O endereço recusado, para o registro: só esquema e servidor, sem o usuário e a senha que
/// vêm antes do `@`. Sem `://`, só o esquema; nem isso, nada do que veio. O esquema só vai se for
/// esquema (`usuario:senha@site/?volta=https://…` não é), e o servidor para no primeiro caractere
/// que endereço não tem: depois de um controle, o resto poderia forjar uma linha do registro.
pub fn recusado_para_o_registro(endereco: &str) -> String {
    let curto = |texto: &str| texto.chars().take(80).collect::<String>();
    let so_esquema = |e: &str| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
    if let Some((esquema, resto)) = endereco.split_once("://") {
        if !so_esquema(esquema) {
            return "(sem esquema)".into();
        }
        // Como o navegador lê: a autoridade vai até `/`, `?`, `#` ou `\`, e o usuário até o último `@`.
        let autoridade = resto.split(['/', '?', '#', '\\']).next().unwrap_or_default();
        let servidor = autoridade.rsplit_once('@').map_or(autoridade, |(_, depois)| depois);
        let de_endereco = |c: char| c.is_ascii_alphanumeric() || PONTUACAO_DE_ENDERECO.contains(c);
        let servidor = servidor.split(|c: char| !de_endereco(c)).next().unwrap_or_default();
        return format!("{}://{}", curto(esquema), curto(servidor));
    }
    match endereco.split_once(':') {
        Some((esquema, _)) if so_esquema(esquema) => format!("{}:", curto(esquema)),
        _ => "(sem esquema)".into(),
    }
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

/// O tipo do arquivo abre: a extensão está em [`PERMITIDAS`] e o Windows não a marca como
/// perigosa. As cópias de segurança do `settings.json` (`….bak`, nome fixo de
/// [`arquivo_do_claude`]) valem só quando o pedido é da pasta do Claude Code (`copia_do_claude`).
fn tipo_que_abre(caminho: &Path, copia_do_claude: bool) -> bool {
    let Some(extensao) = caminho.extension().and_then(OsStr::to_str) else { return false };
    let extensao = extensao.to_ascii_lowercase();
    let copia = copia_do_claude && caminho.file_name().and_then(OsStr::to_str).is_some_and(arquivo_do_claude);
    (PERMITIDAS.contains(&extensao.as_str()) || copia) && !perigosa_para_o_windows(&extensao)
}

/// Barreira extra sobre a lista: um programa instalado pode ter registrado uma extensão dela para
/// si de um jeito que o Windows marca como perigoso ao abrir.
fn perigosa_para_o_windows(extensao: &str) -> bool {
    unsafe { AssocIsDangerous(&HSTRING::from(format!(".{extensao}"))).as_bool() }
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

/// O caminho pedido é o `settings.json` (ou cópia) na pasta `pasta` do Claude Code. Compara a pasta já
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
    let protegidas = &raizes.protegidas;
    let do_claude = arquivo && protegidas.claude.iter().any(|pasta| e_do_claude(pedido, pasta));
    // O nome pedido e o resolvido: `a.txt.` chega como `a.txt`, nome curto (`NOTA~1.TXT`) e link
    // chegam com o nome de verdade; os dois precisam ser de tipo que abre.
    if arquivo && !(tipo_que_abre(pedido, do_claude) && tipo_que_abre(&real, do_claude)) {
        return Err("o Moductus não abre esse tipo de arquivo".into());
    }
    // O settings.json e as cópias: o que abre de uma pasta do Claude Code.
    if do_claude {
        return Ok(sem_prefixo_verbatim(real));
    }
    // O resto delas guarda o login: não abre por raiz nenhuma, nem por um projeto que as contenha.
    if dentro_de(&real, &protegidas.claude) {
        return Err("da pasta do Claude Code só o settings.json abre".into());
    }
    let nos_dados = dentro_de(&real, &raizes.dados);
    // A pasta de projeto foi conferida ao entrar; o arquivo resolvido ainda não cai no sistema.
    let no_projeto = dentro_de(&real, &raizes.projetos) && !dentro_de(&real, &protegidas.sistema);
    if !nos_dados && !no_projeto {
        return Err("fora das pastas que o Moductus pode abrir".into());
    }
    Ok(sem_prefixo_verbatim(real))
}

/* ---------- Pastas de projeto ---------- */

/// Pasta de projeto que pode virar raiz: existe, não é a raiz de uma unidade, não fica dentro
/// nem acima de uma pasta do sistema ou de uma pasta do Claude Code, e não é a pasta do usuário
/// inteira nem fica acima dela (`C:\Users`). Abaixo da pasta do usuário, pode.
pub fn raiz_de_projeto(caminho: &str, protegidas: &Protegidas) -> Option<PathBuf> {
    let pedido = Path::new(caminho);
    caminho_local(pedido).ok()?;
    let real = std::fs::canonicalize(pedido).ok().filter(|r| r.is_dir())?;
    // Prefixo, raiz e ao menos uma pasta: `C:\` sozinho não vale.
    if real.components().count() < 3 {
        return None;
    }
    let resolvida = |p: &PathBuf| std::fs::canonicalize(p).ok();
    let encosta = protegidas
        .sistema
        .iter()
        .chain(&protegidas.claude)
        .filter_map(resolvida)
        .any(|p| real.starts_with(&p) || p.starts_with(&real));
    let acima_do_usuario = protegidas.usuario.as_ref().and_then(resolvida).is_some_and(|u| u.starts_with(&real));
    (!encosta && !acima_do_usuario).then(|| sem_prefixo_verbatim(real))
}

/// Troca as pastas de projeto pelas que o serviço mandou; as recusadas ficam de fora e vão ao log.
pub fn definir_projetos(pastas: &[String]) -> usize {
    let protegidas = Protegidas::da_maquina();
    let aceitas: Vec<PathBuf> = pastas.iter().filter_map(|p| raiz_de_projeto(p, &protegidas)).collect();
    if aceitas.len() < pastas.len() {
        crate::registro::info(&format!("abrir: {} pasta(s) de projeto recusada(s)", pastas.len() - aceitas.len()));
    }
    let quantas = aceitas.len();
    *PROJETOS.lock().unwrap() = aceitas;
    quantas
}

/// As pastas do Claude Code: a do `CLAUDE_CONFIG_DIR`, quando definido, e `%USERPROFILE%\.claude`,
/// que continua guardando login de quem já usou o CLI sem a variável. A primeira é a do
/// `settings.json` em uso, a mesma regra do serviço (`caminhoSettingsClaude`).
pub fn pastas_do_claude() -> Vec<PathBuf> {
    pastas_do_claude_de(std::env::var("CLAUDE_CONFIG_DIR").ok(), std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn pastas_do_claude_de(config: Option<String>, usuario: Option<PathBuf>) -> Vec<PathBuf> {
    let config = config.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).map(PathBuf::from);
    config.into_iter().chain(usuario.map(|casa| casa.join(".claude"))).collect()
}

fn raizes() -> Raizes {
    Raizes {
        dados: DADOS.get().cloned(),
        projetos: PROJETOS.lock().unwrap().clone(),
        protegidas: Protegidas::da_maquina(),
    }
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
    let validado = validar_endereco(endereco)
        .map_err(|m| recusado(&format!("o endereço {}", recusado_para_o_registro(endereco)), m))?;
    abrir(Alvo::Endereco(validado))
}

pub fn abrir_caminho_validado(caminho: &str) -> Result<(), String> {
    let validado = validar_caminho(caminho, &raizes()).map_err(|m| recusado(&format!("o caminho {caminho}"), m))?;
    abrir(Alvo::Caminho(validado))
}

/* ---------- Terminal de login ---------- */

/// O login de cada CLI que o "Entrar" abre no terminal (ADR-0038): a chave é o tipo do provedor no
/// contrato, o programa é o nome dele em `COMANDOS_CLI` (`pacotes/contrato/src/provedores.ts`) e
/// os argumentos são fixos. Só o Claude Code diz se está logado (a detecção do serviço), então só
/// ele tem "Entrar". `auth login --claudeai` entra com a assinatura, que é o que o Moductus usa, e
/// não abre uma sessão do CLI na pasta onde o terminal está (o `/login` abriria, com a pergunta de
/// confiar na pasta).
pub const LOGINS_CLI: &[(&str, &str, &str)] = &[("claude-cli", "claude", "auth login --claudeai")];

/// Título da janela enquanto o `cmd` não troca pelo do comando.
const TITULO_DO_TERMINAL: &str = "Moductus · entrar no CLI";

/// A linha de comando do terminal de login do CLI `cli`, só com texto deste arquivo: o `cmd.exe`
/// (caminho completo, sem busca no PATH) com `/k`, para a janela ficar aberta e mostrar se deu
/// certo. A chave tem de ser uma da lista, igual: nome de programa, comando ou qualquer outro
/// texto não abre nada.
pub fn linha_do_terminal(cli: &str, cmd: &Path) -> Result<String, String> {
    let (_, programa, argumentos) =
        LOGINS_CLI.iter().find(|(chave, _, _)| *chave == cli).ok_or("esse CLI não entra pelo Moductus")?;
    Ok(format!("\"{}\" /k {programa} {argumentos}", cmd.display()))
}

/// O `cmd.exe` do Windows, pela pasta do sistema.
fn cmd_do_windows() -> Result<PathBuf, String> {
    let cmd = std::env::var_os("SystemRoot")
        .map(|raiz| PathBuf::from(raiz).join("System32").join("cmd.exe"))
        .filter(|c| c.is_file())
        .ok_or("não achei o cmd.exe do Windows")?;
    Ok(cmd)
}

/// Abre o terminal num console novo, que o Windows mostra no terminal padrão do usuário (o Windows
/// Terminal, no Windows 11, a não ser que ele tenha escolhido outro). Nada é herdado da casca além
/// do ambiente: nem as saídas (no desenvolvimento, são do `tauri dev`) nem as alças. Começa na pasta
/// do usuário: a do Moductus pode ser a de instalação.
fn console_novo(cmd: &Path, linha: &str, cli: &str) -> Result<(), String> {
    let mut linha: Vec<u16> = linha.encode_utf16().chain(std::iter::once(0)).collect();
    let titulo = HSTRING::from(TITULO_DO_TERMINAL);
    let pasta = std::env::var_os("USERPROFILE").filter(|p| Path::new(p).is_dir()).map(HSTRING::from);
    let inicio = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        lpTitle: PWSTR(titulo.as_ptr() as *mut u16),
        ..Default::default()
    };
    let mut processo = PROCESS_INFORMATION::default();
    let resultado = unsafe {
        CreateProcessW(
            &HSTRING::from(cmd.as_os_str()),
            Some(PWSTR(linha.as_mut_ptr())),
            None,
            None,
            false,
            CREATE_NEW_CONSOLE,
            None,
            pasta.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            &inicio,
            &mut processo,
        )
    };
    match resultado {
        Ok(()) => {
            unsafe {
                let _ = CloseHandle(processo.hThread);
                let _ = CloseHandle(processo.hProcess);
            }
            crate::registro::info(&format!("abriu o terminal de login do {cli}"));
            Ok(())
        }
        Err(e) => {
            crate::registro::info(&format!("não abriu o terminal de login do {cli}: {}", e.message()));
            Err(format!("o Windows não abriu o terminal: {}", e.message()))
        }
    }
}

/// O terminal de login, já validado. O recusado vai ao registro sem o texto que veio: ele não é
/// da lista e poderia forjar uma linha.
pub fn abrir_terminal_validado(cli: &str) -> Result<(), String> {
    let cmd = cmd_do_windows()?;
    let linha = linha_do_terminal(cli, &cmd).map_err(|m| recusado("o terminal de um CLI fora da lista", m))?;
    console_novo(&cmd, &linha, cli)
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

fn em_json(pedido: Pedido) -> serde_json::Value {
    serde_json::to_value(atender(pedido)).unwrap_or_default()
}

/// Uma linha `abrir` do canal. A lista de projetos troca aqui mesmo, na thread do leitor, para
/// valer na ordem em que o serviço mandou (A e depois A+B termina em A+B). Endereço e arquivo vão
/// numa thread: o Windows pode demorar a abrir o navegador, e o canal não espera.
pub fn receber(linha: &str, responder: impl FnOnce(serde_json::Value) + Send + 'static) {
    match serde_json::from_str::<Pedido>(linha) {
        Ok(pedido @ Pedido::Projetos { .. }) => responder(em_json(pedido)),
        Ok(pedido) => {
            thread::spawn(move || responder(em_json(pedido)));
        }
        Err(e) => responder(serde_json::json!({ "erro": format!("pedido inválido: {e}") })),
    }
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

/// O terminal com o login do CLI (`cli` é a chave do contrato, `claude-cli`). Só pela interface,
/// num clique em "Entrar": o canal do serviço não tem terminal.
#[tauri::command]
pub async fn abrir_terminal(cli: String) -> Result<(), String> {
    abrir_terminal_validado(&cli)
}

/// O `settings.json` do Claude Code, que a interface não sabe onde fica quando a ligação falhou.
#[tauri::command]
pub async fn abrir_settings_claude() -> Result<(), String> {
    let pasta = pastas_do_claude().into_iter().next().ok_or("a pasta do usuário não está definida")?;
    let caminho = pasta.join("settings.json");
    abrir_caminho_validado(&caminho.to_string_lossy())
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::{fs, sync::Arc};

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

    /// Só uma pasta de projeto, sem pasta protegida: a pasta temporária fica no AppData.
    fn so_projeto(raiz: &Path) -> Raizes {
        Raizes { projetos: vec![raiz.to_path_buf()], ..Default::default() }
    }

    fn protegidas(sistema: &[&Path], usuario: Option<&Path>, claude: &[&Path]) -> Protegidas {
        Protegidas {
            sistema: sistema.iter().map(|p| p.to_path_buf()).collect(),
            usuario: usuario.map(Path::to_path_buf),
            claude: claude.iter().map(|p| p.to_path_buf()).collect(),
        }
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
    fn recusado_vai_ao_registro_sem_usuario_nem_senha() {
        let registro = recusado_para_o_registro;
        assert_eq!(registro("https://usuario:senha@github.com/a?code=x"), "https://github.com");
        assert_eq!(registro("http://token@a@outro.site:8080/x"), "http://outro.site:8080");
        assert_eq!(registro("https://github.com\\a"), "https://github.com");
        assert_eq!(registro("javascript:alert(document.cookie)"), "javascript:");
        assert_eq!(registro("mailto:a@b.c"), "mailto:");
        assert_eq!(registro("segredo@github.com"), "(sem esquema)");
        assert_eq!(registro(""), "(sem esquema)");
        assert_eq!(registro(&format!("https://{}@a.com", "z".repeat(500))), "https://a.com");
        // O `://` da query não faz do usuário e da senha um esquema.
        assert_eq!(registro("usuario:senha@site.com/x?volta=https://a.com"), "(sem esquema)");
        assert_eq!(registro("java script://x"), "(sem esquema)");
        // Nada depois de um controle: não forja linha no registro.
        assert_eq!(registro("https://site.com\nlinha forjada"), "https://site.com");
        assert_eq!(registro("https://site.com\r\n2026-10-16 abriu arquivo C:\\x"), "https://site.com");
        // O navegador tira a quebra de linha e lê o servidor depois do @; a senha não vai junto.
        assert_eq!(registro("https://site.com\n@outro.site"), "https://outro.site");
        assert_eq!(registro("https://u:senha\u{7}@site.com"), "https://site.com");
    }

    #[test]
    fn arquivo_e_pasta_dentro_da_raiz_abrem() {
        let raiz = pasta("dentro");
        fs::create_dir_all(raiz.join("exportacoes")).unwrap();
        fs::write(raiz.join("exportacoes").join("casa.moductus"), "x").unwrap();
        fs::write(raiz.join("moductus.log"), "x").unwrap();
        let raizes = so_projeto(&raiz);
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
        let raizes = so_projeto(&raiz);
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
        let raizes = so_projeto(&raiz);
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
    fn cada_tipo_da_lista_abre() {
        let raiz = pasta("permitidas");
        let raizes = so_projeto(&raiz);
        for extensao in PERMITIDAS {
            for nome in [format!("arquivo.{extensao}"), format!("ARQUIVO.{}", extensao.to_ascii_uppercase())] {
                fs::write(raiz.join(&nome), "x").unwrap();
                assert!(validar_caminho(&texto(&raiz.join(&nome)), &raizes).is_ok(), "deveria abrir {nome}");
            }
        }
        // Pasta abre no Explorer, com qualquer nome: não executa nada.
        fs::create_dir_all(raiz.join("ferramenta.exe")).unwrap();
        fs::create_dir_all(raiz.join("sem-extensao")).unwrap();
        assert!(validar_caminho(&texto(&raiz.join("ferramenta.exe")), &raizes).is_ok());
        assert!(validar_caminho(&texto(&raiz.join("sem-extensao")), &raizes).is_ok());
        let _ = fs::remove_dir_all(&raiz);
    }

    /// Fora da lista não abre, mesmo dentro da raiz: o que a lista de executáveis deixou passar
    /// (`.sh` pelo Git Bash, `.msstyles`, `.pyz`), o que não tem extensão e o resto.
    #[test]
    fn tipo_fora_da_lista_nao_abre() {
        let raiz = pasta("fora-da-lista");
        let raizes = so_projeto(&raiz);
        for nome in [
            "a.sh", "b.msstyles", "c.pyz", "d.exe", "e.CMD", "f.ps1", "g.lnk", "h.theme", "i.diagcfg", "j.diagpkg",
            "k.xaml", "l.wsl", "m.vsix", "n.sln", "o.csproj", "p.unitypackage", "q.html", "r.svg", "s.zip", "t.bak",
            "u.sqlite", "LEIAME", "settings.json.moductus-2026-10-09T12-00-00-000Z.bak",
        ] {
            fs::write(raiz.join(nome), "x").unwrap();
            let erro = validar_caminho(&texto(&raiz.join(nome)), &raizes);
            assert!(erro.as_ref().is_err_and(|e| e.contains("tipo de arquivo")), "deveria recusar {nome}: {erro:?}");
        }
        // O Windows tira o ponto do fim: "a.sh." é o a.sh, e "nota.txt." não passa pelo nome pedido.
        fs::write(raiz.join("nota.txt"), "x").unwrap();
        assert!(validar_caminho(&format!("{}.", texto(&raiz.join("a.sh"))), &raizes).is_err());
        assert!(validar_caminho(&format!("{}.", texto(&raiz.join("nota.txt"))), &raizes).is_err());
        let _ = fs::remove_dir_all(&raiz);
    }

    /// A barreira extra é o Windows mesmo: essas extensões ele marca como perigosas, e as da lista
    /// não. Se a função devolvesse sempre `false`, a primeira parte falharia.
    #[test]
    fn o_windows_diz_o_que_e_perigoso() {
        for extensao in ["shb", "adp", "ins", "wsc", "exe"] {
            assert!(perigosa_para_o_windows(extensao), "o Windows marca .{extensao} como perigosa");
        }
        for extensao in PERMITIDAS {
            assert!(!perigosa_para_o_windows(extensao), ".{extensao} não deveria ser perigosa");
        }
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
        let raizes =
            Raizes { protegidas: protegidas(&[], None, &[&claude]), ..Default::default() };
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

    /// Mesmo que a pasta do Claude Code fique dentro de uma raiz ativa (projeto ou dados, ela
    /// mesma ou uma pasta acima), o login não abre.
    #[test]
    fn o_login_do_claude_nao_abre_por_raiz_nenhuma() {
        let casa = pasta("claude-dentro");
        let claude = casa.join(".claude");
        fs::create_dir_all(claude.join("projects")).unwrap();
        fs::write(claude.join(".credentials.json"), "{}").unwrap();
        fs::write(claude.join("settings.json"), "{}").unwrap();
        fs::write(claude.join("projects").join("sessao.jsonl"), "{}").unwrap();
        let guarda = protegidas(&[], None, &[&claude]);
        for raizes in [
            Raizes { projetos: vec![claude.clone()], protegidas: protegidas(&[], None, &[&claude]), ..Default::default() },
            Raizes { projetos: vec![casa.clone()], protegidas: protegidas(&[], None, &[&claude]), ..Default::default() },
            Raizes { dados: Some(casa.clone()), protegidas: guarda, ..Default::default() },
        ] {
            let pode = |p: &Path| validar_caminho(&texto(p), &raizes).is_ok();
            assert!(!pode(&claude.join(".credentials.json")), "o login nunca abre: {raizes:?}");
            assert!(!pode(&claude.join("projects").join("sessao.jsonl")));
            assert!(!pode(&claude));
            assert!(pode(&claude.join("settings.json")));
        }
        let _ = fs::remove_dir_all(&casa);
    }

    /// Com o `CLAUDE_CONFIG_DIR` definido, `%USERPROFILE%\.claude` continua guardando o login de
    /// antes da variável: as duas ficam protegidas, como raiz e como conteúdo, e das duas abrem o
    /// `settings.json` e as cópias.
    #[test]
    fn as_duas_pastas_do_claude_ficam_protegidas() {
        let base = pasta("claude-duas");
        let config = base.join("config-claude");
        let usuario = base.join("Users").join("ana");
        let casa = usuario.join(".claude");
        let copia = "settings.json.moductus-2026-10-09T12-00-00-000Z.bak";
        for onde in [&config, &casa] {
            fs::create_dir_all(onde.join("projects")).unwrap();
            for nome in [".credentials.json", "settings.json", copia] {
                fs::write(onde.join(nome), "{}").unwrap();
            }
            fs::write(onde.join("projects").join("sessao.jsonl"), "{}").unwrap();
        }
        let guarda = || protegidas(&[], Some(&usuario), &[&config, &casa]);
        for onde in [&config, &casa] {
            assert_eq!(raiz_de_projeto(&texto(onde), &guarda()), None, "{onde:?} não vira projeto");
            assert_eq!(raiz_de_projeto(&texto(&onde.join("projects")), &guarda()), None);
        }
        assert_eq!(raiz_de_projeto(&texto(&base), &guarda()), None, "a pasta acima das duas");
        for raizes in [
            Raizes { projetos: vec![base.clone()], protegidas: guarda(), ..Default::default() },
            Raizes { dados: Some(base.clone()), protegidas: guarda(), ..Default::default() },
        ] {
            let pode = |p: &Path| validar_caminho(&texto(p), &raizes).is_ok();
            for onde in [&config, &casa] {
                assert!(!pode(&onde.join(".credentials.json")), "o login de {onde:?} nunca abre");
                assert!(!pode(&onde.join("projects").join("sessao.jsonl")));
                assert!(!pode(onde));
                assert!(pode(&onde.join("settings.json")), "o settings.json de {onde:?} abre");
                assert!(pode(&onde.join(copia)), "a cópia de {onde:?} abre");
            }
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn de_onde_vem_as_pastas_do_claude() {
        let usuario = Some(PathBuf::from("C:\\Users\\ana"));
        assert_eq!(
            pastas_do_claude_de(Some(" D:\\config\\claude ".into()), usuario.clone()),
            vec![PathBuf::from("D:\\config\\claude"), PathBuf::from("C:\\Users\\ana\\.claude")],
            "a da variável primeiro: é a do settings.json em uso"
        );
        assert_eq!(pastas_do_claude_de(Some("  ".into()), usuario.clone()), vec![PathBuf::from("C:\\Users\\ana\\.claude")]);
        assert_eq!(pastas_do_claude_de(None, usuario), vec![PathBuf::from("C:\\Users\\ana\\.claude")]);
        assert_eq!(pastas_do_claude_de(Some("D:\\c".into()), None), vec![PathBuf::from("D:\\c")]);
        assert!(pastas_do_claude_de(None, None).is_empty());
    }

    /// A pasta de dados fica no AppData de propósito e abre; pela pasta de projeto, o arquivo
    /// resolvido numa pasta do sistema não abre.
    #[test]
    fn arquivo_em_pasta_do_sistema_so_abre_pelos_dados() {
        let base = pasta("sistema-dentro");
        let sistema = base.join("AppData");
        fs::create_dir_all(sistema.join("Moductus")).unwrap();
        fs::write(sistema.join("Moductus").join("moductus.log"), "x").unwrap();
        let log = sistema.join("Moductus").join("moductus.log");
        let pelo_projeto =
            Raizes { projetos: vec![base.clone()], protegidas: protegidas(&[&sistema], None, &[]), ..Default::default() };
        assert!(validar_caminho(&texto(&log), &pelo_projeto).is_err());
        let pelos_dados = Raizes {
            dados: Some(sistema.join("Moductus")),
            protegidas: protegidas(&[&sistema], None, &[]),
            ..Default::default()
        };
        assert!(validar_caminho(&texto(&log), &pelos_dados).is_ok());
        let _ = fs::remove_dir_all(&base);
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
        let proibidas = protegidas(&[&sistema], None, &[]);
        let nenhuma = Protegidas::default();
        assert_eq!(raiz_de_projeto(&texto(&projeto), &proibidas), Some(projeto.clone()));
        assert_eq!(raiz_de_projeto(&texto(&sistema), &proibidas), None);
        assert_eq!(raiz_de_projeto(&texto(&sistema.join("dentro")), &proibidas), None);
        assert_eq!(raiz_de_projeto("C:\\", &nenhuma), None, "a unidade inteira não é projeto");
        assert_eq!(raiz_de_projeto("projeto", &nenhuma), None);
        assert_eq!(raiz_de_projeto(&texto(&projeto.join("nao-existe")), &nenhuma), None);
        fs::write(projeto.join("arquivo.txt"), "x").unwrap();
        assert_eq!(raiz_de_projeto(&texto(&projeto.join("arquivo.txt")), &nenhuma), None, "projeto é pasta");
        for p in [sistema, projeto] {
            let _ = fs::remove_dir_all(p);
        }
    }

    /// Uma sessão do CLI aberta numa pasta acima de uma protegida (`C:\Users`, `C:\Users\<u>`,
    /// `…\AppData`) ou na pasta do Claude Code não vira raiz: liberaria o que está dentro.
    #[test]
    fn pasta_de_projeto_nao_contem_pasta_protegida() {
        let base = pasta("acima");
        let usuarios = base.join("Users");
        let usuario = usuarios.join("ana");
        let claude = usuario.join(".claude");
        let appdata = usuario.join("AppData");
        let roaming = appdata.join("Roaming");
        let projeto = usuario.join("Projetos").join("site");
        for p in [&claude.join("projects"), &roaming, &projeto] {
            fs::create_dir_all(p).unwrap();
        }
        let guarda = protegidas(&[&roaming], Some(&usuario), &[&claude]);
        let raiz = |p: &Path| raiz_de_projeto(&texto(p), &guarda);
        assert_eq!(raiz(&claude), None, "a pasta do Claude Code guarda o login");
        assert_eq!(raiz(&claude.join("projects")), None, "nem o que fica dentro dela");
        assert_eq!(raiz(&usuario), None, "a pasta do usuário inteira");
        assert_eq!(raiz(&usuarios), None, "a pasta acima da do usuário");
        assert_eq!(raiz(&appdata), None, "a pasta acima do AppData\\Roaming");
        assert_eq!(raiz(&base), None);
        assert_eq!(raiz(&projeto), Some(projeto.clone()), "o projeto dentro da pasta do usuário pode");
        // A pasta do Claude Code fora da do usuário (CLAUDE_CONFIG_DIR) também protege quem está acima.
        let outra = base.join("config");
        fs::create_dir_all(outra.join("claude")).unwrap();
        let so_claude = protegidas(&[], None, &[&outra.join("claude")]);
        assert_eq!(raiz_de_projeto(&texto(&outra), &so_claude), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn as_pastas_do_windows_estao_entre_as_proibidas() {
        let proibidas = Protegidas::da_maquina();
        let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap();
        assert!(raiz_de_projeto(&texto(&windows), &proibidas).is_none());
        assert!(raiz_de_projeto(&texto(&windows.join("System32")), &proibidas).is_none());
        // A pasta do usuário inteira não vira projeto, nem a de cima, nem o AppData.
        let usuario = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap();
        assert!(raiz_de_projeto(&texto(&usuario), &proibidas).is_none());
        assert!(raiz_de_projeto(&texto(usuario.parent().unwrap()), &proibidas).is_none());
        assert!(raiz_de_projeto(&texto(&usuario.join("AppData")), &proibidas).is_none());
        // O AppData inteiro é do sistema, não só Roaming e Local: o LocalLow também.
        assert!(proibidas.sistema.contains(&usuario.join("AppData")));
        let local_low = usuario.join("AppData").join("LocalLow");
        if local_low.is_dir() {
            assert!(raiz_de_projeto(&texto(&local_low), &proibidas).is_none());
        }
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
        // O terminal só vem de um clique na interface; o serviço não tem como pedir.
        assert!(serde_json::from_str::<Pedido>(r#"{"tipo":"abrir","id":7,"op":"terminal","comando":"x"}"#).is_err());
        assert!(serde_json::from_str::<Pedido>(r#"{"tipo":"abrir","id":8,"op":"terminal","cli":"claude-cli"}"#).is_err());
    }

    #[test]
    fn terminal_de_login_do_claude_code() {
        let cmd = Path::new("C:\\Windows\\System32\\cmd.exe");
        assert_eq!(
            linha_do_terminal("claude-cli", cmd).as_deref(),
            Ok("\"C:\\Windows\\System32\\cmd.exe\" /k claude auth login --claudeai")
        );
    }

    /// Só a chave da lista abre o terminal: nome de programa, comando, texto livre, chave de CLI
    /// sem login conhecido e chave com qualquer coisa a mais são recusados.
    #[test]
    fn terminal_recusa_o_que_nao_e_chave_da_lista() {
        let cmd = Path::new("C:\\Windows\\System32\\cmd.exe");
        for cli in [
            "codex-cli",
            "gemini-cli",
            "opencode-cli",
            "anthropic",
            "claude",
            "claude /login",
            "claude auth login --claudeai",
            "claude-cli & calc",
            "claude-cli\" & calc",
            "claude-cli\n",
            " claude-cli",
            "CLAUDE-CLI",
            "cmd.exe /c calc",
            "powershell -c calc",
            "",
        ] {
            let erro = linha_do_terminal(cli, cmd);
            assert_eq!(erro, Err("esse CLI não entra pelo Moductus".into()), "deveria recusar {cli:?}");
        }
        // A recusa vem antes do Windows: nada abre aqui.
        assert!(abrir_terminal_validado("cmd.exe /c calc").is_err());
    }

    /// O programa de cada login é o nome do CLI no contrato: se o contrato mudar o nome, este
    /// teste avisa antes de o "Entrar" abrir um comando que não existe.
    #[test]
    fn programa_do_login_e_o_do_contrato() {
        let contrato = include_str!("../../pacotes/contrato/src/provedores.ts");
        for (chave, programa, _) in LOGINS_CLI {
            assert!(
                contrato.contains(&format!("\"{chave}\": \"{programa}\",")),
                "COMANDOS_CLI do contrato deveria ter \"{chave}\": \"{programa}\""
            );
        }
    }

    /// O canal recusa antes de chegar ao Windows: nada abre neste teste.
    #[test]
    fn o_canal_recusa_com_o_motivo() {
        let r = atender(Pedido::Endereco { endereco: "http://github.com".into() });
        assert!(matches!(r, Resposta::Erro { erro } if erro.contains("https://")));
        let r = atender(Pedido::Arquivo { caminho: "C:\\Windows\\System32\\notepad.exe".into() });
        assert!(matches!(r, Resposta::Erro { erro } if erro.contains("tipo de arquivo")));
        // Tipo que abre, fora das raízes: a pasta temporária não é projeto nem dados.
        let fora = pasta("canal");
        fs::write(fora.join("nota.txt"), "x").unwrap();
        let r = atender(Pedido::Arquivo { caminho: texto(&fora.join("nota.txt")) });
        assert!(matches!(r, Resposta::Erro { erro } if erro.contains("fora das pastas")));
        let _ = fs::remove_dir_all(&fora);
        assert_eq!(
            serde_json::to_value(Resposta::Erro { erro: "x".into() }).unwrap(),
            serde_json::json!({ "erro": "x" })
        );
    }

    /// A lista de projetos troca antes de `receber` voltar: duas linhas seguidas do canal valem
    /// na ordem em que chegaram, A e depois A+B termina em A+B. As pastas ficam junto do binário
    /// do teste (fora do AppData, onde fica a pasta temporária) para a casca aceitar as duas.
    #[test]
    fn lista_de_projetos_troca_na_ordem_do_canal() {
        let junto = std::env::current_exe().unwrap().parent().unwrap().join(format!("moductus-abrir-ordem-{}", std::process::id()));
        let (a, b) = (junto.join("a"), junto.join("b"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let (a, b) = (sem_prefixo_verbatim(fs::canonicalize(&a).unwrap()), sem_prefixo_verbatim(fs::canonicalize(&b).unwrap()));
        let linha = |id: u32, pastas: &[&Path]| {
            let pastas: Vec<String> = pastas.iter().map(|p| texto(p)).collect();
            serde_json::json!({ "tipo": "abrir", "id": id, "op": "projetos", "pastas": pastas }).to_string()
        };
        for (id, pastas) in [(1, vec![&*a]), (2, vec![&*a, &*b])] {
            let respondeu = Arc::new(Mutex::new(None));
            let guarda = Arc::clone(&respondeu);
            receber(&linha(id, &pastas), move |r| *guarda.lock().unwrap() = Some(r));
            assert_eq!(*respondeu.lock().unwrap(), Some(serde_json::json!({ "ok": true })), "respondeu antes de voltar");
            let vivas: Vec<PathBuf> = pastas.iter().map(|p| p.to_path_buf()).collect();
            assert_eq!(*PROJETOS.lock().unwrap(), vivas, "a lista da linha {id} já vale");
        }
        let erro = Arc::new(Mutex::new(None));
        let guarda = Arc::clone(&erro);
        receber(r#"{"tipo":"abrir","id":3,"op":"projetos"}"#, move |r| *guarda.lock().unwrap() = Some(r));
        assert!(erro.lock().unwrap().as_ref().is_some_and(|r| r["erro"].as_str().unwrap().contains("pedido inválido")));
        definir_projetos(&[]);
        let _ = fs::remove_dir_all(&junto);
    }
}
