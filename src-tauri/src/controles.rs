//! Controles diretos do dock, portados do v0 (MicrophoneMute.cs e Power.cs):
//!
//! - **Mic**: mudo do microfone padrão por `IAudioEndpointVolume`. Uma thread própria
//!   (COM multithread) guarda o dispositivo e assina `IAudioEndpointVolumeCallback`, então
//!   mudar o mudo fora do Moductus (Configurações, atalho do headset) chega ao dock;
//! - **Awake**: manter acordado por `PowerCreateRequest`/`PowerSetRequest`, liberado ao
//!   sair (e, de qualquer forma, quando o processo morre).

use std::sync::{
    mpsc::{channel, Sender},
    Mutex, OnceLock,
};

use tauri::{AppHandle, Emitter};
use windows::{
    core::{implement, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        Media::Audio::{
            eCapture, eCommunications,
            Endpoints::{IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl},
            IMMDeviceEnumerator, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA,
        },
        System::{
            Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
            Power::{PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired, PowerSetRequest},
            Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0},
        },
    },
};

static APP: OnceLock<AppHandle> = OnceLock::new();

// ---------- Mic ----------

enum Pedido {
    Ler(Sender<Option<bool>>),
    Definir(bool, Sender<Option<bool>>),
}

static MIC: Mutex<Option<Sender<Pedido>>> = Mutex::new(None);

#[implement(IAudioEndpointVolumeCallback)]
struct AvisoMic;

impl IAudioEndpointVolumeCallback_Impl for AvisoMic_Impl {
    fn OnNotify(&self, dados: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        if let Some(d) = unsafe { dados.as_ref() } {
            avisar_mic(Some(d.bMuted.as_bool()));
        }
        Ok(())
    }
}

fn avisar_mic(mudo: Option<bool>) {
    crate::registro::info(&format!("mic: {}", mudo.map(|m| if m { "mudo" } else { "aberto" }).unwrap_or("sem microfone")));
    if let Some(app) = APP.get() {
        let _ = app.emit("mic", mudo);
    }
}

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        let enumerador: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        // O microfone que os apps de chamada usam; é o mesmo que o v0 controlava.
        let dispositivo = enumerador.GetDefaultAudioEndpoint(eCapture, eCommunications)?;
        dispositivo.Activate(CLSCTX_ALL, None)
    }
}

fn thread_mic() {
    let (tx, rx) = channel::<Pedido>();
    *MIC.lock().unwrap() = Some(tx);
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let aviso: IAudioEndpointVolumeCallback = AvisoMic.into();
        let mut volume: Option<IAudioEndpointVolume> = None;
        let garantir = |volume: &mut Option<IAudioEndpointVolume>| {
            if volume.is_none() {
                if let Ok(v) = endpoint() {
                    unsafe {
                        let _ = v.RegisterControlChangeNotify(&aviso);
                    }
                    *volume = Some(v);
                }
            }
            volume.clone()
        };
        let ler = |v: &IAudioEndpointVolume| unsafe { v.GetMute().ok().map(|b| b.as_bool()) };
        garantir(&mut volume);
        while let Ok(pedido) = rx.recv() {
            match pedido {
                Pedido::Ler(resposta) => {
                    let mudo = garantir(&mut volume).and_then(|v| ler(&v));
                    if mudo.is_none() {
                        volume = None;
                    }
                    let _ = resposta.send(mudo);
                }
                Pedido::Definir(mudo, resposta) => {
                    let ok = garantir(&mut volume).map(|v| unsafe { v.SetMute(mudo, std::ptr::null()) }.is_ok());
                    if ok != Some(true) {
                        volume = None;
                    }
                    let _ = resposta.send(ok.filter(|ok| *ok).map(|_| mudo));
                }
            }
        }
    });
}

fn pedir_mic(fazer: impl FnOnce(Sender<Option<bool>>) -> Pedido) -> Option<bool> {
    let (tx, rx) = channel();
    MIC.lock().unwrap().as_ref()?.send(fazer(tx)).ok()?;
    rx.recv().ok().flatten()
}

/// `null` quando não há microfone: o controle fica desativado.
#[tauri::command]
pub fn mic_estado() -> Option<bool> {
    pedir_mic(Pedido::Ler)
}

#[tauri::command]
pub fn mic_alternar() -> Option<bool> {
    let atual = mic_estado()?;
    pedir_mic(|r| Pedido::Definir(!atual, r))
}

// ---------- Awake ----------

static AWAKE: Mutex<Option<isize>> = Mutex::new(None);

#[tauri::command]
pub fn awake_estado() -> bool {
    AWAKE.lock().unwrap().is_some()
}

/// Liga mantendo o sistema e a tela acordados; desliga liberando o pedido.
#[tauri::command]
pub fn awake_definir(ligar: bool) -> bool {
    let mut guarda = AWAKE.lock().unwrap();
    match (ligar, *guarda) {
        (true, None) => unsafe {
            let mut motivo: Vec<u16> = "Moductus: manter acordado ligado\0".encode_utf16().collect();
            let contexto = REASON_CONTEXT {
                Version: 0,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 { SimpleReasonString: PWSTR(motivo.as_mut_ptr()) },
            };
            if let Ok(pedido) = PowerCreateRequest(&contexto) {
                let ok = PowerSetRequest(pedido, PowerRequestSystemRequired).is_ok()
                    && PowerSetRequest(pedido, PowerRequestDisplayRequired).is_ok();
                if ok {
                    *guarda = Some(pedido.0 as isize);
                } else {
                    let _ = CloseHandle(pedido);
                }
            }
        },
        (false, Some(valor)) => unsafe {
            let pedido = HANDLE(valor as _);
            let _ = PowerClearRequest(pedido, PowerRequestSystemRequired);
            let _ = PowerClearRequest(pedido, PowerRequestDisplayRequired);
            let _ = CloseHandle(pedido);
            // Zerado mesmo se o clear falhar: o pedido morre com o handle (lição do v0).
            *guarda = None;
        },
        _ => {}
    }
    let ligado = guarda.is_some();
    drop(guarda);
    crate::registro::info(&format!("awake: {}", if ligado { "ligado" } else { "desligado" }));
    if let Some(app) = APP.get() {
        let _ = app.emit("awake", ligado);
    }
    ligado
}

pub fn iniciar(app: AppHandle) {
    let _ = APP.set(app);
    thread_mic();
}

/// Ao sair: o manter acordado é sempre liberado.
pub fn encerrar() {
    if awake_estado() {
        awake_definir(false);
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::System::Power::{CallNtPowerInformation, SystemExecutionState, ES_DISPLAY_REQUIRED};

    fn estado_do_sistema() -> u32 {
        let mut estado = 0u32;
        unsafe {
            let _ = CallNtPowerInformation(SystemExecutionState, None, 0, Some(&mut estado as *mut _ as _), 4);
        }
        estado
    }

    #[test]
    fn awake_liga_e_libera_o_pedido() {
        assert!(awake_definir(true));
        assert!(awake_estado());
        let ligado = estado_do_sistema();
        assert!(!awake_definir(false));
        assert!(!awake_estado());
        let livre = estado_do_sistema();
        println!("SystemExecutionState ligado=0x{ligado:X} livre=0x{livre:X}");
        assert_ne!(ligado & ES_DISPLAY_REQUIRED.0, 0, "o pedido de tela deveria aparecer no estado do sistema");
    }
}
