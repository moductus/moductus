import type { SituacaoAgente } from "@moductus/contrato";
import type { EstadoPersonagem } from "./agentes.ts";

/** Tom do selo de status: a cor acompanha o texto, nunca o substitui. */
export type TomStatus = "neutro" | "apagado" | "sucesso" | "aviso" | "perigo";

/** Como um agente aparece: a expressão do personagem e o status escrito ao lado. */
export interface LeituraSituacao {
  expressao: EstadoPersonagem;
  /** O status como o Agentes.dc.html e o Estados.dc.html escrevem ("esperando você", "parado"). */
  texto: string;
  tom: TomStatus;
  /** O que fazer, quando há uma saída óbvia; vai no rótulo e na dica do dock. */
  dica: string | null;
}

/** Convite enquanto nenhum modelo está escolhido (fase 1 e "sem_modelo" do runtime). */
export const CONVITE_MODELO = "Conectar um modelo";

/** Sem notícia do serviço: o time dorme, como na fase 1, e convida a conectar um modelo. */
export const SEM_SITUACAO: LeituraSituacao = {
  expressao: "dormindo",
  texto: "dormindo",
  tom: "neutro",
  dica: CONVITE_MODELO,
};

/**
 * A situação que o runtime manda (contrato `SituacaoAgente`) vira expressão e status (DESIGN.md
 * §6 e Estados.dc.html). Pausa, desligamento e sono ganham da atividade: um agente pausado no
 * meio de uma execução já não está trabalhando para você. Teto de gasto é o único sono com cara
 * de preocupado, porque pede uma decisão sua.
 */
export function lerSituacao(situacao: SituacaoAgente | null | undefined): LeituraSituacao {
  if (!situacao) return SEM_SITUACAO;
  switch (situacao.estado) {
    case "desligado":
      return { expressao: "dormindo", texto: "desligado", tom: "apagado", dica: null };
    case "pausado":
      return { expressao: "dormindo", texto: "pausado", tom: "neutro", dica: null };
    case "dormindo":
      if (situacao.motivoSono === "teto") {
        return { expressao: "erro", texto: "parado", tom: "aviso", dica: "Chegou ao teto de hoje" };
      }
      return {
        expressao: "dormindo",
        texto: "dormindo",
        tom: "neutro",
        dica: situacao.motivoSono === "sem_modelo" ? CONVITE_MODELO : null,
      };
    case "ativo":
      switch (situacao.atividade) {
        case "trabalhando":
          return { expressao: "trabalhando", texto: "trabalhando", tom: "sucesso", dica: null };
        case "esperando":
          return { expressao: "esperando", texto: "esperando você", tom: "aviso", dica: null };
        case "erro":
          return { expressao: "erro", texto: "erro", tom: "perigo", dica: null };
        case "ocioso":
          return { expressao: "ocioso", texto: "ocioso", tom: "neutro", dica: null };
      }
  }
  return SEM_SITUACAO;
}
