import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type MudancaFinancas } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { atendentesDoOrcamento } from "./canal-orcamento.ts";
import { RepositorioCategorias, ServicoCategorias } from "./categorias.ts";
import { RepositorioContas, ServicoContas } from "./contas.ts";
import { RepositorioLancamentos, ServicoLancamentos } from "./lancamentos.ts";
import {
  ErroDoOrcamento,
  MENSAGEM_CATEGORIA_ARQUIVADA,
  MENSAGEM_CATEGORIA_NAO_ENCONTRADA,
  MENSAGEM_ORCAMENTO_MUDOU,
  MENSAGEM_ORCAMENTO_NAO_ENCONTRADO,
  MENSAGEM_ORIGEM_SEM_ORCAMENTO,
  MENSAGEM_PASSA_DO_LIMITE,
  MENSAGEM_REMANEJAR_SUMIU,
  MENSAGEM_SO_GASTO,
  PRAZO_DESFAZER_REMANEJAR_MS,
  RepositorioOrcamento,
  semanaNoMes,
  ServicoOrcamento,
} from "./orcamento.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Banco migrado de verdade, com contas, categorias e lançamentos reais ao lado (o gasto vem de
 * `gastoPorCategoria`), e um relógio que só anda quando o teste manda. Hoje é quinta, 11/02/2027,
 * meio-dia em São Paulo: semana 2 de fevereiro, de segunda 08/02 a domingo 14/02, 7 dos 28 dias.
 */
function montar(agora = "2027-02-11T15:00:00.000Z") {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-orcamento-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  let ms = new Date(agora).getTime();
  const relogio = () => new Date(ms);
  const andar = (n: number) => {
    ms += n;
  };
  const eventos: MudancaFinancas[] = [];
  const avisos = { mudou: (m: MudancaFinancas) => eventos.push(m) };
  const fuso = () => "America/Sao_Paulo";
  const contas = new ServicoContas(new RepositorioContas(db), { lerFuso: fuso }, avisos, { agora: relogio });
  const categorias = new ServicoCategorias(new RepositorioCategorias(db), avisos, { agora: relogio });
  const lancamentos = new ServicoLancamentos(
    new RepositorioLancamentos(db),
    { contas, categorias, lerFuso: fuso },
    avisos,
    { agora: relogio },
  );
  const servico = new ServicoOrcamento(new RepositorioOrcamento(db), { lancamentos, lerFuso: fuso }, avisos, {
    agora: relogio,
  });
  const conta = contas.criarConta({ nome: "Nubank", tipo: "corrente" });
  const gasto = (data: string, valor: number, categoriaId: string | null, descricao = "Compra") =>
    lancamentos.lancar({ contaId: conta.id, data, descricao, valorCentavos: -valor, categoriaId });
  return { db, servico, lancamentos, contas, categorias, conta, gasto, eventos, andar };
}

/**
 * Os números do quadro `PainelFinancas`: limites de todo mês Mercado R$ 1.200, Lazer R$ 400 e
 * Transporte R$ 800 (R$ 2.400, R$ 600 na semana de 7 dos 28 dias) e Hortifruti, filha de Mercado,
 * R$ 200. Na semana: Mercado R$ 300 + Hortifruti R$ 80 = R$ 380 contra R$ 300 previstos (passou R$
 * 80), Lazer R$ 20 e Transporte R$ 20: R$ 420 de R$ 600. No mês, Mercado chega a R$ 1.280, R$ 80
 * acima do limite; Lazer gastou R$ 120 e tem R$ 280 sobrando.
 */
