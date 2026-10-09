import { Dia, type UsoIa } from "@moductus/contrato";
import { z } from "zod";
import { diaLocal } from "../../sessoes/contexto.ts";
import type { ServicoSessoes } from "../../sessoes/sessoes.ts";
import { ferramenta, type Ferramenta } from "../ferramenta.ts";

/**
 * A ferramenta `uso.*` do Nuno (AGENTS.md §2 "Gasto" e §5 "Consumo"): tokens e custo por dia,
 * ferramenta, modelo e projeto, do `uso_ia`. Número honesto: o que foi contado aqui sai marcado
 * como estimativa, e custo sem preço conhecido não aparece.
 */

/** Intervalo máximo de uma consulta, em dias. */
export const DIAS_MAXIMO = 92;

const DIA_MS = 24 * 60 * 60_000;

export const AVISO_ESTIMATIVA =
  "Parte destes números foi contada pelo Moductus no transcript, não informada pela ferramenta: é estimativa.";
export const AVISO_SEM_CUSTO = "Sem custo: não há preço conhecido para parte destes modelos.";

export interface OpcoesUso {
  agora?: () => Date;
}

/** Dias corridos entre duas datas `AAAA-MM-DD`, contando as duas. */
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS) + 1;
}

function somar(linhas: readonly UsoIa[]) {
  let custo: number | null = 0;
  const total = { tokensEntrada: 0, tokensSaida: 0, tokensCache: 0 };
  for (const l of linhas) {
    total.tokensEntrada += l.tokensEntrada;
    total.tokensSaida += l.tokensSaida;
    total.tokensCache += l.tokensCache;
    // Um custo que falta deixa o total sem custo: somar só o que se sabe arredondaria para baixo.
    custo =
      custo !== null && l.custoEstimadoMicrodolares !== null ? custo + l.custoEstimadoMicrodolares : null;
  }
  return { ...total, custoEstimadoMicrodolares: linhas.length > 0 ? custo : null };
}

export function ferramentasUso(sessoes: ServicoSessoes, opcoes: OpcoesUso = {}): Ferramenta[] {
  const agora = opcoes.agora ?? (() => new Date());
  return [
    ferramenta({
      nome: "uso.por_dia",
      descricao:
        "Tokens e custo estimado das sessões de IA por dia, ferramenta, modelo e projeto, com o total. Sem datas, hoje. Custo em microdólares (1.000.000 = US$ 1), nunca arredondado; vazio quando não há preço. Linha com estimativa = true foi contada pelo Moductus: diga que é estimativa.",
      entrada: z.object({
        de: Dia.optional().describe("Primeiro dia, AAAA-MM-DD"),
        ate: Dia.optional().describe("Último dia, AAAA-MM-DD; padrão hoje"),
      }),
      efeito: "leitura",
      executar: (entrada) => {
        const ate = entrada.ate ?? diaLocal(agora());
        const de = entrada.de ?? ate;
        if (de > ate) throw new Error("o primeiro dia precisa vir antes do último");
        if (diasEntre(de, ate) > DIAS_MAXIMO)
          throw new Error(`consulte no máximo ${DIAS_MAXIMO} dias por vez`);
        const linhas = sessoes.uso({ de, ate });
        const nomes = new Map(sessoes.projetos().map((p) => [p.id, p.nome]));
        const estimativa = linhas.some((l) => l.fonte === "estimativa");
        const total = somar(linhas);
        const avisos = [
          ...(estimativa ? [AVISO_ESTIMATIVA] : []),
          ...(linhas.length > 0 && total.custoEstimadoMicrodolares === null ? [AVISO_SEM_CUSTO] : []),
        ];
        return {
          de,
          ate,
          linhas: linhas.map((l) => ({
            dia: l.dia,
            ferramenta: l.ferramenta,
            modelo: l.modelo,
            projeto: l.projetoId ? (nomes.get(l.projetoId) ?? null) : null,
            tokensEntrada: l.tokensEntrada,
            tokensSaida: l.tokensSaida,
            tokensCache: l.tokensCache,
            custoEstimadoMicrodolares: l.custoEstimadoMicrodolares,
            estimativa: l.fonte === "estimativa",
          })),
          total: { ...total, estimativa },
          avisos,
        };
      },
    }),
  ];
}
