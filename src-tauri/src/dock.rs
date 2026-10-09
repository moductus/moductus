//! O dock: estilo da janela, lado, modo e forma.
//!
//! - **fixo**: AppBar, reserva a faixa (módulo appbar);
//! - **esconder**: sem reserva; fica uma faixa fina na borda que revela o dock quando o
//!   mouse encosta e recolhe quando ele sai;
//! - **inteligente**: fixo, e some em tela cheia (vigia de tela cheia).
//!
//! A forma (colada ou flutuante) muda a largura da janela: a flutuante tem margem em
//! volta, e a interface desenha o dock arredondado dentro dela.

use std::{
    sync::{
        atomic::{AtomicBool, AtomicIsize, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, IsWindow, IsWindowVisible, SetForegroundWindow, SetWindowLongPtrW,
        SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_NOTOPMOST,
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    },
};

use crate::appbar::{self, Lado};

/// Largura do dock em pixels lógicos (DESIGN §3: 64–68 px).
pub const LARGURA: f64 = 64.0;
/// Margem em volta do dock flutuante.
pub const MARGEM_FLUTUANTE: f64 = 8.0;
/// Faixa que fica na borda no modo esconder; encostar o mouse nela revela o dock.
pub const FAIXA_ESCONDIDA: f64 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modo {
    Fixo,
    Esconder,
    Inteligente,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Forma {
    Colada,
    Flutuante,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Configuracao {
    pub lado: Lado,
    pub modo: Modo,
    pub forma: Forma,
}

impl Default for Configuracao {
    fn default() -> Self {
        Configuracao { lado: Lado::Esquerda, modo: Modo::Fixo, forma: Forma::Colada }
    }
}

struct Estado {
    hwnd: isize,
    app: AppHandle,
    config: Configuracao,
    /// No modo esconder: o dock está aberto (largura cheia) ou recolhido na faixa.
    revelado: bool,
    tela_cheia: bool,
}

static ESTADO: Mutex<Option<Estado>> = Mutex::new(None);
static VIGIA_BORDA: AtomicBool = AtomicBool::new(false);
/// Modo teclado: o dock está ativável e com o foco, dado pelo Ctrl+Alt+D.
static TECLADO: AtomicBool = AtomicBool::new(false);
/// Janela que tinha o foco antes do modo teclado; o Esc devolve o foco a ela.
static ANTERIOR: AtomicIsize = AtomicIsize::new(0);

pub fn hwnd_de(janela: &WebviewWindow) -> isize {
    janela.hwnd().map(|h| h.0 as isize).unwrap_or_default()
}

/// Clicar no dock não tira o foco da janela atual, e ele fica fora do Alt+Tab.
pub fn sem_ativar(hwnd: isize) {
    let h = HWND(hwnd as _);
    unsafe {
        let estilo = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, estilo | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize);
    }
}

/// Devolve a ativação a uma janela que estava sem ativar (painel com campo de texto).
pub fn com_ativar(hwnd: isize) {
    let h = HWND(hwnd as _);
    unsafe {
        let estilo = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, estilo & !(WS_EX_NOACTIVATE.0 as isize));
    }
}

/// Largura lógica da janela do dock para a forma escolhida.
pub fn largura_janela(forma: Forma) -> f64 {
    match forma {
        Forma::Colada => LARGURA,
        Forma::Flutuante => LARGURA + 2.0 * MARGEM_FLUTUANTE,
    }
}

pub fn iniciar(janela: &WebviewWindow, config: Configuracao) {
    let hwnd = hwnd_de(janela);
    sem_ativar(hwnd);
    appbar::acompanhar(hwnd, config.lado, largura_janela(config.forma));
    *ESTADO.lock().unwrap() = Some(Estado { hwnd, app: janela.app_handle().clone(), config, revelado: false, tela_cheia: false });
    aplicar(config);
}

pub fn app() -> Option<AppHandle> {
    ESTADO.lock().unwrap().as_ref().map(|e| e.app.clone())
}

pub fn configuracao() -> Configuracao {
    ESTADO.lock().unwrap().as_ref().map(|e| e.config).unwrap_or_default()
}

/// Aplica lado, modo e forma na hora, sem reiniciar.
pub fn aplicar(config: Configuracao) {
    let app = {
        let mut guarda = ESTADO.lock().unwrap();
        let Some(estado) = guarda.as_mut() else { return };
        estado.config = config;
        estado.revelado = false;
        estado.app.clone()
    };
    let largura = largura_janela(config.forma);
    appbar::definir(config.lado, largura);
    match config.modo {
        Modo::Fixo | Modo::Inteligente => {
            VIGIA_BORDA.store(false, Ordering::SeqCst);
            appbar::registrar();
        }
        Modo::Esconder => {
            appbar::soltar();
            recolher();
            vigiar_borda();
        }
    }
    let _ = app.emit("dock:configuracao", config);
    crate::registro::info(&format!("dock: {config:?}"));
}

pub fn trocar_lado(lado: Lado) {
    aplicar(Configuracao { lado, ..configuracao() });
}

fn posicionar(hwnd: isize, rc: RECT) {
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd as _),
            Some(HWND_TOPMOST),
            rc.left,
            rc.top,
            rc.right - rc.left,
            rc.bottom - rc.top,
            SWP_NOACTIVATE,
        );
    }
}

