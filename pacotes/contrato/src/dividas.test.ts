import { describe, expect, test } from "vitest";
import { Divida, NovaDivida, PedidoPagamentoDivida, PedidoSimulacao, Simulacao } from "./dividas.ts";
import { METODOS } from "./metodos.ts";

const divida = {
  id: "01KA0000000000000000000D01",
  nome: "Empréstimo pessoal",
  credor: "Banco",
  tipo: "emprestimo",
  saldoCentavos: 640_000,
  saldoEm: "2026-10-01",
  jurosMensalBp: 210,
  parcelaCentavos: 45_210,
  parcelasRestantes: 17,
  diaVencimento: 10,
  quitadaEm: null,
  // Pela amortização (2,1% sobre o saldo, depois R$ 452,10; a 17ª parcela é menor): R$ 7.674,77
  // pagos, R$ 1.274,77 de juros. Não é 17 × R$ 452,10 − R$ 6.400.
  custoTotalCentavos: 127_477,
  proximaParcelaEm: "2026-10-10",
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-01T12:00:00.000Z",
  atualizadoEm: "2026-10-01T12:00:00.000Z",
};

describe("dívidas", () => {
  test("juros em pontos-base inteiros; saldo sem sinal; custo e próxima parcela derivados", () => {
    expect(Divida.parse(divida)).toEqual(divida);
    expect(Divida.safeParse({ ...divida, jurosMensalBp: 2.1 }).success).toBe(false);
    expect(Divida.safeParse({ ...divida, saldoCentavos: -1 }).success).toBe(false);
    expect(Divida.safeParse({ ...divida, parcelaCentavos: 0 }).success).toBe(false);
    expect(Divida.safeParse({ ...divida, tipo: "agiota" }).success).toBe(false);
    // Sem juros, sem parcela ou com a parcela abaixo dos juros, o custo vem vazio.
    expect(Divida.safeParse({ ...divida, jurosMensalBp: 0, custoTotalCentavos: null }).success).toBe(true);
    expect(Divida.safeParse({ ...divida, custoTotalCentavos: -1 }).success).toBe(false);
  });

  test("nova dívida pede nome, tipo e saldo numa data; o resto é opcional", () => {
    const nova = { nome: "Cartão antigo", tipo: "cartao", saldoCentavos: 120_000, saldoEm: "2026-11-01" };
    expect(NovaDivida.parse(nova)).toEqual(nova);
    expect(NovaDivida.safeParse({ ...nova, saldoEm: undefined }).success).toBe(false);
  });

  test("o pagamento liga um lançamento ou cria outro numa conta, não os dois", () => {
    const pagamento = { id: divida.id, valorCentavos: 45_210, data: "2026-10-10" };
    expect(PedidoPagamentoDivida.safeParse(pagamento).success).toBe(true);
    expect(PedidoPagamentoDivida.safeParse({ ...pagamento, contaId: "c" }).success).toBe(true);
    expect(PedidoPagamentoDivida.safeParse({ ...pagamento, contaId: "c", lancamentoId: "l" }).success).toBe(
      false,
    );
    expect(PedidoPagamentoDivida.safeParse({ ...pagamento, valorCentavos: 0 }).success).toBe(false);
  });

  test("a simulação traz só as parcelas e as duas estratégias, lado a lado", () => {
    const resultado = (meses: number, terminaEm: string, juros: number) => ({
      meses,
      terminaEm,
      jurosPagosCentavos: juros,
      quitacoes: [{ id: divida.id, mes: terminaEm }],
    });
    const simulacao = {
      extraMensalCentavos: 20_000,
      semExtra: resultado(17, "2028-02", 128_570),
      maiorJuro: resultado(12, "2027-09", 77_330),
      menorSaldo: resultado(12, "2027-09", 77_330),
    };
    expect(Simulacao.parse(simulacao)).toEqual(simulacao);
    expect(PedidoSimulacao.safeParse({ extraMensalCentavos: -1 }).success).toBe(false);
    expect(PedidoSimulacao.safeParse({ extraMensalCentavos: 0, ids: [] }).success).toBe(false);
    expect(METODOS["dividas.simular"].saida).toBe(Simulacao);
  });
});
