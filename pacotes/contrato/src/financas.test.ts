import { describe, expect, test } from "vitest";
import {
  CATEGORIA_TRANSFERENCIA,
  Centavos,
  Conta,
  DefinicaoOrcamento,
  Fatura,
  Lancamento,
  LancamentoEditado,
  Mes,
  MudancaConta,
  MudancaFinancas,
  NovaConta,
  NovaRecorrente,
  NovaTransferencia,
  NovoLancamento,
  OrcamentoMes,
  PedidoGastoCom,
  PedidoLancamentos,
  PedidoRemanejar,
  RelatorioMes,
  ResultadoApagarCategoria,
  ResumoMes,
  SugestaoRecorrente,
  Vencimentos,
} from "./financas.ts";
import { METODOS } from "./metodos.ts";

const carimbo = {
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-11-21T12:00:00.000Z",
  atualizadoEm: "2026-11-21T12:00:00.000Z",
};

const corrente = {
  id: "01KA0000000000000000000C01",
  nome: "Nubank",
  tipo: "corrente",
  banco: "nubank",
  moeda: "BRL",
  saldoInicialCentavos: 150_000,
  saldoInicialEm: "2026-11-01",
  diaFechamento: null,
  diaVencimento: null,
  limiteCentavos: null,
  contaPagamentoId: null,
  ativa: true,
  saldoCentavos: 145_500,
  ...carimbo,
};

const cartao = {
  ...corrente,
  id: "01KA0000000000000000000C02",
  nome: "Cartão Nubank",
  tipo: "cartao",
  saldoInicialCentavos: 0,
  saldoInicialEm: null,
  diaFechamento: 3,
  diaVencimento: 10,
  limiteCentavos: 500_000,
  contaPagamentoId: corrente.id,
  saldoCentavos: -32_090,
};

const lancamento = {
  id: "01KA0000000000000000000L01",
  contaId: corrente.id,
  data: "2026-11-20",
  descricao: "Mercado",
  descricaoOriginal: null,
  valorCentavos: -4500,
  moeda: "BRL",
  categoriaId: "mercado",
  faturaId: null,
  parcelaNumero: null,
  parcelaTotal: null,
  compraId: null,
  transferenciaId: null,
  recorrenciaId: null,
  dividaId: null,
  importacaoId: null,
  idExterno: null,
  conciliado: false,
  notas: null,
  ...carimbo,
};

