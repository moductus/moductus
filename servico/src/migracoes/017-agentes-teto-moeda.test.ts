import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agentes-teto-moeda");

const mudar = (db: DatabaseSync, sql: string) =>
  db.prepare(`UPDATE agentes SET ${sql} WHERE id = 'nuno'`).run();

describe("migração agentes-teto-moeda", () => {
  test("sobe a partir da anterior: o agente que já existia fica em real, sem nada liberado", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    mudar(db, "estado = 'dormindo', motivo_sono = 'teto'");

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(
      db
        .prepare(
          "SELECT teto_moeda, teto_liberado_centavos, teto_liberado_ate, motivo_sono FROM agentes WHERE id = 'nuno'",
        )
        .get(),
    ).toEqual({
      teto_moeda: "BRL",
      teto_liberado_centavos: null,
      teto_liberado_ate: null,
      motivo_sono: "teto",
    });
  });

  test("moeda no formato ISO; liberado só com teto, positivo e junto com o fim", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    mudar(db, "teto_moeda = 'USD'");
    expect(() => mudar(db, "teto_moeda = 'real'")).toThrow(/CHECK/);
    expect(() => mudar(db, "teto_moeda = NULL")).toThrow(/NOT NULL/);
    // Sem teto, nada a liberar.
    expect(() =>
      mudar(db, "teto_liberado_centavos = 200, teto_liberado_ate = '2026-10-19T03:00:00.000Z'"),
    ).toThrow(/CHECK/);
    mudar(
      db,
      "teto_diario_centavos = 1000, teto_liberado_centavos = 200, teto_liberado_ate = '2026-10-19T03:00:00.000Z'",
    );
    expect(() => mudar(db, "teto_liberado_ate = NULL")).toThrow(/CHECK/);
    expect(() => mudar(db, "teto_liberado_centavos = 0")).toThrow(/CHECK/);
    // O fim é instante exato, com milissegundos e Z, para a comparação como texto valer.
    expect(() => mudar(db, "teto_liberado_ate = '2026-10-19'")).toThrow(/CHECK/);
    expect(() => mudar(db, "teto_liberado_ate = '2026-10-19T03:00:00Z'")).toThrow(/CHECK/);
    mudar(db, "teto_liberado_centavos = NULL, teto_liberado_ate = NULL");
  });
});
