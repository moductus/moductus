import { z } from "zod";

/**
 * Peças que as áreas da fase 2 repetem. O banco guarda o id como texto (ULID na maioria das
 * tabelas, nome curto nos agentes de fábrica), então o contrato só exige que exista.
 */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Data e hora em ISO 8601 UTC, como no banco (DATA.md §1). */
export const Instante = z.iso.datetime();
export type Instante = z.infer<typeof Instante>;

/** Data sem hora, `AAAA-MM-DD`. */
export const Dia = z.iso.date();
export type Dia = z.infer<typeof Dia>;

/** Pedido de uma página de histórico: do mais novo para o mais antigo, antes do id dado. */
export const PedidoPagina = z.object({
  antesDe: Id.optional(),
  limite: z.number().int().min(1).max(200).optional(),
});
export type PedidoPagina = z.infer<typeof PedidoPagina>;

/** Uma página de itens e o cursor da próxima; `null` quando acabou. */
export function pagina<T extends z.ZodType>(item: T) {
  return z.object({ itens: z.array(item), proximo: Id.nullable() });
}
