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
const posicao = MIGRACOES.findIndex((m) => m.nome === "financas-cadastro");

const TABELAS = ["categorias", "contas", "perfis_importacao", "regras_categoria"];
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

const categorias = (db: DatabaseSync) =>
  db.prepare("SELECT id, nome, tipo, categoria_pai_id, arquivada FROM categorias ORDER BY id").all();

const ids = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all() as { id: string }[]).map((l) => l.id);

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

const inserir = (
  db: DatabaseSync,
  tabela: string,
  id: string,
  campos: Record<string, string | number | null>,
) => {
  const colunas = Object.keys(campos);
  db.prepare(
    `INSERT INTO ${tabela} (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(campos));
};
const conta = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "contas", id, { nome: id, tipo: "corrente", ...campos });
const cartao = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  conta(db, id, { tipo: "cartao", dia_fechamento: 3, dia_vencimento: 10, ...campos });
const categoria = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "categorias", id, { nome: id, tipo: "gasto", ...campos });
const regra = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "regras_categoria", id, {
    padrao: "IFOOD",
    tipo_padrao: "contem",
    categoria_id: "restaurantes",
    ...campos,
  });
const perfil = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "perfis_importacao", id, {
    banco: "meu-banco",
    tipo_conta: "conta",
    formato: "csv",
    ...campos,
  });

describe("migração financas-cadastro", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com as categorias padrão, de um nível, e as chaves conferidas", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    const padroes = categorias(db) as { id: string; tipo: string; categoria_pai_id: string | null }[];
    expect(padroes.length).toBeGreaterThan(0);
    expect(padroes.every((c) => c.categoria_pai_id === null)).toBe(true);
    expect(new Set(padroes.map((c) => c.tipo))).toEqual(new Set(["gasto", "receita", "transferencia"]));
    expect(padroes.filter((c) => c.tipo === "transferencia").map((c) => c.id)).toEqual(["transferencia"]);
    expect(padroes.map((c) => c.id)).toEqual(expect.arrayContaining(["mercado", "restaurantes", "salario"]));
    // Contas, regras e perfis nascem vazios: os perfis de fábrica chegam com arquivo conferido.
    expect(ids(db, "contas")).toEqual([]);
    expect(ids(db, "regras_categoria")).toEqual([]);
    expect(ids(db, "perfis_importacao")).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.7.0 sem mexer no que já estava", () => {
    expect(posicao).toBeGreaterThan(0);
    const pasta = mkdtempSync(join(tmpdir(), "moductus-financas-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, posicao));
    expect(versaoAtual(antigo)).toBe(posicao);
    antigo.prepare("UPDATE agentes SET nome = 'Tulinha' WHERE id = 'tula'").run();
    antigo
      .prepare("INSERT INTO tarefas (id, lista_id, titulo) VALUES ('t1', 'entrada', 'pagar o aluguel')")
      .run();
    antigo.close();

    const db = abrirBanco(pasta, { duravel: false });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(categorias(db)).toEqual(categorias(bancoNovo()));
    expect(db.prepare("SELECT nome FROM agentes WHERE id = 'tula'").get()).toEqual({ nome: "Tulinha" });
    expect(db.prepare("SELECT titulo FROM tarefas WHERE id = 't1'").get()).toEqual({
      titulo: "pagar o aluguel",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("as categorias semeadas têm o mesmo id em dois bancos novos", () => {
    const casa = categorias(bancoNovo());
    const trabalho = categorias(bancoNovo());
    expect(casa).toEqual(trabalho);
    // Id fixo, legível, não ULID: é o que junta as categorias de dois PCs sem duplicar.
    for (const { id } of casa as { id: string }[]) expect(id).toMatch(/^[a-z_]+$/);
  });

  test("só a subcategoria e a regra apontam para a categoria, sem apagar nem mudar linha viva", () => {
    const db = bancoNovo();
    const chaves = TABELAS.flatMap((t) =>
      (
        db
          .prepare('SELECT "from" AS coluna, "table" AS alvo, on_delete FROM pragma_foreign_key_list(?)')
          .all(t) as { coluna: string; alvo: string; on_delete: string }[]
      ).map((fk) => `${t}.${fk.coluna} -> ${fk.alvo} (${fk.on_delete})`),
    );
    expect(chaves.sort()).toEqual([
      "categorias.categoria_pai_id -> categorias (NO ACTION)",
      "regras_categoria.categoria_id -> categorias (NO ACTION)",
    ]);
    expect(() => regra(db, "r1", { categoria_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
    expect(() => categoria(db, "c1", { categoria_pai_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
  });

  test("conta: tipo, moeda e saldo inicial; só o cartão tem os campos de cartão, e precisa dos dias", () => {
    const db = bancoNovo();
    conta(db, "corrente", { saldo_inicial_centavos: -1050, saldo_inicial_em: "2026-11-01", banco: "nubank" });
    conta(db, "dolar", { tipo: "investimento", moeda: "USD" });
    cartao(db, "cartao", { limite_centavos: 500000, conta_pagamento_id: "corrente", dia_fechamento: 31 });
    expect(
      db.prepare("SELECT moeda, ativa, saldo_inicial_centavos FROM contas WHERE id = 'cartao'").get(),
    ).toEqual({ moeda: "BRL", ativa: 1, saldo_inicial_centavos: 0 });

    expect(() => conta(db, "tipo", { tipo: "cripto" })).toThrow(/CHECK/);
    expect(() => conta(db, "moeda", { moeda: "real" })).toThrow(/CHECK/);
    expect(() => conta(db, "dia", { saldo_inicial_em: "01/11/2026" })).toThrow(/CHECK/);
    expect(() => conta(db, "ativa", { ativa: 2 })).toThrow(/CHECK/);
    expect(() => conta(db, "centavos", { saldo_inicial_centavos: 10.5 })).toThrow(/cannot store REAL/);
    expect(() => conta(db, "corrente-com-fechamento", { dia_fechamento: 3 })).toThrow(/CHECK/);
    expect(() => conta(db, "corrente-com-limite", { limite_centavos: 100 })).toThrow(/CHECK/);
    expect(() => conta(db, "corrente-paga", { conta_pagamento_id: "corrente" })).toThrow(/CHECK/);
    expect(() => cartao(db, "sem-fechamento", { dia_fechamento: null })).toThrow(/CHECK/);
    expect(() => cartao(db, "sem-vencimento", { dia_vencimento: null })).toThrow(/CHECK/);
    expect(() => cartao(db, "dia-32", { dia_fechamento: 32 })).toThrow(/CHECK/);
    expect(() => cartao(db, "dia-0", { dia_vencimento: 0 })).toThrow(/CHECK/);
    expect(() => cartao(db, "limite-zero", { limite_centavos: 0 })).toThrow(/CHECK/);
    expect(() => cartao(db, "paga-a-si", { conta_pagamento_id: "paga-a-si" })).toThrow(/CHECK/);
    expect(() => conta(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);
    expect(() => conta(db, "apagada-errado", { apagado_em: "2026-11-21" })).toThrow(/CHECK/);
  });

  test("categoria: gasto, receita ou transferência, com subcategoria de um nível só", () => {
    const db = bancoNovo();
    categoria(db, "filha", { categoria_pai_id: "casa", nome: "Mercado do bairro" });
    categoria(db, "solta");
    expect(() => categoria(db, "tipo", { tipo: "investimento" })).toThrow(/CHECK/);
    expect(() => categoria(db, "neta", { categoria_pai_id: "filha" })).toThrow(/um nível/);
    expect(() =>
      db.prepare("UPDATE categorias SET categoria_pai_id = 'filha' WHERE id = 'solta'").run(),
    ).toThrow(/um nível/);
    expect(() =>
      db.prepare("UPDATE categorias SET categoria_pai_id = 'solta' WHERE id = 'casa'").run(),
    ).toThrow(/um nível/);
    expect(() => db.prepare("UPDATE categorias SET categoria_pai_id = id WHERE id = 'solta'").run()).toThrow(
      /CHECK/,
    );
    db.prepare("UPDATE categorias SET categoria_pai_id = 'solta' WHERE id = 'filha'").run();
    expect(db.prepare("SELECT categoria_pai_id FROM categorias WHERE id = 'filha'").get()).toEqual({
      categoria_pai_id: "solta",
    });
  });

  test("regra: padrão não vazio, tipo conhecido, contagem que não fica negativa e quem criou", () => {
    const db = bancoNovo();
    regra(db, "r-usuario");
    regra(db, "r-agente", {
      padrao: "^UBER",
      tipo_padrao: "regex",
      criada_por: "agente",
      categoria_id: "transporte",
    });
    expect(
      db.prepare("SELECT vezes_aplicada, criada_por FROM regras_categoria WHERE id = 'r-usuario'").get(),
    ).toEqual({
      vezes_aplicada: 0,
      criada_por: "usuario",
    });
    expect(() => regra(db, "vazia", { padrao: "  " })).toThrow(/CHECK/);
    expect(() => regra(db, "tipo", { tipo_padrao: "igual" })).toThrow(/CHECK/);
    expect(() => regra(db, "negativa", { vezes_aplicada: -1 })).toThrow(/CHECK/);
    expect(() => regra(db, "quem", { criada_por: "importacao" })).toThrow(/CHECK/);
  });

  test("perfil: formato e tipo de conta conhecidos, mapeamento em objeto JSON, separador de um caractere", () => {
    const db = bancoNovo();
    perfil(db, "csv", {
      mapeamento: '{"data":0,"valor":3}',
      separador: ";",
      formato_decimal: ",",
      codificacao: "windows-1252",
    });
    perfil(db, "ofx", { formato: "ofx", tipo_conta: "cartao" });
    expect(db.prepare("SELECT mapeamento, de_fabrica FROM perfis_importacao WHERE id = 'ofx'").get()).toEqual(
      {
        mapeamento: "{}",
        de_fabrica: 0,
      },
    );
    expect(() => perfil(db, "formato", { formato: "pdf" })).toThrow(/CHECK/);
    expect(() => perfil(db, "tipo", { tipo_conta: "poupanca" })).toThrow(/CHECK/);
    expect(() => perfil(db, "json", { mapeamento: "data=0" })).toThrow(/CHECK/);
    expect(() => perfil(db, "lista", { mapeamento: "[0, 1]" })).toThrow(/CHECK/);
    expect(() => perfil(db, "separador", { separador: ";;" })).toThrow(/CHECK/);
    expect(() => perfil(db, "decimal", { formato_decimal: "virgula" })).toThrow(/CHECK/);
  });

  test("a limpeza da lixeira leva a categoria com as regras dela e respeita a que ainda tem regra viva", () => {
    const db = bancoNovo();
    categoria(db, "cat-com-regra-vencida", { apagado_em: diasAtras(40) });
    regra(db, "regra-vencida", { categoria_id: "cat-com-regra-vencida", apagado_em: diasAtras(35) });
    categoria(db, "cat-com-regra-viva", { apagado_em: diasAtras(40) });
    regra(db, "regra-viva", { categoria_id: "cat-com-regra-viva" });
    categoria(db, "mae-vencida", { apagado_em: diasAtras(40) });
    categoria(db, "filha-vencida", { categoria_pai_id: "mae-vencida", apagado_em: diasAtras(40) });
    conta(db, "conta-vencida", { apagado_em: diasAtras(31) });
    conta(db, "conta-recente", { apagado_em: diasAtras(29) });
    perfil(db, "perfil-vencido", { apagado_em: diasAtras(31) });

    limparLixeira(db, AGORA);
    const restantes = ids(db, "categorias");
    expect(restantes).toContain("cat-com-regra-viva");
    for (const id of ["cat-com-regra-vencida", "mae-vencida", "filha-vencida"]) {
      expect(restantes).not.toContain(id);
    }
    expect(ids(db, "regras_categoria")).toEqual(["regra-viva"]);
    expect(ids(db, "contas")).toEqual(["conta-recente"]);
    expect(ids(db, "perfis_importacao")).toEqual([]);
  });
});
