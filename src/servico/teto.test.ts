import type { GastoDeHoje } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  cotacaoEmTexto,
  diaDeHoje,
  dinheiro,
  gastoContraOTeto,
  lerCotacao,
  lerTeto,
  origemDaCotacao,
  valorNoCampo,
} from "./teto.ts";

const GASTO: GastoDeHoje = {
  microdolares: 206_000,
  centavos: 112,
  cotacaoDe: "2026-10-16",
  limiteCentavos: 500,
  liberarCentavos: 100,
  pedeCotacao: false,
};

describe("teto em texto", () => {
  it("dinheiro com o símbolo da moeda e duas casas", () => {
    expect(dinheiro(1000, "BRL")).toBe("R$ 10,00");
    expect(dinheiro(123_456, "USD")).toBe("US$ 1.234,56");
    expect(dinheiro(5, "EUR")).toBe("€ 0,05");
    expect(valorNoCampo(500)).toBe("5,00");
    expect(valorNoCampo(null)).toBe("");
  });

  it("o teto digitado: vazio é sem teto, inválido não passa, vírgula ou ponto na casa decimal", () => {
    expect(lerTeto("")).toBeNull();
    expect(lerTeto("10")).toBe(1000);
    expect(lerTeto("10,5")).toBe(1050);
    expect(lerTeto(" 1.234,56 ")).toBe(123_456);
    expect(lerTeto("10.50")).toBe(1050);
    expect(lerTeto("0")).toBe(0);
    expect(lerTeto("-3")).toBeUndefined();
    expect(lerTeto("10,555")).toBeUndefined();
    expect(lerTeto("dez")).toBeUndefined();
  });

  it("a cotação digitada em milionésimos inteiros; zero não é cotação", () => {
    expect(lerCotacao("5,43")).toBe(5_430_000);
    expect(lerCotacao("5,432123")).toBe(5_432_123);
    expect(lerCotacao("5,4321234")).toBeNull();
    expect(lerCotacao("0")).toBeNull();
    expect(lerCotacao("")).toBeNull();
    expect(cotacaoEmTexto("BRL", 5_432_100)).toBe("US$ 1 = R$ 5,4321");
    expect(origemDaCotacao({ milionesimos: 1, data: "2026-10-16", fonte: "frankfurter" })).toBe(
      "de 16/10, do Frankfurter",
    );
    expect(diaDeHoje(new Date(2026, 9, 8, 23, 59))).toBe("2026-10-08");
  });

  it("o gasto contra o teto sai como estimativa, com a data da cotação; sem cotação, sem número", () => {
    expect(gastoContraOTeto(GASTO, "BRL")).toEqual({
      texto: "≈ R$ 1,12 de R$ 5,00",
      rotulo: "cerca de R$ 1,12 de R$ 5,00 hoje, estimativa pela cotação de 16/10",
      pct: 22,
      semCotacao: false,
    });
    // Em dólar não há cotação, mas o custo continua estimado pela tabela de preços.
    expect(gastoContraOTeto({ ...GASTO, cotacaoDe: null }, "USD")?.rotulo).toBe(
      "cerca de US$ 1,12 de US$ 5,00 hoje, estimativa",
    );
    expect(gastoContraOTeto({ ...GASTO, centavos: null, cotacaoDe: null, pedeCotacao: true }, "EUR")).toEqual(
      {
        texto: "sem cotação",
        rotulo: "teto de € 5,00 sem cotação do dólar em euro: não vale até você digitar",
        pct: null,
        semCotacao: true,
      },
    );
    expect(gastoContraOTeto({ ...GASTO, limiteCentavos: null }, "BRL")).toBeNull();
  });
});
