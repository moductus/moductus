import { z } from "zod";
import { Dia, Id, Instante, Recorrencia } from "./comum.ts";
import { HoraDoDia } from "./config.ts";
import { MinutosAntes } from "./tarefas.ts";

/**
 * Captura rápida (PRODUCT.md §3; ADR-0034): uma frase solta vira tarefa, lembrete, evento ou nota.
 * O entendedor de frases do serviço devolve a prévia ("entendeu como") antes de lançar; nada é
 * criado sem ela. Gasto e memória são reconhecidos, mas só chegam com a Tula e a Memória (fases 4 e
 * 5): a prévia diz isso e oferece tarefa ou nota.
 */

export const TipoCaptura = z.enum(["tarefa", "lembrete", "evento", "nota", "gasto", "memoria"]);
export type TipoCaptura = z.infer<typeof TipoCaptura>;

/** O que dá para lançar nesta versão. */
export const TipoLancavel = TipoCaptura.extract(["tarefa", "lembrete", "evento", "nota"]);
export type TipoLancavel = z.infer<typeof TipoLancavel>;

/**
 * Os campos que a frase deu, editáveis com Tab antes de lançar. O que a frase não disse vem vazio;
 * `valorCentavos` é o valor em reais que marcou um gasto.
 */
export const CamposCaptura = z.object({
  titulo: z.string().trim().min(1).max(500),
  dia: Dia.nullable(),
  hora: HoraDoDia.nullable(),
  duracaoMin: z.number().int().positive().max(1440).nullable(),
  recorrencia: Recorrencia.nullable(),
  lembreteMinutosAntes: MinutosAntes.nullable(),
  listaId: Id.nullable(),
  valorCentavos: z.number().int().nullable(),
});
export type CamposCaptura = z.infer<typeof CamposCaptura>;

/** Um campo da prévia. */
export const CampoCaptura = CamposCaptura.keyof();
export type CampoCaptura = z.infer<typeof CampoCaptura>;

/** O pedaço da frase que deu um campo, em posições de caractere ("amanhã 15h" → dia e hora). */
export const TrechoReconhecido = z
  .object({ campo: CampoCaptura, inicio: z.number().int().nonnegative(), fim: z.number().int().positive() })
  .refine((t) => t.fim > t.inicio, { path: ["fim"], message: "o trecho termina depois de começar" });
export type TrechoReconhecido = z.infer<typeof TrechoReconhecido>;

export const PedidoEntender = z.object({ texto: z.string().trim().min(1).max(1000) });
export type PedidoEntender = z.infer<typeof PedidoEntender>;

/**
 * A prévia. `alternativas` são os outros tipos do "Na verdade é", na ordem das teclas 1, 2 e 3.
 * `aviso` é o que a captura diz quando o tipo ainda não chegou (gasto, memória). `entendidoPor`
 * diz se foi o entendedor de frases ou o modelo da Alba, que só entra quando o código não reconhece
 * nada além do título.
 */
export const PreviaCaptura = z.object({
  texto: z.string(),
  tipo: TipoCaptura,
  campos: CamposCaptura,
  trechos: z.array(TrechoReconhecido),
  alternativas: z.array(TipoLancavel),
  aviso: z.string().min(1).nullable(),
  entendidoPor: z.enum(["codigo", "modelo"]),
});
export type PreviaCaptura = z.infer<typeof PreviaCaptura>;

/** Lançar o que a prévia mostrou, com os campos como ficaram depois do Tab. */
export const PedidoLancar = z.object({
  texto: z.string().trim().min(1).max(1000),
  tipo: TipoLancavel,
  campos: CamposCaptura,
});
export type PedidoLancar = z.infer<typeof PedidoLancar>;

/** O que foi criado e até quando dá para desfazer (10 s depois de lançar). */
export const LancamentoCaptura = z.object({
  id: Id,
  tipo: TipoLancavel,
  itemId: Id,
  desfazerAte: Instante,
});
export type LancamentoCaptura = z.infer<typeof LancamentoCaptura>;

/** Desfazer passado o prazo volta erro dizendo por quê. */
export const PedidoDesfazerCaptura = z.object({ id: Id });
export type PedidoDesfazerCaptura = z.infer<typeof PedidoDesfazerCaptura>;
