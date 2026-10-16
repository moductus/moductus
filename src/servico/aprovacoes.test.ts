import type { AcaoAprovacao, Aprovacao } from "@moductus/contrato";
import { describe, expect, it, vi } from "vitest";

vi.mock("./conexao.ts", () => ({ servico: {} }));
const { detalheDoPedido, juntarAprovacao } = await import("./aprovacoes.ts");

const acao = (ferramenta: string, entrada: unknown): AcaoAprovacao => ({
  ferramenta,
  entrada,
  rotulo: null,
  rotuloRecusar: null,
  desfazivel: false,
});

const cartao = (id: string, estado: Aprovacao["estado"] = "pendente"): Aprovacao => ({
  id,
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "s1",
  descricao: "Quer rodar o comando abaixo.",
  acao: acao("Bash", { command: "ls" }),
  estado,
  criadoEm: "2026-10-09T14:31:00.000Z",
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
});

describe("detalhe do pedido", () => {
  it("o comando, o arquivo ou o endereço, inteiros", () => {
    const longo = `pnpm test ${"x".repeat(300)}`;
    expect(detalheDoPedido(acao("Bash", { command: longo, description: "Roda" }))).toBe(longo);
    expect(detalheDoPedido(acao("Edit", { file_path: "V:\\a.ts", old_string: "a" }))).toBe("V:\\a.ts");
    expect(detalheDoPedido(acao("NotebookEdit", { notebook_path: "V:\\n.ipynb" }))).toBe("V:\\n.ipynb");
    expect(detalheDoPedido(acao("WebFetch", { url: "https://exemplo.com", prompt: "?" }))).toBe(
      "https://exemplo.com",
    );
  });

  it("sem campo conhecido, nada", () => {
    expect(detalheDoPedido(acao("mcp__x__y", { a: 1 }))).toBeNull();
    expect(detalheDoPedido(acao("Bash", { command: "  " }))).toBeNull();
    expect(detalheDoPedido(acao("Bash", null))).toBeNull();
  });
});

describe("juntar aviso de aprovação", () => {
  it("troca o que está na tela, acrescenta pendente novo e ignora decidido desconhecido", () => {
    const lista = [cartao("a1"), cartao("a2")];
    expect(juntarAprovacao(lista, cartao("a1", "aprovada")).map((a) => a.estado)).toEqual([
      "aprovada",
      "pendente",
    ]);
    expect(juntarAprovacao(lista, cartao("a3")).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(juntarAprovacao(lista, cartao("a4", "expirada")).map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});
