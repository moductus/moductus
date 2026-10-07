//! Segredos (chaves de API, tokens) no Gerenciador de Credenciais do Windows.
//!
//! Só o serviço chega aqui: não existe comando Tauri para ler um segredo, então nenhuma
//! janela consegue. O serviço pede pelo canal do sidecar (`atender`), e o registro só
//! leva o nome da credencial, nunca o valor.

use serde::{Deserialize, Serialize};
use windows::{
    core::{HSTRING, PWSTR},
    Win32::{
        Foundation::{ERROR_NOT_FOUND, FILETIME},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    },
};

/// Prefixo no Gerenciador de Credenciais: "Moductus/anthropic", "Moductus/github"…
const PREFIXO: &str = "Moductus/";

fn alvo(nome: &str) -> HSTRING {
    HSTRING::from(format!("{PREFIXO}{nome}"))
}

fn nome_valido(nome: &str) -> Result<(), String> {
    let ok = !nome.is_empty() && nome.len() <= 128 && nome.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("nome de credencial inválido: {nome:?}"))
    }
}

pub fn guardar(nome: &str, valor: &str) -> Result<(), String> {
    nome_valido(nome)?;
    let alvo = alvo(nome);
    let mut usuario: Vec<u16> = "moductus\0".encode_utf16().collect();
    let bytes = valor.as_bytes();
    let credencial = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(alvo.as_ptr() as *mut u16),
        Comment: PWSTR::null(),
        LastWritten: FILETIME::default(),
        CredentialBlobSize: bytes.len() as u32,
        CredentialBlob: bytes.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: PWSTR::null(),
        UserName: PWSTR(usuario.as_mut_ptr()),
    };
    unsafe { CredWriteW(&credencial, 0) }.map_err(|e| format!("não foi possível guardar {nome}: {}", e.message()))?;
    crate::registro::info(&format!("credencial guardada: {nome}"));
    Ok(())
}

pub fn ler(nome: &str) -> Result<Option<String>, String> {
    nome_valido(nome)?;
    let mut ponteiro: *mut CREDENTIALW = std::ptr::null_mut();
    match unsafe { CredReadW(&alvo(nome), CRED_TYPE_GENERIC, None, &mut ponteiro) } {
        Ok(()) => {
            let valor = unsafe {
                let c = &*ponteiro;
                let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
                CredFree(ponteiro as *const _);
                String::from_utf8(bytes).map_err(|_| format!("credencial {nome} não é texto"))?
            };
            Ok(Some(valor))
        }
        Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(None),
        Err(e) => Err(format!("não foi possível ler {nome}: {}", e.message())),
    }
}

pub fn apagar(nome: &str) -> Result<(), String> {
    nome_valido(nome)?;
    match unsafe { CredDeleteW(&alvo(nome), CRED_TYPE_GENERIC, None) } {
        Ok(()) => {
            crate::registro::info(&format!("credencial apagada: {nome}"));
            Ok(())
        }
        Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
        Err(e) => Err(format!("não foi possível apagar {nome}: {}", e.message())),
    }
}

/// Pedido do serviço à casca, pelo canal do sidecar.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Pedido {
    Guardar { nome: String, valor: String },
    Ler { nome: String },
    Apagar { nome: String },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Resposta {
    Valor { valor: Option<String> },
    Ok { ok: bool },
    Erro { erro: String },
}

pub fn atender(pedido: Pedido) -> Resposta {
    let resultado = match pedido {
        Pedido::Guardar { nome, valor } => guardar(&nome, &valor).map(|_| Resposta::Ok { ok: true }),
        Pedido::Ler { nome } => ler(&nome).map(|valor| Resposta::Valor { valor }),
        Pedido::Apagar { nome } => apagar(&nome).map(|_| Resposta::Ok { ok: true }),
    };
    resultado.unwrap_or_else(|erro| Resposta::Erro { erro })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn ida_e_volta_no_gerenciador_de_credenciais() {
        let pasta = std::env::temp_dir().join(format!("moductus-teste-cred-{}", std::process::id()));
        std::fs::create_dir_all(&pasta).unwrap();
        crate::registro::iniciar(&pasta);
        let nome = "teste.ida-e-volta";
        let segredo = "sk-teste-NAO-PODE-IR-PARA-O-LOG-123";

        let pedido = |json: &str| atender(serde_json::from_str(json).unwrap());
        assert_eq!(pedido(&format!(r#"{{"op":"guardar","nome":"{nome}","valor":"{segredo}"}}"#)), Resposta::Ok { ok: true });
        assert_eq!(pedido(&format!(r#"{{"op":"ler","nome":"{nome}"}}"#)), Resposta::Valor { valor: Some(segredo.into()) });
        assert_eq!(pedido(&format!(r#"{{"op":"apagar","nome":"{nome}"}}"#)), Resposta::Ok { ok: true });
        assert_eq!(pedido(&format!(r#"{{"op":"ler","nome":"{nome}"}}"#)), Resposta::Valor { valor: None });

        let log = std::fs::read_to_string(pasta.join("moductus.log")).unwrap_or_default();
        assert!(log.contains("credencial guardada: teste.ida-e-volta"));
        assert!(!log.contains(segredo), "o segredo apareceu no log");
        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn recusa_nome_fora_do_padrao() {
        assert!(matches!(atender(Pedido::Ler { nome: "../outro app".into() }), Resposta::Erro { .. }));
        assert!(matches!(atender(Pedido::Ler { nome: String::new() }), Resposta::Erro { .. }));
    }
}
