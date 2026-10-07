//! Vigia de tela cheia: consulta `SHQueryUserNotificationState` a cada 500 ms (validado
//! no teste de viabilidade) e avisa o dock e a interface quando um jogo, vídeo ou
//! apresentação entra ou sai de tela cheia.

use std::{thread, time::Duration};

use tauri::{AppHandle, Emitter};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};

pub const INTERVALO: Duration = Duration::from_millis(500);

pub fn em_tela_cheia(estado: QUERY_USER_NOTIFICATION_STATE) -> bool {
    estado == QUNS_BUSY || estado == QUNS_RUNNING_D3D_FULL_SCREEN || estado == QUNS_PRESENTATION_MODE
}

pub fn vigiar(app: AppHandle) {
    thread::spawn(move || {
        let mut anterior = false;
        loop {
            let cheia = unsafe { SHQueryUserNotificationState() }.map(em_tela_cheia).unwrap_or(false);
            if cheia != anterior {
                anterior = cheia;
                crate::dock::tela_cheia(cheia);
                let _ = app.emit("tela-cheia", cheia);
                crate::registro::info(if cheia { "tela cheia: entrou" } else { "tela cheia: saiu" });
            }
            thread::sleep(INTERVALO);
        }
    });
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::UI::Shell::{QUNS_ACCEPTS_NOTIFICATIONS, QUNS_QUIET_TIME};

    #[test]
    fn jogo_video_e_apresentacao_contam_como_tela_cheia() {
        assert!(em_tela_cheia(QUNS_BUSY));
        assert!(em_tela_cheia(QUNS_RUNNING_D3D_FULL_SCREEN));
        assert!(em_tela_cheia(QUNS_PRESENTATION_MODE));
        assert!(!em_tela_cheia(QUNS_ACCEPTS_NOTIFICATIONS));
        assert!(!em_tela_cheia(QUNS_QUIET_TIME));
    }
}
