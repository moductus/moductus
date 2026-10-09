//! Instância única e início com o Windows (plugins oficiais).
//!
//! Uma segunda execução não abre outro Moductus: ela entrega os argumentos à primeira,
//! que abre o Sistema em primeiro plano. Com o Moductus rodando, `--autostart
//! ligar|desligar` liga ou desliga o início com o Windows sem abrir nada.

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

pub fn instancia_unica() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, argumentos, _pasta| {
        if let Some(ligar) = pedido_autostart(&argumentos) {
            let _ = autostart_definir(app.clone(), ligar);
            return;
        }
        crate::registro::info("segunda execução: focando a primeira");
        if let Some(sistema) = app.get_webview_window("sistema") {
            let _ = sistema.unminimize();
            let _ = sistema.show();
            let _ = sistema.set_focus();
        }
    })
}

pub fn autostart() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new().app_name("Moductus").build()
}

pub fn pedido_autostart(argumentos: &[String]) -> Option<bool> {
    let i = argumentos.iter().position(|a| a == "--autostart")?;
    match argumentos.get(i + 1).map(String::as_str) {
        Some("ligar") => Some(true),
        Some("desligar") => Some(false),
        _ => None,
    }
}

#[tauri::command]
pub fn autostart_obter(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn autostart_definir(app: AppHandle, ligar: bool) -> Result<bool, String> {
    let gerente = app.autolaunch();
    let resultado = if ligar { gerente.enable() } else { gerente.disable() };
    resultado.map_err(|e| format!("não foi possível mudar o início com o Windows: {e}"))?;
    let ligado = gerente.is_enabled().unwrap_or(false);
    crate::registro::info(&format!("autostart: {}", if ligado { "ligado" } else { "desligado" }));
    Ok(ligado)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn le_o_pedido_de_autostart_da_linha_de_comando() {
        assert_eq!(pedido_autostart(&args(&["moductus.exe", "--autostart", "ligar"])), Some(true));
        assert_eq!(pedido_autostart(&args(&["moductus.exe", "--autostart", "desligar"])), Some(false));
        assert_eq!(pedido_autostart(&args(&["moductus.exe"])), None);
        assert_eq!(pedido_autostart(&args(&["moductus.exe", "--autostart", "talvez"])), None);
    }
}