function comOQuadro() {
  const m = montar();
  const hortifruti = m.categorias.criarCategoria({
    nome: "Hortifruti",
    tipo: "gasto",
    categoriaPaiId: "mercado",
  });
  m.servico.definirOrcamento({ categoriaId: "mercado", mes: null, limiteCentavos: 120_000 });
  m.servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 40_000 });
  m.servico.definirOrcamento({ categoriaId: "transporte", mes: null, limiteCentavos: 80_000 });
  m.servico.definirOrcamento({ categoriaId: hortifruti.id, mes: null, limiteCentavos: 20_000 });
  // Semana 1 (01 a 07/02).
  m.gasto("2027-02-02", 90_000, "mercado", "Atacadão");
  m.gasto("2027-02-03", 10_000, "lazer", "Cinema");
  // Semana 2 (08 a 14/02).
  m.gasto("2027-02-08", 30_000, "mercado", "Supermercado");
  m.gasto("2027-02-09", 8_000, hortifruti.id, "Feira");
  m.gasto("2027-02-10", 2_000, "lazer", "Sorvete");
  m.gasto("2027-02-09", 2_000, "transporte", "Ônibus");
  // O que não entra: outro mês, categoria sem orçamento, sem categoria, receita e transferência.
  m.gasto("2027-01-31", 50_000, "mercado", "Mercado de janeiro");
  m.gasto("2027-03-01", 50_000, "mercado", "Mercado de março");
  m.gasto("2027-02-09", 7_000, "restaurantes", "Almoço");
  m.gasto("2027-02-10", 3_000, null, "Sem categoria");
  m.lancamentos.lancar({
    contaId: m.conta.id,
    data: "2027-02-05",
    descricao: "Salário",
    valorCentavos: 500_000,
    categoriaId: "salario",
  });
  const poupanca = m.contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
  m.lancamentos.transferir({
    deContaId: m.conta.id,
    paraContaId: poupanca.id,
    data: "2027-02-10",
    valorCentavos: 100_000,
    descricao: "Guardar",
  });
  m.eventos.length = 0;
  return { ...m, hortifruti };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

const linhasDoBanco = (db: DatabaseSync) =>
  db
    .prepare(
      "SELECT categoria_id, mes, limite_centavos FROM orcamentos ORDER BY categoria_id, ifnull(mes, '')",
    )
    .all();

describe("a fala do quadro sai dos números", () => {
  test("R$ 420 de R$ 600 na semana, sobram R$ 180 para 4 dias, e Mercado passou R$ 80", () => {
    const { servico, hortifruti } = comOQuadro();
    const mes = servico.orcamento();
    confere("financas.orcamento", mes);

    expect(mes.mes).toBe("2027-02");
    expect(mes.semana).toEqual({
      inicio: "2027-02-08",
      fim: "2027-02-14",
      previstoCentavos: 60_000,
      gastoCentavos: 42_000,
      diasRestantes: 4,
    });
    const semana = mes.semana;
    expect(semana && semana.previstoCentavos - semana.gastoCentavos).toBe(18_000);

    const mercado = mes.linhas.find((l) => l.categoriaId === "mercado");
    expect(mercado?.semana).toEqual({ previstoCentavos: 30_000, gastoCentavos: 38_000 });
    const naSemana = mercado?.semana;
    expect(naSemana && naSemana.gastoCentavos - naSemana.previstoCentavos).toBe(8_000);
    // No mês, a mãe soma a filha: R$ 1.200 do Atacadão e do supermercado mais R$ 80 da feira.
    expect(mercado).toMatchObject({
      doMes: false,
      limiteCentavos: 120_000,
      gastoCentavos: 128_000,
      percentual: 107,
      sobraCentavos: -8_000,
      situacao: "estourado",
    });

    const lazer = mes.linhas.find((l) => l.categoriaId === "lazer");
    expect(lazer).toMatchObject({
      gastoCentavos: 12_000,
      sobraCentavos: 28_000,
      percentual: 30,
      situacao: "ok",
    });
    expect(lazer?.semana).toEqual({ previstoCentavos: 10_000, gastoCentavos: 2_000 });

    const filha = mes.linhas.find((l) => l.categoriaId === hortifruti.id);
    expect(filha).toMatchObject({ gastoCentavos: 8_000, percentual: 40, sobraCentavos: 12_000 });
    expect(filha?.semana).toEqual({ previstoCentavos: 5_000, gastoCentavos: 8_000 });
  });

  test("o total do mês não conta duas vezes a filha com limite, e a ordem é mãe e filhas por nome", () => {
    const { servico, hortifruti } = comOQuadro();
    const mes = servico.orcamento({ mes: "2027-02" });
    // R$ 1.200 + 400 + 800, sem os R$ 200 da Hortifruti, que já está no gasto de Mercado.
    expect(mes.limiteCentavos).toBe(240_000);
    expect(mes.gastoCentavos).toBe(128_000 + 12_000 + 2_000);
    expect(mes.linhas.map((l) => l.categoriaId)).toEqual(["lazer", "mercado", hortifruti.id, "transporte"]);
  });

  test("fora do mês de hoje não há semana; o mês passado vem só com o limite e o gasto dele", () => {
    const { servico } = comOQuadro();
    const janeiro = servico.orcamento({ mes: "2027-01" });
    confere("financas.orcamento", janeiro);
    expect(janeiro.semana).toBeNull();
    expect(janeiro.linhas.every((l) => l.semana === null)).toBe(true);
    expect(janeiro.linhas.find((l) => l.categoriaId === "mercado")).toMatchObject({
      limiteCentavos: 120_000,
      gastoCentavos: 50_000,
      situacao: "ok",
    });
  });
});

