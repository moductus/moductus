import type { Calendario, Ocorrencia } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  emColunas,
  falaDaSugestao,
  falaDoGuardado,
  fonteDaAgenda,
  horaNaRegua,
  minutoNoDia,
  montarColuna,
  reguaDoDia,
} from "./agenda.ts";

const FUSO = "America/Sao_Paulo";
const DIA = "2026-10-08";
const EXPEDIENTE = { inicio: "09:00", fim: "18:00" };
/** Um instante na hora de São Paulo (UTC−3) do dia 8, ou de outro dia. */
const as = (hora: string, dia = DIA) => {
  const [h, m] = hora.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, Number(dia.slice(8)), h! + 3, m)).toISOString();
};

const ocorrencia = (extra: Partial<Ocorrencia>): Ocorrencia => ({
  eventoId: "e1",
  calendarioId: "local",
  titulo: "Daily",
  inicio: as("09:30"),
  fim: as("10:00"),
  diaInteiro: false,
  local: null,
  recorrente: false,
  editavel: true,
  ...extra,
});

const coluna = (ocorrencias: Ocorrencia[], extra: Partial<Parameters<typeof montarColuna>[0]> = {}) =>
  montarColuna({
    ocorrencias,
    livres: [],
    dia: DIA,
    fuso: FUSO,
    expediente: EXPEDIENTE,
    sugestao: null,
    agora: new Date(as("11:00")),
    ...extra,
  });

describe("minutoNoDia", () => {
  it("conta no fuso do usuário e prende ao dia", () => {
    expect(minutoNoDia(as("09:30"), DIA, FUSO)).toBe(570);
    // 01:30 UTC do dia 9 ainda é 22:30 do dia 8 em São Paulo.
    expect(minutoNoDia("2026-10-09T01:30:00.000Z", DIA, FUSO)).toBe(22 * 60 + 30);
    expect(minutoNoDia(as("23:00", "2026-10-07"), DIA, FUSO)).toBe(0);
    expect(minutoNoDia(as("01:00", "2026-10-09"), DIA, FUSO)).toBe(24 * 60);
  });
});

describe("montarColuna", () => {
  it("põe as ocorrências na régua do expediente, com a hora como no quadro", () => {
    const c = coluna([
      ocorrencia({ eventoId: "e2", titulo: "Planejamento", inicio: as("11:00"), fim: as("12:00") }),
      ocorrencia({}),
    ]);
    expect([c.de, c.ate]).toEqual([9, 18]);
    expect(c.horas).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(c.blocos.map((b) => [b.nome, b.hora, b.inicio, b.fim, b.tipo])).toEqual([
      ["Daily", "9:30–10h", 570, 600, "evento"],
      ["Planejamento", "11h–12h", 660, 720, "evento"],
    ]);
    expect(c.agora).toBe(660);
  });

  it("a régua alarga para caber o que passa do expediente; o que só encosta no dia fica fora", () => {
    const c = coluna([
      ocorrencia({ eventoId: "cedo", inicio: as("07:15"), fim: as("08:00") }),
      // Começa ontem à noite e termina hoje às 9h: vai da meia-noite às 9h.
      ocorrencia({ eventoId: "virada", inicio: as("22:00", "2026-10-07"), fim: as("09:00") }),
      // Terminou à meia-noite em que o dia começa.
      ocorrencia({ eventoId: "ontem", inicio: as("23:00", "2026-10-07"), fim: as("00:00") }),
      ocorrencia({ eventoId: "noite", inicio: as("20:00"), fim: as("21:30") }),
    ]);
    expect(c.blocos.map((b) => b.chave.split("@")[0])).toEqual(["virada", "cedo", "noite"]);
    expect(c.blocos[0]).toMatchObject({ inicio: 0, fim: 540, hora: "0h–9h" });
    expect([c.de, c.ate]).toEqual([0, 22]);
  });

  it("o de dia inteiro vai à parte, só no dia que cobre; o sem duração ganha 15 min", () => {
    const c = coluna([
      ocorrencia({ eventoId: "f", titulo: "Feriado", diaInteiro: true, inicio: DIA, fim: "2026-10-09" }),
      ocorrencia({
        eventoId: "v",
        titulo: "Viagem",
        diaInteiro: true,
        inicio: "2026-10-09",
        fim: "2026-10-11",
      }),
      ocorrencia({ eventoId: "z", titulo: "", inicio: as("15:00"), fim: as("15:00") }),
    ]);
    expect(c.diaTodo.map((d) => d.nome)).toEqual(["Feriado"]);
    expect(c.blocos.map((b) => [b.nome, b.hora])).toEqual([["Sem título", "15h–15:15"]]);
  });

  it("a sugestão entra tracejada; os livres viram texto; agora fora do dia não risca", () => {
    const c = coluna([], {
      sugestao: { inicio: as("16:00"), fim: as("17:00"), titulo: "Separar comprovantes" },
      livres: [{ inicio: as("13:00"), fim: as("15:00"), minutos: 120 }],
      agora: new Date(as("10:00", "2026-10-09")),
    });
    expect(c.blocos).toEqual([
      expect.objectContaining({ nome: "Sugestão: Separar comprovantes", hora: "16h–17h", tipo: "sugestao" }),
    ]);
    expect(c.livres).toEqual(["13h–15h"]);
    expect(c.agora).toBeNull();
  });
});

