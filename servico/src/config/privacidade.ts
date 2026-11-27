import type { EstadoConfig, Privacidade } from "@moductus/contrato";
import type { CanalCasca } from "../casca/canal.ts";
import type { ServicoConfig } from "./config.ts";

/**
 * Tipo do aviso que a casca manda, sem pedido, quando o atalho do modo privacidade (Ctrl+Alt+H,
 * configurável) é apertado em qualquer lugar (`src-tauri/src/atalhos.rs`, ação `Privacidade`).
 */
export const ATALHO_DA_PRIVACIDADE = "privacidade-alternar";

/**
 * O modo privacidade (ADR-0047) é a chave `privacidade` da configuração deste PC: o atalho, a
 * bandeja e Configurações passam todos por `config.definir`, que grava e avisa. Alternar lê o
 * estado salvo na hora, para dois toques seguidos não se anularem com um estado velho.
 */
export async function alternarPrivacidade(
  config: Pick<ServicoConfig, "obter" | "definir">,
): Promise<EstadoConfig> {
  const ativo = config.obter().config.privacidade.ativo;
  return config.definir({ privacidade: { ativo: !ativo } });
}

/**
 * Quem ouve a configuração mudada (venha do atalho, da bandeja, de Configurações ou de uma
 * importação) e chama `mudou` só quando o modo ligou ou desligou de verdade: é o que vira o
 * evento `privacidade.mudou`.
 */
export function vigiarPrivacidade(
  inicial: Privacidade,
  mudou: (privacidade: Privacidade) => void,
): (privacidade: Privacidade) => void {
  let anterior = inicial.ativo;
  return (privacidade) => {
    if (privacidade.ativo === anterior) return;
    anterior = privacidade.ativo;
    mudou({ ativo: privacidade.ativo });
  };
}

/** O atalho vindo da casca liga ou desliga o modo; uma falha vai ao log e não derruba o canal. */
export function ouvirAtalhoDaPrivacidade(
  canal: Pick<CanalCasca, "aoAvisar">,
  config: Pick<ServicoConfig, "obter" | "definir">,
): void {
  canal.aoAvisar(ATALHO_DA_PRIVACIDADE, () => {
    alternarPrivacidade(config).catch((erro: unknown) => {
      console.error(`privacidade: atalho falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    });
  });
}
