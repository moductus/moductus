/**
 * Dinheiro em texto, num lugar só (DATA §1, ADR-0046): o valor anda em centavos inteiros com sinal
 * (negativo é saída) e só vira texto aqui, em pt-BR. Ler o que a pessoa digitou também é daqui,
 * sem passar por ponto flutuante: "1.234,56" é 123.456 centavos, sempre.
 */

/** A moeda quando a conta não diz outra. */
export const MOEDA_PADRAO = "BRL";

export interface FormatoDinheiro {
  /** Código ISO 4217 da moeda da conta, de duas casas decimais. Padrão: real. */
  moeda?: string;
  /** Entrada com "+" ("+ R$ 10,00"); a saída leva "−" de qualquer jeito. */
  sinal?: boolean;
  /** Sem a vírgula, arredondado para o inteiro mais perto, meio para cima: "R$ 1.235". */
  semCentavos?: boolean;
  /** Só o número ("1.234,56"), para o campo de digitar. */
  semSimbolo?: boolean;
}

const SIMBOLOS = new Map<string, string>();

/** "R$", "US$", "€": o símbolo que o pt-BR usa; moeda sem símbolo próprio fica com o código. */
export function simboloDaMoeda(moeda: string): string {
  const codigo = moeda.toUpperCase();
  let simbolo = SIMBOLOS.get(codigo);
  if (simbolo === undefined) {
    try {
      const partes = new Intl.NumberFormat("pt-BR", { style: "currency", currency: codigo }).formatToParts(0);
      simbolo = partes.find((p) => p.type === "currency")?.value ?? codigo;
    } catch {
      // Código fora do formato ISO: mostra como veio, em vez de quebrar a tela.
      simbolo = codigo;
    }
    SIMBOLOS.set(codigo, simbolo);
  }
  return simbolo;
}

/** "1234567" vira "1.234.567". */
const milhar = (inteiro: number): string => String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const NOMES = new Map<string, string>();

/**
 * O nome da moeda em pt-BR, no singular ou no plural ("dólar americano", "euros"), para o leitor
 * de tela; código fora do formato ISO fica com o código.
 */
export function nomeDaMoeda(moeda: string, plural: boolean): string {
  const codigo = moeda.toUpperCase();
  const chave = `${codigo}:${plural ? "varios" : "um"}`;
  let nome = NOMES.get(chave);
  if (nome === undefined) {
    try {
      const partes = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: codigo,
        currencyDisplay: "name",
      }).formatToParts(plural ? 2 : 1);
      nome = partes.find((p) => p.type === "currency")?.value.toLocaleLowerCase("pt-BR") ?? codigo;
    } catch {
      nome = codigo;
    }
    NOMES.set(chave, nome);
  }
  return nome;
}

export interface FalaDinheiro {
  /** Código ISO 4217 da moeda; padrão, real. */
  moeda?: string;
  /** Entrada com "mais", como o "+" da tela. */
  sinal?: boolean;
  /** Arredondado como na tela: inteiro mais perto, meio para cima. */
  semCentavos?: boolean;
}

/**
 * O valor como o leitor de tela deve dizer: "menos 45 reais", "mais 1.234 reais e 56 centavos",
 * "1 real", "19,99 dólares americanos". O "R$" e o "−" da tela viram palavras, porque o leitor lê
 * "R$" letra por letra e pode calar o sinal. Conta nos centavos, como `formatarCentavos`.
 */
