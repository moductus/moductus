import type { BlocoLivre, DiaDaAgenda, Expediente, Ocorrencia, SugestaoEncaixe } from "@moductus/contrato";
import { diasNoIntervalo, instantesNoIntervalo } from "../dia/recorrencia.ts";
import { diasEntre, inicioDoDia, instanteNoFuso, somarDias } from "../dia/tempo.ts";

/**
 * As contas do dia da agenda (DATA.md §2, AGENTS.md §2 Alba): as ocorrências de um intervalo, os
 * blocos livres dentro do expediente, o planejado das tarefas e os encaixes que a Alba sugere.
 * Funções puras: o serviço lê o banco e o relógio e passa tudo por parâmetro.
 */

const MS_MIN = 60_000;
const MS_DIA = 86_400_000;

/** Bloco menor que isso não é horário livre: é o intervalo entre duas reuniões. */
export const BLOCO_MINIMO_MIN = 15;

/** Hoje, o livre começa no próximo múltiplo de 5 min depois de agora: "livre das 10:10", não 10:07. */
const PASSO_DO_AGORA_MS = 5 * MS_MIN;

/** Encaixes por dia: os das 3 prioridades, como o briefing; mais que isso é lotar a agenda. */
export const MAX_SUGESTOES_POR_DIA = 3;

/** Um evento como está no banco, com o que a ocorrência precisa. */
export interface EventoParaExpandir {
  id: string;
  calendarioId: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local: string | null;
  recorrencia: string | null;
  editavel: boolean;
}

/** Uma ocorrência com o começo em ms, para ordenar e somar sem ler o texto de novo. */
interface Expandida {
  ocorrencia: Ocorrencia;
  ordem: number;
}

/**
 * As vezes em que cada evento acontece de `de` a `ate` (dias no fuso, inclusive): o que encosta no
 * intervalo entra, também o que começou antes e ainda não acabou (a reunião que atravessa a meia-
 * noite, o evento de três dias). O recorrente aparece uma vez por ocorrência; a regra que o
 * Moductus não expande fica só com o início, como em `recorrencia.ts`.
 */
export function ocorrenciasNoIntervalo(
  eventos: readonly EventoParaExpandir[],
  de: string,
  ate: string,
  fuso: string,
): Ocorrencia[] {
  const comeco = inicioDoDia(de, fuso).getTime();
  const fimDoIntervalo = inicioDoDia(somarDias(ate, 1), fuso).getTime();
  const expandidas: Expandida[] = [];
  for (const e of eventos) {
    const base = {
      eventoId: e.id,
      calendarioId: e.calendarioId,
      titulo: e.titulo,
      diaInteiro: e.diaInteiro,
      local: e.local,
      recorrente: e.recorrencia !== null,
      editavel: e.editavel,
    };
    if (e.diaInteiro) {
      const dias = diasEntre(e.inicio, e.fim);
      // O que começou até `dias - 1` antes de `de` ainda está acontecendo nele.
      const desde = somarDias(de, -(dias - 1));
      for (const dia of diasNoIntervalo(e.recorrencia, e.inicio, desde, ate).ocorrencias) {
        expandidas.push({
          ocorrencia: { ...base, inicio: dia, fim: somarDias(dia, dias) },
          ordem: inicioDoDia(dia, fuso).getTime(),
        });
      }
      continue;
    }
    const inicio = Date.parse(e.inicio);
    const duracao = Date.parse(e.fim) - inicio;
    // Um dia de folga além da duração: a ocorrência de ontem às 23h ainda pode estar no intervalo.
    const desde = somarDias(de, -(Math.ceil(duracao / MS_DIA) + 1));
    for (const quando of instantesNoIntervalo(e.recorrencia, new Date(inicio), fuso, desde, ate)
      .ocorrencias) {
      const ini = quando.getTime();
      const fim = ini + duracao;
      const encosta = ini < fimDoIntervalo && (fim > comeco || (duracao === 0 && ini >= comeco));
      if (!encosta) continue;
      expandidas.push({
        ocorrencia: { ...base, inicio: new Date(ini).toISOString(), fim: new Date(fim).toISOString() },
        ordem: ini,
      });
    }
  }
  return expandidas
    .sort(
      (a, b) =>
        a.ordem - b.ordem ||
        Number(b.ocorrencia.diaInteiro) - Number(a.ocorrencia.diaInteiro) ||
        a.ocorrencia.titulo.localeCompare(b.ocorrencia.titulo) ||
        a.ocorrencia.eventoId.localeCompare(b.ocorrencia.eventoId),
    )
    .map((e) => e.ocorrencia);
}

/** Um intervalo em ms, com o fim de fora. */
export interface Faixa {
  inicio: number;
  fim: number;
}

/**
 * O que sobra da janela tirando o que está ocupado: as faixas ocupadas que se sobrepõem viram uma
 * só, e o que sobrar com menos de {@link BLOCO_MINIMO_MIN} fica de fora.
 */
