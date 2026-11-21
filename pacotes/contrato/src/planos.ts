import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante } from "./comum.ts";
import { Centavos } from "./financas.ts";

/**
 * Planos de economia da Tula (DATA.md §3 `planos`, `plano_movimentos`; ADR-0046): o alvo, o prazo,
 * a conta onde o dinheiro fica e o que entrou e saiu. O guardado é a soma dos movimentos e o aporte
 * sugerido sai do alvo, do guardado e dos meses até o prazo, no serviço.
 */

export const EstadoPlano = z.enum(["ativo", "concluido", "pausado"]);
export type EstadoPlano = z.infer<typeof EstadoPlano>;

const camposPlano = {
  nome: z.string().trim().min(1).max(120),
  valorAlvoCentavos: Centavos.positive(),
  prazo: Dia.nullable(),
  contaId: Id.nullable(),
};

/**
 * Um plano. `guardadoCentavos` e `faltaCentavos` saem dos movimentos; `aporteMensalSugeridoCentavos`
 * é (alvo − guardado) ÷ meses inteiros até o prazo, arredondado para cima, e vem vazio sem prazo ou
 * com o prazo já passado (`prazoPassou`).
 */
export const Plano = z.object({
  id: Id,
  ...camposPlano,
  estado: EstadoPlano,
  guardadoCentavos: Centavos,
  faltaCentavos: Centavos.nonnegative(),
  aporteMensalSugeridoCentavos: Centavos.nonnegative().nullable(),
  prazoPassou: z.boolean(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Plano = z.infer<typeof Plano>;

export const NovoPlano = z.object(camposPlano).partial({ prazo: true, contaId: true });
export type NovoPlano = z.infer<typeof NovoPlano>;

/** `estado` pausa e retoma; concluído chega sozinho ao atingir o alvo, ou à mão. */
export const MudancaPlano = z
  .object(camposPlano)
  .partial()
  .extend({ id: Id, estado: EstadoPlano.optional() });
export type MudancaPlano = z.infer<typeof MudancaPlano>;

export const PedidoPlano = z.object({ id: Id });
export type PedidoPlano = z.infer<typeof PedidoPlano>;

/** O que entrou (positivo) ou saiu (negativo) de um plano, e o lançamento que o moveu, quando há. */
export const MovimentoPlano = z.object({
  id: Id,
  planoId: Id,
  data: Dia,
  valorCentavos: Centavos.refine((v) => v !== 0, "movimento sem valor"),
  lancamentoId: Id.nullable(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type MovimentoPlano = z.infer<typeof MovimentoPlano>;

/** "Guardar" (positivo) ou retirar (negativo); sem dia, hoje no fuso do usuário. */
export const PedidoMovimentarPlano = z.object({
  id: Id,
  valorCentavos: Centavos.refine((v) => v !== 0, "movimento sem valor"),
  data: Dia.optional(),
  lancamentoId: Id.optional(),
});
export type PedidoMovimentarPlano = z.infer<typeof PedidoMovimentarPlano>;

/** O plano depois do movimento; `concluiuAgora` só na vez em que o alvo foi atingido. */
export const PlanoMovimentado = z.object({
  plano: Plano,
  movimento: MovimentoPlano,
  concluiuAgora: z.boolean(),
});
export type PlanoMovimentado = z.infer<typeof PlanoMovimentado>;
