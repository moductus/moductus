import type { PreviaCaptura } from "@moductus/contrato";
import { describe, expect, it, vi } from "vitest";
import {
  diaCurto,
  diaPorExtenso,
  diasEntre,
  formatarAntes,
  formatarDia,
  formatarMinutos,
  formatarRepeticao,
  hojeNoFuso,
  lancado,
  previaDoEnter,
  repeticaoNaLinha,
  somarDias,
  veioDe,
} from "./dia.ts";

const HOJE = "2026-10-08";

describe("o dia no fuso", () => {
  it("hoje é o do fuso, não o UTC; fuso desconhecido cai no do Windows", () => {
    // 01:30 UTC do dia 9 ainda é dia 8 em São Paulo.
    expect(hojeNoFuso(new Date("2026-10-09T01:30:00.000Z"), "America/Sao_Paulo")).toBe(HOJE);
    expect(hojeNoFuso(new Date("2026-10-09T01:30:00.000Z"), "UTC")).toBe("2026-10-09");
    expect(hojeNoFuso(new Date(2026, 9, 8, 12), "Lugar/Nenhum")).toBe(HOJE);
  });

  it("as contas de dia valem no calendário inteiro do serviço, inclusive o ano 0050", () => {
    expect(somarDias("0050-12-31", 1)).toBe("0051-01-01");
    expect(diasEntre("0050-01-01", "0050-01-31")).toBe(30);
  });
});

describe("o dia escrito", () => {
  it("por extenso no Entendi, curto na linha, com o ano quando não é o de hoje", () => {
    expect(diaPorExtenso("2026-10-09", HOJE)).toBe("sexta, 9 out");
    expect(diaPorExtenso("2027-01-05", HOJE)).toBe("terça, 5 jan 2027");
    expect(formatarDia("2026-10-09", HOJE)).toBe("Amanhã");
    expect(diaCurto("2026-10-06", HOJE)).toBe("ter");
    expect(diaCurto("2026-10-20", HOJE)).toBe("20 out");
  });

  it("a atrasada diz de quando veio", () => {
    expect(veioDe("2026-10-07", HOJE)).toBe("veio de ontem");
    expect(veioDe("2026-10-06", HOJE)).toBe("veio de terça");
    expect(veioDe("2026-09-30", HOJE)).toBe("veio de 30 set");
  });
});

describe("minutos, antecedência e repetição", () => {
  it("um formatador só para as telas", () => {
    expect(formatarMinutos(90)).toBe("1 h 30");
    expect(formatarAntes(15)).toBe("15 min antes");
    expect(formatarAntes(0)).toBe("na hora");
    expect(formatarAntes(1440)).toBe("1 dia antes");
  });

  it("a repetição diz o que sabe e o resto fica só repete", () => {
    expect(formatarRepeticao("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("toda seg, qua");
    expect(formatarRepeticao("FREQ=WEEKLY;BYDAY=MO,MO")).toBe("toda seg");
    expect(formatarRepeticao("FREQ=WEEKLY;BYDAY=SA")).toBe("todo sáb");
    expect(formatarRepeticao("FREQ=MONTHLY;BYMONTHDAY=10,20")).toBe("todo dia 10, 20");
    expect(formatarRepeticao("FREQ=MONTHLY;BYDAY=2TU")).toBe("repete");
    expect(formatarRepeticao("FREQ=MONTHLY;BYMONTH=6")).toBe("repete");
    expect(formatarRepeticao("FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO,FR")).toBe("repete");
    expect(repeticaoNaLinha("RRULE:FREQ=MONTHLY")).toBe("repete todo mês");
    expect(repeticaoNaLinha("FREQ=SECONDLY")).toBe("repete");
  });

  it("o criada depois do Enter", () => {
    expect(lancado("tarefa")).toBe("Tarefa criada");
    expect(lancado("evento")).toBe("Evento criado");
  });
});

describe("a regra do Enter", () => {
  const previa = (texto: string, hora: string | null): PreviaCaptura => ({
    texto,
    tipo: "tarefa",
    campos: {
      titulo: "ligar pro banco",
      dia: "2026-10-09",
      hora,
      duracaoMin: null,
      recorrencia: null,
      lembreteMinutosAntes: null,
      listaId: null,
      valorCentavos: null,
    },
    trechos: [],
    alternativas: ["lembrete", "evento", "nota"],
    aviso: null,
    entendidoPor: "codigo",
  });

  it("a prévia da própria frase lança sem pedir outra", async () => {
    const pedir = vi.fn(async () => null);
    const mostrada = previa("ligar pro banco amanhã", null);
    expect(await previaDoEnter("ligar pro banco amanhã", mostrada, pedir)).toBe(mostrada);
    expect(pedir).not.toHaveBeenCalled();
  });

  it("atrasada, lança só se a nova disser o mesmo; sem prévia na tela, só mostra", async () => {
    const velha = previa("ligar pro banco amanhã", "15:00");
    const igual = previa("ligar pro banco amanhã ", "15:00");
    const outra = previa("ligar pro banco amanhã 16h", "16:00");
    expect(await previaDoEnter("x", velha, async () => igual)).toBe(igual);
    expect(await previaDoEnter("x", velha, async () => outra)).toBeNull();
    expect(await previaDoEnter("x", null, async () => outra)).toBeNull();
    expect(await previaDoEnter("x", velha, async () => null)).toBeNull();
  });
});
