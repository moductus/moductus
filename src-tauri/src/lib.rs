mod appbar;
mod dados;
mod dock;
mod registro;

use tauri::{Manager, RunEvent, WindowEvent};

/// Janelas criadas no início, todas servindo o mesmo bundle: o dock aparece, as outras
/// ficam escondidas para abrirem sem atraso.
pub const JANELAS: [&str; 4] = ["dock", "painel", "sistema", "captura"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pasta = dados::pasta();
    registro::iniciar(&pasta);
    appbar::iniciar(pasta);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dock::dock_configuracao, dock::dock_aplicar])
        .setup(|app| {
            for rotulo in JANELAS {
                if app.get_webview_window(rotulo).is_none() {
                    return Err(format!("janela {rotulo} ausente na configuração").into());
                }
            }
            let janela_dock = app.get_webview_window("dock").expect("janela dock");
            dock::iniciar(&janela_dock, dock::Configuracao::default());
            Ok(())
        })
        .on_window_event(|janela, evento| {
            // O dock é a presença do app: fechá-lo encerra o Moductus.
            if janela.label() == "dock" && matches!(evento, WindowEvent::CloseRequested { .. }) {
                janela.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Moductus")
        .run(|_app, evento| {
            if let RunEvent::Exit = evento {
                appbar::encerrar();
            }
        });
}
