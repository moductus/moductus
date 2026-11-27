import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "rotinas-dias-uteis");

const dias = (db: DatabaseSync) =>
  db.prepare("SELECT id, dias_semana FROM rotinas ORDER BY id").all() as {
    id: string;
    dias_semana: string;
  }[];

/** O banco até antes desta migração, com o que o teste fizer nele, e depois migrado até o fim. */
function migrarDepoisDe(antes: (db: DatabaseSync) => void = () => undefined): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrar(db, MIGRACOES.slice(0, posicao));
  antes(db);
  migrar(db, MIGRACOES);
  return db;
}

describe("migração rotinas-dias-uteis", () => {
  test("banco novo: as duas rotinas nascem de segunda a sexta", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    expect(dias(db)).toEqual([
      { id: "briefing", dias_semana: "[1,2,3,4,5]" },
      { id: "fechamento", dias_semana: "[1,2,3,4,5]" },
    ]);
  });

  test("quem nunca salvou O dia passa de sete dias para segunda a sexta", () => {
    expect(dias(migrarDepoisDe())).toEqual([
      { id: "briefing", dias_semana: "[1,2,3,4,5]" },
      { id: "fechamento", dias_semana: "[1,2,3,4,5]" },
    ]);
  });

  test("os dias que o usuário escolheu ficam", () => {
    const db = migrarDepoisDe((db) =>
      db.exec(
        `UPDATE rotinas SET dias_semana = '[1,2,3,4,5,6]',
           atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second')`,
      ),
    );
    expect(dias(db).map((r) => r.dias_semana)).toEqual(["[1,2,3,4,5,6]", "[1,2,3,4,5,6]"]);
  });

  test("quem já gravou em O dia, mesmo com os sete dias, fica com os sete", () => {
    // Trocou a hora de parar (ou desligou e religou o sábado): a rotina já não é a da semente.
    const db = migrarDepoisDe((db) =>
      db.exec(
        `UPDATE rotinas SET hora = '18:30',
           atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second')
          WHERE id = 'fechamento'`,
      ),
    );
    expect(dias(db).map((r) => r.dias_semana)).toEqual(["[1,2,3,4,5,6,7]", "[1,2,3,4,5,6,7]"]);
  });
});
