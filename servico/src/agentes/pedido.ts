import type { MensagemModelo } from "../provedores/provedor.ts";

/**
 * O que vai ao modelo além das ferramentas: as instruções do agente com a voz da família e o
 * histórico curto da conversa. O contexto que importa chega pelas ferramentas que o agente chama,
 * nunca por um despejo do banco (AGENTS.md §4 "Escopo").
 */

/** As regras de escrita que valem para os quatro (AGENTS.md §2 "Voz dos agentes"). */
export const VOZ_DA_FAMILIA = [
  "Como você fala (vale para todo o time do Moductus):",
  "- Até duas frases por fala; número antes de adjetivo.",
  '- Primeira pessoa para o que você fez ("Movi", "Achei"); "você" para o usuário, sem chamá-lo pelo nome a cada fala.',
  '- Sem emoji, sem "ops", sem exclamação em alerta, sem humor em erro, espera ou dinheiro.',
  "- Má notícia: primeiro o impacto, depois o motivo, depois a saída. Nunca insinue que a culpa é do usuário.",
  "- Peça desculpa só quando o erro foi seu, e uma vez.",
  "- Pedido de aprovação diz o que vai acontecer, o tamanho (quantos, quanto) e se dá para desfazer.",
].join("\n");

/** O prompt de sistema: quem o agente é e como fala. Instrução apagada pelo usuário volta à função. */
export function montarInstrucoes(agente: { nome: string; funcao: string; instrucoes: string }): string {
  const proprias = agente.instrucoes.trim() || `Você é ${agente.nome}. ${agente.funcao}.`;
  return `${proprias}\n\n${VOZ_DA_FAMILIA}`;
}

export interface LimiteHistorico {
  mensagens: number;
  caracteres: number;
}

/** Quanto da conversa vai junto: o bastante para seguir o assunto, sem pagar a conversa inteira. */
export const HISTORICO_CURTO: LimiteHistorico = { mensagens: 20, caracteres: 12_000 };

/**
 * As últimas falas que cabem no limite, na ordem da conversa. A última sempre vai, mesmo maior que
 * o limite: é o pedido a responder.
 */
export function historicoCurto(
  mensagens: readonly MensagemModelo[],
  limite: LimiteHistorico = HISTORICO_CURTO,
): MensagemModelo[] {
  const curto: MensagemModelo[] = [];
  let caracteres = 0;
  for (let i = mensagens.length - 1; i >= 0 && curto.length < limite.mensagens; i--) {
    const mensagem = mensagens[i]!;
    caracteres += mensagem.texto.length;
    if (curto.length > 0 && caracteres > limite.caracteres) break;
    curto.push(mensagem);
  }
  return curto.reverse();
}

/** Tamanho do resumo da execução no histórico do agente. */
const RESUMO_MAXIMO = 200;

/** O que a execução disse, numa linha curta para o histórico; `null` quando não disse nada. */
export function resumir(texto: string): string | null {
  const linha = texto.replace(/\s+/g, " ").trim();
  if (linha === "") return null;
  if (linha.length <= RESUMO_MAXIMO) return linha;
  return `${linha.slice(0, RESUMO_MAXIMO - 1).trimEnd()}…`;
}
