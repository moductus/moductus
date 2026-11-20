import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agenda-local");

const tabelas = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (t) => t.name,
  );
const colunas = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);

describe("migração agenda-local", () => {
  test('o que era do Google sai; os eventos do "Moductus" ficam no local; o resto não muda', () => {
    expect(posicao).toBeGreaterThan(0);
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.exec(`
      INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever)
        VALUES ('moductus', 'Moductus', 'google', 'ext-moductus', 1, 1);
      INSERT INTO calendarios (id, nome, fonte, id_externo, ler, token_sincronizacao)
        VALUES ('trabalho', 'Trabalho', 'google', 'ext-trabalho', 1, 'token');
      INSERT INTO eventos (id, calendario_id, titulo, inicio, fim) VALUES
        ('e-local', 'local', 'Dentista', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z');
      INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, id_externo, etag_externo) VALUES
        ('e-moductus', 'moductus', 'Consulta', '2026-10-21T12:00:00.000Z', '2026-10-21T13:00:00.000Z', 'g1', '"1"'),
        ('e-trabalho', 'trabalho', 'Daily', '2026-10-21T12:00:00.000Z', '2026-10-21T12:15:00.000Z', 'g2', '"2"');
      INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, dia_inteiro, id_externo, apagado_em) VALUES
        ('e-trabalho-apagado', 'trabalho', 'Velho', '2026-10-01', '2026-10-02', 1, 'g3', '2026-10-05T00:00:00.000Z');
      INSERT INTO agenda_saida (id, item_tipo, item_id, operacao) VALUES ('s1', 'evento', 'e-moductus', 'mudar');
      INSERT INTO agenda_espelho (id, item_tipo, item_id, id_externo) VALUES ('m1', 'tarefa', 't1', 'md00001');
      INSERT INTO conexoes (id, tipo, estado) VALUES ('c1', 'google-agenda', 'ligada'), ('c2', 'github', 'ligada');
      INSERT INTO notificacoes (id, tipo, titulo, referencia, canal) VALUES
        ('n1', 'erro', 'Não consegui ler', 'conexao:google-agenda', 'windows'),
        ('n2', 'aviso', 'Recriei', 'conexao:google-agenda:moductus', 'windows'),
        ('n3', 'aviso', 'PR pronto', 'github:1', 'windows');
      INSERT INTO lembretes (id, texto, quando, canal) VALUES
        ('l1', 'Remédio', '2026-10-20T12:00:00.000Z', 'calendario'),
        ('l2', 'Postura', '2026-10-20T12:00:00.000Z', 'dock');
    `);

    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);

    expect(db.prepare("SELECT id FROM calendarios").all()).toEqual([{ id: "local" }]);
    expect(
      db.prepare("SELECT id, calendario_id, id_externo, etag_externo FROM eventos ORDER BY id").all(),
    ).toEqual([
      { id: "e-local", calendario_id: "local", id_externo: null, etag_externo: null },
      { id: "e-moductus", calendario_id: "local", id_externo: null, etag_externo: null },
    ]);
    expect(tabelas(db)).not.toContain("agenda_saida");
    expect(tabelas(db)).not.toContain("agenda_espelho");
    expect(colunas(db, "eventos")).not.toContain("excecoes");
    expect(colunas(db, "eventos")).not.toContain("fuso");
    expect(db.prepare("SELECT id FROM conexoes").all()).toEqual([{ id: "c2" }]);
    expect(db.prepare("SELECT id FROM notificacoes").all()).toEqual([{ id: "n3" }]);
    expect(db.prepare("SELECT id, canal FROM lembretes ORDER BY id").all()).toEqual([
      { id: "l1", canal: "windows" },
      { id: "l2", canal: "dock" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
