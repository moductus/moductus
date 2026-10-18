import { describe, expect, test } from "vitest";
import {
  TempoDoDia,
  deslocamento,
  diaDaSemana,
  diaNoFuso,
  diasEntre,
  diasNoMes,
  ehDia,
  horaNoFuso,
  inicioDoDia,
  instanteNoFuso,
  noFuso,
  somarDias,
} from "./tempo.ts";

const SP = "America/Sao_Paulo";
const em = (iso: string) => new Date(iso);

describe("dia civil no fuso", () => {
  test("a virada do dia é a meia-noite do fuso, não a do UTC", () => {
    expect(diaNoFuso(em("2026-10-18T02:59:59.999Z"), SP)).toBe("2026-10-17");
    expect(horaNoFuso(em("2026-10-18T02:59:59.999Z"), SP)).toBe("23:59");
    expect(diaNoFuso(em("2026-10-18T03:00:00.000Z"), SP)).toBe("2026-10-18");
    expect(horaNoFuso(em("2026-10-18T03:00:00.000Z"), SP)).toBe("00:00");
    // O mesmo instante é outro dia em Tóquio.
    expect(diaNoFuso(em("2026-10-18T16:00:00.000Z"), "Asia/Tokyo")).toBe("2026-10-19");
    expect(diaNoFuso(em("2026-10-18T16:00:00.000Z"), SP)).toBe("2026-10-18");
  });

  test("a virada do mês e do ano", () => {
    expect(diaNoFuso(em("2026-11-01T02:30:00.000Z"), SP)).toBe("2026-10-31");
    expect(diaNoFuso(em("2026-11-01T03:00:00.000Z"), SP)).toBe("2026-11-01");
    expect(diaNoFuso(em("2027-01-01T02:59:00.000Z"), SP)).toBe("2026-12-31");
    expect(diaNoFuso(em("2027-01-01T03:00:00.000Z"), SP)).toBe("2027-01-01");
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-11-01", -1)).toBe("2026-10-31");
  });

  test("29 de fevereiro só no bissexto", () => {
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2027-02-28", 1)).toBe("2027-03-01");
    expect(diasNoMes(2028, 2)).toBe(29);
    expect(diasNoMes(2027, 2)).toBe(28);
    expect(diasNoMes(2100, 2)).toBe(28);
    expect(diasNoMes(2000, 2)).toBe(29);
    expect(ehDia("2028-02-29")).toBe(true);
    expect(ehDia("2027-02-29")).toBe(false);
    expect(ehDia("2026-04-31")).toBe(false);
    expect(diaNoFuso(em("2028-02-29T15:00:00.000Z"), SP)).toBe("2028-02-29");
    expect(diaNoFuso(em("2028-03-01T02:00:00.000Z"), SP)).toBe("2028-02-29");
    expect(diasEntre("2028-02-01", "2028-03-01")).toBe(29);
  });

  test("dia da semana, de 0 domingo a 6 sábado", () => {
    expect(diaDaSemana("2026-10-18")).toBe(0);
    expect(diaDaSemana("2026-10-19")).toBe(1);
    expect(noFuso(em("2026-10-19T02:00:00.000Z"), SP).diaDaSemana).toBe(0);
  });

  test("o instante de uma hora num dia, ida e volta", () => {
    const i = instanteNoFuso("2026-10-19", "15:00", SP);
    expect(i.toISOString()).toBe("2026-10-19T18:00:00.000Z");
    expect(horaNoFuso(i, SP)).toBe("15:00");
    expect(instanteNoFuso("2026-10-19", "15:30:12.345", SP).toISOString()).toBe("2026-10-19T18:30:12.345Z");
    expect(noFuso(em("2026-10-19T18:30:12.345Z"), SP)).toMatchObject({ segundo: 12, milissegundo: 345 });
    expect(inicioDoDia("2026-10-19", SP).toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(deslocamento(i, SP)).toBe(-3 * 3_600_000);
    expect(() => instanteNoFuso("2026-10-19", "24:00", SP)).toThrow(RangeError);
    expect(() => instanteNoFuso("2026-02-30", "10:00", SP)).toThrow(RangeError);
  });

  test("horário de verão: a hora que pula anda para frente e a que repete vale a primeira vez", () => {
    // São Paulo em 2018: 04/11 começou às 00:00, que virou 01:00.
    expect(inicioDoDia("2018-11-04", SP).toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(horaNoFuso(inicioDoDia("2018-11-04", SP), SP)).toBe("01:00");
    expect(instanteNoFuso("2018-11-04", "00:30", SP).toISOString()).toBe("2018-11-04T03:30:00.000Z");
    // E em 17/02/2019 acabou: 00:00 voltou para 23:00 do dia 16, e 23:30 aconteceu duas vezes.
    expect(instanteNoFuso("2019-02-16", "23:30", SP).toISOString()).toBe("2019-02-17T01:30:00.000Z");
    expect(diaNoFuso(em("2019-02-17T02:30:00.000Z"), SP)).toBe("2019-02-16");
    // Nova York: 8/3/2026 às 2h vira 3h.
    expect(instanteNoFuso("2026-03-08", "02:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(instanteNoFuso("2026-03-08", "12:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T16:00:00.000Z",
    );
  });
});

describe("TempoDoDia", () => {
  test("hoje e amanhã no fuso de config, lido a cada pergunta", () => {
    let fuso = SP;
    const tempo = new TempoDoDia(
      () => fuso,
      () => em("2026-10-31T23:30:00.000Z"),
    );
    expect(tempo.hoje()).toBe("2026-10-31");
    expect(tempo.amanha()).toBe("2026-11-01");
    expect(tempo.momento().hora).toBe("20:30");
    fuso = "Asia/Tokyo";
    expect(tempo.hoje()).toBe("2026-11-01");
    expect(tempo.amanha()).toBe("2026-11-02");
    expect(tempo.instante("2026-11-01", "08:00").toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(tempo.diaDe(em("2026-10-31T14:59:00.000Z"))).toBe("2026-10-31");
    expect(tempo.horaDe(em("2026-10-31T14:59:00.000Z"))).toBe("23:59");
    expect(tempo.inicioDoDia("2026-11-01").toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
});
