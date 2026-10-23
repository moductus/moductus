import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DE_FABRICA } from "../agentes/de-fabrica.ts";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "alba-do-dia");

const instrucoesDa = (db: DatabaseSync, id: string) =>
  (db.prepare("SELECT instrucoes FROM agentes WHERE id = ?").get(id) as { instrucoes: string }).instrucoes;

describe("migração alba-do-dia", () => {
  test("a Alba como veio de fábrica ganha as instruções do dia; os outros ficam como estão", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    const antes = instrucoesDa(db, "alba");
    const nuno = instrucoesDa(db, "nuno");
    migrar(db, MIGRACOES);
    expect(instrucoesDa(db, "alba")).toBe(DE_FABRICA.alba.instrucoes);
    expect(instrucoesDa(db, "alba")).not.toBe(antes);
    expect(instrucoesDa(db, "nuno")).toBe(nuno);
  });

  test("a Alba que você personalizou fica como você deixou", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare("UPDATE agentes SET instrucoes = ? WHERE id = 'alba'").run("Responda sempre curto.");
    migrar(db, MIGRACOES);
    expect(instrucoesDa(db, "alba")).toBe("Responda sempre curto.");
  });
});
