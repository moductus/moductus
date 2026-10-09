import { describe, expect, test } from "vitest";
import {
  Conexao,
  ItemGithub,
  MudancaSessao,
  PedidoUso,
  PreviaConexao,
  SessaoIa,
  SituacaoGithub,
  UsoIa,
} from "./sessoes.ts";

const projeto = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EQ",
  nome: "moductus",
  caminho: "V:\\moductus",
  repositorio: "gustavo/moductus",
  arquivado: false,
};

const sessao = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EM",
  projetoId: projeto.id,
  ferramenta: "claude-code",
  idExterno: "4f1c2e1a-8d7b-4b8e-9a3c-2f0d1e6b7a90",
  modelo: "claude-opus-4-1",
  estado: "esperando",
  iniciadaEm: "2026-10-09T11:00:00.000Z",
  ultimoEventoEm: "2026-10-09T12:00:00.000Z",
  encerradaEm: null,
  contexto: { usadoTokens: 164000, janelaTokens: 200000 },
  ultimoEvento: {
    id: "01K79Z6N7Q4W3J5XG2B8C1D0EW",
    sessaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EM",
    tipo: "PermissionRequest",
    ferramentaUsada: "Bash",
    entradaResumo: "pnpm test",
    recebidoEm: "2026-10-09T12:00:00.000Z",
  },
};

describe("sessão de IA", () => {
  test("sessão esperando você, com contexto e o último evento, passa junto com o projeto", () => {
    expect(MudancaSessao.safeParse({ sessao, projeto }).success).toBe(true);
  });

  test("sem fonte de contexto é null, nunca zero inventado", () => {
    expect(SessaoIa.safeParse({ ...sessao, contexto: null, ultimoEvento: null }).success).toBe(true);
    expect(SessaoIa.safeParse({ ...sessao, contexto: { usadoTokens: 10, janelaTokens: 0 } }).success).toBe(
      false,
    );
  });

  test("sem projeto e sem datas, como a 004 aceita", () => {
    const solta = { ...sessao, projetoId: null, iniciadaEm: null, ultimoEventoEm: null };
    expect(SessaoIa.safeParse(solta).success).toBe(true);
    expect(MudancaSessao.safeParse({ sessao: solta, projeto: null }).success).toBe(true);
    expect(SessaoIa.safeParse({ ...sessao, iniciadaEm: "ontem" }).success).toBe(false);
  });

  test("ferramenta e estado fora da lista são recusados", () => {
    expect(SessaoIa.safeParse({ ...sessao, ferramenta: "cursor" }).success).toBe(false);
    expect(SessaoIa.safeParse({ ...sessao, estado: "ocupada" }).success).toBe(false);
  });
});

describe("uso", () => {
  const uso = {
    dia: "2026-10-09",
    ferramenta: "claude-code",
    modelo: null,
    projetoId: null,
    tokensEntrada: 1200,
    tokensSaida: 300,
    tokensCache: 0,
    custoEstimadoMicrodolares: null,
    fonte: "estimativa",
  };

  test("uso por dia, marcado como estimativa", () => {
    expect(UsoIa.safeParse(uso).success).toBe(true);
    expect(UsoIa.safeParse({ ...uso, dia: "2026-10-09T00:00:00.000Z" }).success).toBe(false);
    expect(UsoIa.safeParse({ ...uso, fonte: "chute" }).success).toBe(false);
  });

  test("período com o primeiro dia antes do último", () => {
    expect(PedidoUso.safeParse({ de: "2026-10-01", ate: "2026-10-09" }).success).toBe(true);
    expect(PedidoUso.safeParse({ de: "2026-10-09", ate: "2026-10-09" }).success).toBe(true);
    expect(PedidoUso.safeParse({ de: "2026-10-09", ate: "2026-10-01" }).success).toBe(false);
  });
});

describe("GitHub", () => {
  const pr = {
    id: "01K79Z6N7Q4W3J5XG2B8C1D0EX",
    repositorio: "gustavo/moductus",
    numero: 142,
    tipo: "pr",
    titulo: "Contrato da fase 2",
    autor: "gustavo",
    estado: "aberto",
    meuPapel: "revisor",
    precisaDeMim: true,
    ciEstado: "falhou",
    atualizadoNoGithub: "2026-10-09T12:00:00.000Z",
    url: "https://github.com/gustavo/moductus/pull/142",
  };

  test("PR esperando seu review com CI quebrado passa", () => {
    expect(SituacaoGithub.safeParse({ itens: [pr], atualizadoEm: null }).success).toBe(true);
  });

  test("número, papel e CI fora do contrato são recusados", () => {
    expect(ItemGithub.safeParse({ ...pr, numero: 0 }).success).toBe(false);
    expect(ItemGithub.safeParse({ ...pr, meuPapel: "dono" }).success).toBe(false);
    expect(ItemGithub.safeParse({ ...pr, ciEstado: "SUCCESS" }).success).toBe(false);
    expect(ItemGithub.safeParse({ ...pr, ciEstado: null }).success).toBe(true);
  });

  test("autor e data do GitHub podem faltar, como a 004 aceita", () => {
    expect(ItemGithub.safeParse({ ...pr, autor: null, atualizadoNoGithub: null }).success).toBe(true);
    expect(ItemGithub.safeParse({ ...pr, atualizadoNoGithub: "ontem" }).success).toBe(false);
  });
});

describe("conexões", () => {
  test("GitHub sem gh explica o que fazer", () => {
    const github = {
      tipo: "github",
      estado: "erro",
      conta: null,
      ultimoErro: "Instale o gh",
      conectadaEm: null,
    };
    expect(Conexao.safeParse(github).success).toBe(true);
    expect(Conexao.safeParse({ ...github, tipo: "gitlab" }).success).toBe(false);
    expect(Conexao.safeParse({ ...github, estado: "quebrada" }).success).toBe(false);
  });

  const hooks = {
    caminho: "C:\\Users\\voce\\.claude\\settings.json",
    trecho: "hooks",
    antes: null,
    depois: '{"PermissionRequest":[]}',
  };

  test("prévia mostra só o bloco que muda, antes e depois, inclusive quando ainda não existe", () => {
    expect(PreviaConexao.safeParse({ tipo: "hooks-claude-code", arquivos: [hooks] }).success).toBe(true);
    expect(
      PreviaConexao.safeParse({ tipo: "hooks-claude-code", arquivos: [{ ...hooks, caminho: "" }] }).success,
    ).toBe(false);
  });

  test("prévia sem o nome do trecho é recusada, e o arquivo inteiro não passa adiante", () => {
    const { trecho: _trecho, ...semTrecho } = hooks;
    expect(PreviaConexao.safeParse({ tipo: "hooks-claude-code", arquivos: [semTrecho] }).success).toBe(false);
    const lida = PreviaConexao.parse({
      tipo: "hooks-claude-code",
      arquivos: [{ ...hooks, conteudo: '{"env":{"TOKEN":"segredo"}}' }],
    });
    expect(lida.arquivos[0]).not.toHaveProperty("conteudo");
  });
});
