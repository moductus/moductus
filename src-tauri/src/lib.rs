use tauri::Manager;

/// Janelas criadas no início, todas servindo o mesmo bundle: o dock aparece, as outras
/// ficam escondidas para abrirem sem atraso.
pub const JANELAS: [&str; 4] = ["dock", "painel", "sistema", "captura"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            for rotulo in JANELAS {
                if app.get_webview_window(rotulo).is_none() {
                    return Err(format!("janela {rotulo} ausente na configuração").into());
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Moductus");
}
