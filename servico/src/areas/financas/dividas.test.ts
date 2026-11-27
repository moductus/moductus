import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type MudancaFinancas, type NovaDivida } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { atendentesDasDividas } from "./canal-dividas.ts";
import { RepositorioCategorias, ServicoCategorias } from "./categorias.ts";
import { RepositorioContas, ServicoContas } from "./contas.ts";
import {
  amortizar,
  custoTotal,
  ErroDasDividas,
  LIMITE_MESES,
  MENSAGEM_DIVIDA_NAO_ENCONTRADA,
  MENSAGEM_DIVIDA_QUITADA,
  MENSAGEM_LANCAMENTO_DE_TRANSFERENCIA,
  MENSAGEM_LANCAMENTO_JA_LIGADO,
  MENSAGEM_LANCAMENTO_NAO_E_SAIDA,
  MENSAGEM_NADA_PARA_SIMULAR,
  MENSAGEM_PAGAMENTO_ANTES_DO_SALDO,
  MENSAGEM_PAGAMENTO_EM_REAL,
  MENSAGEM_SIMULACAO_SEM_FIM,
  MENSAGEM_VALOR_DO_LANCAMENTO,
  MENSAGEM_VALOR_GRANDE_DEMAIS,
  parcelasCobertas,
  proximaParcela,
  RepositorioDividas,
  ServicoDividas,
  simularQuitacao,
  type DividaParaSimular,
} from "./dividas.ts";
import { ErroDosLancamentos, RepositorioLancamentos, ServicoLancamentos } from "./lancamentos.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Os números destes testes são de mesa: cada mês, juros sobre o saldo (meio-para-cima no centavo),
// depois a parcela. As contas estão escritas ao lado de cada caso.

describe("amortização e custo total", () => {
  test("R$ 1.000,00 a 10% com parcela de R$ 600,00: duas parcelas, R$ 150,00 de juros", () => {
    // Mês 1: 1.000 + 100 = 1.100 − 600 = 500. Mês 2: 500 + 50 = 550, a última parcela.
    expect(amortizar(100_000, 1000, 60_000)).toEqual({
      parcelas: 2,
      jurosCentavos: 15_000,
      ultimaParcelaCentavos: 55_000,
    });
    expect(custoTotal(100_000, 1000, 60_000)).toBe(15_000);
  });

  test("o exemplo do contrato: R$ 6.400,00 a 2,1% com R$ 452,10 acaba em 17, a última de R$ 441,17", () => {
    // Não é 17 × 452,10 − 6.400 = 1.285,70: a 17ª parcela é menor.
    expect(amortizar(640_000, 210, 45_210)).toEqual({
      parcelas: 17,
      jurosCentavos: 127_477,
      ultimaParcelaCentavos: 44_117,
    });
  });

  test("parcela que não passa dos juros do mês não acaba: sem custo", () => {
    // 10% de R$ 1.000,00 = R$ 100,00 de juros no primeiro mês.
    expect(amortizar(100_000, 1000, 10_000)).toBeNull();
    expect(amortizar(100_000, 1000, 9_999)).toBeNull();
    expect(custoTotal(100_000, 1000, 10_000)).toBeNull();
    // Um centavo acima dos juros já acaba (a 10%, em 98 meses).
    expect(amortizar(100_000, 1000, 10_001)?.parcelas).toBe(98);
    // R$ 1.000.000,00 a 0,01% (R$ 100,00 de juros) com R$ 100,01 leva mais de 100 anos: sem custo.
    expect(LIMITE_MESES).toBe(1200);
    expect(amortizar(100_000_000, 1, 10_001)).toBeNull();
    expect(custoTotal(100_000_000, 1, 10_001)).toBeNull();
  });

  test("dívida sem taxa ou sem parcela fica fora do custo; a quitada custa zero", () => {
    expect(custoTotal(100_000, 0, 60_000)).toBeNull();
    expect(custoTotal(100_000, 1000, null)).toBeNull();
    expect(custoTotal(0, 1000, 60_000)).toBe(0);
  });

  test("a próxima parcela é o primeiro vencimento depois da data do saldo; mês curto usa o último dia", () => {
    expect(proximaParcela("2026-10-01", 10)).toBe("2026-10-10");
    expect(proximaParcela("2026-10-10", 10)).toBe("2026-11-10");
    expect(proximaParcela("2026-10-20", 10)).toBe("2026-11-10");
    expect(proximaParcela("2026-12-15", 10)).toBe("2027-01-10");
    expect(proximaParcela("2027-01-31", 31)).toBe("2027-02-28");
    expect(proximaParcela("2028-02-01", 30)).toBe("2028-02-29");
  });
});

const divida = (
  id: string,
  saldo: number,
  bp: number,
  parcela: number,
  inicio = "2027-01",
): DividaParaSimular => ({ id, saldoCentavos: saldo, jurosMensalBp: bp, parcelaCentavos: parcela, inicio });

