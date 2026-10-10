//! Aviso do Windows (toast) com os botões que o serviço manda.
//!
//! Quem decide se o aviso sai é o serviço (preferência por agente e tipo, silêncio); a casca só
//! mostra, retira e diz se há tela cheia. O id da notificação vira a tag do aviso. O clique num
//! botão (ou no corpo) volta ao serviço como `{"tipo":"notificacao-clique",…}` pelo canal do
//! sidecar; o clique no corpo também abre o painel do time.
//!
//! App sem pacote só mostra aviso com um AppUserModelID registrado: instalado, o atalho do Menu
//! Iniciar leva o identificador do app; rodando de `target\debug` ou `target\release`, o aviso sai
//! pelo id do PowerShell, como faz o plugin de notificação do Tauri. A cópia portable, sem atalho,
//! não tem como mostrar o aviso: fica o ponto no dock.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use windows::{
    core::{IInspectable, Interface, HSTRING},
    Data::Xml::Dom::XmlDocument,
    Foundation::TypedEventHandler,
    UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager},
    Win32::{
        System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
        UI::Shell::SHQueryUserNotificationState,
    },
};

/// O AppUserModelID do PowerShell, registrado em todo Windows: serve ao app fora do instalador.
const AUMID_POWERSHELL: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";
/// Grupo dos avisos do Moductus na Central de Notificações.
const GRUPO: &str = "moductus";
/// O Windows mostra no máximo 5 botões por aviso.
const MAXIMO_BOTOES: usize = 5;
/// Argumento do clique no corpo do aviso; o dos botões é `botao=<id>`.
const CORPO: &str = "corpo";
const PREFIXO_BOTAO: &str = "botao=";
/// Avisos guardados para o clique chegar: o Windows segura a tag, a casca segura o objeto.
const MAXIMO_GUARDADOS: usize = 50;

static APP: OnceLock<AppHandle> = OnceLock::new();
static AUMID: OnceLock<String> = OnceLock::new();
static GUARDADOS: Mutex<Vec<(String, ToastNotification)>> = Mutex::new(Vec::new());

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Botao {
    pub id: String,
    pub rotulo: String,
}

/// Pedido do serviço à casca, pelo canal do sidecar.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Pedido {
    Mostrar {
        notificacao: String,
        #[serde(default)]
        agente: Option<String>,
        titulo: String,
        #[serde(default)]
        corpo: Option<String>,
        #[serde(default)]
        botoes: Vec<Botao>,
    },
    Retirar {
        notificacao: String,
    },
    TelaCheia,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Resposta {
    Ok { ok: bool },
    TelaCheia { tela_cheia: bool },
    Erro { erro: String },
}

/// Guarda o app para o clique abrir o painel e escolhe o AppUserModelID.
pub fn iniciar(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let pasta = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.display().to_string()));
    let fora_do_instalador =
        pasta.is_some_and(|p| p.ends_with(r"\target\debug") || p.ends_with(r"\target\release"));
    let aumid = if fora_do_instalador { AUMID_POWERSHELL.to_string() } else { app.config().identifier.clone() };
    let _ = AUMID.set(aumid);
}

fn aumid() -> HSTRING {
    HSTRING::from(AUMID.get().map(String::as_str).unwrap_or(AUMID_POWERSHELL))
}

/// Texto dentro do XML do aviso: o título e o corpo vêm do agente e do terminal.
fn escapar(texto: &str) -> String {
    let mut saida = String::with_capacity(texto.len());
    for c in texto.chars() {
        match c {
            '&' => saida.push_str("&amp;"),
            '<' => saida.push_str("&lt;"),
            '>' => saida.push_str("&gt;"),
            '"' => saida.push_str("&quot;"),
            '\'' => saida.push_str("&apos;"),
            // Controle fora de \t, \n e \r não existe em XML 1.0: o documento seria recusado.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => saida.push(c),
        }
    }
    saida
}

