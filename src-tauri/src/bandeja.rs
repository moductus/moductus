//! Ícone na bandeja: clique abre o Sistema; o menu mostra o dock e encerra o app.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

pub fn iniciar(app: &AppHandle) -> tauri::Result<()> {
    let sistema = MenuItem::with_id(app, "sistema", "Abrir o Sistema", true, None::<&str>)?;
    let dock = MenuItem::with_id(app, "dock", "Mostrar ou esconder o dock", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair do Moductus", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&sistema, &dock, &sair])?;

    let mut bandeja = TrayIconBuilder::with_id("moductus")
        .tooltip("Moductus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id.as_ref() {
            "sistema" => crate::janelas::sistema_alternar(app.clone()),
            "dock" => crate::dock::alternar_visivel(),
            "sair" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|icone, evento| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evento {
                crate::janelas::sistema_alternar(icone.app_handle().clone());
            }
        });
    if let Some(icone) = app.default_window_icon() {
        bandeja = bandeja.icon(icone.clone());
    }
    bandeja.build(app)?;
    Ok(())
}
