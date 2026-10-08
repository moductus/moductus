//! Preferências de acessibilidade do Windows que a interface precisa seguir. "Efeitos de
//! animação" (Configurações > Acessibilidade > Efeitos visuais) é o `SPI_GETCLIENTAREAANIMATION`;
//! o WebView2 nem sempre o traduz em `prefers-reduced-motion`, então a casca lê o valor e
//! avisa as janelas, na hora e a cada mudança. O alto contraste o WebView2 já entrega
//! sozinho como `forced-colors`.

use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SPI_SETCLIENTAREAANIMATION,
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WM_SETTINGCHANGE,
        },
    },
};

const ID_SUBCLASSE: usize = 0x4D45;
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Estado {
    /// Falso quando o Windows pede para não animar: a interface zera toda animação.
    pub animacoes: bool,
}

/// Lê o Windows agora. Na falha da leitura, vale o padrão do Windows (animações ligadas).
pub fn estado() -> Estado {
    let mut ligadas: i32 = 1;
    let lido = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some(&mut ligadas as *mut i32 as _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    Estado { animacoes: lido.is_err() || ligadas != 0 }
}

/// O aviso de mudança do Windows que interessa: o `wParam` do `WM_SETTINGCHANGE` é a ação SPI.
pub fn muda_animacao(msg: u32, wparam: usize) -> bool {
    msg == WM_SETTINGCHANGE && wparam as u32 == SPI_SETCLIENTAREAANIMATION.0
}

/// Escuta o `WM_SETTINGCHANGE` pela janela do dock (sempre viva). Na thread da janela.
pub fn iniciar(app: AppHandle, hwnd: isize) {
    let _ = APP.set(app);
    unsafe {
        let _ = SetWindowSubclass(HWND(hwnd as _), Some(subclasse), ID_SUBCLASSE, 0);
    }
    let e = estado();
    crate::registro::info(&format!("acessibilidade: animações {}", if e.animacoes { "ligadas" } else { "desligadas" }));
}

unsafe extern "system" fn subclasse(
    janela: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _dados: usize,
) -> LRESULT {
    if muda_animacao(msg, wparam.0) {
        let e = estado();
        crate::registro::info(&format!("acessibilidade: animações {}", if e.animacoes { "ligadas" } else { "desligadas" }));
        if let Some(app) = APP.get() {
            let _ = app.emit("acessibilidade", e);
        }
    }
    DefSubclassProc(janela, msg, wparam, lparam)
}

/// O que o Windows pede agora, para a janela aplicar ao abrir.
#[tauri::command]
pub fn acessibilidade_estado() -> Estado {
    estado()
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{SPI_SETHIGHCONTRAST, WM_DISPLAYCHANGE};

    #[test]
    fn so_a_mudanca_de_animacao_avisa_a_interface() {
        assert!(muda_animacao(WM_SETTINGCHANGE, SPI_SETCLIENTAREAANIMATION.0 as usize));
        assert!(!muda_animacao(WM_SETTINGCHANGE, SPI_SETHIGHCONTRAST.0 as usize));
        assert!(!muda_animacao(WM_SETTINGCHANGE, 0));
        assert!(!muda_animacao(WM_DISPLAYCHANGE, SPI_SETCLIENTAREAANIMATION.0 as usize));
    }

    #[test]
    fn le_o_estado_desta_maquina() {
        // Não afirma o valor (depende da máquina); garante que a leitura não falha e mostra.
        println!("acessibilidade desta máquina: {:?}", estado());
    }

    #[test]
    fn estado_vai_para_a_interface_com_o_nome_do_contrato() {
        let json = serde_json::to_string(&Estado { animacoes: false }).unwrap();
        assert_eq!(json, r#"{"animacoes":false}"#);
    }
}
