//! Variáveis de ambiente do usuário do Windows (`HKCU\Environment`).
//!
//! O serviço publica aqui o token dos hooks como `MODUCTUS_HOOKS_TOKEN` (ADR-0015): o
//! `settings.json` do Claude Code o lê do ambiente (`allowedEnvVars`). Só nomes que começam
//! com `MODUCTUS_` passam, para que o serviço nunca mexa em `PATH` ou em variável de outro
//! programa. Depois de gravar, o Windows avisa os programas abertos (`WM_SETTINGCHANGE`),
//! mas terminal já aberto não relê o ambiente: a Conexão pede um terminal novo. O registro
//! leva só o nome, nunca o valor.

use std::{ffi::c_void, iter::once, thread};

use serde::{Deserialize, Serialize};
use windows::{
    core::{w, HSTRING},
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, LPARAM, WPARAM},
        System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ},
        UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE},
    },
};

const PREFIXO: &str = "MODUCTUS_";
/// Onde o Windows guarda as variáveis do usuário.
const CHAVE_AMBIENTE: &str = "Environment";

fn nome_valido(nome: &str) -> Result<(), String> {
    let ok = nome.len() > PREFIXO.len()
        && nome.len() <= 64
        && nome.starts_with(PREFIXO)
        && nome.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("variável fora do Moductus: {nome:?}"))
    }
}

fn definir_em(chave: &str, nome: &str, valor: &str) -> Result<(), String> {
    nome_valido(nome)?;
    let dado: Vec<u16> = valor.encode_utf16().chain(once(0)).collect();
    unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(chave),
            &HSTRING::from(nome),
            REG_SZ.0,
            Some(dado.as_ptr() as *const c_void),
            (dado.len() * size_of::<u16>()) as u32,
        )
    }
    .ok()
    .map_err(|e| format!("não foi possível definir {nome}: {}", e.message()))
}

fn apagar_em(chave: &str, nome: &str) -> Result<(), String> {
    nome_valido(nome)?;
    let erro = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(chave), &HSTRING::from(nome)) };
    if erro.is_ok() || erro == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!("não foi possível apagar {nome}: {}", erro.to_hresult().message()))
    }
}

/// Avisa os programas abertos (o Explorer, que dá o ambiente aos terminais novos). Fora da
/// thread do canal: uma janela lenta não segura a resposta ao serviço.
fn avisar_windows() {
    thread::spawn(|| unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(w!("Environment").as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            5000,
            None,
        );
    });
}

pub fn definir(nome: &str, valor: &str) -> Result<(), String> {
    definir_em(CHAVE_AMBIENTE, nome, valor)?;
    crate::registro::info(&format!("variável do usuário definida: {nome}"));
    avisar_windows();
    Ok(())
}

pub fn apagar(nome: &str) -> Result<(), String> {
    apagar_em(CHAVE_AMBIENTE, nome)?;
    crate::registro::info(&format!("variável do usuário apagada: {nome}"));
    avisar_windows();
    Ok(())
}

/// Pedido do serviço à casca, pelo canal do sidecar.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Pedido {
    Definir { nome: String, valor: String },
    Apagar { nome: String },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Resposta {
    Ok { ok: bool },
    Erro { erro: String },
}

pub fn atender(pedido: Pedido) -> Resposta {
    let resultado = match pedido {
        Pedido::Definir { nome, valor } => definir(&nome, &valor),
        Pedido::Apagar { nome } => apagar(&nome),
    };
    resultado.map(|_| Resposta::Ok { ok: true }).unwrap_or_else(|erro| Resposta::Erro { erro })
}

#[cfg(test)]
mod testes {
    use super::*;
    use windows::Win32::System::Registry::{RegDeleteTreeW, RegGetValueW, RRF_RT_REG_SZ};

    fn ler_em(chave: &str, nome: &str) -> Option<String> {
        let mut dado = [0u16; 256];
        let mut tamanho = (dado.len() * 2) as u32;
        let erro = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(chave),
                &HSTRING::from(nome),
                RRF_RT_REG_SZ,
                None,
                Some(dado.as_mut_ptr() as _),
                Some(&mut tamanho),
            )
        };
        if erro.is_err() {
            return None;
        }
        let fim = dado.iter().position(|&c| c == 0).unwrap_or(dado.len());
        Some(String::from_utf16_lossy(&dado[..fim]))
    }

    /// Numa chave descartável, nunca em `Environment`: o teste não muda o ambiente da máquina.
    #[test]
    fn ida_e_volta_numa_chave_de_teste() {
        let chave = format!(r"Software\Moductus-teste\ambiente-{}", std::process::id());
        let nome = "MODUCTUS_TESTE_AMBIENTE";
        definir_em(&chave, nome, "valor de teste ção").unwrap();
        assert_eq!(ler_em(&chave, nome).as_deref(), Some("valor de teste ção"));
        apagar_em(&chave, nome).unwrap();
        assert_eq!(ler_em(&chave, nome), None);
        // Apagar o que não existe não é erro: desligar duas vezes dá no mesmo.
        apagar_em(&chave, nome).unwrap();
        unsafe {
            let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(r"Software\Moductus-teste"));
        }
    }

    #[test]
    fn recusa_variavel_que_nao_e_do_moductus() {
        for nome in ["PATH", "MODUCTUS_", "moductus_hooks_token", "MODUCTUS_A B", "OUTRO_MODUCTUS_X"] {
            assert!(matches!(
                atender(Pedido::Definir { nome: nome.into(), valor: "x".into() }),
                Resposta::Erro { .. }
            ));
            assert!(matches!(atender(Pedido::Apagar { nome: nome.into() }), Resposta::Erro { .. }));
        }
    }

    #[test]
    fn pedido_do_canal() {
        let pedido: Pedido = serde_json::from_str(r#"{"tipo":"ambiente","id":3,"op":"apagar","nome":"MODUCTUS_X"}"#).unwrap();
        assert!(matches!(pedido, Pedido::Apagar { nome } if nome == "MODUCTUS_X"));
    }
}
