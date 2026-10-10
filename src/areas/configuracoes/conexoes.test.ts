import type { ItemGithub, SessaoIa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  comandoDoErro,
  eventosDoMoductus,
  leituraGithub,
  linhasDaPrevia,
  resumoGithub,
  ultimoEventoClaude,
} from "./conexoes.ts";

const AGORA = new Date(2026, 9, 10, 14, 0);

const hook = (url: string) => ({ hooks: [{ type: "http", url }] });

describe("prévia da ligação do Claude Code", () => {
  it("conta os eventos que passam a avisar o Moductus, em qualquer porta; os do usuário não", () => {
    const depois = JSON.stringify({
      SessionStart: [hook("http://127.0.0.1:47821/hooks/claude-code")],
      Stop: [
        { hooks: [{ type: "command", command: "echo" }] },
        hook("http://localhost:50000/hooks/claude-code"),
      ],
      Notification: [{ hooks: [{ type: "command", command: "notificar.ps1" }] }],
      PreToolUse: [hook("http://127.0.0.1:47821/outra-coisa")],
    });
    expect(eventosDoMoductus(depois)).toBe(2);
    expect(eventosDoMoductus("{ isto não é json")).toBe(0);
    expect(eventosDoMoductus("[]")).toBe(0);
  });

  it("marca como novas só as linhas que não estavam antes, na ordem do depois", () => {
    const antes = ["{", '  "Stop": [', "    1", "  ]", "}"].join("\n");
    const depois = ["{", '  "SessionStart": [', "    2", "  ],", '  "Stop": [', "    1", "  ]", "}"].join(
      "\n",
    );
    expect(linhasDaPrevia(antes, depois)).toEqual([
      { texto: "{", nova: false },
      { texto: '  "SessionStart": [', nova: true },
      { texto: "    2", nova: true },
      { texto: "  ],", nova: true },
      { texto: '  "Stop": [', nova: false },
      { texto: "    1", nova: false },
      { texto: "  ]", nova: false },
      { texto: "}", nova: false },
    ]);
    // Sem bloco antes, tudo é novo.
    expect(linhasDaPrevia(null, "{\n}").every((l) => l.nova)).toBe(true);
  });
});

describe("resumo das conexões ligadas", () => {
  const item = (mudar: Partial<ItemGithub>): ItemGithub => ({
    id: String(Math.random()),
    repositorio: "voce/api",
    numero: 1,
    tipo: "pr",
    titulo: "x",
    autor: null,
    estado: "aberto",
    meuPapel: "revisor",
    precisaDeMim: true,
    ciEstado: null,
    atualizadoNoGithub: null,
    url: "https://github.com/voce/api/pull/1",
    ...mudar,
  });

  it("PRs que esperam seu review, CI quebrado e issues atribuídas, só dos abertos", () => {
    expect(
      resumoGithub([
        item({}),
        item({}),
        item({ precisaDeMim: false }),
        item({ meuPapel: "autor", ciEstado: "falhou" }),
        item({ tipo: "issue", meuPapel: "atribuido" }),
        item({ tipo: "issue", meuPapel: "atribuido", estado: "fechado" }),
      ]),
    ).toEqual({ esperando: "2 PRs para revisar", codigo: "1 CI quebrado, 1 issue" });
    expect(resumoGithub([])).toEqual({ esperando: "nenhum PR para revisar", codigo: "nada quebrado" });
  });

  it("último evento do Claude Code e as sessões de hoje; sem nenhum, o que fazer", () => {
    const sessao = (iniciadaEm: Date, ultimo: Date, ferramenta: SessaoIa["ferramenta"] = "claude-code") =>
      ({
        id: iniciadaEm.toISOString(),
        projetoId: null,
        ferramenta,
        idExterno: "x",
        modelo: null,
        estado: "trabalhando",
        iniciadaEm: iniciadaEm.toISOString(),
        ultimoEventoEm: ultimo.toISOString(),
        encerradaEm: null,
        contexto: null,
        ultimoEvento: null,
      }) satisfies SessaoIa;
    expect(
      ultimoEventoClaude(
        [
          sessao(new Date(2026, 9, 10, 9), new Date(2026, 9, 10, 13, 58)),
          sessao(new Date(2026, 9, 9, 22), new Date(2026, 9, 10, 1)),
          sessao(new Date(2026, 9, 10, 10), new Date(2026, 9, 10, 13, 59), "codex"),
        ],
        AGORA,
      ),
    ).toBe("há 2 min · 1 sessão hoje");
    expect(ultimoEventoClaude([], AGORA)).toBe("nenhum ainda: abra um terminal novo e rode o claude");
  });

  it("o comando do erro do gh e a leitura do GitHub", () => {
    expect(comandoDoErro("O gh não está conectado a uma conta. Rode gh auth login no terminal.")).toBe(
      "gh auth login",
    );
    expect(comandoDoErro("O GitHub CLI (gh) não está instalado.")).toBeNull();
    expect(comandoDoErro(null)).toBeNull();
    expect(leituraGithub(new Date(2026, 9, 10, 13, 56).toISOString(), AGORA)).toBe(
      "há 4 min · a cada 15 min",
    );
    expect(leituraGithub(null, AGORA)).toBe("ainda não lido · a cada 15 min");
  });
});