describe("mês sem orçamento", () => {
  test("volta sem linhas, sem limite e sem previsto, mesmo com gasto no mês", () => {
    const { servico, gasto } = montar();
    gasto("2027-02-09", 30_000, "mercado");
    const mes = servico.orcamento();
    confere("financas.orcamento", mes);
    expect(mes).toEqual({ mes: "2027-02", linhas: [], limiteCentavos: 0, gastoCentavos: 0, semana: null });
  });

  test("a linha só de um mês não vale nos outros", () => {
    const { servico } = montar();
    servico.definirOrcamento({ categoriaId: "mercado", mes: "2027-02", limiteCentavos: 120_000 });
    expect(servico.orcamento({ mes: "2027-03" }).linhas).toEqual([]);
    expect(servico.orcamento({ mes: "2027-02" }).linhas).toHaveLength(1);
  });

  test("a categoria na lixeira sai do orçamento", () => {
    const { servico, categorias } = montar();
    servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 40_000 });
    categorias.apagarCategoria({ id: "lazer" });
    expect(servico.orcamento().linhas).toEqual([]);
  });
});

describe("a semana dentro do mês", () => {
  test("a semana que começa no mês anterior fica só com os dias deste", () => {
    // Sexta, 01/01/2027: a semana vai de 28/12 a 03/01, 3 dias em janeiro.
    expect(semanaNoMes("2027-01-01", "2027-01")).toEqual({
      inicio: "2027-01-01",
      fim: "2027-01-03",
      dias: 3,
      diasRestantes: 3,
    });
    // Sábado, 30/01/2027: de 25/01 a 31/01, inteira em janeiro; sobram sábado e domingo.
    expect(semanaNoMes("2027-01-30", "2027-01")).toMatchObject({ dias: 7, diasRestantes: 2 });
    // Domingo é o último dia da semana: domingo, 14/02, ainda é a semana 2.
    expect(semanaNoMes("2027-02-14", "2027-02")).toMatchObject({ inicio: "2027-02-08", diasRestantes: 1 });
  });

  test("o previsto da semana partida é o limite × dias dela no mês ÷ dias do mês", () => {
    const { servico, gasto } = montar("2027-01-01T15:00:00.000Z");
    servico.definirOrcamento({ categoriaId: "mercado", mes: null, limiteCentavos: 124_000 });
    gasto("2026-12-30", 5_000, "mercado");
    gasto("2027-01-01", 3_000, "mercado");
    const mes = servico.orcamento();
    // R$ 1.240 × 3 ÷ 31 = R$ 120; o gasto de dezembro não entra na semana.
    expect(mes.semana).toMatchObject({ previstoCentavos: 12_000, gastoCentavos: 3_000, diasRestantes: 3 });
  });

  test("o previsto arredonda meio-para-cima no centavo", () => {
    const { servico } = montar();
    // R$ 100,02 × 7 ÷ 28 = 2.500,5 centavos.
    servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 10_002 });
    expect(servico.orcamento().linhas[0]?.semana?.previstoCentavos).toBe(2_501);
  });
});

