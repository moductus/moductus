import { z } from "zod";
import { Id, Instante, PedidoPagina, pagina } from "./comum.ts";

/**
 * Conversas com o time e com cada agente (AGENTS.md §1 "Conversas", §2 "Roteamento"; DATA.md §6
 * conversas e mensagens). A resposta chega em pedaços por `conversas.parcial` e, pronta, como
 * mensagem gravada por `conversas.mensagem`.
 */

export const TipoConversa = z.enum(["time", "agente"]);
export type TipoConversa = z.infer<typeof TipoConversa>;

export const Conversa = z.object({
  id: Id,
  tipo: TipoConversa,
  /** Com quem é a conversa; vazio na do time. */
  agenteId: Id.nullable(),
  titulo: z.string().nullable(),
  arquivada: z.boolean(),
  criadoEm: Instante,
});
export type Conversa = z.infer<typeof Conversa>;

export const Mensagem = z.object({
  id: Id,
  conversaId: Id,
  /** Quem fala; vazio é o usuário. */
  agenteId: Id.nullable(),
  conteudo: z.string(),
  /** Execução que produziu a fala; vazio nas do usuário. */
  execucaoId: Id.nullable(),
  /**
   * A fala é só o erro da execução que falhou, sem nada dito antes: a janela diz a falha do jeito
   * dela (CLI sem login, com o comando para entrar), não com o texto cru do provedor.
   */
  erroDaExecucao: z.boolean(),
  criadoEm: Instante,
});
export type Mensagem = z.infer<typeof Mensagem>;

/** Abre a conversa com um agente ou, sem `agenteId`, a do time; cria se ainda não existe. */
export const PedidoAbrirConversa = z.object({ agenteId: Id.optional() });
export type PedidoAbrirConversa = z.infer<typeof PedidoAbrirConversa>;

export const PedidoMensagens = PedidoPagina.extend({ conversaId: Id });
export type PedidoMensagens = z.infer<typeof PedidoMensagens>;

export const PaginaMensagens = pagina(Mensagem);
export type PaginaMensagens = z.infer<typeof PaginaMensagens>;

export const PedidoEnviar = z.object({
  conversaId: Id,
  conteudo: z.string().trim().min(1, "a mensagem está vazia"),
});
export type PedidoEnviar = z.infer<typeof PedidoEnviar>;

/** A fala do usuário gravada e quem o roteamento escolheu para responder, na ordem. */
export const ResultadoEnviar = z.object({
  mensagem: Mensagem,
  agentes: z.array(Id),
});
export type ResultadoEnviar = z.infer<typeof ResultadoEnviar>;

export const PedidoArquivarConversa = z.object({ id: Id, arquivada: z.boolean() });
export type PedidoArquivarConversa = z.infer<typeof PedidoArquivarConversa>;

/** Manda a conversa para a lixeira de 30 dias com as mensagens; volta a lista que ficou. */
export const PedidoApagarConversa = z.object({ id: Id });
export type PedidoApagarConversa = z.infer<typeof PedidoApagarConversa>;

/**
 * Resposta em andamento: o texto inteiro até agora, não só o pedaço novo, para a janela que
 * conectar no meio ver a fala certa. Vazio é "pensando".
 */
export const FalaParcial = z.object({
  conversaId: Id,
  agenteId: Id,
  execucaoId: Id,
  texto: z.string(),
});
export type FalaParcial = z.infer<typeof FalaParcial>;
