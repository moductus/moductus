//! Painel, Sistema e captura. Todas são criadas no início, logo depois de o dock reservar
//! a faixa (`criar`), e só aparecem ou somem aqui, para abrirem sem atraso.
//!
//! - painel: ao lado do dock, sem ativar; ganha foco só quando a interface pede
//!   (campo de texto);
//! - Sistema: janela normal que lembra posição e tamanho; fechar esconde;
//! - captura: centralizada no monitor principal, ganha foco e some ao perdê-lo.

use std::{
    mem::size_of,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::{
        GetWindowRect, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE,
        SW_SHOWNOACTIVATE,
    },
};

use crate::{appbar, dock};

/// Largura do cartão do painel lateral em pixels lógicos (DESIGN §3: 400 px, como nos quadros).
pub const LARGURA_PAINEL: f64 = 400.0;
/// Folga transparente do lado de fora do cartão (`--margem-painel`), onde a sombra dele cabe. Do
/// lado do dock não há folga: o cartão encosta no dock.
pub const MARGEM_PAINEL: f64 = 12.0;

/// Largura física da janela do painel: o cartão mais a folga, na escala do monitor.
pub fn largura_janela_painel(escala: f64) -> i32 {
    ((LARGURA_PAINEL + MARGEM_PAINEL) * escala).round() as i32
}

static PAINEL: Mutex<Option<(String, Instant)>> = Mutex::new(None);
/// A área que a interface do painel confirmou ter desenhado (`painel_pronto`) desde a abertura.
static CONFIRMADA: Mutex<Option<String>> = Mutex::new(None);
static ARQUIVO_SISTEMA: OnceLock<PathBuf> = OnceLock::new();

fn janela(app: &AppHandle, rotulo: &str) -> Option<WebviewWindow> {
    app.get_webview_window(rotulo)
}

fn hwnd(janela: &WebviewWindow) -> HWND {
    HWND(dock::hwnd_de(janela) as _)
}

/// Cria as janelas que o tauri.conf.json marca com `"create": false`, com a configuração
/// de lá. O Tauri só chama o `setup` depois de criar os WebViews declarados; deixando só o
/// dock para ele, a faixa é reservada antes de os outros três WebViews existirem.
pub fn criar(app: &AppHandle) -> tauri::Result<()> {
    for config in app.config().app.windows.iter().filter(|c| !c.create) {
        if janela(app, &config.label).is_none() {
            WebviewWindowBuilder::from_config(app, config)?.build()?;
        }
    }
    Ok(())
}

pub fn iniciar(app: &AppHandle, pasta: PathBuf) {
    if let Some(painel) = janela(app, "painel") {
        dock::sem_ativar(dock::hwnd_de(&painel));
    }
    let arquivo = ARQUIVO_SISTEMA.get_or_init(|| pasta.join("sistema.json"));
    let Some(sistema) = janela(app, "sistema") else { return };
    if let Some(pos) = ler_posicao(arquivo) {
        let _ = sistema.set_size(PhysicalSize::new(pos.largura, pos.altura));
        let _ = sistema.set_position(PhysicalPosition::new(pos.x, pos.y));
    }
    caber_no_monitor(&sistema);
}

/// Esconde pelo Win32, que vale também para janela mostrada fora do Tauri (o hide() dele
/// confia no estado que ele mesmo guardou e não faz nada se a janela apareceu por ShowWindow).
fn esconder(janela: &WebviewWindow) {
    unsafe {
        let _ = ShowWindow(hwnd(janela), SW_HIDE);
    }
}

// ---------- painel ----------

/// Retângulo do painel encostado no dock desenhado, do lado de dentro da tela. `recuo` é a margem
/// transparente da janela do dock flutuante (física; zero no colado): a janela do painel entra
/// nela para o cartão encostar no dock, não na borda da janela dele.
pub fn retangulo_painel(dock: RECT, lado: appbar::Lado, largura: i32, recuo: i32) -> RECT {
    match lado {
        appbar::Lado::Esquerda => {
            let left = dock.right - recuo;
            RECT { left, top: dock.top, right: left + largura, bottom: dock.bottom }
        }
        appbar::Lado::Direita => {
            let right = dock.left + recuo;
            RECT { left: right - largura, top: dock.top, right, bottom: dock.bottom }
        }
    }
}

