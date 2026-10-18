import { DatabaseSync } from "node:sqlite";
import { ConteudoArquivo } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import { migrar } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";
import { MIGRACOES } from "../migracoes/index.ts";
import {
  COLUNAS_QUE_NUNCA_VAO,
  EXPORTACAO,
  lerConfiguracoes,
  linhasQueViajam,
  tabelasDoBanco,
} from "./tabelas.ts";

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
  "calendarios",
  "conexoes",
  "config",
  "etiquetas",
  "listas",
  "notificacoes_preferencias",
  "provedores",
  "regras_permissao",
  "rotinas",
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

  test("só configurações leva agentes, provedores, regras, conexões, preferências, listas, etiquetas, calendários e rotinas, sem credencial nem execuções, sessões ou tarefas", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO provedores (id, tipo, nome, modelo, credencial) VALUES ('p1', 'anthropic', 'Claude', 'opus', 'moductus:anthropic')",
    ).run();
    db.prepare(
      "INSERT INTO provedores (id, tipo, nome, caminho) VALUES ('p2', 'claude-cli', 'Claude Code', 'C:\\npm\\claude.cmd')",
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
    db.prepare("INSERT INTO listas (id, nome, apagado_em) VALUES ('l-apagada', 'Velha', ?)").run(AGORA);
    db.prepare("INSERT INTO etiquetas (id, nome, nome_chave) VALUES ('et1', 'casa', 'casa')").run();
    db.prepare(
      "INSERT INTO tarefas (id, lista_id, titulo) VALUES ('t1', 'entrada', 'ligar pro banco')",
    ).run();
    db.prepare("INSERT INTO tarefa_etiquetas (id, tarefa_id, etiqueta_id) VALUES ('te1', 't1', 'et1')").run();
    db.prepare(
      "INSERT INTO lembretes (id, texto, quando, tarefa_id) VALUES ('lb1', 'ligar pro banco', ?, 't1')",
    ).run(AGORA);

    const tabelas = lerConfiguracoes(db);
    // `config` vai pelo ServicoConfig, como já ia.
    expect([...tabelas.keys()].sort()).toEqual(CONFIGURACOES.filter((t) => t !== "config"));
    expect(tabelas.get("agentes")?.map((a) => a.id)).toEqual(["alba", "faina", "meu", "nuno", "tula"]);
    expect(tabelas.get("provedores")).toEqual([
      expect.objectContaining({ id: "p1", tipo: "anthropic", nome: "Claude", modelo: "opus" }),
      expect.objectContaining({ id: "p2", tipo: "claude-cli" }),
    ]);
    // O caminho do CLI é deste PC: no PC novo, a detecção acha o de lá.
    expect(tabelas.get("provedores")?.[1]).not.toHaveProperty("caminho");
    // O teto e a moeda vão; o que foi liberado hoje por cima do teto é deste PC e deste dia.
    const nuno = tabelas.get("agentes")?.find((a) => a.id === "nuno");
    expect(nuno).toMatchObject({ teto_moeda: "BRL", teto_diario_centavos: null });
    expect(nuno).not.toHaveProperty("teto_liberado_centavos");
    expect(nuno).not.toHaveProperty("teto_liberado_ate");
    expect(tabelas.get("regras_permissao")?.map((r) => r.id)).toEqual(["r1"]);
    expect(tabelas.get("conexoes")).toEqual([expect.objectContaining({ id: "c1", conta: "gustavo" })]);
    expect(tabelas.get("notificacoes_preferencias")?.map((p) => p.id)).toEqual(["np1"]);
    expect(tabelas.get("listas")?.map((l) => l.id)).toEqual(["entrada", "pessoal", "trabalho"]);
    expect(tabelas.get("etiquetas")?.map((e) => e.id)).toEqual(["et1"]);
    expect(tabelas.get("calendarios")?.map((c) => c.id)).toEqual(["local"]);
    expect(tabelas.get("rotinas")?.map((r) => r.id)).toEqual(["briefing", "fechamento"]);

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

  test("o calendário do Google vai sem a leitura daqui; o evento dele, a fila de saída e o registro das rotinas não vão", () => {
    const db = bancoNovo();
    db.prepare(
      `INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever, sincronizado_em, token_sincronizacao)
       VALUES ('g1', 'Moductus', 'google', 'abc@group.calendar.google.com', 1, 1, ?, 'token-daqui')`,
    ).run(AGORA);
    const evento = db.prepare(
      "INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, id_externo, apagado_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const fim = "2026-10-09T13:00:00.000Z";
    evento.run("ev-local", "local", "dentista", AGORA, fim, null, null);
    evento.run("ev-local-apagado", "local", "velho", AGORA, fim, null, AGORA);
    evento.run("ev-google", "g1", "reunião", AGORA, fim, "gev1", null);
    db.prepare(
      "INSERT INTO sessoes_foco (id, tipo, inicio, fim, duracao_planejada_min, duracao_real_min) VALUES ('f1', 'foco', ?, ?, 25, 25)",
    ).run(AGORA, fim);
    db.prepare(
      "INSERT INTO agenda_saida (id, item_tipo, item_id, operacao) VALUES ('s1', 'evento', 'ev-local', 'criar')",
    ).run();
    db.prepare(
      "INSERT INTO rotinas_registro (id, rotina_id, dia, conteudo) VALUES ('rr1', 'briefing', '2026-10-09', '{}')",
    ).run();

    const [google, local] = lerConfiguracoes(db, new Date(AGORA)).get("calendarios") ?? [];
    expect(google).toEqual(
      expect.objectContaining({
        id: "g1",
        fonte: "google",
        id_externo: "abc@group.calendar.google.com",
        ler: 1,
      }),
    );
    expect(google).not.toHaveProperty("sincronizado_em");
    expect(google).not.toHaveProperty("token_sincronizacao");
    expect(local).toEqual(expect.objectContaining({ id: "local", fonte: "local" }));

    expect(linhasQueViajam(db, "eventos").map((e) => e.id)).toEqual(["ev-local"]);
    expect(linhasQueViajam(db, "sessoes_foco").map((s) => s.id)).toEqual(["f1"]);
    expect(linhasQueViajam(db, "agenda_saida")).toEqual([]);
    expect(linhasQueViajam(db, "rotinas_registro")).toEqual([]);
    expect(EXPORTACAO).toEqual(
      expect.objectContaining({
        eventos: "dado",
        sessoes_foco: "dado",
        agenda_saida: "deste_pc",
        rotinas_registro: "deste_pc",
      }),
    );
  });

  test("evento de calendário local na lixeira e etapa de foco em andamento não viajam", () => {
    const db = bancoNovo();
    db.prepare(
      "INSERT INTO calendarios (id, nome, fonte, pode_escrever, apagado_em) VALUES ('velho', 'Velho', 'local', 1, ?)",
    ).run(AGORA);
    const fim = "2026-10-09T13:00:00.000Z";
    const evento = db.prepare(
      "INSERT INTO eventos (id, calendario_id, titulo, inicio, fim) VALUES (?, ?, ?, ?, ?)",
    );
    evento.run("ev-vivo", "local", "dentista", AGORA, fim);
    evento.run("ev-do-velho", "velho", "aula", AGORA, fim);
    const foco = db.prepare(
      "INSERT INTO sessoes_foco (id, tipo, inicio, fim, duracao_planejada_min, duracao_real_min) VALUES (?, 'foco', ?, ?, 25, ?)",
    );
    foco.run("f-terminada", AGORA, fim, 25);
    foco.run("f-rodando", fim, null, null);

    expect(linhasQueViajam(db, "eventos").map((e) => e.id)).toEqual(["ev-vivo"]);
    expect(linhasQueViajam(db, "sessoes_foco").map((s) => s.id)).toEqual(["f-terminada"]);
  });

  test("toda tabela marcada sai pela chave primária dela, e config fica com o ServicoConfig", () => {
    const db = bancoNovo();
    db.prepare("INSERT INTO config (chave, valor) VALUES ('tema', '\"escuro\"'), ('fuso', '\"UTC\"')").run();
    db.prepare(
      "INSERT INTO onboarding (passo, estado) VALUES ('tutorial', 'pendente'), ('configuracao', 'feito')",
    ).run();

    for (const tabela of Object.keys(EXPORTACAO)) {
      expect(() => linhasQueViajam(db, tabela, new Date(AGORA)), tabela).not.toThrow();
    }
    expect(linhasQueViajam(db, "config")).toEqual([]);
    expect(linhasQueViajam(db, "onboarding").map((o) => o.passo)).toEqual(["configuracao", "tutorial"]);
    expect(linhasQueViajam(db, "agentes").map((a) => a.id)).toEqual(["alba", "faina", "nuno", "tula"]);
  });

  test("tabela sem marcação não sai em só configurações", () => {
    const db = bancoNovo();
    db.exec(criarTabela("esquecida", ["texto TEXT"], { lixeira: false }));
    db.prepare("INSERT INTO esquecida (id, texto) VALUES ('1', 'segredo')").run();
    expect(lerConfiguracoes(db).has("esquecida")).toBe(false);
    expect(linhasQueViajam(db, "esquecida")).toEqual([]);
  });
});
