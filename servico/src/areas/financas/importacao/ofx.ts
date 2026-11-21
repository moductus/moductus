import { lerValor } from "@moductus/contrato";
import { parseSync } from "ofx-js";

/**
 * Leitor de OFX (ADR-0041): o `ofx-js` monta a árvore, a camada daqui decide o resto sem confiar em
 * ninguém. A codificação sai do cabeçalho (o 1.x dos bancos é `CHARSET:1252`), a data é a do
 * arquivo, sem fuso (`20251031220000[-3:BRT]` é 31/10, não 1º/11 em UTC), e o valor vira centavos
 * inteiros sem passar por ponto flutuante, com ponto ou vírgula. Lê tudo ou nada: arquivo cortado
 * ou valor que não dá para ler é erro, nunca metade do extrato.
 */

/** Erro de leitura do arquivo: a tela mostra como veio. */
export class ErroDoOfx extends Error {}

export const MENSAGEM_NAO_E_OFX = "Este arquivo não parece um extrato OFX.";
export const MENSAGEM_CORTADO =
  "O arquivo OFX parece cortado ou com defeito: exporte de novo pelo banco e tente outra vez.";
export const MENSAGEM_SEM_EXTRATO = "O arquivo OFX não traz extrato de conta nem de cartão.";

export interface TransacaoOfx {
  /** Identificador do banco para a transação; sinal de repetido, nunca regra única (ADR-0042). */
  fitid: string | null;
  /** `AAAA-MM-DD`, como está no arquivo (`DTPOSTED`, ou `DTUSER` na falta dele). */
  data: string;
  /** Centavos com sinal: negativo é saída. */
  valor: number;
  /** `TRNTYPE` como veio (`DEBIT`, `CREDIT`, `PAYMENT`...). */
  tipo: string | null;
  nome: string | null;
  memo: string | null;
  /** Nome e memo juntos, sem repetir: o texto que a pessoa reconhece. */
  descricao: string;
  /** `CHECKNUM` ou `REFNUM`. */
  documento: string | null;
}

export interface ExtratoOfx {
  /** Conta corrente ou poupança (`BANKMSGSRSV1`) ou cartão de crédito (`CREDITCARDMSGSRSV1`). */
  tipo: "conta" | "cartao";
  /** `BANKID`; o cartão não tem. */
  banco: string | null;
  /** `BRANCHID`, quando o banco manda. */
  agencia: string | null;
  /** `ACCTID`: número da conta ou do cartão. */
  conta: string;
  /** `ACCTTYPE` (`CHECKING`, `SAVINGS`...); o cartão não tem. */
  tipoConta: string | null;
  /** `CURDEF`, em maiúsculas; real quando falta. */
  moeda: string;
  /** `DTSTART` e `DTEND` da lista de transações. */
  periodo: { inicio: string | null; fim: string | null };
  /** `LEDGERBAL`, quando o banco manda. */
  saldo: { valor: number; data: string | null } | null;
  transacoes: TransacaoOfx[];
}

export interface ArquivoOfx {
  /** `VERSION` do cabeçalho: "102", "211"... */
  versao: string | null;
  /** O rótulo usado para decodificar: "windows-1252", "utf-8"... */
  codificacao: string;
  /** `ORG` e `FID` do `SONRS`: assinatura do banco para reconhecer o perfil. */
  organizacao: string | null;
  fid: string | null;
  extratos: ExtratoOfx[];
}

/** Lê o arquivo inteiro ou lança `ErroDoOfx` com a mensagem para a pessoa. */
export function lerOfx(bytes: Uint8Array): ArquivoOfx {
  const { texto, codificacao, versao } = decodificar(bytes);
  if (!texto.includes("<OFX>")) throw new ErroDoOfx(MENSAGEM_NAO_E_OFX);
  // O `ofx-js` só separa o cabeçalho por LF; arquivo com CR sozinho viraria uma linha só.
  const normalizado = texto.replace(/\r\n?/g, "\n");
  let raiz: unknown;
  try {
    raiz = parseSync(normalizado).OFX;
  } catch {
    throw new ErroDoOfx(MENSAGEM_CORTADO);
  }
  if (!ehObjeto(raiz)) throw new ErroDoOfx(MENSAGEM_CORTADO);

  const fi = objeto(objeto(objeto(raiz.SIGNONMSGSRSV1)?.SONRS)?.FI);
  const extratos = [
    ...lista(objeto(raiz.BANKMSGSRSV1)?.STMTTRNRS).map((r) => objeto(objeto(r)?.STMTRS)),
    ...lista(objeto(raiz.CREDITCARDMSGSRSV1)?.CCSTMTTRNRS).map((r) => objeto(objeto(r)?.CCSTMTRS)),
  ]
    .filter((rs): rs is Objeto => rs !== null)
    .map(lerExtrato);
  if (extratos.length === 0) throw new ErroDoOfx(MENSAGEM_SEM_EXTRATO);

  return {
    versao,
    codificacao,
    organizacao: folha(fi?.ORG),
    fid: folha(fi?.FID),
    extratos,
  };
}

