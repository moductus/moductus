import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { nomeChave } from "../banco/nome-chave.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "tarefas");

const TABELAS = ["etiquetas", "lembretes", "listas", "tarefa_etiquetas", "tarefas"];
const AGORA = new Date("2026-10-16T12:00:00.000Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

const listas = (db: DatabaseSync) =>
  db.prepare("SELECT id, nome, ordem, arquivada FROM listas ORDER BY ordem").all();

const ids = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all() as { id: string }[]).map((l) => l.id);

const PADROES = [
  { id: "entrada", nome: "Entrada", ordem: 0, arquivada: 0 },
  { id: "trabalho", nome: "Trabalho", ordem: 1, arquivada: 0 },
  { id: "pessoal", nome: "Pessoal", ordem: 2, arquivada: 0 },
];

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

const tarefa = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) => {
  const linha = { lista_id: "entrada", titulo: id, ...campos };
  const colunas = Object.keys(linha);
  db.prepare(
    `INSERT INTO tarefas (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(linha));
};

/** Como o serviço grava: o nome e a chave dele. */
const etiqueta = (db: DatabaseSync, id: string, nome: string, apagadoEm: string | null = null) => {
  db.prepare("INSERT INTO etiquetas (id, nome, nome_chave, apagado_em) VALUES (?, ?, ?, ?)").run(
    id,
    nome,
    nomeChave(nome),
    apagadoEm,
  );
};

describe("migração tarefas", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as três listas padrão e as chaves conferidas", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    expect(listas(db)).toEqual(PADROES);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.6.0 sem mexer no que já estava", () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-tarefas-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, posicao));
    expect(versaoAtual(antigo)).toBe(posicao);
    antigo.prepare("UPDATE agentes SET nome = 'Albinha' WHERE id = 'alba'").run();
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(listas(db)).toEqual(PADROES);
    expect(db.prepare("SELECT nome FROM agentes WHERE id = 'alba'").get()).toEqual({ nome: "Albinha" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("só filha com lixeira aponta para pai com lixeira, sem apagar nem mudar linha viva", () => {
    const db = bancoNovo();
    const chaves = TABELAS.flatMap((t) =>
      (
        db
          .prepare('SELECT "from" AS coluna, "table" AS alvo, on_delete FROM pragma_foreign_key_list(?)')
          .all(t) as { coluna: string; alvo: string; on_delete: string }[]
      ).map((fk) => `${t}.${fk.coluna} -> ${fk.alvo} (${fk.on_delete})`),
    );
    expect(chaves.sort()).toEqual([
      "lembretes.tarefa_id -> tarefas (NO ACTION)",
      "tarefas.lista_id -> listas (NO ACTION)",
      "tarefas.tarefa_pai_id -> tarefas (NO ACTION)",
    ]);
    expect(() => tarefa(db, "t1", { lista_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
  });

  test("hora só com o dia, prioridade de 0 a 3, feita com a data e aberta sem ela", () => {
    const db = bancoNovo();
    tarefa(db, "ok", { vence_em: "2026-10-17", hora: "15:00", prioridade: 3, duracao_estimada_min: 30 });
    tarefa(db, "feita", { estado: "feita", concluida_em: AGORA.toISOString() });
    expect(() => tarefa(db, "hora-sem-dia", { hora: "15:00" })).toThrow(/CHECK/);
    expect(() => tarefa(db, "hora-errada", { vence_em: "2026-10-17", hora: "24:00" })).toThrow(/CHECK/);
    expect(() => tarefa(db, "dia-errado", { vence_em: "17/10/2026" })).toThrow(/CHECK/);
    expect(() => tarefa(db, "prioridade", { prioridade: 4 })).toThrow(/CHECK/);
    expect(() => tarefa(db, "estado", { estado: "adiada" })).toThrow(/CHECK/);
    expect(() => tarefa(db, "feita-sem-data", { estado: "feita" })).toThrow(/CHECK/);
    expect(() => tarefa(db, "aberta-com-data", { concluida_em: AGORA.toISOString() })).toThrow(/CHECK/);
    for (const concluida_em of ["2026-10-16T12:00:00Z", "2026-10-16 12:00:00.000", "16/10/2026"]) {
      expect(() => tarefa(db, `feita-${concluida_em}`, { estado: "feita", concluida_em })).toThrow(/CHECK/);
    }
    expect(() => tarefa(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);
  });

  test("subtarefa tem um nível só", () => {
    const db = bancoNovo();
    tarefa(db, "mae");
    tarefa(db, "filha", { tarefa_pai_id: "mae" });
    tarefa(db, "solta");
    expect(() => tarefa(db, "neta", { tarefa_pai_id: "filha" })).toThrow(/um nível/);
    expect(() => db.prepare("UPDATE tarefas SET tarefa_pai_id = 'filha' WHERE id = 'solta'").run()).toThrow(
      /um nível/,
    );
    expect(() => db.prepare("UPDATE tarefas SET tarefa_pai_id = 'solta' WHERE id = 'mae'").run()).toThrow(
      /um nível/,
    );
    expect(() => db.prepare("UPDATE tarefas SET tarefa_pai_id = id WHERE id = 'solta'").run()).toThrow(
      /CHECK/,
    );
    db.prepare("UPDATE tarefas SET tarefa_pai_id = 'solta' WHERE id = 'filha'").run();
    expect(db.prepare("SELECT tarefa_pai_id FROM tarefas WHERE id = 'filha'").get()).toEqual({
      tarefa_pai_id: "solta",
    });
  });

  test("reescrever com INSERT OR REPLACE a mãe de uma subtarefa como subtarefa não passa", () => {
    const db = bancoNovo();
    tarefa(db, "mae");
    tarefa(db, "filha", { tarefa_pai_id: "mae" });
    tarefa(db, "solta");
    expect(() =>
      db
        .prepare(
          "INSERT OR REPLACE INTO tarefas (id, lista_id, titulo, tarefa_pai_id) VALUES ('mae', 'entrada', 'm', 'solta')",
        )
        .run(),
    ).toThrow(/um nível/);
    expect(db.prepare("SELECT tarefa_pai_id FROM tarefas WHERE id = 'mae'").get()).toEqual({
      tarefa_pai_id: null,
    });
  });

  test("com as chaves adiadas, gravar a neta antes da filha não monta dois níveis", () => {
    const db = bancoNovo();
    db.exec("BEGIN");
    db.exec("PRAGMA defer_foreign_keys = ON");
    tarefa(db, "neta2", { tarefa_pai_id: "filha2" });
    expect(() => tarefa(db, "filha2", { tarefa_pai_id: "mae2" })).toThrow(/um nível/);
    db.exec("ROLLBACK");
    expect(ids(db, "tarefas")).toEqual([]);
  });

  test("lembrete: instante no formato das datas, adiado só com a hora nova, disparado com a hora", () => {
    const db = bancoNovo();
    const lembrete = db.prepare(
      "INSERT INTO lembretes (id, texto, quando, estado, disparado_em, adiado_ate, canal) VALUES (?, 'beber água', ?, ?, ?, ?, ?)",
    );
    const quando = "2026-10-16T18:00:00.000Z";
    lembrete.run("agendado", quando, "agendado", null, null, "windows");
    lembrete.run("adiado", quando, "adiado", quando, "2026-10-16T18:10:00.000Z", "dock");
    lembrete.run("perdido", quando, "perdido", null, null, "calendario");
    expect(db.prepare("SELECT canal FROM lembretes WHERE id = 'agendado'").get()).toEqual({
      canal: "windows",
    });
    expect(() => lembrete.run("sem-z", "2026-10-16T18:00:00", "agendado", null, null, "windows")).toThrow(
      /CHECK/,
    );
    for (const fora of ["2026-10-16T18:00:00Z", "2026-10-16 18:00:00.000", "amanhã"]) {
      expect(() => lembrete.run(`disparado-${fora}`, quando, "disparado", fora, null, "windows")).toThrow(
        /CHECK/,
      );
      expect(() => lembrete.run(`adiado-${fora}`, quando, "adiado", null, fora, "windows")).toThrow(/CHECK/);
    }
    expect(() => lembrete.run("adiado-sem-hora", quando, "adiado", null, null, "windows")).toThrow(/CHECK/);
    expect(() =>
      lembrete.run("agendado-adiado", quando, "agendado", null, "2026-10-16T18:10:00.000Z", "windows"),
    ).toThrow(/CHECK/);
    expect(() => lembrete.run("disparado-sem-hora", quando, "disparado", null, null, "windows")).toThrow(
      /CHECK/,
    );
    expect(() => lembrete.run("estado", quando, "feito", null, null, "windows")).toThrow(/CHECK/);
    expect(() => lembrete.run("canal", quando, "agendado", null, null, "email")).toThrow(/CHECK/);
  });

  test("etiqueta viva não repete a chave do nome, nem com outra caixa, acento ou espaço; a da lixeira libera", () => {
    const db = bancoNovo();
    etiqueta(db, "e1", "casa");
    expect(() => etiqueta(db, "e2", "Casa")).toThrow(/UNIQUE/);
    expect(() => etiqueta(db, "e2", " casa ")).toThrow(/UNIQUE/);
    etiqueta(db, "onibus", "ônibus");
    expect(() => etiqueta(db, "e2", "Ônibus")).toThrow(/UNIQUE/);
    etiqueta(db, "ação", "AÇÃO");
    expect(() => etiqueta(db, "e2", "ação")).toThrow(/UNIQUE/);
    expect(() => db.prepare("INSERT INTO etiquetas (id, nome) VALUES ('sem-chave', 'x')").run()).toThrow(
      /NOT NULL/,
    );
    db.prepare("UPDATE etiquetas SET apagado_em = ? WHERE id = 'e1'").run(AGORA.toISOString());
    etiqueta(db, "e3", "Casa");

    tarefa(db, "t1");
    const ligar = db.prepare("INSERT INTO tarefa_etiquetas (id, tarefa_id, etiqueta_id) VALUES (?, ?, ?)");
    ligar.run("l1", "t1", "e3");
    expect(() => ligar.run("l2", "t1", "e3")).toThrow(/UNIQUE/);
  });

  test("a limpeza leva a vencida com subtarefa, lembrete e ligações; a vencida com filha viva fica, com as ligações", () => {
    const db = bancoNovo();
    const lembrete = db.prepare(
      "INSERT INTO lembretes (id, texto, quando, tarefa_id, apagado_em) VALUES (?, 'x', ?, ?, ?)",
    );
    const ligar = db.prepare("INSERT INTO tarefa_etiquetas (id, tarefa_id, etiqueta_id) VALUES (?, ?, ?)");
    const vencida = diasAtras(31);

    // Sai tudo: lista, tarefa, subtarefa e lembrete vencidos, e a etiqueta vencida com as ligações.
    db.prepare("INSERT INTO listas (id, nome, apagado_em) VALUES ('velha', 'Velha', ?)").run(diasAtras(40));
    tarefa(db, "vencida", { lista_id: "velha", apagado_em: vencida });
    tarefa(db, "sub-vencida", { lista_id: "velha", tarefa_pai_id: "vencida", apagado_em: vencida });
    lembrete.run("lb-vencido", AGORA.toISOString(), "vencida", vencida);
    etiqueta(db, "et-viva", "casa");
    etiqueta(db, "et-vencida", "velha", vencida);
    ligar.run("l-da-vencida", "vencida", "et-viva");

    // Fica o que tem filha viva: a lista por uma tarefa, a mãe por uma subtarefa, a tarefa por um
    // lembrete. A ligação da que ficou fica junto.
    db.prepare("INSERT INTO listas (id, nome, apagado_em) VALUES ('presa', 'Presa', ?)").run(diasAtras(40));
    tarefa(db, "viva", { lista_id: "presa" });
    ligar.run("l-da-etiqueta-vencida", "viva", "et-vencida");
    lembrete.run("lb-vivo", AGORA.toISOString(), "viva", null);
    ligar.run("l-viva", "viva", "et-viva");
    tarefa(db, "mae-presa", { apagado_em: vencida });
    tarefa(db, "sub-viva", { tarefa_pai_id: "mae-presa" });
    tarefa(db, "presa-por-lembrete", { apagado_em: vencida });
    lembrete.run("lb-da-presa", AGORA.toISOString(), "presa-por-lembrete", null);
    ligar.run("l-da-presa", "presa-por-lembrete", "et-viva");

    limparLixeira(db, AGORA);
    expect(ids(db, "listas")).toEqual(["entrada", "pessoal", "presa", "trabalho"]);
    expect(ids(db, "tarefas")).toEqual(["mae-presa", "presa-por-lembrete", "sub-viva", "viva"]);
    expect(ids(db, "lembretes")).toEqual(["lb-da-presa", "lb-vivo"]);
    expect(ids(db, "etiquetas")).toEqual(["et-viva"]);
    expect(ids(db, "tarefa_etiquetas")).toEqual(["l-da-presa", "l-viva"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