export function blocosLivres(janela: Faixa, ocupadas: readonly Faixa[]): BlocoLivre[] {
  const livres: BlocoLivre[] = [];
  const anotar = (inicio: number, fim: number) => {
    const minutos = Math.floor((fim - inicio) / MS_MIN);
    if (minutos >= BLOCO_MINIMO_MIN) {
      livres.push({ inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString(), minutos });
    }
  };
  let cursor = janela.inicio;
  const ordenadas = ocupadas
    .filter((o) => o.fim > janela.inicio && o.inicio < janela.fim)
    .sort((a, b) => a.inicio - b.inicio);
  for (const o of ordenadas) {
    if (o.inicio > cursor) anotar(cursor, Math.min(o.inicio, janela.fim));
    cursor = Math.max(cursor, o.fim);
    if (cursor >= janela.fim) return livres;
  }
  if (cursor < janela.fim) anotar(cursor, janela.fim);
  return livres;
}

/** Uma tarefa aberta, com o que o planejado e o encaixe precisam (lida de `tarefas`). */
export interface TarefaDoDia {
  id: string;
  venceEm: string;
  hora: string | null;
  duracaoMin: number | null;
  prioridade: number;
  ordem: number;
  /**
   * Já tem lugar na agenda: ligada a um evento vivo (o encaixe aplicado, o espelho da tarefa com
   * hora). O tempo dela já está no ocupado; contar de novo no planejado seria contar duas vezes.
   */
  naAgenda: boolean;
  /** Subtarefa de uma mãe aberta que já tem estimativa: a da mãe cobre a dela. */
  cobertaPelaMae: boolean;
}

export interface EntradaDias {
  de: string;
  ate: string;
  /** O dia de hoje no fuso: as atrasadas contam nele. */
  hoje: string;
  agora: Date;
  fuso: string;
  expediente: Expediente;
  ocorrencias: readonly Ocorrencia[];
  tarefas: readonly TarefaDoDia[];
}

/**
 * Cada dia de `de` a `ate`: os blocos livres do expediente que ainda não passaram, o planejado das
 * tarefas do dia e se ele passa do livre ("7h planejadas para 5h livres"), e os encaixes.
 *
 * O planejado é a duração estimada das tarefas abertas que vencem no dia; hoje leva também as
 * atrasadas (as abertas de ontem passam para hoje), e o dia que passou fica sem planejado. Tarefa
 * sem estimativa não soma: não há número honesto para ela. O evento de dia inteiro não ocupa o expediente (aniversário, feriado, férias
 * marcadas como aviso).
 */
export function montarDias(e: EntradaDias): DiaDaAgenda[] {
  const ocupadas: Faixa[] = e.ocorrencias
    .filter((o) => !o.diaInteiro)
    .map((o) => ({ inicio: Date.parse(o.inicio), fim: Date.parse(o.fim) }));
  const daqui = Math.ceil(e.agora.getTime() / PASSO_DO_AGORA_MS) * PASSO_DO_AGORA_MS;
  const dias: DiaDaAgenda[] = [];
  for (let dia = e.de; dia <= e.ate; dia = somarDias(dia, 1)) {
    const janela = {
      inicio: Math.max(instanteNoFuso(dia, e.expediente.inicio, e.fuso).getTime(), daqui),
      fim: instanteNoFuso(dia, e.expediente.fim, e.fuso).getTime(),
    };
    const livres = janela.inicio < janela.fim ? blocosLivres(janela, ocupadas) : [];
    const livreMin = livres.reduce((soma, b) => soma + b.minutos, 0);
    // A aberta de um dia que passou é planejada hoje, não no dia dela: conta uma vez só.
    const planejadas =
      dia < e.hoje
        ? []
        : e.tarefas.filter(
            (t) =>
              t.duracaoMin !== null &&
              !t.naAgenda &&
              !t.cobertaPelaMae &&
              (t.venceEm === dia || (dia === e.hoje && t.venceEm < e.hoje)),
          );
    const planejadoMin = planejadas.reduce((soma, t) => soma + (t.duracaoMin ?? 0), 0);
    dias.push({
      dia,
      livres,
      livreMin,
      planejadoMin,
      cheio: planejadoMin > livreMin,
      sugestoes: encaixar(planejadas, livres),
    });
  }
  return dias;
}

/**
 * Os encaixes da Alba: as tarefas sem hora, da maior prioridade para a menor (e a atrasada antes),
 * cada uma no primeiro bloco livre em que cabe, sem sobrepor uma à outra. A que não cabe em nenhum
 * fica sem sugestão: dizer que o dia está cheio é com o `cheio`.
 */
function encaixar(planejadas: readonly TarefaDoDia[], livres: readonly BlocoLivre[]): SugestaoEncaixe[] {
  const sobras = livres.map((b) => ({ inicio: Date.parse(b.inicio), fim: Date.parse(b.fim) }));
  const candidatas = planejadas
    .filter((t) => t.hora === null)
    .sort(
      (a, b) =>
        b.prioridade - a.prioridade ||
        a.venceEm.localeCompare(b.venceEm) ||
        a.ordem - b.ordem ||
        a.id.localeCompare(b.id),
    );
  const sugestoes: SugestaoEncaixe[] = [];
  for (const t of candidatas) {
    if (sugestoes.length >= MAX_SUGESTOES_POR_DIA) break;
    const duracao = (t.duracaoMin ?? 0) * MS_MIN;
    const bloco = sobras.find((s) => s.fim - s.inicio >= duracao);
    if (!bloco) continue;
    sugestoes.push({
      tarefaId: t.id,
      inicio: new Date(bloco.inicio).toISOString(),
      fim: new Date(bloco.inicio + duracao).toISOString(),
    });
    bloco.inicio += duracao;
  }
  return sugestoes;
}
