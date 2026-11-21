import { lerValor } from "@moductus/contrato";
import { z } from "zod";

/**
 * Leitor de extrato em CSV (ADR-0041): RFC 4180 (aspas, aspas dobradas, quebra de linha dentro de
 * aspas) com o que o perfil do banco diz (separador, decimal, formato de data, codificação, colunas e
 * sinal). Sem perfil, `detectarCsv` lê uma amostra e sugere tudo isso, com a frase que o mapeamento
 * guiado mostra (quadro `ExtratoColunas`); o usuário confirma e o perfil pode ser salvo
 * (`perfis-csv.ts`).
 *
 * O valor vira centavos inteiros pelo `lerValor` do contrato, sem ponto flutuante; a data é a do
 * arquivo, literal (`AAAA-MM-DD`), sem fuso.
 */

export class ErroDoCsv extends Error {}

export const SEPARADORES = [";", ",", "\t"] as const;
export type Separador = (typeof SEPARADORES)[number];

export const DECIMAIS = [",", "."] as const;
export type Decimal = (typeof DECIMAIS)[number];

/** Os formatos de data que o leitor conhece; hora depois da data é ignorada. */
export const FORMATOS_DATA = [
  "dd/mm/aaaa",
  "dd/mm/aa",
  "dd-mm-aaaa",
  "dd.mm.aaaa",
  "aaaa-mm-dd",
  "mm/dd/aaaa",
] as const;
export type FormatoData = (typeof FORMATOS_DATA)[number];

export const CODIFICACOES = ["utf-8", "windows-1252"] as const;
export type Codificacao = (typeof CODIFICACOES)[number];

const coluna = z.number().int().min(0);

/**
 * Como o valor sai das colunas: uma coluna com sinal (e o que o negativo quer dizer: no extrato de
 * conta é saída; no de cartão, em geral, a compra vem positiva) ou duas, débito e crédito, cada uma
 * com o valor sem sinal.
 */
export const ValorCsv = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("sinal"), coluna, negativo: z.enum(["saida", "entrada"]) }),
  z.object({ modo: z.literal("debito_credito"), debito: coluna, credito: coluna }),
]);
export type ValorCsv = z.infer<typeof ValorCsv>;

/**
 * O `mapeamento` do perfil (DATA §3 `perfis_importacao`): as colunas pela posição, contadas do zero.
 * `cabecalho` é a linha de títulos como veio, e é por ela, exata, que o perfil é reconhecido na
 * próxima vez; vazio quando o arquivo não tem títulos (e aí não há o que reconhecer).
 * `pularLinhas` são as linhas antes dela (agência, conta, período).
 */
export const MapeamentoCsv = z.object({
  pularLinhas: z.number().int().min(0).default(0),
  cabecalho: z.array(z.string()).min(1).nullable(),
  data: coluna,
  /** Mais de uma coluna junta com espaço ("Histórico" e "Complemento"). */
  descricao: z.array(coluna).min(1),
  valor: ValorCsv,
  identificador: coluna.nullable().default(null),
});
export type MapeamentoCsv = z.infer<typeof MapeamentoCsv>;

/** O que o perfil fixa; o que ficar de fora sai da amostra (`detectarCsv`). */
export interface OpcoesCsv {
  separador?: Separador | null;
  formatoDecimal?: Decimal | null;
  formatoData?: FormatoData | null;
  codificacao?: Codificacao | null;
}

export interface LinhaCsv {
  /** Linha do arquivo onde o registro começa, contada de 1, para a prévia apontar. */
  linha: number;
  data: string;
  descricao: string;
  valorCentavos: number;
  idExterno: string | null;
}

export interface LinhaRecusada {
  linha: number;
  motivo: string;
}

export interface CsvLido {
  separador: Separador;
  formatoDecimal: Decimal;
  formatoData: FormatoData;
  codificacao: Codificacao;
  linhas: LinhaCsv[];
  /** Registros que não viraram lançamento (data ou valor ilegível), sem parar o resto. */
  recusadas: LinhaRecusada[];
  /** Primeira e última data lidas; vazio sem nenhuma linha. */
  periodo: { inicio: string; fim: string } | null;
}

