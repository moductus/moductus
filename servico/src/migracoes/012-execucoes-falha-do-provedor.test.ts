import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "execucoes-falha-do-provedor");

const inserir = (db: DatabaseSync, id: string, estado: string, falha: string | null) =>
  db
    .prepare(
      `INSERT INTO execucoes (id, do_agente_id, gatilho, estado, erro, falha_do_provedor)
       VALUES (?, 'tula', 'mensagem', ?, 'Not logged in', ?)`,
    )
    .run(id, estado, falha);

describe("migração execucoes-falha-do-provedor", () => {
  test("sobe a partir da anterior com a execução que falhou, que fica sem motivo", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado, erro) VALUES ('e0', 'tula', 'mensagem', 'erro', 'x')",
    ).run();

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT falha_do_provedor FROM execucoes WHERE id = 'e0'").get()).toEqual({
      falha_do_provedor: null,
    });
  });

  test("motivo só em execução com erro e só dos que o classificador do provedor conhece", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "e1", "erro", "credencial");
    inserir(db, "e2", "erro", null);
    expect(() => inserir(db, "e3", "ok", "credencial")).toThrow(/CHECK/);
    expect(() => inserir(db, "e4", "erro", "teto")).toThrow(/CHECK/);
  });
});
