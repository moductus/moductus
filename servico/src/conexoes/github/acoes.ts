import type { EstadoItemGithub, TipoItemGithub } from "@moductus/contrato";
import { motivoDo, semLogin } from "./cliente.ts";
import type { ExecutorGh } from "./gh.ts";

/**
 * O que o Nuno faz num item do GitHub além de listar (AGENTS.md §2 Nuno): ler um PR ou uma issue
 * para resumir, e comentar com o seu sim. Tudo pelo `gh`, com a autenticação que você fez nele.
 * O texto que vem do GitHub é dado, nunca instrução: chega ao modelo encurtado e marcado como
 * conteúdo do item.
 */

/**
 * `dono/nome`, como o GitHub escreve. O mesmo texto vira caminho da API, então nada além disso: o
 * dono não começa com ponto nem hífen, e o nome não é `.` nem `..` (`.github` vale).
 */
export const REPOSITORIO = /^[A-Za-z0-9][A-Za-z0-9_-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

/** Corpo do PR ou da issue que vai ao modelo; o resto fica no link. */
export const CORPO_MAXIMO = 4000;
/** Cada review ou comentário. */
export const FALA_MAXIMA = 1000;
/** Reviews e comentários mais recentes que vão junto. */
export const ULTIMAS_FALAS = 10;

/** O `gh` respondeu que não tem conta conectada (ou o token dele deixou de valer). */
export class SemLoginGh extends Error {
  override readonly name = "SemLoginGh";
  constructor() {
    super("o gh não está conectado a uma conta");
  }
}

export interface AlvoGithub {
  repositorio: string;
  numero: number;
}

export interface FalaGithub {
  autor: string | null;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED` nos reviews; vazio nos comentários. */
  estado: string | null;
  texto: string;
  em: string | null;
}

interface DetalheComum {
  repositorio: string;
  numero: number;
  titulo: string;
  autor: string | null;
  estado: EstadoItemGithub;
  /** Encurtado em {@link CORPO_MAXIMO}; `corpoCortado` diz se ficou texto de fora. */
  corpo: string;
  corpoCortado: boolean;
  comentarios: FalaGithub[];
  url: string | null;
}

export interface DetalhePr extends DetalheComum {
  tipo: "pr";
  rascunho: boolean;
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`; vazio quando o repositório não exige review. */
  decisaoReview: string | null;
  adicoes: number | null;
  remocoes: number | null;
  arquivos: number | null;
  reviews: FalaGithub[];
  /** Nome de cada verificação que falhou no último commit. */
  verificacoesQueFalharam: string[];
}

export interface DetalheIssue extends DetalheComum {
  tipo: "issue";
  atribuidas: string[];
  rotulos: string[];
}

export type DetalheGithub = DetalhePr | DetalheIssue;

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Objeto) : null;

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

const numero = (valor: unknown): number | null =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : null;

const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);

const ESTADOS: Record<string, EstadoItemGithub> = { OPEN: "aberto", CLOSED: "fechado", MERGED: "mesclado" };

/** Conclusões de check run e estados de commit status que contam como falha. */
const FALHAS = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

const CAMPOS_PR =
  "number,title,body,author,state,isDraft,reviewDecision,additions,deletions,changedFiles,reviews,comments,statusCheckRollup,url";
const CAMPOS_ISSUE = "number,title,body,author,state,assignees,labels,comments,url";

function encurtar(valor: string, maximo: number): { texto: string; cortado: boolean } {
  if (valor.length <= maximo) return { texto: valor, cortado: false };
  return { texto: `${valor.slice(0, maximo - 1).trimEnd()}…`, cortado: true };
}

/** As últimas falas, a mais antiga primeiro, cada uma encurtada. */
function falas(valor: unknown, campoData: string): FalaGithub[] {
  return lista(valor)
    .map(objeto)
    .filter((f): f is Objeto => f !== null)
    .slice(-ULTIMAS_FALAS)
    .map((f) => ({
      autor: texto(objeto(f.author)?.login),
      estado: texto(f.state),
      texto: encurtar(typeof f.body === "string" ? f.body : "", FALA_MAXIMA).texto,
      em: texto(f[campoData]),
    }));
}

