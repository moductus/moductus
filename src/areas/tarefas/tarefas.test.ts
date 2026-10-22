import type { Lista, PreviaCaptura, Tarefa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  gruposDasAbertas,
  gruposDoHoje,
  gruposDosLembretes,
  gruposDosProximos,
  lancamentoDaPrevia,
  emLotes,
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

  it("a subtarefa que vem nos dois recortes conta uma vez", () => {
    const mae = tarefa({ titulo: "Mãe atrasada", venceEm: "2026-10-07" });
    const filha = tarefa({ tarefaPaiId: mae.id });
    const grupos = gruposDoHoje([filha], [mae, filha], HOJE);
    expect(nomes(grupos)).toEqual([["Atrasada", ["Mãe atrasada"]]]);
    expect(grupos[0]!.linhas[0]!.nota).toBe("veio de ontem · subtarefas 0 de 1");
  });

  it("nos períodos só a hora ordena: a atrasada feita hoje às 11:30 vem depois da das 09:00", () => {
    const grupos = gruposDoHoje(
      [
        tarefa({
          titulo: "De ontem",
          venceEm: "2026-10-07",
          hora: "11:30",
          estado: "feita",
          concluidaEm: "2026-10-08T14:00:00.000Z",
        }),
        tarefa({ titulo: "De hoje", hora: "09:00" }),
      ],
      [],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([["Manhã", ["De hoje", "De ontem"]]]);
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

  it("as subtarefas acham a mãe antes do corte: sem data contam, e a da mãe longe não vira linha", () => {
    const perto = tarefa({ titulo: "Perto", venceEm: "2026-10-09" });
    const longe = tarefa({ titulo: "Longe", venceEm: "2026-10-18" });
    const grupos = gruposDosProximos(
      [
        perto,
        longe,
        tarefa({ tarefaPaiId: perto.id, venceEm: null }),
        tarefa({
          tarefaPaiId: perto.id,
          venceEm: null,
          estado: "feita",
          concluidaEm: "2026-10-08T12:00:00.000Z",
        }),
        tarefa({ titulo: "Filha da longe", tarefaPaiId: longe.id, venceEm: HOJE }),
      ],
      HOJE,
    );
    expect(nomes(grupos)).toEqual([["Amanhã", ["Perto"]]]);
    expect(grupos[0]!.linhas[0]!.nota).toBe("subtarefas 1 de 2");
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
    expect(moverNoGrupo(linhas, b!.id, -1)).toEqual([b!.id, a!.id]);
    expect(soltarNoGrupo(linhas, b!.id, a!.id)).toEqual([b!.id, a!.id]);
  });

  it("só a sequência seguida da mesma chave vai ao serviço, e o adiar vai em lotes de 1000", () => {
    const [d, e] = [tarefa({ titulo: "D" }), tarefa({ titulo: "E" })];
    const comHora = gruposDasAbertas([c!, a!, b!, d!, e!], HOJE)[0]!.linhas;
    expect(comHora.map((l) => l.tarefa.titulo)).toEqual(["C", "A", "B", "D", "E"]);
    expect(moverNoGrupo(comHora, d!.id, 1)).toEqual([a!.id, b!.id, e!.id, d!.id]);
    expect(soltarNoGrupo(comHora, e!.id, a!.id)).toEqual([e!.id, a!.id, b!.id, d!.id]);
    const ids = Array.from({ length: 2001 }, (_, i) => `t${i}`);
    expect(emLotes(ids).map((l) => l.length)).toEqual([1000, 1000, 1]);
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
    expect(pedacosDoEntendi(lancamento, LISTAS, HOJE)).toEqual([
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
    expect(pedacosDoEntendi(naLista, LISTAS, HOJE)).toEqual(["tarefa", "Pessoal"]);
    expect(pedacosDoEntendi(lancamentoDaPrevia(semNada, { listaId: null, dia: null }), LISTAS, HOJE)).toEqual(
      ["tarefa", "Entrada"],
    );
  });

  it("o que a frase disse vale mais que a vista; nota e lembrete não ganham lista", () => {
    const comDia = lancamentoDaPrevia(previa(), { listaId: "entrada", dia: HOJE });
    expect(comDia.campos).toMatchObject({ dia: "2026-10-09", listaId: "pessoal" });
    const nota = lancamentoDaPrevia(previa({ tipo: "nota" }, { dia: null, hora: null }), {
      listaId: "pessoal",
      dia: HOJE,
    });
    expect(nota.campos.dia).toBeNull();
    expect(pedacosDoEntendi(nota, LISTAS, HOJE)).toEqual(["nota"]);
    const lembrete = lancamentoDaPrevia(previa({ tipo: "lembrete" }, { listaId: null }), {
      listaId: "pessoal",
      dia: null,
    });
    expect(pedacosDoEntendi(lembrete, LISTAS, HOJE)).toEqual(["lembrete", "sexta, 9 out", "15:00"]);
  });

  it("gasto e memória ainda não chegaram: vão como a primeira alternativa da prévia", () => {
    const gasto = lancamentoDaPrevia(previa({ tipo: "gasto", alternativas: ["tarefa", "nota"] }), {
      listaId: null,
      dia: null,
    });
    expect(gasto.tipo).toBe("tarefa");
    const memoria = lancamentoDaPrevia(previa({ tipo: "memoria", alternativas: ["nota", "tarefa"] }), {
      listaId: "pessoal",
      dia: HOJE,
    });
    expect(memoria).toMatchObject({ tipo: "nota", campos: { listaId: "pessoal", dia: "2026-10-09" } });
    expect(
      lancamentoDaPrevia(previa({ tipo: "memoria", alternativas: [] }), { listaId: null, dia: null }).tipo,
    ).toBe("tarefa");
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
