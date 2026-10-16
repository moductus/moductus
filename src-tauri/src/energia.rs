//! Retomada da suspensão (AGENTS.md §6): o Windows avisa as janelas de topo com
//! `WM_POWERBROADCAST` quando o PC volta, e a casca passa o aviso ao serviço
//! (`{"tipo":"retomou"}`), que dispara o que venceu enquanto o PC dormia e lê o GitHub na hora.
//! O `PBT_APMRESUMEAUTOMATIC` chega em toda retomada, com ou sem alguém no teclado; o
//! `PBT_APMRESUMESUSPEND`, que vem junto quando há, ficaria repetido.

use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{PBT_APMRESUMEAUTOMATIC, WM_POWERBROADCAST},
    },
};

const ID_SUBCLASSE: usize = 0x454E;

/// O aviso de retomada que interessa: o `wParam` do `WM_POWERBROADCAST` é o evento de energia.
pub fn retomou(msg: u32, wparam: usize) -> bool {
    msg == WM_POWERBROADCAST && wparam as u32 == PBT_APMRESUMEAUTOMATIC
}

/// Escuta o `WM_POWERBROADCAST` pela janela do dock (sempre viva). Na thread da janela.
pub fn iniciar(hwnd: isize) {
    unsafe {
        let _ = SetWindowSubclass(HWND(hwnd as _), Some(subclasse), ID_SUBCLASSE, 0);
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
    if retomou(msg, wparam.0) {
        crate::registro::info("energia: o PC voltou da suspensão");
        crate::servico::avisar(serde_json::json!({ "tipo": "retomou" }));
    }
    DefSubclassProc(janela, msg, wparam, lparam)
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WM_SETTINGCHANGE};

    #[test]
    fn so_a_retomada_automatica_avisa_o_servico() {
        assert!(retomou(WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC as usize));
        assert!(!retomou(WM_POWERBROADCAST, PBT_APMRESUMESUSPEND as usize));
        assert!(!retomou(WM_POWERBROADCAST, PBT_APMSUSPEND as usize));
        assert!(!retomou(WM_SETTINGCHANGE, PBT_APMRESUMEAUTOMATIC as usize));
    }
}