describe("valores e meses", () => {
  test("centavo é inteiro seguro: nada de ponto flutuante nem além do maior inteiro", () => {
    expect(Centavos.safeParse(-4500).success).toBe(true);
    expect(Centavos.safeParse(45.9).success).toBe(false);
    expect(Centavos.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  test("mês é AAAA-MM com o mês de 01 a 12", () => {
    expect(Mes.safeParse("2026-11").success).toBe(true);
    expect(Mes.safeParse("2026-12").success).toBe(true);
    for (const fora of ["2026-00", "2026-13", "2026-1", "26-11", "2026-11-01"]) {
      expect(Mes.safeParse(fora).success, fora).toBe(false);
    }
  });
});

describe("contas e cartões", () => {
  test("a conta traz o saldo derivado; o cartão, os dias e a conta de pagamento", () => {
    expect(Conta.parse(corrente)).toEqual(corrente);
    expect(Conta.parse(cartao)).toEqual(cartao);
  });

  test("como o banco: cartão sem os dias e conta comum com campo de cartão são recusados", () => {
    expect(NovaConta.safeParse({ nome: "Cartão", tipo: "cartao", diaFechamento: 3 }).success).toBe(false);
    expect(
      NovaConta.safeParse({ nome: "Cartão", tipo: "cartao", diaFechamento: 3, diaVencimento: 10 }).success,
    ).toBe(true);
    expect(NovaConta.safeParse({ nome: "Carteira", tipo: "carteira", limiteCentavos: 1000 }).success).toBe(
      false,
    );
    expect(NovaConta.safeParse({ nome: "Carteira", tipo: "carteira" }).success).toBe(true);
    expect(Conta.safeParse({ ...corrente, diaFechamento: 5 }).success).toBe(false);
    expect(
      NovaConta.safeParse({ nome: "Cartão", tipo: "cartao", diaFechamento: 32, diaVencimento: 10 }).success,
    ).toBe(false);
  });

  test("a moeda é código ISO; arquivar é a mudança com ativa falso; o tipo não muda", () => {
    expect(NovaConta.safeParse({ nome: "Wise", tipo: "corrente", moeda: "usd" }).success).toBe(false);
    expect(MudancaConta.parse({ id: corrente.id, ativa: false })).toEqual({ id: corrente.id, ativa: false });
    expect(MudancaConta.parse({ id: corrente.id, tipo: "cartao" })).toEqual({ id: corrente.id });
  });

  test("a fatura vence depois de fechar e só a paga aponta o pagamento", () => {
    const fatura = {
      id: "01KA0000000000000000000F01",
      contaId: cartao.id,
      mesReferencia: "2026-12",
      fechaEm: "2026-12-03",
      venceEm: "2026-12-10",
      totalCentavos: -32_090,
      estado: "aberta",
      pagamentoLancamentoId: null,
      criadoEm: carimbo.criadoEm,
      atualizadoEm: carimbo.atualizadoEm,
    };
    expect(Fatura.parse(fatura)).toEqual(fatura);
    expect(Fatura.safeParse({ ...fatura, venceEm: "2026-12-03" }).success).toBe(false);
    expect(Fatura.safeParse({ ...fatura, pagamentoLancamentoId: lancamento.id }).success).toBe(false);
    expect(
      Fatura.safeParse({ ...fatura, estado: "paga", pagamentoLancamentoId: lancamento.id }).success,
    ).toBe(true);
    expect(Fatura.safeParse({ ...fatura, mesReferencia: "2026-13" }).success).toBe(false);
  });
});

describe("lançamentos", () => {
  test("o lançamento leva a moeda da conta e não expõe a chave natural", () => {
    expect(Lancamento.parse(lancamento)).toEqual(lancamento);
    expect(Object.keys(Lancamento.parse({ ...lancamento, impressao: "a".repeat(64) }))).not.toContain(
      "impressao",
    );
  });

  test("como o banco: parcela com número e total, dentro do total, e compra só com parcelas", () => {
    const parcela = {
      ...lancamento,
      parcelaNumero: 2,
      parcelaTotal: 3,
      compraId: "01KA0000000000000000000P01",
    };
    expect(Lancamento.safeParse(parcela).success).toBe(true);
    expect(Lancamento.safeParse({ ...parcela, parcelaTotal: null }).success).toBe(false);
    expect(Lancamento.safeParse({ ...parcela, parcelaNumero: 4 }).success).toBe(false);
    expect(Lancamento.safeParse({ ...parcela, parcelaTotal: 1, parcelaNumero: 1 }).success).toBe(false);
    expect(Lancamento.safeParse({ ...parcela, compraId: null }).success).toBe(false);
    expect(Lancamento.safeParse({ ...lancamento, compraId: parcela.compraId }).success).toBe(false);
  });

  test("novo lançamento tem valor com sinal, nunca zero; parcelada é de 2 a 120 vezes", () => {
    const novo = { contaId: cartao.id, data: "2026-11-20", descricao: "Geladeira", valorCentavos: -10_000 };
    expect(NovoLancamento.parse({ ...novo, parcelas: 3 })).toEqual({ ...novo, parcelas: 3 });
    expect(NovoLancamento.safeParse({ ...novo, valorCentavos: 0 }).success).toBe(false);
    expect(NovoLancamento.safeParse({ ...novo, parcelas: 1 }).success).toBe(false);
    expect(NovoLancamento.safeParse({ ...novo, parcelas: 121 }).success).toBe(false);
    expect(NovoLancamento.safeParse({ ...novo, descricao: "  " }).success).toBe(false);
  });

  test("transferência é entre duas contas diferentes, com valor positivo", () => {
    const t = { deContaId: corrente.id, paraContaId: cartao.id, data: "2026-11-20", valorCentavos: 32_090 };
    expect(NovaTransferencia.safeParse(t).success).toBe(true);
    expect(NovaTransferencia.safeParse({ ...t, paraContaId: corrente.id }).success).toBe(false);
    expect(NovaTransferencia.safeParse({ ...t, valorCentavos: -100 }).success).toBe(false);
    expect(CATEGORIA_TRANSFERENCIA).toBe("transferencia");
    expect(METODOS["financas.transferir"].saida.safeParse([lancamento]).success).toBe(false);
  });

  test("editar devolve os lançamentos mudados e, no importado, a regra proposta", () => {
    const editado = {
      lancamentos: [lancamento],
      propostaRegra: { padrao: "MERCADO BOM PRECO", tipoPadrao: "contem", categoriaId: "mercado" },
    };
    expect(LancamentoEditado.parse(editado)).toEqual(editado);
    expect(LancamentoEditado.safeParse({ ...editado, propostaRegra: null }).success).toBe(true);
    expect(LancamentoEditado.safeParse({ ...editado, lancamentos: [] }).success).toBe(false);
  });

  test("a busca é pelo mês ou pelo intervalo, e sem categoria não combina com uma categoria", () => {
    expect(PedidoLancamentos.safeParse({ mes: "2026-10", texto: "acougue" }).success).toBe(true);
    expect(PedidoLancamentos.safeParse({ inicio: "2026-10-01", fim: "2026-10-31" }).success).toBe(true);
    expect(PedidoLancamentos.safeParse({ mes: "2026-10", inicio: "2026-10-01" }).success).toBe(false);
    expect(PedidoLancamentos.safeParse({ inicio: "2026-10-31", fim: "2026-10-01" }).success).toBe(false);
    expect(PedidoLancamentos.safeParse({ semCategoria: true, categoriaId: "mercado" }).success).toBe(false);
    expect(PedidoLancamentos.safeParse({ limite: 501 }).success).toBe(false);
  });
});

describe("categorias", () => {
  test("categoria em uso volta pedindo confirmação com quantos lançamentos ficam sem categoria", () => {
    expect(ResultadoApagarCategoria.parse({ apagada: false, lancamentos: 12 })).toEqual({
      apagada: false,
      lancamentos: 12,
    });
    expect(ResultadoApagarCategoria.safeParse({ apagada: false, lancamentos: 0 }).success).toBe(false);
    expect(ResultadoApagarCategoria.safeParse({ apagada: true, ids: ["lazer", "cinema"] }).success).toBe(
      true,
    );
    expect(
      METODOS["financas.apagarCategoria"].entrada.safeParse({ id: "lazer", confirmado: true }).success,
    ).toBe(true);
  });
});

describe("resumo, relatórios e vencimentos", () => {
  const totais = { moeda: "BRL", entradasCentavos: 486_000, saidasCentavos: 321_477, sobraCentavos: 164_523 };

  test("saídas sem sinal e sobra com sinal; outra moeda fica à parte", () => {
    const resumo = {
      mes: "2026-10",
      totais,
      outrasMoedas: [{ moeda: "USD", entradasCentavos: 0, saidasCentavos: 1200, sobraCentavos: -1200 }],
      porCategoria: [{ categoriaId: null, gastoCentavos: 4500, lancamentos: 1 }],
    };
    expect(ResumoMes.parse(resumo)).toEqual(resumo);
    expect(ResumoMes.safeParse({ ...resumo, totais: { ...totais, saidasCentavos: -321_477 } }).success).toBe(
      false,
    );
  });

  test("o relatório compara com exatamente três meses anteriores", () => {
    const relatorio = {
      mes: "2026-10",
      anteriores: ["2026-09", "2026-08", "2026-07"],
      totais,
      totaisAnteriores: [totais, totais, totais],
      linhas: [
        { categoriaId: "mercado", gastoCentavos: 68_000, anterioresCentavos: [60_000, 55_000, 61_000] },
      ],
    };
    expect(RelatorioMes.parse(relatorio)).toEqual(relatorio);
    expect(RelatorioMes.safeParse({ ...relatorio, anteriores: ["2026-09", "2026-08"] }).success).toBe(false);
  });

  test("quanto gastei com X pede o período em ordem", () => {
    expect(
      PedidoGastoCom.safeParse({ categoriaId: "mercado", inicio: "2026-10-01", fim: "2026-10-31" }).success,
    ).toBe(true);
    expect(PedidoGastoCom.safeParse({ texto: "uber", inicio: "2026-10-31", fim: "2026-10-01" }).success).toBe(
      false,
    );
  });

  test("vencimentos trazem o tipo, o item e o total sem sinal", () => {
    const vencimentos = {
      itens: [
        {
          tipo: "fatura",
          itemId: "01KA0000000000000000000F01",
          descricao: "Fatura do Cartão Nubank",
          venceEm: "2026-11-23",
          valorCentavos: 179_230,
          moeda: "BRL",
          contaId: cartao.id,
        },
      ],
      totalCentavos: 179_230,
    };
    expect(Vencimentos.parse(vencimentos)).toEqual(vencimentos);
    expect(METODOS["financas.vencimentos"].entrada.safeParse({ dias: 0 }).success).toBe(false);
  });
});

describe("orçamento", () => {
  test("a semana contra o previsto vem só no mês corrente; mês sem orçamento não tem linhas", () => {
    const linha = {
      orcamentoId: "01KA0000000000000000000O01",
      categoriaId: "mercado",
      doMes: false,
      limiteCentavos: 60_000,
      alertaPercentual: 80,
      gastoCentavos: 68_000,
      percentual: 113,
      sobraCentavos: -8000,
      situacao: "estourado",
      semana: { previstoCentavos: 14_000, gastoCentavos: 22_000 },
    };
    const mes = {
      mes: "2026-10",
      linhas: [linha],
      limiteCentavos: 420_000,
      gastoCentavos: 321_400,
      semana: {
        inicio: "2026-10-05",
        fim: "2026-10-11",
        previstoCentavos: 60_000,
        gastoCentavos: 42_000,
        diasRestantes: 4,
      },
    };
    expect(OrcamentoMes.parse(mes)).toEqual(mes);
    expect(
      OrcamentoMes.safeParse({
        mes: "2026-09",
        linhas: [],
        limiteCentavos: 0,
        gastoCentavos: 0,
        semana: null,
      }).success,
    ).toBe(true);
  });

  test("todo mês é o mês vazio; remanejar é entre categorias diferentes, com valor positivo", () => {
    expect(
      DefinicaoOrcamento.safeParse({ categoriaId: "mercado", mes: null, limiteCentavos: 60_000 }).success,
    ).toBe(true);
    expect(
      DefinicaoOrcamento.safeParse({ categoriaId: "mercado", mes: null, limiteCentavos: -1 }).success,
    ).toBe(false);
    expect(
      DefinicaoOrcamento.safeParse({
        categoriaId: "mercado",
        mes: "2026-10",
        limiteCentavos: 0,
        alertaPercentual: 0,
      }).success,
    ).toBe(false);
    const remanejar = {
      deCategoriaId: "lazer",
      paraCategoriaId: "mercado",
      mes: "2026-10",
      valorCentavos: 8000,
    };
    expect(PedidoRemanejar.safeParse(remanejar).success).toBe(true);
    expect(PedidoRemanejar.safeParse({ ...remanejar, paraCategoriaId: "lazer" }).success).toBe(false);
    expect(PedidoRemanejar.safeParse({ ...remanejar, valorCentavos: 0 }).success).toBe(false);
  });
});

describe("recorrentes", () => {
  test("a recorrente leva a regra como RRULE; a sugestão detectada traz as três ocorrências", () => {
    const nova = { descricao: "Streaming", valorCentavos: -3990, regra: "FREQ=MONTHLY;BYMONTHDAY=5" };
    expect(NovaRecorrente.parse(nova)).toEqual(nova);
    expect(NovaRecorrente.safeParse({ ...nova, valorCentavos: 0 }).success).toBe(false);
    const sugestao = {
      chave: "streaming",
      descricao: "STREAMING",
      valorCentavos: -3990,
      categoriaId: "assinaturas",
      contaId: corrente.id,
      regra: "FREQ=MONTHLY;BYMONTHDAY=5",
      proximaEm: "2026-12-05",
      ocorrencias: ["2026-09-05", "2026-10-05", "2026-11-05"],
    };
    expect(SugestaoRecorrente.parse(sugestao)).toEqual(sugestao);
    expect(
      SugestaoRecorrente.safeParse({ ...sugestao, ocorrencias: ["2026-10-05", "2026-11-05"] }).success,
    ).toBe(false);
  });
});

describe("mudanças", () => {
  test("financas.mudou diz ao menos uma parte e traz os lançamentos mudados e os que saíram", () => {
    const mudanca = { partes: ["lancamentos", "orcamento"], lancamentos: [lancamento], apagados: [] };
    expect(MudancaFinancas.parse(mudanca)).toEqual(mudanca);
    expect(MudancaFinancas.safeParse({ ...mudanca, partes: [] }).success).toBe(false);
    expect(MudancaFinancas.safeParse({ ...mudanca, partes: ["clima"] }).success).toBe(false);
  });
});
