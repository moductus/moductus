import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

describe("migração 008-uso-respostas-contadas", () => {
  test("sobe a partir da 007 com a tabela vazia, uma linha por resposta", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, 7));
    expect(migrar(db, MIGRACOES)).toEqual({ de: 7, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT count(*) AS n FROM uso_ia_mensagens").get()).toEqual({ n: 0 });

    const inserir = db.prepare("INSERT INTO uso_ia_mensagens (id, chave) VALUES (?, ?)");
    inserir.run("u1", "msg_a\u0000req_a");
    expect(() => inserir.run("u2", "msg_a\u0000req_a")).toThrow(/UNIQUE/);
  });
});
