//! O dock: estilo da janela e lado da tela. Os modos (fixo, esconder, inteligente) se
//! apoiam no módulo appbar.

use tauri::WebviewWindow;
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW},
};

use crate::appbar::{self, Lado};

/// Largura do dock em pixels lógicos (DESIGN §3: 64–68 px).
pub const LARGURA: f64 = 64.0;

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

pub fn iniciar(janela: &WebviewWindow, lado: Lado) {
    let hwnd = hwnd_de(janela);
    sem_ativar(hwnd);
    appbar::acompanhar(hwnd, lado, LARGURA);
    appbar::registrar();
}

/// Troca de lado sem reiniciar: a reserva muda de borda na hora.
pub fn trocar_lado(lado: Lado) {
    appbar::definir(lado, LARGURA);
    crate::registro::info(&format!("dock trocou de lado: {lado:?}"));
}
