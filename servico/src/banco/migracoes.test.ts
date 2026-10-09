import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { MIGRACOES } from "../migracoes/index.ts";
import { migrar, MigracaoFalhou, versaoAtual, type Migracao } from "./migracoes.ts";

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);

const m = (versao: number, sql: string): Migracao => ({ versao, nome: `m${versao}`, sql });

describe("executor de migrações", () => {
  test("sobe do zero até a última versão", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toContain("config");
    expect(migrar(db, MIGRACOES)).toEqual({ de: MIGRACOES.length, para: MIGRACOES.length });
  });

  test("sobe de uma versão antiga aplicando só o que falta", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, [m(1, "CREATE TABLE a (x INTEGER)")]);
    db.exec("INSERT INTO a VALUES (7)");
    const resultado = migrar(db, [m(1, "CREATE TABLE a (x INTEGER)"), m(2, "CREATE TABLE b (y INTEGER)")]);
    expect(resultado).toEqual({ de: 1, para: 2 });
    expect(tabelas(db)).toEqual(["a", "b"]);
    expect(db.prepare("SELECT x FROM a").get()).toEqual({ x: 7 });
  });

  test("migração com erro não deixa o banco pela metade", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, [m(1, "CREATE TABLE a (x INTEGER)")]);
    const quebrada = m(
      2,
      "CREATE TABLE b (y INTEGER); INSERT INTO a VALUES (1); INSERT INTO nao_existe VALUES (1);",
    );
    expect(() => migrar(db, [m(1, "CREATE TABLE a (x INTEGER)"), quebrada])).toThrow(MigracaoFalhou);
    expect(versaoAtual(db)).toBe(1);
    expect(tabelas(db)).toEqual(["a"]);
    expect(db.prepare("SELECT count(*) AS n FROM a").get()).toEqual({ n: 0 });
  });

  test("recusa lista fora de ordem e banco mais novo que o app", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => migrar(db, [m(2, "SELECT 1")])).toThrow("fora de ordem");
    migrar(db, [m(1, "SELECT 1"), m(2, "SELECT 1")]);
    expect(() => migrar(db, [m(1, "SELECT 1")])).toThrow("mais nova");
  });
});
