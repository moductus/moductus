import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "sessoes-ponto-de-entrada");

describe("migração sessoes-ponto-de-entrada", () => {
  test("a sessão que já existia fica sem ponto de entrada, e a nova guarda o que o transcript diz", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare(
      "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado) VALUES ('s1', 'claude-code', 'abc', 'terminou')",
    ).run();
    migrar(db, MIGRACOES);
    db.prepare("UPDATE sessoes_ia SET ponto_de_entrada = 'claude-desktop' WHERE id = 's1'").run();
    db.prepare(
      "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado) VALUES ('s2', 'claude-code', 'def', 'terminou')",
    ).run();
    expect(db.prepare("SELECT id, ponto_de_entrada FROM sessoes_ia ORDER BY id").all()).toEqual([
      { id: "s1", ponto_de_entrada: "claude-desktop" },
      { id: "s2", ponto_de_entrada: null },
    ]);
  });
});
