//! Mídia tocando no Windows (GlobalSystemMediaTransportControlsSessionManager): estado,
//! tocar e pausar, próxima, anterior e capa.
//!
//! Sem consulta periódica: o gerenciador avisa quando a sessão atual muda, e a sessão
//! avisa quando muda o estado ou a faixa. A cada aviso o estado é relido e vai para a
//! interface no evento `midia`; sem sessão, o evento leva `null` e o controle some.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::{
    core::HSTRING,
    Foundation::TypedEventHandler,
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Sessao,
        GlobalSystemMediaTransportControlsSessionManager as Gerenciador,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    },
    Storage::Streams::{DataReader, IRandomAccessStreamReference},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EstadoMidia {
    /// Identificador do app de origem (AUMID), para o ícone e o nome.
    pub app: String,
    pub titulo: String,
    pub artista: String,
    pub tocando: bool,
    pub pode_anterior: bool,
    pub pode_proxima: bool,
    /// Capa como data URL (image/png, image/jpeg), quando o app oferece.
    pub capa: Option<String>,
}

struct Vigia {
    gerenciador: Gerenciador,
    sessao: Option<(Sessao, i64, i64)>,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static VIGIA: Mutex<Option<Vigia>> = Mutex::new(None);
static ULTIMO: Mutex<Option<EstadoMidia>> = Mutex::new(None);

pub fn iniciar(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| {
        if let Err(e) = ligar() {
            crate::registro::info(&format!("mídia indisponível: {e}"));
        }
    });
}

fn ligar() -> windows::core::Result<()> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let gerenciador = Gerenciador::RequestAsync()?.join()?;
    gerenciador.CurrentSessionChanged(&TypedEventHandler::new(|_, _| {
        trocar_sessao();
        Ok(())
    }))?;
    *VIGIA.lock().unwrap() = Some(Vigia { gerenciador, sessao: None });
    trocar_sessao();
    Ok(())
}

/// A sessão atual mudou: solta os avisos da antiga e assina os da nova.
fn trocar_sessao() {
    {
        let mut guarda = VIGIA.lock().unwrap();
        let Some(vigia) = guarda.as_mut() else { return };
        if let Some((antiga, t1, t2)) = vigia.sessao.take() {
            let _ = antiga.RemovePlaybackInfoChanged(t1);
            let _ = antiga.RemoveMediaPropertiesChanged(t2);
        }
        if let Ok(sessao) = vigia.gerenciador.GetCurrentSession() {
            let t1 = sessao.PlaybackInfoChanged(&TypedEventHandler::new(|_, _| {
                atualizar();
                Ok(())
            }));
            let t2 = sessao.MediaPropertiesChanged(&TypedEventHandler::new(|_, _| {
                atualizar();
                Ok(())
            }));
            if let (Ok(t1), Ok(t2)) = (t1, t2) {
                vigia.sessao = Some((sessao, t1, t2));
            }
        }
    }
    atualizar();
}

fn sessao_atual() -> Option<Sessao> {
    VIGIA.lock().unwrap().as_ref()?.sessao.as_ref().map(|(s, _, _)| s.clone())
}

fn ler(sessao: &Sessao) -> windows::core::Result<EstadoMidia> {
    let info = sessao.TryGetMediaPropertiesAsync()?.join()?;
    let reproducao = sessao.GetPlaybackInfo()?;
    let controles = reproducao.Controls()?;
    Ok(EstadoMidia {
        app: sessao.SourceAppUserModelId()?.to_string(),
        titulo: info.Title()?.to_string(),
        artista: info.Artist()?.to_string(),
        tocando: reproducao.PlaybackStatus()? == Status::Playing,
        pode_anterior: controles.IsPreviousEnabled()?,
        pode_proxima: controles.IsNextEnabled()?,
        capa: info.Thumbnail().ok().and_then(|c| capa(&c).ok()),
    })
}

fn capa(referencia: &IRandomAccessStreamReference) -> windows::core::Result<String> {
    let fluxo = referencia.OpenReadAsync()?.join()?;
    let tamanho = fluxo.Size()? as u32;
    let leitor = DataReader::CreateDataReader(&fluxo)?;
    leitor.LoadAsync(tamanho)?.join()?;
    let mut bytes = vec![0u8; tamanho as usize];
    leitor.ReadBytes(&mut bytes)?;
    let tipo = fluxo.ContentType().unwrap_or_else(|_| HSTRING::from("image/png"));
    Ok(format!("data:{tipo};base64,{}", base64(&bytes)))
}

fn atualizar() {
    let estado = sessao_atual().and_then(|s| ler(&s).ok());
    {
        let mut ultimo = ULTIMO.lock().unwrap();
        if *ultimo == estado {
            return;
        }
        *ultimo = estado.clone();
    }
    match &estado {
        Some(e) => crate::registro::info(&format!("mídia: {} — {} ({})", e.app, e.titulo, if e.tocando { "tocando" } else { "pausada" })),
        None => crate::registro::info("mídia: sem sessão"),
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("midia", estado);
    }
}

pub fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut saida = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for bloco in bytes.chunks(3) {
        let n = (bloco[0] as u32) << 16 | (*bloco.get(1).unwrap_or(&0) as u32) << 8 | *bloco.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= bloco.len() {
                saida.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                saida.push('=');
            }
        }
    }
    saida
}

#[tauri::command]
pub fn midia_estado() -> Option<EstadoMidia> {
    ULTIMO.lock().unwrap().clone()
}

fn comandar(acao: impl Fn(&Sessao) -> windows::core::Result<bool>) -> bool {
    sessao_atual().and_then(|s| acao(&s).ok()).unwrap_or(false)
}

#[tauri::command]
pub async fn midia_alternar() -> bool {
    comandar(|s| s.TryTogglePlayPauseAsync()?.join())
}

#[tauri::command]
pub async fn midia_proxima() -> bool {
    comandar(|s| s.TrySkipNextAsync()?.join())
}

#[tauri::command]
pub async fn midia_anterior() -> bool {
    comandar(|s| s.TrySkipPreviousAsync()?.join())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn base64_igual_ao_padrao() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"Moductus"), "TW9kdWN0dXM=");
    }
}