/// O XML do aviso (esquema ToastGeneric): título, corpo, o agente na linha de atribuição e os
/// botões na ordem do cartão. Ativação em primeiro plano: o clique chega pelo `Activated`.
pub fn xml_do_aviso(agente: Option<&str>, titulo: &str, corpo: Option<&str>, botoes: &[Botao]) -> String {
    let mut textos = format!("<text>{}</text>", escapar(titulo));
    if let Some(corpo) = corpo.filter(|c| !c.is_empty()) {
        textos.push_str(&format!("<text>{}</text>", escapar(corpo)));
    }
    if let Some(agente) = agente.filter(|a| !a.is_empty()) {
        textos.push_str(&format!("<text placement=\"attribution\">{}</text>", escapar(agente)));
    }
    let acoes: String = botoes
        .iter()
        .take(MAXIMO_BOTOES)
        .map(|b| {
            format!(
                "<action content=\"{}\" arguments=\"{}{}\" activationType=\"foreground\"/>",
                escapar(&b.rotulo),
                PREFIXO_BOTAO,
                escapar(&b.id)
            )
        })
        .collect();
    let acoes = if acoes.is_empty() { String::new() } else { format!("<actions>{acoes}</actions>") };
    format!(
        "<toast launch=\"{CORPO}\" activationType=\"foreground\"><visual><binding template=\"ToastGeneric\">{textos}</binding></visual>{acoes}</toast>"
    )
}

/// O botão clicado pelos argumentos da ativação; `None` é o corpo do aviso.
pub fn botao_dos_argumentos(argumentos: &str) -> Option<String> {
    argumentos.strip_prefix(PREFIXO_BOTAO).filter(|b| !b.is_empty()).map(str::to_string)
}

fn guardar(tag: &str, aviso: ToastNotification) {
    let mut guardados = GUARDADOS.lock().unwrap();
    guardados.retain(|(t, _)| t != tag);
    guardados.push((tag.to_string(), aviso));
    let excesso = guardados.len().saturating_sub(MAXIMO_GUARDADOS);
    guardados.drain(..excesso);
}

fn esquecer(tag: &str) -> Option<ToastNotification> {
    let mut guardados = GUARDADOS.lock().unwrap();
    let posicao = guardados.iter().position(|(t, _)| t == tag)?;
    Some(guardados.remove(posicao).1)
}

fn ao_clicar(tag: &str, argumentos: &str) {
    let botao = botao_dos_argumentos(argumentos);
    crate::servico::avisar(serde_json::json!({ "tipo": "notificacao-clique", "notificacao": tag, "botao": botao }));
    if botao.is_none() {
        if let Some(app) = APP.get() {
            crate::janelas::painel_mostrar(app.clone(), "agentes".to_string());
        }
    }
    esquecer(tag);
}

fn mostrar(tag: &str, agente: Option<&str>, titulo: &str, corpo: Option<&str>, botoes: &[Botao]) -> windows::core::Result<()> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let documento = XmlDocument::new()?;
    documento.LoadXml(&HSTRING::from(xml_do_aviso(agente, titulo, corpo, botoes)))?;
    let aviso = ToastNotification::CreateToastNotification(&documento)?;
    aviso.SetTag(&HSTRING::from(tag))?;
    aviso.SetGroup(&HSTRING::from(GRUPO))?;
    let dono = tag.to_string();
    aviso.Activated(&TypedEventHandler::new(move |_, argumentos: windows::core::Ref<IInspectable>| {
        let argumentos = argumentos
            .ok()
            .ok()
            .and_then(|a| a.cast::<ToastActivatedEventArgs>().ok())
            .and_then(|a| a.Arguments().ok())
            .map(|a| a.to_string())
            .unwrap_or_default();
        ao_clicar(&dono, &argumentos);
        Ok(())
    }))?;
    ToastNotificationManager::CreateToastNotifierWithId(&aumid())?.Show(&aviso)?;
    guardar(tag, aviso);
    Ok(())
}

fn retirar(tag: &str) {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    if let Some(aviso) = esquecer(tag) {
        if let Ok(notificador) = ToastNotificationManager::CreateToastNotifierWithId(&aumid()) {
            let _ = notificador.Hide(&aviso);
        }
    }
    // Já fora da tela, ainda pode estar na Central de Notificações.
    if let Ok(historico) = ToastNotificationManager::History() {
        let _ = historico.RemoveGroupedTagWithId(&HSTRING::from(tag), &HSTRING::from(GRUPO), &aumid());
    }
}