export interface DeteccaoCsv {
  codificacao: Codificacao;
  separador: Separador;
  formatoDecimal: Decimal;
  /** Vazio quando nenhuma coluna parece data. */
  formatoData: FormatoData | null;
  /** O mapeamento sugerido; vazio quando falta data, descrição ou valor, e o usuário escolhe tudo. */
  mapeamento: MapeamentoCsv | null;
  pularLinhas: number;
  /** A linha de títulos; vazio quando a primeira linha já é dado. */
  cabecalho: string[] | null;
  /** Quantas colunas o arquivo tem. */
  colunas: number;
  /** As primeiras linhas de dados, como vieram, para a tabela do mapeamento. */
  amostra: string[][];
  /** Quantos registros de dados o arquivo tem ("CSV · 96 linhas"). */
  totalLinhas: number;
  /** O que a Tula diz no mapeamento guiado, até duas frases. */
  frase: string;
}

// ---------------------------------------------------------------------------------------------
// Bytes e registros

const BOM = "﻿";

/**
 * Bytes em texto: a codificação do perfil, ou UTF-8 quando os bytes são UTF-8 válido (com ou sem
 * BOM) e Windows-1252 quando não são, que é o que os bancos exportam fora do UTF-8.
 */
export function decodificar(
  bytes: Uint8Array,
  codificacao?: Codificacao | null,
): { texto: string; codificacao: Codificacao } {
  let usada: Codificacao;
  let texto: string;
  if (codificacao) {
    usada = codificacao;
    texto = new TextDecoder(codificacao).decode(bytes);
  } else {
    try {
      texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      usada = "utf-8";
    } catch {
      texto = new TextDecoder("windows-1252").decode(bytes);
      usada = "windows-1252";
    }
  }
  // O TextDecoder já tira o BOM do UTF-8; o que sobra é BOM lido por outra codificação.
  if (texto.startsWith(BOM)) texto = texto.slice(1);
  return { texto, codificacao: usada };
}

interface Registro {
  linha: number;
  campos: string[];
}

/**
 * RFC 4180 com tolerância: aspas só abrem no começo do campo; aspas dobradas dentro delas são uma;
 * quebra de linha (CRLF, LF ou CR) dentro delas é do campo. Aspa solta no meio de um campo sem
 * aspas fica como está. Linha em branco não vira registro. Aspas abertas até o fim é erro.
 */
export function separarRegistros(texto: string, separador: Separador): Registro[] {
  const registros: Registro[] = [];
  let campos: string[] = [];
  let campo = "";
  let entreAspas = false;
  let campoComAspas = false;
  let linha = 1;
  let inicio = 1;
  let aspasAbertasNa = 0;

  const fecharCampo = () => {
    campos.push(campo);
    campo = "";
    campoComAspas = false;
  };
  const fecharRegistro = () => {
    fecharCampo();
    const vazio = campos.length === 1 && campos[0] === "";
    if (!vazio) registros.push({ linha: inicio, campos });
    campos = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        if (c === "\n" || (c === "\r" && texto[i + 1] !== "\n")) linha++;
        campo += c;
      }
      continue;
    }
    if (c === '"' && campo === "" && !campoComAspas) {
      entreAspas = true;
      campoComAspas = true;
      aspasAbertasNa = linha;
    } else if (c === separador) {
      fecharCampo();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fecharRegistro();
      linha++;
      inicio = linha;
    } else {
      campo += c;
    }
  }
  if (entreAspas)
    throw new ErroDoCsv(`Aspas abertas na linha ${aspasAbertasNa} não fecham até o fim do arquivo.`);
  if (campo !== "" || campos.length > 0) fecharRegistro();
  return registros;
}

// ---------------------------------------------------------------------------------------------
// Data e valor

const DATA_POR_FORMATO: Record<FormatoData, { re: RegExp; ordem: "dma" | "amd" | "mda" }> = {
  "dd/mm/aaaa": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/, ordem: "dma" },
  "dd/mm/aa": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:[ T].*)?$/, ordem: "dma" },
  "dd-mm-aaaa": { re: /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T].*)?$/, ordem: "dma" },
  "dd.mm.aaaa": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T].*)?$/, ordem: "dma" },
  "aaaa-mm-dd": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/, ordem: "amd" },
  "mm/dd/aaaa": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/, ordem: "mda" },
};

const dois = (n: number) => String(n).padStart(2, "0");

