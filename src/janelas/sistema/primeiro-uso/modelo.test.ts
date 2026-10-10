import { NovoProvedor } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  criadosDepois,
  formatarLatencia,
  FORMULARIO_API_VAZIO,
  novoDaApi,
  situacaoDoCli,
  substituicao,
} from "./modelo.ts";

const claude = {
  tipo: "claude-cli" as const,
  caminho: "C:\\bin\\claude.exe",
  versao: "2.1.287",
  logado: true,
  impedimento: null,
  versaoMinima: null,
};

describe("situação de cada CLI", () => {
  it("sem login ou sem saber o login: só o sem login fica de fora", () => {
    expect(situacaoDoCli("Claude Code", { ...claude, logado: false })).toEqual({
      estado: "sem login",
      tom: "aviso",
      texto: "CLI no PATH, versão 2.1.287 · entre com a sua conta no terminal e procure de novo.",
      escolhivel: false,
    });
    expect(situacaoDoCli("Claude Code", { ...claude, logado: null, versao: null })).toEqual({
      estado: "detectado",
      tom: "sucesso",
      texto: "CLI no PATH",
      escolhivel: true,
    });
  });
});

describe("um modelo só para o time", () => {
  it("o testado substitui os outros criados no passo, nunca a si mesmo", () => {
    expect(substituicao(["a", "b"], "b")).toEqual(["a"]);
    expect(substituicao([], "x")).toEqual([]);
  });

  it("depois do teste: passou, sobra o testado se é do passo; falhou, ele entra na fila de saída", () => {
    expect(criadosDepois(["a"], "b", true, true)).toEqual(["b"]);
    expect(criadosDepois(["a"], "ja-existia", false, true)).toEqual([]);
    expect(criadosDepois(["a"], "b", true, false)).toEqual(["a", "b"]);
    expect(criadosDepois(["a"], "a", false, false)).toEqual(["a"]);
    expect(criadosDepois(["a"], "ja-existia", false, false)).toEqual(["a"]);
  });
});

describe("latência", () => {
  it("em segundos com uma casa, como no quadro", () => {
    expect(formatarLatencia(2100)).toBe("2,1 s");
    expect(formatarLatencia(840)).toBe("0,8 s");
  });
});

describe("chave de API", () => {
  it("OpenAI vai sem endereço; campo vazio não vai", () => {
    const pedido = novoDaApi({
      ...FORMULARIO_API_VAZIO,
      baseUrl: "https://ignorado",
      modelo: " gpt-5-mini ",
    });
    expect(pedido).toEqual({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5-mini" });
    expect(NovoProvedor.safeParse(pedido).success).toBe(true);
  });

  it("compatível leva o host como nome, nunca o endereço inteiro", () => {
    const pedido = novoDaApi({
      tipo: "openai-compativel",
      baseUrl: "https://openrouter.ai/api/v1",
      modelo: "",
      chave: "sk-or",
    });
    expect(pedido).toEqual({
      tipo: "openai-compativel",
      nome: "openrouter.ai",
      baseUrl: "https://openrouter.ai/api/v1",
      chave: "sk-or",
    });
    expect(novoDaApi({ ...FORMULARIO_API_VAZIO, tipo: "openai-compativel", baseUrl: "localhost" }).nome).toBe(
      "Compatível com OpenAI",
    );
  });
});
