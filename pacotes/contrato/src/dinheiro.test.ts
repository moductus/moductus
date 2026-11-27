import { describe, expect, test } from "vitest";
import {
  falarCentavos,
  formatarCentavos,
  lerValor,
  MOEDA_PADRAO,
  nomeDaMoeda,
  simboloDaMoeda,
} from "./dinheiro.ts";

describe("formatar centavos", () => {
  test("real por padrão, milhar com ponto e duas casas com vírgula", () => {
    expect(MOEDA_PADRAO).toBe("BRL");
    expect(formatarCentavos(123_456)).toBe("R$ 1.234,56");
    expect(formatarCentavos(4500)).toBe("R$ 45,00");
    expect(formatarCentavos(5)).toBe("R$ 0,05");
    expect(formatarCentavos(99)).toBe("R$ 0,99");
    expect(formatarCentavos(100_000)).toBe("R$ 1.000,00");
  });

  test("zero sem sinal, nem com o sinal pedido", () => {
    expect(formatarCentavos(0)).toBe("R$ 0,00");
    expect(formatarCentavos(0, { sinal: true })).toBe("R$ 0,00");
    expect(formatarCentavos(-0)).toBe("R$ 0,00");
  });

  test("negativo é saída, com o sinal de menos antes do símbolo; entrada com + só quando pedido", () => {
    expect(formatarCentavos(-13_218)).toBe("− R$ 132,18");
    expect(formatarCentavos(-123_456_789)).toBe("− R$ 1.234.567,89");
    expect(formatarCentavos(486_000, { sinal: true })).toBe("+ R$ 4.860,00");
    expect(formatarCentavos(-2390, { sinal: true })).toBe("− R$ 23,90");
  });

  test("valor grande até o maior inteiro seguro, sem perder centavo", () => {
    expect(formatarCentavos(123_456_789_012_34)).toBe("R$ 123.456.789.012,34");
    expect(formatarCentavos(Number.MAX_SAFE_INTEGER)).toBe("R$ 90.071.992.547.409,91");
    expect(formatarCentavos(-Number.MAX_SAFE_INTEGER)).toBe("− R$ 90.071.992.547.409,91");
    // Perto do limite, 100k − 1 dividido por 100 em ponto flutuante arredondaria para k.
    expect(formatarCentavos(9_007_199_254_740_899)).toBe("R$ 90.071.992.547.408,99");
  });

  test("sem centavos quando pedido, arredondando meio para cima", () => {
    expect(formatarCentavos(321_477, { semCentavos: true })).toBe("R$ 3.215");
    expect(formatarCentavos(321_449, { semCentavos: true })).toBe("R$ 3.214");
    expect(formatarCentavos(150, { semCentavos: true })).toBe("R$ 2");
    expect(formatarCentavos(-150, { semCentavos: true })).toBe("− R$ 2");
    expect(formatarCentavos(60_000, { semCentavos: true })).toBe("R$ 600");
    // O que arredonda para zero não mostra sinal.
    expect(formatarCentavos(-40, { semCentavos: true, sinal: true })).toBe("R$ 0");
  });

  test("na moeda da conta, com o símbolo do pt-BR; sem símbolo para o campo", () => {
    expect(formatarCentavos(123_456, { moeda: "USD" })).toBe("US$ 1.234,56");
    expect(formatarCentavos(500, { moeda: "EUR" })).toBe("€ 5,00");
    expect(formatarCentavos(-500, { moeda: "GBP" })).toBe("− £ 5,00");
    expect(formatarCentavos(123_456, { semSimbolo: true })).toBe("1.234,56");
    expect(formatarCentavos(-4500, { semSimbolo: true })).toBe("−45,00");
    expect(simboloDaMoeda("brl")).toBe("R$");
    expect(simboloDaMoeda("CHF")).toBe("CHF");
    expect(simboloDaMoeda("real")).toBe("REAL");
  });

  test("centavo que não é inteiro não vira texto", () => {
    expect(() => formatarCentavos(10.5)).toThrow(RangeError);
    expect(() => formatarCentavos(Number.NaN)).toThrow(RangeError);
    expect(() => formatarCentavos(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("ler o valor digitado", () => {
  test("vírgula decimal, milhar com ponto, inteiro e o símbolo do real", () => {
    expect(lerValor("1.234,56")).toBe(123_456);
    expect(lerValor("45")).toBe(4500);
    expect(lerValor("45,9")).toBe(4590);
    expect(lerValor("45,90")).toBe(4590);
    expect(lerValor("R$ 12")).toBe(1200);
    expect(lerValor("r$12,5")).toBe(1250);
    expect(lerValor(" 1234,5 ")).toBe(123_450);
    expect(lerValor("12.345.678,90")).toBe(1_234_567_890);
  });

  test("ponto decimal só com até duas casas; com três é milhar", () => {
    expect(lerValor("45.90")).toBe(4590);
    expect(lerValor("45.9")).toBe(4590);
    expect(lerValor("1.234")).toBe(123_400);
    expect(lerValor("1234.567")).toBeNull();
  });

  test("zero e negativo são lidos; quem não aceita confere", () => {
    expect(lerValor("0")).toBe(0);
    expect(lerValor("0,00")).toBe(0);
    expect(lerValor("-0")).toBe(0);
    expect(lerValor("-45")).toBe(-4500);
    expect(lerValor("−1.234,56")).toBe(-123_456);
    expect(lerValor("-R$ 12")).toBe(-1200);
    expect(lerValor("R$ -12")).toBe(-1200);
    expect(lerValor("+45")).toBe(4500);
  });

  test("valor grande até o maior inteiro seguro; além dele, não", () => {
    expect(lerValor("90.071.992.547.409,91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(lerValor("90.071.992.547.409,92")).toBeNull();
    expect(lerValor("99999999999999999999")).toBeNull();
  });

  test("entrada inválida", () => {
    for (const texto of [
      "",
      "   ",
      "R$",
      "dez",
      "45,",
      ",50",
      "45,555",
      "10,5.0",
      "1.000,5.",
      "1.23.4",
      "12a",
      "--12",
      "-R$-12",
      "45 reais",
      "1,234.56",
    ]) {
      expect(lerValor(texto), texto).toBeNull();
    }
  });

  test("o que sai formatado volta igual", () => {
    for (const centavos of [0, 5, 4590, -13_218, 123_456, -123_456_789, Number.MAX_SAFE_INTEGER]) {
      expect(lerValor(formatarCentavos(centavos))).toBe(centavos);
      expect(lerValor(formatarCentavos(centavos, { sinal: true }))).toBe(centavos);
      expect(lerValor(formatarCentavos(centavos, { semSimbolo: true }))).toBe(centavos);
    }
  });
});

describe("falar centavos", () => {
  test("real em palavras, com o sinal da tela", () => {
    expect(falarCentavos(-4500)).toBe("menos 45 reais");
    expect(falarCentavos(4500)).toBe("45 reais");
    expect(falarCentavos(1000, { sinal: true })).toBe("mais 10 reais");
    expect(falarCentavos(-1000, { sinal: true })).toBe("menos 10 reais");
    expect(falarCentavos(123_456)).toBe("1.234 reais e 56 centavos");
    expect(falarCentavos(100)).toBe("1 real");
    expect(falarCentavos(101)).toBe("1 real e 1 centavo");
    expect(falarCentavos(-1)).toBe("menos 1 centavo");
    expect(falarCentavos(0, { sinal: true })).toBe("0 reais");
    expect(falarCentavos(Number.MAX_SAFE_INTEGER)).toBe("90.071.992.547.409 reais e 91 centavos");
  });

  test("sem centavos arredonda como a tela e zero arredondado não leva sinal", () => {
    expect(falarCentavos(123_456, { semCentavos: true })).toBe("1.235 reais");
    expect(falarCentavos(123_449, { semCentavos: true })).toBe("1.234 reais");
    expect(falarCentavos(-40, { semCentavos: true })).toBe("0 reais");
    expect(formatarCentavos(-40, { semCentavos: true })).toBe("R$ 0");
  });

  test("outra moeda pelo nome, no singular ou no plural", () => {
    expect(falarCentavos(-1999, { moeda: "USD" })).toBe("menos 19,99 dólares americanos");
    expect(falarCentavos(100, { moeda: "eur", semCentavos: true })).toBe("1 euro");
    expect(falarCentavos(100, { moeda: "EUR" })).toBe("1,00 euro");
    expect(nomeDaMoeda("EUR", true)).toBe("euros");
    expect(nomeDaMoeda("XX1", false)).toBe("XX1");
  });

  test("recusa o que não é centavo inteiro", () => {
    expect(() => falarCentavos(1.5)).toThrow(RangeError);
  });
});
