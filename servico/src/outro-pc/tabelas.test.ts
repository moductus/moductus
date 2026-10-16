import { DatabaseSync } from "node:sqlite";
import { ConteudoArquivo } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";
import { MIGRACOES } from "../migracoes/index.ts";
import { COLUNAS_QUE_NUNCA_VAO, EXPORTACAO, lerConfiguracoes, tabelasDoBanco } from "./tabelas.ts";

const AGORA = new Date("2026-10-09T12:00:00.000Z").toISOString();

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

/** As tabelas de "só configurações" do DATA.md §8 que já existem no banco. */
const CONFIGURACOES = [
  "agentes",
  "conexoes",
  "config",
  "notificacoes_preferencias",
  "provedores",
  "regras_permissao",
];

describe("configuração × dado", () => {
  test("toda tabela do banco tem marcação, e só tabela que existe é marcada", () => {
    const db = bancoNovo();
    const marcar = () => {
      const doBanco = tabelasDoBanco(db);
      return {
        semMarcacao: doBanco.filter((t) => !(t in EXPORTACAO)),
        semTabela: Object.keys(EXPORTACAO).filter((t) => !doBanco.includes(t)),
      };
    };
    expect(marcar()).toEqual({ semMarcacao: [], semTabela: [] });

    // A guarda pega tabela nova que esqueceu a marcação.
    db.exec(criarTabela("esquecida", [], { lixeira: false }));
    expect(marcar().semMarcacao).toEqual(["esquecida"]);
  });

  test("as tabelas de configuração são as do DATA.md §8", () => {
    const configuracoes = Object.entries(EXPORTACAO)
      .filter(([, marcacao]) => marcacao === "configuracao")
      .map(([tabela]) => tabela)
      .sort();
    expect(configuracoes).toEqual(CONFIGURACOES);
  });

  test("só configurações leva agentes, provedores, regras, conexões e preferências, sem credencial nem execuções ou sessões", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO provedores (id, tipo, nome, modelo, credencial) VALUES ('p1', 'anthropic', 'Claude', 'opus', 'moductus:anthropic')",
    ).run();
    db.prepare(
      "INSERT INTO agentes (id, nome, funcao, personagem, provedor_id) VALUES ('meu', 'Meu', 'x', '{}', 'p1')",
    ).run();
    db.prepare(
      "INSERT INTO agentes (id, nome, funcao, personagem, apagado_em) VALUES ('apagado', 'Apagado', 'x', '{}', ?)",
    ).run(AGORA);
    const regra = db.prepare(
      "INSERT INTO regras_permissao (id, escopo, do_agente_id, ferramenta, padrao, decisao, apagado_em) VALUES (?, 'agente', 'nuno', 'github.comentar', '*', 'permitir', ?)",
    );
    regra.run("r1", null);
    regra.run("r-apagada", AGORA);
    db.prepare(
      "INSERT INTO conexoes (id, tipo, conta, credencial, estado) VALUES ('c1', 'github', 'gustavo', 'moductus:github', 'ligada')",
    ).run();
    db.prepare(
      "INSERT INTO notificacoes_preferencias (id, tipo, nivel, canal) VALUES ('np1', 'aprovacao', 'tudo', 'ambos')",
    ).run();
    db.prepare(
      "INSERT INTO execucoes (id, do_agente_id, gatilho, estado) VALUES ('e1', 'meu', 'mensagem', 'ok')",
    ).run();
    db.prepare(
      "INSERT INTO sessoes_ia (id, ferramenta, id_externo, estado, transcript_caminho) VALUES ('s1', 'claude-code', 'abc', 'terminou', 'C:\\Users\\x\\t.jsonl')",
    ).run();
    db.prepare(
      "INSERT INTO notificacoes (id, tipo, titulo, canal) VALUES ('n1', 'aviso', 'oi', 'dock')",
    ).run();

    const tabelas = lerConfiguracoes(db);
    // `config` vai pelo ServicoConfig, como já ia.
    expect([...tabelas.keys()].sort()).toEqual(CONFIGURACOES.filter((t) => t !== "config"));
    expect(tabelas.get("agentes")?.map((a) => a.id)).toEqual(["alba", "faina", "meu", "nuno", "tula"]);
    expect(tabelas.get("provedores")).toEqual([
      expect.objectContaining({ id: "p1", tipo: "anthropic", nome: "Claude", modelo: "opus" }),
    ]);
    expect(tabelas.get("regras_permissao")?.map((r) => r.id)).toEqual(["r1"]);
    expect(tabelas.get("conexoes")).toEqual([expect.objectContaining({ id: "c1", conta: "gustavo" })]);
    expect(tabelas.get("notificacoes_preferencias")?.map((p) => p.id)).toEqual(["np1"]);

    for (const [tabela, linhas] of tabelas) {
      for (const linha of linhas) {
        expect(
          Object.keys(linha).filter((c) => COLUNAS_QUE_NUNCA_VAO.includes(c)),
          tabela,
        ).toEqual([]);
      }
    }
    expect(JSON.stringify([...tabelas])).not.toContain("moductus:");
  });

  test("toda tabela de configuração tem lugar no manifesto do contrato", () => {
    expect(ConteudoArquivo.options.slice().sort()).toEqual(CONFIGURACOES);
  });

  test("conexão vai sem a situação deste PC, e regra vencida não vai", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO conexoes (id, tipo, conta, escopos, estado, ultimo_erro, conectada_em) VALUES ('c1', 'github', 'gustavo', '[\"repo\"]', 'erro', 'gh sem login', ?)",
    ).run(AGORA);
    const regra = db.prepare(
      "INSERT INTO regras_permissao (id, escopo, projeto_id, do_agente_id, ferramenta, padrao, decisao, expira_em) VALUES (?, ?, ?, ?, 'Bash', 'pnpm test', 'permitir', ?)",
    );
    regra.run("r-sem-prazo", "projeto", "proj1", null, null);
    regra.run("r-vencida", "agente", null, "nuno", "2026-10-09T11:59:59.000Z");
    regra.run("r-no-prazo", "agente", null, "nuno", "2026-10-09T12:00:01.000Z");

    const tabelas = lerConfiguracoes(db, new Date(AGORA));
    const [conexao] = tabelas.get("conexoes") ?? [];
    expect(conexao).toEqual(expect.objectContaining({ id: "c1", tipo: "github", conta: "gustavo" }));
    for (const coluna of ["estado", "ultimo_erro", "conectada_em", "credencial"]) {
      expect(conexao).not.toHaveProperty(coluna);
    }
    // A de projeto viaja; a importação decide o que fazer com o projeto que não existe lá.
    expect(tabelas.get("regras_permissao")?.map((r) => r.id)).toEqual(["r-no-prazo", "r-sem-prazo"]);
  });

  test("tabela sem marcação não sai em só configurações", () => {
    const db = bancoNovo();
    db.exec(criarTabela("esquecida", ["texto TEXT"], { lixeira: false }));
    db.prepare("INSERT INTO esquecida (id, texto) VALUES ('1', 'segredo')").run();
    expect(lerConfiguracoes(db).has("esquecida")).toBe(false);
  });
});
