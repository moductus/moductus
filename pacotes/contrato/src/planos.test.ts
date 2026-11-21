import { describe, expect, test } from "vitest";
import { MudancaPlano, NovoPlano, PedidoMovimentarPlano, Plano, PlanoMovimentado } from "./planos.ts";

const carimbo = {
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-11-01T12:00:00.000Z",
  atualizadoEm: "2026-11-01T12:00:00.000Z",
};

const plano = {
  id: "01KA0000000000000000000N01",
  nome: "Reserva de emergência",
  valorAlvoCentavos: 1_000_000,
  prazo: "2027-06-30",
  contaId: null,
  estado: "ativo",
  guardadoCentavos: 400_000,
  faltaCentavos: 600_000,
  aporteMensalSugeridoCentavos: 85_715,
  prazoPassou: false,
  ...carimbo,
};

describe("planos", () => {
  test("o guardado, o que falta e o aporte sugerido vêm do serviço; sem prazo, sem aporte", () => {
    expect(Plano.parse(plano)).toEqual(plano);
    expect(Plano.safeParse({ ...plano, prazo: null, aporteMensalSugeridoCentavos: null }).success).toBe(true);
    expect(Plano.safeParse({ ...plano, faltaCentavos: -1 }).success).toBe(false);
    expect(Plano.safeParse({ ...plano, estado: "cancelado" }).success).toBe(false);
  });

  test("alvo positivo; pausar é a mudança de estado", () => {
    expect(NovoPlano.safeParse({ nome: "Viagem", valorAlvoCentavos: 0 }).success).toBe(false);
    expect(NovoPlano.parse({ nome: "Viagem", valorAlvoCentavos: 500_000 })).toEqual({
      nome: "Viagem",
      valorAlvoCentavos: 500_000,
    });
    expect(MudancaPlano.parse({ id: plano.id, estado: "pausado" })).toEqual({
      id: plano.id,
      estado: "pausado",
    });
  });

  test("guardar é positivo e retirar, negativo; movimento zero é recusado", () => {
    expect(PedidoMovimentarPlano.safeParse({ id: plano.id, valorCentavos: 50_000 }).success).toBe(true);
    expect(PedidoMovimentarPlano.safeParse({ id: plano.id, valorCentavos: -20_000 }).success).toBe(true);
    expect(PedidoMovimentarPlano.safeParse({ id: plano.id, valorCentavos: 0 }).success).toBe(false);
    const movimentado = {
      plano: { ...plano, estado: "concluido", guardadoCentavos: 1_000_000, faltaCentavos: 0 },
      movimento: {
        id: "01KA0000000000000000000M01",
        planoId: plano.id,
        data: "2027-05-01",
        valorCentavos: 600_000,
        lancamentoId: null,
        ...carimbo,
      },
      concluiuAgora: true,
    };
    expect(PlanoMovimentado.parse(movimentado)).toEqual(movimentado);
  });
});