function lerExtrato(rs: Objeto): ExtratoOfx {
  const deConta = objeto(rs.BANKACCTFROM);
  const deCartao = objeto(rs.CCACCTFROM);
  const origem = deConta ?? deCartao;
  const conta = folha(origem?.ACCTID);
  if (conta === null) throw new ErroDoOfx(MENSAGEM_CORTADO);
  const lote = objeto(rs.BANKTRANLIST);
  const saldo = objeto(rs.LEDGERBAL);
  const valorDoSaldo = saldo ? lerValorOfx(folha(saldo.BALAMT)) : null;
  return {
    tipo: deConta ? "conta" : "cartao",
    banco: folha(deConta?.BANKID),
    agencia: folha(deConta?.BRANCHID),
    conta,
    tipoConta: folha(deConta?.ACCTTYPE),
    moeda: (folha(rs.CURDEF) ?? "BRL").toUpperCase(),
    periodo: { inicio: lerData(folha(lote?.DTSTART)), fim: lerData(folha(lote?.DTEND)) },
    saldo: valorDoSaldo === null ? null : { valor: valorDoSaldo, data: lerData(folha(saldo?.DTASOF)) },
    // Uma transação só vem como objeto, não como lista.
    transacoes: lista(lote?.STMTTRN).map(lerTransacao),
  };
}

function lerTransacao(bruta: unknown): TransacaoOfx {
  const t = objeto(bruta);
  if (t === null) throw new ErroDoOfx(MENSAGEM_CORTADO);
  const data = lerData(folha(t.DTPOSTED)) ?? lerData(folha(t.DTUSER));
  const fitid = folha(t.FITID);
  if (data === null) {
    throw new ErroDoOfx(`Uma transação do extrato está sem data${fitid ? ` (${fitid})` : ""}.`);
  }
  const bruto = folha(t.TRNAMT);
  const valor = lerValorOfx(bruto);
  if (valor === null) {
    const [ano, mes, dia] = data.split("-");
    throw new ErroDoOfx(`O valor "${bruto ?? ""}" da transação de ${dia}/${mes}/${ano} não deu para ler.`);
  }
  const nome = folha(t.NAME);
  const memo = folha(t.MEMO);
  return {
    fitid,
    data,
    valor,
    tipo: folha(t.TRNTYPE),
    nome,
    memo,
    descricao: [...new Set([nome, memo].filter((p): p is string => p !== null))].join(" · "),
    documento: folha(t.CHECKNUM) ?? folha(t.REFNUM),
  };
}

/**
 * Bytes em texto pela codificação que o próprio arquivo declara. O cabeçalho é ASCII, então dá
 * para lê-lo antes de saber a codificação do resto.
 */
