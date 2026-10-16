import { z } from "zod";

/**
 * Canal interface ↔ serviço: WebSocket em 127.0.0.1, porta aleatória e token entregues
 * pela casca. Três formas de mensagem: pedido (interface → serviço), resposta com o
 * mesmo id, e evento (serviço → interface, sem pedido).
 */
export const Pedido = z.object({
  tipo: z.literal("pedido"),
  id: z.number().int().nonnegative(),
  metodo: z.string().min(1),
  dados: z.unknown().optional(),
});
export type Pedido = z.infer<typeof Pedido>;

export const Resposta = z.discriminatedUnion("ok", [
  z.object({ tipo: z.literal("resposta"), id: z.number().int(), ok: z.literal(true), dados: z.unknown() }),
  z.object({ tipo: z.literal("resposta"), id: z.number().int(), ok: z.literal(false), erro: z.string() }),
]);
export type Resposta = z.infer<typeof Resposta>;

export const Evento = z.object({ tipo: z.literal("evento"), nome: z.string(), dados: z.unknown() });
export type Evento = z.infer<typeof Evento>;

export const MensagemDoServico = z.union([Resposta, Evento]);
export type MensagemDoServico = z.infer<typeof MensagemDoServico>;

/** Um método do serviço: o mesmo schema valida a entrada lá e tipa a chamada aqui. */
export interface Metodo<E extends z.ZodType, S extends z.ZodType> {
  entrada: E;
  saida: S;
}

export function metodo<E extends z.ZodType, S extends z.ZodType>(entrada: E, saida: S): Metodo<E, S> {
  return { entrada, saida };
}

/**
 * Versão do protocolo entre interface e serviço; sobe quando uma mensagem muda de forma.
 * 2: agentes, provedores, execuções, conversas, aprovações, sessões, GitHub, conexões e
 * notificações (fase 2).
 */
export const VERSAO_PROTOCOLO = 2;

/** Nome do parâmetro de URL que leva o token: o WebSocket do navegador não manda cabeçalho. */
export const PARAMETRO_TOKEN = "token";

/**
 * Parâmetro de URL com a versão do protocolo de quem conecta. Sem ele, é uma janela da versão 1,
 * que ainda não o mandava.
 */
export const PARAMETRO_PROTOCOLO = "protocolo";
