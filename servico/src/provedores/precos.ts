import type { Cobranca, TipoProvedor } from "@moductus/contrato";
import { TIPOS_PROVEDOR_CLI } from "@moductus/contrato";
import type { ConfigProvedor } from "./provedor.ts";

/**
 * Preços por modelo e custo estimado das execuções (F2-09; spec da fase 2 §3 "Custo estimado";
 * AGENTS.md §5 "Consumo"). Números honestos: CLI roda com a assinatura do usuário e não tem custo
 * por token a mostrar, então a execução grava `assinatura` e custo vazio, sem inventar o preço
 * que a API cobraria. API tem custo estimado por esta tabela, sempre estimativa; modelo fora dela
 * fica sem custo, nunca com o preço de um parecido.
 */

/** Preço de um modelo em microdólares por milhão de tokens (US$ 3/MTok = 3_000_000). */
export interface Preco {
  entrada: number;
  /** Entrada lida do cache do prompt; `null` quando o modelo não tem desconto de cache. */
  cacheLeitura: number | null;
  saida: number;
}

export interface PrecoModelo extends Preco {
  /** Preço mais alto quando a entrada de uma chamada passa de `acimaDe` tokens. */
  longo?: Preco & { acimaDe: number };
}

/** Dólares por milhão de tokens em microdólares por milhão de tokens. */
const usd = (dolares: number) => Math.round(dolares * 1_000_000);
const preco = (entrada: number, cacheLeitura: number | null, saida: number): Preco => ({
  entrada: usd(entrada),
  cacheLeitura: cacheLeitura === null ? null : usd(cacheLeitura),
  saida: usd(saida),
});
const comLongo = (base: Preco, acimaDe: number, longo: Preco): PrecoModelo => ({
  ...base,
  longo: { ...longo, acimaDe },
});

/** Até onde vale o preço normal nos modelos da OpenAI que cobram mais pelo contexto longo. */
const LONGO_OPENAI = 272_000;

/** Quando a tabela foi conferida nas páginas de preço; modelo novo entra com a fonte. */
export const PRECOS_CONFERIDOS_EM = "2026-10-09";

/**
 * Preço por id de modelo, versionado aqui: preço padrão, sem lote, sem modo rápido, sem região.
 * Fontes, consultadas em 09/10/2026:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing" e "Long
 *   context pricing": só o Haiku 5.5 cobra mais acima de 100 mil tokens de entrada);
 * - OpenAI: https://developers.openai.com/api/docs/pricing (texto, processamento padrão; contexto
 *   longo acima de 272 mil tokens de entrada).
 * Gravação no cache do prompt (Anthropic) não tem preço próprio aqui: o adaptador de API da
 * Anthropic, quando vier, traz a parte gravada e o preço dela.
 */
export const PRECOS_POR_MODELO: Readonly<Record<string, PrecoModelo>> = {
  // Anthropic
  "claude-fable-5-1": preco(10, 0.25, 50),
  "claude-mythos-5-1": preco(10, 0.25, 50),
  "claude-fable-5": preco(10, 1, 50),
  "claude-mythos-5": preco(10, 1, 50),
  "claude-opus-5-5": preco(4, 0.2, 20),
  "claude-opus-5": preco(5, 0.5, 25),
  "claude-opus-4-8": preco(5, 0.5, 25),
  "claude-opus-4-7": preco(5, 0.5, 25),
  "claude-opus-4-6": preco(5, 0.5, 25),
  "claude-opus-4-5": preco(5, 0.5, 25),
  "claude-opus-4-1": preco(15, 1.5, 75),
  "claude-opus-4": preco(15, 1.5, 75),
  "claude-opus-4-0": preco(15, 1.5, 75),
  "claude-sonnet-5-5": preco(2, 0.1, 10),
  "claude-sonnet-5": preco(2, 0.2, 10),
  "claude-sonnet-4-6": preco(3, 0.3, 15),
  "claude-sonnet-4-5": preco(3, 0.3, 15),
  "claude-sonnet-4": preco(3, 0.3, 15),
  "claude-sonnet-4-0": preco(3, 0.3, 15),
  "claude-haiku-5-5": comLongo(preco(0.1, 0.01, 0.5), 100_000, preco(0.5, 0.05, 2.5)),
  "claude-haiku-4-5": preco(1, 0.1, 5),
  "claude-3-5-haiku": preco(0.8, 0.08, 4),
  // OpenAI
  "gpt-6-astra": comLongo(preco(10, 1, 50), LONGO_OPENAI, preco(20, 2, 75)),
  "gpt-6.1-sol": comLongo(preco(2, 0.1, 10), LONGO_OPENAI, preco(4, 0.2, 15)),
  "gpt-6-sol": comLongo(preco(2, 0.2, 10), LONGO_OPENAI, preco(4, 0.4, 15)),
  "gpt-6-luna": comLongo(preco(0.1, 0.01, 0.5), LONGO_OPENAI, preco(0.2, 0.02, 0.75)),
  "gpt-5.6-sol": comLongo(preco(4, 0.4, 20), LONGO_OPENAI, preco(8, 0.8, 30)),
  "gpt-5.6-terra": comLongo(preco(2, 0.2, 12), LONGO_OPENAI, preco(4, 0.4, 18)),
  "gpt-5.6-luna": comLongo(preco(0.2, 0.02, 1.2), LONGO_OPENAI, preco(0.4, 0.04, 1.8)),
  "gpt-5.5": comLongo(preco(5, 0.5, 30), LONGO_OPENAI, preco(10, 1, 45)),
  "gpt-5.5-pro": comLongo(preco(30, null, 180), LONGO_OPENAI, preco(60, null, 270)),
  "gpt-5.4": comLongo(preco(2.5, 0.25, 15), LONGO_OPENAI, preco(5, 0.5, 22.5)),
  "gpt-5.4-pro": comLongo(preco(30, null, 180), LONGO_OPENAI, preco(60, null, 270)),
  "gpt-5.4-mini": preco(0.75, 0.075, 4.5),
  "gpt-5.4-nano": preco(0.2, 0.02, 1.25),
  "gpt-5.2": preco(1.75, 0.175, 14),
  "gpt-5.2-pro": preco(21, null, 168),
  "gpt-5.1": preco(1.25, 0.125, 10),
  "gpt-5": preco(1.25, 0.125, 10),
  "gpt-5-mini": preco(0.25, 0.025, 2),
  "gpt-5-nano": preco(0.05, 0.005, 0.4),
  "gpt-5-pro": preco(15, null, 120),
  "gpt-4.1": preco(2, 0.5, 8),
  "gpt-4.1-mini": preco(0.4, 0.1, 1.6),
  "gpt-4.1-nano": preco(0.1, 0.025, 0.4),
  "gpt-4o": preco(2.5, 1.25, 10),
  "gpt-4o-2024-05-13": preco(5, null, 15),
  "gpt-4o-mini": preco(0.15, 0.075, 0.6),
  o3: preco(2, 0.5, 8),
  "o3-pro": preco(20, null, 80),
  "o3-mini": preco(1.1, 0.55, 4.4),
  "o4-mini": preco(1.1, 0.275, 4.4),
  o1: preco(15, 7.5, 60),
};

