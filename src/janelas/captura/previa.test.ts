import type { CamposCaptura, PreviaCaptura } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  alternativasPara,
  aplicarEdicoes,
  camposDoTipo,
  ERRO_DIA,
  ERRO_HORA,
  ERRO_TITULO,
  formatarCampo,
  formatarDia,
  formatarMinutos,
  formatarRepeticao,
  hojeNoFuso,
  lerAntecedencia,
  lerDia,
  lerDuracao,
  lerHora,
  quemEntendeu,
  type Contexto,
} from "./previa.ts";

// 18/10/2026 é um domingo.
const HOJE = "2026-10-18";
const CONTEXTO: Contexto = { hoje: HOJE, listas: [{ id: "01LISTA", nome: "Casa" }] };

const VAZIOS: CamposCaptura = {
  titulo: "ligar pro banco",
  dia: null,
  hora: null,
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: null,
  listaId: null,
  valorCentavos: null,
};

const previa = (p: Partial<PreviaCaptura>): PreviaCaptura => ({
  texto: "ligar pro banco",
  tipo: "tarefa",
  campos: VAZIOS,
  trechos: [],
  alternativas: ["lembrete", "evento", "nota"],
  aviso: null,
  entendidoPor: "codigo",
  ...p,
});

describe("o texto dos campos", () => {
  it("dia como no PainelTarefas: Hoje, Amanhã, dia da semana curto, ano só quando é outro", () => {
    expect(formatarDia(HOJE, HOJE)).toBe("Hoje");
    expect(formatarDia("2026-10-19", HOJE)).toBe("Amanhã");
    expect(formatarDia("2026-10-23", HOJE)).toBe("sex, 23 out");
    expect(formatarDia("2027-01-05", HOJE)).toBe("ter, 5 jan 2027");
  });

  it("minutos e antecedência", () => {
    expect(formatarMinutos(15)).toBe("15 min");
    expect(formatarMinutos(60)).toBe("1 h");
    expect(formatarMinutos(90)).toBe("1 h 30");
    expect(formatarMinutos(2880)).toBe("2 dias");
    const campos = { ...VAZIOS, lembreteMinutosAntes: 15 };
    expect(formatarCampo("lembreteMinutosAntes", campos, CONTEXTO)).toBe("15 min antes");
    expect(formatarCampo("lembreteMinutosAntes", { ...campos, lembreteMinutosAntes: 0 }, CONTEXTO)).toBe(
      "na hora",
    );
  });

  it("lista pelo nome, Entrada sem lista; valor do gasto em reais", () => {
    expect(formatarCampo("listaId", VAZIOS, CONTEXTO)).toBe("Entrada");
    expect(formatarCampo("listaId", { ...VAZIOS, listaId: "01LISTA" }, CONTEXTO)).toBe("Casa");
    expect(formatarCampo("valorCentavos", { ...VAZIOS, valorCentavos: 4500 }, CONTEXTO)).toMatch(
      /^R\$\s45,00$/,
    );
  });

  it("repetição em poucas palavras; o que foge vira 'repete'", () => {
    expect(formatarRepeticao("FREQ=DAILY")).toBe("todo dia");
    expect(formatarRepeticao("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("toda seg, qua");
    expect(formatarRepeticao("FREQ=WEEKLY;INTERVAL=2")).toBe("a cada 2 semanas");
    expect(formatarRepeticao("FREQ=MONTHLY;BYMONTHDAY=5")).toBe("todo dia 5");
    expect(formatarRepeticao("FREQ=YEARLY")).toBe("todo ano");
    expect(formatarRepeticao("FREQ=HOURLY")).toBe("repete");
  });

  it("hoje no fuso da configuração, não no do Windows", () => {
    const quase = new Date("2026-10-19T01:30:00Z");
    expect(hojeNoFuso(quase, "America/Sao_Paulo")).toBe("2026-10-18");
    expect(hojeNoFuso(quase, "Asia/Tokyo")).toBe("2026-10-19");
  });
});

describe("os campos de cada tipo", () => {
  it("o lembrete mostra dia e hora mesmo vazios, para o Tab preencher", () => {
    expect(camposDoTipo("lembrete", VAZIOS).map((c) => c.campo)).toEqual(["titulo", "dia", "hora"]);
  });

  it("a tarefa mostra lista sempre e o resto só quando a frase disse", () => {
    expect(camposDoTipo("tarefa", VAZIOS).map((c) => c.campo)).toEqual(["titulo", "dia", "hora", "listaId"]);
    const comMais = { ...VAZIOS, recorrencia: "FREQ=DAILY", lembreteMinutosAntes: 15 };
    expect(camposDoTipo("tarefa", comMais).map((c) => c.campo)).toEqual([
      "titulo",
      "dia",
      "hora",
      "listaId",
      "lembreteMinutosAntes",
      "recorrencia",
    ]);
  });

  it("repetição só aparece; gasto e memória não se editam", () => {
    const comRegra = camposDoTipo("tarefa", { ...VAZIOS, recorrencia: "FREQ=DAILY" });
    expect(comRegra.find((c) => c.campo === "recorrencia")?.editavel).toBe(false);
    expect(comRegra.find((c) => c.campo === "hora")?.editavel).toBe(true);
    expect(camposDoTipo("gasto", VAZIOS).every((c) => !c.editavel)).toBe(true);
    expect(camposDoTipo("nota", VAZIOS).map((c) => c.campo)).toEqual(["titulo"]);
  });
});

describe("ler o que a pessoa digitou", () => {
  it("dia: hoje, amanhã, dd/mm, dd/mm/aaaa e o próprio texto da tela", () => {
    expect(lerDia("", HOJE)).toEqual({ ok: true, valor: null });
    expect(lerDia("hoje", HOJE)).toEqual({ ok: true, valor: HOJE });
    expect(lerDia("Amanhã", HOJE)).toEqual({ ok: true, valor: "2026-10-19" });
    expect(lerDia("23/10", HOJE)).toEqual({ ok: true, valor: "2026-10-23" });
    expect(lerDia("1/2/2027", HOJE)).toEqual({ ok: true, valor: "2027-02-01" });
    expect(lerDia("sex, 23 out", HOJE)).toEqual({ ok: true, valor: "2026-10-23" });
    expect(lerDia("5 jan 2027", HOJE)).toEqual({ ok: true, valor: "2027-01-05" });
  });

  it("dia sem ano que já passou é o do ano que vem", () => {
    expect(lerDia("05/01", HOJE)).toEqual({ ok: true, valor: "2027-01-05" });
    expect(lerDia("18/10", HOJE)).toEqual({ ok: true, valor: HOJE });
  });

  it("dia que não existe ou não se lê volta erro", () => {
    expect(lerDia("31/02", HOJE)).toEqual({ ok: false, erro: ERRO_DIA });
    expect(lerDia("29/02/2027", HOJE)).toEqual({ ok: false, erro: ERRO_DIA });
    expect(lerDia("semana que vem", HOJE)).toEqual({ ok: false, erro: ERRO_DIA });
    expect(lerDia("3 xyz", HOJE)).toEqual({ ok: false, erro: ERRO_DIA });
  });

  it("hora: 15, 15h, 15:00, 15h30, 9:05; fora do relógio é erro", () => {
    expect(lerHora("15")).toEqual({ ok: true, valor: "15:00" });
    expect(lerHora("15h")).toEqual({ ok: true, valor: "15:00" });
    expect(lerHora("15h30")).toEqual({ ok: true, valor: "15:30" });
    expect(lerHora("9:05")).toEqual({ ok: true, valor: "09:05" });
    expect(lerHora("")).toEqual({ ok: true, valor: null });
    expect(lerHora("24:00")).toEqual({ ok: false, erro: ERRO_HORA });
    expect(lerHora("15:60")).toEqual({ ok: false, erro: ERRO_HORA });
    expect(lerHora("tarde")).toEqual({ ok: false, erro: ERRO_HORA });
  });

  it("duração e antecedência em minutos, horas ou dias", () => {
    expect(lerDuracao("30")).toEqual({ ok: true, valor: 30 });
    expect(lerDuracao("1 h 30")).toEqual({ ok: true, valor: 90 });
    expect(lerDuracao("2h")).toEqual({ ok: true, valor: 120 });
    expect(lerDuracao("0").ok).toBe(false);
    expect(lerDuracao("2 dias").ok).toBe(false);
    expect(lerAntecedencia("15 min antes")).toEqual({ ok: true, valor: 15 });
    expect(lerAntecedencia("na hora")).toEqual({ ok: true, valor: 0 });
    expect(lerAntecedencia("1 dia")).toEqual({ ok: true, valor: 1440 });
    expect(lerAntecedencia("29 dias").ok).toBe(false);
  });

  it("a correção vai por cima da prévia; o campo com erro fica como veio e diz por quê", () => {
    const campos = { ...VAZIOS, dia: "2026-10-19", hora: "15:00" };
    const { campos: final, erros } = aplicarEdicoes(
      campos,
      { hora: "16h", dia: "31/02", titulo: "  ligar pro banco hoje  ", listaId: "01LISTA" },
      CONTEXTO,
    );
    expect(final).toEqual({ ...campos, hora: "16:00", titulo: "ligar pro banco hoje", listaId: "01LISTA" });
    expect(erros).toEqual({ dia: ERRO_DIA });
    expect(aplicarEdicoes(campos, { titulo: "   " }, CONTEXTO).erros).toEqual({ titulo: ERRO_TITULO });
    expect(aplicarEdicoes(campos, { listaId: "" }, CONTEXTO).campos.listaId).toBeNull();
  });
});

describe("quem entendeu e o Na verdade é", () => {
  it("a área que recebe, a Alba quando foi o modelo, e 'Vai como' depois da troca", () => {
    expect(quemEntendeu(previa({ tipo: "gasto" }), "gasto")).toBe("Finanças entendeu como");
    expect(quemEntendeu(previa({}), "tarefa")).toBe("Tarefas entendeu como");
    expect(quemEntendeu(previa({ tipo: "evento" }), "evento")).toBe("Agenda entendeu como");
    expect(quemEntendeu(previa({ entendidoPor: "modelo" }), "tarefa")).toBe("Alba entendeu como");
    expect(quemEntendeu(previa({}), "nota")).toBe("Vai como");
  });

  it("trocar devolve o tipo entendido ao lugar do escolhido, sem inventar o que o serviço tirou", () => {
    expect(alternativasPara(previa({}), "tarefa")).toEqual(["lembrete", "evento", "nota"]);
    expect(alternativasPara(previa({}), "evento")).toEqual(["tarefa", "lembrete", "nota"]);
    // Gasto não se lança: escolhida a tarefa, sobra a nota.
    expect(alternativasPara(previa({ tipo: "gasto", alternativas: ["tarefa", "nota"] }), "tarefa")).toEqual([
      "nota",
    ]);
    // O lembrete que viraria tarefa ficou fora das alternativas e continua fora.
    expect(alternativasPara(previa({ alternativas: ["evento", "nota"] }), "nota")).toEqual([
      "tarefa",
      "evento",
    ]);
  });
});
