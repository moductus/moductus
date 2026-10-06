use std::time::Instant;
use windows::{
    core::BOOL,
    Media::Control::GlobalSystemMediaTransportControlsSessionManager as Gerenciador,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
        },
    },
};

fn midia() -> windows::core::Result<()> {
    let t = Instant::now();
    let gerenciador = Gerenciador::RequestAsync()?.get()?;
    let sessoes = gerenciador.GetSessions()?;
    println!("midia: {} sessão(ões) em {} ms", sessoes.Size()?, t.elapsed().as_millis());
    for s in sessoes {
        let app = s.SourceAppUserModelId()?;
        let info = s.TryGetMediaPropertiesAsync()?.get()?;
        let estado = s.GetPlaybackInfo()?.PlaybackStatus()?;
        let tem_capa = info.Thumbnail().is_ok();
        println!("  app={app} | titulo={} | artista={} | estado={:?} | capa={tem_capa}", info.Title()?, info.Artist()?, estado);
    }
    Ok(())
}

/// Mesmo filtro que a barra de tarefas usa, em linhas gerais: visível, sem dono,
/// não é janela de ferramenta, não está "camuflada" (apps UWP suspensos, outras áreas de trabalho).
unsafe extern "system" fn coletar(hwnd: HWND, dados: LPARAM) -> BOOL {
    let lista = &mut *(dados.0 as *mut Vec<(String, String)>);
    if !IsWindowVisible(hwnd).as_bool() || GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid()) {
        return true.into();
    }
    if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize != 0 {
        return true.into();
    }
    let mut camuflada = 0u32;
    let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut camuflada as *mut _ as _, 4);
    if camuflada != 0 || GetWindowTextLengthW(hwnd) == 0 {
        return true.into();
    }
    let mut buf = [0u16; 512];
    let n = GetWindowTextW(hwnd, &mut buf);
    let titulo = String::from_utf16_lossy(&buf[..n as usize]);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let mut exe = String::from("?");
    if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
        let mut caminho = [0u16; 1024];
        let mut tam = caminho.len() as u32;
        if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(caminho.as_mut_ptr()), &mut tam).is_ok() {
            exe = String::from_utf16_lossy(&caminho[..tam as usize]).rsplit(['\\', '/']).next().unwrap_or("?").to_string();
        }
        let _ = CloseHandle(h);
    }
    lista.push((exe, titulo));
    true.into()
}

fn main() {
    if let Err(e) = midia() {
        println!("midia: erro {e}");
    }
    let t = Instant::now();
    let mut janelas: Vec<(String, String)> = Vec::new();
    unsafe { let _ = EnumWindows(Some(coletar), LPARAM(&mut janelas as *mut _ as isize)); }
    let mut por_app: std::collections::BTreeMap<String, usize> = Default::default();
    for (exe, _) in &janelas { *por_app.entry(exe.clone()).or_default() += 1; }
    println!("janelas: {} de app em {} ms, {} programa(s)", janelas.len(), t.elapsed().as_millis(), por_app.len());
    for (exe, n) in por_app { println!("  {exe}: {n}"); }
}
