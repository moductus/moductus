//! A parte nativa da configuração: o serviço guarda tudo no banco, mas dock, atalhos e
//! autostart só a casca sabe aplicar. O serviço pede `{"tipo":"aplicar","config",
//! "mudou"}` pelo canal do sidecar e só grava se a casca responder sem erro.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    atalhos::{self, Acao},
    dock, inicio,
};

#[derive(Debug, Deserialize)]
pub struct AtalhosConfig {
    pub sistema: String,
    pub dock: String,
    pub captura: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfigNativa {
    pub dock: dock::Configuracao,
    pub atalhos: AtalhosConfig,
    pub autostart: bool,
}

#[derive(Debug, Deserialize)]
pub struct PedidoAplicar {
    pub config: ConfigNativa,
    #[serde(default)]
    pub mudou: Vec<String>,
}

/// Atalhos pedidos que diferem dos atuais, na ordem em que serão registrados.
pub fn atalhos_mudados(atuais: &atalhos::Atalhos, pedidos: &AtalhosConfig) -> Vec<(Acao, String)> {
    [(Acao::Sistema, &pedidos.sistema), (Acao::Dock, &pedidos.dock), (Acao::Captura, &pedidos.captura)]
        .into_iter()
        .filter(|(acao, novo)| atuais.get(acao).map(|a| !a.eq_ignore_ascii_case(novo)).unwrap_or(true))
        .map(|(acao, novo)| (acao, novo.clone()))
        .collect()
}

/// Aplica dock e autostart primeiro (não falham por conflito) e os atalhos por último:
/// se um atalho é recusado, os já trocados nesta chamada voltam ao anterior.
pub fn aplicar(app: &AppHandle, pedido: PedidoAplicar) -> Value {
    let mudou = |chave: &str| pedido.mudou.iter().any(|m| m == chave);
    let c = pedido.config;

    if mudou("dock") && dock::configuracao() != c.dock {
        dock::aplicar(c.dock);
    }
    if mudou("autostart") && inicio::autostart_obter(app.clone()) != c.autostart {
        if let Err(e) = inicio::autostart_definir(app.clone(), c.autostart) {
            return json!({ "erro": e });
        }
    }
    if mudou("atalhos") {
        let anteriores = atalhos::atuais();
        let mut trocados: Vec<Acao> = Vec::new();
        for (acao, combinacao) in atalhos_mudados(&anteriores, &c.atalhos) {
            match atalhos::definir(app, acao, &combinacao) {
                Ok(_) => trocados.push(acao),
                Err(motivo) => {
                    for a in trocados {
                        if let Some(antigo) = anteriores.get(&a) {
                            let _ = atalhos::definir(app, a, antigo);
                        }
                    }
                    crate::registro::info(&format!("configuração recusada: {motivo}"));
                    return json!({ "erro": motivo });
                }
            }
        }
    }
    json!({ "ok": true, "falhas_atalhos": atalhos::atalhos_falhas() })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_o_pedido_do_servico() {
        let linha = r#"{"tipo":"aplicar","id":3,"mudou":["dock"],"config":{"tema":"papel",
            "dock":{"lado":"direita","modo":"esconder","forma":"flutuante"},
            "atalhos":{"sistema":"Ctrl+Alt+N","dock":"Ctrl+Alt+D","captura":"Ctrl+Alt+K"},
            "autostart":true}}"#;
        let p: PedidoAplicar = serde_json::from_str(linha).unwrap();
        assert_eq!(p.mudou, vec!["dock"]);
        assert_eq!(p.config.dock.lado, crate::appbar::Lado::Direita);
        assert_eq!(p.config.dock.modo, dock::Modo::Esconder);
        assert!(p.config.autostart);
    }

    #[test]
    fn so_os_atalhos_diferentes_sao_trocados() {
        let atuais = atalhos::padrao();
        let pedidos = AtalhosConfig { sistema: "ctrl+alt+n".into(), dock: "Ctrl+Alt+D".into(), captura: "Ctrl+Alt+K".into() };
        assert_eq!(atalhos_mudados(&atuais, &pedidos), vec![(Acao::Captura, "Ctrl+Alt+K".to_string())]);
    }
}
