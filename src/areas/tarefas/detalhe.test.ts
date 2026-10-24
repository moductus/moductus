import type { Calendario, EventoAgenda } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  alternarDiaInteiro,
  avisosDoCelular,
  espelhoLigado,
  horaAntes,
  maisNova,
  momentoCurto,
  moverInicio,
  notaDoCalendario,
  opcoesDuracao,
  opcoesLembrete,
  opcoesRepeticao,
  origemDoItem,
  pedidoParaAlba,
  quandoNaTela,
  quandoParaGravar,
  quandoPorExtenso,
  valorDaRepeticao,
} from "./detalhe.ts";
import { tarefa } from "./exemplos.ts";

const FUSO = "America/Sao_Paulo";
/** 11:00 de quinta, 8 de outubro, em São Paulo. */
const AGORA = new Date("2026-10-08T14:00:00.000Z");
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

const carimbo = (extra: object) => ({
  origem: "usuario" as const,
  agenteId: null,
  criadoEm: sp("2026-10-07", "18:12"),
  atualizadoEm: sp("2026-10-07", "18:12"),
  ...extra,
});

describe("a origem", () => {
  it("diz quem criou enquanto ninguém mudou, e quem mudou por último depois", () => {
    expect(origemDoItem(carimbo({ origem: "agente", agenteId: "alba" }), "a", FUSO, AGORA)).toEqual({
      agente: "alba",
      quem: "Criada pela Alba",
      quando: "ontem, 18:12",
    });
    expect(origemDoItem(carimbo({ origem: "agente", agenteId: "nuno" }), "o", FUSO, AGORA).quem).toBe(
      "Criado pelo Nuno",
    );
    const mudada = carimbo({ atualizadoEm: sp("2026-10-08", "09:05") });
    expect(origemDoItem(mudada, "a", FUSO, AGORA)).toEqual({
      agente: null,
      quem: "Mudada por você",
      quando: "hoje, 09:05",
    });
    expect(origemDoItem(carimbo({ origem: "conexao" }), "o", FUSO, AGORA).quem).toBe("Criado no Google");
    expect(origemDoItem(carimbo({ origem: "agente", agenteId: "saiu" }), "a", FUSO, AGORA)).toMatchObject({
      agente: null,
      quem: "Criada por um agente",
    });
  });

  it("o momento é do fuso do usuário: hoje, ontem, ou o dia curto", () => {
    expect(momentoCurto(sp("2026-10-02", "20:05"), FUSO, AGORA)).toBe("sex, 2 out, 20:05");
    // 01:30 UTC do dia 8 ainda é dia 7 em São Paulo.
    expect(momentoCurto("2026-10-08T01:30:00.000Z", FUSO, AGORA)).toBe("ontem, 22:30");
  });
});

describe("as opções dos campos", () => {
  it("o lembrete mostra a hora em que toca, quando cai no mesmo dia", () => {
    expect(horaAntes("10:00", 15)).toBe("09:45");
    expect(horaAntes("00:10", 15)).toBeNull();
    const opcoes = opcoesLembrete(15, "10:00");
    expect(opcoes[0]).toEqual({ valor: "", rotulo: "Sem lembrete" });
    expect(opcoes.find((o) => o.valor === "15")?.rotulo).toBe("15 min antes · 09:45");
    expect(opcoes.find((o) => o.valor === "0")?.rotulo).toBe("Na hora · 10:00");
    expect(opcoes.find((o) => o.valor === "1440")?.rotulo).toBe("1 dia antes");
    // A antecedência que veio de outro lugar entra na lista, na ordem.
    expect(opcoesLembrete(45, null).map((o) => o.valor)).toContain("45");
  });

  it("a duração e a repetição trazem o valor atual mesmo fora das prontas", () => {
    expect(opcoesDuracao(50).find((o) => o.valor === "50")?.rotulo).toBe("50 min");
    expect(opcoesDuracao(75).map((o) => o.valor)).toEqual([
      "",
      "15",
      "25",
      "30",
      "45",
      "50",
      "60",
      "75",
      "90",
      "120",
      "180",
      "240",
    ]);
    expect(valorDaRepeticao("RRULE:freq=daily")).toBe("FREQ=DAILY");
    expect(valorDaRepeticao(null)).toBe("");
    expect(opcoesRepeticao("FREQ=WEEKLY;BYDAY=TU,TH").at(-1)).toEqual({
      valor: "FREQ=WEEKLY;BYDAY=TU,TH",
      rotulo: "Toda ter, qui",
    });
    expect(opcoesRepeticao("FREQ=MONTHLY;BYDAY=2TU").at(-1)?.rotulo).toBe("Regra própria");
  });

  it("o celular avisa do jeito que o quadro escreve", () => {
    expect(avisosDoCelular([30, 1440])).toBe("o celular avisa 1 dia e 30 min antes");
    expect(avisosDoCelular([0, 10])).toBe("o celular avisa 10 min antes e na hora");
    expect(avisosDoCelular([0])).toBe("o celular avisa na hora");
    expect(avisosDoCelular([])).toBe("sem aviso no celular");
  });
});

