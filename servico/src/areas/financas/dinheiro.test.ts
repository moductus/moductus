import { describe, expect, test } from "vitest";
import { dividirEmParcelas, ErroDeValor, jurosDoMes } from "./dinheiro.ts";

describe("juros do mês", () => {
  test("R$ 6.400,00 a 2,1% dá R$ 134,40; sem juros, zero", () => {
    expect(jurosDoMes(640_000, 210)).toBe(13_440);
    expect(jurosDoMes(640_000, 0)).toBe(0);
    expect(jurosDoMes(0, 210)).toBe(0);
  });

  test("arredonda meio-para-cima no centavo, uma vez", () => {
    // 1,49% de R$ 1.138,27 = 16,960223 → 16,96; de R$ 100,00 a 0,5% = 0,50 exato.
    expect(jurosDoMes(113_827, 149)).toBe(1696);
    expect(jurosDoMes(10_000, 50)).toBe(50);
    // 1% de 50 centavos = 0,5 centavo → 1; de 49 centavos = 0,49 → 0.
    expect(jurosDoMes(50, 100)).toBe(1);
    expect(jurosDoMes(49, 100)).toBe(0);
  });

  test("não perde precisão com saldo perto do maior inteiro seguro", () => {
    // 9.007.199.254.740.991 × 1 bp ÷ 10.000 = 900.719.925.474,0991 → 900.719.925.474.
    expect(jurosDoMes(Number.MAX_SAFE_INTEGER, 1)).toBe(900_719_925_474);
  });

  test("recusa saldo negativo, taxa negativa e valor que não é inteiro", () => {
    expect(() => jurosDoMes(-1, 210)).toThrow(ErroDeValor);
    expect(() => jurosDoMes(100, -1)).toThrow(ErroDeValor);
    expect(() => jurosDoMes(10.5, 210)).toThrow(ErroDeValor);
    expect(() => jurosDoMes(100, 2.1)).toThrow(ErroDeValor);
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
