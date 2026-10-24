//! Ícone na bandeja: clique abre o Sistema; o menu mostra o dock, o time, a Ajuda e encerra o app.
//!
//! A parte do time (pausar todos ou um agente, o estado de cada um) vem pronta do serviço pelo canal
//! do sidecar (`{"tipo":"bandeja","dica","itens"}`): a casca só desenha o menu nativo e devolve o id
//! do item clicado (`{"tipo":"bandeja-clique","item"}`). A regra fica no serviço (`servico/src/bandeja`).
//! Sem serviço de pé, o menu volta aos itens fixos.
//!
//! A Ajuda (fixa) traz de volta o tour e os Primeiros passos: a casca só avisa a interface por
//! evento, e o Sistema faz o resto (`src/janelas/tour`, `PrimeirosPassos.tsx`).
//!
//! O ícone é a marca (DESIGN §7, `docs/design/marca`): branca na barra escura, preta na clara,
//! desenhada a 16, 20, 24 e 32 px para cada escala do Windows. No alto contraste vale o fundo do
//! tema. Troca sozinho quando o Windows avisa mudança de tema, de cor ou de escala.

use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::{
    image::Image,
    include_image,
    menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Runtime,
};
use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{GetSysColor, MonitorFromPoint, COLOR_WINDOW, MONITOR_DEFAULTTOPRIMARY},
        System::Registry::HKEY_CURRENT_USER,
        UI::{
            HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{WM_DISPLAYCHANGE, WM_DPICHANGED, WM_SETTINGCHANGE, WM_SYSCOLORCHANGE},
        },
    },
};

const ID: &str = "moductus";
const ID_SUBCLASSE: usize = 0x4241;
const TAMANHOS: [u32; 4] = [16, 20, 24, 32];
/// A marca branca, para a barra escura.
const CLARA: [Image<'static>; 4] = [
    include_image!("icons/bandeja/clara-16.png"),
    include_image!("icons/bandeja/clara-20.png"),
    include_image!("icons/bandeja/clara-24.png"),
    include_image!("icons/bandeja/clara-32.png"),
];
/// A marca preta, para a barra clara.
const ESCURA: [Image<'static>; 4] = [
    include_image!("icons/bandeja/escura-16.png"),
    include_image!("icons/bandeja/escura-20.png"),
    include_image!("icons/bandeja/escura-24.png"),
    include_image!("icons/bandeja/escura-32.png"),
];

static APP: OnceLock<AppHandle> = OnceLock::new();
static ATUAL: Mutex<Option<Desenho>> = Mutex::new(None);

/// Qual desenho a bandeja mostra.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Desenho {
    pub barra_clara: bool,
    pub tamanho: u32,
}

/// O desenho para o ícone pequeno pedido (16 px vezes a escala): o menor que cobre, senão o maior.
pub fn tamanho_desenhado(pedido: u32) -> u32 {
    TAMANHOS.iter().copied().find(|&t| t >= pedido).unwrap_or(TAMANHOS[TAMANHOS.len() - 1])
}

/// Se a barra de tarefas é clara. No alto contraste vale o fundo do tema (`COLOR_WINDOW`, em
/// 0x00BBGGRR), porque o `SystemUsesLightTheme` não acompanha; sem a chave, a barra é escura, como
/// no Windows 10.
pub fn barra_clara(fundo_alto_contraste: Option<u32>, sistema_claro: Option<u32>) -> bool {
    match fundo_alto_contraste {
        Some(cor) => {
            let (r, g, b) = (cor & 0xFF, (cor >> 8) & 0xFF, (cor >> 16) & 0xFF);
            2126 * r + 7152 * g + 722 * b > 10_000 * 128
        }
        None => sistema_claro == Some(1),
    }
}

/// Os avisos do Windows que podem mudar a barra (tema, alto contraste) ou a escala.
pub fn muda_a_barra(msg: u32) -> bool {
    matches!(msg, WM_SETTINGCHANGE | WM_SYSCOLORCHANGE | WM_DPICHANGED | WM_DISPLAYCHANGE)
}

