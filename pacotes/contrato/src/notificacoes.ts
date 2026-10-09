import { z } from "zod";
import { Id, Instante, pagina } from "./comum.ts";

/**
 * Notificações (PRODUCT.md §5 "Notificações"; DATA.md §7 notificacoes_preferencias e
 * notificacoes): o que cada agente avisa, por onde, e o histórico do que foi avisado. O
 * silêncio (horário, tela cheia, foco) é configuração do app e mora em `Config.silencio`.
 */

export const TipoNotificacao = z.enum(["aprovacao", "lembrete", "erro", "aviso", "rotina"]);
export type TipoNotificacao = z.infer<typeof TipoNotificacao>;

/** "Só o que precisa de mim" deixa passar estes tipos (PRODUCT.md §5). */
export const TIPOS_QUE_PRECISAM: readonly TipoNotificacao[] = ["aprovacao", "lembrete", "erro"];

export const NivelNotificacao = z.enum(["tudo", "so_o_que_precisa", "nada"]);
export type NivelNotificacao = z.infer<typeof NivelNotificacao>;

/** Onde o aviso aparece: aviso do Windows, só o ponto no dock, ou os dois. */
export const CanalNotificacao = z.enum(["windows", "dock", "ambos"]);
export type CanalNotificacao = z.infer<typeof CanalNotificacao>;

/** Sem preferência gravada: só o que precisa de mim, no Windows e no dock. */
export const PREFERENCIA_PADRAO = { nivel: "so_o_que_precisa", canal: "ambos" } as const satisfies {
  nivel: NivelNotificacao;
  canal: CanalNotificacao;
};

/**
 * A preferência que vale para um agente e um tipo: a do agente, a geral (de todos) ou o
 * padrão. `definida` diz se a do próprio agente está gravada.
 */
export const PreferenciaNotificacao = z.object({
  agenteId: Id,
  tipo: TipoNotificacao,
  nivel: NivelNotificacao,
  canal: CanalNotificacao,
  definida: z.boolean(),
});
export type PreferenciaNotificacao = z.infer<typeof PreferenciaNotificacao>;

/** Uma linha por agente e tipo, de todos os agentes que existem. */
export const EstadoNotificacoes = z.object({ preferencias: z.array(PreferenciaNotificacao) });
export type EstadoNotificacoes = z.infer<typeof EstadoNotificacoes>;

/**
 * Muda a preferência de um agente (ou de todos, com `agenteId` nulo). Sem `tipo`, vale para os
 * cinco tipos de uma vez, como na tela de Configurações.
 */
export const MudancaPreferencia = z.object({
  agenteId: Id.nullable(),
  tipo: TipoNotificacao.optional(),
  nivel: NivelNotificacao,
  canal: CanalNotificacao,
});
export type MudancaPreferencia = z.infer<typeof MudancaPreferencia>;

/** Tira a preferência gravada: o agente volta à geral ou ao padrão. */
export const PedidoRestaurarPreferencia = z.object({
  agenteId: Id.nullable(),
  tipo: TipoNotificacao.optional(),
});
export type PedidoRestaurarPreferencia = z.infer<typeof PedidoRestaurarPreferencia>;

/**
 * O que foi avisado, para o histórico e para não repetir. Com o nível "nada" (ou um tipo fora do
 * "só o que precisa de mim"), o aviso não sai: fica só registrado e já nasce visto, sem ponto.
 */
export const Notificacao = z.object({
  id: Id,
  agenteId: Id.nullable(),
  tipo: TipoNotificacao,
  titulo: z.string().min(1),
  corpo: z.string().nullable(),
  /** O que gerou o aviso (`aprovacao:<id>`, `sessao:<id>`). */
  referencia: z.string().nullable(),
  canal: CanalNotificacao,
  criadoEm: Instante,
  vistaEm: Instante.nullable(),
});
export type Notificacao = z.infer<typeof Notificacao>;

export const PaginaNotificacoes = pagina(Notificacao);
export type PaginaNotificacoes = z.infer<typeof PaginaNotificacoes>;

/** Marca como vistas as dadas, ou todas as de um agente; sem nada, todas. */
export const PedidoMarcarVistas = z.object({
  ids: z.array(Id).optional(),
  agenteId: Id.optional(),
});
export type PedidoMarcarVistas = z.infer<typeof PedidoMarcarVistas>;
