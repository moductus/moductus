import { describe, expect, test } from "vitest";
import { ContagensAreas } from "./areas.ts";
import {
  CampoCaptura,
  LancamentoCaptura,
  PedidoEntender,
  PedidoLancar,
  PreviaCaptura,
  TipoCaptura,
  TipoLancavel,
} from "./captura.ts";
import { METODOS } from "./metodos.ts";

const campos = {
  titulo: "Ligar pro banco",
  dia: "2026-10-09",
  hora: "15:00",
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: 15,
  listaId: null,
  valorCentavos: null,
};

describe("captura", () => {
  test("gasto e memória são reconhecidos, mas não se lançam nesta versão", () => {
    expect(TipoCaptura.options).toEqual(["tarefa", "lembrete", "evento", "nota", "gasto", "memoria"]);
    expect(TipoLancavel.options).toEqual(["tarefa", "lembrete", "evento", "nota"]);
    expect(PedidoLancar.safeParse({ texto: "45 de mercado", tipo: "gasto", campos }).success).toBe(false);
    expect(
      PedidoLancar.safeParse({ texto: "ligar pro banco amanhã 15h", tipo: "tarefa", campos }).success,
    ).toBe(true);
  });

  test("a prévia diz o tipo, os campos, o trecho reconhecido e as alternativas", () => {
    const previa = {
      texto: "ligar pro banco amanhã 15h",
      tipo: "tarefa",
      campos,
      trechos: [
        { campo: "dia", inicio: 16, fim: 22 },
        { campo: "hora", inicio: 23, fim: 26 },
      ],
      alternativas: ["lembrete", "evento", "nota"],
      aviso: null,
      entendidoPor: "codigo",
    };
    expect(PreviaCaptura.parse(previa)).toEqual(previa);
    expect(PreviaCaptura.safeParse({ ...previa, alternativas: ["gasto"] }).success).toBe(false);
    expect(
      PreviaCaptura.safeParse({ ...previa, trechos: [{ campo: "cor", inicio: 0, fim: 1 }] }).success,
    ).toBe(false);
    expect(
      PreviaCaptura.safeParse({ ...previa, trechos: [{ campo: "dia", inicio: 3, fim: 3 }] }).success,
    ).toBe(false);
    expect(CampoCaptura.options).toContain("lembreteMinutosAntes");
    const gasto = {
      ...previa,
      tipo: "gasto",
      campos: { ...campos, valorCentavos: 4500 },
      aviso: "Gastos chegam com a Tula.",
    };
    expect(PreviaCaptura.safeParse(gasto).success).toBe(true);
  });

  test("frase vazia não é entendida; lançar volta o prazo de desfazer", () => {
    expect(PedidoEntender.safeParse({ texto: "   " }).success).toBe(false);
    const lancamento = {
      id: "01K7A0000000000000000000C1",
      tipo: "tarefa",
      itemId: "01K7A0000000000000000000T1",
      desfazerAte: "2026-10-08T12:00:10.000Z",
    };
    expect(LancamentoCaptura.parse(lancamento)).toEqual(lancamento);
    expect(METODOS["captura.desfazer"].entrada.safeParse({ id: lancamento.id }).success).toBe(true);
  });
});

describe("contagens das áreas", () => {
  test("só números inteiros, sem negativo", () => {
    const contagens = { tarefasPendentes: 4, lembretesAtrasados: 0, sessoesEsperando: 1, devPrecisando: 2 };
    expect(ContagensAreas.parse(contagens)).toEqual(contagens);
    expect(ContagensAreas.safeParse({ ...contagens, tarefasPendentes: -1 }).success).toBe(false);
    expect(METODOS["areas.contagens"].saida.safeParse(contagens).success).toBe(true);
  });
});