/// Abre o painel de uma área ao lado do dock; a mesma área de novo fecha.
#[tauri::command]
pub fn painel_abrir(app: AppHandle, area: String) {
    abrir_painel(app, area, true);
}

/// Abre o painel de uma área sem alternar: já aberto nela, fica aberto (o clique no aviso do
/// Windows leva ao time, nunca o esconde).
pub fn painel_mostrar(app: AppHandle, area: String) {
    abrir_painel(app, area, false);
}

fn abrir_painel(app: AppHandle, area: String, alternar: bool) {
    let (Some(painel), Some(janela_dock)) = (janela(&app, "painel"), janela(&app, "dock")) else { return };
    let aberta = PAINEL.lock().unwrap().as_ref().map(|(a, _)| a.clone());
    if aberta.as_deref() == Some(area.as_str()) && unsafe { IsWindowVisible(hwnd(&painel)) }.as_bool() {
        if alternar {
            painel_fechar(app);
        }
        return;
    }
    *PAINEL.lock().unwrap() = Some((area.clone(), Instant::now()));
    *CONFIRMADA.lock().unwrap() = None;

    let mut rd = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd(&janela_dock), &mut rd);
    }
    let escala = appbar::escala(dock::hwnd_de(&janela_dock));
    let config = dock::configuracao();
    let recuo = (dock::margem_janela(config.forma) * escala).round() as i32;
    let rc = retangulo_painel(rd, config.lado, largura_janela_painel(escala), recuo);
    let _ = painel.emit("painel:area", &area);
    unsafe {
        let h = hwnd(&painel);
        let _ = SetWindowPos(h, Some(HWND_TOPMOST), rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, SWP_NOACTIVATE);
        let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
    }
    crate::clique_fora::ligar();
}

#[tauri::command]
pub fn painel_fechar(app: AppHandle) {
    if let Some(painel) = janela(&app, "painel") {
        // Esconde pelo mesmo caminho que mostrou (ShowWindow): o hide() do Tauri não vê a
        // janela como visível e não faz nada.
        unsafe {
            let _ = ShowWindow(hwnd(&painel), SW_HIDE);
        }
        dock::sem_ativar(dock::hwnd_de(&painel));
    }
    crate::clique_fora::desligar();
    *PAINEL.lock().unwrap() = None;
    *CONFIRMADA.lock().unwrap() = None;
    // O dock tira a marca da área aberta.
    let _ = app.emit("painel:fechado", ());
}

/// As áreas que o serviço abre sozinho: o painel Hoje, onde o briefing e o fechamento aparecem.
const AREAS_DO_SERVICO: [&str; 1] = ["hoje"];

/// Pedido do serviço pelo canal do sidecar (`{"tipo":"painel","id",…}`).
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum PedidoPainel {
    /// Mostra o painel na área, sem ativar e sem alternar.
    Mostrar { area: String },
    /// Se o painel está à vista nessa área.
    Aberto { area: String },
}

/// Lê o pedido do serviço; área fora da lista é recusada.
pub fn pedido_do_servico(linha: &str) -> Result<PedidoPainel, String> {
    let pedido: PedidoPainel = serde_json::from_str(linha).map_err(|e| format!("pedido inválido: {e}"))?;
    let (PedidoPainel::Mostrar { area } | PedidoPainel::Aberto { area }) = &pedido;
    if !AREAS_DO_SERVICO.contains(&area.as_str()) {
        return Err(format!("o serviço não abre o painel em {area}"));
    }
    Ok(pedido)
}

