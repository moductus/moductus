import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "provedores-ferramentas");

describe("migração provedores-ferramentas", () => {
  test("o provedor que existia fica sem resposta; só API guarda se chama ferramentas", () => {
    expect(posicao).toBeGreaterThan(0);
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.exec(
      `INSERT INTO provedores (id, tipo, nome, base_url, testado_em)
       VALUES ('p1', 'openai-compativel', 'Modelo local', 'http://localhost:20128/v1', '2026-10-20T10:00:00.000Z')`,
    );
    db.exec("INSERT INTO provedores (id, tipo, nome) VALUES ('p2', 'claude-cli', 'Claude Code')");
    migrar(db, MIGRACOES);

    expect(db.prepare("SELECT id, ferramentas FROM provedores ORDER BY id").all()).toEqual([
      { id: "p1", ferramentas: null },
      { id: "p2", ferramentas: null },
    ]);
    db.exec("UPDATE provedores SET ferramentas = 0 WHERE id = 'p1'");
    expect(() => db.exec("UPDATE provedores SET ferramentas = 2 WHERE id = 'p1'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE provedores SET ferramentas = 1 WHERE id = 'p2'")).toThrow(/CHECK/);
  });
});
