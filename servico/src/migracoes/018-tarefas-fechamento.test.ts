import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "tarefas-fechamento");

describe("migração tarefas-fechamento", () => {
  test("sobe a partir da anterior: a fechada ganha a marca do atualizado_em, a aberta fica sem", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare(
      `INSERT INTO tarefas (id, lista_id, titulo, estado, concluida_em, atualizado_em) VALUES
       ('a', 'entrada', 'Aberta', 'aberta', NULL, '2026-10-18T12:00:00.000Z'),
       ('f', 'entrada', 'Feita', 'feita', '2026-10-18T12:00:01.000Z', '2026-10-18T12:00:01.000Z'),
       ('c', 'entrada', 'Cancelada', 'cancelada', NULL, '2026-10-18T12:00:02.000Z')`,
    ).run();

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT id, fechada_em, gerada_por FROM tarefas ORDER BY id").all()).toEqual([
      { id: "a", fechada_em: null, gerada_por: null },
      { id: "c", fechada_em: "2026-10-18T12:00:02.000Z", gerada_por: null },
      { id: "f", fechada_em: "2026-10-18T12:00:01.000Z", gerada_por: null },
    ]);
  });

  test("a marca do fechamento só no formato exato do serviço", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    db.prepare("INSERT INTO tarefas (id, lista_id, titulo) VALUES ('t', 'entrada', 'x')").run();
    const marcar = (valor: string) =>
      db.prepare("UPDATE tarefas SET fechada_em = ? WHERE id = 't'").run(valor);
    marcar("2026-10-18T12:00:00.000Z");
    expect(() => marcar("2026-10-18T12:00:00Z")).toThrow(/CHECK/);
    expect(() => marcar("2026-10-18")).toThrow(/CHECK/);
  });
});
