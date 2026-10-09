import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

const TABELAS = [
  "agentes",
  "aprovacoes",
  "chamadas_ferramenta",
  "conversas",
  "execucoes",
  "mensagens",
  "provedores",
  "regras_permissao",
];

/** A versão 0.5.0 saiu com as migrações 001 e 002. */
const VERSAO_050 = 2;

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

interface AgenteSemeado {
  id: string;
  nome: string;
  funcao: string;
  personagem: string;
  ferramentas: string;
  estado: string;
  de_fabrica: number;
}

const deFabrica = (db: DatabaseSync) =>
  db
    .prepare("SELECT id, nome, funcao, personagem, ferramentas, estado, de_fabrica FROM agentes ORDER BY id")
    .all() as unknown as AgenteSemeado[];

function conferirTime(db: DatabaseSync) {
  const time = deFabrica(db);
  expect(time.map((a) => [a.id, a.nome, a.funcao])).toEqual([
    ["alba", "Alba", "Cuida do seu dia"],
    ["faina", "Faina", "Faz o serviço pesado"],
    ["nuno", "Nuno", "Fica de olho nas suas IAs e no seu código"],
    ["tula", "Tula", "Cuida do seu dinheiro"],
  ]);
  for (const agente of time) {
    expect(agente.de_fabrica).toBe(1);
    expect(agente.estado).toBe("ativo");
    expect(Object.keys(JSON.parse(agente.personagem))).toEqual(["silhueta", "traco", "tom"]);
    expect((JSON.parse(agente.ferramentas) as string[]).length).toBeGreaterThan(0);
  }
  const nuno = time.find((a) => a.id === "nuno")!;
  expect(JSON.parse(nuno.personagem)).toEqual({ silhueta: "capsula", traco: "fones", tom: "ardosia" });
  expect(JSON.parse(nuno.ferramentas)).toEqual(["sessoes.*", "uso.*", "github.*", "tarefas.criar"]);
}

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

describe("migração 003-agentes", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as tabelas e o time de fábrica", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: 3 });
    expect(tabelas(db)).toEqual(TABELAS);
    conferirTime(db);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.5.0 sem perder o que já estava lá", () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-003-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, VERSAO_050));
    antigo.prepare("INSERT INTO config (chave, valor) VALUES ('tema', '\"grafite\"')").run();
    antigo.prepare("INSERT INTO onboarding (passo, estado) VALUES ('tutorial', 'pendente')").run();
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    conferirTime(db);
    expect(db.prepare("SELECT valor FROM config WHERE chave = 'tema'").get()).toEqual({ valor: '"grafite"' });
    expect(db.prepare("SELECT estado FROM onboarding WHERE passo = 'tutorial'").get()).toEqual({
      estado: "pendente",
    });
    db.close();
  });

  test("agente de fábrica não vai para a lixeira", () => {
    const db = bancoNovo();
    expect(() =>
      db.prepare("UPDATE agentes SET apagado_em = ? WHERE id = 'tula'").run(new Date().toISOString()),
    ).toThrow("CHECK");
    db.prepare(
      "INSERT INTO agentes (id, nome, funcao, personagem, apagado_em) VALUES ('meu', 'Meu', 'x', '{}', ?)",
    ).run(new Date().toISOString());
  });

  test("execução, conversa e aprovação só apontam para agente que existe", () => {
    const db = bancoNovo();
    const execucao = db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado, origem, agente_id) VALUES (?, ?, 'mensagem', 'rodando', 'agente', ?)",
    );
    execucao.run("e1", "nuno", "nuno");
    expect(() => execucao.run("e2", "ninguem", "nuno")).toThrow("FOREIGN KEY");
    expect(() => execucao.run("e3", "nuno", "ninguem")).toThrow("FOREIGN KEY");

    const conversa = db.prepare("INSERT INTO conversas (id, tipo, do_agente_id) VALUES (?, ?, ?)");
    conversa.run("time", "time", null);
    conversa.run("com-nuno", "agente", "nuno");
    expect(() => conversa.run("sem-agente", "agente", null)).toThrow("CHECK");
    expect(() => conversa.run("time-com-agente", "time", "alba")).toThrow("CHECK");

    // O usuário aprova: a origem passa a ser dele, e quem pediu continua registrado.
    db.prepare(
      "INSERT INTO aprovacoes (id, da_execucao_id, do_agente_id, fonte, descricao, acao, origem, agente_id, execucao_id) VALUES ('a1', 'e1', 'nuno', 'moductus', 'Comentar no PR 12', '{}', 'agente', 'nuno', 'e1')",
    ).run();
    db.prepare(
      "UPDATE aprovacoes SET estado = 'aprovada', decidida_em = ?, origem = 'usuario', agente_id = NULL, execucao_id = NULL WHERE id = 'a1'",
    ).run(new Date().toISOString());
    expect(db.prepare("SELECT do_agente_id, da_execucao_id FROM aprovacoes").get()).toEqual({
      do_agente_id: "nuno",
      da_execucao_id: "e1",
    });
    expect(() =>
      db
        .prepare(
          "INSERT INTO aprovacoes (id, fonte, descricao, acao, decidida_em) VALUES ('a2', 'claude-code', 'x', '{}', ?)",
        )
        .run(new Date().toISOString()),
    ).toThrow("CHECK");
  });

  test("conversa apagada com as mensagens sai junto da lixeira; com mensagem viva, fica", () => {
    const db = bancoNovo();
    const agora = new Date("2026-10-09T12:00:00.000Z");
    const vencida = new Date(agora.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const conversa = db.prepare("INSERT INTO conversas (id, tipo, apagado_em) VALUES (?, 'time', ?)");
    conversa.run("apagada", vencida);
    conversa.run("presa", vencida);
    const mensagem = db.prepare(
      "INSERT INTO mensagens (id, conversa_id, conteudo, apagado_em) VALUES (?, ?, 'oi', ?)",
    );
    mensagem.run("m1", "apagada", vencida);
    mensagem.run("m2", "presa", null);

    expect(limparLixeira(db, agora)).toEqual(
      new Map([
        ["conversas", 1],
        ["mensagens", 1],
      ]),
    );
    expect(db.prepare("SELECT id FROM conversas").all()).toEqual([{ id: "presa" }]);
  });
});
