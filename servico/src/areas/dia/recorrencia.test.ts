import { describe, expect, test } from "vitest";
import {
  REPETE_DEFINIDO_FORA,
  descreverRegra,
  diaSemanaDe,
  diasNoIntervalo,
  escreverRecorrencia,
  instantesNoIntervalo,
  lerRecorrencia,
  proximoDia,
  proximoInstante,
} from "./recorrencia.ts";

const SP = "America/Sao_Paulo";
const dias = (regra: string | null, inicio: string, de: string, ate: string) =>
  diasNoIntervalo(regra, inicio, de, ate).ocorrencias;
const isos = (datas: Date[]) => datas.map((d) => d.toISOString());

describe("leitura da regra", () => {
  test("o subconjunto é entendido, com ou sem RRULE:, e volta ao texto do banco", () => {
    const l = lerRecorrencia("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T235959Z;WKST=SU");
    expect(l.entendida).toBe(true);
    if (!l.entendida) return;
    expect(l.regra).toEqual({
      frequencia: "WEEKLY",
      intervalo: 2,
      diasDaSemana: [
        { dia: "MO", ordem: null },
        { dia: "WE", ordem: null },
      ],
      diasDoMes: [],
      contagem: null,
      ate: { dia: "2026-12-31", hora: "23:59:59", utc: true },
      inicioDaSemana: "SU",
    });
    expect(escreverRecorrencia(l.regra)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T235959Z;WKST=SU",
    );
    for (const texto of [
      "FREQ=DAILY",
      "FREQ=MONTHLY;BYDAY=-1FR",
      "FREQ=YEARLY;COUNT=3",
      "FREQ=MONTHLY;BYMONTHDAY=31,-1",
    ]) {
      const lida = lerRecorrencia(texto);
      expect(lida.entendida && escreverRecorrencia(lida.regra)).toBe(texto);
    }
    expect(lerRecorrencia("freq=daily;until=20261231").entendida).toBe(true);
  });

  test("regra fora do subconjunto é guardada como veio e não é expandida", () => {
    const foraDoSubconjunto = [
      "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1",
      "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "FREQ=HOURLY",
      "FREQ=WEEKLY;BYMONTHDAY=3",
      "FREQ=WEEKLY;BYDAY=2MO",
      "FREQ=DAILY;COUNT=3;UNTIL=20261231",
      "FREQ=DAILY;UNTIL=20270229",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;FREQ=WEEKLY",
      "RRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20261019T130000Z",
      "INTERVAL=2",
      "lixo",
    ];
    for (const texto of foraDoSubconjunto) {
      const l = lerRecorrencia(texto);
      expect(l, texto).toMatchObject({ entendida: false, texto });
    }
    const texto = "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2";
    // O início aparece, sem ocorrência inventada, e a próxima não é gerada.
    expect(diasNoIntervalo(texto, "2026-10-13", "2026-10-01", "2026-12-31")).toEqual({
      ocorrencias: ["2026-10-13"],
      entendida: false,
    });
    const inicio = new Date("2026-10-13T13:00:00.000Z");
    expect(instantesNoIntervalo(texto, inicio, SP, "2026-10-01", "2026-12-31")).toEqual({
      ocorrencias: [inicio],
      entendida: false,
    });
    expect(proximoDia(texto, "2026-10-13", "2026-10-13")).toBeNull();
    expect(proximoInstante(texto, inicio, SP, inicio)).toBeNull();
    expect(REPETE_DEFINIDO_FORA).toBe("repete (definido no Google)");
  });

  test("sem regra, só o início", () => {
    expect(diasNoIntervalo(null, "2026-10-19", "2026-10-01", "2026-10-31")).toEqual({
      ocorrencias: ["2026-10-19"],
      entendida: true,
    });
    expect(dias(null, "2026-11-19", "2026-10-01", "2026-10-31")).toEqual([]);
    expect(proximoDia(null, "2026-10-19", "2026-10-19")).toBeNull();
  });
});

