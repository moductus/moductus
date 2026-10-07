//! Sessão de mídia de teste para o roteiro `midia` do verificar.ps1: toca um tom baixo
//! com o título "Teste do Moductus" pelos controles de mídia do Windows e sai depois
//! dos segundos pedidos (padrão 12).

use std::{io::Write, time::Duration};

use windows::{
    core::HSTRING,
    Foundation::Uri,
    Media::{Core::MediaSource, MediaPlaybackType, Playback::MediaPlayer},
};

fn tom(caminho: &std::path::Path, segundos: u32) -> std::io::Result<()> {
    let taxa = 22_050u32;
    let amostras = taxa * segundos;
    let mut f = std::fs::File::create(caminho)?;
    f.write_all(b"RIFF")?;
    f.write_all(&(36 + amostras * 2).to_le_bytes())?;
    f.write_all(b"WAVEfmt ")?;
    f.write_all(&16u32.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&taxa.to_le_bytes())?;
    f.write_all(&(taxa * 2).to_le_bytes())?;
    f.write_all(&2u16.to_le_bytes())?;
    f.write_all(&16u16.to_le_bytes())?;
    f.write_all(b"data")?;
    f.write_all(&(amostras * 2).to_le_bytes())?;
    for i in 0..amostras {
        let v = ((i as f32 * 440.0 * std::f32::consts::TAU / taxa as f32).sin() * 400.0) as i16;
        f.write_all(&v.to_le_bytes())?;
    }
    Ok(())
}

fn main() -> windows::core::Result<()> {
    let segundos: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(12);
    let arquivo = std::env::temp_dir().join("moductus-teste-midia.wav");
    tom(&arquivo, segundos as u32 + 5).expect("gravar o tom");

    let player = MediaPlayer::new()?;
    let controles = player.SystemMediaTransportControls()?;
    let painel = controles.DisplayUpdater()?;
    player.CommandManager()?.SetIsEnabled(false)?;
    controles.SetIsEnabled(true)?;
    controles.SetIsPlayEnabled(true)?;
    controles.SetIsPauseEnabled(true)?;
    painel.SetType(MediaPlaybackType::Music)?;
    painel.MusicProperties()?.SetTitle(&HSTRING::from("Teste do Moductus"))?;
    painel.MusicProperties()?.SetArtist(&HSTRING::from("verificar.ps1"))?;
    painel.Update()?;

    let p = player.clone();
    let c = controles.clone();
    controles.ButtonPressed(&windows::Foundation::TypedEventHandler::new(move |_, args: windows::core::Ref<windows::Media::SystemMediaTransportControlsButtonPressedEventArgs>| {
        use windows::Media::{MediaPlaybackStatus, SystemMediaTransportControlsButton as Botao};
        let botao = args.as_ref().map(|a| a.Button()).transpose()?.unwrap_or(Botao::Stop);
        match botao {
            Botao::Pause => {
                p.Pause()?;
                c.SetPlaybackStatus(MediaPlaybackStatus::Paused)?;
            }
            Botao::Play => {
                p.Play()?;
                c.SetPlaybackStatus(MediaPlaybackStatus::Playing)?;
            }
            _ => {}
        }
        Ok(())
    }))?;

    let uri = Uri::CreateUri(&HSTRING::from(format!("file:///{}", arquivo.display().to_string().replace('\\', "/"))))?;
    player.SetSource(&MediaSource::CreateFromUri(&uri)?)?;
    player.Play()?;
    controles.SetPlaybackStatus(windows::Media::MediaPlaybackStatus::Playing)?;
    std::thread::sleep(Duration::from_secs(segundos));
    let _ = std::fs::remove_file(&arquivo);
    Ok(())
}
