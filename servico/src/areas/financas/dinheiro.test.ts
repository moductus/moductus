import { describe, expect, test } from "vitest";
import { dividirEmParcelas, ErroDeValor } from "./dinheiro.ts";

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
