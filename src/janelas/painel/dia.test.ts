import { describe, expect, it } from "vitest";
import {
  cronometro,
  dataPorExtenso,
  diaCurto,
  diaNoFuso,
  diaPassado,
  diasEntre,
  duracao,
  emQuanto,
  horaNoFuso,
  inicioDoDia,
  somarDias,
} from "./dia.ts";

const SP = "America/Sao_Paulo";

describe("o dia no fuso do usuário", () => {
  it("o dia e a hora são os do fuso, não os do UTC", () => {
    // 02:30 UTC do dia 9 ainda é 23:30 do dia 8 em São Paulo.
    expect(diaNoFuso(new Date("2026-10-09T02:30:00Z"), SP)).toBe("2026-10-08");
    expect(horaNoFuso("2026-10-08T17:45:00Z", SP)).toBe("14:45");
    expect(horaNoFuso("2026-10-08T03:05:00Z", SP)).toBe("00:05");
    expect(diaNoFuso(new Date("2026-10-08T20:00:00Z"), "Asia/Tokyo")).toBe("2026-10-09");
  });

  it("escreve a data por extenso e o dia curto como os quadros", () => {
    expect(dataPorExtenso("2026-10-08")).toBe("quinta, 8 de outubro");
    expect(dataPorExtenso("2026-03-01")).toBe("domingo, 1 de março");
    expect(diaCurto("2026-10-09")).toBe("sex, 9 out");
  });

  it("conta dias atravessando mês e ano", () => {
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(diasEntre("2026-10-01", "2026-10-08")).toBe(7);
  });

  it("o dia de uma atrasada: ontem, o dia da semana até seis dias, depois o dia e o mês", () => {
    expect(diaPassado("2026-10-07", "2026-10-08")).toBe("ontem");
    expect(diaPassado("2026-10-06", "2026-10-08")).toBe("ter");
    expect(diaPassado("2026-10-02", "2026-10-08")).toBe("sex");
    expect(diaPassado("2026-10-01", "2026-10-08")).toBe("1 out");
    expect(diaPassado("2026-09-12", "2026-10-08")).toBe("12 set");
  });

  it("o início do dia é a meia-noite no fuso, inclusive no dia em que o horário de verão começa", () => {
    expect(inicioDoDia("2026-10-08", SP).toISOString()).toBe("2026-10-08T03:00:00.000Z");
    expect(inicioDoDia("2026-10-08", "Asia/Kolkata").toISOString()).toBe("2026-10-07T18:30:00.000Z");
    // Nova York: o relógio pula das 2h para as 3h em 8/3/2026; a meia-noite ainda é UTC-5.
    expect(inicioDoDia("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(inicioDoDia("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("quanto falta e quanto durou", () => {
  const agora = new Date("2026-10-08T17:32:00Z");

  it("em quanto o lembrete chega, arredondando para cima", () => {
    expect(emQuanto("2026-10-08T17:45:00Z", agora)).toBe("em 13 min");
    expect(emQuanto("2026-10-08T17:32:20Z", agora)).toBe("em 1 min");
    expect(emQuanto("2026-10-08T17:30:00Z", agora)).toBe("agora");
    expect(emQuanto("2026-10-08T19:02:00Z", agora)).toBe("em 1h30");
    expect(emQuanto("2026-10-08T18:32:00Z", agora)).toBe("em 1 h");
  });

  it("a duração da ausência e o cronômetro do foco", () => {
    expect(duracao(105 * 60_000)).toBe("1h45");
    expect(duracao(45 * 60_000)).toBe("45 min");
    expect(duracao(120 * 60_000)).toBe("2 h");
    expect(cronometro(18 * 60_000 + 42_000)).toBe("18:42");
    expect(cronometro(65 * 60_000)).toBe("1:05:00");
    expect(cronometro(999)).toBe("00:01");
    expect(cronometro(-5)).toBe("00:00");
  });
});
