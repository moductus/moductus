import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agendador-disparos");

describe("migração agendador-disparos", () => {
  test("sobe a partir da anterior com a tabela vazia, uma linha por agente e gatilho", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrar(db, MIGRACOES.slice(0, posicao));
    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT count(*) AS n FROM agendador_disparos").get()).toEqual({ n: 0 });

    const inserir = db.prepare(
      "INSERT INTO agendador_disparos (id, do_agente_id, gatilho, referencia) VALUES (?, ?, ?, ?)",
    );
    const gatilho = JSON.stringify({ tipo: "horario", hora: "08:30" });
    inserir.run("d1", "alba", gatilho, "2026-10-09T11:30:00.000Z");
    inserir.run("d2", "nuno", gatilho, "2026-10-09T11:30:00.000Z");
    expect(() => inserir.run("d3", "alba", gatilho, "2026-10-09T11:30:00.000Z")).toThrow(/UNIQUE/);
  });
});
