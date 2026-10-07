//! Registro de eventos da casca em `moductus.log`, na pasta de dados. Nunca recebe
//! segredo: credenciais e tokens não passam por aqui.

use std::{fs::OpenOptions, io::Write, path::PathBuf, sync::OnceLock, time::SystemTime};

static ARQUIVO: OnceLock<PathBuf> = OnceLock::new();

pub fn iniciar(pasta: &std::path::Path) {
    let _ = ARQUIVO.set(pasta.join("moductus.log"));
}

pub fn info(linha: &str) {
    let segundos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if cfg!(debug_assertions) {
        eprintln!("[moductus] {linha}");
    }
    if let Some(arquivo) = ARQUIVO.get() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(arquivo) {
            let _ = writeln!(f, "{segundos} {linha}");
        }
    }
}
