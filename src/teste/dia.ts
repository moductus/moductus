import type { Lembrete, Tarefa } from "@moductus/contrato";

/** Tarefas e lembretes de teste das telas do dia, no formato que o serviço devolve. */

const INSTANTE = "2026-10-08T12:00:00.000Z";

export function tarefa(id: string, extra: Partial<Tarefa> = {}): Tarefa {
  return {
    id,
    listaId: "entrada",
    tarefaPaiId: null,
    titulo: `Tarefa ${id}`,
    notas: null,
    notaId: null,
    prioridade: 0,
    venceEm: "2026-10-08",
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
    criadoEm: INSTANTE,
    atualizadoEm: INSTANTE,
    ...extra,
  };
}

export function lembrete(id: string, extra: Partial<Lembrete> = {}): Lembrete {
  return {
    id,
    texto: `Lembrete ${id}`,
    quando: "2026-10-08T17:45:00.000Z",
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
    criadoEm: INSTANTE,
    atualizadoEm: INSTANTE,
    ...extra,
  };
}