describe("simulação mês a mês", () => {
  // R$ 1.000,00 a 10% ao mês, parcela de R$ 600,00.
  const a = divida("a", 100_000, 1000, 60_000);

  test("uma dívida sem extra: as parcelas, em dois meses, R$ 150,00 de juros", () => {
    expect(simularQuitacao([a], 0, "semExtra")).toEqual({
      meses: 2,
      terminaEm: "2027-02",
      jurosPagosCentavos: 15_000,
      quitacoes: [{ id: "a", mes: "2027-02" }],
    });
  });

  test("uma dívida com R$ 400,00 a mais: o extra abate junto e os juros caem para R$ 110,00", () => {
    // Mês 1: 1.000 + 100 = 1.100 − 600 − 400 = 100. Mês 2: 100 + 10 = 110, a última.
    for (const estrategia of ["maiorJuro", "menorSaldo"] as const) {
      expect(simularQuitacao([a], 40_000, estrategia)).toEqual({
        meses: 2,
        terminaEm: "2027-02",
        jurosPagosCentavos: 11_000,
        quitacoes: [{ id: "a", mes: "2027-02" }],
      });
    }
    // Só com as parcelas, o extra não conta.
    expect(simularQuitacao([a], 40_000, "semExtra").jurosPagosCentavos).toBe(15_000);
  });

  test("uma dívida com extra alto: acaba no primeiro mês, com os juros dele", () => {
    // 1.000 + 100 = 1.100, e o caixa de 600 + 10.000 paga tudo.
    expect(simularQuitacao([a], 1_000_000, "maiorJuro")).toEqual({
      meses: 1,
      terminaEm: "2027-01",
      jurosPagosCentavos: 10_000,
      quitacoes: [{ id: "a", mes: "2027-01" }],
    });
  });

  describe("duas dívidas com juros diferentes", () => {
    // A: R$ 1.000,00 a 10%, parcela R$ 300,00. B: R$ 500,00 a 2%, parcela R$ 300,00.
    const caro = divida("a", 100_000, 1000, 30_000);
    const barato = divida("b", 50_000, 200, 30_000);

    test("só com as parcelas: a parcela da quitada não vai para a outra", () => {
      // A: 1.000 →(+100) 1.100 − 300 = 800 →(+80) 580 →(+58) 338 →(+33,80) 71,80 →(+7,18) 78,98, a última.
      // B: 500 →(+10) 510 − 300 = 210 →(+4,20) 214,20, a última.
      // Juros: 278,98 + 14,20 = 293,18, em cinco meses.
      expect(simularQuitacao([caro, barato], 0, "semExtra")).toEqual({
        meses: 5,
        terminaEm: "2027-05",
        jurosPagosCentavos: 29_318,
        quitacoes: [
          { id: "b", mes: "2027-02" },
          { id: "a", mes: "2027-05" },
        ],
      });
    });

    test("extra zero nas estratégias: a parcela da quitada passa para a outra", () => {
      // Caixa de 600 por mês. Mês 2: A 880 − 300 = 580; B 214,20 quita; sobram 85,80 → A, 494,20.
      // Mês 3: A 494,20 + 49,42 = 543,62, pago com as duas parcelas. Juros 100 + 10 + 80 + 4,20 + 49,42.
      const esperado = {
        meses: 3,
        terminaEm: "2027-03",
        jurosPagosCentavos: 24_362,
        quitacoes: [
          { id: "b", mes: "2027-02" },
          { id: "a", mes: "2027-03" },
        ],
      };
      expect(simularQuitacao([caro, barato], 0, "maiorJuro")).toEqual(esperado);
      expect(simularQuitacao([caro, barato], 0, "menorSaldo")).toEqual(esperado);
    });

    test("com R$ 100,00 a mais, maior juro primeiro paga R$ 8,80 a menos que menor saldo primeiro", () => {
      // Maior juro (A primeiro), caixa 700:
      //   mês 1: A 1.100 − 300 − 100 = 700; B 510 − 300 = 210.
      //   mês 2: A 770 − 300 = 470; B 214,20 quita; sobram 185,80 → A, 284,20.
      //   mês 3: A 284,20 + 28,42 = 312,62, pago. Juros 100 + 10 + 70 + 4,20 + 28,42 = 212,62.
      expect(simularQuitacao([caro, barato], 10_000, "maiorJuro")).toEqual({
        meses: 3,
        terminaEm: "2027-03",
        jurosPagosCentavos: 21_262,
        quitacoes: [
          { id: "b", mes: "2027-02" },
          { id: "a", mes: "2027-03" },
        ],
      });
      // Menor saldo (B primeiro), caixa 700:
      //   mês 1: A 1.100 − 300 = 800; B 510 − 300 − 100 = 110.
      //   mês 2: A 880 − 300 = 580; B 112,20 quita; sobram 287,80 → A, 292,20.
      //   mês 3: A 292,20 + 29,22 = 321,42, pago. Juros 100 + 10 + 80 + 2,20 + 29,22 = 221,42.
      expect(simularQuitacao([caro, barato], 10_000, "menorSaldo")).toEqual({
        meses: 3,
        terminaEm: "2027-03",
        jurosPagosCentavos: 22_142,
        quitacoes: [
          { id: "b", mes: "2027-02" },
          { id: "a", mes: "2027-03" },
        ],
      });
    });

    test("com extra alto, as duas quitam no primeiro mês, só com os juros dele, na ordem da fila", () => {
      const resultado = (primeira: string, segunda: string) => ({
        meses: 1,
        terminaEm: "2027-01",
        jurosPagosCentavos: 11_000,
        quitacoes: [
          { id: primeira, mes: "2027-01" },
          { id: segunda, mes: "2027-01" },
        ],
      });
      expect(simularQuitacao([caro, barato], 10_000_000, "maiorJuro")).toEqual(resultado("a", "b"));
      expect(simularQuitacao([caro, barato], 10_000_000, "menorSaldo")).toEqual(resultado("b", "a"));
    });
  });

  test("a dívida que começa depois entra no mês dela, e o caixa cresce com a parcela dela", () => {
    // A (R$ 1.000,00, 10%, R$ 600,00) desde jan; B (R$ 500,00, 2%, R$ 300,00) desde fev.
    // Jan: A 1.100 − 600 = 500. Fev: A 550 quita; B 510 − 300 = 210; caixa 900 − 850 = 50 → B, 160.
    // Mar: B 160 + 3,20 = 163,20, pago. Juros 100 + 50 + 10 + 3,20.
    const desdeJan = divida("a", 100_000, 1000, 60_000, "2027-01");
    const desdeFev = divida("b", 50_000, 200, 30_000, "2027-02");
    expect(simularQuitacao([desdeJan, desdeFev], 0, "maiorJuro")).toEqual({
      meses: 3,
      terminaEm: "2027-03",
      jurosPagosCentavos: 16_320,
      quitacoes: [
        { id: "a", mes: "2027-02" },
        { id: "b", mes: "2027-03" },
      ],
    });
    // Só com as parcelas, B segue com a dela: 210 + 4,20 = 214,20 em março.
    expect(simularQuitacao([desdeJan, desdeFev], 0, "semExtra").jurosPagosCentavos).toBe(16_420);
  });

  test("bate com o quadro DividaPlano: empréstimo e crediário com R$ 200,00 a mais", () => {
    // Empréstimo R$ 6.082,30 a 2,1% com R$ 452,10; crediário R$ 1.138,27 a 1,49% com R$ 152,00.
    const emprestimo = divida("emprestimo", 608_230, 210, 45_210, "2026-12");
    const crediario = divida("crediario", 113_827, 149, 15_200, "2026-12");
    expect(custoTotal(608_230, 210, 45_210)).toBe(114_037);
    expect(custoTotal(113_827, 149, 15_200)).toBe(7_764);
    expect(simularQuitacao([emprestimo, crediario], 20_000, "semExtra")).toMatchObject({
      meses: 16,
      terminaEm: "2028-03",
      jurosPagosCentavos: 121_801,
    });
    expect(simularQuitacao([emprestimo, crediario], 20_000, "maiorJuro")).toEqual({
      meses: 11,
      terminaEm: "2027-10",
      jurosPagosCentavos: 82_755,
      quitacoes: [
        { id: "crediario", mes: "2027-07" },
        { id: "emprestimo", mes: "2027-10" },
      ],
    });
    expect(simularQuitacao([emprestimo, crediario], 20_000, "menorSaldo")).toEqual({
      meses: 11,
      terminaEm: "2027-10",
      jurosPagosCentavos: 84_621,
      quitacoes: [
        { id: "crediario", mes: "2027-03" },
        { id: "emprestimo", mes: "2027-10" },
      ],
    });
  });
});