/** A data do arquivo em `AAAA-MM-DD`, ou `null` se não está no formato ou não existe (31/02). */
export function lerData(texto: string, formato: FormatoData): string | null {
  const { re, ordem } = DATA_POR_FORMATO[formato];
  const m = re.exec(texto.trim());
  if (m === null) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [anoLido, mes, dia] = ordem === "dma" ? [c, b, a] : ordem === "amd" ? [a, b, c] : [c, a, b];
  const ano = formato === "dd/mm/aa" ? anoLido + 2000 : anoLido;
  if (mes < 1 || mes > 12 || dia < 1) return null;
  // Dia 0 do mês seguinte é o último deste, em UTC para não depender do fuso da máquina.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimo) return null;
  return `${String(ano).padStart(4, "0")}-${dois(mes)}-${dois(dia)}`;
}

/**
 * O valor da célula em centavos, com o decimal do perfil: "1.234,56" e "1,234.56" viram 123.456 cada
 * um no seu perfil. Aceita símbolo de moeda, sinal antes ou depois do símbolo, parênteses e "D"/"C"
 * no fim ("45,90 D" é saída) e zeros sobrando depois dos centavos ("12,3400"). Vazio ou ilegível é
 * `null`; quem precisa do vazio como zero decide.
 */
export function lerValorCsv(texto: string, decimal: Decimal): number | null {
  let t = texto.replace(/\s/g, "");
  if (t === "") return null;
  let negativo = false;
  const dc = /^(.*?)([DC])$/i.exec(t);
  if (dc !== null && /\d/.test(dc[1] ?? "")) {
    t = dc[1] ?? "";
    negativo = (dc[2] ?? "").toUpperCase() === "D";
  }
  const parenteses = /^\((.*)\)$/.exec(t);
  if (parenteses !== null) {
    t = parenteses[1] ?? "";
    negativo = !negativo;
  }
  // Sinal no fim ("45,90-"), como alguns bancos escrevem a saída.
  if (/\d[-−]$/.test(t) && !/^[-−+]/.test(t)) {
    t = t.slice(0, -1);
    negativo = !negativo;
  }
  const milhar = decimal === "," ? "." : ",";
  const corpo = /^([^\d]*)(\d[\d.,]*)$/.exec(t);
  if (corpo === null) return null;
  const [, prefixo = "", numero = ""] = corpo;
  const partes = numero.split(decimal);
  if (partes.length > 2) return null;
  const [inteiro = "", fracaoBruta] = partes;
  const grupos = inteiro.split(milhar);
  const milharValido =
    grupos.length === 1 || ((grupos[0] ?? "").length <= 3 && grupos.slice(1).every((g) => g.length === 3));
  if (!milharValido || grupos.some((g) => !/^\d+$/.test(g))) return null;
  let fracao = fracaoBruta;
  if (fracao !== undefined) {
    if (!/^\d+$/.test(fracao)) return null;
    // Casas além dos centavos só se forem zeros: "12,3400" é 12,34; "12,345" não tem centavo inteiro.
    if (fracao.length > 2) {
      if (!/^0+$/.test(fracao.slice(2))) return null;
      fracao = fracao.slice(0, 2);
    }
  }
  // Na forma que o `lerValor` lê sem ambiguidade: só dígitos, vírgula e o prefixo (sinal e símbolo).
  const canonico = `${prefixo}${grupos.join("")}${fracao === undefined ? "" : `,${fracao}`}`;
  const valor = lerValor(canonico);
  if (valor === null) return null;
  return negativo && valor !== 0 ? -valor : valor;
}

// ---------------------------------------------------------------------------------------------
// Leitura com o perfil

const celula = (campos: readonly string[], i: number) => (campos[i] ?? "").trim();

function colunasDoMapeamento(m: MapeamentoCsv): number[] {
  const valor = m.valor.modo === "sinal" ? [m.valor.coluna] : [m.valor.debito, m.valor.credito];
  return [m.data, ...m.descricao, ...valor, ...(m.identificador === null ? [] : [m.identificador])];
}

