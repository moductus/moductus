import { describe, expect, test } from "vitest";
import {
  MudancaProvedor,
  NovoProvedor,
  PedidoTesteProvedor,
  Provedor,
  ProvedorDetectado,
  ResultadoTesteProvedor,
  TIPOS_PROVEDOR,
} from "./provedores.ts";

const ollama = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EF",
  tipo: "openai-compativel",
  nome: "Ollama local",
  modelo: "qwen3:8b",
  baseUrl: "http://localhost:11434/v1",
  temChave: false,
  testadoEm: null,
};

describe("provedor", () => {
  test("os mesmos tipos que a migração 003 aceita", () => {
    expect(TIPOS_PROVEDOR).toEqual([
      "claude-cli",
      "codex-cli",
      "gemini-cli",
      "opencode-cli",
      "anthropic",
      "openai",
      "openai-compativel",
      "gemini",
    ]);
  });

  test("provedor válido passa e nunca leva chave nem credencial na saída", () => {
    const lido = Provedor.parse({ ...ollama, chave: "sk-segredo", credencial: "moductus/ollama" });
    expect(lido).toEqual(ollama);
    expect(lido).not.toHaveProperty("chave");
    expect(lido).not.toHaveProperty("credencial");
  });

  test("tipo desconhecido e endereço que não é http são recusados", () => {
    expect(Provedor.safeParse({ ...ollama, tipo: "llama" }).success).toBe(false);
    expect(Provedor.safeParse({ ...ollama, baseUrl: "file:///c:/x" }).success).toBe(false);
    expect(
      NovoProvedor.safeParse({ tipo: "openai-compativel", nome: "x", baseUrl: "localhost" }).success,
    ).toBe(false);
  });

  test("novo provedor com chave; mudança que apaga a chave", () => {
    expect(
      NovoProvedor.safeParse({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5", chave: "sk-1" }).success,
    ).toBe(true);
    expect(NovoProvedor.safeParse({ tipo: "openai", nome: "OpenAI", chave: "" }).success).toBe(false);
    expect(MudancaProvedor.parse({ id: ollama.id, chave: null })).toEqual({ id: ollama.id, chave: null });
    expect(MudancaProvedor.safeParse({ chave: null }).success).toBe(false);
  });

  test("detecção só de CLI", () => {
    const claude = {
      tipo: "claude-cli",
      caminho: "C:\\bin\\claude.exe",
      versao: "2.1.3",
      logado: true,
      impedimento: null,
      versaoMinima: "2.1.257",
    };
    expect(ProvedorDetectado.safeParse(claude).success).toBe(true);
    expect(ProvedorDetectado.safeParse({ ...claude, tipo: "openai" }).success).toBe(false);
    expect(ProvedorDetectado.safeParse({ ...claude, logado: null, versaoMinima: null }).success).toBe(true);
    expect(ProvedorDetectado.safeParse({ ...claude, impedimento: "instalado_pelo_npm" }).success).toBe(true);
    expect(ProvedorDetectado.safeParse({ ...claude, impedimento: "outro" }).success).toBe(false);
    // Sem dizer se o Moductus fala com ele, a tela não sabe se oferece o CLI.
    const { impedimento: _, ...semImpedimento } = claude;
    expect(ProvedorDetectado.safeParse(semImpedimento).success).toBe(false);
  });

  test("teste pode dizer quem o provedor substitui", () => {
    expect(PedidoTesteProvedor.parse({ id: ollama.id })).toEqual({ id: ollama.id });
    expect(PedidoTesteProvedor.safeParse({ id: ollama.id, substitui: [ollama.id] }).success).toBe(true);
    expect(PedidoTesteProvedor.safeParse({ id: ollama.id, substitui: [""] }).success).toBe(false);
    expect(PedidoTesteProvedor.safeParse({ id: ollama.id, substitui: ollama.id }).success).toBe(false);
  });

  test("teste que falhou diz o motivo e quando volta", () => {
    const base = { provedorId: ollama.id, testadoEm: "2026-10-09T12:00:00.000Z" };
    expect(ResultadoTesteProvedor.safeParse({ ...base, ok: true, latenciaMs: 840 }).success).toBe(true);
    expect(
      ResultadoTesteProvedor.safeParse({
        ...base,
        ok: false,
        falha: { motivo: "limite", mensagem: "Limite de uso atingido", voltaEm: "2026-10-09T15:00:00.000Z" },
      }).success,
    ).toBe(true);
    expect(
      ResultadoTesteProvedor.safeParse({
        ...base,
        ok: false,
        falha: { motivo: "desconhecido", mensagem: "?", voltaEm: null },
      }).success,
    ).toBe(false);
    expect(ResultadoTesteProvedor.safeParse({ ...base, ok: true }).success).toBe(false);
  });
});