const naTabela = (id: string): PrecoModelo | null =>
  Object.hasOwn(PRECOS_POR_MODELO, id) ? PRECOS_POR_MODELO[id]! : null;

/**
 * Preço de um id de modelo pela tabela. Aceita o id como as APIs e os roteadores o escrevem: com
 * prefixo de quem serve (`anthropic/claude-sonnet-4.5`, `openai/gpt-5`), com data
 * (`claude-haiku-4-5-20251001`, `claude-opus-4-5@20251101`, `gpt-4o-2024-08-06`), com prefixo e
 * versão do Bedrock (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) e com o `[1m]` do Claude
 * Code. Um retrato com preço próprio (`gpt-4o-2024-05-13`) vale antes do modelo sem data. Fora da
 * tabela: `null`.
 */
export function precoDoModelo(modelo: string | null | undefined): PrecoModelo | null {
  if (!modelo) return null;
  let id = modelo
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "");
  id = id.slice(id.lastIndexOf("/") + 1);
  const claude = id.indexOf("claude-");
  if (claude !== -1) {
    id = id
      .slice(claude)
      .replace(/-v\d+(:\d+)?$/, "")
      .replace(/[-@]\d{8}$/, "")
      .replaceAll(".", "-");
    return naTabela(id);
  }
  return naTabela(id) ?? naTabela(id.replace(/-\d{4}-\d{2}-\d{2}$/, ""));
}

/** Os tokens de uma chamada ao modelo, como o evento `uso` do provedor os traz. */
export interface UsoDeChamada {
  tokensEntrada: number;
  tokensSaida: number;
  /** Parte da entrada que veio do cache do prompt. */
  tokensCacheLidos?: number;
  /** O modelo que o provedor diz ter usado; sem ele, vale o configurado. */
  modelo?: string;
}

/** Custo de uma chamada em microdólares, com fração: só o total da execução é arredondado. */
export function custoDaChamada(preco: PrecoModelo, uso: UsoDeChamada): number {
  const p = preco.longo && uso.tokensEntrada > preco.longo.acimaDe ? preco.longo : preco;
  const cache = Math.min(Math.max(uso.tokensCacheLidos ?? 0, 0), uso.tokensEntrada);
  const porMilhao =
    (uso.tokensEntrada - cache) * p.entrada +
    cache * (p.cacheLeitura ?? p.entrada) +
    uso.tokensSaida * p.saida;
  return porMilhao / 1_000_000;
}

const CLI: ReadonlySet<TipoProvedor> = new Set(TIPOS_PROVEDOR_CLI);

/** CLI usa a assinatura do usuário; o resto é API, cobrada por token. */
export const cobrancaDoTipo = (tipo: TipoProvedor): Cobranca => (CLI.has(tipo) ? "assinatura" : "por_token");

export interface CustoExecucao {
  cobranca: Cobranca;
  /** Estimativa em microdólares; `null` na assinatura e quando algum modelo não tem preço. */
  custoEstimadoMicrodolares: number | null;
}

/**
 * O custo de uma execução pelas chamadas que ela fez. Assinatura nunca tem custo. Por token, soma
 * a estimativa de cada chamada pelo modelo dela; se alguma não tem preço conhecido, a execução
 * fica sem custo, em vez de um total que esconde a parte que faltou.
 */
export function estimarCusto(provedor: ConfigProvedor, usos: readonly UsoDeChamada[]): CustoExecucao {
  const cobranca = cobrancaDoTipo(provedor.tipo);
  if (cobranca === "assinatura" || usos.length === 0) return { cobranca, custoEstimadoMicrodolares: null };
  let total = 0;
  for (const uso of usos) {
    const precoDaChamada = precoDoModelo(uso.modelo ?? provedor.modelo);
    if (!precoDaChamada) return { cobranca, custoEstimadoMicrodolares: null };
    total += custoDaChamada(precoDaChamada, uso);
  }
  return { cobranca, custoEstimadoMicrodolares: Math.round(total) };
}