fn geometria(revelado: bool) -> Option<(isize, RECT)> {
    let guarda = ESTADO.lock().unwrap();
    let estado = guarda.as_ref()?;
    let escala = appbar::escala(estado.hwnd);
    let logica = if revelado { largura_janela(estado.config.forma) } else { FAIXA_ESCONDIDA };
    let largura = (logica * escala).round().max(1.0) as i32;
    Some((estado.hwnd, appbar::faixa(appbar::monitor_principal(), estado.config.lado, largura)))
}

fn recolher() {
    if let Some((hwnd, rc)) = geometria(false) {
        posicionar(hwnd, rc);
    }
}

fn revelar() {
    if let Some((hwnd, rc)) = geometria(true) {
        posicionar(hwnd, rc);
    }
}

/// Decide, pela posição do cursor, se o dock escondido deve abrir ou recolher.
pub fn decidir_revelado(revelado: bool, cursor_x: i32, faixa: RECT, aberto: RECT) -> bool {
    if revelado {
        cursor_x >= aberto.left && cursor_x < aberto.right
    } else {
        cursor_x >= faixa.left && cursor_x < faixa.right
    }
}

/// Acompanha o cursor só enquanto o modo esconder está ligado (consulta a cada 50 ms:
/// o Windows não avisa quando o mouse encosta numa janela de 2 px).
fn vigiar_borda() {
    if VIGIA_BORDA.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(|| {
        while VIGIA_BORDA.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));
            // No modo teclado o dock fica aberto onde quer que o mouse esteja.
            if TECLADO.load(Ordering::SeqCst) {
                continue;
            }
            let (Some((_, faixa)), Some((_, aberto))) = (geometria(false), geometria(true)) else { continue };
            let mut cursor = POINT::default();
            if unsafe { GetCursorPos(&mut cursor) }.is_err() || cursor.y < aberto.top || cursor.y >= aberto.bottom {
                continue;
            }
            let atual = ESTADO.lock().unwrap().as_ref().map(|e| e.revelado).unwrap_or(false);
            let novo = decidir_revelado(atual, cursor.x, faixa, aberto);
            if novo != atual {
                if let Some(e) = ESTADO.lock().unwrap().as_mut() {
                    e.revelado = novo;
                }
                if novo {
                    revelar()
                } else {
                    recolher()
                }
            }
        }
    });
}

