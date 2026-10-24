import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "rotinas-curta");

describe("migração rotinas-curta", () => {
  test("as rotinas que existiam ficam sem a versão curta; só o briefing pode tê-la", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.exec("UPDATE rotinas SET hora = '07:30', ativa = 0 WHERE id = 'briefing'");
    migrar(db, MIGRACOES);
    expect(db.prepare("SELECT id, hora, ativa, curta FROM rotinas ORDER BY id").all()).toEqual([
      { id: "briefing", hora: "07:30", ativa: 0, curta: 0 },
      { id: "fechamento", hora: "18:00", ativa: 1, curta: 0 },
    ]);
    db.exec("UPDATE rotinas SET curta = 1 WHERE id = 'briefing'");
    expect(() => db.exec("UPDATE rotinas SET curta = 1 WHERE id = 'fechamento'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE rotinas SET curta = 2 WHERE id = 'briefing'")).toThrow(/CHECK/);
  });
});