describe("expansão", () => {
  test("todo dia, atravessando a virada do mês e o 29/02", () => {
    expect(dias("FREQ=DAILY", "2026-10-30", "2026-10-01", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(dias("FREQ=DAILY", "2028-02-27", "2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
    expect(dias("FREQ=DAILY;INTERVAL=3", "2026-10-01", "2026-10-01", "2026-10-10")).toEqual([
      "2026-10-01",
      "2026-10-04",
      "2026-10-07",
      "2026-10-10",
    ]);
  });

  test("toda segunda", () => {
    expect(diaSemanaDe("2026-10-19")).toBe("MO");
    expect(dias("FREQ=WEEKLY;BYDAY=MO", "2026-10-19", "2026-10-01", "2026-11-10")).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
    // Sem BYDAY, o dia da semana é o do início.
    expect(dias("FREQ=WEEKLY", "2026-10-19", "2026-10-20", "2026-10-31")).toEqual(["2026-10-26"]);
    expect(dias("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-10-19", "2026-10-19", "2026-11-08")).toEqual([
      "2026-10-19",
      "2026-10-22",
      "2026-11-02",
      "2026-11-05",
    ]);
    // A semana de 15 em 15 dias começa no WKST: com domingo, o domingo 01/11 é de outra semana.
    expect(
      dias("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU", "2026-10-18", "2026-10-18", "2026-11-02"),
    ).toEqual(["2026-10-18", "2026-10-19", "2026-11-01", "2026-11-02"]);
    expect(dias("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO", "2026-10-18", "2026-10-18", "2026-11-02")).toEqual([
      "2026-10-18",
      "2026-10-26",
      "2026-11-01",
    ]);
  });

  test("todo dia 31 pula o mês curto, como o RFC 5545", () => {
    expect(dias("FREQ=MONTHLY", "2026-01-31", "2026-01-01", "2026-08-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
      "2026-08-31",
    ]);
    expect(dias("FREQ=MONTHLY;BYMONTHDAY=31", "2026-10-31", "2026-10-01", "2027-01-31")).toEqual([
      "2026-10-31",
      "2026-12-31",
      "2027-01-31",
    ]);
    // O último dia do mês é o −1.
    expect(dias("FREQ=MONTHLY;BYMONTHDAY=-1", "2028-01-31", "2028-01-01", "2028-04-30")).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
      "2028-04-30",
    ]);
    expect(proximoDia("FREQ=MONTHLY", "2026-01-31", "2026-01-31")).toBe("2026-03-31");
  });

  test("todo 29/02 só no bissexto", () => {
    expect(dias("FREQ=YEARLY", "2028-02-29", "2028-01-01", "2037-12-31")).toEqual([
      "2028-02-29",
      "2032-02-29",
      "2036-02-29",
    ]);
    expect(proximoDia("FREQ=YEARLY", "2096-02-29", "2096-02-29")).toBe("2104-02-29");
  });

  test("dia da semana com ordem: a segunda terça e a última sexta do mês", () => {
    expect(dias("FREQ=MONTHLY;BYDAY=2TU", "2026-10-13", "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-13",
      "2026-11-10",
      "2026-12-08",
    ]);
    expect(dias("FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30", "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-30",
      "2026-11-27",
      "2026-12-25",
    ]);
    // BYDAY junto com BYMONTHDAY: sexta-feira 13.
    expect(dias("FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13", "2026-02-13", "2026-01-01", "2027-12-31")).toEqual([
      "2026-02-13",
      "2026-03-13",
      "2026-11-13",
      "2027-08-13",
    ]);
  });

  test("COUNT inclui o início e UNTIL é inclusivo", () => {
    expect(dias("FREQ=WEEKLY;BYDAY=MO;COUNT=3", "2026-10-19", "2026-01-01", "2027-12-31")).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
    expect(proximoDia("FREQ=WEEKLY;BYDAY=MO;COUNT=3", "2026-10-19", "2026-10-26")).toBe("2026-11-02");
    expect(proximoDia("FREQ=WEEKLY;BYDAY=MO;COUNT=3", "2026-10-19", "2026-11-02")).toBeNull();
    expect(dias("FREQ=DAILY;UNTIL=20261022", "2026-10-19", "2026-01-01", "2027-12-31")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
    expect(proximoDia("FREQ=DAILY;UNTIL=20261022", "2026-10-19", "2026-10-22")).toBeNull();
    // O início conta mesmo fora do sincronismo e mesmo com UNTIL antes dele.
    expect(dias("FREQ=WEEKLY;BYDAY=MO;COUNT=2", "2026-10-21", "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-21",
      "2026-10-26",
    ]);
    expect(dias("FREQ=DAILY;UNTIL=20261001", "2026-10-19", "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-19",
    ]);
  });

  test("o intervalo pedido corta o começo, e regra que nunca acerta não trava", () => {
    expect(dias("FREQ=DAILY", "2020-01-01", "2026-10-18", "2026-10-19")).toEqual([
      "2026-10-18",
      "2026-10-19",
    ]);
    // De 7 em 7 dias a partir de uma terça, nunca é segunda.
    expect(proximoDia("FREQ=DAILY;INTERVAL=7;BYDAY=MO", "2026-10-20", "2026-10-20")).toBeNull();
  });

  test("ordem no anual: a vigésima segunda-feira e toda segunda do ano", () => {
    expect(dias("FREQ=YEARLY;BYDAY=20MO", "1997-05-19", "1997-01-01", "1999-12-31")).toEqual([
      "1997-05-19",
      "1998-05-18",
      "1999-05-17",
    ]);
    expect(dias("FREQ=YEARLY;BYDAY=-1SU", "2026-12-27", "2026-01-01", "2028-12-31")).toEqual([
      "2026-12-27",
      "2027-12-26",
      "2028-12-31",
    ]);
    expect(dias("FREQ=YEARLY;BYDAY=MO", "2026-12-21", "2026-12-01", "2027-01-11")).toEqual([
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
      "2027-01-11",
    ]);
    // BYMONTHDAY no anual vale em todo mês.
    expect(dias("FREQ=YEARLY;BYMONTHDAY=1,-1", "2026-01-01", "2026-01-01", "2026-03-01")).toEqual([
      "2026-01-01",
      "2026-01-31",
      "2026-02-01",
      "2026-02-28",
      "2026-03-01",
    ]);
  });

  test("sem COUNT, começar no período pedido não tira a regra do passo", () => {
    // Com COUNT a expansão conta desde o início; sem, ela pula até o intervalo. As duas batem.
    for (const regra of [
      "FREQ=DAILY;INTERVAL=3",
      "FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,SA",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU",
      "FREQ=MONTHLY;INTERVAL=5;BYDAY=-1FR",
      "FREQ=MONTHLY;INTERVAL=7",
      "FREQ=YEARLY;INTERVAL=5;BYMONTHDAY=13;BYDAY=FR",
    ]) {
      const semContagem = dias(regra, "2001-01-30", "2026-01-01", "2027-12-31");
      expect(semContagem.length, regra).toBeGreaterThan(0);
      expect(semContagem, regra).toEqual(
        dias(`${regra};COUNT=100000`, "2001-01-30", "2026-01-01", "2027-12-31"),
      );
    }
  });

  test("regra anual com ordem que nunca acerta, ou com muitos itens, não trava o serviço", () => {
    const prazo = (f: () => unknown) => {
      const antes = performance.now();
      f();
      return performance.now() - antes;
    };
    const doMes = Array.from({ length: 28 }, (_, i) => i + 1).join(",");
    // A 53ª segunda nunca cai de 1 a 28: mil anos sem acerto.
    const nunca = `FREQ=YEARLY;BYDAY=53MO;BYMONTHDAY=${doMes}`;
    const nuncaSete = `FREQ=YEARLY;BYDAY=53MO,53TU,53WE,53TH,53FR,53SA,53SU;BYMONTHDAY=${doMes}`;
    for (const regra of [nunca, nuncaSete]) {
      expect(
        prazo(() => expect(proximoDia(regra, "2026-01-01", "2026-01-01")).toBeNull()),
        regra,
      ).toBeLessThan(200);
      const inicio = new Date("2026-01-01T13:00:00.000Z");
      expect(
        prazo(() => expect(proximoInstante(regra, inicio, SP, inicio)).toBeNull()),
        regra,
      ).toBeLessThan(200);
    }
    // 83 ordens (-1MO a -52MO e de novo), no limite de 500 caracteres: toda segunda do ano.
    const ordens = Array.from({ length: 83 }, (_, i) => `-${(i % 52) + 1}MO`).join(",");
    const muitos = `FREQ=YEARLY;BYDAY=${ordens}`;
    expect(muitos.length).toBeLessThanOrEqual(500);
    const segundas = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
    // Com COUNT a expansão conta desde 1900, sem pular.
    const comContagem = `FREQ=YEARLY;BYDAY=${Array.from({ length: 52 }, (_, i) => `-${i + 1}MO`).join(",")};COUNT=999999`;
    for (const regra of [muitos, comContagem]) {
      expect(lerRecorrencia(regra).entendida, regra).toBe(true);
      expect(
        prazo(() => expect(dias(regra, "1900-01-01", "2026-10-01", "2026-11-02")).toEqual(segundas)),
      ).toBeLessThan(200);
    }
  });

  test("o calendário vai do ano 1 ao 9999", () => {
    expect(dias("FREQ=DAILY;COUNT=2", "0050-03-01", "0001-01-01", "2000-01-01")).toEqual([
      "0050-03-01",
      "0050-03-02",
    ]);
    expect(proximoDia("FREQ=YEARLY", "0096-02-29", "0096-02-29")).toBe("0104-02-29");
    expect(dias("FREQ=MONTHLY;BYDAY=-1FR", "0099-12-25", "0099-12-01", "0100-01-31")).toEqual([
      "0099-12-25",
      "0100-01-29",
    ]);
    // Depois de 9999-12-31 não há próxima: a expansão para no fim do calendário.
    expect(dias("FREQ=DAILY", "9999-12-30", "9999-12-01", "9999-12-31")).toEqual([
      "9999-12-30",
      "9999-12-31",
    ]);
    expect(proximoDia("FREQ=DAILY", "9999-12-30", "9999-12-31")).toBeNull();
    expect(proximoDia("FREQ=YEARLY", "9999-06-01", "9999-06-01")).toBeNull();
    const fimDoAno = new Date("9999-12-31T13:00:00.000Z");
    expect(proximoInstante("FREQ=WEEKLY", fimDoAno, SP, fimDoAno)).toBeNull();
  });
});

describe("com hora, no relógio do fuso", () => {
  test("toda segunda às 10h, ida e volta pelo UTC", () => {
    const inicio = new Date("2026-10-19T13:00:00.000Z");
    const r = instantesNoIntervalo("FREQ=WEEKLY;BYDAY=MO", inicio, SP, "2026-10-19", "2026-11-02");
    expect(isos(r.ocorrencias)).toEqual([
      "2026-10-19T13:00:00.000Z",
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T13:00:00.000Z",
    ]);
    expect(proximoInstante("FREQ=WEEKLY;BYDAY=MO", inicio, SP, inicio)?.toISOString()).toBe(
      "2026-10-26T13:00:00.000Z",
    );
  });

  test("o dia da ocorrência é o do fuso: 22h em São Paulo já é o dia seguinte no UTC", () => {
    const inicio = new Date("2026-10-31T01:00:00.000Z"); // 30/10 às 22h
    const r = instantesNoIntervalo("FREQ=DAILY", inicio, SP, "2026-10-31", "2026-11-01");
    expect(isos(r.ocorrencias)).toEqual(["2026-11-01T01:00:00.000Z", "2026-11-02T01:00:00.000Z"]);
  });

  test("a hora do relógio se mantém quando o horário de verão muda", () => {
    const ny = "America/New_York";
    const inicio = new Date("2026-03-07T14:00:00.000Z"); // 7/3 às 9h, antes da mudança
    const r = instantesNoIntervalo("FREQ=DAILY;COUNT=2", inicio, ny, "2026-03-01", "2026-03-31");
    expect(isos(r.ocorrencias)).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"]);
  });

  test("UNTIL em UTC compara o instante; sem Z, o relógio do fuso", () => {
    const inicio = new Date("2026-10-19T13:00:00.000Z"); // 10h
    // 22/10 às 12:59 UTC é 09:59 em São Paulo: o das 10h do dia 22 fica de fora.
    expect(
      isos(
        instantesNoIntervalo("FREQ=DAILY;UNTIL=20261022T125900Z", inicio, SP, "2026-10-01", "2026-10-31")
          .ocorrencias,
      ),
    ).toEqual(["2026-10-19T13:00:00.000Z", "2026-10-20T13:00:00.000Z", "2026-10-21T13:00:00.000Z"]);
    expect(
      instantesNoIntervalo("FREQ=DAILY;UNTIL=20261022T100000", inicio, SP, "2026-10-01", "2026-10-31")
        .ocorrencias,
    ).toHaveLength(4);
    expect(
      instantesNoIntervalo("FREQ=DAILY;UNTIL=20261022", inicio, SP, "2026-10-01", "2026-10-31").ocorrencias,
    ).toHaveLength(4);
    // UNTIL em UTC que cai no dia seguinte do UTC mas ainda no dia do fuso.
    const noite = new Date("2026-10-20T01:00:00.000Z"); // 19/10 às 22h
    expect(
      instantesNoIntervalo("FREQ=DAILY;UNTIL=20261022T010000Z", noite, SP, "2026-10-01", "2026-10-31")
        .ocorrencias,
    ).toHaveLength(3);
    expect(
      proximoInstante("FREQ=DAILY;UNTIL=20261022", inicio, SP, new Date("2026-10-22T13:00:00.000Z")),
    ).toBeNull();
  });

  test("o lembrete recorrente acha a próxima depois de agora, mesmo muito depois do início", () => {
    const inicio = new Date("2026-01-15T18:00:00.000Z"); // 15h
    const agora = new Date("2026-10-18T19:00:00.000Z");
    expect(proximoInstante("FREQ=DAILY", inicio, SP, agora)?.toISOString()).toBe("2026-10-19T18:00:00.000Z");
    expect(proximoInstante("FREQ=MONTHLY", inicio, SP, agora)?.toISOString()).toBe(
      "2026-11-15T18:00:00.000Z",
    );
    expect(proximoInstante(null, inicio, SP, agora)).toBeNull();
    // O COUNT conta as ocorrências de antes do intervalo pedido.
    const dez = new Date("2026-10-19T13:00:00.000Z");
    expect(
      isos(instantesNoIntervalo("FREQ=DAILY;COUNT=5", dez, SP, "2026-10-22", "2026-10-31").ocorrencias),
    ).toEqual(["2026-10-22T13:00:00.000Z", "2026-10-23T13:00:00.000Z"]);
    expect(proximoInstante("FREQ=DAILY;COUNT=5", dez, SP, new Date("2026-10-23T13:00:00.000Z"))).toBeNull();
  });
});

describe("a regra em frase", () => {
  const frase = (texto: string) => {
    const leitura = lerRecorrencia(texto);
    if (!leitura.entendida) throw new Error(leitura.motivo);
    return descreverRegra(leitura.regra);
  };

  test("frequência, intervalo, dias, ordem, contagem e fim", () => {
    expect(frase("FREQ=DAILY")).toBe("todo dia");
    expect(frase("FREQ=DAILY;INTERVAL=3")).toBe("a cada 3 dias");
    expect(frase("FREQ=WEEKLY")).toBe("toda semana");
    expect(frase("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("toda segunda e quarta");
    expect(frase("FREQ=WEEKLY;BYDAY=SA,SU")).toBe("todo sábado e domingo");
    expect(frase("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR")).toBe("a cada 2 semanas, sexta");
    expect(frase("FREQ=MONTHLY;BYMONTHDAY=5")).toBe("todo dia 5");
    expect(frase("FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("todo último dia do mês");
    expect(frase("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15")).toBe("a cada 2 meses, dia 1 e 15");
    expect(frase("FREQ=MONTHLY;BYDAY=-1FR")).toBe("toda última sexta do mês");
    expect(frase("FREQ=MONTHLY;BYDAY=2TU")).toBe("toda segunda terça do mês");
    expect(frase("FREQ=YEARLY")).toBe("todo ano");
    expect(frase("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBe("toda segunda, 10 vezes");
    expect(frase("FREQ=DAILY;UNTIL=20261130")).toBe("todo dia, até 30/11/2026");
  });
});
