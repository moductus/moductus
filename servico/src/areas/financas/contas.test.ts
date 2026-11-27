import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, MudancaFinancas } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { atendentesDasContas, MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import {
  datasDaFatura,
  ErroDasContas,
  impressaoDoLancamento,
  MENSAGEM_CARTAO_SEM_DIAS,
  MENSAGEM_CONTA_COM_LANCAMENTO,
  MENSAGEM_FATURA_NAO_PAGA,
  MENSAGEM_FATURA_PAGA,
  MENSAGEM_FATURA_SEM_VALOR,
  MENSAGEM_MOEDA_COM_LANCAMENTO,
  MENSAGEM_PAGAMENTO_INVALIDO,
  MENSAGEM_PAGAMENTO_NA_LIXEIRA,
  MENSAGEM_SEM_CONTA_PAGAMENTO,
  MENSAGEM_SO_CARTAO,
  RepositorioContas,
  ServicoContas,
} from "./contas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Banco migrado de verdade e um relógio que só anda quando o teste manda (UTC no CI, fuso fixo aqui). */
function montar(agora = "2026-11-10T15:00:00.000Z") {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-contas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const relogio = { agora: new Date(agora) };
  const eventos: MudancaFinancas[] = [];
  const contas = new ServicoContas(
    new RepositorioContas(db),
    { lerFuso: () => "America/Sao_Paulo" },
    { mudou: (m) => eventos.push(m) },
    { agora: () => relogio.agora },
  );
  let n = 0;
  /** Um lançamento gravado direto no banco: os lançamentos são da área ao lado (F4-09). */
  const lancar = (contaId: string, data: string, valor: number, faturaId: string | null = null) => {
    const id = `la${++n}`;
    db.prepare(
      `INSERT INTO lancamentos (id, conta_id, data, descricao, valor_centavos, fatura_id, impressao)
       VALUES (?, ?, ?, 'Compra', ?, ?, ?)`,
    ).run(id, contaId, data, valor, faturaId, impressaoDoLancamento(contaId, data, valor));
    return id;
  };
  return { db, contas, eventos, relogio, lancar };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

describe("fatura pelo dia de fechamento", () => {
  test("a compra do dia do fechamento cai na fatura seguinte; a da véspera, na do mês", () => {
    expect(datasDaFatura("2026-11-14", 15, 25)).toEqual({
      mesReferencia: "2026-11",
      fechaEm: "2026-11-15",
      venceEm: "2026-11-25",
    });
    expect(datasDaFatura("2026-11-15", 15, 25)).toEqual({
      mesReferencia: "2026-12",
      fechaEm: "2026-12-15",
      venceEm: "2026-12-25",
    });
  });

  test("fechamento dia 31 fecha no último dia de fevereiro, e a compra desse dia vai para março", () => {
    expect(datasDaFatura("2026-02-10", 31, 7)).toEqual({
      mesReferencia: "2026-02",
      fechaEm: "2026-02-28",
      venceEm: "2026-03-07",
    });
    expect(datasDaFatura("2026-02-28", 31, 7)).toEqual({
      mesReferencia: "2026-03",
      fechaEm: "2026-03-31",
      venceEm: "2026-04-07",
    });
    // Ano bissexto: 29.
    expect(datasDaFatura("2028-02-28", 31, 7).fechaEm).toBe("2028-02-29");
    // Vencimento 30 depois de fechar em 28/02: o 30 de fevereiro não existe e não vence antes de fechar.
    expect(datasDaFatura("2026-02-01", 28, 30).venceEm).toBe("2026-03-30");
  });

  test("a virada do ano leva a fatura para janeiro, com o mês sempre de 01 a 12", () => {
    expect(datasDaFatura("2026-12-20", 20, 5)).toEqual({
      mesReferencia: "2027-01",
      fechaEm: "2027-01-20",
      venceEm: "2027-02-05",
    });
  });

  test("a fatura nasce sob demanda, uma por mês, e o total é a soma dos lançamentos vivos", () => {
    const { contas, lancar, db } = montar();
    const cartao = contas.criarConta({
      nome: "Nubank",
      tipo: "cartao",
      diaFechamento: 15,
      diaVencimento: 25,
    });
    expect(contas.faturas({ contaId: cartao.id })).toEqual([]);
    const novembro = contas.faturaDaCompra(cartao.id, "2026-11-03");
    expect(contas.faturaDaCompra(cartao.id, "2026-11-14").id).toBe(novembro.id);
    const dezembro = contas.faturaDaCompra(cartao.id, "2026-11-15");
    expect(dezembro.mesReferencia).toBe("2026-12");
    lancar(cartao.id, "2026-11-03", -4500, novembro.id);
    lancar(cartao.id, "2026-11-14", -1234, novembro.id);
    const apagado = lancar(cartao.id, "2026-11-14", -9999, novembro.id);
    db.prepare("UPDATE lancamentos SET apagado_em = ? WHERE id = ?").run("2026-11-10T15:00:00.000Z", apagado);
    const lista = contas.faturas({ contaId: cartao.id });
    confere("financas.faturas", lista);
    expect(lista.map((f) => [f.mesReferencia, f.totalCentavos, f.estado])).toEqual([
      ["2026-12", 0, "aberta"],
      ["2026-11", -5734, "aberta"],
    ]);
  });

  test("a fatura fica fechada a partir do dia de fechamento, no fuso de quem usa", () => {
    // 15/11 às 01:00 em UTC ainda é 14/11 em São Paulo.
    const { contas, relogio } = montar("2026-11-15T01:00:00.000Z");
    const cartao = contas.criarConta({ nome: "Inter", tipo: "cartao", diaFechamento: 15, diaVencimento: 25 });
    const fatura = contas.faturaDaCompra(cartao.id, "2026-11-01");
    expect(fatura.estado).toBe("aberta");
    relogio.agora = new Date("2026-11-15T03:00:00.000Z");
    expect(contas.faturas({ contaId: cartao.id })[0]?.estado).toBe("fechada");
  });

  test("conta comum não tem fatura", () => {
    const { contas } = montar();
    const corrente = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    expect(() => contas.faturaDaCompra(corrente.id, "2026-11-01")).toThrow(ErroDasContas);
  });
});

describe("pagar a fatura", () => {
  function comFatura() {
    const m = montar("2026-11-20T15:00:00.000Z");
    const corrente = m.contas.criarConta({ nome: "Itaú", tipo: "corrente", saldoInicialCentavos: 100_000 });
    const cartao = m.contas.criarConta({
      nome: "Nubank",
      tipo: "cartao",
      diaFechamento: 15,
      diaVencimento: 25,
      contaPagamentoId: corrente.id,
    });
    const fatura = m.contas.faturaDaCompra(cartao.id, "2026-11-03");
    m.lancar(cartao.id, "2026-11-03", -4500, fatura.id);
    m.lancar(cartao.id, "2026-11-10", -10_050, fatura.id);
    return { ...m, corrente, cartao, fatura };
  }

  test("vira transferência da conta de pagamento pelo total, marca paga, e desfazer volta tudo", () => {
    const { contas, eventos, corrente, cartao, fatura } = comFatura();
    expect(contas.faturas({ contaId: cartao.id })[0]?.estado).toBe("fechada");
    eventos.length = 0;

    const paga = contas.pagarFatura({ id: fatura.id });
    confere("financas.pagarFatura", paga);
    expect(paga.estado).toBe("paga");
    // O total da fatura é o das compras: o pagamento não entra nele.
    expect(paga.totalCentavos).toBe(-14_550);
    expect(contas.obterConta({ id: corrente.id }).saldoCentavos).toBe(100_000 - 14_550);
    expect(contas.obterConta({ id: cartao.id }).saldoCentavos).toBe(0);
    const evento = eventos.at(-1);
    expect(MudancaFinancas.safeParse(evento).success).toBe(true);
    expect(evento?.partes).toEqual(["contas", "faturas", "lancamentos"]);
    const lados = evento?.lancamentos ?? [];
    expect(lados.map((l) => [l.contaId, l.valorCentavos, l.categoriaId, l.data])).toEqual(
      expect.arrayContaining([
        [corrente.id, -14_550, "transferencia", "2026-11-20"],
        [cartao.id, 14_550, "transferencia", "2026-11-20"],
      ]),
    );
    expect(new Set(lados.map((l) => l.transferenciaId)).size).toBe(1);
    expect(paga.pagamentoLancamentoId).toBe(lados.find((l) => l.contaId === cartao.id)?.id);
    expect(() => contas.pagarFatura({ id: fatura.id })).toThrow(MENSAGEM_FATURA_PAGA);

    const desfeita = contas.desfazerPagamento({ id: fatura.id });
    confere("financas.desfazerPagamento", desfeita);
    expect(desfeita.estado).toBe("fechada");
    expect(desfeita.pagamentoLancamentoId).toBeNull();
    expect(contas.obterConta({ id: corrente.id }).saldoCentavos).toBe(100_000);
    expect(contas.obterConta({ id: cartao.id }).saldoCentavos).toBe(-14_550);
    expect(eventos.at(-1)?.apagados.sort()).toEqual(lados.map((l) => l.id).sort());
  });

  test("com outra conta, valor e dia escolhidos; sem conta de pagamento, pede uma", () => {
    const { contas, cartao, fatura } = comFatura();
    const semConta = contas.criarConta({ nome: "C6", tipo: "cartao", diaFechamento: 1, diaVencimento: 8 });
    const faturaSemConta = contas.faturaDaCompra(semConta.id, "2026-11-03");
    expect(() => contas.pagarFatura({ id: faturaSemConta.id, valorCentavos: 100 })).toThrow(
      MENSAGEM_SEM_CONTA_PAGAMENTO,
    );

    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    contas.pagarFatura({
      id: fatura.id,
      contaPagamentoId: poupanca.id,
      valorCentavos: 5_000,
      data: "2026-11-24",
    });
    expect(contas.obterConta({ id: poupanca.id }).saldoCentavos).toBe(-5_000);
    expect(contas.obterConta({ id: cartao.id }).saldoCentavos).toBe(-14_550 + 5_000);
  });

  test("a conta de pagamento não é cartão, nem de outra moeda, nem arquivada", () => {
    const { contas, cartao, fatura } = comFatura();
    const dolar = contas.criarConta({ nome: "Wise", tipo: "corrente", moeda: "USD" });
    const arquivada = contas.criarConta({ nome: "Antiga", tipo: "corrente" });
    contas.definirConta({ id: arquivada.id, ativa: false });
    for (const contaPagamentoId of [cartao.id, dolar.id, arquivada.id]) {
      expect(() => contas.pagarFatura({ id: fatura.id, contaPagamentoId })).toThrow(
        MENSAGEM_PAGAMENTO_INVALIDO,
      );
    }
    expect(() =>
      contas.criarConta({
        nome: "XP",
        tipo: "cartao",
        diaFechamento: 5,
        diaVencimento: 12,
        contaPagamentoId: dolar.id,
      }),
    ).toThrow(MENSAGEM_PAGAMENTO_INVALIDO);
  });

  test("desfazer leva também o lado que já estava na lixeira", () => {
    const { contas, db, corrente, fatura } = comFatura();
    const paga = contas.pagarFatura({ id: fatura.id });
    db.prepare(
      "UPDATE lancamentos SET apagado_em = ? WHERE transferencia_id IS NOT NULL AND conta_id = ?",
    ).run("2026-11-20T16:00:00.000Z", corrente.id);
    contas.desfazerPagamento({ id: paga.id });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE transferencia_id IS NOT NULL").get(),
    ).toEqual({
      n: 0,
    });
  });

  test("com o pagamento na lixeira a fatura não está paga, e restaurar volta a paga", () => {
    const { contas, db, cartao, fatura } = comFatura();
    const paga = contas.pagarFatura({ id: fatura.id });
    const lixeira = (apagadoEm: string | null) =>
      db.prepare("UPDATE lancamentos SET apagado_em = ? WHERE transferencia_id IS NOT NULL").run(apagadoEm);

    lixeira("2026-11-20T16:00:00.000Z");
    const naLixeira = contas.faturas({ contaId: cartao.id })[0];
    confere("financas.faturas", [naLixeira]);
    expect(naLixeira).toMatchObject({ estado: "fechada", pagamentoLancamentoId: null });
    expect(() => contas.pagarFatura({ id: fatura.id })).toThrow(MENSAGEM_PAGAMENTO_NA_LIXEIRA);

    lixeira(null);
    expect(contas.faturas({ contaId: cartao.id })[0]).toMatchObject({
      estado: "paga",
      pagamentoLancamentoId: paga.pagamentoLancamentoId,
    });
  });

  test("desfazer o que não está pago e pagar fatura sem valor são recusados", () => {
    const { contas, cartao, fatura } = comFatura();
    expect(() => contas.desfazerPagamento({ id: fatura.id })).toThrow(MENSAGEM_FATURA_NAO_PAGA);
    const vazia = contas.faturaDaCompra(cartao.id, "2026-12-01");
    expect(() => contas.pagarFatura({ id: vazia.id })).toThrow(MENSAGEM_FATURA_SEM_VALOR);
  });
});

describe("troca do dia de fechamento", () => {
  test("a compra depois da troca não cai na fatura paga que fechou com o dia antigo", () => {
    const { contas, lancar, relogio } = montar("2026-11-11T15:00:00.000Z");
    const corrente = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    const cartao = contas.criarConta({
      nome: "Nubank",
      tipo: "cartao",
      diaFechamento: 10,
      diaVencimento: 17,
      contaPagamentoId: corrente.id,
    });
    const novembro = contas.faturaDaCompra(cartao.id, "2026-11-05");
    lancar(cartao.id, "2026-11-05", -5_000, novembro.id);
    contas.pagarFatura({ id: novembro.id });

    relogio.agora = new Date("2026-11-12T15:00:00.000Z");
    contas.definirConta({ id: cartao.id, diaFechamento: 25, diaVencimento: 5 });
    const compra = contas.faturaDaCompra(cartao.id, "2026-11-15");
    expect(compra.id).not.toBe(novembro.id);
    expect(compra).toMatchObject({ mesReferencia: "2026-12", fechaEm: "2026-12-25", venceEm: "2027-01-05" });
    // A paga guarda as datas com que fechou.
    const paga = contas.faturas({ contaId: cartao.id }).find((f) => f.id === novembro.id);
    expect(paga).toMatchObject({ estado: "paga", fechaEm: "2026-11-10", venceEm: "2026-11-17" });
  });

  test("a fatura aberta ganha as datas novas e o que passou do novo fechamento vai para a seguinte", () => {
    const { contas, lancar, db, eventos } = montar("2026-11-12T15:00:00.000Z");
    const cartao = contas.criarConta({ nome: "Inter", tipo: "cartao", diaFechamento: 25, diaVencimento: 5 });
    const novembro = contas.faturaDaCompra(cartao.id, "2026-11-02");
    const cedo = lancar(cartao.id, "2026-11-02", -1_000, novembro.id);
    const tarde = lancar(cartao.id, "2026-11-20", -2_000, novembro.id);

    contas.definirConta({ id: cartao.id, diaFechamento: 15, diaVencimento: 22 });
    const faturas = contas.faturas({ contaId: cartao.id });
    expect(faturas.map((f) => [f.mesReferencia, f.fechaEm, f.venceEm, f.totalCentavos])).toEqual([
      ["2026-12", "2026-12-15", "2026-12-22", -2_000],
      ["2026-11", "2026-11-15", "2026-11-22", -1_000],
    ]);
    const faturaDe = (id: string) =>
      (db.prepare("SELECT fatura_id FROM lancamentos WHERE id = ?").get(id) as { fatura_id: string })
        .fatura_id;
    expect(faturaDe(cedo)).toBe(novembro.id);
    expect(faturaDe(tarde)).not.toBe(novembro.id);
    const evento = eventos.at(-1);
    expect(MudancaFinancas.safeParse(evento).success).toBe(true);
    expect(evento?.lancamentos.map((l) => l.id)).toEqual([tarde]);
  });
});

describe("saldo derivado", () => {
  test("apagar o lançamento tira do saldo e restaurar devolve", () => {
    const { contas, lancar, db } = montar();
    const conta = contas.criarConta({ nome: "Itaú", tipo: "corrente", saldoInicialCentavos: 50_000 });
    lancar(conta.id, "2026-11-01", 300_000);
    const mercado = lancar(conta.id, "2026-11-02", -4_550);
    expect(contas.obterConta({ id: conta.id }).saldoCentavos).toBe(345_450);
    db.prepare("UPDATE lancamentos SET apagado_em = ? WHERE id = ?").run("2026-11-10T15:00:00.000Z", mercado);
    expect(contas.obterConta({ id: conta.id }).saldoCentavos).toBe(350_000);
    db.prepare("UPDATE lancamentos SET apagado_em = NULL WHERE id = ?").run(mercado);
    expect(contas.obterConta({ id: conta.id }).saldoCentavos).toBe(345_450);
  });

  test("só conta o que veio desde o dia do saldo inicial, o próprio dia incluído", () => {
    const { contas, lancar } = montar();
    const conta = contas.criarConta({
      nome: "Itaú",
      tipo: "corrente",
      saldoInicialCentavos: 10_000,
      saldoInicialEm: "2026-11-05",
    });
    lancar(conta.id, "2026-11-04", -999);
    lancar(conta.id, "2026-11-05", -1_000);
    lancar(conta.id, "2026-11-06", 2_500);
    expect(contas.obterConta({ id: conta.id }).saldoCentavos).toBe(11_500);
  });

  test("a conta em dólar fica fora do total em real, à parte", () => {
    const { contas, lancar } = montar();
    const itau = contas.criarConta({ nome: "Itaú", tipo: "corrente", saldoInicialCentavos: 100_000 });
    const nubank = contas.criarConta({ nome: "Nubank", tipo: "cartao", diaFechamento: 3, diaVencimento: 10 });
    const wise = contas.criarConta({
      nome: "Wise",
      tipo: "corrente",
      moeda: "USD",
      saldoInicialCentavos: 20_000,
    });
    lancar(nubank.id, "2026-11-02", -30_000);
    lancar(wise.id, "2026-11-02", -1_500);
    const arquivada = contas.criarConta({ nome: "Antiga", tipo: "corrente", saldoInicialCentavos: 7_777 });
    contas.definirConta({ id: arquivada.id, ativa: false });
    expect(contas.saldos()).toEqual({
      totalCentavos: 70_000,
      outrasMoedas: [{ moeda: "USD", saldoCentavos: 18_500 }],
    });
    expect(itau.moeda).toBe("BRL");
  });
});

describe("cadastro", () => {
  test("criar, editar, arquivar e mandar à lixeira, com a lista só das ativas", () => {
    const { contas, eventos } = montar();
    const conta = contas.criarConta({ nome: "Itaú", tipo: "corrente", banco: "itau" });
    confere("financas.criarConta", conta);
    expect(conta).toMatchObject({ moeda: "BRL", saldoInicialCentavos: 0, saldoCentavos: 0, ativa: true });
    expect(eventos.at(-1)?.partes).toEqual(["contas"]);

    const editada = contas.definirConta({
      id: conta.id,
      nome: "Itaú Personnalité",
      saldoInicialCentavos: 1_000,
    });
    confere("financas.definirConta", editada);
    expect(editada).toMatchObject({ nome: "Itaú Personnalité", banco: "itau", saldoCentavos: 1_000 });

    contas.definirConta({ id: conta.id, ativa: false });
    expect(contas.contas()).toEqual([]);
    expect(contas.contas({ todas: true }).map((c) => c.id)).toEqual([conta.id]);
    confere("financas.contas", contas.contas({ todas: true }));

    expect(contas.apagarConta({ id: conta.id })).toEqual({ ids: [conta.id] });
    expect(contas.contas({ todas: true })).toEqual([]);
  });

  test("conta com lançamento, mesmo na lixeira, só arquiva, e a moeda dela não muda", () => {
    const { contas, lancar, db } = montar();
    const conta = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    const id = lancar(conta.id, "2026-11-01", -100);
    db.prepare("UPDATE lancamentos SET apagado_em = ? WHERE id = ?").run("2026-11-10T15:00:00.000Z", id);
    expect(() => contas.apagarConta({ id: conta.id })).toThrow(MENSAGEM_CONTA_COM_LANCAMENTO);
    expect(() => contas.definirConta({ id: conta.id, moeda: "USD" })).toThrow(MENSAGEM_MOEDA_COM_LANCAMENTO);
  });

  test("só o cartão recebe campos de cartão", () => {
    const { contas } = montar();
    const conta = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    expect(() => contas.definirConta({ id: conta.id, diaFechamento: 10 })).toThrow(MENSAGEM_SO_CARTAO);
    const cartao = contas.criarConta({
      nome: "Nubank",
      tipo: "cartao",
      diaFechamento: 10,
      diaVencimento: 17,
    });
    const editado = contas.definirConta({ id: cartao.id, diaFechamento: 31, limiteCentavos: 500_000 });
    expect(editado).toMatchObject({ diaFechamento: 31, diaVencimento: 17, limiteCentavos: 500_000 });
    expect(() => contas.criarConta({ nome: "Itaú", tipo: "corrente", limiteCentavos: 100 })).toThrow(
      MENSAGEM_SO_CARTAO,
    );
  });

  test("cartão sem os dias é recusado ao criar e ao editar", () => {
    const { contas } = montar();
    expect(() => contas.criarConta({ nome: "Nubank", tipo: "cartao", diaVencimento: 10 })).toThrow(
      MENSAGEM_CARTAO_SEM_DIAS,
    );
    const cartao = contas.criarConta({ nome: "Nubank", tipo: "cartao", diaFechamento: 3, diaVencimento: 10 });
    expect(() => contas.definirConta({ id: cartao.id, diaFechamento: null })).toThrow(
      MENSAGEM_CARTAO_SEM_DIAS,
    );
  });

  test("trocar para conta de pagamento inválida, ou mudar a moeda contra ela, é recusado", () => {
    const { contas } = montar();
    const corrente = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    const dolar = contas.criarConta({ nome: "Wise", tipo: "corrente", moeda: "USD" });
    const cartao = contas.criarConta({
      nome: "Nubank",
      tipo: "cartao",
      diaFechamento: 3,
      diaVencimento: 10,
      contaPagamentoId: corrente.id,
    });
    expect(() => contas.definirConta({ id: cartao.id, contaPagamentoId: dolar.id })).toThrow(
      MENSAGEM_PAGAMENTO_INVALIDO,
    );
    expect(() => contas.definirConta({ id: cartao.id, moeda: "USD" })).toThrow(MENSAGEM_PAGAMENTO_INVALIDO);
    expect(contas.obterConta({ id: cartao.id })).toMatchObject({
      contaPagamentoId: corrente.id,
      moeda: "BRL",
    });
  });
});

describe("canal", () => {
  test("erro da regra chega como veio; erro de dentro vira a mensagem genérica", () => {
    const { contas } = montar();
    const atendentes = atendentesDasContas(contas);
    expect(() => atendentes["financas.obterConta"]({ id: "nao-existe" })).toThrow(ErroDasContas);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(contas, "contas").mockImplementation(() => {
      throw new Error("SQLITE_BUSY");
    });
    expect(() => atendentes["financas.contas"]({})).toThrow(MENSAGEM_ERRO_INTERNO);
  });
});