/// Em tela cheia: o inteligente e o esconder somem por completo; o fixo fica atrás do
/// app em tela cheia (perde o "sempre no topo"), como a barra de tarefas faz.
pub fn tela_cheia(cheia: bool) {
    let (hwnd, modo) = {
        let mut guarda = ESTADO.lock().unwrap();
        let Some(estado) = guarda.as_mut() else { return };
        estado.tela_cheia = cheia;
        (estado.hwnd, estado.config.modo)
    };
    let h = HWND(hwnd as _);
    unsafe {
        match (modo, cheia) {
            (Modo::Fixo, _) => {
                let ordem = if cheia { HWND_NOTOPMOST } else { HWND_TOPMOST };
                let _ = SetWindowPos(h, Some(ordem), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            (_, true) => {
                let _ = ShowWindow(h, SW_HIDE);
            }
            (_, false) => {
                let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
            }
        }
    }
}

/// Onde o dock está no ciclo do Ctrl+Alt+D.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presenca {
    Escondido,
    /// Na tela, sem ativar: clicar nele não tira o foco de ninguém.
    Visivel,
    /// Modo teclado: ativável e com o foco, as setas andam pelos botões.
    Focado,
}

pub fn presenca(visivel: bool, focado: bool) -> Presenca {
    match (visivel, focado) {
        (false, _) => Presenca::Escondido,
        (true, false) => Presenca::Visivel,
        (true, true) => Presenca::Focado,
    }
}

/// Ctrl+Alt+D cicla: escondido → visível → com foco → escondido. Assim o dock, que nunca
/// ativa com o mouse, é alcançável só pelo teclado.
pub fn proxima_presenca(atual: Presenca) -> Presenca {
    match atual {
        Presenca::Escondido => Presenca::Visivel,
        Presenca::Visivel => Presenca::Focado,
        Presenca::Focado => Presenca::Escondido,
    }
}

fn hwnd_e_app() -> Option<(isize, AppHandle)> {
    ESTADO.lock().unwrap().as_ref().map(|e| (e.hwnd, e.app.clone()))
}

/// Entra no modo teclado: guarda quem tinha o foco, tira o "sem ativar" (como o painel_foco
/// faz no painel) e pede à interface o foco na primeira área.
fn focar(hwnd: isize, app: &AppHandle) {
    ANTERIOR.store(unsafe { GetForegroundWindow() }.0 as isize, Ordering::SeqCst);
    TECLADO.store(true, Ordering::SeqCst);
    com_ativar(hwnd);
    if configuracao().modo == Modo::Esconder {
        if let Some(e) = ESTADO.lock().unwrap().as_mut() {
            e.revelado = true;
        }
        revelar();
    }
    match app.get_webview_window("dock") {
        Some(janela) => {
            let _ = janela.set_focus();
        }
        None => unsafe {
            let _ = SetForegroundWindow(HWND(hwnd as _));
        },
    }
    let _ = app.emit_to("dock", "dock:teclado", true);
    crate::registro::info("dock: modo teclado");
}

/// Sai do modo teclado: o dock volta a não ativar e, se pedido, o foco volta à janela de antes.
pub fn soltar_teclado(devolver: bool) {
    if !TECLADO.swap(false, Ordering::SeqCst) {
        return;
    }
    let Some((hwnd, app)) = hwnd_e_app() else { return };
    sem_ativar(hwnd);
    let anterior = HWND(ANTERIOR.swap(0, Ordering::SeqCst) as _);
    if devolver && !anterior.is_invalid() && unsafe { IsWindow(Some(anterior)) }.as_bool() {
        unsafe {
            let _ = SetForegroundWindow(anterior);
        }
    }
    let _ = app.emit_to("dock", "dock:teclado", false);
    crate::registro::info(&format!("dock: teclado solto (devolveu o foco: {devolver})"));
}

/// Ctrl+Alt+D: mostra e reserva a faixa; com o dock na tela, dá o foco a ele; com o foco,
/// esconde e devolve a faixa.
pub fn alternar_visivel() {
    let Some((hwnd, app)) = hwnd_e_app() else { return };
    let h = HWND(hwnd as _);
    let visivel = unsafe { IsWindowVisible(h) }.as_bool();
    let focado = TECLADO.load(Ordering::SeqCst) && unsafe { GetForegroundWindow() } == h;
    match proxima_presenca(presenca(visivel, focado)) {
        Presenca::Visivel => {
            unsafe {
                let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
            }
            aplicar(configuracao());
        }
        Presenca::Focado => focar(hwnd, &app),
        Presenca::Escondido => {
            soltar_teclado(true);
            VIGIA_BORDA.store(false, Ordering::SeqCst);
            appbar::soltar();
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
    }
}

#[tauri::command]
pub fn dock_configuracao() -> Configuracao {
    configuracao()
}

/// Esc no dock (devolver o foco) ou o dock perdeu o foco para outra janela (só soltar).
#[tauri::command]
pub fn dock_soltar_foco(devolver: bool) {
    soltar_teclado(devolver);
}

#[tauri::command]
pub fn dock_aplicar(config: Configuracao) {
    aplicar(config);
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn flutuante_e_mais_larga_que_colada() {
        assert_eq!(largura_janela(Forma::Colada), 64.0);
        assert_eq!(largura_janela(Forma::Flutuante), 80.0);
    }

    #[test]
    fn esconder_revela_na_faixa_e_recolhe_ao_sair() {
        let faixa = RECT { left: 0, top: 0, right: 2, bottom: 1080 };
        let aberto = RECT { left: 0, top: 0, right: 64, bottom: 1080 };
        assert!(decidir_revelado(false, 1, faixa, aberto));
        assert!(!decidir_revelado(false, 30, faixa, aberto));
        assert!(decidir_revelado(true, 30, faixa, aberto));
        assert!(!decidir_revelado(true, 200, faixa, aberto));
    }

    #[test]
    fn ctrl_alt_d_cicla_escondido_visivel_focado() {
        assert_eq!(presenca(false, false), Presenca::Escondido);
        // Escondido com o foco não existe: esconder sempre conta como escondido.
        assert_eq!(presenca(false, true), Presenca::Escondido);
        assert_eq!(presenca(true, false), Presenca::Visivel);
        assert_eq!(presenca(true, true), Presenca::Focado);

        let mut p = Presenca::Escondido;
        let mut caminho = vec![p];
        for _ in 0..3 {
            p = proxima_presenca(p);
            caminho.push(p);
        }
        assert_eq!(caminho, [Presenca::Escondido, Presenca::Visivel, Presenca::Focado, Presenca::Escondido]);
    }

    #[test]
    fn dock_visivel_que_perdeu_o_foco_volta_a_pedir_foco() {
        // Clicar fora solta o modo teclado: o próximo Ctrl+Alt+D foca de novo, não esconde.
        assert_eq!(proxima_presenca(presenca(true, false)), Presenca::Focado);
    }

    #[test]
    fn configuracao_viaja_em_minusculas() {
        let c = Configuracao { lado: Lado::Direita, modo: Modo::Inteligente, forma: Forma::Flutuante };
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, r#"{"lado":"direita","modo":"inteligente","forma":"flutuante"}"#);
    }
}
