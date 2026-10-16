//! Ícone na bandeja: clique abre o Sistema; o menu mostra o dock, o time e encerra o app.
//!
//! A parte do time (pausar todos ou um agente, o estado de cada um) vem pronta do serviço pelo canal
//! do sidecar (`{"tipo":"bandeja","dica","itens"}`): a casca só desenha o menu nativo e devolve o id
//! do item clicado (`{"tipo":"bandeja-clique","item"}`). A regra fica no serviço (`servico/src/bandeja`).
//! Sem serviço de pé, o menu volta aos itens fixos.

use serde::Deserialize;
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Runtime,
};

const ID: &str = "moductus";
const DICA: &str = "Moductus";
/// Prefixo dos itens que vieram do serviço: o clique neles volta ao serviço sem o prefixo.
const DO_SERVICO: &str = "servico:";

/// O menu que o serviço manda.
#[derive(Debug, Default, Deserialize, PartialEq)]
pub struct MenuServico {
    #[serde(default)]
    pub dica: Option<String>,
    #[serde(default)]
    pub itens: Vec<Item>,
}

/// Um item do serviço: separador ou opção, com submenu quando tem `itens`.
#[derive(Debug, Deserialize, PartialEq)]
pub struct Item {
    #[serde(default)]
    pub separador: bool,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub rotulo: String,
    #[serde(default = "sim")]
    pub habilitado: bool,
    #[serde(default)]
    pub itens: Option<Vec<Item>>,
}

fn sim() -> bool {
    true
}

/// O texto como o menu do Windows mostra: `&` marca a tecla de atalho e tab separa o atalho,
/// então nome de agente com `&` precisa dobrar e tab vira espaço.
pub fn rotulo_nativo(texto: &str) -> String {
    texto.replace('&', "&&").replace('\t', " ")
}

/// O id do item do serviço, se o clique foi num deles.
pub fn id_do_servico(id: &str) -> Option<&str> {
    id.strip_prefix(DO_SERVICO).filter(|resto| !resto.is_empty())
}

pub fn iniciar(app: &AppHandle) -> tauri::Result<()> {
    let menu = montar(app, &MenuServico::default())?;
    let mut bandeja = TrayIconBuilder::with_id(ID)
        .tooltip(DICA)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id.as_ref() {
            "sistema" => crate::janelas::sistema_alternar(app.clone()),
            "dock" => crate::dock::alternar_visivel(),
            "sair" => app.exit(0),
            outro => {
                if let Some(item) = id_do_servico(outro) {
                    crate::servico::avisar(serde_json::json!({ "tipo": "bandeja-clique", "item": item }));
                }
            }
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

/// Redesenha o menu com o que o serviço mandou (a linha inteira do canal).
pub fn atualizar(app: &AppHandle, linha: &str) {
    match serde_json::from_str::<MenuServico>(linha) {
        Ok(menu) => aplicar(app, &menu),
        Err(e) => crate::registro::info(&format!("bandeja: menu do serviço inválido: {e}")),
    }
}

/// O serviço saiu: o menu do time some até o próximo subir e mandar o dele.
pub fn sem_servico(app: &AppHandle) {
    aplicar(app, &MenuServico::default());
}

fn aplicar(app: &AppHandle, menu: &MenuServico) {
    let Some(bandeja) = app.tray_by_id(ID) else { return };
    match montar(app, menu) {
        Ok(nativo) => {
            let _ = bandeja.set_menu(Some(nativo));
            let dica = menu.dica.as_deref().filter(|d| !d.is_empty()).unwrap_or(DICA);
            let _ = bandeja.set_tooltip(Some(dica));
        }
        Err(e) => crate::registro::info(&format!("bandeja: menu não montado: {e}")),
    }
}

/// Os fixos da casca em volta dos itens do serviço: abrir o Sistema e o dock em cima, sair embaixo.
fn montar<R: Runtime>(app: &AppHandle<R>, menu: &MenuServico) -> tauri::Result<Menu<R>> {
    let mut itens: Vec<MenuItemKind<R>> = vec![
        MenuItem::with_id(app, "sistema", "Abrir o Sistema", true, None::<&str>)?.kind(),
        MenuItem::with_id(app, "dock", "Mostrar ou esconder o dock", true, None::<&str>)?.kind(),
    ];
    if !menu.itens.is_empty() {
        itens.push(PredefinedMenuItem::separator(app)?.kind());
        itens.extend(nativos(app, &menu.itens)?);
    }
    itens.push(PredefinedMenuItem::separator(app)?.kind());
    itens.push(MenuItem::with_id(app, "sair", "Sair do Moductus", true, None::<&str>)?.kind());
    Menu::with_items(app, &referencias(&itens))
}

fn nativos<R: Runtime>(app: &AppHandle<R>, itens: &[Item]) -> tauri::Result<Vec<MenuItemKind<R>>> {
    let mut saida = Vec::with_capacity(itens.len());
    for item in itens {
        if item.separador {
            saida.push(PredefinedMenuItem::separator(app)?.kind());
            continue;
        }
        let id = format!("{DO_SERVICO}{}", item.id);
        let rotulo = rotulo_nativo(&item.rotulo);
        match &item.itens {
            Some(filhos) => {
                let filhos = nativos(app, filhos)?;
                saida.push(Submenu::with_id_and_items(app, id, rotulo, item.habilitado, &referencias(&filhos))?.kind());
            }
            None => saida.push(MenuItem::with_id(app, id, rotulo, item.habilitado, None::<&str>)?.kind()),
        }
    }
    Ok(saida)
}

fn referencias<R: Runtime>(itens: &[MenuItemKind<R>]) -> Vec<&dyn IsMenuItem<R>> {
    itens.iter().map(|i| i as &dyn IsMenuItem<R>).collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_o_menu_do_servico_com_submenu_e_separador() {
        let linha = r#"{"tipo":"bandeja","dica":"Moductus: Tula em pausa","itens":[
            {"id":"pausar-todos","rotulo":"Pausar todos os agentes","habilitado":true,"itens":[
                {"id":"pausar:*:30min","rotulo":"Por 30 minutos","habilitado":true}]},
            {"separador":true},
            {"id":"agente:nuno","rotulo":"Nuno: desligado","habilitado":false}]}"#;
        let menu: MenuServico = serde_json::from_str(linha).unwrap();
        assert_eq!(menu.dica.as_deref(), Some("Moductus: Tula em pausa"));
        assert_eq!(menu.itens.len(), 3);
        let filhos = menu.itens[0].itens.as_ref().unwrap();
        assert_eq!(filhos[0].id, "pausar:*:30min");
        assert!(filhos[0].habilitado);
        assert!(menu.itens[1].separador);
        assert!(!menu.itens[2].habilitado);
        assert!(menu.itens[2].itens.is_none());
    }

    #[test]
    fn so_o_clique_num_item_do_servico_volta_ao_servico() {
        assert_eq!(id_do_servico("servico:pausar:alba:1h"), Some("pausar:alba:1h"));
        assert_eq!(id_do_servico("servico:"), None);
        assert_eq!(id_do_servico("sair"), None);
        assert_eq!(id_do_servico("pausar:alba:1h"), None);
    }

    #[test]
    fn e_comercial_e_tab_nao_viram_atalho_no_menu_do_windows() {
        assert_eq!(rotulo_nativo("Tula & Faina"), "Tula && Faina");
        assert_eq!(rotulo_nativo("Nuno\tativo"), "Nuno ativo");
        assert_eq!(rotulo_nativo("Alba: pausado até 15:00"), "Alba: pausado até 15:00");
    }
}
