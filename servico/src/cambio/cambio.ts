import type { Cambio, CotacaoBuscada, MoedaComCotacao, MoedaTeto } from "@moductus/contrato";
import { z } from "zod";

/**
 * A cotação do teto diário (ADR-0040). O custo dos agentes é medido em microdólares; o teto vale
 * na moeda que o usuário escolheu. Em dólar não há conversão; nas outras moedas, só com a cotação
 * gravada na configuração (digitada, ou buscada e confirmada). Sem ela, nada de número inventado.
 */

/** O custo convertido para a moeda do teto e o dia da cotação usada (`null` em dólar). */
export interface Conversao {
  centavos: number;
  cotacaoDe: string | null;
}

/** Converte microdólares para centavos da moeda; `null` quando a moeda pede cotação e não há. */
export type ConverterCusto = (microdolares: number, moeda: MoedaTeto) => Conversao | null;

/** Um dólar tem 1.000.000 de microdólares e 100 centavos. */
const MICRODOLARES_POR_CENTAVO = 10_000n;
const MILIONESIMOS = 1_000_000n;

/**
 * O custo em centavos da moeda, para baixo: `centavos >= teto` vale exatamente quando o custo
 * passou do teto, sem o arredondamento empurrar um centavo para nenhum lado. A conta é em inteiro
 * grande, porque microdólares vezes milionésimos passa do inteiro seguro do JavaScript.
 */
export function converter(microdolares: number, moeda: MoedaTeto, cambio: Cambio): Conversao | null {
  const micro = BigInt(Math.max(Math.trunc(microdolares), 0));
  if (moeda === "USD") return { centavos: Number(micro / MICRODOLARES_POR_CENTAVO), cotacaoDe: null };
  const cotacao = cambio.cotacoes[moeda];
  if (!cotacao) return null;
  const centavos = (micro * BigInt(cotacao.milionesimos)) / (MICRODOLARES_POR_CENTAVO * MILIONESIMOS);
  return { centavos: Number(centavos), cotacaoDe: cotacao.data };
}

/** O conversor do serviço: lê a cotação da configuração a cada conta, para valer assim que gravar. */
export const converterPelaConfig =
  (cambio: () => Cambio): ConverterCusto =>
  (microdolares, moeda) =>
    converter(microdolares, moeda, cambio());

/** Sem configuração: só o dólar, que não precisa de cotação. */
export const SO_DOLAR: ConverterCusto = (microdolares, moeda) =>
  converter(microdolares, moeda, { cotacoes: {} });

/**
 * A fonte automática, validada em 16/10/2026 (ADR-0040): Frankfurter v2, sem chave nem conta, por
 * HTTPS. Responde `{"date","base","quote","rate"}`; a taxa é a de referência do dia de um banco
 * central, não a de uma transação, e por isso o que sai dela é estimativa.
 */
export const ENDERECO_FRANKFURTER = "https://api.frankfurter.dev/v2/rate/USD/";

/** O botão não fica esperando a fonte para sempre. */
export const PRAZO_DA_BUSCA_MS = 10_000;

/** A taxa de referência muda uma vez por dia: dentro disso, a fonte não é consultada de novo. */
export const CACHE_DA_COTACAO_MS = 24 * 60 * 60_000;

const RespostaFrankfurter = z.object({
  date: z.iso.date(),
  base: z.literal("USD"),
  quote: z.string(),
  rate: z.number().positive().finite(),
});

/** Ditos ao usuário (AGENTS.md §2 Voz): o que houve e a saída, que é digitar a cotação. */
export const MENSAGEM_FONTE_SEM_MOEDA = (moeda: MoedaComCotacao) =>
  `A fonte de cotação não tem ${moeda} hoje. A cotação gravada continua valendo; dá para digitar outra.`;
export const MENSAGEM_FONTE_FORA =
  "Não consegui buscar a cotação agora. A cotação gravada continua valendo; dá para digitar outra.";
export const MENSAGEM_FONTE_ESTRANHA =
  "A fonte de cotação respondeu algo que não reconheço. A cotação gravada continua valendo; dá para digitar outra.";

export interface OpcoesCambio {
  /** O `fetch`; o teste troca por um falso, sem rede. */
  buscar?: typeof fetch;
  agora?: () => Date;
  prazoMs?: number;
}

/**
 * "Buscar cotação" em Configurações › Modelos: consulta a fonte e devolve o valor e a data dela,
 * sem gravar. O valor só vira cotação quando o usuário confirma (a tela grava pela configuração).
 * Falha da fonte não mexe em nada: a cotação gravada continua, e a mensagem diz isso.
 */
export class ServicoCambio {
  private readonly buscarNaRede: typeof fetch;
  private readonly agora: () => Date;
  private readonly prazoMs: number;
  private readonly cache = new Map<MoedaComCotacao, { cotacao: CotacaoBuscada; em: number }>();

  constructor(opcoes: OpcoesCambio = {}) {
    this.buscarNaRede = opcoes.buscar ?? fetch;
    this.agora = opcoes.agora ?? (() => new Date());
    this.prazoMs = opcoes.prazoMs ?? PRAZO_DA_BUSCA_MS;
  }

  async buscar(moeda: MoedaComCotacao): Promise<CotacaoBuscada> {
    const agora = this.agora().getTime();
    const guardada = this.cache.get(moeda);
    if (guardada && agora - guardada.em < CACHE_DA_COTACAO_MS) return guardada.cotacao;

    let resposta: Response;
    try {
      resposta = await this.buscarNaRede(`${ENDERECO_FRANKFURTER}${moeda}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.prazoMs),
      });
    } catch {
      // Sem rede, fora do ar ou passou do prazo: para o usuário é o mesmo.
      throw new Error(MENSAGEM_FONTE_FORA);
    }
    if (resposta.status === 404) throw new Error(MENSAGEM_FONTE_SEM_MOEDA(moeda));
    if (!resposta.ok) throw new Error(MENSAGEM_FONTE_FORA);
    let corpo: unknown;
    try {
      corpo = await resposta.json();
    } catch {
      throw new Error(MENSAGEM_FONTE_ESTRANHA);
    }
    const lida = RespostaFrankfurter.safeParse(corpo);
    if (!lida.success || lida.data.quote !== moeda) throw new Error(MENSAGEM_FONTE_ESTRANHA);
    const milionesimos = Math.round(lida.data.rate * 1_000_000);
    if (milionesimos <= 0) throw new Error(MENSAGEM_FONTE_ESTRANHA);
    const cotacao: CotacaoBuscada = { moeda, milionesimos, data: lida.data.date };
    this.cache.set(moeda, { cotacao, em: agora });
    return cotacao;
  }
}