fn desenho_agora() -> Desenho {
    let alto_contraste = crate::material::ler_texto(HKEY_CURRENT_USER, w!(r"Control Panel\Accessibility\HighContrast"), w!("Flags"))
        .and_then(|f| f.trim().parse::<u32>().ok())
        .is_some_and(|f| f & 1 != 0);
    let fundo = alto_contraste.then(|| unsafe { GetSysColor(COLOR_WINDOW) });
    let sistema = crate::material::ler_dword(
        HKEY_CURRENT_USER,
        w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
        w!("SystemUsesLightTheme"),
    );
    // A bandeja fica no monitor principal.
    let (mut dpi, mut _y) = (96u32, 96u32);
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut _y).is_err() || dpi == 0 {
            dpi = 96;
        }
    }
    Desenho { barra_clara: barra_clara(fundo, sistema), tamanho: tamanho_desenhado((16 * dpi + 48) / 96) }
}

fn imagem(desenho: Desenho) -> Image<'static> {
    let i = TAMANHOS.iter().position(|&t| t == desenho.tamanho).unwrap_or(0);
    if desenho.barra_clara {
        ESCURA[i].clone()
    } else {
        CLARA[i].clone()
    }
}

fn registrar(desenho: Desenho) {
    let tom = if desenho.barra_clara { "preto" } else { "branco" };
    crate::registro::info(&format!("bandeja: ícone {tom}, {} px", desenho.tamanho));
}

/// Confere o Windows de novo e troca o ícone se a barra ou a escala mudou.
fn redesenhar(app: &AppHandle) {
    let desenho = desenho_agora();
    let mut atual = ATUAL.lock().unwrap_or_else(|e| e.into_inner());
    if *atual == Some(desenho) {
        return;
    }
    *atual = Some(desenho);
    if let Some(bandeja) = app.tray_by_id(ID) {
        let _ = bandeja.set_icon(Some(imagem(desenho)));
        registrar(desenho);
    }
}

unsafe extern "system" fn subclasse(
    janela: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _dados: usize,
) -> LRESULT {
    if muda_a_barra(msg) {
        if let Some(app) = APP.get() {
            redesenhar(app);
        }
    }
    DefSubclassProc(janela, msg, wparam, lparam)
}
const DICA: &str = "Moductus";
/// Prefixo dos itens que vieram do serviço: o clique neles volta ao serviço sem o prefixo.
const DO_SERVICO: &str = "servico:";
/// Itens da Ajuda: o id do menu e o evento que ele manda à interface.
const AJUDA: [(&str, &str, &str); 2] = [
    ("ajuda-tour", "Ver o tour", "tutorial:tour"),
    ("ajuda-primeiros-passos", "Primeiros passos", "tutorial:rever"),
];

/// O evento que um item da Ajuda manda à interface, se o clique foi num deles.
pub fn evento_da_ajuda(id: &str) -> Option<&'static str> {
    AJUDA.iter().find(|(item, _, _)| *item == id).map(|(_, _, evento)| *evento)
}

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

/// Cria o ícone e escuta os avisos do Windows pela janela do dock (sempre viva), na thread dela.
pub fn iniciar(app: &AppHandle, hwnd: isize) -> tauri::Result<()> {
    let menu = montar(app, &MenuServico::default())?;
    let desenho = desenho_agora();
    *ATUAL.lock().unwrap_or_else(|e| e.into_inner()) = Some(desenho);
    TrayIconBuilder::with_id(ID)
        .icon(imagem(desenho))
        .tooltip(DICA)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id.as_ref() {
            "sistema" => crate::janelas::sistema_alternar(app.clone()),
            "dock" => crate::dock::alternar_visivel(),
            "sair" => app.exit(0),
            outro => {
                if let Some(evento) = evento_da_ajuda(outro) {
                    // Os Primeiros passos ficam no Início: o Sistema abre lá antes de trazê-los.
                    if evento == "tutorial:rever" {
                        crate::janelas::sistema_abrir(app.clone(), "inicio".to_string());
                    }
                    let _ = app.emit(evento, ());
                } else if let Some(item) = id_do_servico(outro) {
                    crate::servico::avisar(serde_json::json!({ "tipo": "bandeja-clique", "item": item }));
                }
            }
        })
        .on_tray_icon_event(|icone, evento| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evento {
                crate::janelas::sistema_alternar(icone.app_handle().clone());
            }
        })
        .build(app)?;
    registrar(desenho);
    let _ = APP.set(app.clone());
    unsafe {
        let _ = SetWindowSubclass(HWND(hwnd as _), Some(subclasse), ID_SUBCLASSE, 0);
    }
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

