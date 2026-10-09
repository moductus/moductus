//! O dock como AppBar: o Windows desconta a faixa da área de trabalho, como faz com a
//! barra de tarefas, e janelas maximizadas respeitam o dock.
//!
//! Achado do teste de viabilidade (ARCHITECTURE §9): o Windows não devolve a reserva
//! sozinho quando o processo cai, nem no fechamento normal se a janela já foi destruída.
//! Por isso o identificador da janela fica gravado em `appbar.hwnd`; ao subir e ao sair,
//! `ABM_REMOVE` com esse identificador libera a faixa mesmo com a janela morta.

use std::{
    mem::size_of,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY},
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{
                DefSubclassProc, SHAppBarMessage, SetWindowSubclass, ABE_LEFT, ABE_RIGHT, ABM_ACTIVATE, ABM_NEW,
                ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_POSCHANGED, APPBARDATA,
            },
            WindowsAndMessaging::{
                PostMessageW, RegisterWindowMessageW, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, WM_ACTIVATE,
                WM_APP, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_WINDOWPOSCHANGED,
            },
        },
    },
};

/// Mensagem que o Windows manda ao dock quando outra AppBar ou a barra de tarefas muda.
const MSG_APPBAR: u32 = WM_APP + 1;
/// Reposicionamento adiado: roda depois que o Tauri tratou a mudança de DPI.
const MSG_REPOSICIONAR: u32 = WM_APP + 2;
const ID_SUBCLASSE: usize = 0x4D44;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lado {
    Esquerda,
    Direita,
}

#[derive(Clone, Copy, Debug)]
struct Estado {
    hwnd: isize,
    lado: Lado,
    /// Largura da faixa em pixels lógicos (96 DPI); a física sai do DPI do monitor.
    largura: f64,
    registrado: bool,
}

static ESTADO: Mutex<Option<Estado>> = Mutex::new(None);
static ARQUIVO: OnceLock<PathBuf> = OnceLock::new();

/// Mensagem registrada que o Explorer manda quando a barra de tarefas é recriada
/// (Explorer reiniciado): as AppBars precisam se registrar de novo.
fn msg_barra_recriada() -> u32 {
    static M: OnceLock<u32> = OnceLock::new();
    *M.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) })
}

/// Só nos builds de debug: o roteiro `verificar.ps1` troca modo e forma sem reiniciar.
#[cfg(debug_assertions)]
fn msg_teste_modo() -> u32 {
    static M: OnceLock<u32> = OnceLock::new();
    *M.get_or_init(|| unsafe { RegisterWindowMessageW(w!("MODUCTUS_TESTE_MODO")) })
}

/// Só nos builds de debug: o roteiro pede Ctrl+Alt+<wParam> para o Sistema.
#[cfg(debug_assertions)]
fn msg_teste_atalho() -> u32 {
    static M: OnceLock<u32> = OnceLock::new();
    *M.get_or_init(|| unsafe { RegisterWindowMessageW(w!("MODUCTUS_TESTE_ATALHO")) })
}

/// Só nos builds de debug: o roteiro troca o lado (wParam 0 = esquerda, 1 = direita).
#[cfg(debug_assertions)]
fn msg_teste_lado() -> u32 {
    static M: OnceLock<u32> = OnceLock::new();
    *M.get_or_init(|| unsafe { RegisterWindowMessageW(w!("MODUCTUS_TESTE_LADO")) })
}

fn dados(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: size_of::<APPBARDATA>() as u32, hWnd: hwnd, uCallbackMessage: MSG_APPBAR, ..Default::default() }
}

fn hwnd(valor: isize) -> HWND {
    HWND(valor as _)
}

/// Libera a faixa reservada por um identificador, mesmo que a janela já tenha morrido.
fn remover(valor: isize) {
    let mut abd = dados(hwnd(valor));
    unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
}

