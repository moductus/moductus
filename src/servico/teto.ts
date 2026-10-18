import {
  COTACAO_MAXIMA_MILIONESIMOS,
  type Cotacao,
  type GastoDeHoje,
  type MoedaComCotacao,
  type MoedaTeto,
} from "@moductus/contrato";

/**
 * O teto diário na moeda do usuário em texto (ADR-0040). Quem conta é o serviço: o gasto de hoje,
 * o limite e o passo do "Liberar" chegam prontos com o agente. Aqui só se escreve, e todo valor
 * vem marcado como estimativa: o custo é da tabela de preços, e fora do dólar passa pela cotação.
 */

export const SIMBOLO: Readonly<Record<MoedaTeto, string>> = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£" };

/** "em real", "em euro": para dizer de que moeda é a cotação. */
export const NOME_DA_MOEDA: Readonly<Record<MoedaTeto, string>> = {
  BRL: "real",
  USD: "dólar",
  EUR: "euro",
  GBP: "libra",
};

const DUAS_CASAS = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ATE_SEIS_CASAS = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** "R$ 10,00", "US$ 1.234,56". */
export function dinheiro(centavos: number, moeda: MoedaTeto): string {
  return `${SIMBOLO[moeda]} ${DUAS_CASAS.format(centavos / 100)}`;
}

/** "10,00" para o campo, sem o símbolo; vazio sem teto. */
export function valorNoCampo(centavos: number | null): string {
  return centavos === null ? "" : DUAS_CASAS.format(centavos / 100);
}

/** "2026-10-16" vira "16/10". */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * O número que a pessoa digitou, em unidades inteiras de `casas` decimais: aceita "10", "10,5",
 * "1.234,56" e "10.50"; recusa negativo, letra e mais casas do que cabem. `null` é inválido.
 */
function lerDecimal(texto: string, casas: number): number | null {
  const limpo = texto.trim().replace(/\s/g, "");
  if (!limpo) return null;
  // Com vírgula, o ponto é de milhar e só vem antes dela ("10,5.0" não é número); sem vírgula,
  // um ponto só é a casa decimal.
  const virgula = limpo.indexOf(",");
  if (virgula >= 0 && limpo.includes(".", virgula)) return null;
  const normal = virgula >= 0 ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const casou = /^(\d+)(?:\.(\d+))?$/.exec(normal);
  if (!casou) return null;
  const [, inteiro, fracao = ""] = casou;
  if (fracao.length > casas) return null;
  const valor = Number(inteiro) * 10 ** casas + Number(fracao.padEnd(casas, "0"));
  return Number.isSafeInteger(valor) ? valor : null;
}

/** O teto digitado em centavos; vazio é sem teto (`null`), inválido é `undefined`. */
export function lerTeto(texto: string): number | null | undefined {
  if (!texto.trim()) return null;
  return lerDecimal(texto, 2) ?? undefined;
}

/** A cotação digitada em milionésimos ("5,43" é 5.430.000); zero, inválido e acima do máximo são `null`. */
export function lerCotacao(texto: string): number | null {
  const valor = lerDecimal(texto, 6);
  return valor !== null && valor > 0 && valor <= COTACAO_MAXIMA_MILIONESIMOS ? valor : null;
}

/** O que a tela diz quando o número digitado passa do que o contrato aceita. */
export const MENSAGEM_COTACAO_ALTA = `A cotação vai até ${cotacaoNoCampo(COTACAO_MAXIMA_MILIONESIMOS)} por US$ 1. Confira o número.`;

/** O número digitado é válido, mas passa do máximo: a tela avisa em vez de só travar o "Guardar". */
export function cotacaoAcimaDoMaximo(texto: string): boolean {
  const valor = lerDecimal(texto, 6);
  return valor !== null && valor > COTACAO_MAXIMA_MILIONESIMOS;
}

