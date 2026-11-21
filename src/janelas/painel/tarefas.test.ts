import type { Lista, PreviaCaptura, Tarefa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import { tarefa } from "../../teste/dia.ts";
import {
  chipsDaPrevia,
  feitasDoDia,
  lembreteDaTarefa,
  linhasDoHoje,
  notaDaTarefa,
  ordemDoDia,
  prioridadeDa,
  quandoDaTarefa,
  textoDaRecorrencia,
} from "./tarefas.ts";

const INSTANTE = "2026-10-08T12:00:00.000Z";

const feita = (id: string, extra: Partial<Tarefa> = {}) =>
  tarefa(id, { estado: "feita", concluidaEm: INSTANTE, ...extra });

const LISTAS: Lista[] = [
  { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false },
  { id: "pessoal", nome: "Pessoal", ordem: 1, cor: null, arquivada: false },
];

describe("a ordem e o recorte do dia", () => {
  it("as com hora primeiro, pela hora; as sem hora depois, na ordem do serviço; a feita no lugar", () => {
    const lista = [
      tarefa("racao"),
      tarefa("contador", { hora: "15:00" }),
      feita("daily", { hora: "09:30" }),
      tarefa("pr", { hora: "10:00" }),
      feita("plantas"),
    ];
    expect(ordemDoDia(lista).map((t) => t.id)).toEqual(["daily", "pr", "contador", "racao", "plantas"]);
  });

  it("no Hoje, as atrasadas vêm antes e, sobrando linha, saem primeiro as feitas mais cedo", () => {
    const atrasadas = [tarefa("aluguel", { venceEm: "2026-10-06" })];
    const hoje = [
      feita("daily", { hora: "09:30" }),
      feita("pr", { hora: "10:00" }),
      tarefa("contador", { hora: "15:00" }),
      tarefa("comprovantes", { hora: "16:00" }),
      tarefa("filha", { tarefaPaiId: "contador" }),
    ];
    const { linhas, fora } = linhasDoHoje(atrasadas, hoje, 4);
    expect(linhas.map((t) => t.id)).toEqual(["aluguel", "pr", "contador", "comprovantes"]);
    expect(fora).toBe(1);
    expect(linhasDoHoje([], hoje.slice(0, 2), 4)).toEqual({ linhas: hoje.slice(0, 2), fora: 0 });
  });

  it("conta as feitas do dia sem as canceladas", () => {
    expect(feitasDoDia([feita("a"), tarefa("b"), tarefa("c", { estado: "cancelada" })])).toEqual({
      feitas: 1,
      total: 2,
    });
  });

  it("a prioridade alta e a média ganham a barrinha, com o texto para o leitor de tela", () => {
    expect(prioridadeDa(tarefa("a", { prioridade: 3 }))).toEqual({ tom: "perigo", texto: "prioridade alta" });
    expect(prioridadeDa(tarefa("a", { prioridade: 2 }))).toEqual({ tom: "aviso", texto: "prioridade média" });
    expect(prioridadeDa(tarefa("a", { prioridade: 1 }))).toBeNull();
  });
});

describe("o que cada linha escreve", () => {
  it("a repetição simples por extenso; a que a frase curta não diz, só 'repete'", () => {
    expect(textoDaRecorrencia("FREQ=MONTHLY")).toBe("repete todo mês");
    expect(textoDaRecorrencia("RRULE:FREQ=DAILY;COUNT=5")).toBe("repete todo dia");
    expect(textoDaRecorrencia("FREQ=WEEKLY;BYDAY=TH")).toBe("repete toda semana");
    expect(textoDaRecorrencia("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("repete em dias úteis");
    expect(textoDaRecorrencia("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("repete");
    expect(textoDaRecorrencia("FREQ=DAILY;INTERVAL=2")).toBe("repete");
    expect(textoDaRecorrencia("FREQ=YEARLY;INTERVAL=1")).toBe("repete todo ano");
  });

  it("a hora do lembrete da tarefa, ou o dia anterior quando passa da meia-noite", () => {
    expect(lembreteDaTarefa("15:00", 15)).toBe("lembrete 14:45");
    expect(lembreteDaTarefa("00:10", 15)).toBe("lembrete no dia anterior");
  });

  it("a linha de baixo: a lista (menos a Entrada), o lembrete e a repetição", () => {
    const contador = tarefa("c", { listaId: "pessoal", hora: "15:00", lembreteMinutosAntes: 15 });
    expect(notaDaTarefa(contador, LISTAS)).toBe("Pessoal · lembrete 14:45");
    expect(notaDaTarefa(tarefa("e", { recorrencia: "FREQ=MONTHLY" }), LISTAS)).toBe("repete todo mês");
    expect(notaDaTarefa(tarefa("e"), LISTAS)).toBeNull();
    // Sem as listas ainda, a linha não inventa nome.
    expect(notaDaTarefa(tarefa("p", { listaId: "pessoal" }), null)).toBeNull();
  });

  it("a coluna da direita: o dia da atrasada e a hora que passou ficam em aviso; a feita não", () => {
    const hoje = "2026-10-08";
    const agora = 16 * 60 + 10;
    expect(quandoDaTarefa(tarefa("a", { venceEm: "2026-10-07" }), hoje, agora)).toEqual({
      texto: "ontem",
      aviso: true,
    });
    expect(quandoDaTarefa(tarefa("b", { hora: "15:00" }), hoje, agora)).toEqual({
      texto: "15:00",
      aviso: true,
    });
    expect(quandoDaTarefa(tarefa("c", { hora: "17:00" }), hoje, agora)).toEqual({
      texto: "17:00",
      aviso: false,
    });
    expect(quandoDaTarefa(feita("d", { hora: "09:30" }), hoje, agora)).toEqual({
      texto: "09:30",
      aviso: false,
    });
    expect(quandoDaTarefa(tarefa("e"), hoje, agora)).toEqual({ texto: "", aviso: false });
  });
});

describe("a prévia da frase", () => {
  const previa = (
    extra: Partial<Omit<PreviaCaptura, "campos">> & { campos?: Partial<PreviaCaptura["campos"]> },
  ): PreviaCaptura => ({
    texto: "ligar pro banco amanhã 15h",
    tipo: "tarefa",
    trechos: [],
    alternativas: ["lembrete", "evento", "nota"],
    aviso: null,
    entendidoPor: "codigo",
    ...extra,
    campos: {
      titulo: "Ligar pro banco",
      dia: null,
      hora: null,
      duracaoMin: null,
      recorrencia: null,
      lembreteMinutosAntes: null,
      listaId: null,
      valorCentavos: null,
      ...extra.campos,
    },
  });

  it("os chips na ordem do quadro: tipo, dia, hora e lembrete", () => {
    expect(
      chipsDaPrevia(previa({ campos: { dia: "2026-10-09", hora: "15:00", lembreteMinutosAntes: 15 } })),
    ).toEqual(["tarefa", "sex, 9 out", "15:00", "lembrete 14:45"]);
  });

  it("o que a frase não disse não aparece; o lembrete não repete a própria hora", () => {
    expect(chipsDaPrevia(previa({}))).toEqual(["tarefa"]);
    expect(
      chipsDaPrevia(previa({ tipo: "lembrete", campos: { hora: "15:00", lembreteMinutosAntes: 0 } })),
    ).toEqual(["lembrete", "15:00"]);
    expect(chipsDaPrevia(previa({ tipo: "gasto", campos: { valorCentavos: 4500 } }))).toEqual([
      "gasto",
      "R$ 45,00",
    ]);
  });
});
