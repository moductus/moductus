import type { DiaDaAgenda, Tarefa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  chaveDoEncaixe,
  depoisDeste,
  diaNoFuso,
  falaDoEncaixe,
  proximoEncaixe,
  TAREFAS_DEPOIS,
} from "./foco.ts";

/** Um instante na hora local do PC, como a fala da Alba escreve. */
const local = (h: number, m = 0) => new Date(2026, 9, 18, h, m).toISOString();

function tarefa(id: string, campos: Partial<Tarefa> = {}): Tarefa {
  return {
    id,
    listaId: "entrada",
    tarefaPaiId: null,
    titulo: `Tarefa ${id}`,
    notas: null,
    notaId: null,
    prioridade: 0,
    venceEm: "2026-10-18",
    hora: null,
    duracaoEstimadaMin: 25,
    recorrencia: null,
    estado: "aberta",
    concluidaEm: null,
    ordem: 0,
    etiquetas: [],
    lembreteMinutosAntes: null,
    origem: "usuario",
    agenteId: null,
    execucaoId: null,
    criadoEm: local(8),
    atualizadoEm: local(8),
    ...campos,
  } as Tarefa;
}

function dia(campos: Partial<DiaDaAgenda> = {}): DiaDaAgenda {
  return {
    dia: "2026-10-18",
    livres: [{ inicio: local(16), fim: local(17, 30), minutos: 90 }],
    livreMin: 90,
    planejadoMin: 25,
    cheio: false,
    sugestoes: [{ tarefaId: "b", inicio: local(16), fim: local(16, 25) }],
    ...campos,
  };
}

describe("depoisDeste", () => {
  it("as abertas na ordem do serviço, sem a do foco, sem subtarefa e até três", () => {
    const lista = [
      tarefa("a"),
      tarefa("b"),
      tarefa("filha", { tarefaPaiId: "b" }),
      tarefa("feita", { estado: "feita", concluidaEm: local(9) }),
      tarefa("c"),
      tarefa("d"),
      tarefa("e"),
    ];
    expect(depoisDeste(lista, "a").map((t) => t.id)).toEqual(["b", "c", "d"]);
    expect(depoisDeste(lista, null)).toHaveLength(TAREFAS_DEPOIS);
  });
});

describe("proximoEncaixe", () => {
  const tarefas = [tarefa("a"), tarefa("b", { titulo: "Separar comprovantes do mês" })];

  it("a primeira sugestão do dia, com o bloco livre em que ela cai", () => {
    const encaixe = proximoEncaixe(dia(), tarefas, null, new Set());
    expect(encaixe?.titulo).toBe("Separar comprovantes do mês");
    expect(encaixe?.bloco.minutos).toBe(90);
  });

  it("pula a da tarefa no foco, a recusada e a de tarefa que não está mais aberta", () => {
    const d = dia({
      sugestoes: [
        { tarefaId: "a", inicio: local(16), fim: local(16, 25) },
        { tarefaId: "b", inicio: local(16, 25), fim: local(16, 50) },
        { tarefaId: "x", inicio: local(16, 50), fim: local(17, 15) },
      ],
    });
    expect(proximoEncaixe(d, tarefas, "a", new Set())?.sugestao.tarefaId).toBe("b");
    const recusada = new Set([chaveDoEncaixe(d.sugestoes[1]!)]);
    expect(proximoEncaixe(d, tarefas, "a", recusada)).toBeNull();
    expect(proximoEncaixe(null, tarefas, null, new Set())).toBeNull();
  });
});

describe("falaDoEncaixe", () => {
  it("diz o bloco livre e só o pedaço que vai guardar", () => {
    const encaixe = proximoEncaixe(
      dia(),
      [tarefa("b", { titulo: "Separar comprovantes" })],
      null,
      new Set(),
    )!;
    expect(falaDoEncaixe(encaixe)).toBe(
      "Seu próximo bloco livre é das 16h às 17h30. Guardo das 16h às 16h25 para “Separar comprovantes”?",
    );
  });

  it("com a tarefa ocupando o bloco inteiro, guarda ele", () => {
    const d = dia({ sugestoes: [{ tarefaId: "b", inicio: local(16), fim: local(17, 30) }] });
    const encaixe = proximoEncaixe(d, [tarefa("b", { titulo: "Planilha" })], null, new Set())!;
    expect(falaDoEncaixe(encaixe)).toBe(
      "Seu próximo bloco livre é das 16h às 17h30. Guardo ele para “Planilha”?",
    );
  });
});

describe("diaNoFuso", () => {
  it("o dia do usuário pelo fuso da configuração, não pelo UTC", () => {
    const instante = new Date("2026-10-19T01:30:00.000Z");
    expect(diaNoFuso(instante, "America/Sao_Paulo")).toBe("2026-10-18");
    expect(diaNoFuso(instante, "Asia/Tokyo")).toBe("2026-10-19");
  });

  it("fuso que o Intl não conhece cai no dia do PC", () => {
    const instante = new Date(2026, 9, 18, 12);
    expect(diaNoFuso(instante, "Fuso/Inventado")).toBe("2026-10-18");
  });
});