/// Ao subir: remove a reserva deixada por uma execução que caiu.
pub fn iniciar(pasta: PathBuf) {
    let arquivo = ARQUIVO.get_or_init(|| pasta.join("appbar.hwnd"));
    if let Some(antigo) = std::fs::read_to_string(arquivo).ok().and_then(|t| t.trim().parse::<isize>().ok()) {
        remover(antigo);
        crate::registro::info(&format!("reserva órfã removida: {antigo}"));
    }
    let _ = std::fs::remove_file(arquivo);
}

/// Prende a subclasse que recebe os avisos do Windows. Chamar uma vez, na thread da janela.
pub fn acompanhar(janela: isize, lado: Lado, largura: f64) {
    *ESTADO.lock().unwrap() = Some(Estado { hwnd: janela, lado, largura, registrado: false });
    unsafe {
        let _ = SetWindowSubclass(hwnd(janela), Some(subclasse), ID_SUBCLASSE, 0);
    }
}

/// Reserva a faixa e posiciona o dock nela.
///
/// O estado é copiado e o mutex solto antes de falar com o Windows: `SetWindowPos`
/// manda `WM_WINDOWPOSCHANGED` de forma síncrona para a subclasse, que lê o estado.
pub fn registrar() -> Option<RECT> {
    let (estado, novo) = {
        let mut guarda = ESTADO.lock().unwrap();
        let estado = guarda.as_mut()?;
        let novo = !estado.registrado;
        estado.registrado = true;
        (*estado, novo)
    };
    if novo {
        let mut abd = dados(hwnd(estado.hwnd));
        unsafe { SHAppBarMessage(ABM_NEW, &mut abd) };
        if let Some(arquivo) = ARQUIVO.get() {
            let _ = std::fs::write(arquivo, estado.hwnd.to_string());
        }
    }
    Some(posicionar(&estado))
}

/// Devolve a faixa à área de trabalho, sem esconder a janela.
pub fn soltar() {
    let alvo = {
        let mut guarda = ESTADO.lock().unwrap();
        guarda.as_mut().filter(|e| e.registrado).map(|e| {
            e.registrado = false;
            e.hwnd
        })
    };
    if let Some(valor) = alvo {
        remover(valor);
    }
    if let Some(arquivo) = ARQUIVO.get() {
        let _ = std::fs::remove_file(arquivo);
    }
}

/// Ao sair: usa o valor guardado, sem depender de a janela ainda existir.
pub fn encerrar() {
    soltar();
}

pub fn registrado() -> bool {
    ESTADO.lock().unwrap().map(|e| e.registrado).unwrap_or(false)
}

pub fn definir(lado: Lado, largura: f64) -> Option<RECT> {
    let estado = {
        let mut guarda = ESTADO.lock().unwrap();
        let estado = guarda.as_mut()?;
        estado.lado = lado;
        estado.largura = largura;
        *estado
    };
    estado.registrado.then(|| posicionar(&estado))
}

/// Retângulo do monitor principal e escala do dock, para quem precisa desenhar fora da
/// reserva (modo esconder).
pub fn monitor_principal() -> RECT {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(monitor, &mut info);
        info.rcMonitor
    }
}

pub fn escala(janela: isize) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd(janela)) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f64 / 96.0
    }
}

/// Faixa colada à borda do monitor, com a largura em pixels físicos.
pub fn faixa(monitor: RECT, lado: Lado, largura: i32) -> RECT {
    match lado {
        Lado::Esquerda => RECT { left: monitor.left, top: monitor.top, right: monitor.left + largura, bottom: monitor.bottom },
        Lado::Direita => RECT { left: monitor.right - largura, top: monitor.top, right: monitor.right, bottom: monitor.bottom },
    }
}

