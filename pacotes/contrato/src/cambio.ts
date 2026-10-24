import { z } from "zod";
import { Dia } from "./comum.ts";

/**
 * A moeda do teto diário e a cotação que compara o teto com o custo em dólar (ADR-0040, H3). O
 * custo dos agentes é medido em microdólares pela tabela de preços; o teto vale na moeda que o
 * usuário escolhe. Nenhuma cotação é presumida: ou o usuário digita, ou confirma a que a fonte deu.
 */

/** As moedas do teto: ISO 4217, todas de duas casas decimais. O real é o padrão. */
export const MOEDAS_TETO = ["BRL", "USD", "EUR", "GBP"] as const;
export const MoedaTeto = z.enum(MOEDAS_TETO);
export type MoedaTeto = z.infer<typeof MoedaTeto>;

export const MOEDA_TETO_PADRAO: MoedaTeto = "BRL";

/** As que precisam de cotação: em dólar não há conversão. */
export const MoedaComCotacao = MoedaTeto.exclude(["USD"]);
export type MoedaComCotacao = z.infer<typeof MoedaComCotacao>;

/** De onde veio a cotação: digitada, ou buscada na fonte e confirmada pelo usuário. */
export const FonteCotacao = z.enum(["digitada", "frankfurter"]);
export type FonteCotacao = z.infer<typeof FonteCotacao>;

/**
 * Quanto vale US$ 1 na moeda, em milionésimos dela (5,4321 é `5_432_100`): inteiro, para a conta
 * do teto não depender de ponto flutuante. `data` é o dia da cotação: o da digitação, ou o que a
 * fonte deu (não o de hoje).
 */
/** A maior cotação aceita: 1.000.000 por US$ 1 (a tela e a busca dizem isso em vez de só recusar). */
export const COTACAO_MAXIMA_MILIONESIMOS = 1_000_000_000_000;

export const Cotacao = z.object({
  milionesimos: z.number().int().positive().max(COTACAO_MAXIMA_MILIONESIMOS),
  data: Dia,
  fonte: FonteCotacao,
});
export type Cotacao = z.infer<typeof Cotacao>;

/** As cotações gravadas na configuração (Configurações › Modelos), uma por moeda. */
export const Cambio = z.object({ cotacoes: z.partialRecord(MoedaComCotacao, Cotacao) });
export type Cambio = z.infer<typeof Cambio>;

/** "Buscar cotação": o serviço consulta a fonte e devolve sem gravar; grava só o que for confirmado. */
export const PedidoBuscarCotacao = z.object({ moeda: MoedaComCotacao });
export type PedidoBuscarCotacao = z.infer<typeof PedidoBuscarCotacao>;

export const CotacaoBuscada = z.object({
  moeda: MoedaComCotacao,
  milionesimos: Cotacao.shape.milionesimos,
  /** A data da resposta da fonte: é ela que fica gravada ao confirmar. */
  data: Dia,
});
export type CotacaoBuscada = z.infer<typeof CotacaoBuscada>;
