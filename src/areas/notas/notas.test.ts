import type { Nota, Tarefa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  diaDaTarefa,
  gruposLigados,
  origemDaNota,
  pedacosDoTrecho,
  quandoDaNota,
  textoDoSalvo,
  tituloDaNota,
} from "./notas.ts";
import type { EstadoRascunho } from "./salvamento.ts";

// Domingo, 18 de outubro de 2026, à tarde no horário local.
const AGORA = new Date(2026, 9, 18, 15, 0);
const local = (...partes: [number, number, number, number?]) => new Date(...partes).toISOString();

describe("quandoDaNota", () => {
  it("hoje, ontem, o dia da semana e o dia do mês, como a lista do quadro", () => {
    expect(quandoDaNota(local(2026, 9, 18, 0), AGORA)).toBe("hoje");
    expect(quandoDaNota(local(2026, 9, 17, 23), AGORA)).toBe("ontem");
    expect(quandoDaNota(local(2026, 9, 12, 9), AGORA)).toBe("seg");
    expect(quandoDaNota(local(2026, 9, 2, 9), AGORA)).toBe("2 out");
    expect(quandoDaNota(local(2025, 10, 20, 9), AGORA)).toBe("20 nov 2025");
  });

  it("instante inválido não vira data inventada", () => {
    expect(quandoDaNota("ontem", AGORA)).toBe("");
  });
});

describe("diaDaTarefa", () => {
  it("o dia da tarefa sem passar pelo fuso", () => {
    expect(diaDaTarefa("2026-11-20", AGORA)).toBe("20 nov");
    expect(diaDaTarefa("2027-01-02", AGORA)).toBe("2 jan 2027");
  });
});

describe("pedacosDoTrecho", () => {
  it("marca o que bateu pelas posições do serviço", () => {
    expect(pedacosDoTrecho("ligar amanhã cedo", [{ inicio: 6, fim: 12 }])).toEqual([
      { texto: "ligar ", marcado: false },
      { texto: "amanhã", marcado: true },
      { texto: " cedo", marcado: false },
    ]);
  });

  it("posição fora do texto ou sobreposta é ignorada, sem repetir pedaço", () => {
    const pedacos = pedacosDoTrecho("abc", [
      { inicio: 1, fim: 2 },
      { inicio: 1, fim: 3 },
      { inicio: 2, fim: 9 },
    ]);
    expect(pedacos.map((p) => p.texto).join("")).toBe("abc");
    expect(pedacos.filter((p) => p.marcado)).toEqual([{ texto: "b", marcado: true }]);
  });
});

let seq = 0;
const tarefa = (extra: Partial<Tarefa> = {}): Tarefa => ({
  id: `t${++seq}`,
  listaId: "entrada",
  tarefaPaiId: null,
  titulo: "Revisar o carro",
  notas: null,
  notaId: "01NOTA",
  prioridade: 0,
  venceEm: null,
  hora: null,
  duracaoEstimadaMin: null,
  recorrencia: null,
  estado: "aberta",
  concluidaEm: null,
  ordem: 0,
  etiquetas: [],
  lembreteMinutosAntes: null,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-18T10:00:00.000Z",
  atualizadoEm: "2026-10-18T10:00:00.000Z",
  ...extra,
});

describe("gruposLigados", () => {
  it("as da Alba numa frase, as suas noutra", () => {
    const grupos = gruposLigados([
      tarefa({ origem: "agente", agenteId: "alba" }),
      tarefa({ origem: "agente", agenteId: "alba" }),
      tarefa(),
    ]);
    expect(grupos.map((g) => [g.agente, g.texto, g.tarefas.length])).toEqual([
      ["alba", "A Alba criou 2 tarefas a partir desta nota.", 2],
      [null, "Você criou 1 tarefa a partir desta nota.", 1],
    ]);
  });

  it("o Nuno no masculino; agente que não é do time não vira um deles", () => {
    const grupos = gruposLigados([
      tarefa({ origem: "agente", agenteId: "nuno" }),
      tarefa({ origem: "agente", agenteId: "01AGENTEX" }),
    ]);
    expect(grupos.map((g) => g.texto)).toEqual([
      "O Nuno criou 1 tarefa a partir desta nota.",
      "1 tarefa veio desta nota.",
    ]);
  });
});

describe("origemDaNota", () => {
  it("diz quem escreveu quando foi um agente", () => {
    expect(origemDaNota({ origem: "agente", agenteId: "alba" })).toBe("criada pela Alba");
    expect(origemDaNota({ origem: "agente", agenteId: "nuno" })).toBe("criada pelo Nuno");
    expect(origemDaNota({ origem: "usuario", agenteId: null })).toBeNull();
  });
});

describe("textos", () => {
  it("nota sem título", () => {
    expect(tituloDaNota("  ")).toBe("Sem título");
  });

  it("o salvamento em texto", () => {
    const nota = { atualizadoEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString() } as Nota;
    const estado = (situacao: EstadoRascunho["situacao"]) => ({ situacao, nota }) as EstadoRascunho;
    expect(textoDoSalvo(estado("salvo"), AGORA)).toBe("salvo há 5 min");
    expect(textoDoSalvo(estado("salvo"), new Date(nota.atualizadoEm), "salva")).toBe("salva agora");
    expect(textoDoSalvo(estado("esperando"), AGORA)).toBe("salvando");
    expect(textoDoSalvo(estado("conflito"), AGORA)).toBe("não salvou");
    expect(textoDoSalvo(estado("apagada"), AGORA)).toBe("na Lixeira");
  });
});
