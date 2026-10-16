import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { linhasQueViajam, tabelasDoBanco } from "../outro-pc/tabelas.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "notas");
/** O banco da 0.6.0: as migrações até a 012. */
const DA_060 = MIGRACOES.findIndex((m) => m.nome === "execucoes-falha-do-provedor") + 1;

const TABELAS = ["notas", "notas_fts"];
const AGORA = new Date("2026-10-16T12:00:00.000Z");
const INSTANTE = AGORA.toISOString();
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

const ids = (db: DatabaseSync) =>
  (db.prepare("SELECT id FROM notas ORDER BY id").all() as { id: string }[]).map((l) => l.id);

/** O que a busca acha, pelo id da nota. */
const buscar = (db: DatabaseSync, termo: string) =>
  (
    db.prepare("SELECT id FROM notas_fts WHERE notas_fts MATCH ? ORDER BY id").all(termo) as { id: string }[]
  ).map((l) => l.id);

/** Quantas entradas o índice tem de cada nota: uma para a viva, nenhuma para a que saiu. */
const noIndice = (db: DatabaseSync) =>
  db.prepare("SELECT id, count(*) AS n FROM notas_fts GROUP BY id ORDER BY id").all();

const BLOCO_RAPIDO = { id: "bloco_rapido", titulo: "Bloco rápido", conteudo: "", fixada: 1, pasta: null };

const bloco = (db: DatabaseSync) =>
  db.prepare("SELECT id, titulo, conteudo, fixada, pasta FROM notas WHERE id = 'bloco_rapido'").get();

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

