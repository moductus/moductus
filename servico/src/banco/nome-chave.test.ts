import { describe, expect, test } from "vitest";
import { nomeChave } from "./nome-chave.ts";

describe("nomeChave", () => {
  test("iguala caixa com e sem acento e tira o espaço das pontas", () => {
    expect(nomeChave("Casa")).toBe("casa");
    expect(nomeChave("  Ônibus ")).toBe("ônibus");
    expect(nomeChave("AÇÃO")).toBe("ação");
    expect(nomeChave("pr-123")).toBe("pr-123");
  });

  test("o acento decomposto vira o mesmo texto do composto", () => {
    expect(nomeChave("Ônibus")).toBe(nomeChave("ônibus"));
  });

  test("espaço do meio fica", () => {
    expect(nomeChave("Fim  de Semana")).toBe("fim  de semana");
  });
});
