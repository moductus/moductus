import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const TABELAS = ["conexoes", "eventos_sessao", "github_itens", "projetos", "sessoes_ia", "uso_ia"];

/** A 0.5.0 saiu com as migrações 001 e 002; a 003 trouxe os agentes. */
const VERSAO_050 = 2;
const VERSAO_AGENTES = 3;

const AGORA = new Date("2026-10-09T12:00:00.000Z");
const VENCIDA = new Date(AGORA.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

describe("migração 004-sessoes-dev", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as tabelas de sessões, uso, GitHub e conexões", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test.each([
    ["da 0.5.0", VERSAO_050],
    ["com a 003", VERSAO_AGENTES],
  ])("sobe a partir do banco %s sem perder o que já estava lá", (_, versao) => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-004-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    antigo.exec("PRAGMA foreign_keys = ON");
    migrar(antigo, MIGRACOES.slice(0, versao));
    antigo.prepare("INSERT INTO config (chave, valor) VALUES ('tema', '\"grafite\"')").run();
    if (versao >= VERSAO_AGENTES) {
      antigo.prepare("UPDATE agentes SET nome = 'Nunão' WHERE id = 'nuno'").run();
      antigo
        .prepare(
          "INSERT INTO execucoes (id, do_agente_id, gatilho, estado) VALUES ('e1', 'nuno', 'mensagem', 'ok')",
        )
        .run();
      antigo.prepare("INSERT INTO conversas (id, tipo) VALUES ('time', 'time')").run();
      antigo
        .prepare(
          "INSERT INTO mensagens (id, conversa_id, do_agente_id, conteudo, da_execucao_id) VALUES ('m1', 'time', 'nuno', 'oi', 'e1')",
        )
        .run();
    }
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(db.prepare("SELECT valor FROM config WHERE chave = 'tema'").get()).toEqual({ valor: '"grafite"' });
    if (versao >= VERSAO_AGENTES) {
      expect(db.prepare("SELECT nome FROM agentes WHERE id = 'nuno'").get()).toEqual({ nome: "Nunão" });
      expect(db.prepare("SELECT conteudo FROM mensagens WHERE id = 'm1'").get()).toEqual({ conteudo: "oi" });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("uma sessão por ferramenta e id externo, e o evento sempre de uma sessão que existe", () => {
    const db = bancoNovo();
    const sessao = db.prepare(
      "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado) VALUES (?, ?, ?, 'trabalhando')",
    );
    sessao.run("s1", "claude-code", "abc");
    sessao.run("s2", "codex", "abc");
    expect(() => sessao.run("s3", "claude-code", "abc")).toThrow("UNIQUE");
    expect(() => sessao.run("s4", "cursor", "x")).toThrow("CHECK");
    expect(() =>
      db
        .prepare(
          "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado) VALUES ('s5', 'codex', 'y', 'dormindo')",
        )
        .run(),
    ).toThrow("CHECK");

    const evento = db.prepare("INSERT INTO eventos_sessao (id, sessao_id, tipo) VALUES (?, ?, 'Stop')");
    evento.run("ev1", "s1");
    expect(() => evento.run("ev2", "nenhuma")).toThrow("FOREIGN KEY");
  });

  test("uma pasta é um projeto vivo, sem diferenciar maiúsculas; o apagado libera a pasta", () => {
    const db = bancoNovo();
    const projeto = db.prepare("INSERT INTO projetos (id, nome, caminho, apagado_em) VALUES (?, 'x', ?, ?)");
    projeto.run("p1", "V:\\moductus", null);
    expect(() => projeto.run("p2", "v:\\MODUCTUS", null)).toThrow("UNIQUE");
    db.prepare("UPDATE projetos SET apagado_em = ? WHERE id = 'p1'").run(AGORA.toISOString());
    projeto.run("p3", "V:\\moductus", null);
    expect(db.prepare("SELECT count(*) AS n FROM projetos").get()).toEqual({ n: 2 });
  });

  test("uso tem uma linha por dia, ferramenta, modelo e projeto, mesmo com modelo ou projeto vazio", () => {
    const db = bancoNovo();
    const uso = db.prepare(
      "INSERT INTO uso_ia (id, dia, ferramenta, modelo, projeto_id, tokens_entrada, fonte) VALUES (?, ?, 'claude-code', ?, ?, 10, 'ferramenta')",
    );
    uso.run("u1", "2026-10-09", null, null);
    uso.run("u2", "2026-10-09", "opus", null);
    uso.run("u3", "2026-10-09", null, "p1");
    expect(() => uso.run("u4", "2026-10-09", null, null)).toThrow("UNIQUE");
    expect(() => uso.run("u5", "09/10/2026", null, null)).toThrow("CHECK");
    expect(() =>
      db
        .prepare(
          "INSERT INTO uso_ia (id, dia, ferramenta, tokens_saida, fonte) VALUES ('u6', '2026-10-10', 'codex', -1, 'estimativa')",
        )
        .run(),
    ).toThrow("CHECK");
  });

  test("o GitHub guarda um item por repositório e número", () => {
    const db = bancoNovo();
    const item = db.prepare(
      "INSERT INTO github_itens (id, repositorio, numero, tipo, titulo, estado, meu_papel, url) VALUES (?, 'gustavo/moductus', ?, ?, 'x', 'open', 'autor', 'https://github.com')",
    );
    item.run("g1", 12, "pr");
    expect(() => item.run("g2", 12, "issue")).toThrow("UNIQUE");
    expect(() => item.run("g3", 0, "pr")).toThrow("CHECK");
  });

  test("projeto e conexão apagados há 31 dias saem da lixeira mesmo com sessão e uso apontando", () => {
    const db = bancoNovo();
    db.prepare("INSERT INTO projetos (id, nome, caminho, apagado_em) VALUES ('p1', 'x', 'V:\\x', ?)").run(
      VENCIDA,
    );
    db.prepare(
      "INSERT INTO sessoes_ia (id, projeto_id, ferramenta, id_externo, estado) VALUES ('s1', 'p1', 'claude-code', 'abc', 'terminou')",
    ).run();
    db.prepare(
      "INSERT INTO uso_ia (id, dia, ferramenta, projeto_id, fonte) VALUES ('u1', '2026-09-01', 'claude-code', 'p1', 'ferramenta')",
    ).run();
    db.prepare(
      "INSERT INTO conexoes (id, tipo, credencial, estado, apagado_em) VALUES ('c1', 'github', 'moductus:github', 'ligada', ?)",
    ).run(VENCIDA);

    expect(limparLixeira(db, AGORA)).toEqual(
      new Map([
        ["conexoes", 1],
        ["projetos", 1],
      ]),
    );
    expect(db.prepare("SELECT projeto_id FROM sessoes_ia").get()).toEqual({ projeto_id: "p1" });
    expect(db.prepare("SELECT count(*) AS n FROM uso_ia").get()).toEqual({ n: 1 });
  });
});
