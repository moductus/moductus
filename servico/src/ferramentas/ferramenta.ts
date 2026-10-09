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

/**
 * O texto do cartão de uma ação `externo`, na voz do agente: o que vai acontecer, o tamanho e se
 * dá para desfazer; o botão é verbo com objeto ("Comentar no #142"), nunca "OK".
 */
export interface TextoCartao {
  descricao: string;
  rotulo: string;
  /** Botão de recusar ("Depois"); sem ele, a interface mostra "Negar". */
  rotuloRecusar?: string;
  desfazivel?: boolean;
}

export interface DefinicaoFerramenta<E extends z.ZodObject> {
  nome: string;
  /** Lida pelo modelo para decidir quando chamar e pelo usuário em `/capacidades`. */
  descricao: string;
  entrada: E;
  efeito: Efeito;
  /** Chamada só com a entrada já validada; erro lançado volta ao modelo como texto. */
  executar: (entrada: z.output<E>, ctx: ContextoFerramenta) => unknown;
  /**
   * O cartão de aprovação, obrigatório em `externo`: só a área sabe dizer o que vai acontecer e o
   * tamanho, e um texto genérico pediria o sim sem dizer isso.
   */
  cartao?: (entrada: z.output<E>) => TextoCartao;
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
  /** O texto do cartão para a entrada validada; `null` fora de `externo`. */
  cartao(entrada: unknown): TextoCartao | null;
}

/**
 * OpenAI e Anthropic não aceitam ponto em nome de ferramenta, e o Claude Code troca o ponto por
 * `_` no MCP, o que perde a volta (`arquivos_ler_texto` não diz onde termina o domínio). Gemini e
 * a especificação MCP aceitam ponto, mas um nome só para todos é mais simples. Como nenhum nome
 * do catálogo tem `__`, `dominio__acao` volta sem ambiguidade.
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
  if (efeito === "externo" && !definicao.cartao) {
    throw new Error(`ferramenta "${nome}": ação externo precisa do texto do cartão de aprovação`);
  }
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
    cartao(valor) {
      return definicao.cartao?.(valor as z.output<E>) ?? null;
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

/**
 * Mensagens em português do Brasil: o locale `pt` do Zod cobre quase tudo, mas fala "Demasiado
 * pequeno" nos limites, que são reescritos aqui. Campo que faltou diz isso, em vez de "recebeu
 * undefined".
 */
const mapaDeErros: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "invalid_type" && issue.input === undefined) return "campo obrigatório";
  if (issue.code === "too_small" || issue.code === "too_big") return limite(issue) ?? pt(issue);
  return pt(issue);
};

type IssueDeLimite = z.core.$ZodRawIssue<z.core.$ZodIssueTooSmall | z.core.$ZodIssueTooBig>;

/** "precisa ser maior que 0", "pode ter no máximo 3 caracteres"; outra origem fica com o locale. */
function limite(issue: IssueDeLimite): string | null {
  const minimo = issue.code === "too_small";
  const valor = Number(minimo ? issue.minimum : issue.maximum);
  const inclusivo = issue.inclusive ?? true;
  const plural = (um: string, varios: string) => `${valor} ${valor === 1 ? um : varios}`;
  switch (issue.origin) {
    case "number":
    case "int":
    case "bigint":
      if (minimo) return `precisa ser ${inclusivo ? "pelo menos" : "maior que"} ${valor}`;
      return `precisa ser ${inclusivo ? "no máximo" : "menor que"} ${valor}`;
    case "string":
      return `${minimo ? "precisa ter pelo menos" : "pode ter no máximo"} ${plural("caractere", "caracteres")}`;
    case "array":
    case "set":
      return `${minimo ? "precisa ter pelo menos" : "pode ter no máximo"} ${plural("item", "itens")}`;
    default:
      return null;
  }
}

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
