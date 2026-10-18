import { describe, expect, test } from "vitest";
import { METODOS } from "./metodos.ts";
import {
  AcaoEscolhida,
  ApresentacaoRotina,
  MudancaRotina,
  PedidoAgirRotina,
  ROTINAS_PADRAO,
  Rotina,
} from "./rotinas.ts";

const linha = (texto: string) => ({ agenteId: "alba", rotulo: null, texto, tarefaIds: [] });

const briefing = {
  id: "01K7A0000000000000000000R1",
  rotinaId: "briefing",
  tipo: "briefing",
  dia: "2026-10-08",
  abertura: "O dia está cheio: 7h planejadas para 5h livres.",
  daExecucaoId: null,
  linhas: [linha("Daily às 9h30 e mais 2 reuniões."), { ...linha("2 ficaram abertas."), rotulo: "Ontem" }],
  abertas: [],
  acao: null,
  acaoEm: null,
  criadoEm: "2026-10-08T11:12:00.000Z",
};

describe("rotinas", () => {
  test("as duas padrão têm o id da migração 014; o fechamento tem hora", () => {
    expect(ROTINAS_PADRAO).toEqual(["briefing", "fechamento"]);
    const fechamento = {
      id: "fechamento",
      tipo: "fechamento",
      hora: "18:00",
      diasSemana: [1, 2, 3, 4, 5],
      ativa: true,
    };
    expect(Rotina.parse(fechamento)).toEqual(fechamento);
    expect(Rotina.safeParse({ ...fechamento, hora: null }).success).toBe(false);
    expect(Rotina.safeParse({ ...fechamento, tipo: "briefing", hora: null }).success).toBe(true);
    expect(Rotina.safeParse({ ...fechamento, diasSemana: [0] }).success).toBe(false);
    expect(Rotina.safeParse({ ...fechamento, diasSemana: [1, 1] }).success).toBe(false);
    expect(MudancaRotina.safeParse({ id: "briefing", hora: null }).success).toBe(true);
    expect(MudancaRotina.safeParse({ id: "briefing", diasSemana: [] }).success).toBe(false);
  });

  test("o briefing cabe em 6 linhas; o fechamento não tem esse limite", () => {
    expect(ApresentacaoRotina.parse(briefing)).toEqual(briefing);
    const sete = Array.from({ length: 7 }, (_, i) => linha(`linha ${i + 1}`));
    expect(ApresentacaoRotina.safeParse({ ...briefing, linhas: sete }).success).toBe(false);
    expect(
      ApresentacaoRotina.safeParse({ ...briefing, tipo: "fechamento", rotinaId: "fechamento", linhas: sete })
        .success,
    ).toBe(true);
  });

  test("ação com hora; ignorado é só do serviço", () => {
    const agida = { ...briefing, acao: "comecar", acaoEm: "2026-10-08T11:13:00.000Z" };
    expect(ApresentacaoRotina.safeParse(agida).success).toBe(true);
    expect(ApresentacaoRotina.safeParse({ ...briefing, acao: "comecar" }).success).toBe(false);
    expect(ApresentacaoRotina.safeParse({ ...agida, acao: "ignorado" }).success).toBe(true);
    expect(AcaoEscolhida.options).not.toContain("ignorado");
    expect(PedidoAgirRotina.safeParse({ id: briefing.id, acao: "ignorado" }).success).toBe(false);
    expect(PedidoAgirRotina.safeParse({ id: briefing.id, acao: "encerrar" }).success).toBe(true);
    expect(
      METODOS["rotinas.hoje"].saida.safeParse({ briefing, fechamento: null, diaEncerrado: false }).success,
    ).toBe(true);
  });
});
