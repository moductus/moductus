import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agentes-sono");

const mudar = (db: DatabaseSync, sql: string) =>
  db.prepare(`UPDATE agentes SET ${sql} WHERE id = 'nuno'`).run();

describe("migração agentes-sono", () => {
  test("sobe a partir da anterior com o agente que dormia, que fica sem motivo", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    mudar(db, "estado = 'dormindo', dorme_ate = '2026-10-09T15:00:00.000Z'");

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(
      db.prepare("SELECT estado, motivo_sono, pausado_ate FROM agentes WHERE id = 'nuno'").get(),
    ).toEqual({
      estado: "dormindo",
      motivo_sono: null,
      pausado_ate: null,
    });
  });

  test("motivo só dormindo e dos conhecidos; fim da pausa só pausado", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    mudar(db, "estado = 'dormindo', motivo_sono = 'teto'");
    mudar(db, "estado = 'pausado', motivo_sono = NULL, pausado_ate = '2026-10-09T13:00:00.000Z'");
    expect(() => mudar(db, "estado = 'ativo'")).toThrow(/CHECK/);
    expect(() => mudar(db, "estado = 'ativo', pausado_ate = NULL, motivo_sono = 'limite'")).toThrow(/CHECK/);
    expect(() => mudar(db, "estado = 'dormindo', pausado_ate = NULL, motivo_sono = 'sem_modelo'")).toThrow(
      /CHECK/,
    );
  });
});