const nota = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) => {
  const tudo = { titulo: id, conteudo: "", ...campos };
  const colunas = Object.keys(tudo);
  db.prepare(
    `INSERT INTO notas (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(tudo));
};

describe("migração notas", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com o bloco rápido fixado e já no índice", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    expect(bloco(db)).toEqual(BLOCO_RAPIDO);
    expect(buscar(db, "bloco rapido")).toEqual(["bloco_rapido"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.6.0 sem mexer no que já estava", () => {
    expect(DA_060).toBeLessThan(posicao);
    const pasta = mkdtempSync(join(tmpdir(), "moductus-notas-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, DA_060));
    expect(versaoAtual(antigo)).toBe(DA_060);
    antigo.prepare("UPDATE agentes SET nome = 'Albinha' WHERE id = 'alba'").run();
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(bloco(db)).toEqual(BLOCO_RAPIDO);
    expect(db.prepare("SELECT nome FROM agentes WHERE id = 'alba'").get()).toEqual({ nome: "Albinha" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("nota sem chave estrangeira, marca em 0 ou 1, carimbo de agente com o agente", () => {
    const db = bancoNovo();
    expect(db.prepare("SELECT * FROM pragma_foreign_key_list('notas')").all()).toEqual([]);
    nota(db, "n1", { pasta: "Pessoal", fixada: 1, origem: "agente", agente_id: "alba" });
    expect(() => nota(db, "fixada", { fixada: 2 })).toThrow(/CHECK/);
    expect(() => nota(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);
    expect(() => nota(db, "lixeira", { apagado_em: "2026-10-16T12:00:00Z" })).toThrow(/CHECK/);
    db.prepare("INSERT INTO notas (id) VALUES ('vazia')").run();
    expect(db.prepare("SELECT titulo, conteudo, fixada FROM notas WHERE id = 'vazia'").get()).toEqual({
      titulo: "",
      conteudo: "",
      fixada: 0,
    });
  });

  test('buscar "amanha" acha "amanhã", sem acento nem caixa, no título e no conteúdo', () => {
    const db = bancoNovo();
    nota(db, "lembrar", { titulo: "Lembrar", conteudo: "Ligar pro banco **amanhã** às 15h" });
    nota(db, "onibus", { titulo: "Ônibus da Ação", conteudo: "linha 7" });
    nota(db, "outra", { titulo: "Mercado", conteudo: "pão, café" });
    expect(buscar(db, "amanha")).toEqual(["lembrar"]);
    expect(buscar(db, "AMANHÃ")).toEqual(["lembrar"]);
    expect(buscar(db, "onibus acao")).toEqual(["onibus"]);
    expect(buscar(db, "cafe")).toEqual(["outra"]);
    expect(buscar(db, "pao")).toEqual(["outra"]);
    // O id não é texto da busca: a nota de id "portao" não sai buscando "portao".
    nota(db, "portao", { titulo: "Garagem" });
    expect(buscar(db, "portao")).toEqual([]);
    expect(buscar(db, "rapido")).toEqual(["bloco_rapido"]);
  });

  test("editar troca o texto no índice; mudar só a pasta ou a marca não mexe nele", () => {
    const db = bancoNovo();
    nota(db, "n1", { conteudo: "comprar pão" });
    db.prepare("UPDATE notas SET conteudo = 'comprar café' WHERE id = 'n1'").run();
    expect(buscar(db, "pao")).toEqual([]);
    expect(buscar(db, "cafe")).toEqual(["n1"]);
    db.prepare("UPDATE notas SET titulo = 'Lista da feira' WHERE id = 'n1'").run();
    expect(buscar(db, "feira")).toEqual(["n1"]);
    db.prepare("UPDATE notas SET pasta = 'Casa', fixada = 1 WHERE id = 'n1'").run();
    expect(buscar(db, "cafe")).toEqual(["n1"]);
    expect(noIndice(db)).toEqual([
      { id: "bloco_rapido", n: 1 },
      { id: "n1", n: 1 },
    ]);
  });

  test("mandar à lixeira tira do índice, restaurar põe de volta e apagar de vez tira", () => {
    const db = bancoNovo();
    nota(db, "n1", { conteudo: "ligar amanhã" });
    nota(db, "n2", { conteudo: "pagar amanhã" });
    db.prepare("UPDATE notas SET apagado_em = ? WHERE id = 'n1'").run(INSTANTE);
    expect(buscar(db, "amanha")).toEqual(["n2"]);
    db.prepare("UPDATE notas SET apagado_em = NULL WHERE id = 'n1'").run();
    expect(buscar(db, "amanha")).toEqual(["n1", "n2"]);
    db.prepare("DELETE FROM notas WHERE id = 'n2'").run();
    expect(buscar(db, "amanha")).toEqual(["n1"]);
    // Nota que já chega na lixeira (vinda de outro caminho) não entra.
    nota(db, "n3", { conteudo: "amanhã cedo", apagado_em: INSTANTE });
    expect(buscar(db, "amanha")).toEqual(["n1"]);
    expect(noIndice(db)).toEqual([
      { id: "bloco_rapido", n: 1 },
      { id: "n1", n: 1 },
    ]);
  });

  test("INSERT OR REPLACE e UPDATE OR REPLACE não deixam entrada velha no índice", () => {
    const db = bancoNovo();
    nota(db, "n1", { conteudo: "texto antigo" });
    db.prepare("INSERT OR REPLACE INTO notas (id, titulo, conteudo) VALUES ('n1', 'n1', 'texto novo')").run();
    expect(buscar(db, "antigo")).toEqual([]);
    expect(buscar(db, "novo")).toEqual(["n1"]);
    // Na lixeira por cima da viva: sai do índice.
    db.prepare(
      "INSERT OR REPLACE INTO notas (id, titulo, conteudo, apagado_em) VALUES ('n1', 'n1', 'texto novo', ?)",
    ).run(INSTANTE);
    expect(buscar(db, "novo")).toEqual([]);

    nota(db, "a", { conteudo: "primeira" });
    nota(db, "b", { conteudo: "segunda" });
    db.prepare("UPDATE OR REPLACE notas SET id = 'b' WHERE id = 'a'").run();
    expect(ids(db)).toEqual(["b", "bloco_rapido", "n1"]);
    expect(buscar(db, "segunda")).toEqual([]);
    expect(buscar(db, "primeira")).toEqual(["b"]);
    expect(noIndice(db)).toEqual([
      { id: "b", n: 1 },
      { id: "bloco_rapido", n: 1 },
    ]);
  });

  test("a nota fixa não vai à lixeira nem se apaga; esvaziar é apagar o texto", () => {
    const db = bancoNovo();
    expect(() =>
      db.prepare("UPDATE notas SET apagado_em = ? WHERE id = 'bloco_rapido'").run(INSTANTE),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          "INSERT OR REPLACE INTO notas (id, titulo, fixada, apagado_em) VALUES ('bloco_rapido', 'Bloco rápido', 1, ?)",
        )
        .run(INSTANTE),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("DELETE FROM notas WHERE id = 'bloco_rapido'").run()).toThrow(
      "o bloco rápido não se apaga",
    );
    expect(() => db.prepare("DELETE FROM notas").run()).toThrow("o bloco rápido não se apaga");

    db.prepare("UPDATE notas SET conteudo = 'código do portão 4471' WHERE id = 'bloco_rapido'").run();
    expect(buscar(db, "codigo portao")).toEqual(["bloco_rapido"]);
    db.prepare("UPDATE notas SET conteudo = '' WHERE id = 'bloco_rapido'").run();
    expect(buscar(db, "portao")).toEqual([]);
    expect(bloco(db)).toEqual(BLOCO_RAPIDO);

    // Outra nota fixada vai à lixeira normalmente.
    nota(db, "presa", { fixada: 1 });
    db.prepare("UPDATE notas SET apagado_em = ? WHERE id = 'presa'").run(INSTANTE);
  });

  test("a limpeza leva a nota vencida e tira do índice; o bloco rápido fica", () => {
    const db = bancoNovo();
    nota(db, "vencida", { conteudo: "velha", apagado_em: diasAtras(31) });
    nota(db, "recente", { conteudo: "velha", apagado_em: diasAtras(5) });
    nota(db, "viva", { conteudo: "velha" });

    limparLixeira(db, AGORA);
    expect(ids(db)).toEqual(["bloco_rapido", "recente", "viva"]);
    expect(buscar(db, "velha")).toEqual(["viva"]);
  });

  test("notas viajam como dado, sem a lixeira; o índice não é tabela do arquivo", () => {
    const db = bancoNovo();
    nota(db, "n1", { conteudo: "viaja" });
    nota(db, "n2", { apagado_em: INSTANTE });
    expect(linhasQueViajam(db, "notas").map((l) => l.id)).toEqual(["bloco_rapido", "n1"]);
    expect(tabelasDoBanco(db).filter((t) => t.startsWith("notas"))).toEqual(["notas"]);
  });

  test("as tarefas de uma nota saem pelo índice de `nota_id`", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO tarefas (id, lista_id, titulo, nota_id) VALUES ('t1', 'entrada', 'ligar', 'n1')",
    ).run();
    const plano = (
      db.prepare("EXPLAIN QUERY PLAN SELECT id FROM tarefas WHERE nota_id = ?").all("n1") as {
        detail: string;
      }[]
    ).map((p) => p.detail);
    expect(plano.join(" ")).toContain("tarefas_nota_id");
  });
});
