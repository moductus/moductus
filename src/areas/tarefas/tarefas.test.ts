import type { Lista, PreviaCaptura, Tarefa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  descreverAntecedencia,
  descreverDuracao,
  descreverRecorrencia,
  diaCurto,
  diaNoFuso,
  diaPorExtenso,
  veioDe,
} from "./dias.ts";
import {
  gruposDasAbertas,
  gruposDoHoje,
  gruposDosLembretes,
  gruposDosProximos,
  lancamentoDaPrevia,
  moverNoGrupo,
  pedacosDoEntendi,
  progressoDoHoje,
  soltarNoGrupo,
} from "./tarefas.ts";
import { HOJE, lembrete, tarefa } from "./exemplos.ts";

const LISTAS: Lista[] = [
  { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false },
  { id: "pessoal", nome: "Pessoal", ordem: 2, cor: null, arquivada: false },
];

const nomes = (grupos: { nome: string; linhas: { tarefa: Tarefa }[] }[]) =>
  grupos.map((g) => [g.nome, g.linhas.map((l) => l.tarefa.titulo)]);

describe("dias no fuso", () => {
  it("o dia de hoje é o do fuso, não o UTC", () => {
    // 01:30 UTC do dia 9 ainda é dia 8 em São Paulo.
    expect(diaNoFuso(new Date("2026-10-09T01:30:00.000Z"), "America/Sao_Paulo")).toBe(HOJE);
    expect(diaNoFuso(new Date("2026-10-09T01:30:00.000Z"), "UTC")).toBe("2026-10-09");
  });

  it("escreve o dia como as linhas e o Entendi", () => {
    expect(diaPorExtenso("2026-10-09")).toBe("sexta, 9 out");
    expect(diaCurto("2026-10-06", HOJE)).toBe("ter");
    expect(diaCurto("2026-10-20", HOJE)).toBe("20 out");
    expect(veioDe("2026-10-07", HOJE)).toBe("veio de ontem");
    expect(veioDe("2026-10-06", HOJE)).toBe("veio de terça");
    expect(veioDe("2026-09-30", HOJE)).toBe("veio de 30 set");
  });

  it("repetição, duração e antecedência em texto curto", () => {
    expect(descreverRecorrencia("FREQ=MONTHLY")).toBe("repete todo mês");
    expect(descreverRecorrencia("RRULE:FREQ=WEEKLY;BYDAY=MO")).toBe("repete toda segunda");
    expect(descreverRecorrencia("FREQ=WEEKLY;BYDAY=SA")).toBe("repete todo sábado");
    expect(descreverRecorrencia("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("repete seg, qua e sex");
    expect(descreverRecorrencia("FREQ=WEEKLY;INTERVAL=2")).toBe("repete a cada 2 semanas");
    expect(descreverRecorrencia("FREQ=MONTHLY;BYDAY=2TU")).toBe("repete todo mês");
    expect(descreverRecorrencia("FREQ=SECONDLY")).toBe("repete");
    expect(descreverDuracao(30)).toBe("30 min");
    expect(descreverDuracao(90)).toBe("1 h 30");
    expect(descreverAntecedencia(15)).toBe("15 min antes");
    expect(descreverAntecedencia(0)).toBe("na hora");
    expect(descreverAntecedencia(1440)).toBe("1 dia antes");
  });
});

describe("Hoje", () => {
  it("atrasadas no alto com o dia em que venciam, depois manhã, tarde, noite e sem hora", () => {
    const atrasada = tarefa({ titulo: "Enviar documentos", venceEm: "2026-10-07", prioridade: 2 });
    const grupos = gruposDoHoje(
      [
        tarefa({ titulo: "Ligar para o contador", hora: "15:00" }),
        tarefa({ titulo: "Daily", hora: "09:30", estado: "feita", concluidaEm: "2026-10-08T12:40:00.000Z" }),
        tarefa({ titulo: "Regar as plantas" }),
        tarefa({ titulo: "Jantar", hora: "19:00" }),
        tarefa({ titulo: "Revisar PR", hora: "10:00" }),
      ],
      [atrasada],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([
      ["Atrasada", ["Enviar documentos"]],
      ["Manhã", ["Daily", "Revisar PR"]],
      ["Tarde", ["Ligar para o contador"]],
      ["Noite", ["Jantar"]],
      ["Sem hora", ["Regar as plantas"]],
    ]);
    expect(grupos[0]!.atrasado).toBe(true);
    expect(grupos[0]!.linhas[0]).toMatchObject({ nota: "veio de ontem", quando: "qua" });
    expect(grupos[1]!.linhas.map((l) => l.quando)).toEqual(["09:30", "10:00"]);
    expect(progressoDoHoje(grupos)).toBe("1 de 6 feitas");
  });

  it("a subtarefa entra no 1 de 3 da mãe, e a recorrente diz que repete", () => {
    const mae = tarefa({ titulo: "Revisar PR", recorrencia: "FREQ=MONTHLY" });
    const grupos = gruposDoHoje(
      [
        mae,
        tarefa({ tarefaPaiId: mae.id, estado: "feita", concluidaEm: "2026-10-08T12:00:00.000Z" }),
        tarefa({ tarefaPaiId: mae.id }),
        tarefa({ tarefaPaiId: mae.id }),
        tarefa({ tarefaPaiId: mae.id, estado: "cancelada" }),
      ],
      [],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([["Sem hora", ["Revisar PR"]]]);
    expect(grupos[0]!.linhas[0]!.nota).toBe("subtarefas 1 de 3 · repete todo mês");
  });

  it("a subtarefa que veio sozinha, pelo próprio dia, vira linha", () => {
    const grupos = gruposDoHoje([tarefa({ titulo: "Filha", tarefaPaiId: "outra" })], [], HOJE);
    expect(nomes(grupos)).toEqual([["Sem hora", ["Filha"]]]);
  });
});

describe("Próximos 7 dias e Todas", () => {
  it("um grupo por dia até hoje + 7, com Amanhã e o dia por extenso", () => {
    const grupos = gruposDosProximos(
      [
        tarefa({ titulo: "Pagar fatura", venceEm: "2026-10-10" }),
        tarefa({ titulo: "Mercado", venceEm: "2026-10-09", hora: "18:00" }),
        tarefa({ titulo: "Viagem", venceEm: "2026-10-16" }),
        tarefa({ titulo: "No limite", venceEm: "2026-10-15" }),
      ],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([
      ["Amanhã", ["Mercado"]],
      ["Sábado, 10 de outubro", ["Pagar fatura"]],
      ["Quinta, 15 de outubro", ["No limite"]],
    ]);
    expect(grupos[0]!.linhas[0]!.quando).toBe("18:00");
  });

  it("Todas separa atrasadas, hoje, próximas e sem data, com o dia curto", () => {
    const grupos = gruposDasAbertas(
      [
        tarefa({ titulo: "Antiga", venceEm: "2026-10-01" }),
        tarefa({ titulo: "Agora", hora: "11:00" }),
        tarefa({ titulo: "Sábado", venceEm: "2026-10-10" }),
        tarefa({ titulo: "Algum dia", venceEm: null }),
      ],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([
      ["Atrasadas", ["Antiga"]],
      ["Hoje", ["Agora"]],
      ["Próximas", ["Sábado"]],
      ["Sem data", ["Algum dia"]],
    ]);
    expect(grupos.map((g) => g.linhas[0]!.quando)).toEqual(["1 out", "11:00", "sáb", ""]);
    expect(grupos[0]!.linhas[0]!.nota).toBe("veio de 1 out");
  });
});

describe("ordenar", () => {
  const [a, b, c] = [
    tarefa({ titulo: "A" }),
    tarefa({ titulo: "B" }),
    tarefa({ titulo: "C", hora: "10:00" }),
  ];
  const linhas = gruposDasAbertas([c!, a!, b!], HOJE)[0]!.linhas;

  it("troca com a vizinha do mesmo dia e hora", () => {
    expect(linhas.map((l) => l.tarefa.titulo)).toEqual(["C", "A", "B"]);
    expect(moverNoGrupo(linhas, b!.id, -1)).toEqual([c!.id, b!.id, a!.id]);
    expect(soltarNoGrupo(linhas, b!.id, a!.id)).toEqual([c!.id, b!.id, a!.id]);
  });

  it("não passa por cima do relógio nem da ponta", () => {
    expect(moverNoGrupo(linhas, a!.id, -1)).toBeNull();
    expect(moverNoGrupo(linhas, c!.id, -1)).toBeNull();
    expect(moverNoGrupo(linhas, b!.id, 1)).toBeNull();
    expect(soltarNoGrupo(linhas, a!.id, c!.id)).toBeNull();
  });
});

describe("Entendi", () => {
  const previa = (extra: Partial<PreviaCaptura> = {}, campos: Partial<PreviaCaptura["campos"]> = {}) =>
    ({
      texto: "ligar pro banco amanhã 15h",
      tipo: "tarefa",
      campos: {
        titulo: "ligar pro banco",
        dia: "2026-10-09",
        hora: "15:00",
        duracaoMin: null,
        recorrencia: null,
        lembreteMinutosAntes: null,
        listaId: "pessoal",
        valorCentavos: null,
        ...campos,
      },
      trechos: [],
      alternativas: ["lembrete", "evento", "nota"],
      aviso: null,
      entendidoPor: "codigo",
      ...extra,
    }) satisfies PreviaCaptura;

  it("mostra o que o quadro mostra, com o lembrete padrão da tarefa com hora", () => {
    const lancamento = lancamentoDaPrevia(previa(), { listaId: null, dia: null });
    expect(pedacosDoEntendi(lancamento, LISTAS)).toEqual([
      "tarefa",
      "sexta, 9 out",
      "15:00",
      "lembrete 15 min antes",
      "Pessoal",
    ]);
  });

  it("a frase sem dia, no Hoje, é para hoje; sem lista, numa lista, é dela", () => {
    const semNada = previa({}, { dia: null, hora: null, listaId: null });
    expect(lancamentoDaPrevia(semNada, { listaId: null, dia: HOJE }).campos).toMatchObject({
      dia: HOJE,
      listaId: null,
    });
    const naLista = lancamentoDaPrevia(semNada, { listaId: "pessoal", dia: null });
    expect(naLista.campos).toMatchObject({ dia: null, listaId: "pessoal" });
    expect(pedacosDoEntendi(naLista, LISTAS)).toEqual(["tarefa", "Pessoal"]);
    expect(pedacosDoEntendi(lancamentoDaPrevia(semNada, { listaId: null, dia: null }), LISTAS)).toEqual([
      "tarefa",
      "Entrada",
    ]);
  });

  it("o que a frase disse vale mais que a vista; nota e lembrete não ganham lista", () => {
    const comDia = lancamentoDaPrevia(previa(), { listaId: "entrada", dia: HOJE });
    expect(comDia.campos).toMatchObject({ dia: "2026-10-09", listaId: "pessoal" });
    const nota = lancamentoDaPrevia(previa({ tipo: "nota" }, { dia: null, hora: null }), {
      listaId: "pessoal",
      dia: HOJE,
    });
    expect(nota.campos.dia).toBeNull();
    expect(pedacosDoEntendi(nota, LISTAS)).toEqual(["nota"]);
    const lembrete = lancamentoDaPrevia(previa({ tipo: "lembrete" }, { listaId: null }), {
      listaId: "pessoal",
      dia: null,
    });
    expect(pedacosDoEntendi(lembrete, LISTAS)).toEqual(["lembrete", "sexta, 9 out", "15:00"]);
  });

  it("gasto e memória ainda não chegaram: viram tarefa", () => {
    const gasto = lancamentoDaPrevia(previa({ tipo: "gasto" }), { listaId: null, dia: null });
    expect(gasto.tipo).toBe("tarefa");
  });
});

describe("Lembretes", () => {
  it("os que tocaram sem você ver no alto, depois hoje e os próximos, na hora do fuso", () => {
    const grupos = gruposDosLembretes(
      [
        lembrete({ texto: "Sábado", quando: "2026-10-10T12:00:00.000Z" }),
        lembrete({ texto: "Perdido", quando: "2026-10-08T11:00:00.000Z", estado: "perdido" }),
        lembrete({ texto: "Água" }),
      ],
      "America/Sao_Paulo",
      new Date("2026-10-08T14:00:00.000Z"),
    );
    expect(
      grupos.map((g) => [g.nome, g.linhas.map((l) => [l.lembrete.texto, l.quando, l.selo?.texto])]),
    ).toEqual([
      ["Atrasados", [["Perdido", "08:00", "atrasado"]]],
      ["Hoje", [["Água", "15:00", undefined]]],
      ["Próximos", [["Sábado", "sáb 09:00", undefined]]],
    ]);
  });
});
