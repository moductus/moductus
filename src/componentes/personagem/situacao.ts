import {
  COMANDOS_CLI,
  TIPOS_PROVEDOR_CLI,
  type MotivoSono,
  type Provedor,
  type SituacaoAgente,
  type TipoProvedorCli,
} from "@moductus/contrato";
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

/**
 * O modelo (provedor principal) de um agente, para dizer a falha do jeito dele: um CLI entra com
 * login no terminal, uma API usa chave.
 */
export type ModeloDoAgente = Pick<Provedor, "tipo" | "nome">;

/** O modelo do agente pela lista de provedores; `null` sem modelo ou sem a lista ainda. */
export function modeloDoAgente(
  provedorId: string | null | undefined,
  provedores: readonly Provedor[] | null | undefined,
): ModeloDoAgente | null {
  const provedor = provedorId ? provedores?.find((p) => p.id === provedorId) : undefined;
  return provedor ? { tipo: provedor.tipo, nome: provedor.nome } : null;
}

/** O comando do CLI no terminal ("claude"); `null` quando o modelo é por API ou não se sabe qual. */
export function comandoDoCli(modelo: ModeloDoAgente | null): string | null {
  if (!modelo || !(TIPOS_PROVEDOR_CLI as readonly string[]).includes(modelo.tipo)) return null;
  return COMANDOS_CLI[modelo.tipo as TipoProvedorCli];
}

/**
 * O que falhou, curto, para o dock e as linhas. Credencial num CLI é login, não chave: o CLI roda
 * com a conta do usuário ("Not logged in"). Sem saber o modelo, não se fala de chave nem de login.
 */
function oQueFalhou(motivo: FalhaDoProvedor, modelo: ModeloDoAgente | null): string {
  if (motivo !== "credencial") return DICA_FALHA[motivo];
  if (!modelo) return "Modelo recusou o acesso";
  return comandoDoCli(modelo) ? `${modelo.nome} sem login` : DICA_FALHA.credencial;
}

const MINUTO_MS = 60_000;

/**
 * A hora de tentar de novo já chegou: passou, ou cai no minuto que o relógio mostra (à 01:13,
 * "tenta de novo às 01:13" já soa passado). O serviço acorda o agente nessa hora e tenta; até a
 * notícia chegar, o texto diz que está tentando, em vez de prometer uma hora que já foi.
 */
export function jaTentando(dormeAte: string | null, agora: Date): boolean {
  const volta = dormeAte === null ? Number.NaN : Date.parse(dormeAte);
  if (Number.isNaN(volta)) return false;
  return Math.floor(volta / MINUTO_MS) <= Math.floor(agora.getTime() / MINUTO_MS);
}

/** "tenta de novo às 14:05", "tenta de novo em breve" ou, com a hora chegada, "tentando de novo". */
function tentaDeNovo(dormeAte: string | null, agora: Date): string {
  if (jaTentando(dormeAte, agora)) return "tentando de novo";
  return `tenta de novo ${quandoVolta(dormeAte, agora) ?? "em breve"}`;
}

/**
 * A fala de um cartão. Quando ela manda rodar algo no terminal, o comando vem num campo próprio
 * (aparece como código, depois de `texto`), seguido do resto da frase: o nome do provedor é do
 * usuário e pode ter qualquer caractere, então nada no texto marca onde o código começa.
 */
export interface FalaCartao {
  texto: string;
  comando?: { codigo: string; depois: string };
}

/**
 * A fala do cartão "Erro de provedor" no painel (Estados.dc.html), na voz de quem dormiu ("tento",
 * ou "tentamos" quando são vários). CLI sem login diz como entrar; chave recusada pede para
 * conferir a chave, porque tentar de novo com a mesma não adianta.
 */
export function falaDaFalha(
  motivo: FalhaDoProvedor,
  modelo: ModeloDoAgente | null,
  dormeAte: string | null,
  agora: Date,
  varios: boolean,
): FalaCartao {
  const nome = modelo?.nome ?? "modelo";
  const volta = dormeAte ? quando(dormeAte, agora, "longa") : null;
  const tento = jaTentando(dormeAte, agora)
    ? `${varios ? "estamos" : "estou"} tentando de novo`
    : `${varios ? "tentamos" : "tento"} de novo ${volta ?? "em breve"}`;
  switch (motivo) {
    case "credencial": {
      const comando = comandoDoCli(modelo);
      if (comando) {
        return {
          texto: `O ${nome} está sem login. Entre no terminal com `,
          comando: { codigo: comando, depois: ` e ${tento}.` },
        };
      }
      if (!modelo)
        return { texto: "O modelo recusou o acesso. Nada foi alterado; confira o modelo em Modelos." };
      return { texto: `O ${nome} recusou a chave. Nada foi alterado; confira a chave em Modelos.` };
    }
    case "ausente":
      return { texto: `Não achei o ${nome} neste PC. Nada foi alterado; ${tento}.` };
    case "fora_do_ar":
      return { texto: `O ${nome} não respondeu. Nada foi alterado; ${tento}.` };
  }
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
export function fraseDaSituacao(
  situacao: SituacaoAgente,
  agora: Date = new Date(),
  modelo: ModeloDoAgente | null = null,
): string | null {
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
      return comFila(lerSituacao(situacao, agora, modelo).dica ?? "Dormindo");
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
 * (fora do ar, chave recusada ou CLI sem login, CLI ausente) é o "Erro de provedor" do quadro:
 * cara preocupada, anel e ponto vermelhos até o modelo voltar; o `modelo` diz se a credencial é
 * login ou chave. O limite de uso é sono tranquilo, com a hora de volta na dica. Teto de gasto
 * pede uma decisão sua: cara preocupada, mas anel e ponto de aviso.
 */
export function lerSituacao(
  situacao: SituacaoAgente | null | undefined,
  agora: Date = new Date(),
  modelo: ModeloDoAgente | null = null,
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
          dica: `${oQueFalhou(motivo, modelo)}, ${tentaDeNovo(situacao.dormeAte, agora)}`,
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
