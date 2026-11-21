import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "lancamentos");
const posicaoDa070 = MIGRACOES.findIndex((m) => m.nome === "financas-cadastro");

const TABELAS = ["faturas", "importacao_lapides", "importacoes", "lancamentos"];
const AGORA = new Date("2026-11-21T12:00:00.000Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

/** A chave natural do ADR-0042, como o serviço vai calcular: conta, data e valor. */
const impressao = (conta: string, data: string, valor: number) =>
  createHash("sha256").update(`${conta}|${data}|${valor}`).digest("hex");

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
const conta = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "contas", id, { nome: id, tipo: "corrente", ...campos });
const cartao = (db: DatabaseSync, id: string) =>
  conta(db, id, { tipo: "cartao", dia_fechamento: 3, dia_vencimento: 10 });
const lancamento = (db: DatabaseSync, id: string, campos: Campos = {}) => {
  const linha = { conta_id: "corrente", data: "2026-11-05", valor_centavos: -4500, ...campos };
  inserir(db, "lancamentos", id, {
    descricao: "Mercado",
    impressao: impressao(String(linha.conta_id), String(linha.data), Number(linha.valor_centavos)),
    ...linha,
  });
};
const fatura = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "faturas", id, {
    conta_id: "cartao",
    mes_referencia: "2026-11",
    fecha_em: "2026-11-03",
    vence_em: "2026-11-10",
    ...campos,
  });
const importacao = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  inserir(db, "importacoes", id, {
    conta_id: "corrente",
    arquivo_nome: "extrato-novembro.ofx",
    arquivo_hash: createHash("sha256").update(id).digest("hex"),
    formato: "ofx",
    estado: "concluida",
    ...campos,
  });
const importado = (db: DatabaseSync, id: string, campos: Campos = {}) =>
  lancamento(db, id, {
    origem: "importacao",
    importacao_id: "im1",
    descricao_original: "MERCADO BOM PRECO 1234",
    ...campos,
  });

/** Conta corrente, cartão e uma importação concluída: o mínimo para os lançamentos. */
function bancoComContas(): DatabaseSync {
  const db = bancoNovo();
  conta(db, "corrente");
  cartao(db, "cartao");
  importacao(db, "im1");
  return db;
}

const apagarConta = (db: DatabaseSync, id: string) =>
  db.prepare("UPDATE contas SET apagado_em = ? WHERE id = ?").run(AGORA.toISOString(), id);