/// O serviço pede o painel (o briefing apareceu) ou pergunta se ele está aberto. Em tela cheia o
/// painel não aparece por cima do jogo ou da apresentação: responde `ok: false`.
pub fn atender_servico(app: &AppHandle, linha: &str) -> serde_json::Value {
    match pedido_do_servico(linha) {
        Err(erro) => serde_json::json!({ "erro": erro }),
        Ok(PedidoPainel::Mostrar { area }) => {
            if crate::tela_cheia::agora() {
                return serde_json::json!({ "ok": false, "tela_cheia": true });
            }
            painel_mostrar(app.clone(), area);
            serde_json::json!({ "ok": true })
        }
        Ok(PedidoPainel::Aberto { area }) => {
            let aberta = PAINEL.lock().unwrap().as_ref().map(|(a, _)| a.clone());
            let confirmada = CONFIRMADA.lock().unwrap().clone();
            let visivel = janela(app, "painel").is_some_and(|p| unsafe { IsWindowVisible(hwnd(&p)) }.as_bool());
            serde_json::json!({ "aberto": aberto_e_confirmado(visivel, aberta.as_deref(), confirmada.as_deref(), &area) })
        }
    }
}

/// O painel está à vista na área só quando a interface confirmou que a desenhou: a janela visível
/// com o `painel:area` perdido (o WebView ainda subindo) mostra um cartão vazio, não o briefing.
pub fn aberto_e_confirmado(visivel: bool, aberta: Option<&str>, confirmada: Option<&str>, area: &str) -> bool {
    visivel && aberta == Some(area) && confirmada == Some(area)
}

/// O painel que acabou de montar pergunta a área aberta: o `painel:area` emitido antes de a
/// interface ouvir se perdeu. Fechado, nenhuma.
#[tauri::command]
pub fn painel_area_atual(app: AppHandle) -> Option<String> {
    let aberta = PAINEL.lock().unwrap().as_ref().map(|(a, _)| a.clone())?;
    let visivel = janela(&app, "painel").is_some_and(|p| unsafe { IsWindowVisible(hwnd(&p)) }.as_bool());
    visivel.then_some(aberta)
}

/// A interface do painel avisa que desenhou a área: fecha a medição de abertura e confirma a área
/// para quem pergunta se o painel está à vista.
#[tauri::command]
pub fn painel_pronto(area: String) -> Option<f64> {
    let guarda = PAINEL.lock().unwrap();
    let (aberta, inicio) = guarda.as_ref()?;
    if *aberta != area {
        return None;
    }
    *CONFIRMADA.lock().unwrap() = Some(area.clone());
    let ms = inicio.elapsed().as_secs_f64() * 1000.0;
    crate::registro::info(&format!("painel {area} aberto em {ms:.1} ms"));
    Some(ms)
}

/// Um campo de texto do painel pede o teclado: só então o painel pode ativar.
#[tauri::command]
pub fn painel_foco(app: AppHandle, quer: bool) {
    let Some(painel) = janela(&app, "painel") else { return };
    let h = hwnd(&painel);
    if quer {
        dock::com_ativar(dock::hwnd_de(&painel));
        unsafe {
            let _ = SetForegroundWindow(h);
        }
    } else {
        dock::sem_ativar(dock::hwnd_de(&painel));
    }
}

// ---------- Sistema ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Posicao {
    x: i32,
    y: i32,
    largura: u32,
    altura: u32,
}

fn ler_posicao(arquivo: &PathBuf) -> Option<Posicao> {
    let p: Posicao = serde_json::from_str(&std::fs::read_to_string(arquivo).ok()?).ok()?;
    (p.largura >= 400 && p.altura >= 300).then_some(p)
}

/// O retângulo da janela dentro da área útil do monitor: encolhe o que passa do tamanho dela e
/// traz de volta o que sobra para fora, sem mexer no que já cabe.
pub fn retangulo_na_area_util(janela: RECT, area: RECT) -> RECT {
    let largura = (janela.right - janela.left).min(area.right - area.left);
    let altura = (janela.bottom - janela.top).min(area.bottom - area.top);
    let x = janela.left.clamp(area.left, area.right - largura);
    let y = janela.top.clamp(area.top, area.bottom - altura);
    RECT { left: x, top: y, right: x + largura, bottom: y + altura }
}

