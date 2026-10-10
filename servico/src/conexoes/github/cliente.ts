import type { EstadoCi, EstadoItemGithub, PapelGithub, TipoItemGithub } from "@moductus/contrato";
import { GhAusente, type ExecutorGh } from "./gh.ts";

/**
 * O que o Nuno lê do GitHub (AGENTS.md §2 Nuno): PRs esperando seu review, seus PRs (com review a
 * atender ou CI quebrado) e issues atribuídas a você. Uma consulta GraphQL só, pelo `gh`, traz as
 * três buscas com a decisão de review e o resultado do CI como o GitHub mostra na página do PR.
 *
 * A busca do GitHub não tem ETag (a REST responde `Cache-Control: no-cache` sem `ETag`, e o
 * GraphQL nunca tem), então o custo fica baixo pelo número de chamadas: uma a cada 15 minutos.
 */

/** Itens por busca; acima disso ficam os atualizados mais recentemente. */
export const ITENS_POR_BUSCA = 100;

const BUSCAS = {
  revisar: "is:open is:pr review-requested:@me archived:false sort:updated-desc",
  meus: "is:open is:pr author:@me archived:false sort:updated-desc",
  atribuidas: "is:open is:issue assignee:@me archived:false sort:updated-desc",
} as const;

const CAMPOS_COMUNS = "number title url state updatedAt author { login } repository { nameWithOwner }";

/** A consulta, numa linha: vai como argumento de linha de comando. */
export const CONSULTA = `
  query($n: Int!) {
    viewer { login }
    revisar: search(query: "${BUSCAS.revisar}", type: ISSUE, first: $n) { nodes { ...pr } }
    meus: search(query: "${BUSCAS.meus}", type: ISSUE, first: $n) { nodes { ...pr } }
    atribuidas: search(query: "${BUSCAS.atribuidas}", type: ISSUE, first: $n) { nodes { ...issue } }
  }
  fragment pr on PullRequest {
    ${CAMPOS_COMUNS}
    reviewDecision
    reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
  fragment issue on Issue { ${CAMPOS_COMUNS} }
`
  .replace(/\s+/g, " ")
  .trim();

/** Um item como o GitHub mostra, pronto para o cache (`github_itens`). */
export interface ItemLido {
  repositorio: string;
  numero: number;
  tipo: TipoItemGithub;
  titulo: string;
  autor: string | null;
  estado: EstadoItemGithub;
  meuPapel: PapelGithub;
  precisaDeMim: boolean;
  ciEstado: EstadoCi | null;
  atualizadoNoGithub: string | null;
  url: string;
}

export type LeituraGithub =
  | { tipo: "ok"; conta: string; itens: ItemLido[] }
  | { tipo: "sem-gh" }
  | { tipo: "sem-login" }
  | { tipo: "falhou"; motivo: string };

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Objeto) : null;

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

const ESTADOS: Record<string, EstadoItemGithub> = { OPEN: "aberto", CLOSED: "fechado", MERGED: "mesclado" };

/** `statusCheckRollup.state`: junta check runs e commit statuses, como o selo da página do PR. */
const CI: Record<string, EstadoCi> = {
  SUCCESS: "passou",
  FAILURE: "falhou",
  ERROR: "falhou",
  PENDING: "rodando",
  EXPECTED: "rodando",
};

