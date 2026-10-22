import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DE_FABRICA } from "../agentes/de-fabrica.ts";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "alba-listas");

const ferramentasDa = (db: DatabaseSync, id: string) =>
  JSON.parse(
    (db.prepare("SELECT ferramentas FROM agentes WHERE id = ?").get(id) as { ferramentas: string })
      .ferramentas,
  );

describe("migração alba-listas", () => {
  test("a Alba como veio de fábrica passa a ver as listas; os outros ficam como estão", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    const nuno = ferramentasDa(db, "nuno");
    migrar(db, MIGRACOES);
    expect(ferramentasDa(db, "alba")).toEqual(DE_FABRICA.alba.ferramentas);
    expect(ferramentasDa(db, "alba")).toContain("listas.listar");
    expect(ferramentasDa(db, "nuno")).toEqual(nuno);
  });

  test("a Alba que você personalizou fica como você deixou", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare("UPDATE agentes SET ferramentas = ? WHERE id = 'alba'").run(JSON.stringify(["agenda.*"]));
    migrar(db, MIGRACOES);
    expect(ferramentasDa(db, "alba")).toEqual(["agenda.*"]);
  });
});
