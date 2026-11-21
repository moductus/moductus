import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira, tabelasComLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "planejamento");
const posicaoDa070 = MIGRACOES.findIndex((m) => m.nome === "financas-cadastro");

const TABELAS = ["dividas", "orcamentos", "plano_movimentos", "planos", "recorrencias"];
const AGORA = new Date("2026-11-21T12:00:00.000Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

const ids = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all() as { id: string }[]).map((l) => l.id);

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

type Campos = Record<string, string | number | null>;

const inserir = (db: DatabaseSync, tabela: string, id: string, campos: Campos) => {
  const colunas = Object.keys(campos);
  db.prepare(
    `INSERT INTO ${tabela} (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(campos));
};
const orcamento = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "orcamentos", id, { categoria_id: "mercado", limite_centavos: 80000, ...campos });
const recorrencia = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "recorrencias", id, {
    descricao: "Internet",
    valor_centavos: -9990,
    regra: "FREQ=MONTHLY;BYMONTHDAY=10",
    ...campos,
  });
const divida = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "dividas", id, {
    nome: "Empréstimo",
    tipo: "emprestimo",
    saldo_centavos: 640000,
    saldo_em: "2026-11-01",
    ...campos,
  });
const plano = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "planos", id, { nome: "Reserva", valor_alvo_centavos: 1000000, ...campos });
const movimento = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "plano_movimentos", id, {
    plano_id: "reserva",
    data: "2026-11-05",
    valor_centavos: 20000,
    ...campos,
  });

describe("migração planejamento", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as cinco tabelas vazias, sem chave estrangeira, e a lixeira só nas de cadastro", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    for (const tabela of TABELAS) {
      expect(ids(db, tabela)).toEqual([]);
      expect(db.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(tabela)).toEqual([]);
    }
    expect(tabelasComLixeira(db).filter((t) => TABELAS.includes(t))).toEqual([
      "dividas",
      "planos",
      "recorrencias",
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.7.0 sem mexer no que já estava", () => {
    expect(posicaoDa070).toBeGreaterThan(0);
    const pasta = mkdtempSync(join(tmpdir(), "moductus-planejamento-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, posicaoDa070));
    expect(versaoAtual(antigo)).toBe(posicaoDa070);
    antigo.prepare("UPDATE agentes SET nome = 'Tulinha' WHERE id = 'tula'").run();
    antigo
      .prepare("INSERT INTO tarefas (id, lista_id, titulo) VALUES ('t1', 'entrada', 'pagar o aluguel')")
      .run();
    antigo.close();

    const db = abrirBanco(pasta, { duravel: false });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(db.prepare("SELECT nome FROM agentes WHERE id = 'tula'").get()).toEqual({ nome: "Tulinha" });
    expect(db.prepare("SELECT titulo FROM tarefas WHERE id = 't1'").get()).toEqual({
      titulo: "pagar o aluguel",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("sobe sobre lançamentos que já apontavam recorrência e dívida, e as buscas por elas têm índice", () => {
    expect(posicao).toBeGreaterThan(0);
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare("INSERT INTO contas (id, nome, tipo) VALUES ('corrente', 'Corrente', 'corrente')").run();
    db.prepare(
      `INSERT INTO lancamentos (id, conta_id, data, descricao, valor_centavos, impressao, recorrencia_id, divida_id)
       VALUES ('l1', 'corrente', '2026-11-10', 'Internet', -9990, ?, 'internet', 'emprestimo')`,
    ).run(createHash("sha256").update("corrente|2026-11-10|-9990").digest("hex"));
    migrar(db, MIGRACOES);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    recorrencia(db, "internet");
    divida(db, "emprestimo");
    expect(
      db
        .prepare(
          `SELECT l.id FROM lancamentos AS l JOIN recorrencias AS r ON r.id = l.recorrencia_id
           JOIN dividas AS d ON d.id = l.divida_id`,
        )
        .all(),
    ).toEqual([{ id: "l1" }]);
    const indices = (
      db.prepare("SELECT name FROM pragma_index_list('lancamentos') ORDER BY name").all() as {
        name: string;
      }[]
    ).map((i) => i.name);
    expect(indices).toEqual(expect.arrayContaining(["lancamentos_divida_id", "lancamentos_recorrencia_id"]));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("orçamento: um por categoria e mês, com o todo mês contando como valor, e o mês sempre AAAA-MM", () => {
    const db = bancoNovo();
    orcamento(db, "todo-mes");
    orcamento(db, "novembro", { mes: "2026-11", limite_centavos: 100000, alerta_percentual: 90 });
    orcamento(db, "dezembro", { mes: "2026-12" });
    orcamento(db, "janeiro", { mes: "2027-01", limite_centavos: 0 });
    orcamento(db, "lazer", { categoria_id: "lazer" });
    orcamento(db, "lazer-novembro", { categoria_id: "lazer", mes: "2026-11" });
    // A categoria é texto: vai à lixeira sem levar nem segurar o orçamento.
    orcamento(db, "categoria-solta", { categoria_id: "nao-existe" });
    expect(db.prepare("SELECT mes, alerta_percentual FROM orcamentos WHERE id = 'todo-mes'").get()).toEqual({
      mes: null,
      alerta_percentual: 80,
    });

    expect(() => orcamento(db, "outro-todo-mes")).toThrow(/UNIQUE/);
    expect(() => orcamento(db, "outro-novembro", { mes: "2026-11" })).toThrow(/UNIQUE/);
    for (const mes of ["2026-13", "2026-00", "2026-1", "2026-11-01", "11/2026", "2026-1a", ""]) {
      expect(() => orcamento(db, `mes-${mes}`, { mes })).toThrow(/CHECK/);
    }
    expect(() => orcamento(db, "negativo", { mes: "2027-02", limite_centavos: -1 })).toThrow(/CHECK/);
    expect(() => orcamento(db, "real", { mes: "2027-03", limite_centavos: 100.5 })).toThrow(
      /cannot store REAL/,
    );
    expect(() => orcamento(db, "sem-limite", { mes: "2027-04", limite_centavos: null })).toThrow(/NOT NULL/);
    expect(() => orcamento(db, "sem-categoria", { categoria_id: null })).toThrow(/NOT NULL/);
    expect(() => orcamento(db, "alerta-0", { mes: "2027-05", alerta_percentual: 0 })).toThrow(/CHECK/);
    expect(() => orcamento(db, "alerta-101", { mes: "2027-06", alerta_percentual: 101 })).toThrow(/CHECK/);
    // Remanejar cria a linha do mês; mudar o mês para um que já tem a sua é recusado.
    expect(() => db.prepare("UPDATE orcamentos SET mes = '2026-11' WHERE id = 'dezembro'").run()).toThrow(
      /UNIQUE/,
    );
  });

  test("recorrência: valor estimado com sinal, regra RRULE, próxima data como dia e de onde veio", () => {
    const db = bancoNovo();
    recorrencia(db, "internet", { proxima_em: "2026-12-10", categoria_id: "contas", conta_id: "corrente" });
    recorrencia(db, "salario", { descricao: "Salário", valor_centavos: 500000, regra: "FREQ=MONTHLY" });
    recorrencia(db, "detectada", {
      ativa: 0,
      detectada_automaticamente: 1,
      origem: "agente",
      agente_id: "tula",
    });
    expect(
      db
        .prepare(
          "SELECT ativa, detectada_automaticamente, apagado_em FROM recorrencias WHERE id = 'internet'",
        )
        .get(),
    ).toEqual({ ativa: 1, detectada_automaticamente: 0, apagado_em: null });

    expect(() => recorrencia(db, "sem-descricao", { descricao: " " })).toThrow(/CHECK/);
    // A regra é validada no serviço (lerRecorrencia), que aceita prefixo, minúsculas e qualquer ordem.
    recorrencia(db, "rrule", { regra: "RRULE:bymonthday=5;freq=monthly" });
    expect(() => recorrencia(db, "sem-regra", { regra: null })).toThrow(/NOT NULL/);
    expect(() => recorrencia(db, "proxima", { proxima_em: "10/12/2026" })).toThrow(/CHECK/);
    expect(() => recorrencia(db, "real", { valor_centavos: -99.9 })).toThrow(/cannot store REAL/);
    expect(() => recorrencia(db, "ativa", { ativa: 2 })).toThrow(/CHECK/);
    expect(() => recorrencia(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);
  });

  test("dívida: o banco recusa juros negativo; saldo devedor com data, juros em pontos-base e parcela", () => {
    const db = bancoNovo();
    divida(db, "emprestimo", {
      credor: "Banco",
      juros_mensal_bp: 210,
      parcela_centavos: 45210,
      parcelas_restantes: 17,
      dia_vencimento: 10,
    });
    divida(db, "pessoal", { tipo: "pessoal", credor: "Ana" });
    divida(db, "quitada", { tipo: "cartao", saldo_centavos: 0, quitada_em: "2026-11-20" });
    expect(db.prepare("SELECT juros_mensal_bp FROM dividas WHERE id = 'pessoal'").get()).toEqual({
      juros_mensal_bp: 0,
    });

    expect(() => divida(db, "juros-negativo", { juros_mensal_bp: -1 })).toThrow(/CHECK/);
    expect(() => divida(db, "juros-real", { juros_mensal_bp: 1.99 })).toThrow(/cannot store REAL/);
    expect(() =>
      db.prepare("UPDATE dividas SET juros_mensal_bp = -199 WHERE id = 'emprestimo'").run(),
    ).toThrow(/CHECK/);
    expect(() => divida(db, "tipo", { tipo: "agiota" })).toThrow(/CHECK/);
    expect(() => divida(db, "sem-tipo", { tipo: null })).toThrow(/NOT NULL/);
    expect(() => divida(db, "saldo-negativo", { saldo_centavos: -1 })).toThrow(/CHECK/);
    expect(() => divida(db, "sem-data", { saldo_em: null })).toThrow(/NOT NULL/);
    expect(() => divida(db, "data", { saldo_em: "2026-11" })).toThrow(/CHECK/);
    expect(() => divida(db, "parcela-zero", { parcela_centavos: 0 })).toThrow(/CHECK/);
    expect(() => divida(db, "parcelas-negativas", { parcelas_restantes: -1 })).toThrow(/CHECK/);
    expect(() => divida(db, "vencimento", { dia_vencimento: 32 })).toThrow(/CHECK/);
    expect(() => divida(db, "quitada-em", { quitada_em: "2026-11-20T10:00:00.000Z" })).toThrow(/CHECK/);
    expect(() => divida(db, "sem-nome", { nome: "" })).toThrow(/CHECK/);
  });

  test("plano e movimentos: alvo positivo, prazo como dia, estado, e o movimento entra ou sai, nunca zero", () => {
    const db = bancoNovo();
    plano(db, "reserva", {
      prazo: "2027-06-30",
      conta_id: "poupanca",
      aporte_mensal_sugerido_centavos: 142858,
    });
    plano(db, "viagem", { estado: "pausado" });
    movimento(db, "guardou");
    movimento(db, "tirou", { valor_centavos: -5000, data: "2026-11-12", lancamento_id: "l-saque" });
    expect(db.prepare("SELECT estado, prazo FROM planos WHERE id = 'viagem'").get()).toEqual({
      estado: "pausado",
      prazo: null,
    });
    expect(
      db
        .prepare("SELECT sum(valor_centavos) AS guardado FROM plano_movimentos WHERE plano_id = 'reserva'")
        .get(),
    ).toEqual({
      guardado: 15000,
    });

    expect(() => plano(db, "alvo-zero", { valor_alvo_centavos: 0 })).toThrow(/CHECK/);
    expect(() => plano(db, "prazo", { prazo: "2027-06" })).toThrow(/CHECK/);
    expect(() => plano(db, "estado", { estado: "cancelado" })).toThrow(/CHECK/);
    expect(() => plano(db, "aporte", { aporte_mensal_sugerido_centavos: -1 })).toThrow(/CHECK/);
    expect(() => movimento(db, "zero", { valor_centavos: 0 })).toThrow(/CHECK/);
    expect(() => movimento(db, "data", { data: "12/11/2026" })).toThrow(/CHECK/);
    expect(() => movimento(db, "sem-plano", { plano_id: null })).toThrow(/NOT NULL/);
  });

  test("o orçamento sai com a categoria e os movimentos com o plano, só quando saem de vez da lixeira", () => {
    const db = bancoNovo();
    db.prepare("INSERT INTO categorias (id, nome, tipo) VALUES ('feira', 'Feira', 'gasto')").run();
    orcamento(db, "feira", { categoria_id: "feira" });
    orcamento(db, "feira-novembro", { categoria_id: "feira", mes: "2026-11" });
    orcamento(db, "mercado");
    plano(db, "reserva");
    plano(db, "viagem");
    movimento(db, "reserva-1");
    movimento(db, "viagem-1", { plano_id: "viagem" });

    // Na lixeira, a categoria e o plano seguram o que é deles: restaurar traz tudo de volta.
    db.prepare("UPDATE categorias SET apagado_em = ? WHERE id = 'feira'").run(diasAtras(31));
    db.prepare("UPDATE planos SET apagado_em = ? WHERE id IN ('reserva', 'viagem')").run(diasAtras(2));
    expect(ids(db, "orcamentos")).toEqual(["feira", "feira-novembro", "mercado"]);
    expect(ids(db, "plano_movimentos")).toEqual(["reserva-1", "viagem-1"]);

    // A limpeza leva a categoria vencida e o orçamento dela; o plano recente fica.
    expect(limparLixeira(db, AGORA)).toEqual(new Map([["categorias", 1]]));
    expect(ids(db, "orcamentos")).toEqual(["mercado"]);
    expect(ids(db, "plano_movimentos")).toEqual(["reserva-1", "viagem-1"]);

    // Esvaziar a lixeira à mão leva o plano e os movimentos dele.
    db.prepare("DELETE FROM planos WHERE id = 'reserva'").run();
    expect(ids(db, "plano_movimentos")).toEqual(["viagem-1"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
