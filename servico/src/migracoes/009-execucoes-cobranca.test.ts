import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const inserir = (db: DatabaseSync, id: string, cobranca: string | null, custo: number | null) =>
  db
    .prepare(
      `INSERT INTO execucoes (id, do_agente_id, gatilho, estado, custo_estimado_microdolares, cobranca)
       VALUES (?, 'nuno', 'mensagem', 'ok', ?, ?)`,
    )
    .run(id, custo, cobranca);

describe("migração 009-execucoes-cobranca", () => {
  test("sobe a partir da 008 com a execução que já existia, que fica sem cobrança", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, 8));
    db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado) VALUES ('e0', 'nuno', 'mensagem', 'ok')",
    ).run();

    expect(migrar(db, MIGRACOES)).toEqual({ de: 8, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT cobranca FROM execucoes WHERE id = 'e0'").get()).toEqual({ cobranca: null });
  });

  test("assinatura não tem custo; por token tem estimativa ou fica vazio; outro valor não entra", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "e1", "assinatura", null);
    inserir(db, "e2", "por_token", 2600);
    inserir(db, "e3", "por_token", null);
    expect(() => inserir(db, "e4", "assinatura", 2600)).toThrow(/CHECK/);
    expect(() => inserir(db, "e5", "gratis", null)).toThrow(/CHECK/);
    expect(db.prepare("SELECT count(*) AS n FROM execucoes").get()).toEqual({ n: 3 });
  });
});
