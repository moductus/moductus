use std::{fs::OpenOptions, io::Write, mem::size_of, thread, time::Duration};
use tauri::{Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY},
    UI::Shell::{
        SHAppBarMessage, SHQueryUserNotificationState, ABE_LEFT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE,
        ABM_SETPOS, APPBARDATA, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    },
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WM_USER, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    },
};

const LARGURA_LOGICA: f64 = 64.0;
const LOG: &str = "C:/Desenvolvimento/moductus-testes/dock/eventos.log";
const HWND_SALVO: &str = "C:/Desenvolvimento/moductus-testes/dock/appbar.hwnd";

/// Remove a reserva registrada por um identificador de janela, mesmo que a janela já
/// tenha morrido: o Windows não devolve o espaço sozinho quando o processo cai.
fn remover_reserva(hwnd: isize) {
    let mut abd = dados_appbar(HWND(hwnd as _));
    unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
}

fn limpar_reserva_orfa() {
    if let Ok(texto) = std::fs::read_to_string(HWND_SALVO) {
        if let Ok(h) = texto.trim().parse::<isize>() {
            remover_reserva(h);
            registrar(&format!("reserva órfã removida: {h}"));
        }
    }
}

fn registrar(linha: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(LOG) {
        let _ = writeln!(f, "{linha}");
    }
}

fn hwnd_de(janela: &WebviewWindow) -> HWND {
    HWND(janela.hwnd().expect("hwnd").0 as _)
}

fn dados_appbar(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: size_of::<APPBARDATA>() as u32, hWnd: hwnd, uCallbackMessage: WM_USER + 1, ..Default::default() }
}

/// Registra o dock como AppBar na borda esquerda do monitor principal: o Windows
/// passa a descontar a faixa da área de trabalho, como faz com a barra de tarefas.
fn fixar_na_borda(janela: &WebviewWindow) -> RECT {
    let hwnd = hwnd_de(janela);
    let escala = janela.scale_factor().unwrap_or(1.0);
    let largura = (LARGURA_LOGICA * escala).round() as i32;
    unsafe {
        let estilo = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, estilo | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize);

        let mut abd = dados_appbar(hwnd);
        SHAppBarMessage(ABM_NEW, &mut abd);
        let _ = std::fs::write(HWND_SALVO, (hwnd.0 as isize).to_string());

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(monitor, &mut info);
        let m = info.rcMonitor;

        abd.uEdge = ABE_LEFT;
        abd.rc = RECT { left: m.left, top: m.top, right: m.left + largura, bottom: m.bottom };
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        abd.rc.right = abd.rc.left + largura;
        SHAppBarMessage(ABM_SETPOS, &mut abd);

        let rc = abd.rc;
        let _ = janela.set_position(PhysicalPosition::new(rc.left, rc.top));
        let _ = janela.set_size(PhysicalSize::new((rc.right - rc.left) as u32, (rc.bottom - rc.top) as u32));
        rc
    }
}


/// Some quando um app entra em tela cheia (jogo, vídeo, apresentação) e volta depois.
fn vigiar_tela_cheia(janela: WebviewWindow) {
    thread::spawn(move || {
        let mut escondido = false;
        loop {
            let cheia = unsafe { SHQueryUserNotificationState() }
                .map(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
                .unwrap_or(false);
            if cheia != escondido {
                escondido = cheia;
                let _ = if cheia { janela.hide() } else { janela.show() };
                registrar(if cheia { "tela-cheia: escondeu" } else { "tela-cheia: voltou" });
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}

#[tauri::command]
fn clicou(qual: String) {
    registrar(&format!("clique: {qual}"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![clicou])
        .setup(|app| {
            limpar_reserva_orfa();
            let janela = app.get_webview_window("dock").expect("janela dock");
            let rc = fixar_na_borda(&janela);
            registrar(&format!("fixado: left={} top={} right={} bottom={}", rc.left, rc.top, rc.right, rc.bottom));
            vigiar_tela_cheia(janela);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao montar o app")
        .run(|_app, evento| {
            if let RunEvent::Exit = evento {
                limpar_reserva_orfa();
                let _ = std::fs::remove_file(HWND_SALVO);
            }
        });
}