fn posicionar(estado: &Estado) -> RECT {
    let h = hwnd(estado.hwnd);
    let largura = (estado.largura * escala(estado.hwnd)).round() as i32;
    let mut abd = dados(h);
    abd.uEdge = match estado.lado {
        Lado::Esquerda => ABE_LEFT,
        Lado::Direita => ABE_RIGHT,
    };
    abd.rc = faixa(monitor_principal(), estado.lado, largura);
    unsafe {
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        // A barra de tarefas pode ter empurrado a borda; a largura volta a ser a nossa.
        match estado.lado {
            Lado::Esquerda => abd.rc.right = abd.rc.left + largura,
            Lado::Direita => abd.rc.left = abd.rc.right - largura,
        }
        SHAppBarMessage(ABM_SETPOS, &mut abd);
        let rc = abd.rc;
        let _ = SetWindowPos(h, Some(HWND_TOPMOST), rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, SWP_NOACTIVATE);
        crate::registro::info(&format!("dock fixado: {},{},{},{}", rc.left, rc.top, rc.right, rc.bottom));
        rc
    }
}

fn reposicionar_se_registrado() {
    let estado = *ESTADO.lock().unwrap();
    if let Some(estado) = estado.filter(|e| e.registrado) {
        posicionar(&estado);
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
    match msg {
        MSG_APPBAR if wparam.0 as u32 == ABN_POSCHANGED => {
            reposicionar_se_registrado();
            return LRESULT(0);
        }
        MSG_REPOSICIONAR => {
            reposicionar_se_registrado();
            return LRESULT(0);
        }
        WM_DISPLAYCHANGE | WM_DPICHANGED => {
            let r = DefSubclassProc(janela, msg, wparam, lparam);
            let _ = PostMessageW(Some(janela), MSG_REPOSICIONAR, WPARAM(0), LPARAM(0));
            return r;
        }
        WM_ACTIVATE | WM_WINDOWPOSCHANGED if registrado() => {
            let mut abd = dados(janela);
            let aviso = if msg == WM_ACTIVATE { ABM_ACTIVATE } else { ABM_WINDOWPOSCHANGED };
            SHAppBarMessage(aviso, &mut abd);
        }
        _ if msg == msg_barra_recriada() => {
            if registrado() {
                if let Some(e) = ESTADO.lock().unwrap().as_mut() {
                    e.registrado = false;
                }
                registrar();
            }
        }
        #[cfg(debug_assertions)]
        _ if msg == msg_teste_lado() => {
            let lado = if wparam.0 == 1 { Lado::Direita } else { Lado::Esquerda };
            crate::dock::trocar_lado(lado);
            return LRESULT(0);
        }
        #[cfg(debug_assertions)]
        _ if msg == msg_teste_atalho() => {
            if let Some(tecla) = char::from_u32(wparam.0 as u32) {
                crate::atalhos::teste_definir_sistema(tecla);
            }
            return LRESULT(0);
        }
        // wParam: 0 fixo, 1 esconder, 2 inteligente; lParam: 0 colada, 1 flutuante.
        #[cfg(debug_assertions)]
        _ if msg == msg_teste_modo() => {
            use crate::dock::{Configuracao, Forma, Modo};
            let modo = [Modo::Fixo, Modo::Esconder, Modo::Inteligente][wparam.0.min(2)];
            let forma = if lparam.0 == 1 { Forma::Flutuante } else { Forma::Colada };
            crate::dock::aplicar(Configuracao { modo, forma, ..crate::dock::configuracao() });
            return LRESULT(0);
        }
        _ => {}
    }
    DefSubclassProc(janela, msg, wparam, lparam)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn faixa_cola_na_borda_escolhida() {
        let monitor = RECT { left: 0, top: 0, right: 2560, bottom: 1080 };
        let e = faixa(monitor, Lado::Esquerda, 64);
        assert_eq!((e.left, e.right, e.top, e.bottom), (0, 64, 0, 1080));
        let d = faixa(monitor, Lado::Direita, 64);
        assert_eq!((d.left, d.right), (2496, 2560));
    }
}