pub fn atender(pedido: Pedido) -> Resposta {
    match pedido {
        Pedido::Mostrar { notificacao, agente, titulo, corpo, botoes } => {
            match mostrar(&notificacao, agente.as_deref(), &titulo, corpo.as_deref(), &botoes) {
                Ok(()) => {
                    crate::registro::info(&format!("aviso do Windows: {notificacao}"));
                    Resposta::Ok { ok: true }
                }
                Err(e) => Resposta::Erro { erro: format!("o Windows recusou o aviso: {}", e.message()) },
            }
        }
        Pedido::Retirar { notificacao } => {
            retirar(&notificacao);
            Resposta::Ok { ok: true }
        }
        Pedido::TelaCheia => Resposta::TelaCheia {
            tela_cheia: unsafe { SHQueryUserNotificationState() }.map(crate::tela_cheia::em_tela_cheia).unwrap_or(false),
        },
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn botao(id: &str, rotulo: &str) -> Botao {
        Botao { id: id.into(), rotulo: rotulo.into() }
    }

    #[test]
    fn xml_tem_titulo_corpo_agente_e_os_botoes_na_ordem() {
        let xml = xml_do_aviso(
            Some("Nuno"),
            "Claude Code pede permissão",
            Some("Rodar pnpm test em moductus."),
            &[botao("negar", "Negar"), botao("sempre", "Sempre aqui"), botao("permitir", "Permitir")],
        );
        assert!(xml.starts_with("<toast launch=\"corpo\" activationType=\"foreground\">"));
        assert!(xml.contains("<text>Claude Code pede permissão</text><text>Rodar pnpm test em moductus.</text>"));
        assert!(xml.contains("<text placement=\"attribution\">Nuno</text>"));
        let negar = xml.find("arguments=\"botao=negar\"").unwrap();
        let sempre = xml.find("arguments=\"botao=sempre\"").unwrap();
        let permitir = xml.find("arguments=\"botao=permitir\"").unwrap();
        assert!(negar < sempre && sempre < permitir);
    }

    #[test]
    fn texto_do_terminal_nao_quebra_o_xml() {
        let xml = xml_do_aviso(None, "rm -rf \"dist\" && echo <ok>", Some("a\u{1}b"), &[botao("x\"y", "A & B")]);
        assert!(xml.contains("<text>rm -rf &quot;dist&quot; &amp;&amp; echo &lt;ok&gt;</text>"));
        assert!(xml.contains("<text>ab</text>"));
        assert!(xml.contains("content=\"A &amp; B\" arguments=\"botao=x&quot;y\""));
        assert!(!xml.contains("attribution"));
    }

    #[test]
    fn sem_botoes_nao_ha_actions_e_passa_de_cinco_corta() {
        assert!(!xml_do_aviso(None, "t", None, &[]).contains("<actions>"));
        let muitos: Vec<Botao> = (0..7).map(|i| botao(&i.to_string(), "b")).collect();
        assert_eq!(xml_do_aviso(None, "t", None, &muitos).matches("<action ").count(), 5);
    }

    #[test]
    fn o_xml_carrega_no_windows() {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let documento = XmlDocument::new().unwrap();
        let xml = xml_do_aviso(Some("Faina"), "Organizar <Downloads>", Some("142 & 6"), &[botao("permitir", "Organizar")]);
        documento.LoadXml(&HSTRING::from(xml)).unwrap();
        assert!(ToastNotification::CreateToastNotification(&documento).is_ok());
    }

    #[test]
    fn argumentos_dizem_o_botao_ou_o_corpo() {
        assert_eq!(botao_dos_argumentos("botao=permitir"), Some("permitir".into()));
        assert_eq!(botao_dos_argumentos("corpo"), None);
        assert_eq!(botao_dos_argumentos("botao="), None);
        assert_eq!(botao_dos_argumentos(""), None);
    }

    #[test]
    fn pedido_do_servico_pelo_op() {
        let mostrar: Pedido = serde_json::from_str(
            r#"{"tipo":"notificacao","id":3,"op":"mostrar","notificacao":"n1","agente":null,"titulo":"t","corpo":null,"botoes":[{"id":"permitir","rotulo":"Permitir"}]}"#,
        )
        .unwrap();
        assert!(matches!(mostrar, Pedido::Mostrar { ref botoes, .. } if botoes == &vec![botao("permitir", "Permitir")]));
        assert!(matches!(serde_json::from_str::<Pedido>(r#"{"tipo":"notificacao","id":4,"op":"tela-cheia"}"#).unwrap(), Pedido::TelaCheia));
        assert!(matches!(
            serde_json::from_str::<Pedido>(r#"{"op":"retirar","notificacao":"n1"}"#).unwrap(),
            Pedido::Retirar { .. }
        ));
        assert_eq!(serde_json::to_string(&Resposta::TelaCheia { tela_cheia: false }).unwrap(), r#"{"tela_cheia":false}"#);
    }
}
