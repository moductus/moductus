//! Painel, Sistema e captura. Todas são criadas no início (tauri.conf.json) e só
//! aparecem ou somem aqui, para abrirem sem atraso.
//!
//! - painel: ao lado do dock, sem ativar; ganha foco só quando a interface pede
//!   (campo de texto);
//! - Sistema: janela normal que lembra posição e tamanho; fechar esconde;
//! - captura: centralizada no monitor principal, ganha foco e some ao perdê-lo.

use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    UI::WindowsAndMessaging::{
        GetWindowRect, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SW_SHOWNOACTIVATE,
    },
};

use crate::{appbar, dock};

/// Largura do painel lateral em pixels lógicos (DESIGN §3: 368–372 px).
pub const LARGURA_PAINEL: f64 = 372.0;

static PAINEL: Mutex<Option<(String, Instant)>> = Mutex::new(None);
static ARQUIVO_SISTEMA: OnceLock<PathBuf> = OnceLock::new();

fn janela(app: &AppHandle, rotulo: &str) -> Option<WebviewWindow> {
    app.get_webview_window(rotulo)
}

fn hwnd(janela: &WebviewWindow) -> HWND {
    HWND(dock::hwnd_de(janela) as _)
}

pub fn iniciar(app: &AppHandle, pasta: PathBuf) {
    if let Some(painel) = janela(app, "painel") {
        dock::sem_ativar(dock::hwnd_de(&painel));
    }
    let arquivo = ARQUIVO_SISTEMA.get_or_init(|| pasta.join("sistema.json"));
    if let (Some(sistema), Some(pos)) = (janela(app, "sistema"), ler_posicao(arquivo)) {
        let _ = sistema.set_size(PhysicalSize::new(pos.largura, pos.altura));
        let _ = sistema.set_position(PhysicalPosition::new(pos.x, pos.y));
    }
}

// ---------- painel ----------

/// Retângulo do painel encostado no dock, do lado de dentro da tela.
pub fn retangulo_painel(dock: RECT, lado: appbar::Lado, largura: i32) -> RECT {
    match lado {
        appbar::Lado::Esquerda => RECT { left: dock.right, top: dock.top, right: dock.right + largura, bottom: dock.bottom },
        appbar::Lado::Direita => RECT { left: dock.left - largura, top: dock.top, right: dock.left, bottom: dock.bottom },
    }
}

/// Abre o painel de uma área ao lado do dock; a mesma área de novo fecha.
#[tauri::command]
pub fn painel_abrir(app: AppHandle, area: String) {
    let (Some(painel), Some(janela_dock)) = (janela(&app, "painel"), janela(&app, "dock")) else { return };
    let aberta = PAINEL.lock().unwrap().as_ref().map(|(a, _)| a.clone());
    if aberta.as_deref() == Some(area.as_str()) && painel.is_visible().unwrap_or(false) {
        painel_fechar(app);
        return;
    }
    *PAINEL.lock().unwrap() = Some((area.clone(), Instant::now()));

    let mut rd = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd(&janela_dock), &mut rd);
    }
    let largura = (LARGURA_PAINEL * appbar::escala(dock::hwnd_de(&janela_dock))).round() as i32;
    let rc = retangulo_painel(rd, dock::configuracao().lado, largura);
    let _ = painel.emit("painel:area", &area);
    unsafe {
        let h = hwnd(&painel);
        let _ = SetWindowPos(h, Some(HWND_TOPMOST), rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, SWP_NOACTIVATE);
        let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
    }
}

#[tauri::command]
pub fn painel_fechar(app: AppHandle) {
    if let Some(painel) = janela(&app, "painel") {
        let _ = painel.hide();
        dock::sem_ativar(dock::hwnd_de(&painel));
    }
    *PAINEL.lock().unwrap() = None;
    // O dock tira a marca da área aberta.
    let _ = app.emit("painel:fechado", ());
}

/// A interface do painel avisa que desenhou a área: fecha a medição de abertura.
#[tauri::command]
pub fn painel_pronto(area: String) -> Option<f64> {
    let guarda = PAINEL.lock().unwrap();
    let (aberta, inicio) = guarda.as_ref()?;
    if *aberta != area {
        return None;
    }
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
    let _ = sistema.show();
    let _ = sistema.set_focus();
    let _ = sistema.emit_to("sistema", "sistema:ir", &area);
    crate::registro::info(&format!("sistema aberto em {area}"));
}

// ---------- captura ----------

/// Centraliza a captura no monitor principal, um pouco acima do meio.
pub fn retangulo_captura(monitor: RECT, largura: i32, altura: i32) -> RECT {
    let x = monitor.left + (monitor.right - monitor.left - largura) / 2;
    let y = monitor.top + (monitor.bottom - monitor.top) / 3 - altura / 2;
    RECT { left: x, top: y, right: x + largura, bottom: y + altura }
}

#[tauri::command]
pub fn captura_alternar(app: AppHandle) {
    let Some(captura) = janela(&app, "captura") else { return };
    if captura.is_visible().unwrap_or(false) {
        let _ = captura.hide();
        return;
    }
    let mut rc = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd(&captura), &mut rc);
    }
    let alvo = retangulo_captura(appbar::monitor_principal(), rc.right - rc.left, rc.bottom - rc.top);
    let _ = captura.set_position(PhysicalPosition::new(alvo.left, alvo.top));
    let _ = captura.show();
    let _ = captura.set_focus();
}

#[tauri::command]
pub fn captura_fechar(app: AppHandle) {
    if let Some(captura) = janela(&app, "captura") {
        let _ = captura.hide();
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn painel_encosta_no_dock_pelo_lado_de_dentro() {
        let dock = RECT { left: 0, top: 48, right: 64, bottom: 1440 };
        let e = retangulo_painel(dock, appbar::Lado::Esquerda, 372);
        assert_eq!((e.left, e.right, e.top, e.bottom), (64, 436, 48, 1440));
        let dock_d = RECT { left: 2496, top: 48, right: 2560, bottom: 1440 };
        let d = retangulo_painel(dock_d, appbar::Lado::Direita, 372);
        assert_eq!((d.left, d.right), (2124, 2496));
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
    fn captura_fica_centralizada_no_terco_de_cima() {
        let m = RECT { left: 0, top: 0, right: 2560, bottom: 1440 };
        let r = retangulo_captura(m, 640, 72);
        assert_eq!((r.left, r.top, r.right, r.bottom), (960, 444, 1600, 516));
    }
}