describe("reguaDoDia", () => {
  it("fica dentro do dia e tem pelo menos uma hora", () => {
    expect(reguaDoDia({ inicio: "23:00", fim: "23:30" }, [])).toEqual({ de: 23, ate: 24 });
    expect(reguaDoDia(EXPEDIENTE, [{ inicio: 0, fim: 24 * 60 }])).toEqual({ de: 0, ate: 24 });
  });
});

describe("emColunas", () => {
  it("os que se sobrepõem dividem a largura; quem começa depois do fim volta à primeira", () => {
    const blocos = emColunas([
      { id: "a", inicio: 600, fim: 660 },
      { id: "b", inicio: 630, fim: 720 },
      { id: "c", inicio: 660, fim: 690 },
      { id: "d", inicio: 800, fim: 860 },
    ]);
    expect(blocos.map((b) => [b.id, b.coluna, b.colunas])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ]);
  });
});

describe("fonteDaAgenda", () => {
  const cal = (extra: Partial<Calendario>): Calendario => ({
    id: "local",
    nome: "Local",
    fonte: "local",
    cor: null,
    espelho: false,
    podeEscrever: true,
    ler: true,
    sincronizadoEm: null,
    ...extra,
  });

  it("sem o Google, só o local; com ele, o Google e o Moductus", () => {
    expect(fonteDaAgenda([cal({})])).toEqual({ rotulo: "Local", temGoogle: false });
    expect(fonteDaAgenda([cal({}), cal({ id: "g", fonte: "google" })])).toEqual({
      rotulo: "Google",
      temGoogle: true,
    });
    expect(
      fonteDaAgenda([cal({}), cal({ id: "m", fonte: "google", espelho: true, nome: "Moductus" })]).rotulo,
    ).toBe("Google · Moductus");
  });
});

describe("falas da Alba", () => {
  const encaixe = {
    sugestao: { tarefaId: "t1", inicio: as("16:30"), fim: as("17:00") },
    bloco: { inicio: as("16:00"), fim: as("18:00"), minutos: 120 },
    titulo: "Separar comprovantes",
  };

  it("diz o bloco e o que desenhou nele; depois de guardar, o pedaço guardado", () => {
    expect(falaDaSugestao(encaixe, DIA, FUSO)).toBe(
      "O bloco das 16h está livre. Coloquei “Separar comprovantes” ali como sugestão.",
    );
    expect(falaDoGuardado(encaixe, DIA, FUSO)).toBe("Guardei das 16h30 às 17h para “Separar comprovantes”.");
    expect(horaNaRegua(9 * 60 + 5)).toBe("9:05");
  });
});