function valorDaLinha(campos: readonly string[], v: ValorCsv, decimal: Decimal): number | string {
  if (v.modo === "sinal") {
    const texto = celula(campos, v.coluna);
    if (texto === "") return "sem valor";
    const lido = lerValorCsv(texto, decimal);
    if (lido === null) return `valor ilegível: "${texto}"`;
    return v.negativo === "saida" ? lido : -lido;
  }
  const debitoTexto = celula(campos, v.debito);
  const creditoTexto = celula(campos, v.credito);
  if (debitoTexto === "" && creditoTexto === "") return "sem valor";
  const debito = debitoTexto === "" ? 0 : lerValorCsv(debitoTexto, decimal);
  if (debito === null) return `débito ilegível: "${debitoTexto}"`;
  const credito = creditoTexto === "" ? 0 : lerValorCsv(creditoTexto, decimal);
  if (credito === null) return `crédito ilegível: "${creditoTexto}"`;
  // As colunas trazem o valor sem sinal; débito escrito com sinal de saída conta igual.
  return Math.abs(credito) - Math.abs(debito);
}

/**
 * O extrato com o mapeamento confirmado. O que o perfil não fixa (separador, decimal, data,
 * codificação) sai da amostra. Linha com data ou valor ilegível vai para `recusadas` e o resto
 * segue; arquivo sem dados, aspas sem fechar ou coluna que o arquivo não tem é erro.
 */
export function lerCsv(bytes: Uint8Array, mapeamentoBruto: MapeamentoCsv, opcoes: OpcoesCsv = {}): CsvLido {
  const mapeamento = MapeamentoCsv.parse(mapeamentoBruto);
  const { texto, codificacao } = decodificar(bytes, opcoes.codificacao);
  const deteccao =
    opcoes.separador && opcoes.formatoDecimal && opcoes.formatoData
      ? null
      : detectarTexto(texto, codificacao, opcoes.separador ?? null);
  const separador = opcoes.separador ?? deteccao?.separador ?? ";";
  const formatoDecimal = opcoes.formatoDecimal ?? deteccao?.formatoDecimal ?? ",";
  const registros = separarRegistros(texto, separador).slice(mapeamento.pularLinhas);
  const primeira = registros[0];
  if (primeira === undefined) throw new ErroDoCsv("O arquivo não tem linhas.");
  const maior = Math.max(...colunasDoMapeamento(mapeamento));
  if (maior >= primeira.campos.length) {
    throw new ErroDoCsv(
      `O mapeamento usa a coluna ${maior + 1}, e o arquivo tem ${primeira.campos.length}: confira o separador.`,
    );
  }
  if (mapeamento.cabecalho !== null) registros.shift();
  if (registros.length === 0) throw new ErroDoCsv("O arquivo só tem o cabeçalho, sem lançamentos.");
  // A coluna de data já é conhecida: o formato sai dela, e só então da amostra inteira.
  const formatoData =
    opcoes.formatoData ??
    formatosQueLeem(registros.slice(0, AMOSTRA).map((r) => celula(r.campos, mapeamento.data)))[0] ??
    deteccao?.formatoData;
  if (!formatoData) throw new ErroDoCsv("Não achei o formato das datas: escolha no mapeamento.");

  const linhas: LinhaCsv[] = [];
  const recusadas: LinhaRecusada[] = [];
  for (const { linha, campos } of registros) {
    const dataTexto = celula(campos, mapeamento.data);
    const data = lerData(dataTexto, formatoData);
    if (data === null) {
      recusadas.push({ linha, motivo: dataTexto === "" ? "sem data" : `data ilegível: "${dataTexto}"` });
      continue;
    }
    const valor = valorDaLinha(campos, mapeamento.valor, formatoDecimal);
    if (typeof valor === "string") {
      recusadas.push({ linha, motivo: valor });
      continue;
    }
    const descricao = mapeamento.descricao
      .map((i) => celula(campos, i))
      .filter((d) => d !== "")
      .join(" ")
      .replace(/\s+/g, " ");
    if (descricao === "") {
      recusadas.push({ linha, motivo: "sem descrição" });
      continue;
    }
    const id = mapeamento.identificador === null ? "" : celula(campos, mapeamento.identificador);
    linhas.push({ linha, data, descricao, valorCentavos: valor, idExterno: id === "" ? null : id });
  }

  const datas = linhas.map((l) => l.data).sort();
  const periodo = datas.length === 0 ? null : { inicio: datas[0] ?? "", fim: datas[datas.length - 1] ?? "" };
  return { separador, formatoDecimal, formatoData, codificacao, linhas, recusadas, periodo };
}

// ---------------------------------------------------------------------------------------------
// Detecção por amostra

/** Quantos registros a detecção lê. */
const AMOSTRA = 50;
/** Quantas linhas de dados a tabela do mapeamento mostra. */
const LINHAS_DA_AMOSTRA = 5;