export function falarCentavos(centavos: number, fala: FalaDinheiro = {}): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError(`Valor em centavos inválido: ${centavos}`);
  const moeda = (fala.moeda ?? MOEDA_PADRAO).toUpperCase();
  const absoluto = Math.abs(centavos);
  let resto = absoluto % 100;
  let unidades = (absoluto - resto) / 100;
  if (fala.semCentavos) {
    if (resto >= 50) unidades += 1;
    resto = 0;
  }
  const zero = unidades === 0 && resto === 0;
  const prefixo = zero ? "" : centavos < 0 ? "menos " : fala.sinal ? "mais " : "";
  const inteiro = milhar(unidades);
  if (moeda !== MOEDA_PADRAO) {
    const numero = fala.semCentavos ? inteiro : `${inteiro},${String(resto).padStart(2, "0")}`;
    return `${prefixo}${numero} ${nomeDaMoeda(moeda, unidades !== 1 || resto > 0)}`;
  }
  const partes: string[] = [];
  if (unidades > 0 || resto === 0) partes.push(`${inteiro} ${unidades === 1 ? "real" : "reais"}`);
  if (resto > 0) partes.push(`${resto} ${resto === 1 ? "centavo" : "centavos"}`);
  return prefixo + partes.join(" e ");
}

/**
 * Centavos em texto pt-BR: "R$ 1.234,56", "− R$ 45,00", "+ R$ 10,00" (com `sinal`), "R$ 1.235"
 * (com `semCentavos`). Zero não leva sinal. Recusa o que não é centavo inteiro: número sem fonte
 * não aparece (PRODUCT §11, 36).
 */
export function formatarCentavos(centavos: number, formato: FormatoDinheiro = {}): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError(`Valor em centavos inválido: ${centavos}`);
  const absoluto = Math.abs(centavos);
  const resto = absoluto % 100;
  // A diferença é múltiplo de 100, então a divisão é exata mesmo perto do maior inteiro seguro.
  let inteiro = (absoluto - resto) / 100;
  let numero: string;
  if (formato.semCentavos) {
    if (resto >= 50) inteiro += 1;
    numero = milhar(inteiro);
  } else {
    numero = `${milhar(inteiro)},${String(resto).padStart(2, "0")}`;
  }
  const mostrado = formato.semCentavos ? inteiro : absoluto;
  const sinal = mostrado === 0 ? "" : centavos < 0 ? "−" : formato.sinal ? "+" : "";
  if (formato.semSimbolo) return `${sinal}${numero}`;
  const simbolo = simboloDaMoeda(formato.moeda ?? MOEDA_PADRAO);
  return sinal ? `${sinal} ${simbolo} ${numero}` : `${simbolo} ${numero}`;
}

/**
 * O número: milhar com ponto e vírgula decimal ("1.234,56", "45,9"), só dígitos ("45", "1234,5")
 * ou ponto decimal com até duas casas ("45.90"). "1.234" é milhar, como se escreve em pt-BR.
 */
const NUMERO = /^(?:(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?|(\d+)\.(\d{1,2}))$/;
/** Sinal antes ou depois do símbolo ("−R$ 12", "R$ -12"), nunca nos dois lugares. */
const VALOR = /^([-−+]?)(?:R\$|US\$|\$|€|£)?([-−+]?)(.+)$/i;

/**
 * O valor digitado em centavos, sem ponto flutuante: "1.234,56", "45", "45,9", "R$ 12", "−45,00".
 * Espaço não conta. Mais de duas casas, letra, separador fora do lugar ou valor além do maior
 * inteiro seguro são `null`. Quem não aceita negativo ou zero confere depois.
 */
export function lerValor(texto: string): number | null {
  const limpo = texto.replace(/\s/g, "");
  const partes = VALOR.exec(limpo);
  if (partes === null) return null;
  const [, antes = "", depois = "", corpo = ""] = partes;
  if (antes && depois) return null;
  const numero = NUMERO.exec(corpo);
  if (numero === null) return null;
  const inteiro = (numero[1] ?? numero[3] ?? "").replaceAll(".", "");
  const fracao = (numero[2] ?? numero[4] ?? "").padEnd(2, "0");
  const valor = Number(inteiro + fracao);
  if (!Number.isSafeInteger(valor)) return null;
  const negativo = antes === "-" || antes === "−" || depois === "-" || depois === "−";
  return negativo && valor !== 0 ? -valor : valor;
}
