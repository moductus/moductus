import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const colunas = (db: DatabaseSync) =>
  (db.prepare("PRAGMA table_info(conexoes)").all() as { name: string }[]).map((c) => c.name);

describe("migração 006-conexoes-lida-em", () => {
  test("sobe a partir da 005 com a conexão que já existia, que fica sem leitura", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, 5));
    db.prepare("INSERT INTO conexoes (id, tipo, estado) VALUES ('01', 'github', 'ligada')").run();
    expect(colunas(db)).not.toContain("lida_em");

    expect(migrar(db, MIGRACOES)).toEqual({ de: 5, para: 6 });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(colunas(db)).toContain("lida_em");
    expect(db.prepare("SELECT tipo, lida_em FROM conexoes").get()).toEqual({ tipo: "github", lida_em: null });
  });
});
