import { z } from "zod";
import { CamposOrigem, Id, Instante, InstanteEntrada } from "./comum.ts";

/**
 * Notas (DATA.md §4; migração 015; ADR-0036): Markdown cru num campo próprio, que salva sozinho
 * com a versão que a janela conhece, e a busca sem acento. O bloco rápido é a nota fixa do topo:
 * esvazia, não vai à lixeira.
 */

/** A nota fixa do topo, com id fixo igual em todo PC (migração 015). */
export const NOTA_BLOCO_RAPIDO = "bloco_rapido";

/** `pasta` é texto livre ("Pessoal · Viagem de dezembro"). */
export const Nota = z.object({
  id: Id,
  titulo: z.string(),
  conteudo: z.string(),
  fixada: z.boolean(),
  pasta: z.string().min(1).nullable(),
  ...CamposOrigem,
  criadoEm: Instante,
  /** A versão da nota: o `notas.salvar` manda a que conhece. */
  atualizadoEm: Instante,
});
export type Nota = z.infer<typeof Nota>;

/** A nota na lista: o começo do texto em vez do conteúdo inteiro. */
export const ResumoNota = Nota.omit({ conteudo: true }).extend({ trecho: z.string() });
export type ResumoNota = z.infer<typeof ResumoNota>;

const Titulo = z.string().max(500);
const Conteudo = z.string().max(1_000_000);
const Pasta = z.string().trim().min(1).max(200);

export const NovaNota = z.object({
  titulo: Titulo.optional(),
  conteudo: Conteudo.optional(),
  pasta: Pasta.nullable().optional(),
  fixada: z.boolean().optional(),
});
export type NovaNota = z.infer<typeof NovaNota>;

/**
 * Salvar o texto (800 ms depois da última tecla e ao sair do campo): `versao` é o `atualizadoEm`
 * que a janela conhece, e o serviço não grava sobre uma versão mais nova.
 */
export const PedidoSalvarNota = z
  .object({ id: Id, versao: InstanteEntrada, titulo: Titulo.optional(), conteudo: Conteudo.optional() })
  .refine((p) => p.titulo !== undefined || p.conteudo !== undefined, {
    path: ["conteudo"],
    message: "diga o que salvar",
  });
export type PedidoSalvarNota = z.infer<typeof PedidoSalvarNota>;

/**
 * Salvou, ou a nota mudou em outra janela: nada foi gravado, e voltam as duas, a que está no banco
 * e a que a janela mandou, para você escolher ("esta nota mudou em outra janela").
 */
export const ResultadoSalvarNota = z.discriminatedUnion("salvou", [
  z.object({ salvou: z.literal(true), nota: Nota }),
  z.object({
    salvou: z.literal(false),
    atual: Nota,
    recusada: z.object({ titulo: z.string(), conteudo: z.string() }),
  }),
]);
export type ResultadoSalvarNota = z.infer<typeof ResultadoSalvarNota>;

/** Fixar e mudar de pasta não dependem da versão do texto. */
export const MudancaNota = z.object({
  id: Id,
  fixada: z.boolean().optional(),
  pasta: Pasta.nullable().optional(),
});
export type MudancaNota = z.infer<typeof MudancaNota>;

export const PedidoNota = z.object({ id: Id });
export type PedidoNota = z.infer<typeof PedidoNota>;

/** As vivas, a fixada primeiro e a mais mexida em seguida; com `pasta`, só as dela. */
export const PedidoNotas = z.object({ pasta: Pasta.optional() });
export type PedidoNotas = z.infer<typeof PedidoNotas>;

/** Busca sem acento e sem caixa ("amanha" acha "amanhã"). */
export const PedidoBuscarNotas = z.object({
  texto: z.string().trim().min(1).max(200),
  limite: z.number().int().min(1).max(100).optional(),
});
export type PedidoBuscarNotas = z.infer<typeof PedidoBuscarNotas>;

/** Onde, no trecho, está o que bateu com a busca: posições em caracteres, sem marcação no texto. */
export const Destaque = z
  .object({ inicio: z.number().int().nonnegative(), fim: z.number().int().positive() })
  .refine((d) => d.fim > d.inicio, { path: ["fim"], message: "o destaque termina depois de começar" });
export type Destaque = z.infer<typeof Destaque>;

export const ResultadoBuscaNota = ResumoNota.extend({ destaques: z.array(Destaque) });
export type ResultadoBuscaNota = z.infer<typeof ResultadoBuscaNota>;

/** O que mudou nas notas, de qualquer janela ou ferramenta. */
export const MudancaNotas = z.object({ notas: z.array(Nota), apagadas: z.array(Id) });
export type MudancaNotas = z.infer<typeof MudancaNotas>;
