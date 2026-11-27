import type { DatabaseSync } from "node:sqlite";
import { Script, createContext } from "node:vm";
import {
  CATEGORIA_TRANSFERENCIA,
  type Apagados,
  type Categoria,
  type CriadaPor,
  type MudancaCategoria,
  type MudancaFinancas,
  type MudancaRegraCategoria,
  type NovaCategoria,
  type NovaRegraCategoria,
  type Origem,
  type PedidoApagarCategoria,
  type PedidoRegraCategoria,
  type PropostaRegra,
  type RegraCategoria,
  type ResultadoApagarCategoria,
  type TipoCategoria,
  type TipoPadrao,
} from "@moductus/contrato";
import { nomeChave } from "../../banco/nome-chave.ts";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";

/**
 * Categorias e regras de categoria da Tula (DATA.md §3, ADR-0045): o cadastro de um nível
 * ("Casa › Mercado"), as regras `contem`, `comeca_com` e `regex` e a categorização por código, na
 * ordem do ADR-0045: (1) a regra mais específica (a do usuário antes da do agente, depois o padrão
 * mais longo); (2) o lançamento igual mais recente da mesma conta empresta a categoria; (3) o resto
 * fica "sem categoria" para a Tula sugerir em lote (importação). Quando você troca a categoria de um
 * importado, a área propõe a regra tirada da descrição.
 *
 * A categoria vai à lixeira levando as subcategorias e as regras dela com a mesma marca de
 * `apagado_em`, e volta com elas. Os lançamentos dela ficam "sem categoria" (só com confirmação).
 */

/** Erro com texto para quem usa; o que não for daqui sai pelo canal como erro genérico. */
export class ErroDasCategorias extends Error {}

export const MENSAGEM_CATEGORIA_NAO_ENCONTRADA = "categoria não encontrada";
export const MENSAGEM_REGRA_NAO_ENCONTRADA = "regra não encontrada";
export const MENSAGEM_UM_NIVEL = "subcategoria só tem um nível";
export const MENSAGEM_TEM_SUBCATEGORIAS =
  "categoria com subcategorias, mesmo na lixeira, não vira subcategoria";
export const MENSAGEM_TIPO_DA_MAE = "a subcategoria é do mesmo tipo da categoria mãe";
export const MENSAGEM_NOME_REPETIDO = "já existe uma categoria com esse nome aqui";
export const MENSAGEM_TRANSFERENCIA =
  "a categoria Transferência fica: as transferências entre contas usam ela";
export const MENSAGEM_RESTAURAR_A_MAE = "restaure antes a categoria mãe";
export const MENSAGEM_NAO_ESTA_NA_LIXEIRA = "a categoria não está na lixeira";
export const MENSAGEM_REGRA_DO_USUARIO = "já existe uma regra sua para esse padrão";
export const MENSAGEM_REGRA_REPETIDA = "já existe outra regra com esse padrão";
export const MENSAGEM_PADRAO_CURTO = "o padrão precisa de ao menos 2 letras ou números";
export const MENSAGEM_REGEX_LONGA = "a expressão passa do limite de tamanho";
export const MENSAGEM_REGEX_INVALIDA = "a expressão não é válida";
export const MENSAGEM_REGEX_REFERENCIA = "a expressão não pode repetir um grupo por referência (\\1)";
export const MENSAGEM_REGEX_CATASTROFICA =
  "a expressão pode travar a leitura: tem repetição dentro de repetição";
export const MENSAGEM_REGEX_LENTA = "a expressão demora demais para conferir";

/** Tamanho máximo da expressão regular (o contrato aceita 200 nos outros tipos). */
export const LIMITE_REGEX = 100;
/** Prazo de uma conferência de regex, em ms: a que passa é tratada como "não bate". */
export const PRAZO_REGEX_MS = 50;
/**
 * Prazo de cada texto de prova da regex nova. Folgado para uma pausa do coletor não recusar regex
 * boa: a catastrófica nos textos de prova leva segundos ou anos, não centenas de ms.
 */
const PRAZO_PROVA_MS = 250;
/** Quanto da descrição a regex lê: descrição de banco cabe com folga. */
const LIMITE_TEXTO_REGEX = 300;
/** Menor padrão proposto ou aceito (sem acento, caixa e espaço sobrando). */
const MENOR_PADRAO = 2;
/** Quantos lançamentos com categoria de uma conta o empréstimo lê, do mais novo para trás. */
const LIMITE_ANTERIORES = 2000;
/** O tamanho máximo do padrão no contrato (`PadraoRegra`). */
const LIMITE_PADRAO = 200;

// ---------- Texto ----------

/** Sem acento, em maiúsculas, com os espaços colapsados: o que as regras comparam. */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();
}

/**
 * A descrição normalizada que identifica o "lançamento igual" (ADR-0045): o texto normalizado sem
 * os números, que mudam a cada compra (código da loja, parcela, autorização).
 */
export function chaveDescricao(texto: string): string {
  return normalizarTexto(texto.replace(/\d+/g, " "));
}

/**
 * O padrão da regra proposta: o começo da descrição normalizada até o primeiro número, sem a
 * pontuação que sobra na ponta ("MERCADO BOM PRECO 1234" → "MERCADO BOM PRECO", "IFOOD*12345" →
 * "IFOOD"). O que vem depois do número costuma ser cidade ou código, e prenderia a regra.
 */
