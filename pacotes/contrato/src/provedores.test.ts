import { describe, expect, test } from "vitest";
import {
  enderecoAceitaChave,
  MENSAGEM_CHAVE_SEM_HTTPS,
  MudancaProvedor,
  NovoProvedor,
  PedidoModelosProvedor,
  PedidoTesteProvedor,
  Provedor,
  ProvedorDetectado,
  ResultadoModelosProvedor,
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

  test("teste que passou pode dizer se o modelo usa ferramentas", () => {
    const base = { ok: true, provedorId: ollama.id, latenciaMs: 840, testadoEm: "2026-10-09T12:00:00.000Z" };
    expect(ResultadoTesteProvedor.parse({ ...base, ferramentas: false })).toMatchObject({
      ferramentas: false,
    });
    expect(ResultadoTesteProvedor.safeParse({ ...base, ferramentas: null }).success).toBe(true);
    expect(ResultadoTesteProvedor.safeParse({ ...base, ferramentas: "não" }).success).toBe(false);
  });

  test("a chave só vai por https ou para este PC", () => {
    expect(enderecoAceitaChave("https://openrouter.exemplo/api/v1")).toBe(true);
    expect(enderecoAceitaChave("http://localhost:20128/v1")).toBe(true);
    expect(enderecoAceitaChave("http://127.0.0.1:11434/v1")).toBe(true);
    expect(enderecoAceitaChave("http://127.8.9.10/v1")).toBe(true);
    expect(enderecoAceitaChave("http://[::1]:1234/v1")).toBe(true);
    expect(enderecoAceitaChave(null)).toBe(true);
    expect(enderecoAceitaChave("http://192.168.0.10:11434/v1")).toBe(false);
    expect(enderecoAceitaChave("http://localhost.exemplo.com/v1")).toBe(false);
    expect(enderecoAceitaChave("http://128.0.0.1/v1")).toBe(false);

    const aberto = { tipo: "openai-compativel", nome: "x", baseUrl: "http://192.168.0.10:11434/v1" };
    const recusa = NovoProvedor.safeParse({ ...aberto, chave: "sk-1" });
    expect(recusa.success).toBe(false);
    expect(recusa.error?.issues[0]).toMatchObject({ path: ["chave"], message: MENSAGEM_CHAVE_SEM_HTTPS });
    expect(NovoProvedor.safeParse(aberto).success).toBe(true);
    expect(
      MudancaProvedor.safeParse({ id: ollama.id, baseUrl: "http://192.168.0.10/v1", chave: "sk-1" }).success,
    ).toBe(false);
    expect(
      MudancaProvedor.safeParse({ id: ollama.id, baseUrl: "http://192.168.0.10/v1", chave: null }).success,
    ).toBe(true);
    expect(
      PedidoModelosProvedor.safeParse({
        tipo: "openai-compativel",
        baseUrl: "http://10.0.0.2/v1",
        chave: "sk",
      }).success,
    ).toBe(false);
  });

  test("lista de modelos: só de quem fala a API; endereço ou provedor gravado", () => {
    expect(
      PedidoModelosProvedor.safeParse({ tipo: "openai-compativel", baseUrl: ollama.baseUrl }).success,
    ).toBe(true);
    expect(PedidoModelosProvedor.safeParse({ tipo: "openai", id: ollama.id }).success).toBe(true);
    expect(PedidoModelosProvedor.safeParse({ tipo: "claude-cli" }).success).toBe(false);
    expect(PedidoModelosProvedor.safeParse({ tipo: "openai", chave: "" }).success).toBe(false);
    expect(
      ResultadoModelosProvedor.safeParse({ ok: true, modelos: [{ id: "qwen3:8b", ferramentas: null }] })
        .success,
    ).toBe(true);
    expect(
      ResultadoModelosProvedor.safeParse({ ok: true, modelos: [{ id: "", ferramentas: null }] }).success,
    ).toBe(false);
  });
});
