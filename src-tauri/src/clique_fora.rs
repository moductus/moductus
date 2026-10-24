//! Clique fora do painel. O painel nunca ativa (`WS_EX_NOACTIVATE`), para não tirar o foco de
//! quem está trabalhando; por isso "perder o foco" não acontece com ele, e o sinal é o clique.
//! Enquanto o painel está à vista, um gancho de mouse de baixo nível (`WH_MOUSE_LL`) vê cada botão
//! apertado; clique numa janela de outro processo (outro app, a área de trabalho, a barra de
//! tarefas) vira `painel:clique-fora`, e a interface fecha o painel se nada o segura. Clique no
//! dock, no Sistema, na captura ou num diálogo do Moductus não conta: é o mesmo app.
//!
//! O gancho mora num fio próprio, com fila de mensagens. O retorno dele só filtra o botão e
//! repassa o ponto à fila: descobrir a janela embaixo do ponto fica fora do caminho do mouse.

use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, OnceLock,
    },
    thread,
};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, POINT, WPARAM},
    System::Threading::{GetCurrentProcessId, GetCurrentThreadId},
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetMessageW, GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
        UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, HC_ACTION, HHOOK, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE, WH_MOUSE_LL, WM_APP,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_XBUTTONDOWN,
    },
};

const MSG_LIGAR: u32 = WM_APP + 1;
const MSG_DESLIGAR: u32 = WM_APP + 2;
/// Um botão apertado: x em `wParam`, y em `lParam` (coordenadas de tela, negativas à esquerda
/// do monitor principal).
const MSG_CLIQUE: u32 = WM_APP + 3;

static FIO: AtomicU32 = AtomicU32::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Só o apertar de um botão conta: mover, soltar e a rodinha não fecham o painel.
pub fn e_clique(mensagem: u32) -> bool {
    matches!(mensagem, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN)
}

/// A janela clicada é de outro app. Sem janela no ponto (processo 0), também é fora.
pub fn de_outro_app(processo_alvo: u32, meu: u32) -> bool {
    processo_alvo != meu
}

/// O ponto vai à fila nos dois parâmetros da mensagem e volta inteiro, negativo inclusive.
pub fn ponto_para_fila(ponto: POINT) -> (WPARAM, LPARAM) {
    (WPARAM(ponto.x as isize as usize), LPARAM(ponto.y as isize))
}

pub fn ponto_da_fila(w: WPARAM, l: LPARAM) -> POINT {
    POINT { x: w.0 as isize as i32, y: l.0 as i32 }
}

/// Sobe o fio do gancho, desligado; liga quando o painel aparece.
pub fn iniciar(app: AppHandle) {
    let _ = APP.set(app);
    let (pronto, id) = mpsc::channel();
    thread::spawn(move || unsafe {
        let mut msg = MSG::default();
        // Cria a fila do fio antes de dar o endereço: sem ela o PostThreadMessage se perde.
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        let _ = pronto.send(GetCurrentThreadId());
        let mut gancho: Option<HHOOK> = None;
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                MSG_LIGAR if gancho.is_none() => match SetWindowsHookExW(WH_MOUSE_LL, Some(ao_mouse), None, 0) {
                    Ok(g) => gancho = Some(g),
                    Err(e) => crate::registro::info(&format!("clique fora: gancho do mouse falhou ({})", e.message())),
                },
                MSG_DESLIGAR => {
                    if let Some(g) = gancho.take() {
                        let _ = UnhookWindowsHookEx(g);
                    }
                }
                // Um clique que chegou à fila depois de desligar já não vale.
                MSG_CLIQUE if gancho.is_some() => {
                    let ponto = ponto_da_fila(msg.wParam, msg.lParam);
                    let mut processo = 0;
                    GetWindowThreadProcessId(GetAncestor(WindowFromPoint(ponto), GA_ROOT), Some(&mut processo));
                    if de_outro_app(processo, GetCurrentProcessId()) {
                        if let Some(app) = APP.get() {
                            let _ = app.emit_to("painel", "painel:clique-fora", ());
                        }
                    }
                }
                _ => {}
            }
        }
    });
    if let Ok(fio) = id.recv() {
        FIO.store(fio, Ordering::SeqCst);
    }
}

unsafe extern "system" fn ao_mouse(codigo: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if codigo == HC_ACTION as i32 && e_clique(w.0 as u32) {
        let info = unsafe { &*(l.0 as *const MSLLHOOKSTRUCT) };
        let (x, y) = ponto_para_fila(info.pt);
        let _ = unsafe { PostThreadMessageW(GetCurrentThreadId(), MSG_CLIQUE, x, y) };
    }
    unsafe { CallNextHookEx(None, codigo, w, l) }
}

fn postar(mensagem: u32) {
    let fio = FIO.load(Ordering::SeqCst);
    if fio != 0 {
        let _ = unsafe { PostThreadMessageW(fio, mensagem, WPARAM(0), LPARAM(0)) };
    }
}

/// O painel apareceu: passa a olhar os cliques.
pub fn ligar() {
    postar(MSG_LIGAR);
}

/// O painel sumiu: o mouse do Windows volta a passar sem o gancho.
pub fn desligar() {
    postar(MSG_DESLIGAR);
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONUP};

    #[test]
    fn so_apertar_um_botao_conta_como_clique() {
        for botao in [WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_MBUTTONDOWN, WM_XBUTTONDOWN] {
            assert!(e_clique(botao), "botão {botao:#x}");
        }
        for outro in [WM_MOUSEMOVE, WM_LBUTTONUP, WM_RBUTTONUP, WM_MOUSEWHEEL] {
            assert!(!e_clique(outro), "mensagem {outro:#x}");
        }
    }

    #[test]
    fn janela_do_proprio_moductus_nao_fecha_o_painel() {
        // O Sistema aberto pelo "Abrir no sistema", a captura, o dock: o mesmo processo.
        assert!(!de_outro_app(4321, 4321));
        // Outro app, a área de trabalho (explorer) ou ponto sem janela.
        assert!(de_outro_app(1200, 4321));
        assert!(de_outro_app(0, 4321));
    }

    #[test]
    fn ponto_negativo_volta_inteiro_da_fila() {
        // Monitor à esquerda e acima do principal: o x atravessa o wParam, que não tem sinal.
        for ponto in [POINT { x: -1280, y: -40 }, POINT { x: 2559, y: 1439 }, POINT { x: 0, y: 0 }] {
            let (w, l) = ponto_para_fila(ponto);
            assert_eq!(ponto_da_fila(w, l), ponto);
        }
    }
}