/** "5,43" para o campo, com as casas que a cotação tem. */
export function cotacaoNoCampo(milionesimos: number): string {
  return ATE_SEIS_CASAS.format(milionesimos / 1_000_000);
}

/** "US$ 1 = R$ 5,4321". */
export function cotacaoEmTexto(moeda: MoedaComCotacao, milionesimos: number): string {
  return `US$ 1 = ${SIMBOLO[moeda]} ${cotacaoNoCampo(milionesimos)}`;
}

/** "de 16/10, digitada" ou "de 16/10, do Frankfurter". */
export function origemDaCotacao(cotacao: Cotacao): string {
  return `de ${diaCurto(cotacao.data)}, ${cotacao.fonte === "digitada" ? "digitada" : "do Frankfurter"}`;
}

/** Hoje do dia local, `AAAA-MM-DD`: a data da cotação digitada. */
export function diaDeHoje(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/** O gasto de hoje contra o teto, como a coluna "Hoje" e o cartão de teto mostram. */
export interface GastoMostrado {
  /** "≈ R$ 1,12 de R$ 5,00"; sem cotação, "sem cotação". */
  texto: string;
  /** O que o leitor de tela lê: "cerca de R$ 1,12 de R$ 5,00 hoje, estimativa pela cotação de 16/10". */
  rotulo: string;
  /** Quanto do limite já foi, de 0 a 100; `null` sem número. */
  pct: number | null;
  semCotacao: boolean;
}

/** De onde vem a estimativa: a tabela de preços, e fora do dólar a cotação daquele dia. */
export function fonteDaEstimativa(gasto: GastoDeHoje): string {
  return gasto.cotacaoDe ? `estimativa pela cotação de ${diaCurto(gasto.cotacaoDe)}` : "estimativa";
}

/**
 * O gasto contra o limite para a dica do dock no teto (Estados.dc.html, "o valor ao passar o
 * mouse"): "≈ R$ 10,00 de R$ 10,00, estimativa pela cotação de 16/10". `null` sem número.
 */
export function gastoNaDica(gasto: GastoDeHoje, moeda: MoedaTeto): string | null {
  if (gasto.limiteCentavos === null) return null;
  const limite = dinheiro(gasto.limiteCentavos, moeda);
  if (gasto.centavos === null) return gasto.limiteCentavos === 0 ? `teto de ${limite}` : null;
  return `≈ ${dinheiro(gasto.centavos, moeda)} de ${limite}, ${fonteDaEstimativa(gasto)}`;
}

/** `null` quando o agente não tem teto: a coluna fica com o número de execuções. */
export function gastoContraOTeto(gasto: GastoDeHoje, moeda: MoedaTeto): GastoMostrado | null {
  if (gasto.limiteCentavos === null) return null;
  const limite = dinheiro(gasto.limiteCentavos, moeda);
  // Teto zero vale sem cotação (nada pago roda): não há o que converter nem o que pedir.
  if (gasto.centavos === null && gasto.limiteCentavos === 0) {
    return {
      texto: `teto de ${limite}`,
      rotulo: `teto de ${limite} hoje: nada pago roda`,
      pct: 100,
      semCotacao: false,
    };
  }
  if (gasto.centavos === null) {
    return {
      texto: "sem cotação",
      rotulo: `teto de ${limite} sem cotação do dólar em ${NOME_DA_MOEDA[moeda]}: não vale até você digitar`,
      pct: null,
      semCotacao: true,
    };
  }
  const usado = dinheiro(gasto.centavos, moeda);
  const pct =
    gasto.limiteCentavos > 0 ? Math.min(100, Math.round((gasto.centavos / gasto.limiteCentavos) * 100)) : 100;
  return {
    texto: `≈ ${usado} de ${limite}`,
    rotulo: `cerca de ${usado} de ${limite} hoje, ${fonteDaEstimativa(gasto)}`,
    pct,
    semCotacao: false,
  };
}
