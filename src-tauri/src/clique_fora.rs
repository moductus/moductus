//! Clique fora do painel. O painel nunca ativa (`WS_EX_NOACTIVATE`), para não tirar o foco de
//! quem está trabalhando; por isso "perder o foco" não acontece com ele, e o sinal é o clique.
//! Enquanto o painel está à vista, um gancho de mouse de baixo nível (`WH_MOUSE_LL`) vê cada botão
//! apertado; clique numa janela de outro processo (outro app, a área de trabalho, a barra de
//! tarefas) vira `painel:clique-fora`, e a interface fecha o painel se nada o segura. Clique no
//! dock, no Sistema, na captura ou num diálogo do Moductus não conta: é o mesmo app. Também não
//! contam as janelas que o WebView abre em outro processo para o painel (calendário de data,
//! lista de opções, menu do botão direito), que têm uma janela do Moductus como dona, nem o
//! painel de emoji do Windows (Win+.) enquanto o painel tem o teclado.
//!
//! Só o painel que você abriu (dock, atalho, bandeja, aviso do Windows) fecha com o clique fora:
//! o briefing e o fechamento que o serviço abre ficam até uma ação ou o Esc.
//!
//! O gancho mora num fio próprio, com fila de mensagens. O retorno dele só filtra o botão e
//! repassa o ponto à fila: descobrir a janela embaixo do ponto fica fora do caminho do mouse.

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, OnceLock,
    },
    thread,
};

use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, WPARAM},
    System::Threading::{
        GetCurrentProcessId, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetMessageW, GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
        UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GA_ROOTOWNER, HC_ACTION, HHOOK, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE,
        WH_MOUSE_LL, WM_APP, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_XBUTTONDOWN,
    },
};
use windows_core::PWSTR;

const MSG_LIGAR: u32 = WM_APP + 1;
const MSG_DESLIGAR: u32 = WM_APP + 2;
/// Um botão apertado: x em `wParam`, y em `lParam` (coordenadas de tela, negativas à esquerda
/// do monitor principal).
const MSG_CLIQUE: u32 = WM_APP + 3;

static FIO: AtomicU32 = AtomicU32::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// O painel pediu o teclado (`painel_foco`): um campo de texto dele está em uso.
static TECLADO: AtomicBool = AtomicBool::new(false);

/// Quem abriu o painel: só o que você abriu fecha com o clique fora.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origem {
    /// Dock, atalho, bandeja, tour ou o clique no aviso do Windows.
    Usuario,
    /// O serviço (`painel mostrar`): o briefing e o fechamento do dia.
    Servico,
}

impl Origem {
    pub fn fecha_ao_clicar_fora(self) -> bool {
        self == Origem::Usuario
    }
}

/// A janela embaixo do clique: o processo dela (a de topo), o da dona dela e se é o painel de
/// emoji e de entrada de texto do Windows (`TextInputHost.exe`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Alvo {
    pub processo: u32,
    pub processo_dono: u32,
    pub entrada_de_texto: bool,
}

/// Só o apertar de um botão conta: mover, soltar e a rodinha não fecham o painel.
pub fn e_clique(mensagem: u32) -> bool {
    matches!(mensagem, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN)
}

/// O clique fecha o painel? Não quando a janela é do Moductus ou tem uma do Moductus como dona
/// (o calendário, a lista e o menu que o WebView abre em outro processo), nem quando é o painel
/// de emoji com um campo do painel usando o teclado. Sem janela no ponto (processo 0), é fora.
pub fn fecha_o_painel(alvo: Alvo, meu: u32, painel_com_teclado: bool) -> bool {
    if alvo.processo == meu || alvo.processo_dono == meu {
        return false;
    }
    !(alvo.entrada_de_texto && painel_com_teclado)
}

/// O executável é o host de entrada de texto do Windows (Win+., teclado de toque, ditado).
pub fn e_entrada_de_texto(caminho: &str) -> bool {
    caminho.rsplit(['\\', '/']).next().is_some_and(|nome| nome.eq_ignore_ascii_case("TextInputHost.exe"))
}

fn processo_de(janela: HWND) -> u32 {
    let mut processo = 0;
    unsafe { GetWindowThreadProcessId(janela, Some(&mut processo)) };
    processo
}

