import type { Lembrete, Tarefa } from "@moductus/contrato";

/** Os exemplos dos testes da área: quinta, 8 de outubro de 2026, como no quadro. */
export const HOJE = "2026-10-08";

let seq = 0;

export const tarefa = (extra: Partial<Tarefa> = {}): Tarefa => ({
  id: `t${++seq}`,
  listaId: "entrada",
  tarefaPaiId: null,
  titulo: `Tarefa ${seq}`,
  notas: null,
  notaId: null,
  prioridade: 0,
  venceEm: HOJE,
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
  criadoEm: "2026-10-01T12:00:00.000Z",
  atualizadoEm: "2026-10-01T12:00:00.000Z",
  ...extra,
});

export const lembrete = (extra: Partial<Lembrete> = {}): Lembrete => ({
  id: `l${++seq}`,
  texto: "Beber água",
  // 15:00 em São Paulo.
  quando: "2026-10-08T18:00:00.000Z",
  recorrencia: null,
  tarefaId: null,
  eventoId: null,
  estado: "agendado",
  disparadoEm: null,
  adiadoAte: null,
  canal: "windows",
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-01T12:00:00.000Z",
  atualizadoEm: "2026-10-01T12:00:00.000Z",
  ...extra,
});
