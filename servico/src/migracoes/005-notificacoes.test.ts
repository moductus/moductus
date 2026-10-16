import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const TABELAS = ["notificacoes", "notificacoes_preferencias"];

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

describe("migração 005-notificacoes", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as preferências e o histórico de notificações", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  // 2: banco da 0.5.0; 3: com os agentes; 4: com as sessões.
  test.each([2, 3, 4])("sobe a partir do banco na versão %i", (versao) => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-005-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, versao));
    antigo.prepare("INSERT INTO onboarding (passo, estado) VALUES ('tutorial', 'pendente')").run();
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(db.prepare("SELECT estado FROM onboarding WHERE passo = 'tutorial'").get()).toEqual({
      estado: "pendente",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("uma preferência por agente e tipo, e uma geral por tipo que vale para todos", () => {
    const db = bancoNovo();
    const preferencia = db.prepare(
      "INSERT INTO notificacoes_preferencias (id, do_agente_id, tipo, nivel, canal) VALUES (?, ?, ?, ?, 'ambos')",
    );
    preferencia.run("geral", null, "aprovacao", "tudo");
    preferencia.run("do-nuno", "nuno", "aprovacao", "so_o_que_precisa");
    preferencia.run("geral-erro", null, "erro", "nada");
    expect(() => preferencia.run("geral-de-novo", null, "aprovacao", "nada")).toThrow("UNIQUE");
    expect(() => preferencia.run("nuno-de-novo", "nuno", "aprovacao", "nada")).toThrow("UNIQUE");
    expect(() => preferencia.run("nivel", "alba", "lembrete", "algum")).toThrow("CHECK");
    expect(() => preferencia.run("tipo", "alba", "spam", "tudo")).toThrow("CHECK");
  });

  test("a notificação guarda o agente, o canal e quando foi vista", () => {
    const db = bancoNovo();
    const notificacao = db.prepare(
      "INSERT INTO notificacoes (id, do_agente_id, tipo, titulo, referencia, canal, origem, agente_id) VALUES (?, 'nuno', 'aprovacao', 'Comentar no PR 12?', 'aprovacoes:a1', ?, 'agente', 'nuno')",
    );
    notificacao.run("n1", "windows");
    expect(() => notificacao.run("n2", "email")).toThrow("CHECK");
    // O usuário vê: a origem passa a ser dele, e o agente do aviso continua registrado.
    db.prepare(
      "UPDATE notificacoes SET vista_em = ?, origem = 'usuario', agente_id = NULL WHERE id = 'n1'",
    ).run(new Date().toISOString());
    expect(db.prepare("SELECT do_agente_id, referencia FROM notificacoes").get()).toEqual({
      do_agente_id: "nuno",
      referencia: "aprovacoes:a1",
    });
  });
});
