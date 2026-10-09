import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { abrirBanco } from "./conexao.ts";
import { limparLixeira, tabelasComLixeira } from "./lixeira.ts";
import { criarTabela } from "./tabela.ts";

const AGORA = new Date("2026-10-09T12:00:00.000Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const ids = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all() as { id: string }[]).map((l) => l.id);

function bancoDeTeste(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(criarTabela("listas", ["nome TEXT NOT NULL"], { lixeira: true }));
  db.exec(criarTabela("tarefas", ["lista_id TEXT NOT NULL REFERENCES listas (id)"], { lixeira: true }));
  db.exec(criarTabela("notas", ["texto TEXT"], { lixeira: false }));
  return db;
}

describe("lixeira", () => {
  test("acha sozinha as tabelas que têm o campo da lixeira", () => {
    expect(tabelasComLixeira(bancoDeTeste())).toEqual(["listas", "tarefas"]);
  });

  test("apaga de vez o que passou de 30 dias e deixa o resto", () => {
    const db = bancoDeTeste();
    const lista = db.prepare("INSERT INTO listas (id, nome, apagado_em) VALUES (?, 'x', ?)");
    lista.run("viva", null);
    lista.run("velha", diasAtras(31));
    lista.run("quase", diasAtras(29));
    lista.run("no-limite", diasAtras(30));

    expect(limparLixeira(db, AGORA)).toEqual(new Map([["listas", 1]]));
    expect(ids(db, "listas")).toEqual(["no-limite", "quase", "viva"]);
    expect(limparLixeira(db, AGORA).size).toBe(0);
  });

  test("filho vencido libera o pai vencido; pai com filho vivo fica", () => {
    const db = bancoDeTeste();
    const lista = db.prepare("INSERT INTO listas (id, nome, apagado_em) VALUES (?, 'x', ?)");
    lista.run("pai-com-filho-vencido", diasAtras(40));
    lista.run("pai-com-filho-vivo", diasAtras(40));
    lista.run("pai-sozinho", diasAtras(40));
    const tarefa = db.prepare("INSERT INTO tarefas (id, lista_id, apagado_em) VALUES (?, ?, ?)");
    tarefa.run("filho-vencido", "pai-com-filho-vencido", diasAtras(35));
    tarefa.run("filho-vivo", "pai-com-filho-vivo", null);

    // "listas" vem antes de "tarefas": a primeira passada acha o pai preso pelo filho.
    expect(limparLixeira(db, AGORA)).toEqual(
      new Map([
        ["listas", 2],
        ["tarefas", 1],
      ]),
    );
    expect(ids(db, "listas")).toEqual(["pai-com-filho-vivo"]);
    expect(ids(db, "tarefas")).toEqual(["filho-vivo"]);
  });

  test("roda na subida do serviço", () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-lixeira-"));
    const primeiro = abrirBanco(pasta);
    primeiro.exec(criarTabela("teste_lixeira", [], { lixeira: true }));
    const inserir = primeiro.prepare("INSERT INTO teste_lixeira (id, apagado_em) VALUES (?, ?)");
    inserir.run("velha", new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString());
    inserir.run("nova", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    primeiro.close();

    const segundo = abrirBanco(pasta);
    expect(ids(segundo, "teste_lixeira")).toEqual(["nova"]);
    segundo.close();
    rmSync(pasta, { recursive: true, force: true });
  });
});
