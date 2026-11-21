import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "provedores-caminho");

const inserir = (db: DatabaseSync, id: string, tipo: string, caminho: string | null) =>
  db
    .prepare("INSERT INTO provedores (id, tipo, nome, caminho) VALUES (?, ?, 'Provedor', ?)")
    .run(id, tipo, caminho);

describe("migração provedores-caminho", () => {
  test("sobe a partir da anterior com o provedor que já existia, que fica sem caminho", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare("INSERT INTO provedores (id, tipo, nome) VALUES ('p0', 'claude-cli', 'Claude Code')").run();

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT caminho FROM provedores WHERE id = 'p0'").get()).toEqual({ caminho: null });
  });

  test("caminho só em provedor de CLI, e nunca vazio", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "p1", "claude-cli", "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd");
    inserir(db, "p2", "codex-cli", null);
    inserir(db, "p3", "openai", null);
    expect(() => inserir(db, "p4", "openai-compativel", "C:\\bin\\x.exe")).toThrow(/CHECK/);
    expect(() => inserir(db, "p5", "claude-cli", "")).toThrow(/CHECK/);
  });
});
