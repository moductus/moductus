import { describe, expect, test } from "vitest";
import { Aprovacao, FonteAprovacao, PedidoDecidir, RegraPermissao } from "./aprovacoes.ts";

const doTerminal = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EK",
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EM",
  descricao: "O Claude Code quer rodar pnpm test em moductus.",
  acao: {
    ferramenta: "Bash",
    entrada: { command: "pnpm test" },
    rotulo: null,
    rotuloRecusar: null,
    desfazivel: false,
  },
  estado: "pendente",
  criadoEm: "2026-10-09T12:00:00.000Z",
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
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

  const daAlba = {
    ...doTerminal,
    fonte: "moductus",
    agenteId: "alba",
    execucaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EN",
    sessaoId: null,
    descricao: "A tarefa X não cabe hoje. Passo para amanhã de manhã?",
    acao: {
      ferramenta: "tarefas.adiar",
      entrada: { id: "01K79Z6N7Q4W3J5XG2B8C1D0EY" },
      rotulo: "Passar para amanhã",
      rotuloRecusar: "Manter",
      desfazivel: true,
    },
  };

  test("pedido de agente com os dois botões de verbo passa", () => {
    expect(Aprovacao.parse(daAlba)).toEqual(daAlba);
  });

  test("pedido de agente sem o rótulo de permitir é recusado; o de recusar pode cair em Negar", () => {
    const semRotulo = Aprovacao.safeParse({ ...daAlba, acao: { ...daAlba.acao, rotulo: null } });
    expect(semRotulo.success).toBe(false);
    expect(semRotulo.error?.issues[0]?.path).toEqual(["acao", "rotulo"]);
    expect(Aprovacao.safeParse({ ...daAlba, acao: { ...daAlba.acao, rotuloRecusar: null } }).success).toBe(
      true,
    );
    expect(Aprovacao.safeParse({ ...daAlba, acao: { ...daAlba.acao, rotuloRecusar: " " } }).success).toBe(
      false,
    );
  });

  test("estado, fonte e ação fora do contrato são recusados", () => {
    expect(Aprovacao.safeParse({ ...doTerminal, estado: "esquecida" }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, fonte: "cursor" }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, acao: { ferramenta: "Bash" } }).success).toBe(false);
    expect(Aprovacao.safeParse({ ...doTerminal, descricao: "" }).success).toBe(false);
    const { admiteSempre: _, ...semAdmiteSempre } = doTerminal;
    expect(Aprovacao.safeParse(semAdmiteSempre).success).toBe(false);
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
