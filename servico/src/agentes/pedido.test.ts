import { describe, expect, test } from "vitest";
import type { MensagemModelo } from "../provedores/provedor.ts";
import { historicoCurto, montarInstrucoes, resumir, VOZ_DA_FAMILIA } from "./pedido.ts";

const fala = (texto: string, papel: MensagemModelo["papel"] = "usuario"): MensagemModelo => ({
  papel,
  texto,
});

describe("pedido ao modelo", () => {
  test("instruções do agente vêm antes da voz da família; sem instrução, a função ocupa o lugar", () => {
    expect(
      montarInstrucoes({ nome: "Nuno", funcao: "Cuida do código", instrucoes: "  Você é o Nuno. " }),
    ).toBe(`Você é o Nuno.\n\n${VOZ_DA_FAMILIA}`);
    expect(montarInstrucoes({ nome: "Nuno", funcao: "Cuida do código", instrucoes: "" })).toBe(
      `Você é Nuno. Cuida do código.\n\n${VOZ_DA_FAMILIA}`,
    );
  });

  test("histórico curto fica com as últimas falas que cabem, na ordem da conversa", () => {
    const conversa = ["um", "dois", "três", "quatro"].map((t) => fala(t));
    expect(historicoCurto(conversa, { mensagens: 2, caracteres: 100 }).map((m) => m.texto)).toEqual([
      "três",
      "quatro",
    ]);
    // "quatro" (6) + "três" (4) = 10 cabe; com "dois", passa de 12.
    expect(historicoCurto(conversa, { mensagens: 10, caracteres: 12 }).map((m) => m.texto)).toEqual([
      "três",
      "quatro",
    ]);
  });

  test("a última fala sempre vai, mesmo maior que o limite", () => {
    const longa = fala("x".repeat(50));
    expect(historicoCurto([fala("antes"), longa], { mensagens: 5, caracteres: 10 })).toEqual([longa]);
    expect(historicoCurto([])).toEqual([]);
  });

  test("resumo numa linha, cortado com reticências; vazio é null", () => {
    expect(resumir("  Dois PRs\n esperam   você. ")).toBe("Dois PRs esperam você.");
    expect(resumir(" \n ")).toBeNull();
    const cortado = resumir("palavra ".repeat(60))!;
    expect(cortado.length).toBeLessThanOrEqual(200);
    expect(cortado.endsWith("…")).toBe(true);
  });
});
