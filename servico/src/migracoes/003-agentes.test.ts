import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
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

const AGORA = new Date("2026-10-09T12:00:00.000Z");
const VENCIDA = new Date(AGORA.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

/** O time de fábrica como AGENTS.md §2 e DESIGN.md §6 descrevem. */
const TIME_ESPERADO = {
  alba: {
    nome: "Alba",
    funcao: "Cuida do seu dia",
    personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
    ferramentas: ["agenda.*", "tarefas.*", "lembretes.*", "foco.*", "notas.*", "memoria.*"],
    escopos_memoria: ["dia", "geral"],
  },
  faina: {
    nome: "Faina",
    funcao: "Faz o serviço pesado",
    personagem: { silhueta: "bloco", traco: "bandana", tom: "terracota" },
    ferramentas: ["arquivos.*", "documentos.*", "ocr.ler", "memoria.*"],
    escopos_memoria: ["arquivos", "geral"],
  },
  nuno: {
    nome: "Nuno",
    funcao: "Fica de olho nas suas IAs e no seu código",
    personagem: { silhueta: "capsula", traco: "fones", tom: "ardosia" },
    ferramentas: ["sessoes.*", "uso.*", "github.*", "tarefas.criar"],
    escopos_memoria: ["dev", "geral"],
  },
  tula: {
    nome: "Tula",
    funcao: "Cuida do seu dinheiro",
    personagem: { silhueta: "pera", traco: "coque", tom: "musgo" },
    ferramentas: ["financas.*", "dividas.*", "planos.*", "arquivos.ler_texto", "memoria.*"],
    escopos_memoria: ["financas"],
  },
};

interface LinhaAgente {
  id: string;
  nome: string;
  funcao: string;
  instrucoes: string;
  personagem: string;
  ferramentas: string;
  gatilhos: string;
  escopos_memoria: string;
  estado: string;
  de_fabrica: number;
}

function conferirTime(db: DatabaseSync) {
  const linhas = db
    .prepare(
      "SELECT id, nome, funcao, instrucoes, personagem, ferramentas, gatilhos, escopos_memoria, estado, de_fabrica FROM agentes ORDER BY id",
    )
    .all() as unknown as LinhaAgente[];
  const time = Object.fromEntries(
    linhas.map((a) => [
      a.id,
      {
        nome: a.nome,
        funcao: a.funcao,
        personagem: JSON.parse(a.personagem) as unknown,
        ferramentas: JSON.parse(a.ferramentas) as unknown,
        escopos_memoria: JSON.parse(a.escopos_memoria) as unknown,
      },
    ]),
  );
  expect(time).toEqual(TIME_ESPERADO);
  for (const agente of linhas) {
    expect(agente.instrucoes).toContain(`Você é ${agente.id === "nuno" ? "o" : "a"} ${agente.nome}`);
    expect(agente.gatilhos).toBe("[]");
    expect(agente.estado).toBe("ativo");
    expect(agente.de_fabrica).toBe(1);
  }
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

  test("agente de fábrica não vai para a lixeira, não se apaga e não deixa de ser de fábrica", () => {
    const db = bancoNovo();
    expect(() =>
      db.prepare("UPDATE agentes SET apagado_em = ? WHERE id = 'tula'").run(new Date().toISOString()),
    ).toThrow("CHECK");
    expect(() => db.prepare("DELETE FROM agentes WHERE id = 'tula'").run()).toThrow(
      "agente de fábrica não se apaga",
    );
    expect(() => db.prepare("UPDATE agentes SET de_fabrica = 0 WHERE id = 'tula'").run()).toThrow(
      "agente de fábrica continua de fábrica",
    );
    // Renomear e ajustar continua valendo.
    db.prepare("UPDATE agentes SET nome = 'Tulinha', estado = 'pausado' WHERE id = 'tula'").run();

    db.prepare(
      "INSERT INTO agentes (id, nome, funcao, personagem, apagado_em) VALUES ('meu', 'Meu', 'x', '{}', ?)",
    ).run(new Date().toISOString());
    db.prepare("DELETE FROM agentes WHERE id = 'meu'").run();
    expect(db.prepare("SELECT count(*) AS n FROM agentes").get()).toEqual({ n: 4 });
  });

  test("conversa e aprovação guardam o vínculo de domínio quando o usuário mexe na linha", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado, origem, agente_id) VALUES ('e1', 'nuno', 'mensagem', 'rodando', 'agente', 'nuno')",
    ).run();

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
    // Execução continua sendo chave de verdade: tabela sem lixeira.
    expect(() =>
      db
        .prepare(
          "INSERT INTO chamadas_ferramenta (id, da_execucao_id, ferramenta, efeito, entrada) VALUES ('c1', 'nenhuma', 'x', 'leitura', '{}')",
        )
        .run(),
    ).toThrow("FOREIGN KEY");
  });

  test("agente, provedor e regra apagados há 31 dias saem da lixeira mesmo com histórico apontando", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO provedores (id, tipo, nome, apagado_em) VALUES ('p1', 'claude-cli', 'Claude', ?)",
    ).run(VENCIDA);
    db.prepare(
      "INSERT INTO agentes (id, nome, funcao, personagem, provedor_id, apagado_em) VALUES ('meu', 'Meu', 'x', '{}', 'p1', ?)",
    ).run(VENCIDA);
    db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado, provedor_id, origem, agente_id) VALUES ('e1', 'meu', 'mensagem', 'ok', 'p1', 'agente', 'meu')",
    ).run();
    db.prepare(
      "INSERT INTO conversas (id, tipo, do_agente_id, origem, agente_id, execucao_id) VALUES ('c1', 'agente', 'meu', 'agente', 'meu', 'e1')",
    ).run();
    db.prepare(
      "INSERT INTO regras_permissao (id, escopo, do_agente_id, ferramenta, padrao, decisao, apagado_em) VALUES ('r1', 'agente', 'meu', 'github.comentar', '*', 'permitir', ?)",
    ).run(VENCIDA);
    db.prepare(
      "INSERT INTO aprovacoes (id, da_execucao_id, do_agente_id, fonte, descricao, acao, estado, decidida_em, regra_criada_id) VALUES ('a1', 'e1', 'meu', 'moductus', 'x', '{}', 'aprovada', ?, 'r1')",
    ).run(VENCIDA);

    const preparar = vi.spyOn(db, "prepare");
    expect(limparLixeira(db, AGORA)).toEqual(
      new Map([
        ["agentes", 1],
        ["provedores", 1],
        ["regras_permissao", 1],
      ]),
    );
    // Nenhuma chave travou o DELETE de uma vez: a limpeza não caiu no caminho linha a linha.
    expect(preparar.mock.calls.filter(([sql]) => sql.startsWith("SELECT id FROM"))).toEqual([]);
    expect(db.prepare("SELECT id FROM agentes WHERE id = 'meu'").get()).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS n FROM execucoes").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM conversas").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM aprovacoes").get()).toEqual({ n: 1 });
  });

  test("conversa apagada com as mensagens sai junto da lixeira; com mensagem viva, fica", () => {
    const db = bancoNovo();
    const conversa = db.prepare("INSERT INTO conversas (id, tipo, apagado_em) VALUES (?, 'time', ?)");
    conversa.run("apagada", VENCIDA);
    conversa.run("presa", VENCIDA);
    const mensagem = db.prepare(
      "INSERT INTO mensagens (id, conversa_id, conteudo, apagado_em) VALUES (?, ?, 'oi', ?)",
    );
    mensagem.run("m1", "apagada", VENCIDA);
    mensagem.run("m2", "presa", null);

    expect(limparLixeira(db, AGORA)).toEqual(
      new Map([
        ["conversas", 1],
        ["mensagens", 1],
      ]),
    );
    expect(db.prepare("SELECT id FROM conversas").all()).toEqual([{ id: "presa" }]);
  });
});
