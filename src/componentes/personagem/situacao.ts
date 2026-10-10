import type { MotivoSono, SituacaoAgente } from "@moductus/contrato";
import type { TomSelo } from "../Selo.tsx";
import type { EstadoPersonagem, TomMoldura } from "./agentes.ts";
import { ateQuando, quando } from "./quando.ts";

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

export type FalhaDoProvedor = keyof typeof DICA_FALHA;

/** O sono é por falha do provedor (o "Erro de provedor" do Estados.dc.html), não por limite ou teto. */
export function eFalhaDoProvedor(motivo: MotivoSono | null): motivo is FalhaDoProvedor {
  return motivo !== null && Object.hasOwn(DICA_FALHA, motivo);
}

/** "2 pedidos na fila"; `null` sem fila. */
export function naFila(fila: number): string | null {
  if (fila <= 0) return null;
  return `${fila} ${fila === 1 ? "pedido na fila" : "pedidos na fila"}`;
}

/**
 * A frase de um agente que não está trabalhando para você agora: desligado, em pausa (até quando)
 * ou dormindo (quando volta, ou o que fazer), com a fila que espera por ele. Um texto só por
 * estado, o mesmo no painel do dock, na página do agente e na conversa. Ativo, `null`: quem
 * mostra diz o que ele está fazendo.
 */
export function fraseDaSituacao(situacao: SituacaoAgente, agora: Date = new Date()): string | null {
  const comFila = (frase: string) => {
    const fila = naFila(situacao.fila);
    return fila ? `${frase} · ${fila}` : frase;
  };
  switch (situacao.estado) {
    case "desligado":
      return "Desligado: não trabalha nem responde";
    case "pausado": {
      const ate = situacao.pausadoAte ? ateQuando(situacao.pausadoAte, agora) : null;
      return comFila(`Em pausa ${ate ?? "até você retomar"}`);
    }
    case "dormindo":
      return comFila(lerSituacao(situacao, agora).dica ?? "Dormindo");
    case "ativo":
      return null;
  }
  return null;
}

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
      if (eFalhaDoProvedor(motivo)) {
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