describe("migração lancamentos", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as quatro tabelas vazias e as chaves conferidas", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    for (const tabela of TABELAS) expect(ids(db, tabela)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.7.0 sem mexer no que já estava", () => {
    expect(posicaoDa070).toBeGreaterThan(0);
    const pasta = mkdtempSync(join(tmpdir(), "moductus-lancamentos-"));
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

  test("sobe sobre contas que já existiam, e a que estava na lixeira continua lá", () => {
    expect(posicao).toBeGreaterThan(0);
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrar(db, MIGRACOES.slice(0, posicao));
    conta(db, "corrente");
    conta(db, "apagada", { apagado_em: diasAtras(2) });
    migrar(db, MIGRACOES);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    lancamento(db, "l1");
    expect(ids(db, "contas")).toEqual(["apagada", "corrente"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("o lançamento aponta para a conta, a fatura e a importação, sem apagar nem mudar linha viva", () => {
    const db = bancoComContas();
    const chaves = TABELAS.flatMap((t) =>
      (
        db
          .prepare('SELECT "from" AS coluna, "table" AS alvo, on_delete FROM pragma_foreign_key_list(?)')
          .all(t) as { coluna: string; alvo: string; on_delete: string }[]
      ).map((fk) => `${t}.${fk.coluna} -> ${fk.alvo} (${fk.on_delete})`),
    );
    expect(chaves.sort()).toEqual([
      "lancamentos.conta_id -> contas (NO ACTION)",
      "lancamentos.fatura_id -> faturas (NO ACTION)",
      "lancamentos.importacao_id -> importacoes (NO ACTION)",
    ]);
    expect(() => lancamento(db, "sem-conta", { conta_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
    expect(() => lancamento(db, "sem-fatura", { fatura_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
    expect(() => lancamento(db, "sem-importacao", { importacao_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
    // A categoria é texto: vai à lixeira deixando o lançamento "sem categoria".
    lancamento(db, "categoria-solta", { categoria_id: "nao-existe" });
  });

  test("lançamento: data, centavos, chave natural, parcelas da compra e a importação de quem veio dela", () => {
    const db = bancoComContas();
    fatura(db, "f1");
    lancamento(db, "gasto", { categoria_id: "mercado" });
    lancamento(db, "receita", { valor_centavos: 500000, categoria_id: "salario", descricao: "Salário" });
    lancamento(db, "igual-no-mesmo-dia", { categoria_id: "mercado" });
    for (const n of [1, 2, 3]) {
      lancamento(db, `parcela-${n}`, {
        conta_id: "cartao",
        fatura_id: "f1",
        valor_centavos: n === 1 ? -3334 : -3333,
        compra_id: "compra-1",
        parcela_numero: n,
        parcela_total: 3,
      });
    }
    lancamento(db, "ida", { transferencia_id: "tr-1", categoria_id: "transferencia" });
    lancamento(db, "volta", { conta_id: "cartao", valor_centavos: 4500, transferencia_id: "tr-1" });
    importado(db, "importado", { id_externo: "FITID-123" });
    expect(
      db.prepare("SELECT conciliado, categoria_id, apagado_em FROM lancamentos WHERE id = 'importado'").get(),
    ).toEqual({ conciliado: 0, categoria_id: null, apagado_em: null });
    // Duas compras iguais no mesmo dia: a mesma impressão, legítima (multiconjunto, ADR-0042).
    expect(
      db
        .prepare("SELECT count(*) AS n FROM lancamentos WHERE impressao = ?")
        .get(impressao("corrente", "2026-11-05", -4500)),
    ).toEqual({ n: 4 });

    expect(() => lancamento(db, "data", { data: "05/11/2026" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "instante", { data: "2026-11-05T10:00:00.000Z" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "real", { valor_centavos: 45.5 })).toThrow(/cannot store REAL/);
    expect(() => lancamento(db, "sem-impressao", { impressao: null })).toThrow(/NOT NULL/);
    expect(() => lancamento(db, "impressao-curta", { impressao: "abc" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "impressao-maiuscula", { impressao: "A".repeat(64) })).toThrow(/CHECK/);
    expect(() => lancamento(db, "conciliado", { conciliado: 2 })).toThrow(/CHECK/);
    expect(() => lancamento(db, "fitid-vazio", { id_externo: " " })).toThrow(/CHECK/);
    expect(() => lancamento(db, "so-numero", { parcela_numero: 1, compra_id: "c" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "so-total", { parcela_total: 3, compra_id: "c" })).toThrow(/CHECK/);
    expect(() =>
      lancamento(db, "parcela-0", { parcela_numero: 0, parcela_total: 3, compra_id: "c" }),
    ).toThrow(/CHECK/);
    expect(() =>
      lancamento(db, "parcela-4-de-3", { parcela_numero: 4, parcela_total: 3, compra_id: "c" }),
    ).toThrow(/CHECK/);
    expect(() => lancamento(db, "uma-vez", { parcela_numero: 1, parcela_total: 1, compra_id: "c" })).toThrow(
      /CHECK/,
    );
    expect(() => lancamento(db, "parcela-sem-compra", { parcela_numero: 1, parcela_total: 3 })).toThrow(
      /CHECK/,
    );
    expect(() => lancamento(db, "compra-sem-parcela", { compra_id: "c" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "importado-sem-importacao", { origem: "importacao" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);
    expect(() => lancamento(db, "apagado-errado", { apagado_em: "2026-11-21" })).toThrow(/CHECK/);
    // O importado que o usuário corrige passa a ser dele, e a importação fica.
    db.prepare(
      "UPDATE lancamentos SET origem = 'usuario', categoria_id = 'mercado' WHERE id = 'importado'",
    ).run();
    expect(db.prepare("SELECT importacao_id FROM lancamentos WHERE id = 'importado'").get()).toEqual({
      importacao_id: "im1",
    });
  });

  test("fatura: uma por cartão e mês, vence depois de fechar, e só a paga aponta o pagamento", () => {
    const db = bancoComContas();
    fatura(db, "nov");
    fatura(db, "dez", {
      mes_referencia: "2026-12",
      fecha_em: "2026-12-28",
      vence_em: "2027-01-05",
      paga: 1,
      pagamento_lancamento_id: "l-pagamento",
    });
    expect(db.prepare("SELECT paga FROM faturas WHERE id = 'nov'").get()).toEqual({ paga: 0 });
    expect(() => fatura(db, "repetida")).toThrow(/UNIQUE/);
    expect(() => fatura(db, "mes", { mes_referencia: "2026-1" })).toThrow(/CHECK/);
    expect(() => fatura(db, "fecha", { mes_referencia: "2027-01", fecha_em: "03/01/2027" })).toThrow(/CHECK/);
    expect(() =>
      fatura(db, "vence-antes", {
        mes_referencia: "2027-01",
        fecha_em: "2027-01-10",
        vence_em: "2027-01-03",
      }),
    ).toThrow(/CHECK/);
    expect(() =>
      fatura(db, "paga-nao", { mes_referencia: "2027-02", pagamento_lancamento_id: "l-pagamento" }),
    ).toThrow(/CHECK/);
    expect(() => fatura(db, "paga-2", { mes_referencia: "2027-03", paga: 2 })).toThrow(/CHECK/);
  });

  test("importação: hash do arquivo, só o nome sem caminho, formato, estado e o erro de quem falhou", () => {
    const db = bancoComContas();
    importacao(db, "de-novo", {
      arquivo_hash: createHash("sha256").update("im1").digest("hex"),
      periodo_inicio: "2026-10-01",
      periodo_fim: "2026-10-31",
      lancamentos_novos: 12,
      lancamentos_ignorados: 30,
    });
    importacao(db, "csv", { formato: "csv", perfil_id: "perfil-meu-banco", estado: "previa" });
    importacao(db, "ilegivel", { conta_id: null, estado: "falhou", erro: "formato não reconhecido" });
    importacao(db, "desfeita", { estado: "desfeita" });
    expect(
      db.prepare("SELECT lancamentos_novos, lancamentos_ignorados FROM importacoes WHERE id = 'im1'").get(),
    ).toEqual({ lancamentos_novos: 0, lancamentos_ignorados: 0 });

    expect(() => importacao(db, "caminho", { arquivo_nome: "C:\\Users\\eu\\extrato.ofx" })).toThrow(/CHECK/);
    expect(() => importacao(db, "barra", { arquivo_nome: "Downloads/extrato.ofx" })).toThrow(/CHECK/);
    expect(() => importacao(db, "nome-vazio", { arquivo_nome: " " })).toThrow(/CHECK/);
    expect(() => importacao(db, "hash", { arquivo_hash: "123" })).toThrow(/CHECK/);
    expect(() => importacao(db, "formato", { formato: "pdf" })).toThrow(/CHECK/);
    expect(() => importacao(db, "estado", { estado: "lendo" })).toThrow(/CHECK/);
    expect(() => importacao(db, "sem-estado", { estado: null })).toThrow(/NOT NULL/);
    expect(() => importacao(db, "falhou-sem-erro", { estado: "falhou" })).toThrow(/CHECK/);
    expect(() => importacao(db, "sem-conta", { conta_id: null })).toThrow(/CHECK/);
    expect(() =>
      importacao(db, "periodo", { periodo_inicio: "2026-11-30", periodo_fim: "2026-11-01" }),
    ).toThrow(/CHECK/);
    expect(() => importacao(db, "periodo-data", { periodo_inicio: "2026-11" })).toThrow(/CHECK/);
    expect(() => importacao(db, "negativo", { lancamentos_novos: -1 })).toThrow(/CHECK/);
  });

  test("conta com lançamento só arquiva, mesmo com o lançamento na lixeira; sem lançamento, vai à lixeira", () => {
    const db = bancoComContas();
    conta(db, "vazia");
    conta(db, "com-apagado");
    lancamento(db, "vivo");
    lancamento(db, "na-lixeira", { conta_id: "com-apagado", apagado_em: diasAtras(1) });

    expect(() => apagarConta(db, "corrente")).toThrow(/conta com lançamento só arquiva/);
    expect(() => apagarConta(db, "com-apagado")).toThrow(/conta com lançamento só arquiva/);
    db.prepare("UPDATE contas SET ativa = 0, nome = 'Antiga' WHERE id = 'corrente'").run();
    expect(db.prepare("SELECT ativa, apagado_em FROM contas WHERE id = 'corrente'").get()).toEqual({
      ativa: 0,
      apagado_em: null,
    });

    apagarConta(db, "vazia");
    db.prepare("UPDATE contas SET apagado_em = NULL WHERE id = 'vazia'").run();
    expect(db.prepare("SELECT apagado_em FROM contas WHERE id = 'vazia'").get()).toEqual({
      apagado_em: null,
    });

    // Esvaziada a lixeira, a conta fica sem lançamento e pode ir.
    db.prepare("DELETE FROM lancamentos WHERE id = 'na-lixeira'").run();
    apagarConta(db, "com-apagado");
    expect(db.prepare("SELECT apagado_em FROM contas WHERE id = 'com-apagado'").get()).toEqual({
      apagado_em: AGORA.toISOString(),
    });
  });

  test("a limpeza da lixeira leva o lançamento seu e deixa o importado, mesmo corrigido por você", () => {
    const db = bancoComContas();
    lancamento(db, "manual-vencido", { apagado_em: diasAtras(31) });
    lancamento(db, "manual-recente", { apagado_em: diasAtras(29) });
    importado(db, "importado-vencido", { apagado_em: diasAtras(31) });
    importado(db, "importado-corrigido", { origem: "usuario", apagado_em: diasAtras(40) });
    lancamento(db, "vivo");

    expect(limparLixeira(db, AGORA)).toEqual(new Map([["lancamentos", 1]]));
    expect(ids(db, "lancamentos")).toEqual([
      "importado-corrigido",
      "importado-vencido",
      "manual-recente",
      "vivo",
    ]);
    // A limpeza não deixa lápide: ela não leva importado, e o lançamento seu não precisa.
    expect(ids(db, "importacao_lapides")).toEqual([]);
  });

  test("esvaziar a lixeira grava a lápide do importado; desfazer a importação não", () => {
    const db = bancoComContas();
    importado(db, "importado", { id_externo: "FITID-1", apagado_em: diasAtras(31) });
    importado(db, "corrigido", { origem: "usuario", valor_centavos: -1990, apagado_em: diasAtras(2) });
    lancamento(db, "manual", { apagado_em: diasAtras(5) });
    importado(db, "desfeito");

    // Esvaziar a lixeira à mão: tudo o que está nela sai de vez.
    db.prepare("DELETE FROM lancamentos WHERE apagado_em IS NOT NULL").run();
    // Desfazer a importação: o que ela trouxe e ainda está vivo sai de vez.
    db.prepare("DELETE FROM lancamentos WHERE importacao_id = 'im1' AND apagado_em IS NULL").run();

    expect(ids(db, "lancamentos")).toEqual([]);
    expect(
      db
        .prepare("SELECT id, conta_id, impressao, id_externo, origem FROM importacao_lapides ORDER BY id")
        .all(),
    ).toEqual([
      {
        id: "corrigido",
        conta_id: "corrente",
        impressao: impressao("corrente", "2026-11-05", -1990),
        id_externo: null,
        origem: "usuario",
      },
      {
        id: "importado",
        conta_id: "corrente",
        impressao: impressao("corrente", "2026-11-05", -4500),
        id_externo: "FITID-1",
        origem: "usuario",
      },
    ]);
    // Sem lançamento, a importação desfeita pode sair; a lápide não a segura.
    db.prepare("DELETE FROM importacoes WHERE id = 'im1'").run();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
