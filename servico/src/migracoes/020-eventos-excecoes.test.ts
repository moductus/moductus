import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "eventos-excecoes");

const inserir = (db: DatabaseSync, id: string, excecoes?: string) =>
  db
    .prepare(
      `INSERT INTO eventos (id, calendario_id, titulo, inicio, fim${excecoes === undefined ? "" : ", excecoes"})
       VALUES (?, 'local', 'Reunião', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z'${excecoes === undefined ? "" : ", ?"})`,
    )
    .run(...(excecoes === undefined ? [id] : [id, excecoes]));

describe("migração eventos-excecoes", () => {
  test("sobe a partir da anterior: o evento que já existia fica sem exceção e sem fuso", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    inserir(db, "e1");

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT excecoes, fuso FROM eventos WHERE id = 'e1'").get()).toEqual({
      excecoes: "[]",
      fuso: null,
    });
  });

  test("só lista JSON", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "e1", '["2026-10-27T12:00:00.000Z"]');
    expect(() => inserir(db, "e2", '{"a":1}')).toThrow(/CHECK/);
    expect(() => inserir(db, "e3", "2026-10-27")).toThrow(/CHECK/);
    expect(() => inserir(db, "e4", null as unknown as string)).toThrow(/NOT NULL/);
  });

  test("fuso vazio é o do usuário; com nome, até 64 letras", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "e1");
    expect(db.prepare("SELECT fuso FROM eventos WHERE id = 'e1'").get()).toEqual({ fuso: null });
    const mudar = (fuso: string) => db.prepare("UPDATE eventos SET fuso = ? WHERE id = 'e1'").run(fuso);
    mudar("America/New_York");
    expect(() => mudar("")).toThrow(/CHECK/);
    expect(() => mudar("x".repeat(65))).toThrow(/CHECK/);
  });
});
