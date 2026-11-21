import { Dia } from "@moductus/contrato";
import { z } from "zod";
import { ehDia, type TempoDoDia } from "../areas/dia/tempo.ts";

/**
 * O dia como o modelo manda nas ferramentas da Alba: `hoje`, `amanha` ou a data. Nada no prompt diz
 * ao modelo que dia é hoje, e "amanhã às 15h" não pode depender de ele acertar a conta nem o fuso: o
 * serviço resolve no fuso de `config` (AGENTS.md §4, ADR-0008).
 */
export const DiaDaFerramenta = z
  .union([z.enum(["hoje", "amanha"]), Dia])
  .describe("hoje, amanha ou a data no formato AAAA-MM-DD, no fuso do usuário");
export type DiaDaFerramenta = z.infer<typeof DiaDaFerramenta>;

export const MENSAGEM_DIA_INEXISTENTE = "data que não existe no calendário";

/** A data de `hoje` e `amanha` no fuso de `config`; a que não existe (30 de fevereiro) é recusada. */
export function resolverDia(tempo: TempoDoDia, dia: DiaDaFerramenta): string {
  if (dia === "hoje") return tempo.hoje();
  if (dia === "amanha") return tempo.amanha();
  if (!ehDia(dia)) throw new Error(MENSAGEM_DIA_INEXISTENTE);
  return dia;
}
