//! Atalhos globais (PRODUCT §8): Ctrl+Alt+N abre o Sistema, Ctrl+Alt+D mostra ou
//! esconde o dock, Ctrl+Alt+Espaço abre a captura. Configuráveis; um atalho em
//! conflito devolve o motivo e o anterior continua valendo.

use std::{collections::BTreeMap, str::FromStr, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Acao {
    Sistema,
    Dock,
    Captura,
}

impl Acao {
    fn nome(self) -> &'static str {
        match self {
            Acao::Sistema => "abrir o Sistema",
            Acao::Dock => "mostrar o dock",
            Acao::Captura => "abrir a captura",
        }
    }
}

pub type Atalhos = BTreeMap<Acao, String>;

pub fn padrao() -> Atalhos {
    BTreeMap::from([
        (Acao::Sistema, "Ctrl+Alt+N".to_string()),
        (Acao::Dock, "Ctrl+Alt+D".to_string()),
        (Acao::Captura, "Ctrl+Alt+Space".to_string()),
    ])
}

static ATUAIS: Mutex<Option<Atalhos>> = Mutex::new(None);
/// Atalhos que o Windows recusou ao subir, com o motivo, para a configuração mostrar.
static FALHAS: Mutex<BTreeMap<Acao, String>> = Mutex::new(BTreeMap::new());

/// Confere a combinação antes de pedir ao Windows: formato válido e sem repetir a de
/// outra ação do próprio Moductus.
pub fn validar(atalhos: &Atalhos, acao: Acao, combinacao: &str) -> Result<Shortcut, String> {
    let novo = Shortcut::from_str(combinacao).map_err(|_| format!("\"{combinacao}\" não é um atalho válido"))?;
    if novo.mods.is_empty() {
        return Err("o atalho precisa de Ctrl, Alt, Shift ou Win".to_string());
    }
    for (outra, texto) in atalhos {
        if *outra != acao && Shortcut::from_str(texto).map(|s| s.id() == novo.id()).unwrap_or(false) {
            return Err(format!("{combinacao} já é o atalho para {}", outra.nome()));
        }
    }
    Ok(novo)
}

fn acao_do(atalho: &Shortcut) -> Option<Acao> {
    let guarda = ATUAIS.lock().unwrap();
    guarda
        .as_ref()?
        .iter()
        .find(|(_, t)| Shortcut::from_str(t).map(|s| s.id() == atalho.id()).unwrap_or(false))
        .map(|(a, _)| *a)
}

fn executar(app: &AppHandle, acao: Acao) {
    match acao {
        Acao::Sistema => crate::janelas::sistema_alternar(app.clone()),
        Acao::Captura => crate::janelas::captura_alternar(app.clone()),
        Acao::Dock => crate::dock::alternar_visivel(),
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, atalho, evento| {
            if evento.state() == ShortcutState::Pressed {
                if let Some(acao) = acao_do(atalho) {
                    executar(app, acao);
                }
            }
        })
        .build()
}

/// Registra os atalhos ao subir. Um que o Windows recuse fica de fora e vai para o log.
pub fn iniciar(app: &AppHandle, atalhos: Atalhos) {
    for (acao, texto) in &atalhos {
        match Shortcut::from_str(texto).map_err(|e| e.to_string()).and_then(|s| app.global_shortcut().register(s).map_err(|e| e.to_string())) {
            Ok(()) => {}
            Err(e) => {
                crate::registro::info(&format!("atalho {texto} ({}) não registrado: {e}", acao.nome()));
                FALHAS.lock().unwrap().insert(*acao, format!("{texto} já está em uso por outro programa"));
            }
        }
    }
    *ATUAIS.lock().unwrap() = Some(atalhos);
}

pub fn atuais() -> Atalhos {
    ATUAIS.lock().unwrap().clone().unwrap_or_else(padrao)
}

/// Troca o atalho de uma ação. Em conflito devolve o motivo e mantém o anterior.
pub fn definir(app: &AppHandle, acao: Acao, combinacao: &str) -> Result<Atalhos, String> {
    let atalhos = atuais();
    let novo = validar(&atalhos, acao, combinacao)?;
    let anterior = atalhos.get(&acao).and_then(|t| Shortcut::from_str(t).ok());
    if anterior.map(|a| a.id()) == Some(novo.id()) {
        return Ok(atalhos);
    }
    app.global_shortcut()
        .register(novo)
        .map_err(|_| format!("{combinacao} já está em uso por outro programa"))?;
    if let Some(a) = anterior {
        let _ = app.global_shortcut().unregister(a);
    }
    FALHAS.lock().unwrap().remove(&acao);
    let mut atalhos = atalhos;
    atalhos.insert(acao, combinacao.to_string());
    *ATUAIS.lock().unwrap() = Some(atalhos.clone());
    Ok(atalhos)
}

#[tauri::command]
pub fn atalhos_obter() -> Atalhos {
    atuais()
}

#[tauri::command]
pub fn atalhos_falhas() -> BTreeMap<Acao, String> {
    FALHAS.lock().unwrap().clone()
}

#[tauri::command]
pub fn atalhos_definir(app: AppHandle, acao: Acao, combinacao: String) -> Result<Atalhos, String> {
    let resultado = definir(app.app_handle(), acao, &combinacao);
    if let Err(motivo) = &resultado {
        crate::registro::info(&format!("atalho recusado: {motivo}"));
    }
    resultado
}

/// Só no debug: o roteiro atalhos pede Ctrl+Alt+<tecla> para o Sistema. Roda fora da
/// thread da janela, porque o plugin registra o atalho pela thread principal.
#[cfg(debug_assertions)]
pub fn teste_definir_sistema(tecla: char) {
    std::thread::spawn(move || {
        if let Some(app) = crate::dock::app() {
            let _ = atalhos_definir(app, Acao::Sistema, format!("Ctrl+Alt+{tecla}"));
        }
    });
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn padrao_tem_os_tres_atalhos_do_produto() {
        let p = padrao();
        assert_eq!(p[&Acao::Sistema], "Ctrl+Alt+N");
        assert_eq!(p[&Acao::Dock], "Ctrl+Alt+D");
        assert_eq!(p[&Acao::Captura], "Ctrl+Alt+Space");
        for (acao, texto) in &p {
            assert!(validar(&p, *acao, texto).is_ok(), "{texto}");
        }
    }

    #[test]
    fn conflito_com_outra_acao_diz_qual() {
        let erro = validar(&padrao(), Acao::Captura, "ctrl+alt+n").unwrap_err();
        assert_eq!(erro, "ctrl+alt+n já é o atalho para abrir o Sistema");
    }

    #[test]
    fn recusa_combinacao_invalida_ou_sem_modificador() {
        assert!(validar(&padrao(), Acao::Dock, "Ctrl+Alt+Nada").unwrap_err().contains("não é um atalho válido"));
        assert!(validar(&padrao(), Acao::Dock, "F5").unwrap_err().contains("precisa de Ctrl"));
    }
}