describe("situação da linha", () => {
  test("no alerta a partir do percentual dele, estourado só quando passa do limite", () => {
    const { servico, gasto } = montar();
    servico.definirOrcamento({
      categoriaId: "lazer",
      mes: null,
      limiteCentavos: 10_000,
      alertaPercentual: 90,
    });
    gasto("2027-02-01", 8_900, "lazer");
    expect(servico.orcamento().linhas[0]).toMatchObject({ percentual: 89, situacao: "ok" });
    gasto("2027-02-02", 100, "lazer");
    expect(servico.orcamento().linhas[0]).toMatchObject({ percentual: 90, situacao: "alerta" });
    gasto("2027-02-03", 1_000, "lazer");
    expect(servico.orcamento().linhas[0]).toMatchObject({
      percentual: 100,
      sobraCentavos: 0,
      situacao: "alerta",
    });
    gasto("2027-02-04", 1, "lazer");
    expect(servico.orcamento().linhas[0]).toMatchObject({ sobraCentavos: -1, situacao: "estourado" });
  });

  test("limite zero é não gastar nada: sem gasto está ok, com qualquer gasto passou", () => {
    const { servico, gasto } = montar();
    servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 0 });
    expect(servico.orcamento().linhas[0]).toMatchObject({ percentual: 0, situacao: "ok" });
    gasto("2027-02-01", 1, "lazer");
    expect(servico.orcamento().linhas[0]).toMatchObject({ percentual: 100, situacao: "estourado" });
  });
});

describe("definir e remover", () => {
  test("define em todo mês, muda na mesma linha e a do mês vence a de todo mês", () => {
    const { db, servico, eventos } = montar();
    const todoMes = servico.definirOrcamento({ categoriaId: "mercado", mes: null, limiteCentavos: 120_000 });
    confere("financas.definirOrcamento", todoMes);
    expect(todoMes).toMatchObject({
      mes: null,
      limiteCentavos: 120_000,
      alertaPercentual: 80,
      origem: "usuario",
    });
    expect(eventos.at(-1)).toEqual({ partes: ["orcamento"], lancamentos: [], apagados: [] });

    const mudado = servico.definirOrcamento({
      categoriaId: "mercado",
      mes: null,
      limiteCentavos: 100_000,
      alertaPercentual: 70,
    });
    expect(mudado.id).toBe(todoMes.id);
    expect(mudado).toMatchObject({ limiteCentavos: 100_000, alertaPercentual: 70 });
    // Sem o alerta, a mudança mantém o que estava.
    expect(
      servico.definirOrcamento({ categoriaId: "mercado", mes: null, limiteCentavos: 90_000 })
        .alertaPercentual,
    ).toBe(70);

    servico.definirOrcamento({ categoriaId: "mercado", mes: "2027-02", limiteCentavos: 150_000 });
    expect(servico.orcamento({ mes: "2027-02" }).linhas[0]).toMatchObject({
      doMes: true,
      limiteCentavos: 150_000,
    });
    expect(servico.orcamento({ mes: "2027-03" }).linhas[0]).toMatchObject({
      doMes: false,
      limiteCentavos: 90_000,
    });
    expect(linhasDoBanco(db)).toHaveLength(2);
  });

  test("só categoria de gasto, viva e não arquivada", () => {
    const { servico, categorias } = montar();
    const definir = (categoriaId: string) => () =>
      servico.definirOrcamento({ categoriaId, mes: null, limiteCentavos: 1_000 });
    expect(definir("salario")).toThrow(new ErroDoOrcamento(MENSAGEM_SO_GASTO));
    expect(definir("transferencia")).toThrow(new ErroDoOrcamento(MENSAGEM_SO_GASTO));
    expect(definir("nao-existe")).toThrow(new ErroDoOrcamento(MENSAGEM_CATEGORIA_NAO_ENCONTRADA));
    categorias.definirCategoria({ id: "pets", arquivada: true });
    expect(definir("pets")).toThrow(new ErroDoOrcamento(MENSAGEM_CATEGORIA_ARQUIVADA));
  });

  test("remover tira o limite e a categoria volta a não ter orçamento", () => {
    const { db, servico, eventos } = montar();
    const o = servico.definirOrcamento({ categoriaId: "mercado", mes: null, limiteCentavos: 120_000 });
    eventos.length = 0;
    const apagados = servico.removerOrcamento({ id: o.id });
    confere("financas.removerOrcamento", apagados);
    expect(apagados).toEqual({ ids: [o.id] });
    expect(linhasDoBanco(db)).toEqual([]);
    expect(eventos).toEqual([{ partes: ["orcamento"], lancamentos: [], apagados: [] }]);
    expect(() => servico.removerOrcamento({ id: o.id })).toThrow(
      new ErroDoOrcamento(MENSAGEM_ORCAMENTO_NAO_ENCONTRADO),
    );
  });
});