fn caminho_do_processo(processo: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processo).ok()?;
        let mut nome = [0u16; 1024];
        let mut tamanho = nome.len() as u32;
        let lido = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(nome.as_mut_ptr()), &mut tamanho);
        let _ = CloseHandle(h);
        lido.ok().map(|_| String::from_utf16_lossy(&nome[..tamanho as usize]))
    }
}

fn alvo_em(ponto: POINT) -> Alvo {
    let janela = unsafe { WindowFromPoint(ponto) };
    let processo = processo_de(unsafe { GetAncestor(janela, GA_ROOT) });
    // A dona sobe pelos pais e pelos donos: o popup do WebView é de topo, mas tem dono.
    let processo_dono = processo_de(unsafe { GetAncestor(janela, GA_ROOTOWNER) });
    let entrada_de_texto = processo != 0 && caminho_do_processo(processo).is_some_and(|c| e_entrada_de_texto(&c));
    Alvo { processo, processo_dono, entrada_de_texto }
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
                    let alvo = alvo_em(ponto_da_fila(msg.wParam, msg.lParam));
                    if fecha_o_painel(alvo, GetCurrentProcessId(), TECLADO.load(Ordering::SeqCst)) {
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

/// O painel apareceu numa área: olha os cliques se foi você quem abriu; aberto pelo serviço, o
/// gancho fica desligado (também quando o serviço troca a área de um painel que você abriu).
pub fn vigiar(origem: Origem) {
    postar(if origem.fecha_ao_clicar_fora() { MSG_LIGAR } else { MSG_DESLIGAR });
}

/// O painel sumiu: o mouse do Windows volta a passar sem o gancho.
pub fn desligar() {
    TECLADO.store(false, Ordering::SeqCst);
    postar(MSG_DESLIGAR);
}

/// Um campo do painel pegou ou largou o teclado.
pub fn teclado(com: bool) {
    TECLADO.store(com, Ordering::SeqCst);
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

    const MEU: u32 = 4321;
    const fn alvo(processo: u32, processo_dono: u32, entrada_de_texto: bool) -> Alvo {
        Alvo { processo, processo_dono, entrada_de_texto }
    }

    #[test]
    fn janela_do_proprio_moductus_nao_fecha_o_painel() {
        // O Sistema aberto pelo "Abrir no sistema", a captura, o dock: o mesmo processo.
        assert!(!fecha_o_painel(alvo(MEU, MEU, false), MEU, false));
        // Outro app, a área de trabalho (explorer) ou ponto sem janela.
        assert!(fecha_o_painel(alvo(1200, 1200, false), MEU, false));
        assert!(fecha_o_painel(alvo(0, 0, false), MEU, false));
    }

    #[test]
    fn popup_do_webview_com_dona_do_moductus_nao_fecha_o_painel() {
        // Calendário do campo de data, lista do select, menu do botão direito: janela de topo do
        // msedgewebview2, com a janela do painel como dona.
        assert!(!fecha_o_painel(alvo(7788, MEU, false), MEU, false));
        assert!(!fecha_o_painel(alvo(7788, MEU, false), MEU, true));
        // Popup de outro app, com dona de outro app: fora.
        assert!(fecha_o_painel(alvo(7788, 7700, false), MEU, false));
    }

    #[test]
    fn painel_de_emoji_so_segura_com_o_teclado_no_painel() {
        let emoji = alvo(9900, 9900, true);
        assert!(!fecha_o_painel(emoji, MEU, true));
        // Sem campo do painel em uso, o Win+. é de outro app: clicar nele fecha.
        assert!(fecha_o_painel(emoji, MEU, false));
    }

    #[test]
    fn so_o_host_de_entrada_de_texto_conta_como_painel_de_emoji() {
        assert!(e_entrada_de_texto(r"C:\Windows\SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\TextInputHost.exe"));
        assert!(e_entrada_de_texto("textinputhost.EXE"));
        assert!(!e_entrada_de_texto(r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\msedgewebview2.exe"));
        assert!(!e_entrada_de_texto(r"C:\Ferramentas\TextInputHost.exe.bak"));
        assert!(!e_entrada_de_texto(""));
    }

    #[test]
    fn so_o_painel_que_voce_abriu_fecha_com_o_clique_fora() {
        assert!(Origem::Usuario.fecha_ao_clicar_fora());
        // Briefing e fechamento abertos pelo serviço ficam até uma ação ou o Esc.
        assert!(!Origem::Servico.fecha_ao_clicar_fora());
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
