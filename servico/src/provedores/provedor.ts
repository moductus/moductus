import type { FalhaProvedor, MotivoFalhaProvedor, TipoProvedor } from "@moductus/contrato";

/**
 * O que o serviço espera de qualquer modelo (AGENTS.md §3): um pedido entra, uma sequência de
 * eventos sai. Adaptador de CLI e de API dizem a mesma coisa do mesmo jeito, e o runtime não
 * sabe qual dos dois está do outro lado.
 */

/** Uma fala da conversa que vai ao modelo; o histórico curto é montado pelo runtime. */
export interface MensagemModelo {
  papel: "usuario" | "agente";
  texto: string;
}

/** Ferramenta do catálogo oferecida ao modelo, com a entrada em JSON Schema. */
export interface FerramentaOferecida {
  nome: string;
  descricao: string;
  esquema: Record<string, unknown>;
}

export interface ChamadaDeFerramenta {
  id: string;
  nome: string;
  entrada: unknown;
}

/** O que volta ao modelo: o resultado, ou um erro legível para ele corrigir a chamada. */
export type ResultadoDeFerramenta = { ok: true; valor: unknown } | { ok: false; erro: string };

/**
 * O pedido que um agente faz ao modelo. O nome evita o `PedidoAgente` do contrato, que é outra
 * coisa (o id de um agente no canal).
 */
export interface PedidoDoAgente {
  agenteId: string;
  execucaoId: string;
  /** Instruções do agente e voz da família, que viram o prompt de sistema. */
  instrucoes: string;
  mensagens: readonly MensagemModelo[];
  ferramentas: readonly FerramentaOferecida[];
  /**
   * Quem roda a ferramenta no serviço, com escopo e aprovação. O adaptador de API chama daqui;
   * o de CLI recebe a chamada pelo MCP do Moductus e só relata o resultado.
   */
  executarFerramenta(chamada: ChamadaDeFerramenta): Promise<ResultadoDeFerramenta>;
  /** Sessão anterior do provedor a continuar (`--resume` no Claude Code); `null` começa outra. */
  continuarDe: string | null;
  /**
   * Em que fila o adaptador põe o pedido quando tem fila própria (um processo por vez no CLI);
   * sem ela, a do agente.
   */
  fila?: string;
}

/**
 * Tudo o que um provedor diz durante uma execução. A sequência termina em `fim` ou em `erro`;
 * outra exceção que escape do iterador (inclusive o cancelamento) é falha da execução, não do
 * provedor, e não põe o agente para dormir.
 */
export type EventoAgente =
  /** Pedaço da resposta, para mostrar em streaming. */
  | { tipo: "texto"; texto: string }
  | { tipo: "ferramenta"; chamada: ChamadaDeFerramenta }
  | { tipo: "resultado"; chamadaId: string; resultado: ResultadoDeFerramenta }
  /**
   * Tokens de uma chamada ao modelo; o runtime soma os da execução e estima o custo de cada uma
   * (F2-09). `tokensEntrada` é tudo o que o modelo leu, e `tokensCacheLidos` a parte dela que veio
   * do cache do prompt, mais barata. `modelo` é o que o provedor diz ter usado, quando diz; sem
   * ele, vale o configurado.
   */
  | { tipo: "uso"; tokensEntrada: number; tokensSaida: number; tokensCacheLidos?: number; modelo?: string }
  /** `continuacao` é o que passar em `continuarDe` para seguir a mesma sessão. */
  | { tipo: "fim"; continuacao: string | null }
  | { tipo: "erro"; falha: FalhaProvedor };

export interface Provedor {
  /** O id da linha em `provedores`. */
  readonly id: string;
  executar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente>;
}

/** Como o provedor está configurado; a credencial é o nome no Gerenciador, nunca a chave. */
export interface ConfigProvedor {
  id: string;
  tipo: TipoProvedor;
  modelo: string | null;
  baseUrl: string | null;
  credencial: string | null;
}

/** Até quando o agente dorme por causa de uma falha do provedor. */
export interface Sono {
  motivo: MotivoFalhaProvedor;
  /** `null` é "até o provedor voltar": não há hora certa para tentar de novo. */
  ate: string | null;
}

/**
 * Toda falha tipada do provedor põe o agente para dormir (AGENTS.md §3): nenhuma chamada nova ao
 * modelo até a hora de volta. Só limite e queda têm hora, e só quando o provedor a informa;
 * credencial recusada e CLI ausente dependem do usuário, então vêm sem hora mesmo que alguém
 * mande uma. Sem hora, o estado do agente tenta de novo com espera crescente (agentes/estado.ts).
 */
export function sonoDaFalha(falha: FalhaProvedor): Sono {
  const temHora = falha.motivo === "limite" || falha.motivo === "fora_do_ar";
  return { motivo: falha.motivo, ate: temHora ? falha.voltaEm : null };
}