/// Prende o Sistema restaurado à área útil do monitor onde ele está (sem a barra de tarefas e a
/// faixa do dock). O tamanho gravado veio de outra tela ou de outra escala e pode não caber.
fn caber_no_monitor(sistema: &WebviewWindow) {
    if sistema.is_maximized().unwrap_or(false) || sistema.is_minimized().unwrap_or(false) {
        return;
    }
    let h = hwnd(sistema);
    let mut rc = RECT::default();
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe {
        if GetWindowRect(h, &mut rc).is_err() || !GetMonitorInfoW(MonitorFromRect(&rc, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return;
        }
    }
    let alvo = retangulo_na_area_util(rc, info.rcWork);
    if alvo == rc {
        return;
    }
    crate::registro::info(&format!(
        "sistema {}x{} preso à área útil: {}x{}",
        rc.right - rc.left,
        rc.bottom - rc.top,
        alvo.right - alvo.left,
        alvo.bottom - alvo.top
    ));
    unsafe {
        let _ = SetWindowPos(h, None, alvo.left, alvo.top, alvo.right - alvo.left, alvo.bottom - alvo.top, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

/// Grava posição e tamanho do Sistema quando ele se move ou muda de tamanho.
pub fn sistema_mudou(sistema: &WebviewWindow) {
    if sistema.is_minimized().unwrap_or(false) || sistema.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(tam), Some(arquivo)) = (sistema.outer_position(), sistema.outer_size(), ARQUIVO_SISTEMA.get()) else {
        return;
    };
    let p = Posicao { x: pos.x, y: pos.y, largura: tam.width, altura: tam.height };
    if let Ok(json) = serde_json::to_string(&p) {
        let _ = std::fs::write(arquivo, json);
    }
}

#[tauri::command]
pub fn sistema_alternar(app: AppHandle) {
    let Some(sistema) = janela(&app, "sistema") else { return };
    if sistema.is_visible().unwrap_or(false) && sistema.is_focused().unwrap_or(false) {
        let _ = sistema.hide();
    } else {
        let _ = sistema.unminimize();
        caber_no_monitor(&sistema);
        let _ = sistema.show();
        let _ = sistema.set_focus();
    }
}

/// As 12 áreas do Sistema, na ordem da barra lateral (DESIGN, Sistema.dc.html).
pub const AREAS_SISTEMA: [&str; 12] =
    ["inicio", "agentes", "sessoes", "tarefas", "foco", "financas", "dev", "notas", "arquivos", "memoria", "ferramentas", "configuracoes"];

/// Área pedida, se for uma das 12; um nome desconhecido cai no Início.
pub fn area_sistema(area: &str) -> &'static str {
    AREAS_SISTEMA.iter().find(|a| **a == area).copied().unwrap_or("inicio")
}

/// Destino "area" ou "area/secao": a área é validada; a seção segue para o Sistema decidir
/// (o convite do time leva direto a Configurações › Modelos).
pub fn destino_sistema(destino: &str) -> String {
    match destino.split_once('/') {
        Some((area, secao)) if area_sistema(area) == area && !secao.is_empty() => {
            format!("{area}/{secao}")
        }
        Some((area, _)) => area_sistema(area).to_string(),
        None => area_sistema(destino).to_string(),
    }
}

/// Mostra e foca o Sistema já numa área (o convite do time leva às Configurações).
#[tauri::command]
pub fn sistema_abrir(app: AppHandle, area: String) {
    let Some(sistema) = janela(&app, "sistema") else { return };
    let area = destino_sistema(&area);
    let _ = sistema.unminimize();
    caber_no_monitor(&sistema);
    let _ = sistema.show();
    let _ = sistema.set_focus();
    let _ = sistema.emit_to("sistema", "sistema:ir", &area);
    crate::registro::info(&format!("sistema aberto em {area}"));
}

// ---------- captura ----------

/// Largura do cartão da captura em pixels lógicos (Captura.dc.html): a janela é o cartão.
pub const LARGURA_CAPTURA: f64 = 640.0;
/// A altura que a captura segue ao crescer: o cartão com a prévia e o "Na verdade é" cabe com
/// folga; mais que isso é pedido fora do normal e fica no teto.
pub const ALTURA_MAXIMA_CAPTURA: f64 = 560.0;
pub const ALTURA_MINIMA_CAPTURA: f64 = 48.0;
/// Altura de referência para o ponto de abertura: o topo da captura fica no mesmo lugar com ou
/// sem prévia, e ela cresce para baixo.
pub const ALTURA_ANCORA_CAPTURA: f64 = 72.0;

/// Centraliza a captura no monitor principal, com o topo um pouco acima do meio: o centro da
/// altura de referência (`ancora`) no terço de cima, qualquer que seja a altura de agora.
pub fn retangulo_captura(monitor: RECT, largura: i32, altura: i32, ancora: i32) -> RECT {
    let x = monitor.left + (monitor.right - monitor.left - largura) / 2;
    let y = monitor.top + (monitor.bottom - monitor.top) / 3 - ancora / 2;
    RECT { left: x, top: y, right: x + largura, bottom: y + altura }
}

/// A altura pedida pela interface, dentro dos limites; o que não é número vira o mínimo.
pub fn altura_captura(pedida: f64) -> f64 {
    if !pedida.is_finite() {
        return ALTURA_MINIMA_CAPTURA;
    }
    pedida.clamp(ALTURA_MINIMA_CAPTURA, ALTURA_MAXIMA_CAPTURA)
}

#[tauri::command]
pub fn captura_alternar(app: AppHandle) {
    let Some(captura) = janela(&app, "captura") else { return };
    if unsafe { IsWindowVisible(hwnd(&captura)) }.as_bool() {
        esconder(&captura);
        return;
    }
    let mut rc = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd(&captura), &mut rc);
    }
    let escala = captura.scale_factor().unwrap_or(1.0);
    let ancora = (ALTURA_ANCORA_CAPTURA * escala).round() as i32;
    let alvo = retangulo_captura(appbar::monitor_principal(), rc.right - rc.left, rc.bottom - rc.top, ancora);
    let _ = captura.set_position(PhysicalPosition::new(alvo.left, alvo.top));
    let _ = captura.show();
    let _ = captura.set_focus();
}