/** Sem acento e em minúsculas, para comparar títulos de coluna. */
const simples = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const NOMES = {
  data: /^(data|dt|date)\b|^dt_|\bdata\b/,
  descricao: /descri|historico|lancamento|estabelecimento|^title$|^memo$|detalhe|^titulo$/,
  valor: /^(valor|vlr|vl|quantia|montante|amount|value)\b|valor/,
  debito: /debito|saida/,
  credito: /credito|entrada/,
  saldo: /saldo|balance/,
  identificador: /^(id|fitid|doc)$|identificador|documento/,
} as const;

/** Moda das contagens de campos dos registros com mais de um campo. */
function moda(contagens: readonly number[]): number {
  const vezes = new Map<number, number>();
  for (const n of contagens) if (n > 1) vezes.set(n, (vezes.get(n) ?? 0) + 1);
  let melhor = 0;
  let maisVezes = 0;
  for (const [n, v] of vezes)
    if (v > maisVezes || (v === maisVezes && n > melhor)) [melhor, maisVezes] = [n, v];
  return melhor;
}

/**
 * O separador que dá o mesmo número de colunas (mais de uma) ao maior pedaço da amostra; no empate,
 * o que dá mais colunas. Aspas mal fechadas para um separador só tiram ele da disputa.
 */
function detectarSeparador(texto: string): Separador {
  let melhor: { separador: Separador; nota: number; colunas: number } | null = null;
  for (const separador of SEPARADORES) {
    let registros: Registro[];
    try {
      registros = separarRegistros(texto, separador).slice(0, AMOSTRA);
    } catch {
      continue;
    }
    const contagens = registros.map((r) => r.campos.length);
    const colunas = moda(contagens);
    if (colunas < 2) continue;
    const nota = contagens.filter((n) => n === colunas).length / contagens.length;
    if (melhor === null || nota > melhor.nota || (nota === melhor.nota && colunas > melhor.colunas)) {
      melhor = { separador, nota, colunas };
    }
  }
  if (melhor === null) throw new ErroDoCsv("Não achei colunas neste arquivo: ele é mesmo um CSV?");
  return melhor.separador;
}

/** Quanto das células preenchidas um formato precisa ler para a coluna ser de data. */
const PARTE_QUE_E_DATA = 0.8;

/**
 * Os formatos que leem mais células preenchidas, se leem quase todas (linha de saldo ou de total no
 * meio não tira a coluna de data), na ordem de preferência.
 */
function formatosQueLeem(celulas: readonly string[]): FormatoData[] {
  const cheias = celulas.filter((c) => c !== "");
  if (cheias.length === 0) return [];
  const lidas = FORMATOS_DATA.map((f) => cheias.filter((c) => lerData(c, f) !== null).length);
  const melhor = Math.max(...lidas);
  if (melhor === 0 || melhor < cheias.length * PARTE_QUE_E_DATA) return [];
  return FORMATOS_DATA.filter((_, i) => lidas[i] === melhor);
}

/** Parece número de dinheiro (dígitos com separadores, sinal, símbolo, D/C), sem saber o decimal. */
const pareceValor = (c: string) =>
  /^[-−+(]?\s*(R\$|US\$|\$|€)?\s*[-−+]?\s*\d[\d.,]*\s*\)?\s*([-−]|[DC])?$/i.test(c.trim()) &&
  formatosQueLeem([c]).length === 0;

/**
 * Vírgula ou ponto nos centavos, pelo que vem depois do último separador: uma ou duas casas
 * decidem; "1.234" (três casas) é milhar no pt-BR e não decide. Sem nenhum voto, vírgula.
 */
function detectarDecimal(celulas: readonly string[]): Decimal {
  let virgula = 0;
  let ponto = 0;
  for (const c of celulas) {
    const m = /([.,])(\d+)\D*$/.exec(c.trim());
    if (m === null) continue;
    const [, sep, casas = ""] = m;
    if (casas.length === 3 && !/[.,].*[.,]/.test(c)) continue;
    if (sep === ",") virgula++;
    else ponto++;
  }
  return ponto > virgula ? "." : ",";
}

const ehLetra = (c: string) => /\p{L}/u.test(c);

interface Colunas {
  data: number | null;
  descricao: number | null;
  valor: ValorCsv | null;
  identificador: number | null;
}