describe("fila e limite da simulação", () => {
  // Com extra alto, tudo quita no primeiro mês, e as quitações saem na ordem da fila.
  const ordem = (dividas: DividaParaSimular[], estrategia: "maiorJuro" | "menorSaldo") =>
    simularQuitacao(dividas, 100_000_000, estrategia).quitacoes.map((q) => q.id);

  test("maior juro primeiro, no empate da taxa, vai o menor saldo; depois, o id", () => {
    expect(ordem([divida("a", 50_000, 200, 10_000), divida("z", 30_000, 200, 10_000)], "maiorJuro")).toEqual([
      "z",
      "a",
    ]);
    expect(ordem([divida("z", 30_000, 200, 10_000), divida("a", 30_000, 200, 10_000)], "maiorJuro")).toEqual([
      "a",
      "z",
    ]);
  });

  test("menor saldo primeiro, no empate do saldo, vai o maior juro; depois, o id", () => {
    expect(ordem([divida("a", 50_000, 100, 10_000), divida("z", 50_000, 300, 10_000)], "menorSaldo")).toEqual(
      ["z", "a"],
    );
    expect(ordem([divida("z", 50_000, 300, 10_000), divida("a", 50_000, 300, 10_000)], "menorSaldo")).toEqual(
      ["a", "z"],
    );
  });

  test("a simulação que passa de 100 anos recusa com o próprio motivo", () => {
    // R$ 1.000.000,00 a 0,01% com R$ 100,01: mais de 1200 meses.
    expect(() => simularQuitacao([divida("x", 100_000_000, 1, 10_001)], 0, "semExtra")).toThrow(
      new ErroDasDividas(MENSAGEM_SIMULACAO_SEM_FIM),
    );
  });
});

describe("parcelas cobertas por um pagamento", () => {
  test("os vencimentos depois do saldo até o dia do pagamento", () => {
    expect(parcelasCobertas("2026-10-20", "2026-11-20", 20)).toEqual({ parcelas: 1, saldoEm: "2026-11-20" });
    expect(parcelasCobertas("2026-10-20", "2026-12-21", 20)).toEqual({ parcelas: 2, saldoEm: "2026-12-21" });
    // Fevereiro curto: o vencimento de dia 31 cai em 28/02.
    expect(parcelasCobertas("2027-01-31", "2027-02-28", 31)).toEqual({ parcelas: 1, saldoEm: "2027-02-28" });
  });

  test("antes do dia, no mesmo mês, é a parcela do mês; em outro mês ou no dia do saldo, é extra", () => {
    expect(parcelasCobertas("2026-10-20", "2026-11-18", 20)).toEqual({ parcelas: 1, saldoEm: "2026-11-20" });
    expect(parcelasCobertas("2026-11-20", "2026-11-25", 20)).toEqual({ parcelas: 0, saldoEm: "2026-11-25" });
    expect(parcelasCobertas("2026-11-20", "2026-11-20", 20)).toEqual({ parcelas: 0, saldoEm: "2026-11-20" });
  });

  test("sem dia de vencimento, os meses de calendário", () => {
    expect(parcelasCobertas("2026-10-15", "2026-11-03", null)).toEqual({
      parcelas: 1,
      saldoEm: "2026-11-03",
    });
    expect(parcelasCobertas("2026-10-15", "2027-01-01", null)).toEqual({
      parcelas: 3,
      saldoEm: "2027-01-01",
    });
    expect(parcelasCobertas("2026-11-03", "2026-11-30", null)).toEqual({
      parcelas: 0,
      saldoEm: "2026-11-30",
    });
  });
});

