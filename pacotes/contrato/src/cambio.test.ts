import { describe, expect, test } from "vitest";
import { Cambio, CotacaoBuscada, MOEDA_TETO_PADRAO, MoedaComCotacao, PedidoBuscarCotacao } from "./cambio.ts";
import { CONFIG_PADRAO, Config, MudancaConfig } from "./config.ts";

describe("câmbio do teto", () => {
  test("o real é o padrão; o dólar não pede cotação", () => {
    expect(MOEDA_TETO_PADRAO).toBe("BRL");
    expect(MoedaComCotacao.options).not.toContain("USD");
    expect(PedidoBuscarCotacao.safeParse({ moeda: "USD" }).success).toBe(false);
  });

  test("nenhuma cotação vem de fábrica: a configuração padrão não tem número presumido", () => {
    expect(CONFIG_PADRAO.cambio).toEqual({ cotacoes: {} });
    expect(Config.parse(CONFIG_PADRAO)).toEqual(CONFIG_PADRAO);
  });

  test("cotação em milionésimos inteiros, com o dia e a fonte; dólar, zero e fração não passam", () => {
    const cotacao = { milionesimos: 5_432_100, data: "2026-10-16", fonte: "frankfurter" };
    expect(Cambio.parse({ cotacoes: { BRL: cotacao } })).toEqual({ cotacoes: { BRL: cotacao } });
    expect(
      MudancaConfig.safeParse({ cambio: { cotacoes: { EUR: { ...cotacao, fonte: "digitada" } } } }).success,
    ).toBe(true);
    expect(Cambio.safeParse({ cotacoes: { USD: cotacao } }).success).toBe(false);
    expect(Cambio.safeParse({ cotacoes: { BRL: { ...cotacao, milionesimos: 0 } } }).success).toBe(false);
    expect(Cambio.safeParse({ cotacoes: { BRL: { ...cotacao, milionesimos: 5.4 } } }).success).toBe(false);
    expect(Cambio.safeParse({ cotacoes: { BRL: { ...cotacao, data: "16/10/2026" } } }).success).toBe(false);
    expect(
      CotacaoBuscada.safeParse({ moeda: "BRL", milionesimos: 5_432_100, data: "2026-10-16" }).success,
    ).toBe(true);
  });
});