export function padraoDaDescricao(texto: string): string {
  const normalizado = normalizarTexto(texto);
  const ate = normalizado.search(/\d/);
  let comeco = ate === -1 ? normalizado : normalizado.slice(0, ate);
  // O padrão cabe no contrato (`PadraoRegra`): corta numa fronteira de palavra quando dá.
  if (comeco.length > LIMITE_PADRAO) {
    const corte = comeco.lastIndexOf(" ", LIMITE_PADRAO);
    comeco = comeco.slice(0, corte > 0 ? corte : LIMITE_PADRAO);
  }
  return comeco.replace(/[^\p{L}\p{N}]+$/u, "").trim();
}

const letrasENumeros = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").length;

/** Só sem acento: a fonte da regex fica como o texto que ela lê, sem mudar caixa (`\d` não é `\D`). */
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "");

/** A chave do "igual anterior" só empresta com 2 palavras ou 6 letras: "PIX" sozinho não identifica. */
const chaveIdentifica = (chave: string) => chave.split(" ").length >= 2 || letrasENumeros(chave) >= 6;

// ---------- Regex com limite de tamanho e de tempo ----------

const QUANTIFICADOR_ABERTO = /^(?:[*+]|\{\d*,\d*\})/;

/**
 * Repetição dentro de repetição (`(a+)+`, `(.*)*`, `(\w{2,})+`), a forma das regex que travam por
 * retrocesso. Leitura rasa da expressão: pula escapes e classes `[...]`, e marca o grupo que tem
 * quantificador dentro; se o grupo fecha seguido de `*`, `+` ou `{n,}`, recusa.
 */
export function temRepeticaoAninhada(fonte: string): boolean {
  const pilha: boolean[] = [];
  let i = 0;
  const marcarQuantificador = () => {
    if (pilha.length > 0) pilha[pilha.length - 1] = true;
  };
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") {
      // Em JS, `[]` é a classe vazia e `[^]` é qualquer coisa: o `]` logo depois já fecha.
      i++;
      if (fonte[i] === "^") i++;
      while (i < fonte.length && fonte[i] !== "]") i += fonte[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "(") {
      pilha.push(false);
      i++;
      continue;
    }
    if (c === ")") {
      const tinhaDentro = pilha.pop() ?? false;
      const repetido = QUANTIFICADOR_ABERTO.test(fonte.slice(i + 1));
      if (tinhaDentro && repetido) return true;
      // O grupo com repetição dentro, ou repetido, conta como repetição para o grupo de fora.
      if (tinhaDentro || repetido) marcarQuantificador();
      i++;
      continue;
    }
    if (c === "*" || c === "+" || (c === "{" && /^\{\d*,\d*\}/.test(fonte.slice(i)))) {
      marcarQuantificador();
    }
    i++;
  }
  return false;
}

/** Os textos com que a expressão nova é posta à prova: as letras dela, dígitos e misturas, sem fechar. */
function textosDeProva(fonte: string): string[] {
  const n = LIMITE_TEXTO_REGEX;
  const letras = new Set(normalizarTexto(fonte.replace(/\\./g, "")).replace(/[^\p{L}\p{N} ]/gu, ""));
  for (const c of ["A", "1", " "]) letras.add(c);
  const textos = [...letras].map((c) => `${c.repeat(n - 1)}!`);
  textos.push("1 ".repeat(n / 2), "A1".repeat(n / 2), "A ".repeat(n / 2));
  const literal = normalizarTexto(fonte.replace(/[^\p{L}\p{N} ]/gu, ""));
  if (literal) textos.push(literal.repeat(Math.ceil(n / literal.length)).slice(0, n));
  return textos;
}

/**
 * As regex rodam num contexto do `node:vm` com prazo: a regex do JavaScript não para sozinha, mas o
 * prazo do vm interrompe a que travar. O contexto é um só por conjunto; muda só o texto.
 */
const CONFERIR_TODAS = new Script(
  "(() => { const r = []; for (let i = 0; i < expressoes.length; i++) r.push(ativas[i] ? expressoes[i].test(texto) : false); return r; })()",
);
const CONFERIR_UMA = new Script("expressoes[indice].test(texto)");

interface ContextoRegex {
  expressoes: RegExp[];
  ativas: boolean[];
  texto: string;
  indice: number;
}

function novoContexto(expressoes: RegExp[]): ContextoRegex {
  return createContext({
    expressoes,
    ativas: expressoes.map(() => true),
    texto: "",
    indice: 0,
  }) as ContextoRegex;
}

/** Por expressão, se bateu (a inativa conta como não); `null` quando o prazo estourou. */
function conferirTodas(contexto: ContextoRegex, texto: string, prazo: number): boolean[] | null {
  contexto.texto = texto.slice(0, LIMITE_TEXTO_REGEX);
  try {
    return [...(CONFERIR_TODAS.runInContext(contexto, { timeout: prazo }) as boolean[])];
  } catch {
    return null;
  }
}

/** Uma expressão só; `null` quando o prazo estourou. */
function conferirUma(
  contexto: ContextoRegex,
  indice: number,
  texto: string,
  prazo = PRAZO_REGEX_MS,
): boolean | null {
  contexto.texto = texto.slice(0, LIMITE_TEXTO_REGEX);
  contexto.indice = indice;
  try {
    return CONFERIR_UMA.runInContext(contexto, { timeout: prazo }) as boolean;
  } catch {
    return null;
  }
}

/**
 * A regex que entra numa regra: no limite de tamanho, válida, sem referência a grupo, sem repetição
 * aninhada e rápida nos textos de prova. A regra compara contra a descrição normalizada (sem acento,
 * em maiúsculas), sem diferença de caixa; a fonte também perde os acentos.
 */