/**
 * Banco migrado de verdade, com contas, categorias e lançamentos reais ao lado, e um relógio que anda
 * 1 ms a cada leitura. Hoje é sexta, 27/11/2026, em São Paulo.
 */
function montar(agora = "2026-11-27T15:00:00.000Z") {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-dividas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  let ms = new Date(agora).getTime();
  const relogio = () => new Date(ms++);
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
  const servico = new ServicoDividas(new RepositorioDividas(db), { lancamentos, lerFuso: fuso }, avisos, {
    agora: relogio,
  });
  const corrente = contas.criarConta({ nome: "Nubank", tipo: "corrente" });
  eventos.length = 0;
  return { db, servico, contas, lancamentos, eventos, corrente };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

/** O exemplo do quadro: R$ 6.400,00 em 20/10 a 2,1%, faltam 17 de R$ 452,10, vence dia 20. */
const EMPRESTIMO: NovaDivida = {
  nome: "Empréstimo pessoal",
  credor: "Cooperativa",
  tipo: "emprestimo",
  saldoCentavos: 640_000,
  saldoEm: "2026-10-20",
  jurosMensalBp: 210,
  parcelaCentavos: 45_210,
  parcelasRestantes: 17,
  diaVencimento: 20,
};

const mudancas = (db: DatabaseSync) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

describe("cadastro", () => {
  test("criar devolve o custo pela amortização e a próxima parcela; avisa a mudança", () => {
    const { servico, eventos } = montar();
    const criada = servico.criar(EMPRESTIMO);
    confere("dividas.criar", criada);
    expect(criada).toMatchObject({
      nome: "Empréstimo pessoal",
      saldoCentavos: 640_000,
      custoTotalCentavos: 127_477,
      proximaParcelaEm: "2026-11-20",
      quitadaEm: null,
      origem: "usuario",
    });
    expect(eventos).toEqual([{ partes: ["dividas"], lancamentos: [], apagados: [] }]);
    expect(servico.obter({ id: criada.id })).toEqual(criada);
  });

  test("sem juros, zero e sem custo; sem parcela ou com parcela abaixo dos juros, sem custo", () => {
    const { servico } = montar();
    const pessoal = servico.criar({
      nome: "Ana",
      tipo: "pessoal",
      saldoCentavos: 50_000,
      saldoEm: "2026-11-01",
    });
    expect(pessoal).toMatchObject({ jurosMensalBp: 0, custoTotalCentavos: null, proximaParcelaEm: null });
    const semParcela = servico.criar({ ...EMPRESTIMO, parcelaCentavos: null });
    expect(semParcela.custoTotalCentavos).toBeNull();
    const naoAcaba = servico.criar({ ...EMPRESTIMO, parcelaCentavos: 13_440 });
    expect(naoAcaba.custoTotalCentavos).toBeNull();
  });

  test("listar mostra as em aberto; com `todas`, também as quitadas, por último", () => {
    const { servico } = montar();
    const quitada = servico.criar({ ...EMPRESTIMO, nome: "A antiga" });
    servico.quitar({ id: quitada.id, data: "2026-11-01" });
    const aberta = servico.criar({ ...EMPRESTIMO, nome: "Z nova" });
    expect(servico.listar().map((d) => d.id)).toEqual([aberta.id]);
    const todas = servico.listar({ todas: true });
    confere("dividas.listar", todas);
    expect(todas.map((d) => d.id)).toEqual([aberta.id, quitada.id]);
  });

  test("definir muda só o que veio e recalcula; a quitada que volta a ter saldo reabre", () => {
    const { servico } = montar();
    const criada = servico.criar(EMPRESTIMO);
    const mudada = servico.definir({ id: criada.id, credor: null, parcelaCentavos: 60_000 });
    confere("dividas.definir", mudada);
    expect(mudada).toMatchObject({ credor: null, parcelaCentavos: 60_000, nome: "Empréstimo pessoal" });
    expect(mudada.custoTotalCentavos).toBe(custoTotal(640_000, 210, 60_000));
    servico.quitar({ id: criada.id, data: "2026-11-25" });
    const reaberta = servico.definir({ id: criada.id, saldoCentavos: 10_000, saldoEm: "2026-11-26" });
    expect(reaberta).toMatchObject({ quitadaEm: null, saldoCentavos: 10_000 });
  });

  test("saldo editado para zero quita: no dia do saldo que veio, ou hoje", () => {
    const { servico } = montar();
    const comDia = servico.criar(EMPRESTIMO);
    expect(servico.definir({ id: comDia.id, saldoCentavos: 0, saldoEm: "2026-11-22" })).toMatchObject({
      quitadaEm: "2026-11-22",
      saldoEm: "2026-11-22",
      parcelasRestantes: 0,
      proximaParcelaEm: null,
    });
    const semDia = servico.criar(EMPRESTIMO);
    expect(servico.definir({ id: semDia.id, saldoCentavos: 0 }).quitadaEm).toBe("2026-11-27");
    expect(servico.listar()).toEqual([]);
  });

  test("com saldo, há próxima parcela mesmo com as parcelas restantes em zero", () => {
    const { servico } = montar();
    const criada = servico.criar({ ...EMPRESTIMO, saldoCentavos: 21_000, parcelasRestantes: 0 });
    expect(criada.proximaParcelaEm).toBe("2026-11-20");
  });

  test("apagar manda à lixeira: some da lista e de obter", () => {
    const { db, servico, eventos } = montar();
    const criada = servico.criar(EMPRESTIMO);
    eventos.length = 0;
    expect(servico.apagar({ id: criada.id })).toEqual({ ids: [criada.id] });
    expect(eventos).toEqual([{ partes: ["dividas"], lancamentos: [], apagados: [] }]);
    expect(servico.listar({ todas: true })).toEqual([]);
    expect(() => servico.obter({ id: criada.id })).toThrow(MENSAGEM_DIVIDA_NAO_ENCONTRADA);
    const linha = db.prepare("SELECT apagado_em FROM dividas WHERE id = ?").get(criada.id) as {
      apagado_em: string | null;
    };
    expect(linha.apagado_em).not.toBeNull();
  });
});

describe("pagamento", () => {
  test("primeiro os juros do mês, depois o resto abate o saldo; falta uma parcela a menos", () => {
    const { servico, eventos } = montar();
    const criada = servico.criar(EMPRESTIMO);
    eventos.length = 0;
    // Juros de novembro: 2,1% de 6.400,00 = 134,40; abate 452,10 − 134,40 = 317,70; saldo 6.082,30.
    const pago = servico.registrarPagamento({ id: criada.id, valorCentavos: 45_210, data: "2026-11-20" });
    confere("dividas.registrarPagamento", pago);
    expect(pago.lancamento).toBeNull();
    expect(pago.divida).toMatchObject({
      saldoCentavos: 608_230,
      saldoEm: "2026-11-20",
      parcelasRestantes: 16,
      proximaParcelaEm: "2026-12-20",
      custoTotalCentavos: 114_037,
      quitadaEm: null,
    });
    expect(eventos).toEqual([{ partes: ["dividas"], lancamentos: [], apagados: [] }]);
  });

  test("lançado numa conta: a saída entra nos lançamentos com a dívida e o saldo da conta cai", () => {
    const { servico, contas, eventos, corrente } = montar();
    const criada = servico.criar(EMPRESTIMO);
    eventos.length = 0;
    const pago = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 45_210,
      data: "2026-11-20",
      contaId: corrente.id,
    });
    confere("dividas.registrarPagamento", pago);
    expect(pago.lancamento).toMatchObject({
      contaId: corrente.id,
      data: "2026-11-20",
      valorCentavos: -45_210,
      dividaId: criada.id,
      descricao: "Pagamento de Empréstimo pessoal",
    });
    expect(contas.obterConta({ id: corrente.id }).saldoCentavos).toBe(-45_210);
    // Um aviso só, depois da transação, com o lançamento já ligado à dívida.
    expect(eventos).toEqual([
      { partes: ["dividas", "lancamentos", "contas"], lancamentos: [pago.lancamento], apagados: [] },
    ]);
  });

  test("lançado no cartão: cai na fatura, e o aviso leva as faturas", () => {
    const { servico, contas, eventos, corrente } = montar();
    const cartao = contas.criarConta({
      nome: "Cartão Nubank",
      tipo: "cartao",
      diaFechamento: 15,
      diaVencimento: 25,
      contaPagamentoId: corrente.id,
    });
    const criada = servico.criar(EMPRESTIMO);
    eventos.length = 0;
    const pago = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 45_210,
      data: "2026-11-20",
      contaId: cartao.id,
    });
    expect(pago.lancamento?.faturaId).not.toBeNull();
    expect(eventos).toEqual([
      {
        partes: ["dividas", "lancamentos", "contas", "faturas"],
        lancamentos: [pago.lancamento],
        apagados: [],
      },
    ]);
  });

  test("pagamento extra, sem vencimento no meio: sem juros e sem tirar parcela", () => {
    const { servico } = montar();
    const criada = servico.criar(EMPRESTIMO);
    servico.registrarPagamento({ id: criada.id, valorCentavos: 45_210, data: "2026-11-20" });
    // R$ 1.000,00 em 25/11: 6.082,30 − 1.000,00 = 5.082,30, ainda faltam 16.
    const { divida: depois } = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 100_000,
      data: "2026-11-25",
    });
    expect(depois).toMatchObject({
      saldoCentavos: 508_230,
      saldoEm: "2026-11-25",
      parcelasRestantes: 16,
      proximaParcelaEm: "2026-12-20",
    });
    // Extra pequeno nunca sobe o saldo: R$ 10,00 tira R$ 10,00. No próprio dia do saldo, também é extra.
    expect(
      servico.registrarPagamento({ id: criada.id, valorCentavos: 1_000, data: "2026-11-25" }).divida,
    ).toMatchObject({ saldoCentavos: 507_230, parcelasRestantes: 16 });
  });

  test("duas parcelas atrasadas cobram dois meses de juros, compostos, e tiram duas parcelas", () => {
    const { servico } = montar();
    const criada = servico.criar(EMPRESTIMO);
    // Vencimentos de 20/11 e 20/12 desde o saldo de 20/10: 6.400,00 + 134,40 = 6.534,40;
    // 2,1% de 6.534,40 = 137,2224 → 137,22: 6.671,62. Paga 904,20: 5.767,42.
    const { divida } = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 90_420,
      data: "2026-12-21",
    });
    expect(divida).toMatchObject({
      saldoCentavos: 576_742,
      saldoEm: "2026-12-21",
      parcelasRestantes: 15,
      proximaParcelaEm: "2027-01-20",
    });
  });

  test("a parcela do mês paga antes do dia cobre o vencimento; a próxima e a simulação vão ao seguinte", () => {
    const { servico } = montar();
    const criada = servico.criar(EMPRESTIMO);
    // Em 18/11, antes do vencimento de 20/11: os juros do mês entram e o saldo passa a ser o de 20/11.
    const { divida } = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 45_210,
      data: "2026-11-18",
    });
    expect(divida).toMatchObject({
      saldoCentavos: 608_230,
      saldoEm: "2026-11-20",
      parcelasRestantes: 16,
      proximaParcelaEm: "2026-12-20",
    });
    // As 16 que faltam vão de dezembro a março de 2028.
    expect(servico.simular({ extraMensalCentavos: 0, ids: [criada.id] }).semExtra).toMatchObject({
      meses: 16,
      terminaEm: "2028-03",
    });
  });

  test("sem dia de vencimento, os meses de calendário entre o saldo e o pagamento", () => {
    const { servico } = montar();
    // R$ 1.000,00 a 10%: em novembro, um mês de juros (1.100 − 600 = 500); no mesmo mês, extra.
    const criada = servico.criar({
      nome: "Pessoal",
      tipo: "pessoal",
      saldoCentavos: 100_000,
      saldoEm: "2026-10-15",
      jurosMensalBp: 1000,
      parcelaCentavos: 60_000,
    });
    const um = servico.registrarPagamento({ id: criada.id, valorCentavos: 60_000, data: "2026-11-03" });
    expect(um.divida).toMatchObject({ saldoCentavos: 50_000, saldoEm: "2026-11-03", proximaParcelaEm: null });
    const extra = servico.registrarPagamento({ id: criada.id, valorCentavos: 10_000, data: "2026-11-20" });
    expect(extra.divida.saldoCentavos).toBe(40_000);
  });

  test("conta que passa do inteiro seguro volta como erro da regra", () => {
    const { servico } = montar();
    const enorme = servico.criar({
      nome: "Enorme",
      tipo: "outro",
      saldoCentavos: Number.MAX_SAFE_INTEGER,
      saldoEm: "2026-10-20",
      jurosMensalBp: 10_000,
      diaVencimento: 20,
    });
    expect(() => servico.registrarPagamento({ id: enorme.id, valorCentavos: 1, data: "2026-11-20" })).toThrow(
      new ErroDasDividas(MENSAGEM_VALOR_GRANDE_DEMAIS),
    );
    expect(servico.obter({ id: enorme.id }).saldoCentavos).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("ligado ao lançamento do extrato: não cria outro e marca a dívida nele", () => {
    const { db, servico, lancamentos, corrente } = montar();
    const criada = servico.criar(EMPRESTIMO);
    const [extrato] = lancamentos.lancar({
      contaId: corrente.id,
      data: "2026-11-20",
      descricao: "PIX EMPRESTIMO",
      valorCentavos: -45_210,
    });
    const antes = (db.prepare("SELECT count(*) AS n FROM lancamentos").get() as { n: number }).n;
    // A data do pedido não vale: o pagamento é do dia do lançamento.
    const pago = servico.registrarPagamento({
      id: criada.id,
      valorCentavos: 45_210,
      data: "2026-11-26",
      lancamentoId: extrato?.id,
    });
    expect(pago.lancamento).toMatchObject({ id: extrato?.id, dividaId: criada.id });
    expect((db.prepare("SELECT count(*) AS n FROM lancamentos").get() as { n: number }).n).toBe(antes);
    expect(pago.divida).toMatchObject({ saldoCentavos: 608_230, saldoEm: "2026-11-20" });
    // O mesmo lançamento não paga duas vezes, nem esta nem outra dívida.
    const outra = servico.criar({ ...EMPRESTIMO, nome: "Outra" });
    for (const id of [criada.id, outra.id]) {
      expect(() =>
        servico.registrarPagamento({
          id,
          valorCentavos: 45_210,
          data: "2026-11-21",
          lancamentoId: extrato?.id,
        }),
      ).toThrow(MENSAGEM_LANCAMENTO_JA_LIGADO);
    }
  });

  test("o lançamento ligado é uma saída em real, do mesmo valor e fora de transferência", () => {
    const { servico, contas, lancamentos, corrente } = montar();
    const criada = servico.criar(EMPRESTIMO);
    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    const dolar = contas.criarConta({ nome: "Wise", tipo: "corrente", moeda: "USD" });
    const [entrada] = lancamentos.lancar({
      contaId: corrente.id,
      data: "2026-11-20",
      descricao: "Salário",
      valorCentavos: 45_210,
    });
    const [outroValor] = lancamentos.lancar({
      contaId: corrente.id,
      data: "2026-11-20",
      descricao: "PIX",
      valorCentavos: -45_000,
    });
    const [emDolar] = lancamentos.lancar({
      contaId: dolar.id,
      data: "2026-11-20",
      descricao: "Wire",
      valorCentavos: -45_210,
    });
    const [saida] = lancamentos.transferir({
      deContaId: corrente.id,
      paraContaId: poupanca.id,
      data: "2026-11-20",
      valorCentavos: 45_210,
    });
    const pagar = (lancamentoId: string | undefined) => () =>
      servico.registrarPagamento({ id: criada.id, valorCentavos: 45_210, data: "2026-11-20", lancamentoId });
    expect(pagar(entrada?.id)).toThrow(MENSAGEM_LANCAMENTO_NAO_E_SAIDA);
    expect(pagar(outroValor?.id)).toThrow(MENSAGEM_VALOR_DO_LANCAMENTO);
    expect(pagar(emDolar?.id)).toThrow(MENSAGEM_PAGAMENTO_EM_REAL);
    expect(pagar(saida?.id)).toThrow(MENSAGEM_LANCAMENTO_DE_TRANSFERENCIA);
    // O lançamento de setembro é de antes do saldo de 20/10, mesmo com o pedido em novembro.
    const [setembro] = lancamentos.lancar({
      contaId: corrente.id,
      data: "2026-09-15",
      descricao: "PIX EMPRESTIMO",
      valorCentavos: -45_210,
    });
    expect(pagar(setembro?.id)).toThrow(MENSAGEM_PAGAMENTO_ANTES_DO_SALDO);
    // Lançar numa conta em outra moeda também não vale, e nada fica gravado.
    expect(() =>
      servico.registrarPagamento({
        id: criada.id,
        valorCentavos: 45_210,
        data: "2026-11-20",
        contaId: dolar.id,
      }),
    ).toThrow(MENSAGEM_PAGAMENTO_EM_REAL);
    expect(servico.obter({ id: criada.id }).saldoCentavos).toBe(640_000);
  });

  test("conta arquivada: o erro dos lançamentos volta e nem a dívida nem o lançamento ficam", () => {
    const { db, servico, contas, corrente } = montar();
    const criada = servico.criar(EMPRESTIMO);
    contas.definirConta({ id: corrente.id, ativa: false });
    expect(() =>
      servico.registrarPagamento({
        id: criada.id,
        valorCentavos: 45_210,
        data: "2026-11-20",
        contaId: corrente.id,
      }),
    ).toThrow(ErroDosLancamentos);
    expect(servico.obter({ id: criada.id }).saldoCentavos).toBe(640_000);
    expect((db.prepare("SELECT count(*) AS n FROM lancamentos").get() as { n: number }).n).toBe(0);
  });

  test("o pagamento que zera o saldo quita; pagamento de antes do saldo ou na quitada é recusado", () => {
    const { servico } = montar();
    // R$ 500,00 a 2%: 500 + 10 = 510; pagar 600 zera e quita.
    const curta = servico.criar({
      nome: "Cartão antigo",
      tipo: "cartao",
      saldoCentavos: 50_000,
      saldoEm: "2026-11-01",
      jurosMensalBp: 200,
      parcelaCentavos: 30_000,
      parcelasRestantes: 2,
      diaVencimento: 10,
    });
    expect(() =>
      servico.registrarPagamento({ id: curta.id, valorCentavos: 30_000, data: "2026-10-31" }),
    ).toThrow(MENSAGEM_PAGAMENTO_ANTES_DO_SALDO);
    const { divida: quitada } = servico.registrarPagamento({
      id: curta.id,
      valorCentavos: 60_000,
      data: "2026-11-10",
    });
    expect(quitada).toMatchObject({
      saldoCentavos: 0,
      quitadaEm: "2026-11-10",
      parcelasRestantes: 0,
      proximaParcelaEm: null,
    });
    expect(() =>
      servico.registrarPagamento({ id: curta.id, valorCentavos: 100, data: "2026-11-11" }),
    ).toThrow(MENSAGEM_DIVIDA_QUITADA);
  });
});

