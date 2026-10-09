//! Material das janelas por tema: o Vidro usa o Acrylic nativo do Windows 11 quando o
//! Windows deixa; senão (Windows 10, "efeitos de transparência" desligados, economia de
//! bateria ou falha ao aplicar) a interface usa o fundo sólido do Vidro. Os outros temas
//! são sólidos e ficam sem efeito.

use tauri::{
    window::{Effect, EffectsBuilder},
    WebviewWindow,
};
use windows::{
    core::{w, PCWSTR},
    Win32::System::{
        Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
        Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ},
    },
};

/// O que o Windows diz sobre poder desenhar vidro agora.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sinais {
    pub windows_11: bool,
    pub transparencia: bool,
    pub economia_bateria: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Material {
    Acrylic,
    Solido,
}

impl Material {
    pub fn nome(self) -> &'static str {
        match self {
            Material::Acrylic => "acrylic",
            Material::Solido => "solido",
        }
    }
}

/// Decisão pura: Acrylic só no Vidro e só quando todos os sinais permitem.
pub fn decidir(vidro: bool, sinais: Sinais) -> Material {
    if vidro && sinais.windows_11 && sinais.transparencia && !sinais.economia_bateria {
        Material::Acrylic
    } else {
        Material::Solido
    }
}

fn ler_dword(raiz: HKEY, chave: PCWSTR, valor: PCWSTR) -> Option<u32> {
    let mut dado = 0u32;
    let mut tamanho = size_of::<u32>() as u32;
    let erro = unsafe {
        RegGetValueW(raiz, chave, valor, RRF_RT_REG_DWORD, None, Some(&mut dado as *mut u32 as _), Some(&mut tamanho))
    };
    erro.is_ok().then_some(dado)
}

fn ler_texto(raiz: HKEY, chave: PCWSTR, valor: PCWSTR) -> Option<String> {
    let mut dado = [0u16; 64];
    let mut tamanho = (dado.len() * 2) as u32;
    let erro = unsafe {
        RegGetValueW(raiz, chave, valor, RRF_RT_REG_SZ, None, Some(dado.as_mut_ptr() as _), Some(&mut tamanho))
    };
    if erro.is_err() {
        return None;
    }
    let fim = dado.iter().position(|&c| c == 0).unwrap_or(dado.len());
    Some(String::from_utf16_lossy(&dado[..fim]))
}

/// Lê os sinais do Windows. Na dúvida (chave ausente), vale o padrão do Windows.
pub fn sinais() -> Sinais {
    // O Windows 11 começa no build 22000; o Windows 10 fica no sólido (DESIGN.md §4).
    let windows_11 = ler_texto(HKEY_LOCAL_MACHINE, w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"), w!("CurrentBuildNumber"))
        .and_then(|b| b.trim().parse::<u32>().ok())
        .is_some_and(|build| build >= 22000);
    let transparencia = ler_dword(
        HKEY_CURRENT_USER,
        w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
        w!("EnableTransparency"),
    )
    .is_none_or(|v| v != 0);
    let mut energia = SYSTEM_POWER_STATUS::default();
    // SystemStatusFlag = 1: economia de bateria (ou de energia) ligada.
    let economia_bateria = unsafe { GetSystemPowerStatus(&mut energia) }.is_ok() && energia.SystemStatusFlag == 1;
    Sinais { windows_11, transparencia, economia_bateria }
}

/// Aplica o material do tema na janela que chamou e diz qual ficou ("acrylic" ou "solido").
#[tauri::command]
pub fn tema_material(janela: WebviewWindow, vidro: bool) -> String {
    let sinais = sinais();
    let mut material = decidir(vidro, sinais);
    if material == Material::Acrylic {
        if let Err(e) = janela.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build()) {
            crate::registro::info(&format!("material: acrylic falhou em {}: {e}", janela.label()));
            material = Material::Solido;
        }
    }
    if material == Material::Solido {
        let _ = janela.set_effects(None);
    }
    crate::registro::info(&format!(
        "material: {} {} (windows 11 {}, transparência {}, economia {})",
        janela.label(),
        material.nome(),
        sinais.windows_11,
        sinais.transparencia,
        sinais.economia_bateria
    ));
    material.nome().to_string()
}

#[cfg(test)]
mod testes {
    use super::*;

    const LIVRE: Sinais = Sinais { windows_11: true, transparencia: true, economia_bateria: false };

    #[test]
    fn vidro_com_tudo_permitido_e_acrylic() {
        assert_eq!(decidir(true, LIVRE), Material::Acrylic);
    }

    #[test]
    fn vidro_cai_para_solido_quando_o_windows_nao_deixa() {
        assert_eq!(decidir(true, Sinais { transparencia: false, ..LIVRE }), Material::Solido);
        assert_eq!(decidir(true, Sinais { economia_bateria: true, ..LIVRE }), Material::Solido);
        assert_eq!(decidir(true, Sinais { windows_11: false, ..LIVRE }), Material::Solido);
    }

    #[test]
    fn outros_temas_sao_sempre_solidos() {
        assert_eq!(decidir(false, LIVRE), Material::Solido);
        assert_eq!(decidir(false, Sinais { transparencia: false, ..LIVRE }), Material::Solido);
    }

    #[test]
    fn le_os_sinais_desta_maquina() {
        // Não afirma valores (dependem da máquina); garante que a leitura não falha e mostra.
        let s = sinais();
        println!("sinais desta máquina: {s:?} -> vidro {}", decidir(true, s).nome());
    }
}