/** As colunas pelo título e, sem título que diga, pelo conteúdo. */
function sugerirColunas(
  cabecalho: readonly string[],
  dados: readonly string[][],
  formatoData: FormatoData | null,
) {
  const n = cabecalho.length;
  const titulos = cabecalho.map(simples);
  const daColuna = (i: number) => dados.map((r) => (r[i] ?? "").trim());
  const ehData = (i: number) => formatoData !== null && formatosQueLeem(daColuna(i)).includes(formatoData);
  const ehValor = (i: number) => {
    const cheias = daColuna(i).filter((c) => c !== "");
    return cheias.length > 0 && cheias.every(pareceValor);
  };
  const porNome = (re: RegExp, aceita: (i: number) => boolean) => {
    for (let i = 0; i < n; i++) if (re.test(titulos[i] ?? "") && aceita(i)) return i;
    return null;
  };

  const data = porNome(NOMES.data, ehData) ?? Array.from({ length: n }, (_, i) => i).find(ehData) ?? null;
  const saldo = new Set(
    Array.from({ length: n }, (_, i) => i).filter((i) => NOMES.saldo.test(titulos[i] ?? "")),
  );
  // Só pelo título: número de documento tem cara de valor.
  const identificador = porNome(NOMES.identificador, (i) => i !== data && !saldo.has(i));
  const livre = (i: number) => i !== data && i !== identificador && !saldo.has(i);

  let valor: ValorCsv | null = null;
  const debito = porNome(NOMES.debito, (i) => livre(i) && ehValor(i));
  const credito = porNome(NOMES.credito, (i) => livre(i) && i !== debito && ehValor(i));
  const unica = porNome(NOMES.valor, (i) => livre(i) && ehValor(i) && i !== debito && i !== credito);
  if (unica !== null) valor = { modo: "sinal", coluna: unica, negativo: "saida" };
  else if (debito !== null && credito !== null) valor = { modo: "debito_credito", debito, credito };
  else {
    const numerica = Array.from({ length: n }, (_, i) => i).find((i) => livre(i) && ehValor(i));
    if (numerica !== undefined) valor = { modo: "sinal", coluna: numerica, negativo: "saida" };
  }
  const usadas = new Set<number>([
    ...(data === null ? [] : [data]),
    ...(identificador === null ? [] : [identificador]),
    ...(valor === null ? [] : valor.modo === "sinal" ? [valor.coluna] : [valor.debito, valor.credito]),
  ]);
  let descricao = porNome(NOMES.descricao, (i) => !usadas.has(i) && !saldo.has(i));
  if (descricao === null) {
    // A coluna com mais texto: mais células com letra, depois a mais comprida em média.
    let melhor = { i: -1, letras: 0, tamanho: 0 };
    for (let i = 0; i < n; i++) {
      if (usadas.has(i) || saldo.has(i)) continue;
      const cel = daColuna(i);
      const letras = cel.filter(ehLetra).length;
      const tamanho = cel.reduce((s, c) => s + c.length, 0) / Math.max(cel.length, 1);
      if (letras > melhor.letras || (letras === melhor.letras && letras > 0 && tamanho > melhor.tamanho)) {
        melhor = { i, letras, tamanho };
      }
    }
    descricao = melhor.letras > 0 ? melhor.i : null;
  }
  return { data, descricao, valor, identificador } satisfies Colunas;
}

const NOME_SEPARADOR: Record<Separador, string> = {
  ";": "ponto e vírgula",
  ",": "vírgula",
  "\t": "tabulação",
};
const NOME_DATA: Record<FormatoData, string> = {
  "dd/mm/aaaa": "datas no formato brasileiro",
  "dd/mm/aa": "datas no formato brasileiro com ano curto",
  "dd-mm-aaaa": "datas no formato brasileiro com traço",
  "dd.mm.aaaa": "datas no formato brasileiro com ponto",
  "aaaa-mm-dd": "datas no formato ano-mês-dia",
  "mm/dd/aaaa": "datas no formato americano (mês antes do dia)",
};
const NOME_DECIMAL: Record<Decimal, string> = { ",": "vírgula nos centavos", ".": "ponto nos centavos" };

