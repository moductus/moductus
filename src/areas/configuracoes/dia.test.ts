import { describe, expect, it } from "vitest";
import {
  alternarDia,
  avisoDaHoraDeParar,
  diaDaSemanaNoFuso,
  deslocamentoDoFuso,
  etapasDaRodada,
  nomeDoFuso,
  opcoesDeFuso,
  opcoesDoCiclo,
  resumoDaRodada,
} from "./dia.ts";

const OUTUBRO = new Date("2026-10-23T15:00:00.000Z");

describe("O dia: contas", () => {
  it("o dia liga e desliga em ordem; o último não desliga", () => {
    expect(alternarDia([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(alternarDia([5, 1], 3)).toEqual([1, 3, 5]);
    expect(alternarDia([1, 2], 1)).toEqual([2]);
    expect(alternarDia([4], 4)).toBeNull();
  });

  it("o dia da semana é o do fuso, de 1 (segunda) a 7 (domingo)", () => {
    // Domingo 23:30 em São Paulo já é segunda em UTC.
    const domingoNoite = new Date("2026-10-26T02:30:00.000Z");
    expect(diaDaSemanaNoFuso(domingoNoite, "America/Sao_Paulo")).toBe(7);
    expect(diaDaSemanaNoFuso(domingoNoite, "Europe/Lisbon")).toBe(1);
  });

  it("o aviso diz se a hora nova vale já hoje", () => {
    expect(avisoDaHoraDeParar("18:00", "18:30", true)).toBe(
      "Vale já hoje: o fechamento passa de 18:00 para 18:30.",
    );
    expect(avisoDaHoraDeParar("18:00", "17:00", false)).toBe(
      "Vale no próximo dia de trabalho: o fechamento passa de 18:00 para 17:00.",
    );
  });

  it("o fuso pela cidade em português e o deslocamento de agora, com o menos tipográfico", () => {
    expect(nomeDoFuso("America/Sao_Paulo", OUTUBRO)).toBe("São Paulo (UTC−03:00)");
    expect(nomeDoFuso("America/Manaus", OUTUBRO)).toBe("Manaus (UTC−04:00)");
    // Lisboa ainda no horário de verão em 23/10, e o UTC sem deslocamento.
    expect(nomeDoFuso("Europe/Lisbon", OUTUBRO)).toBe("Lisboa (UTC+01:00)");
    expect(deslocamentoDoFuso("UTC", OUTUBRO)).toBe("UTC+00:00");
    expect(nomeDoFuso("Asia/Kolkata", OUTUBRO)).toBe("Kolkata (UTC+05:30)");
  });

  it("a lista do fuso começa pelo do Windows e traz o atual mesmo fora da lista do sistema", () => {
    const opcoes = opcoesDeFuso("America/Buenos_Aires", "America/Sao_Paulo", OUTUBRO);
    expect(opcoes[0]).toEqual({ valor: "America/Sao_Paulo", rotulo: "São Paulo (UTC−03:00) · o do Windows" });
    expect(opcoes.filter((o) => o.valor === "America/Sao_Paulo")).toHaveLength(1);
    expect(opcoes.some((o) => o.valor === "America/Buenos_Aires")).toBe(true);
    expect(opcoes.length).toBeGreaterThan(100);
  });

  it("as opções de cada ciclo trazem o valor salvo fora delas", () => {
    expect(opcoesDoCiclo("focoMin", 25).map((o) => o.rotulo)).toContain("25 min");
    expect(opcoesDoCiclo("pausaMin", 7).map((o) => o.valor)).toEqual([3, 5, 7, 10, 15]);
    expect(opcoesDoCiclo("ciclosAtePausaLonga", 1)[0]).toEqual({ valor: 1, rotulo: "1 foco" });
    expect(opcoesDoCiclo("ciclosAtePausaLonga", 4).find((o) => o.valor === 4)?.rotulo).toBe("4 focos");
  });

  it("a rodada do quadro: quatro focos de 25, pausas de 5 e a longa de 15 no fim", () => {
    const padrao = { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 };
    expect(etapasDaRodada(padrao).map((e) => `${e.tipo}:${e.minutos}`)).toEqual([
      "foco:25",
      "pausa:5",
      "foco:25",
      "pausa:5",
      "foco:25",
      "pausa:5",
      "foco:25",
      "pausa_longa:15",
    ]);
    expect(resumoDaRodada(padrao)).toBe("Uma rodada: 2h10, com 1h40 de foco.");
    expect(resumoDaRodada({ focoMin: 50, pausaMin: 10, pausaLongaMin: 30, ciclosAtePausaLonga: 1 })).toBe(
      "Uma rodada: 1h20, com 50 min de foco.",
    );
  });
});
