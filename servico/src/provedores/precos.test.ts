import { TIPOS_PROVEDOR, TIPOS_PROVEDOR_CLI } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import {
  cobrancaDoTipo,
  custoDaChamada,
  estimarCusto,
  PRECOS_POR_MODELO,
  precoDoModelo,
  type UsoDeChamada,
} from "./precos.ts";
import type { ConfigProvedor } from "./provedor.ts";

const config = (tipo: ConfigProvedor["tipo"], modelo: string | null): ConfigProvedor => ({
  id: "p1",
  tipo,
  modelo,
  baseUrl: null,
  credencial: null,
});

describe("tabela de preços", () => {
  test("todo preço é inteiro em microdólares por milhão, e o de contexto longo nunca é menor", () => {
    for (const [modelo, p] of Object.entries(PRECOS_POR_MODELO)) {
      for (const valor of [p.entrada, p.saida, p.cacheLeitura ?? 0]) {
        expect(Number.isInteger(valor), modelo).toBe(true);
        expect(valor, modelo).toBeGreaterThanOrEqual(0);
      }
      if (p.cacheLeitura !== null) expect(p.cacheLeitura, modelo).toBeLessThan(p.entrada);
      if (p.longo) {
        expect(p.longo.entrada, modelo).toBeGreaterThanOrEqual(p.entrada);
        expect(p.longo.saida, modelo).toBeGreaterThanOrEqual(p.saida);
      }
    }
    // US$ 3 por milhão de tokens.
    expect(PRECOS_POR_MODELO["claude-sonnet-4-5"]).toEqual({
      entrada: 3_000_000,
      cacheLeitura: 300_000,
      saida: 15_000_000,
    });
  });

  test("acha o modelo pelo id como APIs, nuvens e roteadores o escrevem", () => {
    const haiku = PRECOS_POR_MODELO["claude-haiku-4-5"];
    expect(precoDoModelo("claude-haiku-4-5")).toBe(haiku);
    expect(precoDoModelo("claude-haiku-4-5-20251001")).toBe(haiku);
    expect(precoDoModelo("Claude-Haiku-4-5@20251001")).toBe(haiku);
    // Id de nuvem cai no preço global da Anthropic: estimativa, porque o endpoint regional custa
    // 10% a mais e o Moductus não sabe qual endpoint a conta usa.
    expect(precoDoModelo("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(haiku);
    expect(precoDoModelo("global.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(haiku);
    expect(precoDoModelo("anthropic/claude-haiku-4.5")).toBe(haiku);
    expect(precoDoModelo("claude-opus-5-5[1m]")).toBe(PRECOS_POR_MODELO["claude-opus-5-5"]);
    expect(precoDoModelo("openai/gpt-5-mini")).toBe(PRECOS_POR_MODELO["gpt-5-mini"]);
    expect(precoDoModelo("gpt-4o-2024-08-06")).toBe(PRECOS_POR_MODELO["gpt-4o"]);
    // Retrato com preço próprio vale antes do modelo sem data.
    expect(precoDoModelo("gpt-4o-2024-05-13")).toBe(PRECOS_POR_MODELO["gpt-4o-2024-05-13"]);
  });

  test("modelo fora da tabela não tem preço, nem o de um parecido", () => {
    for (const modelo of [
      null,
      undefined,
      "",
      "llama3.1:8b",
      "claude-sonnet-9",
      "gpt-5-mini-turbo",
      "gemini-2.5-pro",
    ]) {
      expect(precoDoModelo(modelo), String(modelo)).toBeNull();
    }
  });
});

describe("custo de uma chamada", () => {
  const sonnet = PRECOS_POR_MODELO["claude-sonnet-4-5"]!;

  test("entrada, saída e a parte lida do cache, cada uma pelo seu preço", () => {
    // 1000 × 3 + 200 × 15 = 6000 µ$; com 800 do cache: 200 × 3 + 800 × 0,3 + 200 × 15 = 3840 µ$.
    expect(custoDaChamada(sonnet, { tokensEntrada: 1000, tokensSaida: 200 })).toBe(6000);
    expect(custoDaChamada(sonnet, { tokensEntrada: 1000, tokensSaida: 200, tokensCacheLidos: 800 })).toBe(
      3840,
    );
    // Cache maior que a entrada não deixa a entrada negativa.
    expect(custoDaChamada(sonnet, { tokensEntrada: 100, tokensSaida: 0, tokensCacheLidos: 500 })).toBe(30);
  });

  test("modelo sem desconto de cache cobra o cache como entrada", () => {
    const pro = PRECOS_POR_MODELO["gpt-5-pro"]!;
    expect(custoDaChamada(pro, { tokensEntrada: 1000, tokensSaida: 0, tokensCacheLidos: 1000 })).toBe(15_000);
  });

  test("contexto longo cobra a chamada inteira pela faixa de cima, só acima do limite", () => {
    const haiku = PRECOS_POR_MODELO["claude-haiku-5-5"]!;
    // 100 mil é o limite: ainda US$ 0,10; um token a mais, US$ 0,50 na entrada e 2,50 na saída.
    expect(custoDaChamada(haiku, { tokensEntrada: 100_000, tokensSaida: 1000 })).toBe(10_000 + 500);
    expect(custoDaChamada(haiku, { tokensEntrada: 100_001, tokensSaida: 1000 })).toBeCloseTo(50_000.5 + 2500);
  });
});

describe("custo de uma execução", () => {
  test("todo CLI é assinatura: grava a marca e nenhum custo, mesmo com modelo de preço conhecido", () => {
    for (const tipo of TIPOS_PROVEDOR_CLI) {
      expect(
        estimarCusto(config(tipo, "claude-haiku-4-5"), [{ tokensEntrada: 1000, tokensSaida: 100 }]),
      ).toEqual({
        cobranca: "assinatura",
        custoEstimadoMicrodolares: null,
      });
    }
    const api = TIPOS_PROVEDOR.filter((t) => !(TIPOS_PROVEDOR_CLI as readonly string[]).includes(t));
    expect(api.map(cobrancaDoTipo)).toEqual(api.map(() => "por_token"));
  });

  test("API soma a estimativa de cada chamada e arredonda só o total", () => {
    const usos: UsoDeChamada[] = [
      // gpt-5-nano: US$ 0,05 entrada, 0,40 saída. 10 × 0,05 + 1 × 0,4 = 0,9 µ$ por chamada.
      { tokensEntrada: 10, tokensSaida: 1 },
      { tokensEntrada: 10, tokensSaida: 1 },
    ];
    expect(estimarCusto(config("openai-compativel", "gpt-5-nano"), usos)).toEqual({
      cobranca: "por_token",
      custoEstimadoMicrodolares: 2,
    });
  });

  test("o modelo que o provedor informa vale antes do configurado", () => {
    expect(
      estimarCusto(config("openai", "gpt-5-nano"), [
        { tokensEntrada: 1000, tokensSaida: 0, modelo: "gpt-4.1" },
      ]),
    ).toEqual({ cobranca: "por_token", custoEstimadoMicrodolares: 2000 });
  });

  test("uma chamada sem preço deixa a execução sem custo; sem chamadas também", () => {
    const api = config("openai-compativel", "gpt-5-mini");
    expect(
      estimarCusto(api, [
        { tokensEntrada: 1000, tokensSaida: 100 },
        { tokensEntrada: 1000, tokensSaida: 100, modelo: "modelo-local" },
      ]),
    ).toEqual({ cobranca: "por_token", custoEstimadoMicrodolares: null });
    expect(estimarCusto(api, [])).toEqual({ cobranca: "por_token", custoEstimadoMicrodolares: null });
    expect(estimarCusto(config("openai-compativel", null), [{ tokensEntrada: 1, tokensSaida: 1 }])).toEqual({
      cobranca: "por_token",
      custoEstimadoMicrodolares: null,
    });
  });
});
