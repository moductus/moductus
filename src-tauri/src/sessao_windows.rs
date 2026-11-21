//! Desbloqueio e logon da sessão (ADR-0033): a primeira atividade do dia no PC sai daqui, porque
//! quem deixa o PC ligado e bloqueado à noite nunca passa por uma retomada. O Windows avisa a
//! janela registrada com `WTSRegisterSessionNotification` por `WM_WTSSESSION_CHANGE`, e a casca
//! passa ao serviço `{"tipo":"atividade","motivo":"desbloqueio"}` (ou `"logon"`); é o serviço que
//! decide se conta como a primeira do dia (depois das 05:00, ou o horário fixo).
//!
//! Plano B: se o registro falhar, valem a retomada (`energia.rs`), a subida do serviço e o horário
//! fixo, e o log diz por quê.

use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::RemoteDesktop::{NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification},
    UI::{
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{WM_DESTROY, WM_WTSSESSION_CHANGE, WTS_SESSION_LOGON, WTS_SESSION_UNLOCK},
    },
};

const ID_SUBCLASSE: usize = 0x5753;

/// A linha que vai ao serviço, se a mudança de sessão é atividade de alguém: o `wParam` do
/// `WM_WTSSESSION_CHANGE` diz o que mudou. Bloquear, desconectar e as outras não contam.
pub fn aviso(msg: u32, wparam: usize) -> Option<serde_json::Value> {
    if msg != WM_WTSSESSION_CHANGE {
        return None;
    }
    let motivo = match wparam as u32 {
        WTS_SESSION_UNLOCK => "desbloqueio",
        WTS_SESSION_LOGON => "logon",
        _ => return None,
    };
    Some(serde_json::json!({ "tipo": "atividade", "motivo": motivo }))
}

/// Registra a janela do dock (sempre viva) para os avisos desta sessão. Na thread da janela.
pub fn iniciar(hwnd: isize) {
    let janela = HWND(hwnd as _);
    unsafe {
        if let Err(erro) = WTSRegisterSessionNotification(janela, NOTIFY_FOR_THIS_SESSION) {
            crate::registro::info(&format!(
                "sessão: registro do desbloqueio falhou ({erro}); valem a retomada, a subida e o horário fixo"
            ));
            return;
        }
        let _ = SetWindowSubclass(janela, Some(subclasse), ID_SUBCLASSE, 0);
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
    if let Some(linha) = aviso(msg, wparam.0) {
        crate::registro::info(&format!("sessão: atividade ({})", linha["motivo"].as_str().unwrap_or("")));
        crate::servico::avisar(linha);
    } else if msg == WM_DESTROY {
        // O registro precisa sair antes de a janela ser destruída.
        let _ = WTSUnRegisterSessionNotification(janela);
    }
    DefSubclassProc(janela, msg, wparam, lparam)
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        WM_POWERBROADCAST, WTS_CONSOLE_DISCONNECT, WTS_SESSION_LOCK, WTS_SESSION_LOGOFF,
    };

    #[test]
    fn desbloqueio_e_logon_mandam_atividade_ao_servico() {
        assert_eq!(
            aviso(WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK as usize),
            serde_json::from_str(r#"{"tipo":"atividade","motivo":"desbloqueio"}"#).ok(),
        );
        assert_eq!(
            aviso(WM_WTSSESSION_CHANGE, WTS_SESSION_LOGON as usize),
            Some(serde_json::json!({ "tipo": "atividade", "motivo": "logon" })),
        );
    }

    #[test]
    fn bloquear_sair_e_outras_mensagens_nao_contam() {
        assert_eq!(aviso(WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK as usize), None);
        assert_eq!(aviso(WM_WTSSESSION_CHANGE, WTS_SESSION_LOGOFF as usize), None);
        assert_eq!(aviso(WM_WTSSESSION_CHANGE, WTS_CONSOLE_DISCONNECT as usize), None);
        assert_eq!(aviso(WM_POWERBROADCAST, WTS_SESSION_UNLOCK as usize), None);
    }
}
