import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { MIGRACOES } from "../migracoes/index.ts";
import { migrar } from "./migracoes.ts";
import { colunasDeOrigem, criarTabela, DO_USUARIO } from "./tabela.ts";

const colunas = (db: DatabaseSync, tabela: string) =>
  (db.prepare("SELECT name FROM pragma_table_info(?)").all(tabela) as { name: string }[]).map((c) => c.name);

/** Tabelas comuns (sem as virtuais do FTS5 nem as internas do SQLite). */
const tabelas = (db: DatabaseSync) =>
  (
    db
      .prepare(
        "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);

/** As duas tabelas que vieram antes da ADR-0011 (fase 1) e são configuração sem origem. */
const VERSAO_ANTES_DA_ORIGEM = 2;

describe("criarTabela", () => {
  test("declara id, datas e origem; a lixeira só quando pedida", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(criarTabela("notas", ["texto TEXT NOT NULL"], { lixeira: false }));
    db.exec(
      criarTabela("tarefas", ["titulo TEXT NOT NULL"], { lixeira: true, restricoes: ["UNIQUE (titulo)"] }),
    );
    const padrao = ["id", "criado_em", "atualizado_em", "origem", "agente_id", "execucao_id"];
    expect(colunas(db, "notas")).toEqual(["id", "texto", ...padrao.slice(1)]);
    expect(colunas(db, "tarefas")).toEqual(["id", "titulo", ...padrao.slice(1), "apagado_em"]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'tarefas_apagado_em'").get(),
    ).toBeDefined();
  });

  test("origem tem valor padrão, lista fechada e agente sempre com agente_id", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(criarTabela("notas", ["texto TEXT NOT NULL"], { lixeira: false }));
    db.prepare("INSERT INTO notas (id, texto) VALUES ('1', 'a')").run();
    const linha = db.prepare("SELECT origem, agente_id, criado_em FROM notas").get() as Record<
      string,
      string
    >;
    expect(linha.origem).toBe("usuario");
    expect(linha.agente_id).toBeNull();
    expect(linha.criado_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(() => db.prepare("INSERT INTO notas (id, texto, origem) VALUES ('2', 'b', 'robo')").run()).toThrow(
      "CHECK",
    );
    expect(() =>
      db.prepare("INSERT INTO notas (id, texto, origem) VALUES ('3', 'c', 'agente')").run(),
    ).toThrow("CHECK");
    const inserir = db.prepare(
      "INSERT INTO notas (id, texto, origem, agente_id, execucao_id) VALUES ('4', 'd', :origem, :agente_id, :execucao_id)",
    );
    inserir.run(colunasDeOrigem({ origem: "agente", agenteId: "alba", execucaoId: null }));
    expect(db.prepare("SELECT origem, agente_id FROM notas WHERE id = '4'").get()).toEqual({
      origem: "agente",
      agente_id: "alba",
    });
  });

  test("o carimbo do usuário e o de importação não levam agente", () => {
    expect(colunasDeOrigem(DO_USUARIO)).toEqual({ origem: "usuario", agente_id: null, execucao_id: null });
    expect(colunasDeOrigem({ origem: "importacao" })).toEqual({
      origem: "importacao",
      agente_id: null,
      execucao_id: null,
    });
    expect(colunasDeOrigem({ origem: "agente", agenteId: "tula", execucaoId: "e1" })).toEqual({
      origem: "agente",
      agente_id: "tula",
      execucao_id: "e1",
    });
  });
});

test("nenhuma tabela criada depois da fase 1 fica sem id, datas e origem", () => {
  const antes = new DatabaseSync(":memory:");
  migrar(antes, MIGRACOES.slice(0, VERSAO_ANTES_DA_ORIGEM));
  const daFase1 = new Set(tabelas(antes));

  const db = new DatabaseSync(":memory:");
  migrar(db, MIGRACOES);
  const exigidas = ["id", "criado_em", "atualizado_em", "origem", "agente_id", "execucao_id"];
  const semOrigem = () =>
    Object.fromEntries(
      tabelas(db)
        .filter((t) => !daFase1.has(t))
        .map((t): [string, string[]] => [t, exigidas.filter((c) => !colunas(db, t).includes(c))])
        .filter(([, faltando]) => faltando.length > 0),
    );
  expect(semOrigem()).toEqual({});

  // A conferência pega tabela feita à mão, fora do criarTabela.
  db.exec("CREATE TABLE feita_a_mao (id TEXT PRIMARY KEY, criado_em TEXT, atualizado_em TEXT)");
  expect(semOrigem()).toEqual({ feita_a_mao: ["origem", "agente_id", "execucao_id"] });
});