/// A captura tem a altura do cartão: a interface mede e pede, e a janela cresce para baixo,
/// com a largura sempre a do cartão. Só a própria captura pede.
#[tauri::command]
pub fn captura_altura(janela: WebviewWindow, altura: f64) {
    if janela.label() != "captura" {
        return;
    }
    let _ = janela.set_size(LogicalSize::new(LARGURA_CAPTURA, altura_captura(altura)));
}

#[tauri::command]
pub fn captura_fechar(app: AppHandle) {
    if let Some(captura) = janela(&app, "captura") {
        esconder(&captura);
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn servico_so_abre_o_painel_hoje() {
        assert_eq!(
            pedido_do_servico(r#"{"tipo":"painel","id":3,"op":"mostrar","area":"hoje"}"#),
            Ok(PedidoPainel::Mostrar { area: "hoje".into() })
        );
        assert_eq!(
            pedido_do_servico(r#"{"tipo":"painel","id":4,"op":"aberto","area":"hoje"}"#),
            Ok(PedidoPainel::Aberto { area: "hoje".into() })
        );
        assert!(pedido_do_servico(r#"{"tipo":"painel","id":5,"op":"mostrar","area":"agentes"}"#).is_err());
        assert!(pedido_do_servico(r#"{"tipo":"painel","id":6,"op":"fechar","area":"hoje"}"#).is_err());
        assert!(pedido_do_servico(r#"{"tipo":"painel","id":7,"op":"mostrar"}"#).is_err());
    }

    #[test]
    fn aberto_so_com_a_area_confirmada_pela_interface() {
        assert!(aberto_e_confirmado(true, Some("hoje"), Some("hoje"), "hoje"));
        // Visível, mas a interface ainda não desenhou o Hoje (o `painel:area` se perdeu na subida).
        assert!(!aberto_e_confirmado(true, Some("hoje"), None, "hoje"));
        // Confirmou outra área, ou a janela está escondida.
        assert!(!aberto_e_confirmado(true, Some("hoje"), Some("tarefas"), "hoje"));
        assert!(!aberto_e_confirmado(false, Some("hoje"), Some("hoje"), "hoje"));
        assert!(!aberto_e_confirmado(true, Some("tarefas"), Some("tarefas"), "hoje"));
    }

    #[test]
    fn painel_encosta_no_dock_pelo_lado_de_dentro() {
        let dock = RECT { left: 0, top: 48, right: 64, bottom: 1440 };
        let e = retangulo_painel(dock, appbar::Lado::Esquerda, 412, 0);
        assert_eq!((e.left, e.right, e.top, e.bottom), (64, 476, 48, 1440));
        let dock_d = RECT { left: 2496, top: 48, right: 2560, bottom: 1440 };
        let d = retangulo_painel(dock_d, appbar::Lado::Direita, 412, 0);
        assert_eq!((d.left, d.right), (2084, 2496));
    }

    /// O dock flutuante tem 8 px transparentes em volta do que desenha: a janela do painel entra
    /// neles e o cartão encosta no dock, sem o vão de 8 px (mais os 12 da folga) que sobrava.
    #[test]
    fn painel_encosta_no_dock_flutuante_e_nao_na_janela_dele() {
        let recuo = (dock::margem_janela(dock::Forma::Flutuante) * 1.25).round() as i32;
        assert_eq!(recuo, 10);
        // Janela do dock de 80 lógicos a 125%: 100 físicos, o dock desenhado vai de 10 a 90.
        let janela = RECT { left: 0, top: 0, right: 100, bottom: 1440 };
        let e = retangulo_painel(janela, appbar::Lado::Esquerda, largura_janela_painel(1.25), recuo);
        assert_eq!((e.left, e.right), (90, 605));
        let janela_d = RECT { left: 2460, top: 0, right: 2560, bottom: 1440 };
        let d = retangulo_painel(janela_d, appbar::Lado::Direita, largura_janela_painel(1.25), recuo);
        assert_eq!((d.left, d.right), (1955, 2470));
    }

    #[test]
    fn janela_do_painel_tem_o_cartao_de_400_mais_o_afastamento() {
        assert_eq!(largura_janela_painel(1.0), 412);
        assert_eq!(largura_janela_painel(1.25), 515);
        assert_eq!(largura_janela_painel(1.5), 618);
        assert_eq!(largura_janela_painel(2.0), 824);
    }

    /// Com sombra, o Windows põe uma moldura invisível de redimensionar em volta da janela sem
    /// decoração, e ela sai da área do WebView: a janela de 412 px dava 396 úteis e o cartão
    /// ficava com 384. O dock e o painel são posicionados pelo retângulo externo, então a área útil
    /// tem de ser a janela inteira; a sombra do cartão vem do CSS (`--sombra-painel`).
    #[test]
    fn janelas_encostadas_no_dock_nao_tem_moldura_do_windows() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let janelas = conf["app"]["windows"].as_array().unwrap();
        for rotulo in ["dock", "painel"] {
            let janela = janelas.iter().find(|j| j["label"] == rotulo).unwrap();
            assert_eq!(janela["shadow"], false, "janela {rotulo} com sombra do Windows");
            assert_eq!(janela["decorations"], false, "janela {rotulo} com decoração");
        }
        let painel = janelas.iter().find(|j| j["label"] == "painel").unwrap();
        assert_eq!(painel["width"].as_f64(), Some(LARGURA_PAINEL + MARGEM_PAINEL));
    }

    #[test]
    fn sistema_abre_so_nas_doze_areas() {
        assert_eq!(area_sistema("configuracoes"), "configuracoes");
        assert_eq!(area_sistema("ferramentas"), "ferramentas");
        assert_eq!(area_sistema("hoje"), "inicio");
        assert_eq!(area_sistema(""), "inicio");
        assert_eq!(destino_sistema("configuracoes/modelos"), "configuracoes/modelos");
        assert_eq!(destino_sistema("hoje/x"), "inicio");
        assert_eq!(destino_sistema("agentes/"), "agentes");
    }

    #[test]
    fn sistema_maior_que_a_tela_encolhe_para_a_area_util() {
        // 1920x1080 com a barra de tarefas embaixo (48) e o dock à esquerda (64).
        let area = RECT { left: 64, top: 0, right: 1920, bottom: 1032 };
        let gravado = RECT { left: 100, top: 40, right: 100 + 2252, bottom: 40 + 1750 };
        let r = retangulo_na_area_util(gravado, area);
        assert_eq!((r.left, r.top, r.right, r.bottom), (64, 0, 1920, 1032));
    }

    #[test]
    fn sistema_que_cabe_so_volta_para_dentro() {
        let area = RECT { left: 64, top: 0, right: 1920, bottom: 1032 };
        let dentro = RECT { left: 300, top: 120, right: 1500, bottom: 900 };
        assert_eq!(retangulo_na_area_util(dentro, area), dentro);
        // Gravado num monitor que saiu: mesmo tamanho, puxado para dentro da área útil.
        let fora = RECT { left: 2400, top: -50, right: 3600, bottom: 730 };
        let r = retangulo_na_area_util(fora, area);
        assert_eq!((r.left, r.top, r.right, r.bottom), (720, 0, 1920, 780));
    }

    #[test]
    fn captura_fica_centralizada_no_terco_de_cima() {
        let m = RECT { left: 0, top: 0, right: 2560, bottom: 1440 };
        let r = retangulo_captura(m, 640, 72, 72);
        assert_eq!((r.left, r.top, r.right, r.bottom), (960, 444, 1600, 516));
    }

    /// Com a prévia aberta (mais alta), o topo é o mesmo: a captura cresce para baixo.
    #[test]
    fn captura_com_previa_abre_com_o_mesmo_topo() {
        let m = RECT { left: 0, top: 0, right: 2560, bottom: 1440 };
        let r = retangulo_captura(m, 640, 300, 72);
        assert_eq!((r.left, r.top, r.right, r.bottom), (960, 444, 1600, 744));
    }

    #[test]
    fn altura_da_captura_fica_nos_limites() {
        assert_eq!(altura_captura(268.0), 268.0);
        assert_eq!(altura_captura(0.0), ALTURA_MINIMA_CAPTURA);
        assert_eq!(altura_captura(10_000.0), ALTURA_MAXIMA_CAPTURA);
        assert_eq!(altura_captura(f64::NAN), ALTURA_MINIMA_CAPTURA);
        assert_eq!(altura_captura(f64::INFINITY), ALTURA_MINIMA_CAPTURA);
    }

    /// A captura é posicionada pelo retângulo externo e o cartão ocupa a janela inteira: com a
    /// sombra do Windows, a moldura invisível tirava 16 px da largura e 30 da altura (656x81 por
    /// fora, 640x42 por dentro).
    #[test]
    fn captura_nao_tem_moldura_do_windows() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let janelas = conf["app"]["windows"].as_array().unwrap();
        let captura = janelas.iter().find(|j| j["label"] == "captura").unwrap();
        assert_eq!(captura["shadow"], false, "captura com sombra do Windows");
        assert_eq!(captura["decorations"], false, "captura com decoração");
        assert_eq!(captura["width"].as_f64(), Some(LARGURA_CAPTURA));
    }
}
