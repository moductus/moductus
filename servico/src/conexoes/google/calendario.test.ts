import { describe, expect, test } from "vitest";
import { lerRecorrencia } from "../../areas/dia/recorrencia.ts";
import { lerEvento } from "./calendario.ts";

const FUSO = "America/Sao_Paulo";

const comHora = (extra: Record<string, unknown> = {}) => ({
  id: "ev1",
  etag: '"1"',
  status: "confirmed",
  summary: "Reunião",
  start: { dateTime: "2026-10-19T10:00:00-03:00", timeZone: FUSO },
  end: { dateTime: "2026-10-19T11:00:00-03:00", timeZone: FUSO },
  ...extra,
});

describe("lerEvento", () => {
  test("evento com hora vira instantes UTC com milissegundos; sem título fica vazio", () => {
    const lido = lerEvento(comHora({ summary: undefined, location: "Sala 2" }), FUSO);
    expect(lido).toEqual({
      tipo: "guardar",
      idExterno: "ev1",
      etag: '"1"',
      excecao: null,
      campos: {
        titulo: "",
        descricao: null,
        inicio: "2026-10-19T13:00:00.000Z",
        fim: "2026-10-19T14:00:00.000Z",
        diaInteiro: false,
        local: "Sala 2",
        recorrencia: null,
        excecoes: [],
      },
    });
  });

  test("data e hora sem deslocamento vale no fuso do evento", () => {
    const lido = lerEvento(
      comHora({
        start: { dateTime: "2026-10-19T10:00:00", timeZone: "Europe/Lisbon" },
        end: { dateTime: "2026-10-19T11:00:00", timeZone: "Europe/Lisbon" },
      }),
      FUSO,
    );
    expect(lido?.tipo === "guardar" && lido.campos.inicio).toBe("2026-10-19T09:00:00.000Z");
  });

  test("dia inteiro fica em dias, e o fim que não passa do início dura um dia", () => {
    const lido = lerEvento(
      { id: "d1", start: { date: "2026-10-20" }, end: { date: "2026-10-20" }, summary: "Feriado" },
      FUSO,
    );
    expect(lido?.tipo === "guardar" && lido.campos).toMatchObject({
      inicio: "2026-10-20",
      fim: "2026-10-21",
      diaInteiro: true,
    });
  });

  test("a regra simples fica como o Moductus guarda; o EXDATE vira exceção no fuso dele", () => {
    const lido = lerEvento(
      comHora({
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/Sao_Paulo:20261026T100000,20261102T100000",
          "EXDATE:20261109T130000Z",
        ],
      }),
      FUSO,
    );
    expect(lido?.tipo === "guardar" && lido.campos).toMatchObject({
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      excecoes: ["2026-10-26T13:00:00.000Z", "2026-11-02T13:00:00.000Z", "2026-11-09T13:00:00.000Z"],
    });
  });

  test("RDATE ou duas regras ficam como vieram, e o Moductus não as expande", () => {
    const lido = lerEvento(
      comHora({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "RDATE;VALUE=DATE:20261030"] }),
      FUSO,
    );
    const regra = lido?.tipo === "guardar" ? lido.campos.recorrencia : null;
    expect(regra).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO\nRDATE;VALUE=DATE:20261030");
    expect(lerRecorrencia(regra!).entendida).toBe(false);
  });

  test("regra maior que o contrato é cortada e deixa de ser entendida", () => {
    const longa = `RRULE:FREQ=WEEKLY;BYDAY=${Array.from({ length: 200 }, () => "MO").join(",")}`;
    const lido = lerEvento(comHora({ recurrence: [longa] }), FUSO);
    const regra = lido?.tipo === "guardar" ? lido.campos.recorrencia! : "";
    expect(regra).toHaveLength(500);
    expect(regra.endsWith("…")).toBe(true);
    expect(lerRecorrencia(regra).entendida).toBe(false);
  });

  test("a ocorrência mudada de lugar é um evento à parte que abre uma exceção no recorrente", () => {
    const lido = lerEvento(
      comHora({
        id: "rec_20261026T130000Z",
        recurringEventId: "rec",
        originalStartTime: { dateTime: "2026-10-26T10:00:00-03:00", timeZone: FUSO },
        start: { dateTime: "2026-10-26T15:00:00-03:00", timeZone: FUSO },
        end: { dateTime: "2026-10-26T16:00:00-03:00", timeZone: FUSO },
      }),
      FUSO,
    );
    expect(lido).toMatchObject({
      tipo: "guardar",
      excecao: { doRecorrente: "rec", inicioOriginal: "2026-10-26T13:00:00.000Z" },
      campos: { inicio: "2026-10-26T18:00:00.000Z", recorrencia: null },
    });
  });

  test("cancelado, recusado por você e local de trabalho saem do cache", () => {
    expect(
      lerEvento(
        {
          id: "rec_x",
          status: "cancelled",
          recurringEventId: "rec",
          originalStartTime: { date: "2026-10-26" },
        },
        FUSO,
      ),
    ).toEqual({
      tipo: "tirar",
      idExterno: "rec_x",
      excecao: { doRecorrente: "rec", inicioOriginal: "2026-10-26" },
    });
    expect(lerEvento({ id: "x", status: "cancelled" }, FUSO)).toEqual({
      tipo: "tirar",
      idExterno: "x",
      excecao: null,
    });
    expect(
      lerEvento(
        comHora({ attendees: [{ email: "voce@gmail.com", self: true, responseStatus: "declined" }] }),
        FUSO,
      )?.tipo,
    ).toBe("tirar");
    expect(lerEvento(comHora({ eventType: "workingLocation" }), FUSO)?.tipo).toBe("tirar");
  });

  test("o que não tem forma de evento é ignorado, sem derrubar nada", () => {
    expect(lerEvento(null, FUSO)).toBeNull();
    expect(lerEvento({ summary: "sem id" }, FUSO)).toBeNull();
    expect(lerEvento({ id: "a", start: {}, end: {} }, FUSO)).toBeNull();
    expect(lerEvento(comHora({ start: { dateTime: "ontem" } }), FUSO)).toBeNull();
    expect(
      lerEvento(comHora({ start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }), FUSO),
    ).toBeNull();
    // Fora do calendário do banco (ano 10000).
    expect(lerEvento(comHora({ end: { dateTime: "+010000-01-01T00:00:00Z" } }), FUSO)).toBeNull();
    expect(
      lerEvento(comHora({ start: { dateTime: "2026-10-19T10:00:00", timeZone: "Lua/Base" } }), "Lua/Base"),
    ).toBeNull();
    // Dia inteiro e hora misturados.
    expect(lerEvento(comHora({ end: { date: "2026-10-20" } }), FUSO)).toBeNull();
  });

  test("fim antes do início vira um evento sem duração", () => {
    const lido = lerEvento(comHora({ end: { dateTime: "2026-10-19T09:00:00-03:00" } }), FUSO);
    expect(lido?.tipo === "guardar" && lido.campos.fim).toBe("2026-10-19T13:00:00.000Z");
  });
});
