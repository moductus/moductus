import {
  BLOCOS_INICIO,
  CONFIG_PADRAO,
  type ApresentacaoRotina,
  type ConfigInicio,
  type IdBlocoInicio,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useLidaComAviso } from "../../janelas/painel/dados.ts";
import { servico } from "../../servico/conexao.ts";

/**
 * Os blocos do Início (Sistema.dc.html, InicioEditar.dc.html): a ordem e os escondidos vêm da
 * configuração (`config.inicio`), que o serviço valida e guarda; aqui só a conta de onde cada
 * bloco fica na tela e o que muda quando você mexe nele.
 */

export interface DadosBloco {
  nome: string;
  /** O que o bloco mostra, no modo de editar. */
  descricao: string;
  /** As linhas do esboço no modo de editar, em % da largura. */
  esboco: readonly number[];
}

export const DADOS_BLOCOS: Readonly<Record<IdBlocoInicio, DadosBloco>> = {
  briefing: {
    nome: "Briefing da Alba",
    descricao: "A abertura do dia, com a linha de cada agente que tem novidade.",
    esboco: [62, 44],
  },
  tarefas: {
    nome: "Tarefas de hoje",
    descricao: "As próximas 5, com a contagem do dia e a captura por frase.",
    esboco: [80, 66, 72],
  },
  foco: { nome: "Foco", descricao: "O ciclo rodando, o tempo de hoje e a tarefa ligada.", esboco: [40, 70] },
  financas: {
    nome: "Finanças",
    descricao: "O gasto do mês e o orçamento por categoria.",
    esboco: [70, 56, 64],
  },
  dev: { nome: "Dev", descricao: "PRs esperando você e CI quebrado, por repositório.", esboco: [74, 58, 66] },
  sessoes: {
    nome: "Sessões de IA",
    descricao: "As sessões abertas e as que esperam você.",
    esboco: [70, 52, 60],
  },
};

export const INICIO_PADRAO: ConfigInicio = CONFIG_PADRAO.inicio;

/** Quantas tarefas o bloco mostra ("As próximas 5"). */
export const TAREFAS_NO_INICIO = 5;
/** Quantos PRs e quantas sessões cabem no bloco; o resto fica na área. */
export const ITENS_NO_BLOCO = 3;
/** As colunas da grade do Início. */
export const COLUNAS = 3;

/**
 * A ordem de todos os blocos, escondidos incluídos: a guardada sem repetição e, no fim, o que
 * não está nela (um bloco que chegou numa versão nova), na ordem do padrão.
 */
export function ordemCompleta(inicio: ConfigInicio): IdBlocoInicio[] {
  const vistos = new Set<IdBlocoInicio>();
  for (const id of inicio.ordem) if (BLOCOS_INICIO.includes(id)) vistos.add(id);
  for (const id of BLOCOS_INICIO) vistos.add(id);
  return [...vistos];
}

/** Os blocos que aparecem, na ordem. */
export function visiveis(inicio: ConfigInicio): IdBlocoInicio[] {
  const escondidos = new Set(inicio.escondidos);
  return ordemCompleta(inicio).filter((id) => !escondidos.has(id));
}

/** Os escondidos, na ordem em que estariam. */
export function escondidos(inicio: ConfigInicio): IdBlocoInicio[] {
  const fora = new Set(inicio.escondidos);
  return ordemCompleta(inicio).filter((id) => fora.has(id));
}

/** "3º de 5": o lugar entre os que aparecem; escondido não tem lugar. */
export function posicao(inicio: ConfigInicio, id: IdBlocoInicio): { numero: number; total: number } | null {
  const lista = visiveis(inicio);
  const i = lista.indexOf(id);
  return i < 0 ? null : { numero: i + 1, total: lista.length };
}

const comOrdem = (inicio: ConfigInicio, ordem: IdBlocoInicio[]): ConfigInicio => ({
  ordem,
  escondidos: escondidos({ ...inicio, ordem }),
});

/**
 * Alt ↑ e Alt ↓, ou as setas do bloco: troca de lugar com o vizinho que aparece (o escondido no
 * meio não conta). Na ponta, `null`: nada muda.
 */
export function mover(inicio: ConfigInicio, id: IdBlocoInicio, passo: -1 | 1): ConfigInicio | null {
  const lista = visiveis(inicio);
  const i = lista.indexOf(id);
  const vizinho = i < 0 ? undefined : lista[i + passo];
  if (vizinho === undefined) return null;
  const ordem = ordemCompleta(inicio);
  const a = ordem.indexOf(id);
  const b = ordem.indexOf(vizinho);
  [ordem[a], ordem[b]] = [vizinho, id];
  return comOrdem(inicio, ordem);
}

/**
 * Arrastar e soltar sobre outro bloco: o arrastado fica no lugar dele, antes se veio de baixo e
 * depois se veio de cima. Sobre si mesmo, `null`.
 */
