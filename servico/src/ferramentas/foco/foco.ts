import { z } from "zod";
import { diasEntre, type TempoDoDia } from "../../areas/dia/tempo.ts";
import type { ServicoFoco } from "../../areas/foco/foco.ts";
import { DiaDaFerramenta, resolverDia } from "../dia.ts";
import { ferramenta, type Ferramenta } from "../ferramenta.ts";

/** Quantos dias o histórico do foco traz de uma vez, como a agenda. */
export const DIAS_DO_HISTORICO = 62;

export const MENSAGEM_INTERVALO = `de 1 a ${DIAS_DO_HISTORICO} dias, com o fim depois do começo`;

/**
 * As ferramentas `foco.*` da Alba (AGENTS.md §2): o foco agora e quanto houve de foco num intervalo,
 * para o fechamento do dia e para sugerir o próximo. Só leitura: começar, pausar e terminar ficam
 * com o usuário (painel, área e Ctrl+Alt+P), porque o tempo que correu não se desfaz pelo histórico.
 */
export function ferramentasFoco(foco: ServicoFoco, tempo: TempoDoDia): Ferramenta[] {
  return [
    ferramenta({
      nome: "foco.estado",
      descricao:
        "O foco agora: a etapa em andamento (foco, pausa ou pausa longa), a tarefa ligada, em que ciclo está, o que vem depois e o total de foco de hoje em minutos.",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => foco.obter(),
    }),
    ferramenta({
      nome: "foco.historico",
      descricao: `O foco de um intervalo de dias (até ${DIAS_DO_HISTORICO}), no fuso do usuário: as etapas e as somas de minutos e ciclos completos por tarefa e por dia.`,
      entrada: z.object({
        de: DiaDaFerramenta.describe("O primeiro dia: hoje, amanha ou AAAA-MM-DD"),
        ate: DiaDaFerramenta.describe("O último dia, inclusive"),
      }),
      efeito: "leitura",
      executar: ({ de, ate }) => {
        const inicio = resolverDia(tempo, de);
        const fim = resolverDia(tempo, ate);
        const dias = diasEntre(inicio, fim);
        if (dias < 0 || dias >= DIAS_DO_HISTORICO) throw new Error(MENSAGEM_INTERVALO);
        return foco.historico({ de: inicio, ate: fim });
      },
    }),
  ];
}