describe("quitar", () => {
  test("saldo zero, nenhuma parcela, hoje sem dia; quitar de novo é recusado", () => {
    const { servico } = montar();
    const criada = servico.criar(EMPRESTIMO);
    const quitada = servico.quitar({ id: criada.id });
    confere("dividas.quitar", quitada);
    expect(quitada).toMatchObject({
      saldoCentavos: 0,
      saldoEm: "2026-11-27",
      quitadaEm: "2026-11-27",
      parcelasRestantes: 0,
      custoTotalCentavos: 0,
      proximaParcelaEm: null,
    });
    expect(() => servico.quitar({ id: criada.id })).toThrow(MENSAGEM_DIVIDA_QUITADA);
  });
});

describe("simular", () => {
  const CREDIARIO: NovaDivida = {
    nome: "Crediário da geladeira",
    tipo: "financiamento",
    saldoCentavos: 113_827,
    saldoEm: "2026-11-05",
    jurosMensalBp: 149,
    parcelaCentavos: 15_200,
    parcelasRestantes: 8,
    diaVencimento: 5,
  };

  test("as dívidas em aberto, cada uma desde a primeira parcela depois do saldo; nada é gravado", () => {
    const { db, servico, eventos } = montar();
    const emprestimo = servico.criar({ ...EMPRESTIMO, saldoCentavos: 608_230, saldoEm: "2026-11-20" });
    const crediario = servico.criar(CREDIARIO);
    // Fora: a sem taxa, a quitada e a da lixeira.
    servico.criar({ nome: "Ana", tipo: "pessoal", saldoCentavos: 50_000, saldoEm: "2026-11-01" });
    servico.quitar({ id: servico.criar({ ...CREDIARIO, nome: "Quitada" }).id });
    servico.apagar({ id: servico.criar({ ...CREDIARIO, nome: "Apagada" }).id });
    const dividasAntes = servico.listar({ todas: true });
    eventos.length = 0;
    const antes = mudancas(db);
    const simulacao = servico.simular({ extraMensalCentavos: 20_000 });
    confere("dividas.simular", simulacao);
    // As duas começam em dezembro (vencimentos 20 e 5 já passaram em novembro): os números do quadro.
    expect(simulacao).toEqual({
      extraMensalCentavos: 20_000,
      semExtra: {
        meses: 16,
        terminaEm: "2028-03",
        jurosPagosCentavos: 121_801,
        quitacoes: [
          { id: crediario.id, mes: "2027-07" },
          { id: emprestimo.id, mes: "2028-03" },
        ],
      },
      maiorJuro: {
        meses: 11,
        terminaEm: "2027-10",
        jurosPagosCentavos: 82_755,
        quitacoes: [
          { id: crediario.id, mes: "2027-07" },
          { id: emprestimo.id, mes: "2027-10" },
        ],
      },
      menorSaldo: {
        meses: 11,
        terminaEm: "2027-10",
        jurosPagosCentavos: 84_621,
        quitacoes: [
          { id: crediario.id, mes: "2027-03" },
          { id: emprestimo.id, mes: "2027-10" },
        ],
      },
    });
    expect(mudancas(db)).toBe(antes);
    expect(eventos).toEqual([]);
    expect(servico.listar({ todas: true })).toEqual(dividasAntes);
  });

  test("saldo antigo começa no mês de hoje; sem vencimento, no mês seguinte ao do saldo", () => {
    const { servico } = montar();
    // R$ 1.000,00 a 10% com R$ 600,00: dois meses.
    const base = {
      tipo: "outro",
      saldoCentavos: 100_000,
      jurosMensalBp: 1000,
      parcelaCentavos: 60_000,
    } as const;
    const antiga = servico.criar({ ...base, nome: "Antiga", saldoEm: "2026-08-10", diaVencimento: 10 });
    const semDia = servico.criar({ ...base, nome: "Sem dia", saldoEm: "2026-11-27" });
    expect(servico.simular({ extraMensalCentavos: 0, ids: [antiga.id] }).semExtra.terminaEm).toBe("2026-12");
    expect(servico.simular({ extraMensalCentavos: 0, ids: [semDia.id] }).semExtra.terminaEm).toBe("2027-01");
  });

  test("parcela que não passa dos juros do mês é recusada com o motivo", () => {
    const { servico } = montar();
    servico.criar(EMPRESTIMO);
    servico.criar({ ...EMPRESTIMO, nome: "Cartão rotativo", parcelaCentavos: 10_000 });
    expect(() => servico.simular({ extraMensalCentavos: 50_000 })).toThrow(
      "a parcela de Cartão rotativo, R$ 100,00, não passa dos juros do mês, R$ 134,40: só com ela, a dívida não acaba",
    );
  });

  test("pela lista, cada uma precisa de taxa e parcela e estar em aberto; sem nenhuma, o motivo", () => {
    const { servico } = montar();
    const semTaxa = servico.criar({
      nome: "Ana",
      tipo: "pessoal",
      saldoCentavos: 50_000,
      saldoEm: "2026-11-01",
    });
    const semParcela = servico.criar({ ...EMPRESTIMO, nome: "Sem parcela", parcelaCentavos: null });
    const quitada = servico.criar({ ...EMPRESTIMO, nome: "Velha" });
    servico.quitar({ id: quitada.id });
    expect(() => servico.simular({ extraMensalCentavos: 0 })).toThrow(MENSAGEM_NADA_PARA_SIMULAR);
    expect(() => servico.simular({ extraMensalCentavos: 0, ids: [semTaxa.id] })).toThrow(
      "Ana está sem a taxa de juros, e sem ela fica fora da simulação",
    );
    expect(() => servico.simular({ extraMensalCentavos: 0, ids: [semParcela.id] })).toThrow(
      "Sem parcela está sem a parcela, e sem ela fica fora da simulação",
    );
    expect(() => servico.simular({ extraMensalCentavos: 0, ids: [quitada.id] })).toThrow(
      "Velha já está quitada",
    );
    expect(() => servico.simular({ extraMensalCentavos: 0, ids: ["nao-existe"] })).toThrow(
      MENSAGEM_DIVIDA_NAO_ENCONTRADA,
    );
  });
});

describe("canal", () => {
  test("erro da regra passa como veio; erro de dentro vira o texto genérico", () => {
    const { servico, contas, corrente } = montar();
    const atendentes = atendentesDasDividas(servico);
    expect(() => atendentes["dividas.obter"]({ id: "nao-existe" })).toThrow(ErroDasDividas);
    // O erro dos lançamentos (conta arquivada) também passa como veio.
    const criada = servico.criar(EMPRESTIMO);
    contas.definirConta({ id: corrente.id, ativa: false });
    expect(() =>
      atendentes["dividas.registrarPagamento"]({
        id: criada.id,
        valorCentavos: 45_210,
        data: "2026-11-20",
        contaId: corrente.id,
      }),
    ).toThrow(ErroDosLancamentos);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(servico, "listar").mockImplementation(() => {
      throw new Error("SQLITE_BUSY");
    });
    expect(() => atendentes["dividas.listar"]({})).toThrow(MENSAGEM_ERRO_INTERNO);
  });
});
