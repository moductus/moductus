import type { SituacaoAgente } from "@moductus/contrato";
import type { TomSelo } from "../Selo.tsx";
import type { EstadoPersonagem, TomMoldura } from "./agentes.ts";
import { quando } from "./quando.ts";

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
  /**
   * Ponto no canto da cabeça no dock (Estados.dc.html, "No dock"): vermelho até o modelo voltar
   * a responder, amarelo no teto. Sono por limite e pausa não têm ponto: os olhos fechados dizem.
   */
  ponto: "perigo" | "aviso" | null;
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
  ponto: null,
};

const DORMINDO: Pick<LeituraSituacao, "expressao" | "moldura" | "ponto"> = {
  expressao: "dormindo",
  moldura: "nenhuma",
  ponto: null,
};

/** Falhas do provedor que pedem a cara de erro: o modelo não responde, não aceita a chave ou sumiu. */
const DICA_FALHA = {
  fora_do_ar: "Modelo fora do ar",
  credencial: "Chave do modelo recusada",
  ausente: "CLI do modelo não encontrado",
} as const;

/** "Volta seg 9h" e "tenta de novo às 14:05": a hora que o runtime deu, ou "em breve" sem ela. */
function quandoVolta(dormeAte: string | null, agora: Date): string | null {
  return dormeAte ? quando(dormeAte, agora, "curta") : null;
}

/**
 * A situação que o runtime manda (contrato `SituacaoAgente`) vira expressão, anel e status
 * (DESIGN.md §6 e Estados.dc.html). Pausa, desligamento e sono ganham da atividade: um agente
 * pausado no meio de uma execução já não está trabalhando para você. O sono por falha do provedor
 * (fora do ar, chave recusada, CLI ausente) é o "Erro de provedor" do quadro: cara preocupada,
 * anel e ponto vermelhos até o modelo voltar. O limite de uso é sono tranquilo, com a hora de
 * volta na dica. Teto de gasto pede uma decisão sua: cara preocupada, mas anel e ponto de aviso.
 */
export function lerSituacao(
  situacao: SituacaoAgente | null | undefined,
  agora: Date = new Date(),
): LeituraSituacao {
  if (!situacao) return SEM_SITUACAO;
  switch (situacao.estado) {
    case "desligado":
      return { ...DORMINDO, texto: "desligado", tom: "apagado", dica: null };
    case "pausado":
      return { ...DORMINDO, texto: "pausado", tom: "neutro", dica: null };
    case "dormindo": {
      const motivo = situacao.motivoSono;
      const volta = quandoVolta(situacao.dormeAte, agora);
      if (motivo === "teto") {
        return {
          expressao: "erro",
          moldura: "aviso",
          texto: "parado",
          tom: "aviso",
          dica: "Chegou ao teto de hoje",
          ponto: "aviso",
        };
      }
      if (motivo === "fora_do_ar" || motivo === "credencial" || motivo === "ausente") {
        return {
          expressao: "erro",
          moldura: "perigo",
          texto: "erro",
          tom: "perigo",
          dica: `${DICA_FALHA[motivo]}, tenta de novo ${volta ?? "em breve"}`,
          ponto: "perigo",
        };
      }
      if (motivo === "limite") {
        return {
          ...DORMINDO,
          texto: "dormindo",
          tom: "neutro",
          dica: volta ? `Volta ${volta}` : "Volta quando o limite renovar",
        };
      }
      return {
        ...DORMINDO,
        texto: "dormindo",
        tom: "neutro",
        dica: motivo === "sem_modelo" ? CONVITE_MODELO : null,
      };
    }
    case "ativo":
      switch (situacao.atividade) {
        case "trabalhando":
          return {
            expressao: "trabalhando",
            moldura: "sucesso",
            texto: "trabalhando",
            tom: "sucesso",
            dica: null,
            ponto: null,
          };
        case "esperando":
          return {
            expressao: "esperando",
            moldura: "aviso",
            texto: "esperando você",
            tom: "aviso",
            dica: null,
            ponto: null,
          };
        case "erro":
          return {
            expressao: "erro",
            moldura: "perigo",
            texto: "erro",
            tom: "perigo",
            dica: null,
            ponto: "perigo",
          };
        case "ocioso":
          return {
            expressao: "ocioso",
            moldura: "nenhuma",
            texto: "ocioso",
            tom: "neutro",
            dica: null,
            ponto: null,
          };
      }
  }
  return SEM_SITUACAO;
}