describe("remanejar", () => {
  test("R$ 80 de Lazer para Mercado só no mês, e desfazer volta ao que era", () => {
    const { db, servico, eventos } = comOQuadro();
    const antes = servico.orcamento({ mes: "2027-02" });
    const bancoAntes = linhasDoBanco(db);

    const r = servico.remanejar({
      deCategoriaId: "lazer",
      paraCategoriaId: "mercado",
      mes: "2027-02",
      valorCentavos: 8_000,
    });
    confere("financas.remanejar", r);
    expect(eventos).toEqual([{ partes: ["orcamento"], lancamentos: [], apagados: [] }]);
    const mercado = r.orcamento.linhas.find((l) => l.categoriaId === "mercado");
    const lazer = r.orcamento.linhas.find((l) => l.categoriaId === "lazer");
    // Mercado cobre os R$ 80 que passaram: R$ 1.280 de R$ 1.280, no alerta mas não estourado.
    expect(mercado).toMatchObject({
      doMes: true,
      limiteCentavos: 128_000,
      sobraCentavos: 0,
      situacao: "alerta",
    });
    expect(lazer).toMatchObject({ doMes: true, limiteCentavos: 32_000, sobraCentavos: 20_000 });
    // O total do mês não muda: o valor só trocou de categoria.
    expect(r.orcamento.limiteCentavos).toBe(antes.limiteCentavos);
    // Os de todo mês ficam como estavam; março não sente nada.
    expect(linhasDoBanco(db)).toEqual(
      expect.arrayContaining([
        { categoria_id: "lazer", mes: null, limite_centavos: 40_000 },
        { categoria_id: "lazer", mes: "2027-02", limite_centavos: 32_000 },
        { categoria_id: "mercado", mes: null, limite_centavos: 120_000 },
        { categoria_id: "mercado", mes: "2027-02", limite_centavos: 128_000 },
      ]),
    );
    expect(
      servico.orcamento({ mes: "2027-03" }).linhas.find((l) => l.categoriaId === "mercado"),
    ).toMatchObject({ doMes: false, limiteCentavos: 120_000 });

    eventos.length = 0;
    const desfeito = servico.desfazerRemanejar({ id: r.id });
    confere("financas.desfazerRemanejar", desfeito);
    expect(desfeito).toEqual(antes);
    expect(linhasDoBanco(db)).toEqual(bancoAntes);
    expect(eventos).toEqual([{ partes: ["orcamento"], lancamentos: [], apagados: [] }]);
    // Uma vez só.
    expect(() => servico.desfazerRemanejar({ id: r.id })).toThrow(
      new ErroDoOrcamento(MENSAGEM_REMANEJAR_SUMIU),
    );
  });

  test("com as linhas do mês já existentes, muda as duas e desfazer devolve os limites e o carimbo", () => {
    const { db, servico } = montar();
    servico.definirOrcamento({
      categoriaId: "lazer",
      mes: "2027-02",
      limiteCentavos: 40_000,
      alertaPercentual: 70,
    });
    servico.definirOrcamento({ categoriaId: "mercado", mes: "2027-02", limiteCentavos: 120_000 });
    const antes = db.prepare("SELECT * FROM orcamentos ORDER BY id").all();

    const r = servico.remanejar(
      { deCategoriaId: "lazer", paraCategoriaId: "mercado", mes: "2027-02", valorCentavos: 40_000 },
      { origem: "agente", agenteId: "tula", execucaoId: null },
    );
    expect(linhasDoBanco(db)).toEqual([
      { categoria_id: "lazer", mes: "2027-02", limite_centavos: 0 },
      { categoria_id: "mercado", mes: "2027-02", limite_centavos: 160_000 },
    ]);
    expect(r.orcamento.linhas.find((l) => l.categoriaId === "lazer")?.alertaPercentual).toBe(70);

    servico.desfazerRemanejar({ id: r.id });
    expect(db.prepare("SELECT * FROM orcamentos ORDER BY id").all()).toEqual(antes);
  });

  test("para categoria sem orçamento, cria a linha do mês com o valor; desfazer a tira", () => {
    const { db, servico } = montar();
    servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 40_000 });
    const r = servico.remanejar({
      deCategoriaId: "lazer",
      paraCategoriaId: "viagens",
      mes: "2027-02",
      valorCentavos: 15_000,
    });
    expect(r.orcamento.linhas.find((l) => l.categoriaId === "viagens")).toMatchObject({
      doMes: true,
      limiteCentavos: 15_000,
      alertaPercentual: 80,
    });
    servico.desfazerRemanejar({ id: r.id });
    expect(linhasDoBanco(db)).toEqual([{ categoria_id: "lazer", mes: null, limite_centavos: 40_000 }]);
  });

  test("recusa sair de categoria sem orçamento no mês ou além do limite dela, sem mudar nada", () => {
    const { db, servico } = montar();
    servico.definirOrcamento({ categoriaId: "lazer", mes: null, limiteCentavos: 40_000 });
    const remanejar = (de: string, valor: number) => () =>
      servico.remanejar({
        deCategoriaId: de,
        paraCategoriaId: "mercado",
        mes: "2027-02",
        valorCentavos: valor,
      });
    expect(remanejar("viagens", 1_000)).toThrow(new ErroDoOrcamento(MENSAGEM_ORIGEM_SEM_ORCAMENTO));
    expect(remanejar("lazer", 40_001)).toThrow(new ErroDoOrcamento(MENSAGEM_PASSA_DO_LIMITE(40_000)));
    expect(MENSAGEM_PASSA_DO_LIMITE(40_000)).toContain("R$ 400,00");
    expect(remanejar("salario", 1_000)).toThrow(new ErroDoOrcamento(MENSAGEM_SO_GASTO));
    expect(linhasDoBanco(db)).toEqual([{ categoria_id: "lazer", mes: null, limite_centavos: 40_000 }]);
  });

  test("não desfaz por cima de um limite mudado depois", () => {
    const { db, servico } = comOQuadro();
    const r = servico.remanejar({
      deCategoriaId: "lazer",
      paraCategoriaId: "mercado",
      mes: "2027-02",
      valorCentavos: 8_000,
    });
    servico.definirOrcamento({ categoriaId: "mercado", mes: "2027-02", limiteCentavos: 130_000 });
    const depois = linhasDoBanco(db);
    expect(() => servico.desfazerRemanejar({ id: r.id })).toThrow(
      new ErroDoOrcamento(MENSAGEM_ORCAMENTO_MUDOU),
    );
    expect(linhasDoBanco(db)).toEqual(depois);
  });

  test("desfaz por 24 horas; depois, e para id que não conhece, diz por que não dá", () => {
    const { servico, andar } = comOQuadro();
    const pedido = {
      deCategoriaId: "lazer",
      paraCategoriaId: "mercado",
      mes: "2027-02",
      valorCentavos: 1_000,
    };
    const primeiro = servico.remanejar(pedido);
    andar(PRAZO_DESFAZER_REMANEJAR_MS);
    expect(() => servico.desfazerRemanejar({ id: primeiro.id })).not.toThrow();

    const segundo = servico.remanejar(pedido);
    andar(PRAZO_DESFAZER_REMANEJAR_MS + 1);
    expect(() => servico.desfazerRemanejar({ id: segundo.id })).toThrow(
      new ErroDoOrcamento(MENSAGEM_REMANEJAR_SUMIU),
    );
    expect(() => servico.desfazerRemanejar({ id: "nao-existe" })).toThrow(
      new ErroDoOrcamento(MENSAGEM_REMANEJAR_SUMIU),
    );
  });
});

describe("orçamento no canal", () => {
  test("erro da regra vai como veio; erro de dentro vira o texto genérico", () => {
    const { servico } = montar();
    const atendentes = atendentesDoOrcamento(servico);
    expect(() =>
      atendentes["financas.definirOrcamento"]({ categoriaId: "salario", mes: null, limiteCentavos: 1 }),
    ).toThrow(MENSAGEM_SO_GASTO);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(servico, "orcamento").mockImplementation(() => {
      throw new Error("SQLITE_BUSY");
    });
    expect(() => atendentes["financas.orcamento"]({})).toThrow(MENSAGEM_ERRO_INTERNO);
  });
});
