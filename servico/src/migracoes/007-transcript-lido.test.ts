import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const NOVAS = ["transcript_lido_bytes", "transcript_ultima_mensagem", "contexto_avisado_em"];

const colunas = (db: DatabaseSync) =>
  (db.prepare("PRAGMA table_info(sessoes_ia)").all() as { name: string }[]).map((c) => c.name);

describe("migração 007-transcript-lido", () => {
  test("sobe a partir da 006 com a sessão que já existia, que fica sem leitura e sem aviso", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, 6));
    db.prepare(
      "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado) VALUES ('s1', 'claude-code', 'abc', 'terminou')",
    ).run();
    for (const c of NOVAS) expect(colunas(db)).not.toContain(c);

    expect(migrar(db, MIGRACOES)).toEqual({ de: 6, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(
      db
        .prepare(
          "SELECT transcript_lido_bytes, transcript_ultima_mensagem, contexto_avisado_em FROM sessoes_ia",
        )
        .get(),
    ).toEqual({ transcript_lido_bytes: null, transcript_ultima_mensagem: null, contexto_avisado_em: null });
  });

  test("posição de leitura negativa é recusada", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    expect(() =>
      db
        .prepare(
          "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado, transcript_lido_bytes) VALUES ('s1', 'claude-code', 'abc', 'terminou', -1)",
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});
