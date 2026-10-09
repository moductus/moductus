//! Onde o Moductus guarda os próprios arquivos: `%APPDATA%\Moductus`, ou ao lado do
//! executável quando existe um `portable.txt` ali (como no v0).

use std::path::PathBuf;

pub fn portable() -> bool {
    pasta_do_exe().map(|p| p.join("portable.txt").exists()).unwrap_or(false)
}

pub fn pasta() -> PathBuf {
    let pasta = if portable() {
        pasta_do_exe().expect("pasta do executável")
    } else {
        let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        base.join("Moductus")
    };
    let _ = std::fs::create_dir_all(&pasta);
    pasta
}

fn pasta_do_exe() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(PathBuf::from)
}
