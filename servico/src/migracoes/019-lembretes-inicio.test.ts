import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "lembretes-inicio");

describe("migração lembretes-inicio", () => {
  test("sobe a partir da anterior: o lembrete que já existia fica sem início (vale o quando)", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare(
      "INSERT INTO lembretes (id, texto, quando, recorrencia) VALUES ('l', 'Beber água', '2026-10-18T18:00:00.000Z', 'FREQ=DAILY')",
    ).run();
    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT id, inicio_recorrencia FROM lembretes").all()).toEqual([
      { id: "l", inicio_recorrencia: null },
    ]);
  });

  test("o início só no formato exato do serviço", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    db.prepare(
      "INSERT INTO lembretes (id, texto, quando) VALUES ('l', 'x', '2026-10-18T18:00:00.000Z')",
    ).run();
    const marcar = (valor: string) =>
      db.prepare("UPDATE lembretes SET inicio_recorrencia = ? WHERE id = 'l'").run(valor);
    marcar("2026-10-18T18:00:00.000Z");
    expect(() => marcar("2026-10-18T18:00:00Z")).toThrow(/CHECK/);
  });
});
