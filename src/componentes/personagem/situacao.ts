import type { SituacaoAgente } from "@moductus/contrato";
import type { TomSelo } from "../Selo.tsx";
import type { EstadoPersonagem, TomMoldura } from "./agentes.ts";

/** Como um agente aparece: a expressão do personagem, o anel em volta e o status escrito ao lado. */
export interface LeituraSituacao {
  expressao: EstadoPersonagem;
  /** Anel da cabeça nas listas e no dock; segue o tom do status, não a expressão. */
  moldura: TomMoldura;
  /** O status como o Agentes.dc.html e o Estados.dc.html escrevem ("esperando você", "parado"). */
  texto: string;
  tom: TomSelo;
  /** O que fazer, quando há uma saída óbvia; vai no rótulo e na dica do dock. */
  dica: string | null;
}

/** Convite enquanto nenhum modelo está escolhido (fase 1 e "sem_modelo" do runtime). */
export const CONVITE_MODELO = "Conectar um modelo";

/** Sem notícia do serviço: o time dorme, como na fase 1, e convida a conectar um modelo. */
export const SEM_SITUACAO: LeituraSituacao = {
  expressao: "dormindo",
  moldura: "nenhuma",
  texto: "dormindo",
  tom: "neutro",
  dica: CONVITE_MODELO,
};

const DORMINDO: Omit<LeituraSituacao, "texto" | "tom" | "dica"> = {
  expressao: "dormindo",
  moldura: "nenhuma",
};

/**
 * A situação que o runtime manda (contrato `SituacaoAgente`) vira expressão, anel e status
 * (DESIGN.md §6 e Estados.dc.html). Pausa, desligamento e sono ganham da atividade: um agente
 * pausado no meio de uma execução já não está trabalhando para você. Teto de gasto é o único
 * sono com cara de preocupado, porque pede uma decisão sua, mas o anel é de aviso: vermelho
 * fica só para erro de verdade.
 */
export function lerSituacao(situacao: SituacaoAgente | null | undefined): LeituraSituacao {
  if (!situacao) return SEM_SITUACAO;
  switch (situacao.estado) {
    case "desligado":
      return { ...DORMINDO, texto: "desligado", tom: "apagado", dica: null };
    case "pausado":
      return { ...DORMINDO, texto: "pausado", tom: "neutro", dica: null };
    case "dormindo":
      if (situacao.motivoSono === "teto") {
        return {
          expressao: "erro",
          moldura: "aviso",
          texto: "parado",
          tom: "aviso",
          dica: "Chegou ao teto de hoje",
        };
      }
      return {
        ...DORMINDO,
        texto: "dormindo",
        tom: "neutro",
        dica: situacao.motivoSono === "sem_modelo" ? CONVITE_MODELO : null,
      };
    case "ativo":
      switch (situacao.atividade) {
        case "trabalhando":
          return {
            expressao: "trabalhando",
            moldura: "sucesso",
            texto: "trabalhando",
            tom: "sucesso",
            dica: null,
          };
        case "esperando":
          return {
            expressao: "esperando",
            moldura: "aviso",
            texto: "esperando você",
            tom: "aviso",
            dica: null,
          };
        case "erro":
          return { expressao: "erro", moldura: "perigo", texto: "erro", tom: "perigo", dica: null };
        case "ocioso":
          return { expressao: "ocioso", moldura: "nenhuma", texto: "ocioso", tom: "neutro", dica: null };
      }
  }
  return SEM_SITUACAO;
}
