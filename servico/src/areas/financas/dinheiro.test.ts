import { describe, expect, test } from "vitest";
import { dividirEmParcelas, ErroDeValor, proporcional } from "./dinheiro.ts";

describe("proporcional", () => {
  test("arredonda meio-para-cima uma vez, no inteiro", () => {
    // R$ 100,02 × 7 ÷ 28 = 2500,5 centavos → 2501; R$ 100,01 × 7 ÷ 28 = 2500,25 → 2500.
    expect(proporcional(10_002, 7, 28)).toBe(2501);
    expect(proporcional(10_001, 7, 28)).toBe(2500);
    expect(proporcional(240_000, 7, 28)).toBe(60_000);
    // Percentual: R$ 1.280 de R$ 1.200 dá 106,67% → 107.
    expect(proporcional(128_000, 100, 120_000)).toBe(107);
    expect(proporcional(0, 7, 31)).toBe(0);
  });

  test("não perde precisão perto do maior inteiro seguro", () => {
    expect(proporcional(Number.MAX_SAFE_INTEGER, 31, 31)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("recusa negativo, fração e divisão por zero", () => {
    expect(() => proporcional(-1, 7, 28)).toThrow(ErroDeValor);
    expect(() => proporcional(1.5, 7, 28)).toThrow(ErroDeValor);
    expect(() => proporcional(100, 7, 0)).toThrow(ErroDeValor);
  });
});

describe("dividir em parcelas", () => {
  test("R$ 100,00 em 3 vezes dá 33,34 + 33,33 + 33,33, com o sinal do total", () => {
    expect(dividirEmParcelas(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(dividirEmParcelas(-10_000, 3)).toEqual([-3334, -3333, -3333]);
  });

  test("a soma das parcelas é sempre o total, e a sobra inteira fica na primeira", () => {
    for (const [total, n] of [
      [99_999, 7],
      [-1_234_567, 12],
      [5, 5],
      [101, 10],
    ] as const) {
      const parcelas = dividirEmParcelas(total, n);
      expect(parcelas).toHaveLength(n);
      expect(parcelas.reduce((a, b) => a + b, 0)).toBe(total);
      expect(new Set(parcelas.slice(1)).size).toBeLessThanOrEqual(1);
      expect(Math.abs(parcelas[0] ?? 0) - Math.abs(parcelas[1] ?? 0)).toBeLessThan(n);
    }
  });

  test("recusa total que não chega a um centavo por parcela, e valor que não é centavo inteiro", () => {
    expect(() => dividirEmParcelas(2, 3)).toThrow(ErroDeValor);
    expect(() => dividirEmParcelas(10.5, 2)).toThrow(ErroDeValor);
    expect(() => dividirEmParcelas(100, 0)).toThrow(ErroDeValor);
  });
});
