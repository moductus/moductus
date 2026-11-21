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
  // CR sem LF não precisa de troca: a versão e a codificação saem do cabeçalho lido aqui, e o SGML
  // trata CR como espaço entre as tags. O cabeçalho que o `ofx-js` monta não é usado.
  let raiz: unknown;
  try {
    raiz = parseSync(texto).OFX;
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
  // Saldo é informação, não lançamento: BALAMT ilegível vira `null` de propósito, sem recusar o arquivo.
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
  const fitid = folha(t.FITID);
  const qual = fitid ? ` (${fitid})` : "";
  // DTUSER só na falta do DTPOSTED: DTPOSTED que veio e não é data recusa o arquivo.
  const dataBruta = folha(t.DTPOSTED) ?? folha(t.DTUSER);
  if (dataBruta === null) throw new ErroDoOfx(`Uma transação do extrato está sem data${qual}.`);
  const data = lerData(dataBruta);
  if (data === null) {
    throw new ErroDoOfx(`A data "${dataBruta}" de uma transação do extrato não deu para ler${qual}.`);
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
      codificacao ??= xml?.[1] ?? "utf-8";
    } else {
      versao = /^\s*VERSION:\s*(\d+)/im.exec(cabecalho)?.[1] ?? null;
      codificacao ??= codificacaoDoSgml(cabecalho);
    }
  }

  // O nome canônico do WHATWG: "ISO-8859-1" é "windows-1252", "UTF8" é "utf-8".
  let canonica: string;
  try {
    canonica = new TextDecoder(codificacao).encoding;
  } catch {
    throw new ErroDoOfx(`O arquivo OFX usa uma codificação que não dá para ler: ${codificacao}.`);
  }
  try {
    return { texto: new TextDecoder(canonica, { fatal: true }).decode(corpo), codificacao: canonica, versao };
  } catch {
    // Só o UTF-8 (e o UTF-16) recusa byte. Banco que declara UTF-8 e manda 1252 existe, às vezes
    // misturado: o que é UTF-8 válido fica UTF-8 e cada byte solto vai pelo 1252. O rótulo devolvido
    // diz que o arquivo não era UTF-8 puro.
    if (canonica !== "utf-8") {
      throw new ErroDoOfx(`O arquivo OFX usa uma codificação que não dá para ler: ${codificacao}.`);
    }
    return { texto: utf8ComReserva1252(corpo), codificacao: "windows-1252", versao };
  }
}

/** UTF-8 onde a sequência é válida; cada byte que não forma sequência, pelo 1252. */
function utf8ComReserva1252(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8");
  const cp1252 = new TextDecoder("windows-1252");
  let texto = "";
  let inicio = 0;
  let i = 0;
  while (i < bytes.length) {
    const tamanho = sequenciaUtf8(bytes, i);
    if (tamanho > 0) {
      i += tamanho;
      continue;
    }
    texto += utf8.decode(bytes.subarray(inicio, i)) + cp1252.decode(bytes.subarray(i, i + 1));
    i += 1;
    inicio = i;
  }
  return texto + utf8.decode(bytes.subarray(inicio));
}

/** Tamanho da sequência UTF-8 válida que começa em `i` (tabela do WHATWG), ou 0. */
function sequenciaUtf8(bytes: Uint8Array, i: number): number {
  const b = bytes[i] ?? 0;
  if (b < 0x80) return 1;
  const segue = (n: number, min = 0x80, max = 0xbf): boolean => {
    const c = bytes[i + n];
    return c !== undefined && c >= min && c <= max;
  };
  if (b >= 0xc2 && b <= 0xdf) return segue(1) ? 2 : 0;
  if (b >= 0xe0 && b <= 0xef) {
    const min = b === 0xe0 ? 0xa0 : 0x80;
    const max = b === 0xed ? 0x9f : 0xbf;
    return segue(1, min, max) && segue(2) ? 3 : 0;
  }
  if (b >= 0xf0 && b <= 0xf4) {
    const min = b === 0xf0 ? 0x90 : 0x80;
    const max = b === 0xf4 ? 0x8f : 0xbf;
    return segue(1, min, max) && segue(2) && segue(3) ? 4 : 0;
  }
  return 0;
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
 * ponto ou vírgula ("-45.90", "-45,90"). Exatamente três casas é recusado sempre: "1.500" pode ser
 * 1,50 pelo OFX ou 1.500 pelo costume daqui, e número na dúvida não entra. Com quatro casas ou mais,
 * zero sobrando no fim não muda o valor ("45.9000"). Com os dois separadores, vale a leitura pt-BR
 * de `lerValor` ("1.234,56").
 */
export function lerValorOfx(bruto: string | null): number | null {
  if (bruto === null) return null;
  let texto = bruto.trim();
  const separadores = texto.match(/[.,]/g)?.length ?? 0;
  if (separadores === 1) {
    const partes = /^([-+]?)(\d*)[.,](\d+)$/.exec(texto);
    if (!partes) return null;
    const [, sinal = "", inteiro = "", fracao = ""] = partes;
    if (fracao.length === 3) return null;
    const casas = fracao.length > 3 ? fracao.replace(/0+$/, "") : fracao;
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
