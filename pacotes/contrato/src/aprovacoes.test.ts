import { describe, expect, test } from "vitest";
import { Aprovacao, FonteAprovacao, PedidoDecidir, RegraPermissao } from "./aprovacoes.ts";

const doTerminal = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EK",
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EM",
  descricao: "O Claude Code quer rodar pnpm test em moductus.",
  acao: { ferramenta: "Bash", entrada: { command: "pnpm test" }, rotulo: null, desfazivel: false },
  estado: "pendente",
  criadoEm: "2026-10-09T12:00:00.000Z",
  decididaEm: null,
  regraCriadaId: null,
};

describe("aprovação", () => {
  test("fonte é o Moductus ou uma das ferramentas de sessão", () => {
    expect(FonteAprovacao.options).toEqual([
      "moductus",
      "claude-code",
      "codex",
      "opencode",
      "gemini",
      "antigravity",
    ]);
  });

  test("pedido de uma sessão do terminal, sem agente nem execução, passa", () => {
    expect(Aprovacao.parse(doTerminal)).toEqual(doTerminal);
  });

  test("pedido de agente com rótulo de verbo e objeto passa", () => {
    const daFaina = {
      ...doTerminal,
      fonte: "moductus",
      agenteId: "faina",
      execucaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EN",
      sessaoId: null,
      descricao: "Vou mover 38 arquivos (1,4 GB) para a Lixeira.",
      acao: {
        ferramenta: "arquivos.mover",
        entrada: { ids: [] },
        rotulo: "Mover 38 arquivos",
        desfazivel: true,
      },
    };
    expect(Aprovacao.safeParse(daFaina).success).toBe(true);
  });

  test("estado, fonte e ação fora do contrato são recusados", () => {
    expect(Aprovacao.safeParse({ ...doTerminal, estado: "esquecida" }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, fonte: "cursor" }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, acao: { ferramenta: "Bash" } }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, descricao: "" }).success).toBe(false);
  });

  test("decidir: permitir ou negar, com regra e mensagem opcionais", () => {
    const id = doTerminal.id;
    expect(PedidoDecidir.safeParse({ id, decisao: "permitir", sempre: "projeto" }).success).toBe(true);
    expect(PedidoDecidir.safeParse({ id, decisao: "negar", mensagem: "Agora não" }).success).toBe(true);
    expect(PedidoDecidir.safeParse({ id, decisao: "talvez" }).success).toBe(false);
    expect(PedidoDecidir.safeParse({ id, decisao: "permitir", sempre: "sempre" }).success).toBe(false);
    expect(PedidoDecidir.safeParse({ id, decisao: "negar", mensagem: "  " }).success).toBe(false);
  });
});

describe("regra de permissão", () => {
  const regra = {
    id: "01K79Z6N7Q4W3J5XG2B8C1D0EP",
    escopo: "projeto",
    projetoId: "01K79Z6N7Q4W3J5XG2B8C1D0EQ",
    agenteId: null,
    ferramenta: "Bash",
    padrao: "pnpm test",
    decisao: "permitir",
    criadoEm: "2026-10-09T12:00:00.000Z",
    expiraEm: null,
  };

  test("regra válida passa; escopo e decisão fora da lista não", () => {
    expect(RegraPermissao.safeParse(regra).success).toBe(true);
    expect(RegraPermissao.safeParse({ ...regra, escopo: "global" }).success).toBe(false);
    expect(RegraPermissao.safeParse({ ...regra, decisao: "aprovar" }).success).toBe(false);
    expect(RegraPermissao.safeParse({ ...regra, padrao: "" }).success).toBe(false);
  });
});
