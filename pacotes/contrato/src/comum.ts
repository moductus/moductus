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

/**
 * Instante que a janela manda: exatamente o formato do banco, com milissegundos e `Z`
 * (`2026-10-09T14:30:00.000Z`, o de `toISOString()`). Assim o serviço grava e compara o texto
 * como veio, sem normalizar. A saída aceita qualquer ISO UTC.
 */
export const InstanteEntrada = z.iso.datetime({ precision: 3 });
export type InstanteEntrada = z.infer<typeof InstanteEntrada>;

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

/** Quem criou ou mudou a linha por último (DATA.md §1, carimbo de origem). */
export const Origem = z.enum(["usuario", "agente", "importacao", "conexao"]);
export type Origem = z.infer<typeof Origem>;

/**
 * O carimbo de origem como as áreas do dia mostram ("criada pela Alba"): `agenteId` vem quando
 * `origem` é `agente`. É auditoria, não vínculo: o agente pode ter saído.
 */
export const CamposOrigem = {
  origem: Origem,
  agenteId: Id.nullable(),
  execucaoId: Id.nullable(),
};

/** Regra de repetição do iCalendar (RRULE), guardada como texto; quem entende é o serviço. */
export const Recorrencia = z.string().trim().min(1).max(500);
export type Recorrencia = z.infer<typeof Recorrencia>;

/** O que foi para a lixeira num pedido: o item e o que foi junto com ele. */
export const Apagados = z.object({ ids: z.array(Id) });
export type Apagados = z.infer<typeof Apagados>;