export function soltar(inicio: ConfigInicio, id: IdBlocoInicio, alvo: IdBlocoInicio): ConfigInicio | null {
  if (id === alvo) return null;
  const ordem = ordemCompleta(inicio);
  const para = ordem.indexOf(alvo);
  ordem.splice(ordem.indexOf(id), 1);
  ordem.splice(para, 0, id);
  return comOrdem(inicio, ordem);
}

/** Esconder não apaga nada: o bloco guarda o lugar e volta para ele. */
export function esconder(inicio: ConfigInicio, id: IdBlocoInicio): ConfigInicio {
  const ordem = ordemCompleta(inicio);
  const fora = new Set([...inicio.escondidos, id]);
  return { ordem, escondidos: ordem.filter((b) => fora.has(b)) };
}

export function mostrar(inicio: ConfigInicio, id: IdBlocoInicio): ConfigInicio {
  return { ordem: ordemCompleta(inicio), escondidos: escondidos(inicio).filter((b) => b !== id) };
}

/** Os blocos que aparecem divididos em colunas, como no Sistema.dc.html. */
export type TrechoInicio =
  { tipo: "faixa"; id: IdBlocoInicio } | { tipo: "colunas"; colunas: IdBlocoInicio[][] };

/**
 * Como os blocos ficam na tela: o briefing é uma faixa de lado a lado onde estiver; os outros vão
 * em até três colunas, na ordem, e as últimas colunas levam o que sobra. Com o padrão, Tarefas
 * ocupa a primeira coluna inteira, Foco e Finanças a segunda, Dev e Sessões a terceira.
 */
export function trechosDoInicio(lista: readonly IdBlocoInicio[]): TrechoInicio[] {
  const trechos: TrechoInicio[] = [];
  let grupo: IdBlocoInicio[] = [];
  const fechar = () => {
    if (grupo.length > 0) trechos.push({ tipo: "colunas", colunas: emColunas(grupo) });
    grupo = [];
  };
  for (const id of lista) {
    if (id === "briefing") {
      fechar();
      trechos.push({ tipo: "faixa", id });
    } else {
      grupo.push(id);
    }
  }
  fechar();
  return trechos;
}

function emColunas(grupo: readonly IdBlocoInicio[]): IdBlocoInicio[][] {
  const quantas = Math.min(COLUNAS, grupo.length);
  const base = Math.floor(grupo.length / quantas);
  const sobra = grupo.length % quantas;
  const colunas: IdBlocoInicio[][] = [];
  let i = 0;
  for (let c = 0; c < quantas; c++) {
    const tamanho = base + (c >= quantas - sobra ? 1 : 0);
    colunas.push(grupo.slice(i, i + tamanho));
    i += tamanho;
  }
  return colunas;
}

/**
 * No modo de editar, a grade tem três colunas e o briefing ocupa a linha inteira; os Escondidos
 * ficam com as colunas que sobram na última linha (a linha toda, se ela fechou).
 */
export function colunasDosEscondidos(lista: readonly IdBlocoInicio[]): number {
  let coluna = 0;
  for (const id of lista) coluna = id === "briefing" ? 0 : (coluna + 1) % COLUNAS;
  return coluna === 0 ? COLUNAS : COLUNAS - coluna;
}

const ordinal = (n: number) => `${n}º`;

/** A linha de status do modo de editar depois de cada mudança. */
export function textoDaMudanca(
  inicio: ConfigInicio,
  id: IdBlocoInicio,
  mudanca: "moveu" | "escondeu" | "mostrou",
): string {
  const { nome } = DADOS_BLOCOS[id];
  if (mudanca === "escondeu") return `${nome} foi para Escondidos. Cada mudança vale na hora.`;
  const lugar = posicao(inicio, id);
  if (!lugar) return "Cada mudança vale na hora.";
  const onde = `o ${ordinal(lugar.numero)} de ${lugar.total} ${lugar.total === 1 ? "bloco" : "blocos"}`;
  return mudanca === "moveu"
    ? `${nome} agora é ${onde}. Cada mudança vale na hora.`
    : `${nome} voltou como ${onde}. Cada mudança vale na hora.`;
}

const pedirBriefing = () => servico.pedir("rotinas.hoje").then((hoje) => hoje.briefing);
const ouvirBriefing = (receber: (briefing: ApresentacaoRotina | null) => void) =>
  servico.ouvir("rotinas.apareceu", (apresentacao) => {
    if (apresentacao.tipo === "briefing") receber(apresentacao);
  });

/** O briefing de hoje, se já apareceu: a carga ao conectar e o que `rotinas.apareceu` trouxer. */
export const useBriefingDeHoje = (canal: EstadoConexao) =>
  useLidaComAviso(canal, pedirBriefing, ouvirBriefing);