/** "Detectei ponto e vírgula, datas no formato brasileiro e vírgula nos centavos." e o que conferir. */
function fraseDaDeteccao(
  separador: Separador,
  formatoData: FormatoData | null,
  decimal: Decimal,
  valor: ValorCsv | null,
): string {
  const achados = [
    NOME_SEPARADOR[separador],
    ...(formatoData ? [NOME_DATA[formatoData]] : []),
    NOME_DECIMAL[decimal],
  ];
  const lista = `${achados.slice(0, -1).join(", ")} e ${achados[achados.length - 1]}`;
  const conferir =
    formatoData === null
      ? "Não achei a coluna de data: escolha qual é."
      : valor === null
        ? "Não achei a coluna de valor: escolha qual é."
        : valor.modo === "sinal"
          ? "Confira só a coluna de valor: negativo é saída?"
          : "Confira as colunas de débito e crédito.";
  return `Detectei ${lista}. ${conferir}`;
}

/** Tem cara de dado (data ou número), e não de título de coluna. */
const pareceDado = (c: string) => c.trim() !== "" && (pareceValor(c) || formatosQueLeem([c]).length > 0);

function detectarTexto(
  texto: string,
  codificacao: Codificacao,
  separadorFixo: Separador | null = null,
): DeteccaoCsv {
  const separador = separadorFixo ?? detectarSeparador(texto);
  const registros = separarRegistros(texto, separador);
  const colunas = moda(registros.slice(0, AMOSTRA).map((r) => r.campos.length));
  // O que vem antes da primeira linha com o número de colunas do arquivo é cabeçalho do banco.
  const pularLinhas = Math.max(
    0,
    registros.findIndex((r) => r.campos.length === colunas),
  );
  const resto = registros.slice(pularLinhas);
  const primeira = resto[0]?.campos ?? [];
  const temTitulo = !primeira.some(pareceDado);
  const cabecalho = temTitulo ? primeira.map((c) => c.trim()) : null;
  // Sem títulos, as colunas se chamam pela posição só para a sugestão por conteúdo.
  const nomes = cabecalho ?? primeira.map(() => "");
  const dadosTodos = (temTitulo ? resto.slice(1) : resto).map((r) => r.campos);
  const dados = dadosTodos.slice(0, AMOSTRA);

  // O formato que lê alguma coluna inteira, preferindo a de título de data.
  let formatoData: FormatoData | null = null;
  const titulos = nomes.map(simples);
  const ordem = Array.from({ length: nomes.length }, (_, i) => i).sort(
    (a, b) => Number(NOMES.data.test(titulos[b] ?? "")) - Number(NOMES.data.test(titulos[a] ?? "")),
  );
  for (const i of ordem) {
    // FORMATOS_DATA vem em ordem de preferência: dia e mês trocáveis ficam com o brasileiro.
    formatoData = formatosQueLeem(dados.map((r) => (r[i] ?? "").trim()))[0] ?? null;
    if (formatoData !== null) break;
  }

  const sugeridas = sugerirColunas(nomes, dados, formatoData);
  const valores =
    sugeridas.valor === null
      ? []
      : (sugeridas.valor.modo === "sinal"
          ? [sugeridas.valor.coluna]
          : [sugeridas.valor.debito, sugeridas.valor.credito]
        ).flatMap((i) => dados.map((r) => r[i] ?? ""));
  const formatoDecimal = detectarDecimal(valores);

  const mapeamento =
    sugeridas.data !== null && sugeridas.descricao !== null && sugeridas.valor !== null
      ? {
          pularLinhas,
          cabecalho,
          data: sugeridas.data,
          descricao: [sugeridas.descricao],
          valor: sugeridas.valor,
          identificador: sugeridas.identificador,
        }
      : null;

  return {
    codificacao,
    separador,
    formatoDecimal,
    formatoData,
    mapeamento,
    pularLinhas,
    cabecalho,
    colunas: nomes.length,
    amostra: dados.slice(0, LINHAS_DA_AMOSTRA),
    totalLinhas: dadosTodos.length,
    frase: fraseDaDeteccao(separador, formatoData, formatoDecimal, sugeridas.valor),
  };
}

/**
 * Sem perfil: separador, decimal, formato de data, codificação, onde está o cabeçalho e a sugestão
 * de colunas, pela amostra. O mapeamento guiado mostra isso para o usuário confirmar.
 */
export function detectarCsv(bytes: Uint8Array): DeteccaoCsv {
  const { texto, codificacao } = decodificar(bytes);
  if (texto.trim() === "") throw new ErroDoCsv("O arquivo está vazio.");
  return detectarTexto(texto, codificacao);
}
