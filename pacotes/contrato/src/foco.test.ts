import { describe, expect, test } from "vitest";
import {
  EstadoFoco,
  EtapaFoco,
  PedidoEstenderFoco,
  PedidoHistoricoFoco,
  PedidoIniciarFoco,
  TipoEtapa,
} from "./foco.ts";
import { METODOS } from "./metodos.ts";

const etapa = {
  id: "01K7A0000000000000000000F1",
  tipo: "foco",
  tarefaId: "01K7A0000000000000000000T1",
  inicio: "2026-10-08T17:42:00.000Z",
  terminaEm: "2026-10-08T18:07:00.000Z",
  pausadaEm: null,
  fim: null,
  duracaoPlanejadaMin: 25,
  duracaoRealMin: null,
  interrompida: false,
};

describe("foco", () => {
  test("as etapas são as da migração 014", () => {
    expect(TipoEtapa.options).toEqual(["foco", "pausa", "pausa_longa"]);
  });

  test("etapa em andamento não tem duração real; a que terminou não está em pausa", () => {
    expect(EtapaFoco.parse(etapa)).toEqual(etapa);
    expect(EtapaFoco.safeParse({ ...etapa, duracaoRealMin: 10 }).success).toBe(false);
    const terminou = { ...etapa, fim: "2026-10-08T18:07:00.000Z", duracaoRealMin: 25 };
    expect(EtapaFoco.safeParse(terminou).success).toBe(true);
    expect(EtapaFoco.safeParse({ ...terminou, pausadaEm: "2026-10-08T18:00:00.000Z" }).success).toBe(false);
  });

  test("o estado diz o ciclo, o que vem depois e o total de hoje", () => {
    const estado = {
      etapa,
      tarefaTitulo: "Revisar PR do relatório mensal",
      cicloAtual: 2,
      ciclosAtePausaLonga: 4,
      proxima: "pausa",
      focoHojeMin: 75,
      ciclosHoje: 3,
    };
    expect(EstadoFoco.parse(estado)).toEqual(estado);
    expect(EstadoFoco.safeParse({ ...estado, etapa: null, tarefaTitulo: null }).success).toBe(true);
    expect(EstadoFoco.safeParse({ ...estado, cicloAtual: 0 }).success).toBe(false);
    expect(METODOS["foco.alternar"].saida.safeParse(estado).success).toBe(true);
  });

  test("pedidos: iniciar livre ou ligado, +5 min e o histórico de dias", () => {
    expect(PedidoIniciarFoco.safeParse({}).success).toBe(true);
    expect(PedidoIniciarFoco.safeParse({ tarefaId: null, minutos: 50 }).success).toBe(true);
    expect(PedidoIniciarFoco.safeParse({ minutos: 0 }).success).toBe(false);
    expect(PedidoEstenderFoco.safeParse({ minutos: 5 }).success).toBe(true);
    expect(PedidoEstenderFoco.safeParse({}).success).toBe(false);
    expect(PedidoHistoricoFoco.safeParse({ de: "2026-10-05", ate: "2026-10-11" }).success).toBe(true);
    expect(PedidoHistoricoFoco.safeParse({ de: "2026-10-11", ate: "2026-10-05" }).success).toBe(false);
  });
});