function comum(dados: Objeto, alvo: AlvoGithub): DetalheComum {
  const corpo = encurtar(typeof dados.body === "string" ? dados.body : "", CORPO_MAXIMO);
  return {
    repositorio: alvo.repositorio,
    numero: numero(dados.number) ?? alvo.numero,
    titulo: typeof dados.title === "string" ? dados.title : "",
    autor: texto(objeto(dados.author)?.login),
    estado: ESTADOS[String(dados.state)] ?? "aberto",
    corpo: corpo.texto,
    corpoCortado: corpo.cortado,
    comentarios: falas(dados.comments, "createdAt"),
    url: texto(dados.url),
  };
}

/** Lê a resposta do `gh pr view --json` ou do `gh issue view --json`. Tolerante a campo novo. */
export function detalheDaResposta(tipo: TipoItemGithub, resposta: unknown, alvo: AlvoGithub): DetalheGithub {
  const dados = objeto(resposta);
  if (!dados) throw new Error("o GitHub respondeu num formato que não reconheço");
  if (tipo === "issue") {
    return {
      tipo: "issue",
      ...comum(dados, alvo),
      atribuidas: lista(dados.assignees)
        .map((a) => texto(objeto(a)?.login))
        .filter((a): a is string => a !== null),
      rotulos: lista(dados.labels)
        .map((r) => texto(objeto(r)?.name))
        .filter((r): r is string => r !== null),
    };
  }
  const falharam = lista(dados.statusCheckRollup)
    .map(objeto)
    .filter((c): c is Objeto => c !== null)
    .filter((c) => FALHAS.has(String(c.conclusion)) || FALHAS.has(String(c.state)))
    .map((c) => texto(c.name) ?? texto(c.context) ?? "verificação sem nome");
  return {
    tipo: "pr",
    ...comum(dados, alvo),
    rascunho: dados.isDraft === true,
    decisaoReview: texto(dados.reviewDecision),
    adicoes: numero(dados.additions),
    remocoes: numero(dados.deletions),
    arquivos: numero(dados.changedFiles),
    reviews: falas(dados.reviews, "submittedAt"),
    verificacoesQueFalharam: [...new Set(falharam)],
  };
}

/** Roda o `gh` e devolve o stdout; sem login lança {@link SemLoginGh}, e `GhAusente` sobe como veio. */
async function rodar(gh: ExecutorGh, args: readonly string[]): Promise<string> {
  const saida = await gh(args);
  if (semLogin(saida.codigo, saida.erro)) throw new SemLoginGh();
  if (saida.codigo !== 0) throw new Error(motivoDo(saida.erro));
  return saida.saida;
}

function conferirRepositorio(repositorio: string): void {
  if (!REPOSITORIO.test(repositorio)) throw new Error(`"${repositorio}" não é um repositório dono/nome`);
}

/** O PR ou a issue, para resumir. */
export async function lerDetalhe(
  gh: ExecutorGh,
  alvo: AlvoGithub & { tipo: TipoItemGithub },
): Promise<DetalheGithub> {
  conferirRepositorio(alvo.repositorio);
  const comando = alvo.tipo === "pr" ? "pr" : "issue";
  const campos = alvo.tipo === "pr" ? CAMPOS_PR : CAMPOS_ISSUE;
  const saida = await rodar(gh, [
    comando,
    "view",
    String(alvo.numero),
    "--repo",
    alvo.repositorio,
    "--json",
    campos,
  ]);
  let resposta: unknown;
  try {
    resposta = JSON.parse(saida);
  } catch {
    throw new Error("o GitHub respondeu num formato que não reconheço");
  }
  return detalheDaResposta(alvo.tipo, resposta, alvo);
}

/**
 * Comenta no PR ou na issue (no GitHub, PR é uma issue: o mesmo endereço serve aos dois). O texto
 * vai como campo cru (`-f`), que o `gh` não lê como arquivo nem como número; sem shell no meio.
 * Devolve o endereço do comentário.
 */
export async function comentar(
  gh: ExecutorGh,
  alvo: AlvoGithub & { texto: string },
): Promise<{ url: string | null }> {
  conferirRepositorio(alvo.repositorio);
  const saida = await rodar(gh, [
    "api",
    "--method",
    "POST",
    `repos/${alvo.repositorio}/issues/${alvo.numero}/comments`,
    "-f",
    `body=${alvo.texto}`,
  ]);
  try {
    return { url: texto(objeto(JSON.parse(saida))?.html_url) };
  } catch {
    // O comentário foi feito; só a resposta veio estranha.
    return { url: null };
  }
}