function instante(valor: unknown): string | null {
  const t = texto(valor);
  if (!t) return null;
  const data = new Date(t);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function ciDo(no: Objeto): EstadoCi | null {
  const commits = objeto(no.commits)?.nodes;
  const ultimo = Array.isArray(commits) ? objeto(commits[commits.length - 1]) : null;
  const rollup = objeto(objeto(ultimo?.commit)?.statusCheckRollup);
  const estado = texto(rollup?.state);
  return estado ? (CI[estado] ?? null) : null;
}

/** O review foi pedido a você pelo nome, não a um time de que você faz parte. */
function pedidoAVoce(no: Objeto, conta: string): boolean {
  const pedidos = objeto(no.reviewRequests)?.nodes;
  if (!Array.isArray(pedidos)) return false;
  return pedidos.some(
    (p) => texto(objeto(objeto(p)?.requestedReviewer)?.login)?.toLowerCase() === conta.toLowerCase(),
  );
}

/**
 * Quando o item precisa de você: review pedido a você pelo nome (pedido a um time só aparece na
 * lista) e issue atribuída sempre; seu PR quando alguém pediu mudanças ou o CI quebrou.
 */
function precisaDeMim(papel: PapelGithub, no: Objeto, ci: EstadoCi | null, conta: string): boolean {
  if (papel === "revisor") return pedidoAVoce(no, conta);
  if (papel === "atribuido") return true;
  return no.reviewDecision === "CHANGES_REQUESTED" || ci === "falhou";
}

/** Um nó da busca; `null` quando falta o que identifica o item (repositório, número, URL). */
function lerNo(valor: unknown, papel: PapelGithub, tipo: TipoItemGithub, conta: string): ItemLido | null {
  const no = objeto(valor);
  if (!no) return null;
  const repositorio = texto(objeto(no.repository)?.nameWithOwner);
  const numero = no.number;
  const url = texto(no.url);
  if (!repositorio || typeof numero !== "number" || !Number.isInteger(numero) || numero <= 0) return null;
  if (!url || !/^https?:\/\//.test(url)) return null;
  const ci = tipo === "pr" ? ciDo(no) : null;
  return {
    repositorio,
    numero,
    tipo,
    titulo: typeof no.title === "string" ? no.title : "",
    autor: texto(objeto(no.author)?.login),
    estado: ESTADOS[String(no.state)] ?? "aberto",
    meuPapel: papel,
    precisaDeMim: precisaDeMim(papel, no, ci, conta),
    ciEstado: ci,
    atualizadoNoGithub: instante(no.updatedAt),
    url,
  };
}

/**
 * Lê a resposta da consulta. Tolerante a campo novo e a nó vazio; recusa (lança) quando falta
 * uma das buscas, porque um cache montado pela metade apagaria itens que ainda existem.
 */
export function itensDaResposta(resposta: unknown): { conta: string; itens: ItemLido[] } {
  const dados = objeto(objeto(resposta)?.data);
  const conta = texto(objeto(dados?.viewer)?.login);
  if (!dados || !conta) throw new Error("a resposta do GitHub veio sem o usuário");
  const buscas: [keyof typeof BUSCAS, PapelGithub, TipoItemGithub][] = [
    ["revisar", "revisor", "pr"],
    ["meus", "autor", "pr"],
    ["atribuidas", "atribuido", "issue"],
  ];
  // PR e issue dividem a numeração: o mesmo item em duas buscas fica com o primeiro papel.
  const porChave = new Map<string, ItemLido>();
  for (const [chave, papel, tipo] of buscas) {
    const nos = objeto(dados[chave])?.nodes;
    if (!Array.isArray(nos)) throw new Error("a resposta do GitHub veio incompleta");
    for (const no of nos) {
      const item = lerNo(no, papel, tipo, conta);
      const id = item && `${item.repositorio.toLowerCase()}#${item.numero}`;
      if (item && id && !porChave.has(id)) porChave.set(id, item);
    }
  }
  return { conta, itens: [...porChave.values()] };
}

/** A primeira linha útil do stderr, sem o prefixo `gh:`. */
export function motivoDo(erro: string): string {
  const linha = erro
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "");
  return (linha ?? "o gh falhou sem dizer o motivo").replace(/^gh:\s*/, "");
}

/** Sem login: o `gh` sai com 4 ("gh auth login"), ou o token guardado nele deixou de valer (401). */
export function semLogin(codigo: number, erro: string): boolean {
  return codigo === 4 || /gh auth login|HTTP 401|Bad credentials/i.test(erro);
}

/** Uma leitura do GitHub. Nunca lança: o que deu errado vira o motivo, para a Conexão explicar. */
export async function lerGithub(gh: ExecutorGh): Promise<LeituraGithub> {
  let saida;
  try {
    saida = await gh(["api", "graphql", "-f", `query=${CONSULTA}`, "-F", `n=${ITENS_POR_BUSCA}`]);
  } catch (erro) {
    if (erro instanceof GhAusente) return { tipo: "sem-gh" };
    return { tipo: "falhou", motivo: erro instanceof Error ? erro.message : String(erro) };
  }
  if (semLogin(saida.codigo, saida.erro)) return { tipo: "sem-login" };
  // Erro do GraphQL também sai com código 1, às vezes com os dados inteiros no stdout: valem.
  try {
    return { tipo: "ok", ...itensDaResposta(JSON.parse(saida.saida)) };
  } catch (erro) {
    if (saida.codigo !== 0) return { tipo: "falhou", motivo: motivoDo(saida.erro) };
    return { tipo: "falhou", motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}