/// Os fixos da casca em volta dos itens do serviço: abrir o Sistema e o dock em cima, a Ajuda e
/// sair embaixo.
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
    let ajuda = AJUDA
        .iter()
        .map(|(id, rotulo, _)| MenuItem::with_id(app, *id, *rotulo, true, None::<&str>).map(|i| i.kind()))
        .collect::<tauri::Result<Vec<_>>>()?;
    itens.push(Submenu::with_id_and_items(app, "ajuda", "Ajuda", true, &referencias(&ajuda))?.kind());
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
    fn ajuda_traz_o_tour_e_os_primeiros_passos_pela_interface() {
        assert_eq!(evento_da_ajuda("ajuda-tour"), Some("tutorial:tour"));
        assert_eq!(evento_da_ajuda("ajuda-primeiros-passos"), Some("tutorial:rever"));
        assert_eq!(evento_da_ajuda("ajuda"), None);
        // Item do serviço com o mesmo nome não vira Ajuda: chega com o prefixo.
        assert_eq!(evento_da_ajuda("servico:ajuda-tour"), None);
    }

    #[test]
    fn icone_preto_so_na_barra_clara_e_no_alto_contraste_de_fundo_claro() {
        assert!(barra_clara(None, Some(1)));
        assert!(!barra_clara(None, Some(0)));
        // Sem a chave, como no Windows 10: barra escura.
        assert!(!barra_clara(None, None));
        // Alto contraste manda mais que o tema: Aquático (fundo preto) e Deserto (fundo claro).
        assert!(!barra_clara(Some(0x000000), Some(1)));
        assert!(barra_clara(Some(0xEFFAFF), Some(0)));
    }

    #[test]
    fn cada_escala_usa_o_desenho_que_cobre_o_icone_pequeno() {
        assert_eq!(tamanho_desenhado(16), 16);
        assert_eq!(tamanho_desenhado(20), 20);
        assert_eq!(tamanho_desenhado(24), 24);
        // 175% pede 28: o de 32 reduzido, nunca o de 24 ampliado.
        assert_eq!(tamanho_desenhado(28), 32);
        assert_eq!(tamanho_desenhado(48), 32);
        assert_eq!(tamanho_desenhado(12), 16);
    }

    #[test]
    fn os_desenhos_tem_o_tamanho_do_nome() {
        for (i, t) in TAMANHOS.iter().enumerate() {
            assert_eq!((CLARA[i].width(), CLARA[i].height()), (*t, *t));
            assert_eq!((ESCURA[i].width(), ESCURA[i].height()), (*t, *t));
        }
    }

    #[test]
    fn so_avisos_de_tema_cor_e_escala_redesenham() {
        assert!(muda_a_barra(WM_SETTINGCHANGE));
        assert!(muda_a_barra(WM_SYSCOLORCHANGE));
        assert!(muda_a_barra(WM_DPICHANGED));
        assert!(!muda_a_barra(windows::Win32::UI::WindowsAndMessaging::WM_POWERBROADCAST));
    }

    #[test]
    fn e_comercial_e_tab_nao_viram_atalho_no_menu_do_windows() {
        assert_eq!(rotulo_nativo("Tula & Faina"), "Tula && Faina");
        assert_eq!(rotulo_nativo("Nuno\tativo"), "Nuno ativo");
        assert_eq!(rotulo_nativo("Alba: pausado até 15:00"), "Alba: pausado até 15:00");
    }
}