function decodificar(bytes: Uint8Array): { texto: string; codificacao: string; versao: string | null } {
  let corpo = bytes;
  let codificacao: string | null = null;
  if (corpo[0] === 0xef && corpo[1] === 0xbb && corpo[2] === 0xbf) {
    corpo = corpo.subarray(3);
    codificacao = "utf-8";
  } else if (corpo[0] === 0xff && corpo[1] === 0xfe) {
    corpo = corpo.subarray(2);
    codificacao = "utf-16le";
  } else if (corpo[0] === 0xfe && corpo[1] === 0xff) {
    corpo = corpo.subarray(2);
    codificacao = "utf-16be";
  }

  let versao: string | null = null;
  if (codificacao === null || codificacao === "utf-8") {
    const cabecalho = new TextDecoder("windows-1252").decode(corpo.subarray(0, 1024));
    const xml = /<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i.exec(cabecalho);
    const ofx2 = /<\?OFX\b[^>]*?\bVERSION\s*=\s*["']?(\d+)/i.exec(cabecalho);
    if (/^\s*<\?(?:xml|OFX)\b/i.test(cabecalho)) {
      versao = ofx2?.[1] ?? null;
      codificacao ??= xml?.[1]?.toLowerCase() ?? "utf-8";
    } else {
      versao = /^\s*VERSION:\s*(\d+)/im.exec(cabecalho)?.[1] ?? null;
      codificacao ??= codificacaoDoSgml(cabecalho);
    }
  }

  try {
    return { texto: new TextDecoder(codificacao, { fatal: true }).decode(corpo), codificacao, versao };
  } catch (erro) {
    // Banco que declara UTF-8 e manda 1252 existe; o 1252 decodifica qualquer byte.
    if (codificacao === "utf-8" && erro instanceof TypeError) {
      return { texto: new TextDecoder("windows-1252").decode(corpo), codificacao: "windows-1252", versao };
    }
    throw new ErroDoOfx(`O arquivo OFX usa uma codificação que não dá para ler: ${codificacao}.`);
  }
}

/**
 * O 1.x diz `ENCODING:USASCII` e `CHARSET:1252` (ou nada): é 1252, que é o que os bancos mandam com
 * acento. `ENCODING:UTF-8` vale como está.
 */
function codificacaoDoSgml(cabecalho: string): string {
  const encoding = /^\s*ENCODING:\s*(\S+)/im.exec(cabecalho)?.[1]?.toUpperCase();
  if (encoding === "UTF-8" || encoding === "UTF8") return "utf-8";
  const charset = /^\s*CHARSET:\s*(\S+)/im.exec(cabecalho)?.[1]?.toUpperCase();
  if (charset === "8859-1" || charset === "ISO-8859-1") return "iso-8859-1";
  return "windows-1252";
}

/** `AAAAMMDD[HHMMSS[.XXX]][[±h:TZ]]` vira `AAAA-MM-DD` literal; data que não existe é `null`. */
function lerData(bruto: string | null): string | null {
  const partes = bruto === null ? null : /^(\d{4})(\d{2})(\d{2})/.exec(bruto);
  if (!partes) return null;
  const [, ano = "", mes = "", dia = ""] = partes;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia)) return null;
  return `${ano}-${mes}-${dia}`;
}

/**
 * `TRNAMT` em centavos. O OFX não tem separador de milhar, então um separador só é o decimal, seja
 * ponto ou vírgula ("-45.90", "-45,90", "1.234" é 1,234 e fica recusado por ter três casas).
 * Zero sobrando depois da segunda casa ("45.900") não muda o valor. Com os dois separadores, vale a
 * leitura pt-BR de `lerValor` ("1.234,56").
 */
export function lerValorOfx(bruto: string | null): number | null {
  if (bruto === null) return null;
  let texto = bruto.trim();
  const separadores = texto.match(/[.,]/g)?.length ?? 0;
  if (separadores === 1) {
    const partes = /^([-+]?)(\d*)[.,](\d+)$/.exec(texto);
    if (!partes) return null;
    const [, sinal = "", inteiro = "", fracao = ""] = partes;
    const casas = fracao.length > 2 ? fracao.replace(/0+$/, "") : fracao;
    if (casas.length > 2) return null;
    texto = `${sinal}${inteiro || "0"}${casas ? `,${casas}` : ""}`;
  }
  return lerValor(texto);
}

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function objeto(valor: unknown): Objeto | null {
  return ehObjeto(valor) ? valor : null;
}

function lista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null || valor === "") return [];
  return Array.isArray(valor) ? valor : [valor];
}

/** Folha da árvore sem espaço nas pontas e com as entidades que o `ofx-js` não troca. */
function folha(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor
    .replace(/&#x([0-9a-f]{1,6});/gi, (inteira, hex: string) => caractere(Number.parseInt(hex, 16), inteira))
    .replace(/&#(\d{1,7});/g, (inteira, dec: string) => caractere(Number(dec), inteira))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
  return limpo === "" ? null : limpo;
}

function caractere(codigo: number, original: string): string {
  return codigo <= 0x10ffff ? String.fromCodePoint(codigo) : original;
}
