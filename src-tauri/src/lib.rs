mod acessibilidade;
// O serviço chega aqui pelo canal do sidecar, como às credenciais.
mod ambiente;
mod appbar;
mod atalhos;
mod config_nativa;
mod controles;
// O serviço chega aqui pelo canal do sidecar; nenhuma janela tem comando para isso.
mod credenciais;
mod bandeja;
mod dados;
mod dock;
mod inicio;
mod janelas;
mod material;
mod midia;
// O serviço chega aqui pelo canal do sidecar; o clique no aviso volta pelo mesmo canal.
mod notificacao;
mod registro;
mod servico;
mod tela_cheia;

use tauri::{Manager, RunEvent, WindowEvent};

/// Janelas criadas no início, todas servindo o mesmo bundle: o dock aparece, as outras
/// ficam escondidas para abrirem sem atraso (e nascem depois do dock, em `janelas::criar`).
pub const JANELAS: [&str; 4] = ["dock", "painel", "sistema", "captura"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pasta = dados::pasta();
    registro::iniciar(&pasta);
    appbar::iniciar(pasta.clone());

    tauri::Builder::default()
        // A instância única vem antes de tudo: a segunda execução sai sem criar janelas.
        .plugin(inicio::instancia_unica())
        .plugin(inicio::autostart())
        .plugin(atalhos::plugin())
        // "Salvar como" e "Abrir" do Windows para o arquivo .moductus (Levar para outro PC).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![dock::dock_configuracao, dock::dock_aplicar, registro::interface_registro,
            janelas::painel_abrir,
            janelas::painel_fechar,
            janelas::painel_pronto,
            janelas::painel_foco,
            janelas::sistema_alternar,
            janelas::sistema_abrir,
            dock::dock_soltar_foco,
            janelas::captura_alternar,
            janelas::captura_fechar,
            atalhos::atalhos_obter,
            atalhos::atalhos_definir,
            atalhos::atalhos_falhas,
            inicio::autostart_obter,
            inicio::autostart_definir,
            midia::midia_estado,
            midia::midia_alternar,
            midia::midia_proxima,
            midia::midia_anterior,
            controles::mic_estado,
            controles::mic_alternar,
            controles::awake_estado,
            controles::awake_definir,
            servico::servico_estado,
            material::tema_material,
            acessibilidade::acessibilidade_estado,
        ])
        .setup(move |app| {
            // Só o dock nasce antes do setup: a faixa fica reservada antes de painel,
            // Sistema e captura criarem os seus WebViews (orçamento de 1 s até o dock).
            let janela_dock = app.get_webview_window("dock").ok_or("janela dock ausente na configuração")?;
            dock::iniciar(&janela_dock, dock::Configuracao::default());
            acessibilidade::iniciar(app.handle().clone(), dock::hwnd_de(&janela_dock));
            janelas::criar(app.handle())?;
            for rotulo in JANELAS {
                if app.get_webview_window(rotulo).is_none() {
                    return Err(format!("janela {rotulo} ausente na configuração").into());
                }
            }
            janelas::iniciar(app.handle(), pasta.clone());
            tela_cheia::vigiar(app.handle().clone());
            notificacao::iniciar(app.handle());
            atalhos::iniciar(app.handle(), atalhos::padrao());
            bandeja::iniciar(app.handle())?;
            midia::iniciar(app.handle().clone());
            controles::iniciar(app.handle().clone());
            servico::iniciar(app.handle().clone(), pasta.clone());
            Ok(())
        })
        .on_window_event(|janela, evento| {
            // O dock é a presença do app: fechá-lo encerra o Moductus.
            match (janela.label(), evento) {
                ("dock", WindowEvent::CloseRequested { .. }) => janela.app_handle().exit(0),
                // Fechar o Sistema só esconde: ele abre de novo sem atraso.
                ("sistema", WindowEvent::CloseRequested { api, .. }) => {
                    api.prevent_close();
                    let _ = janela.hide();
                }
                ("sistema", WindowEvent::Moved(_) | WindowEvent::Resized(_)) => {
                    if let Some(sistema) = janela.app_handle().get_webview_window("sistema") {
                        janelas::sistema_mudou(&sistema);
                    }
                }
                ("captura", WindowEvent::Focused(false)) => {
                    let _ = janela.hide();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Moductus")
        .run(|_app, evento| {
            if let RunEvent::Exit = evento {
                appbar::encerrar();
                controles::encerrar();
                servico::encerrar();
            }
        });
}
