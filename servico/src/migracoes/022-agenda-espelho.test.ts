import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agenda-espelho");

const inserir = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) => {
  const linha = { item_tipo: "tarefa", item_id: `t-${id}`, id_externo: `md${id}000`, ...campos };
  const colunas = Object.keys(linha);
  db.prepare(
    `INSERT INTO agenda_espelho (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(linha));
};

describe("migração agenda-espelho", () => {
  test("sobe a partir da anterior, com a tabela vazia", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT count(*) AS n FROM agenda_espelho").get()).toEqual({ n: 0 });
  });

  test("um evento por item, um item por evento; o que foi enviado é objeto JSON", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    inserir(db, "a1", { enviado: '{"titulo":"Dentista"}', etag_externo: '"e1"' });
    expect(db.prepare("SELECT desligado, enviado FROM agenda_espelho WHERE id = 'a1'").get()).toEqual({
      desligado: 0,
      enviado: '{"titulo":"Dentista"}',
    });
    expect(() => inserir(db, "a2", { item_id: "t-a1" })).toThrow(/UNIQUE/);
    expect(() => inserir(db, "a3", { id_externo: "mda1000" })).toThrow(/UNIQUE/);
    // O mesmo id em tipos diferentes são itens diferentes.
    inserir(db, "a4", { item_tipo: "lembrete", item_id: "t-a1" });
    expect(() => inserir(db, "a5", { item_tipo: "nota" })).toThrow(/CHECK/);
    expect(() => inserir(db, "a6", { id_externo: "md1" })).toThrow(/CHECK/);
    expect(() => inserir(db, "a7", { enviado: "[1]" })).toThrow(/CHECK/);
    expect(() => inserir(db, "a8", { enviado: "texto" })).toThrow(/CHECK/);
    expect(() => inserir(db, "a9", { desligado: 2 })).toThrow(/CHECK/);
  });
});