describe("o quando do evento", () => {
  const comHora = { inicio: sp("2026-10-09", "14:00"), fim: sp("2026-10-09", "15:00"), diaInteiro: false };

  it("vai e volta entre a tela e o contrato, no fuso", () => {
    const q = quandoNaTela(comHora, FUSO);
    expect(q).toEqual({
      diaInteiro: false,
      inicioDia: "2026-10-09",
      inicioHora: "14:00",
      fimDia: "2026-10-09",
      fimHora: "15:00",
    });
    expect(quandoParaGravar(q, FUSO)).toEqual(comHora);
    expect(quandoParaGravar({ ...q, fimHora: "13:00" }, FUSO)).toBeNull();
  });

  it("no dia inteiro, a tela mostra o último dia e o contrato leva o dia seguinte", () => {
    const feriado = { inicio: "2026-10-12", fim: "2026-10-13", diaInteiro: true };
    const q = quandoNaTela(feriado, FUSO);
    expect(q).toMatchObject({ inicioDia: "2026-10-12", fimDia: "2026-10-12" });
    expect(quandoParaGravar({ ...q, fimDia: "2026-10-14" }, FUSO)).toEqual({
      inicio: "2026-10-12",
      fim: "2026-10-15",
      diaInteiro: true,
    });
  });

  it("mudar o começo leva o fim junto, com a mesma duração", () => {
    const q = quandoNaTela(comHora, FUSO);
    expect(moverInicio(q, "2026-10-09", "23:30", FUSO)).toMatchObject({
      inicioHora: "23:30",
      fimDia: "2026-10-10",
      fimHora: "00:30",
    });
    const dias = quandoNaTela({ inicio: "2026-10-12", fim: "2026-10-14", diaInteiro: true }, FUSO);
    expect(moverInicio(dias, "2026-10-20", "", FUSO)).toMatchObject({
      inicioDia: "2026-10-20",
      fimDia: "2026-10-21",
    });
  });

  it("o dia inteiro liga com os dias e desliga numa hora no começo do expediente", () => {
    const q = quandoNaTela(
      { inicio: sp("2026-10-09", "23:00"), fim: sp("2026-10-10", "00:00"), diaInteiro: false },
      FUSO,
    );
    const ligado = alternarDiaInteiro(q, "09:00");
    expect(ligado).toMatchObject({ diaInteiro: true, inicioDia: "2026-10-09", fimDia: "2026-10-09" });
    expect(alternarDiaInteiro(ligado, "09:00")).toEqual({
      diaInteiro: false,
      inicioDia: "2026-10-09",
      inicioHora: "09:00",
      fimDia: "2026-10-09",
      fimHora: "10:00",
    });
    expect(alternarDiaInteiro(ligado, "23:30")).toMatchObject({ fimDia: "2026-10-10", fimHora: "00:30" });
  });

  it("por extenso no só leitura", () => {
    expect(quandoPorExtenso(comHora, FUSO)).toBe("sexta, 9 de outubro, 14:00–15:00");
    expect(quandoPorExtenso({ inicio: "2026-10-12", fim: "2026-10-13", diaInteiro: true }, FUSO)).toBe(
      "segunda, 12 de outubro, o dia todo",
    );
  });
});

describe("calendários e pedido à Alba", () => {
  const calendario = (extra: Partial<Calendario>): Calendario => ({
    id: "m",
    nome: "Moductus",
    fonte: "google",
    cor: null,
    espelho: true,
    podeEscrever: true,
    ler: true,
    sincronizadoEm: null,
    ...extra,
  });

  it("o Moductus só conta com o Google de pé", () => {
    const conexao = {
      tipo: "google-agenda" as const,
      estado: "ligada" as const,
      conta: "voce@exemplo.com",
      ultimoErro: null,
      conectadaEm: "2026-10-01T12:00:00.000Z",
    };
    expect(espelhoLigado([calendario({})], conexao)?.id).toBe("m");
    expect(espelhoLigado([calendario({})], { ...conexao, estado: "desligada" })).toBeNull();
    expect(espelhoLigado([calendario({ espelho: false })], conexao)).toBeNull();
  });

  it("a nota de cada calendário vem da fonte dele", () => {
    expect(notaDoCalendario(calendario({ id: "local", nome: "Local", fonte: "local", espelho: false }))).toBe(
      "fica só aqui, sem aviso no celular",
    );
    expect(notaDoCalendario(calendario({}))).toBe("Google · vai para o celular, sem pedir");
    expect(notaDoCalendario(calendario({ nome: "Trabalho", espelho: false }))).toBe(
      "Google · mudar para cá é pedido à Alba",
    );
    expect(notaDoCalendario(calendario({ nome: "Empresa", fonte: "outlook", espelho: false }))).toBe(
      "Outlook · mudar para cá é pedido à Alba",
    );
  });

  it("o pedido diz qual evento, de qual calendário e quando", () => {
    const evento = {
      id: "p",
      calendarioId: "g1",
      titulo: "Planejamento",
      inicio: sp("2026-10-08", "11:00"),
      fim: sp("2026-10-08", "12:00"),
      diaInteiro: false,
    } as EventoAgenda;
    expect(
      pedidoParaAlba(evento, calendario({ nome: "Trabalho", espelho: false }), FUSO, " passar para as 14h "),
    ).toBe(
      "Quero mudar o evento “Planejamento” (Trabalho · Google, quinta, 8 de outubro, 11:00–12:00): passar para as 14h",
    );
  });
});

describe("a tarefa aberta", () => {
  it("fica com o retrato mais novo, o da lista ou o que chegou; no empate, o que chegou depois", () => {
    const velha = tarefa({ id: "x", atualizadoEm: "2026-10-08T10:00:00.000Z" });
    const nova = { ...velha, titulo: "nova", atualizadoEm: "2026-10-08T11:00:00.000Z" };
    expect(maisNova(velha, nova)).toBe(nova);
    expect(maisNova(nova, velha)).toBe(nova);
    expect(maisNova(null, velha)).toBe(velha);
    const mesmoInstante = { ...nova, hora: "11:30" };
    expect(maisNova(nova, mesmoInstante)).toBe(mesmoInstante);
  });
});