export function validarRegex(fonte: string): RegExp {
  if (fonte.length > LIMITE_REGEX) throw new ErroDasCategorias(MENSAGEM_REGEX_LONGA);
  let expressao: RegExp;
  try {
    expressao = new RegExp(semAcento(fonte), "i");
  } catch {
    throw new ErroDasCategorias(MENSAGEM_REGEX_INVALIDA);
  }
  if (/\\[1-9]|\\k</.test(fonte)) throw new ErroDasCategorias(MENSAGEM_REGEX_REFERENCIA);
  if (temRepeticaoAninhada(fonte)) throw new ErroDasCategorias(MENSAGEM_REGEX_CATASTROFICA);
  const contexto = novoContexto([expressao]);
  for (const texto of textosDeProva(fonte)) {
    if (conferirUma(contexto, 0, texto, PRAZO_PROVA_MS) === null)
      throw new ErroDasCategorias(MENSAGEM_REGEX_LENTA);
  }
  return expressao;
}

// ---------- Ordem e aplicação das regras ----------

/**
 * A ordem do ADR-0045: a regra do usuário antes da do agente, depois o padrão mais longo (medido
 * normalizado, como é comparado); empate fica com a mais antiga, para a mesma descrição dar sempre
 * a mesma categoria.
 */
export function compararRegras(a: RegraCategoria, b: RegraCategoria): number {
  if (a.criadaPor !== b.criadaPor) return a.criadaPor === "usuario" ? -1 : 1;
  const tamanho = normalizarTexto(b.padrao).length - normalizarTexto(a.padrao).length;
  if (tamanho !== 0) return tamanho;
  if (a.criadoEm !== b.criadoEm) return a.criadoEm < b.criadoEm ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface RegraPronta {
  regra: RegraCategoria;
  /** O padrão normalizado (`contem`, `comeca_com`); vazio na regex. */
  padrao: string;
  /** A posição em `expressoes` (`regex`); -1 nas outras. */
  indiceRegex: number;
}

/**
 * As regras compiladas na ordem de aplicação, para um lote. A regex que não compila mais (gravada
 * por outro caminho) fica de fora, e a que estoura o prazo uma vez sai do conjunto pelo resto do
 * lote: um extrato de 200 linhas não paga o prazo 200 vezes.
 */
export class ConjuntoRegras {
  private readonly prontas: RegraPronta[] = [];
  private readonly expressoes: RegExp[] = [];
  private readonly contexto: ContextoRegex;

  /** `prazoMs` é o de cada conferência; só os testes que não são sobre o prazo o folgam. */
  constructor(
    regras: readonly RegraCategoria[],
    private readonly prazoMs = PRAZO_REGEX_MS,
  ) {
    for (const regra of [...regras].sort(compararRegras)) {
      if (regra.tipoPadrao === "regex") {
        let expressao: RegExp;
        try {
          expressao = new RegExp(semAcento(regra.padrao), "i");
        } catch {
          continue;
        }
        this.prontas.push({ regra, padrao: "", indiceRegex: this.expressoes.length });
        this.expressoes.push(expressao);
      } else {
        this.prontas.push({ regra, padrao: normalizarTexto(regra.padrao), indiceRegex: -1 });
      }
    }
    this.contexto = novoContexto(this.expressoes);
  }

  /** A regra que vence para a descrição, ou `null`. */
  aplicar(descricao: string): RegraCategoria | null {
    const texto = normalizarTexto(descricao);
    let regex: boolean[] | null = null;
    for (const p of this.prontas) {
      if (p.indiceRegex === -1) {
        const bate = p.regra.tipoPadrao === "contem" ? texto.includes(p.padrao) : texto.startsWith(p.padrao);
        if (bate) return p.regra;
        continue;
      }
      regex ??= this.conferirRegex(texto);
      if (regex[p.indiceRegex] === true) return p.regra;
    }
    return null;
  }

  /** Todas de uma vez; se o prazo estourar, uma a uma, e a lenta sai do conjunto. */
  private conferirRegex(texto: string): boolean[] {
    if (this.expressoes.length === 0) return [];
    const todas = conferirTodas(this.contexto, texto, this.prazoMs);
    if (todas) return todas;
    return this.expressoes.map((_, i) => {
      if (!this.contexto.ativas[i]) return false;
      const r = conferirUma(this.contexto, i, texto, this.prazoMs);
      if (r !== null) return r;
      this.contexto.ativas[i] = false;
      const regra = this.prontas.find((p) => p.indiceRegex === i)?.regra;
      console.error(`categorias: a regex da regra ${regra?.id ?? "?"} estourou o prazo e saiu do lote`);
      return false;
    });
  }
}

// ---------- Banco ----------

interface LinhaCategoria {
  id: string;
  nome: string;
  categoria_pai_id: string | null;
  tipo: TipoCategoria;
  cor: string | null;
  arquivada: number;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
  apagado_em: string | null;
}

interface LinhaRegra {
  id: string;
  padrao: string;
  tipo_padrao: TipoPadrao;
  categoria_id: string;
  vezes_aplicada: number;
  criada_por: CriadaPor;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const COLUNAS_CATEGORIA =
  "id, nome, categoria_pai_id, tipo, cor, arquivada, origem, agente_id, execucao_id, criado_em, atualizado_em, apagado_em";
const COLUNAS_REGRA =
  "r.id, r.padrao, r.tipo_padrao, r.categoria_id, r.vezes_aplicada, r.criada_por, r.origem, r.agente_id, r.execucao_id, r.criado_em, r.atualizado_em";

const paraCategoria = (l: LinhaCategoria): Categoria => ({
  id: l.id,
  nome: l.nome,
  categoriaPaiId: l.categoria_pai_id,
  tipo: l.tipo,
  cor: l.cor,
  arquivada: l.arquivada === 1,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

const paraRegra = (l: LinhaRegra): RegraCategoria => ({
  id: l.id,
  padrao: l.padrao,
  tipoPadrao: l.tipo_padrao,
  categoriaId: l.categoria_id,
  vezesAplicada: l.vezes_aplicada,
  criadaPor: l.criada_por,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

const lugares = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** `categorias`, `regras_categoria` e a leitura dos lançamentos que a categorização precisa. */
export class RepositorioCategorias {
  constructor(private readonly db: DatabaseSync) {}

  categorias(): Categoria[] {
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS_CATEGORIA} FROM categorias WHERE apagado_em IS NULL`)
      .all() as unknown as LinhaCategoria[];
    return linhas.map(paraCategoria);
  }

  /** Viva ou na lixeira; a marca da lixeira vem junto. */
  linhaCategoria(id: string): { categoria: Categoria; apagadoEm: string | null } | null {
    const l = this.db
      .prepare(`SELECT ${COLUNAS_CATEGORIA} FROM categorias WHERE id = ?`)
      .get(id) as unknown as LinhaCategoria | undefined;
    return l ? { categoria: paraCategoria(l), apagadoEm: l.apagado_em } : null;
  }

  criarCategoria(
    c: { id: string; nome: string; tipo: TipoCategoria; categoriaPaiId: string | null; cor: string | null },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO categorias (id, nome, categoria_pai_id, tipo, cor, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.nome, c.categoriaPaiId, c.tipo, c.cor, agora, agora, o.origem, o.agente_id, o.execucao_id);
  }

  definirCategoria(
    id: string,
    c: { nome: string; categoriaPaiId: string | null; cor: string | null; arquivada: boolean },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE categorias SET nome = ?, categoria_pai_id = ?, cor = ?, arquivada = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        c.nome,
        c.categoriaPaiId,
        c.cor,
        c.arquivada ? 1 : 0,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        id,
      );
  }

  /** Lançamentos vivos nas categorias dadas. */
  contarLancamentos(categorias: readonly string[]): number {
    const r = this.db
      .prepare(
        `SELECT count(*) AS n FROM lancamentos WHERE apagado_em IS NULL AND categoria_id IN (${lugares(categorias.length)})`,
      )
      .get(...categorias) as { n: number };
    return Number(r.n);
  }

  /**
   * Os lançamentos das categorias (vivos e na lixeira, para restaurar um não apontar para categoria
   * apagada) ficam "sem categoria". A origem fica: é efeito de apagar a categoria, não edição deles.
   */
  tirarCategoriaDosLancamentos(categorias: readonly string[], agora: string): number {
    const r = this.db
      .prepare(
        `UPDATE lancamentos SET categoria_id = NULL, atualizado_em = ? WHERE categoria_id IN (${lugares(categorias.length)})`,
      )
      .run(agora, ...categorias);
    return Number(r.changes);
  }

  /** Tem subcategoria, viva ou na lixeira (como o gatilho da 029, que conta as duas). */
  temSubcategorias(id: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM categorias WHERE categoria_pai_id = ? LIMIT 1").get(id) !== undefined
    );
  }

  /** As subcategorias que foram à lixeira com a mãe (mesma marca). */
  subcategoriasDaMarca(id: string, marca: string): Categoria[] {
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS_CATEGORIA} FROM categorias WHERE categoria_pai_id = ? AND apagado_em = ?`)
      .all(id, marca) as unknown as LinhaCategoria[];
    return linhas.map(paraCategoria);
  }

  /** As regras que foram à lixeira com as categorias (mesma marca). */
  regrasDaMarca(categorias: readonly string[], marca: string): RegraCategoria[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_REGRA} FROM regras_categoria r
          WHERE r.apagado_em = ? AND r.categoria_id IN (${lugares(categorias.length)})`,
      )
      .all(marca, ...categorias) as unknown as LinhaRegra[];
    return linhas.map(paraRegra);
  }

  /** As categorias e as regras delas vão à lixeira com a mesma marca. Devolve os ids das regras. */
  apagarCategorias(categorias: readonly string[], agora: string, carimbo: Carimbo): string[] {
    const o = colunasDeOrigem(carimbo);
    const em = lugares(categorias.length);
    const regras = this.db
      .prepare(
        `SELECT id FROM regras_categoria WHERE apagado_em IS NULL AND categoria_id IN (${em}) ORDER BY id`,
      )
      .all(...categorias) as { id: string }[];
    this.db
      .prepare(
        `UPDATE regras_categoria SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE apagado_em IS NULL AND categoria_id IN (${em})`,
      )
      .run(agora, agora, o.origem, o.agente_id, o.execucao_id, ...categorias);
    this.db
      .prepare(
        `UPDATE categorias SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE apagado_em IS NULL AND id IN (${em})`,
      )
      .run(agora, agora, o.origem, o.agente_id, o.execucao_id, ...categorias);
    return regras.map((r) => r.id);
  }

  /** Tira da lixeira as categorias e as regras dadas, que têm a mesma marca. */
  restaurar(
    categorias: readonly string[],
    regras: readonly string[],
    marca: string,
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    for (const [tabela, ids] of [
      ["categorias", categorias],
      ["regras_categoria", regras],
    ] as const) {
      if (ids.length === 0) continue;
      this.db
        .prepare(
          `UPDATE ${tabela} SET apagado_em = NULL, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
            WHERE apagado_em = ? AND id IN (${lugares(ids.length)})`,
        )
        .run(agora, o.origem, o.agente_id, o.execucao_id, marca, ...ids);
    }
  }

  /**
   * As regras vivas de categoria viva; com `soAtivas`, só as de categoria não arquivada; com
   * `semTransferencia`, sem as que levam a uma categoria do tipo transferência.
   */
  regras(soAtivas = false, semTransferencia = false): RegraCategoria[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_REGRA} FROM regras_categoria r JOIN categorias c ON c.id = r.categoria_id
          WHERE r.apagado_em IS NULL AND c.apagado_em IS NULL ${soAtivas ? "AND c.arquivada = 0" : ""}
            ${semTransferencia ? "AND c.tipo <> 'transferencia'" : ""}`,
      )
      .all() as unknown as LinhaRegra[];
    return linhas.map(paraRegra);
  }

  regra(id: string): RegraCategoria | null {
    const l = this.db
      .prepare(`SELECT ${COLUNAS_REGRA} FROM regras_categoria r WHERE r.id = ? AND r.apagado_em IS NULL`)
      .get(id) as unknown as LinhaRegra | undefined;
    return l ? paraRegra(l) : null;
  }

  criarRegra(
    r: { id: string; padrao: string; tipoPadrao: TipoPadrao; categoriaId: string; criadaPor: CriadaPor },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO regras_categoria (id, padrao, tipo_padrao, categoria_id, criada_por, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.padrao,
        r.tipoPadrao,
        r.categoriaId,
        r.criadaPor,
        agora,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
      );
  }

  definirRegra(
    id: string,
    r: { padrao: string; tipoPadrao: TipoPadrao; categoriaId: string; criadaPor: CriadaPor },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE regras_categoria SET padrao = ?, tipo_padrao = ?, categoria_id = ?, criada_por = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        r.padrao,
        r.tipoPadrao,
        r.categoriaId,
        r.criadaPor,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        id,
      );
  }

  apagarRegra(id: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE regras_categoria SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** Conta o uso; não é edição da regra, então nem a versão nem quem mexeu mudam. */
  somarAplicacoes(id: string, vezes: number): void {
    this.db
      .prepare(
        "UPDATE regras_categoria SET vezes_aplicada = vezes_aplicada + ? WHERE id = ? AND apagado_em IS NULL",
      )
      .run(vezes, id);
  }

  /**
   * Os lançamentos vivos com categoria (viva, não arquivada e que não é de transferência) de uma
   * conta, do mais recente para o mais antigo: de onde o "igual anterior" empresta.
   */
  anterioresComCategoria(
    contaId: string,
  ): { descricao: string; descricao_original: string | null; categoria_id: string }[] {
    return this.db
      .prepare(
        `SELECT l.descricao, l.descricao_original, l.categoria_id
           FROM lancamentos l JOIN categorias c ON c.id = l.categoria_id
          WHERE l.conta_id = ? AND l.apagado_em IS NULL AND c.apagado_em IS NULL AND c.arquivada = 0
            AND c.tipo <> 'transferencia'
          ORDER BY l.data DESC, l.criado_em DESC, l.id DESC
          LIMIT ${LIMITE_ANTERIORES}`,
      )
      .all(contaId) as { descricao: string; descricao_original: string | null; categoria_id: string }[];
  }

  transacao<T>(fazer: () => T): T {
    // Dentro da transação de quem chamou (o desfazer de uma ferramenta), não abre outra.
    if (this.db.isTransaction) return fazer();
    this.db.exec("BEGIN");
    try {
      const resultado = fazer();
      this.db.exec("COMMIT");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

// ---------- Serviço ----------

/** Um lançamento (novo ou importado) a categorizar. */
export interface ParaCategorizar {
  contaId: string;
  descricao: string;
}

/** De onde veio a categoria: a regra, o lançamento igual anterior, ou nada (fica para a Tula). */
export interface Categorizacao {
  categoriaId: string | null;
  fonte: "regra" | "anterior" | null;
  regraId: string | null;
}

/** O lançamento importado cuja categoria você trocou, como a proposta de regra precisa dele. */
export interface CorrecaoDeCategoria {
  descricao: string;
  descricaoOriginal: string | null;
  importacaoId: string | null;
  categoriaAntes: string | null;
  categoriaDepois: string | null;
}

export interface AvisosCategorias {
  /** O que mudou no dinheiro (`financas.mudou`). */
  mudou: (mudanca: MudancaFinancas) => void;
}

export interface OpcoesCategorias {
  agora?: () => Date;
  gerarId?: () => string;
  /** O prazo de cada conferência de regex na categorização; padrão `PRAZO_REGEX_MS`. */
  prazoRegexMs?: number;
}

const ORDEM_DO_TIPO: Record<TipoCategoria, number> = { gasto: 0, receita: 1, transferencia: 2 };

export class ServicoCategorias {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly prazoRegexMs: number;
  /** O último instante usado como marca da lixeira: a marca seguinte é sempre maior. */
  private ultimoInstante = 0;

  constructor(
    private readonly repo: RepositorioCategorias,
    private readonly avisos: AvisosCategorias,
    opcoes: OpcoesCategorias = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.prazoRegexMs = opcoes.prazoRegexMs ?? PRAZO_REGEX_MS;
  }

  // ----- Categorias -----

  /** As vivas, arquivadas inclusive: por tipo, cada mãe seguida das subcategorias, por nome. */
  categorias(): Categoria[] {
    const todas = this.repo.categorias();
    const porId = new Map(todas.map((c) => [c.id, c]));
    const nomeDoGrupo = (c: Categoria) =>
      (c.categoriaPaiId ? porId.get(c.categoriaPaiId)?.nome : null) ?? c.nome;
    const grupo = (c: Categoria) => c.categoriaPaiId ?? c.id;
    return todas.sort(
      (a, b) =>
        ORDEM_DO_TIPO[a.tipo] - ORDEM_DO_TIPO[b.tipo] ||
        nomeDoGrupo(a).localeCompare(nomeDoGrupo(b), "pt-BR") ||
        grupo(a).localeCompare(grupo(b)) ||
        Number(a.categoriaPaiId !== null) - Number(b.categoriaPaiId !== null) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }

  criarCategoria(nova: NovaCategoria, carimbo: Carimbo = DO_USUARIO): Categoria {
    const pai = nova.categoriaPaiId ?? null;
    if (pai !== null) this.conferirMae(pai, nova.tipo, null);
    this.conferirNome(nova.nome, pai, nova.tipo, null);
    const id = this.gerarId();
    this.repo.criarCategoria(
      { id, nome: nova.nome.trim(), tipo: nova.tipo, categoriaPaiId: pai, cor: nova.cor ?? null },
      this.agora().toISOString(),
      carimbo,
    );
    const criada = this.exigirCategoria(id);
    this.avisar(["categorias"]);
    return criada;
  }

  definirCategoria(mudanca: MudancaCategoria, carimbo: Carimbo = DO_USUARIO): Categoria {
    const atual = this.exigirCategoria(mudanca.id);
    const campos = {
      nome: mudanca.nome?.trim() ?? atual.nome,
      categoriaPaiId: mudanca.categoriaPaiId === undefined ? atual.categoriaPaiId : mudanca.categoriaPaiId,
      cor: mudanca.cor === undefined ? atual.cor : mudanca.cor,
      arquivada: mudanca.arquivada ?? atual.arquivada,
    };
    if (
      campos.nome === atual.nome &&
      campos.categoriaPaiId === atual.categoriaPaiId &&
      campos.cor === atual.cor &&
      campos.arquivada === atual.arquivada
    ) {
      return atual;
    }
    if (atual.id === CATEGORIA_TRANSFERENCIA && (campos.categoriaPaiId !== null || campos.arquivada)) {
      throw new ErroDasCategorias(MENSAGEM_TRANSFERENCIA);
    }
    if (campos.categoriaPaiId !== null && campos.categoriaPaiId !== atual.categoriaPaiId) {
      this.conferirMae(campos.categoriaPaiId, atual.tipo, atual.id);
    }
    if (campos.nome !== atual.nome || campos.categoriaPaiId !== atual.categoriaPaiId) {
      this.conferirNome(campos.nome, campos.categoriaPaiId, atual.tipo, atual.id);
    }
    this.repo.definirCategoria(atual.id, campos, this.agora().toISOString(), carimbo);
    const editada = this.exigirCategoria(atual.id);
    this.avisar(["categorias"]);
    return editada;
  }

  /**
   * Manda à lixeira a categoria com as subcategorias e as regras de todas. Com lançamentos, só
   * depois da confirmação, e eles ficam "sem categoria"; sem ela, nada muda e volta a contagem.
   */
  apagarCategoria(pedido: PedidoApagarCategoria, carimbo: Carimbo = DO_USUARIO): ResultadoApagarCategoria {
    const atual = this.exigirCategoria(pedido.id);
    if (atual.id === CATEGORIA_TRANSFERENCIA) throw new ErroDasCategorias(MENSAGEM_TRANSFERENCIA);
    const categorias = [
      atual.id,
      ...this.repo
        .categorias()
        .filter((c) => c.categoriaPaiId === atual.id)
        .map((c) => c.id),
    ];
    // A confirmação olha só os vivos; os da lixeira também ficam sem categoria, para restaurar um
    // deles não o pôr numa categoria apagada.
    const lancamentos = this.repo.contarLancamentos(categorias);
    if (lancamentos > 0 && pedido.confirmado !== true) return { apagada: false, lancamentos };
    const agora = this.marca();
    const { regras, tirados } = this.repo.transacao(() => {
      const tirados = this.repo.tirarCategoriaDosLancamentos(categorias, agora);
      return { regras: this.repo.apagarCategorias(categorias, agora, carimbo), tirados };
    });
    this.avisar(tirados > 0 ? ["categorias", "regras", "lancamentos"] : ["categorias", "regras"]);
    return { apagada: true, ids: [...categorias, ...regras] };
  }

  /**
   * Tira da lixeira a categoria com as subcategorias e as regras que foram junto com ela. A
   * subcategoria apagada com a mãe volta com a mãe; os lançamentos que ficaram "sem categoria"
   * continuam sem. Nome igual ao de uma irmã viva recusa; a regra cujo padrão já tem regra viva
   * fica na lixeira.
   */
  restaurarCategoria(id: string, carimbo: Carimbo = DO_USUARIO): Categoria[] {
    const linha = this.repo.linhaCategoria(id);
    if (!linha) throw new ErroDasCategorias(MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    if (linha.apagadoEm === null) throw new ErroDasCategorias(MENSAGEM_NAO_ESTA_NA_LIXEIRA);
    const { categoria } = linha;
    const pai = categoria.categoriaPaiId;
    if (pai !== null && this.repo.linhaCategoria(pai)?.apagadoEm !== null) {
      throw new ErroDasCategorias(MENSAGEM_RESTAURAR_A_MAE);
    }
    const marca = linha.apagadoEm;
    // As filhas que voltam são irmãs só entre si (a mãe estava na lixeira): só a mãe pode colidir.
    this.conferirNome(categoria.nome, pai, categoria.tipo, categoria.id);
    const categorias = [id, ...this.repo.subcategoriasDaMarca(id, marca).map((c) => c.id)];
    const regras = this.repo
      .regrasDaMarca(categorias, marca)
      .filter((r) => !this.regraComPadrao(r.padrao, r.tipoPadrao, r.id))
      .map((r) => r.id);
    this.repo.transacao(() => this.repo.restaurar(categorias, regras, marca, this.marca(), carimbo));
    this.avisar(["categorias", "regras"]);
    return this.repo.categorias().filter((c) => categorias.includes(c.id));
  }

  // ----- Regras -----

  /** As vivas, na ordem em que são aplicadas. */
  regras(): RegraCategoria[] {
    return this.repo.regras().sort(compararRegras);
  }

  /**
   * Cria a regra. Quem ensina decide `criada_por` (o agente pelo carimbo). O mesmo padrão do mesmo
   * tipo não vira duas regras: a nova categoria vale na regra que já existe, menos quando o agente
   * tentaria trocar uma regra do usuário.
   */
  criarRegra(nova: NovaRegraCategoria, carimbo: Carimbo = DO_USUARIO): RegraCategoria {
    const padrao = this.conferirPadrao(nova.padrao, nova.tipoPadrao);
    this.exigirCategoria(nova.categoriaId);
    const criadaPor: CriadaPor = carimbo.origem === "agente" ? "agente" : "usuario";
    const igual = this.regraComPadrao(padrao, nova.tipoPadrao, null);
    const agora = this.agora().toISOString();
    if (igual) {
      if (
        igual.categoriaId === nova.categoriaId &&
        (igual.criadaPor === "usuario" || criadaPor === "agente")
      ) {
        return igual;
      }
      if (igual.criadaPor === "usuario" && criadaPor === "agente") {
        throw new ErroDasCategorias(MENSAGEM_REGRA_DO_USUARIO);
      }
      this.repo.definirRegra(
        igual.id,
        { padrao, tipoPadrao: nova.tipoPadrao, categoriaId: nova.categoriaId, criadaPor },
        agora,
        carimbo,
      );
      return this.avisarRegra(igual.id);
    }
    const id = this.gerarId();
    this.repo.criarRegra(
      { id, padrao, tipoPadrao: nova.tipoPadrao, categoriaId: nova.categoriaId, criadaPor },
      agora,
      carimbo,
    );
    return this.avisarRegra(id);
  }

  /** Edita padrão, tipo ou categoria; quem ensinou (`criada_por`) não muda. */
  definirRegra(mudanca: MudancaRegraCategoria, carimbo: Carimbo = DO_USUARIO): RegraCategoria {
    const atual = this.exigirRegra(mudanca.id);
    const tipoPadrao = mudanca.tipoPadrao ?? atual.tipoPadrao;
    const padrao = this.conferirPadrao(mudanca.padrao ?? atual.padrao, tipoPadrao);
    const categoriaId = mudanca.categoriaId ?? atual.categoriaId;
    if (padrao === atual.padrao && tipoPadrao === atual.tipoPadrao && categoriaId === atual.categoriaId) {
      return atual;
    }
    if (categoriaId !== atual.categoriaId) this.exigirCategoria(categoriaId);
    if (this.regraComPadrao(padrao, tipoPadrao, atual.id))
      throw new ErroDasCategorias(MENSAGEM_REGRA_REPETIDA);
    this.repo.definirRegra(
      atual.id,
      { padrao, tipoPadrao, categoriaId, criadaPor: atual.criadaPor },
      this.agora().toISOString(),
      carimbo,
    );
    return this.avisarRegra(atual.id);
  }

  apagarRegra(pedido: PedidoRegraCategoria, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigirRegra(pedido.id);
    this.repo.apagarRegra(atual.id, this.marca(), carimbo);
    this.avisar(["regras"]);
    return { ids: [atual.id] };
  }

  // ----- Categorizar -----

  /**
   * A categoria de cada lançamento pela ordem do ADR-0045, só por código: a regra que vence e, sem
   * ela, o lançamento igual mais recente da mesma conta; nunca uma categoria do tipo transferência
   * (a transferência só nasce com os dois lados). O que sobrar volta sem categoria, para a
   * Tula sugerir em lote. Não conta o uso das regras: quem lança chama `registrarAplicacoes` com o
   * que ficou (a prévia da importação categoriza antes de você confirmar).
   */
  categorizar(lancamentos: readonly ParaCategorizar[]): Categorizacao[] {
    if (lancamentos.length === 0) return [];
    // Nunca propõe categoria de transferência: o gasto sumiria do resumo sem o outro lado.
    const regras = new ConjuntoRegras(this.repo.regras(true, true), this.prazoRegexMs);
    const anteriores = new Map<string, Map<string, string>>();
    return lancamentos.map((l) => {
      const regra = regras.aplicar(l.descricao);
      if (regra) return { categoriaId: regra.categoriaId, fonte: "regra", regraId: regra.id };
      let daConta = anteriores.get(l.contaId);
      if (!daConta) {
        daConta = this.anterioresDaConta(l.contaId);
        anteriores.set(l.contaId, daConta);
      }
      const chave = chaveDescricao(l.descricao);
      const categoriaId = chaveIdentifica(chave) ? (daConta.get(chave) ?? null) : null;
      return categoriaId
        ? { categoriaId, fonte: "anterior", regraId: null }
        : { categoriaId: null, fonte: null, regraId: null };
    });
  }

  /** Soma o uso das regras que categorizaram o que foi lançado (`vezes_aplicada`). */
  registrarAplicacoes(regraIds: readonly (string | null)[]): void {
    const vezes = new Map<string, number>();
    for (const id of regraIds) if (id) vezes.set(id, (vezes.get(id) ?? 0) + 1);
    if (vezes.size === 0) return;
    this.repo.transacao(() => {
      for (const [id, n] of vezes) this.repo.somarAplicacoes(id, n);
    });
    this.avisar(["regras"]);
  }

  /**
   * A regra que a área propõe quando você troca a categoria de um importado ("Daqui em diante,
   * MERCADO BOM PRECO é sempre Mercado"): `contem` com o começo da descrição normalizada. Não
   * propõe para lançamento feito à mão, para "sem categoria", quando a descrição não dá padrão, nem
   * quando a regra que já vence dá a categoria escolhida.
   */
  proporRegra(correcao: CorrecaoDeCategoria): PropostaRegra | null {
    const { categoriaDepois } = correcao;
    if (correcao.importacaoId === null || categoriaDepois === null) return null;
    if (categoriaDepois === correcao.categoriaAntes) return null;
    const descricao = correcao.descricaoOriginal ?? correcao.descricao;
    const padrao = padraoDaDescricao(descricao);
    if (letrasENumeros(padrao) < MENOR_PADRAO) return null;
    const vence = new ConjuntoRegras(this.repo.regras(true), this.prazoRegexMs).aplicar(descricao);
    if (vence?.categoriaId === categoriaDepois) return null;
    return { padrao, tipoPadrao: "contem", categoriaId: categoriaDepois };
  }

  // ----- Apoio -----

  /** Chave da descrição → categoria do lançamento mais recente com ela (o primeiro que aparece). */
  private anterioresDaConta(contaId: string): Map<string, string> {
    const mapa = new Map<string, string>();
    for (const l of this.repo.anterioresComCategoria(contaId)) {
      for (const texto of [l.descricao_original, l.descricao]) {
        if (!texto) continue;
        const chave = chaveDescricao(texto);
        if (chave && !mapa.has(chave)) mapa.set(chave, l.categoria_id);
      }
    }
    return mapa;
  }

  /** O padrão como fica gravado: sem espaço nas pontas e, se regex, dentro dos limites. */
  private conferirPadrao(padrao: string, tipo: TipoPadrao): string {
    const limpo = padrao.trim();
    if (tipo === "regex") {
      validarRegex(limpo);
      return limpo;
    }
    if (letrasENumeros(normalizarTexto(limpo)) < MENOR_PADRAO)
      throw new ErroDasCategorias(MENSAGEM_PADRAO_CURTO);
    return limpo;
  }

  /** A regra viva com o mesmo padrão e tipo (sem acento nem caixa; regex como foi escrita). */
  private regraComPadrao(padrao: string, tipo: TipoPadrao, menos: string | null): RegraCategoria | null {
    const chave = tipo === "regex" ? padrao : normalizarTexto(padrao);
    return (
      this.repo
        .regras()
        .find(
          (r) =>
            r.id !== menos &&
            r.tipoPadrao === tipo &&
            (tipo === "regex" ? r.padrao : normalizarTexto(r.padrao)) === chave,
        ) ?? null
    );
  }

  /**
   * A mãe existe, é de primeiro nível, é do mesmo tipo e não é a própria categoria; a categoria que
   * vira filha não tem subcategorias, nem na lixeira (o gatilho da 029 conta as duas).
   */
  private conferirMae(paiId: string, tipo: TipoCategoria, filhaId: string | null): void {
    const pai = this.exigirCategoria(paiId);
    if (pai.id === filhaId || pai.categoriaPaiId !== null) throw new ErroDasCategorias(MENSAGEM_UM_NIVEL);
    if (filhaId !== null && this.repo.temSubcategorias(filhaId)) {
      throw new ErroDasCategorias(MENSAGEM_TEM_SUBCATEGORIAS);
    }
    if (pai.tipo !== tipo) throw new ErroDasCategorias(MENSAGEM_TIPO_DA_MAE);
  }

  /** O nome não se repete entre irmãs (mesma mãe e mesmo tipo), sem diferença de caixa. */
  private conferirNome(nome: string, paiId: string | null, tipo: TipoCategoria, menos: string | null): void {
    const chave = nomeChave(nome);
    const repetida = this.repo
      .categorias()
      .some(
        (c) => c.id !== menos && c.categoriaPaiId === paiId && c.tipo === tipo && nomeChave(c.nome) === chave,
      );
    if (repetida) throw new ErroDasCategorias(MENSAGEM_NOME_REPETIDO);
  }

  private exigirCategoria(id: string): Categoria {
    const linha = this.repo.linhaCategoria(id);
    if (!linha || linha.apagadoEm !== null) throw new ErroDasCategorias(MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    return linha.categoria;
  }

  /** A regra viva; a de categoria na lixeira foi junto com ela. */
  private exigirRegra(id: string): RegraCategoria {
    const regra = this.repo.regra(id);
    const categoria = regra ? this.repo.linhaCategoria(regra.categoriaId) : null;
    if (!regra || !categoria || categoria.apagadoEm !== null) {
      throw new ErroDasCategorias(MENSAGEM_REGRA_NAO_ENCONTRADA);
    }
    return regra;
  }

  private avisarRegra(id: string): RegraCategoria {
    const regra = this.exigirRegra(id);
    this.avisar(["regras"]);
    return regra;
  }

  /** Agora, sempre depois da marca anterior: duas idas à lixeira no mesmo ms não se confundem. */
  private marca(): string {
    const ms = Math.max(this.agora().getTime(), this.ultimoInstante + 1);
    this.ultimoInstante = ms;
    return new Date(ms).toISOString();
  }

  private avisar(partes: MudancaFinancas["partes"]): void {
    this.avisos.mudou({ partes, lancamentos: [], apagados: [] });
  }
}
