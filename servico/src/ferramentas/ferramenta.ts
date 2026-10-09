import type { Capacidade, Efeito } from "@moductus/contrato";
import { z } from "zod";
import type { FerramentaOferecida } from "../provedores/provedor.ts";

/**
 * Uma ferramenta é uma área exposta (AGENTS.md §4, ADR-0008): schema Zod da entrada, efeito e a
 * função da área que faz o trabalho. É declarada uma vez e daqui saem o tool calling das APIs, o
 * servidor MCP e a lista `/capacidades`.
 */

/** `dominio.acao`, como nas listas dos agentes (`PadraoFerramenta` do contrato), sem o `*`. */
const NOME = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

/** O nome que as APIs e o MCP aceitam: letras, números, `_` e `-`, até 64. */
const NOME_MODELO = /^[a-zA-Z0-9_-]{1,64}$/;

/** Quem chama e em que execução: vira o carimbo de origem do que a área gravar. */
export interface ContextoFerramenta {
  agenteId: string;
  execucaoId: string | null;
  /** Cancela junto com a execução. */
  sinal: AbortSignal;
}

export interface DefinicaoFerramenta<E extends z.ZodObject> {
  nome: string;
  /** Lida pelo modelo para decidir quando chamar e pelo usuário em `/capacidades`. */
  descricao: string;
  entrada: E;
  efeito: Efeito;
  /** Chamada só com a entrada já validada; erro lançado volta ao modelo como texto. */
  executar: (entrada: z.output<E>, ctx: ContextoFerramenta) => unknown;
}

export type Validacao = { ok: true; valor: unknown } | { ok: false; erro: string };

/** A ferramenta pronta para o catálogo, sem o tipo da entrada (o Zod confere na hora). */
export interface Ferramenta {
  readonly nome: string;
  /** O nome que o modelo vê e usa para chamar: `sessoes.listar` vira `sessoes__listar`. */
  readonly nomeModelo: string;
  readonly descricao: string;
  readonly efeito: Efeito;
  /** A entrada em JSON Schema, do jeito que as APIs pedem (objeto, sem `$schema`). */
  readonly esquema: Record<string, unknown>;
  validar(entrada: unknown): Validacao;
  /** Roda a função da área; `entrada` tem de ter passado por {@link validar}. */
  executar(entrada: unknown, ctx: ContextoFerramenta): Promise<unknown>;
}

/**
 * O ponto não é aceito em nome de ferramenta pelas APIs (OpenAI, Anthropic, Gemini) nem pelo
 * Claude Code no MCP. Como nenhum nome do catálogo tem `__`, a troca tem volta.
 */
export function nomeParaModelo(nome: string): string {
  return nome.replace(".", "__");
}

/**
 * Declara uma ferramenta. Nome fora do padrão ou entrada que não vira JSON Schema falha aqui, na
 * montagem do catálogo, e não na primeira chamada do modelo.
 */
export function ferramenta<E extends z.ZodObject>(definicao: DefinicaoFerramenta<E>): Ferramenta {
  const { nome, descricao, entrada, efeito } = definicao;
  if (!NOME.test(nome) || nome.includes("__")) {
    throw new Error(`ferramenta "${nome}": use dominio.acao em minúsculas, sem "__"`);
  }
  const nomeModelo = nomeParaModelo(nome);
  if (!NOME_MODELO.test(nomeModelo))
    throw new Error(`ferramenta "${nome}": nome longo demais para os modelos`);
  if (descricao.trim() === "") throw new Error(`ferramenta "${nome}": falta a descrição`);
  const esquema = esquemaJson(nome, entrada);

  return {
    nome,
    nomeModelo,
    descricao,
    efeito,
    esquema,
    validar(valor) {
      const r = entrada.safeParse(valor, { error: mapaDeErros });
      return r.success ? { ok: true, valor: r.data } : { ok: false, erro: errosLegiveis(nome, r.error) };
    },
    async executar(valor, ctx) {
      return definicao.executar(valor as z.output<E>, ctx);
    },
  };
}

/** A linha de `/capacidades`. */
export function capacidade(f: Ferramenta): Capacidade {
  return { nome: f.nome, descricao: f.descricao, efeito: f.efeito };
}

/** Como a ferramenta vai ao modelo pelos adaptadores de API e pelo MCP. */
export function oferecida(f: Ferramenta): FerramentaOferecida {
  return { nome: f.nomeModelo, descricao: f.descricao, esquema: f.esquema };
}

/** A entrada como o modelo deve mandar (`io: "input"`: campo com padrão é opcional). */
function esquemaJson(nome: string, entrada: z.ZodObject): Record<string, unknown> {
  let esquema: Record<string, unknown>;
  try {
    esquema = z.toJSONSchema(entrada, { io: "input" }) as Record<string, unknown>;
  } catch (erro) {
    throw new Error(`ferramenta "${nome}": a entrada não vira JSON Schema (${String(erro)})`, {
      cause: erro,
    });
  }
  // As APIs leem o esquema como objeto solto; a versão do JSON Schema só atrapalha algumas.
  delete esquema.$schema;
  return esquema;
}

const pt = z.locales.pt().localeError;

/** Mensagens em português; campo que faltou diz isso, em vez de "recebeu undefined". */
const mapaDeErros: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "invalid_type" && issue.input === undefined) return "campo obrigatório";
  return pt(issue);
};

/**
 * O que volta ao modelo quando a entrada não confere: cada problema com o campo, numa linha só,
 * para ele corrigir a chamada e tentar de novo.
 */
function errosLegiveis(nome: string, erro: z.ZodError): string {
  const problemas = erro.issues.map((issue) => {
    const mensagem = issue.message.replace(/^Entrada inválida:\s*/, "");
    return `${caminho(issue.path)}: ${mensagem}`;
  });
  return `Entrada inválida para ${nome}. ${problemas.join("; ")}.`;
}

/** `itens[0].valor`; a entrada inteira, quando o problema não é de um campo. */
function caminho(partes: readonly PropertyKey[]): string {
  if (partes.length === 0) return "entrada";
  return partes
    .map((p, i) => (typeof p === "number" ? `[${p}]` : `${i === 0 ? "" : "."}${String(p)}`))
    .join("");
}
