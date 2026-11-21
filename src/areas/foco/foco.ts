import type {
  CiclosFoco,
  EstadoFoco,
  EtapaFoco,
  FocoPorDia,
  FocoPorTarefa,
  HistoricoFoco,
  NomeEvento,
  Tarefa,
  TipoEtapa,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback } from "react";
import { formatarHora } from "../../componentes/personagem/quando.ts";
import { diaNoFuso, useRelida } from "../../janelas/painel/foco.ts";
import { servico } from "../../servico/conexao.ts";
import { duracaoCurta } from "../../servico/foco.ts";

/**
 * A área Foco (AreaFoco.dc.html): a rodada, o dia, a semana e o relatório por tarefa montados do
 * `EstadoFoco` e do `foco.historico`. Quem fecha etapa, conta ciclo e soma minuto é o serviço
 * (F3-18); aqui só se arruma o que ele devolveu para o quadro.
 */

const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;

/** Quantas tarefas o "Ligar a uma tarefa de hoje" oferece. */
export const OPCOES_DE_TAREFA = 3;

/** "Foco 2", "Pausa", "Pausa longa". */
const NOME_DA_ETAPA: Record<TipoEtapa, string> = { foco: "Foco", pausa: "Pausa", pausa_longa: "Pausa longa" };

/** Duração da área: "25 min", "1h15"; zero é o traço do quadro. */
export const duracaoDoFoco = (minutos: number) => (minutos > 0 ? duracaoCurta(minutos) : "—");

const hora = (ms: number) => formatarHora(new Date(ms));

/** "09:40–10:05". */
export const intervalo = (de: number, ate: number) => `${hora(de)}–${hora(ate)}`;

/** "1 ciclo", "3 ciclos". */
export const ciclosEmTexto = (n: number) => `${n} ${n === 1 ? "ciclo" : "ciclos"}`;

/** "25 · 5 · 15 min, pausa longa a cada 4", ao lado do título. */
export const textoDosCiclos = (c: CiclosFoco) =>
  `${c.focoMin} · ${c.pausaMin} · ${c.pausaLongaMin} min, pausa longa a cada ${c.ciclosAtePausaLonga}`;

const minutosDoTipo = (tipo: TipoEtapa, c: CiclosFoco) =>
  tipo === "foco" ? c.focoMin : tipo === "pausa" ? c.pausaMin : c.pausaLongaMin;

// ---------- a rodada ----------

/** Como cada etapa da rodada está: feita, parada antes da hora, correndo agora ou por vir. */
export type SituacaoEtapa = "feito" | "parou" | "agora" | "falta";

export interface EtapaDaRodada {
  chave: string;
  tipo: TipoEtapa;
  /** "Foco 2", "Pausa", "Pausa longa". */
  nome: string;
  minutos: number;
  /** Início e fim em ms: os reais das que aconteceram, a conta pela configuração das que faltam. */
  inicio: number;
  fim: number;
  situacao: SituacaoEtapa;
}

/**
 * As etapas de hoje, da mais antiga para a mais nova, com a que está em andamento como o
 * `EstadoFoco` a conhece (o histórico pode ter chegado antes do último `foco.mudou`).
 */
export function etapasDeHoje(
  historico: HistoricoFoco | null,
  estado: EstadoFoco,
  hoje: string,
  fuso: string | null,
): EtapaFoco[] {
  const atual = estado.etapa;
  const doDia = (historico?.etapas ?? []).filter(
    (e) => diaNoFuso(new Date(e.inicio), fuso) === hoje && e.id !== atual?.id && e.fim !== null,
  );
  const lista = [...doDia].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  return atual ? [...lista, atual] : lista;
}

/**
 * As etapas que já aconteceram de uma rodada: andando da mais nova para trás até juntar `focos`
 * focos (o primeiro deles fecha a rodada) ou bater numa pausa longa, que é o fim da anterior.
 */
function voltarNaRodada(etapas: readonly EtapaFoco[], focos: number): EtapaFoco[] {
  const rodada: EtapaFoco[] = [];
  let juntos = 0;
  for (let i = etapas.length - 1; i >= 0 && juntos < focos; i--) {
    const e = etapas[i]!;
    if (e.tipo === "pausa_longa" && rodada.length > 0) break;
    rodada.unshift(e);
    if (e.tipo === "foco") juntos++;
  }
  return rodada;
}

/** Quantos focos da rodada já começaram: sem nada correndo e sem pausa proposta, o próximo ainda não. */
const focosJaComecados = (estado: EstadoFoco) =>
  estado.etapa !== null || estado.proxima !== "foco" ? estado.cicloAtual : estado.cicloAtual - 1;

/** As etapas que já aconteceram, com os focos numerados a partir de `antes` + 1. */
function jaAconteceram(
  passadas: readonly EtapaFoco[],
  antes: number,
  atualId: string | null,
): EtapaDaRodada[] {
  let numero = antes;
  return passadas.map((e) => {
    if (e.tipo === "foco") numero++;
    return {
      chave: e.id,
      tipo: e.tipo,
      nome: e.tipo === "foco" ? `Foco ${numero}` : NOME_DA_ETAPA[e.tipo],
      minutos: e.duracaoPlanejadaMin,
      inicio: Date.parse(e.inicio),
      fim: Date.parse(e.fim ?? e.terminaEm),
      situacao: e.id === atualId ? "agora" : e.interrompida ? "parou" : "feito",
    };
  });
}

/** O que vem depois de uma etapa na rodada; depois da pausa longa, nada. */
function seguinte(tipo: TipoEtapa, numeroFoco: number, total: number): TipoEtapa | null {
  if (tipo === "foco") return numeroFoco >= total ? "pausa_longa" : "pausa";
  if (tipo === "pausa") return "foco";
  return null;
}

/**
 * As etapas da rodada em andamento (AreaFoco.dc.html, "Etapas desta rodada"): as que já
 * aconteceram hoje, com hora real, a que corre agora e as que faltam até a pausa longa, contadas
 * pela configuração a partir do fim da atual. `agora` só conta para o que falta quando nada corre.
 */
export function etapasDaRodada(
  estado: EstadoFoco,
  hoje: readonly EtapaFoco[],
  ciclos: CiclosFoco | null,
  agora: number,
): EtapaDaRodada[] {
  const total = estado.ciclosAtePausaLonga;
  const comecados = Math.max(0, focosJaComecados(estado));
  const passadas = comecados > 0 ? voltarNaRodada(hoje, comecados) : [];
  const achados = passadas.filter((e) => e.tipo === "foco").length;
  // Rodada que começou ontem: os focos que faltam no histórico de hoje continuam a contagem.
  const lista = jaAconteceram(passadas, comecados - achados, estado.etapa?.id ?? null);
  let numero = comecados;
  if (ciclos === null) return lista;

  const ultima = passadas.at(-1);
  let tipo: TipoEtapa | null = ultima ? seguinte(ultima.tipo, numero, total) : "foco";
  // Sem nada correndo, o que vem é o que o serviço propõe, mesmo sem o foco no histórico de hoje
  // (terminou depois da meia-noite, ou o histórico não chegou).
  if (estado.etapa === null) tipo = estado.proxima;
  let cursor = agora;
  const atual = estado.etapa;
  if (atual && atual.pausadaEm === null) cursor = Date.parse(atual.terminaEm);
  else if (atual) cursor = agora + Math.max(0, Date.parse(atual.terminaEm) - Date.parse(atual.pausadaEm!));
  // Uma volta inteira no máximo: a configuração nunca passa de 12 focos.
  for (let passo = 0; tipo !== null && passo < 2 * total + 1; passo++) {
    if (tipo === "foco") numero++;
    const minutos = minutosDoTipo(tipo, ciclos);
    lista.push({
      chave: `falta-${passo}`,
      tipo,
      nome: tipo === "foco" ? `Foco ${numero}` : NOME_DA_ETAPA[tipo],
      minutos,
      inicio: cursor,
      fim: cursor + minutos * MIN,
      situacao: "falta",
    });
    cursor += minutos * MIN;
    tipo = seguinte(tipo, numero, total);
  }
  return lista;
}

/** A soma da rodada para o rótulo: "4 focos · 2h10". */
export function resumoDaRodada(etapas: readonly EtapaDaRodada[]): string {
  const focos = etapas.filter((e) => e.tipo === "foco").length;
  const minutos = etapas.reduce((soma, e) => soma + e.minutos, 0);
  return `${focos} ${focos === 1 ? "foco" : "focos"} · ${duracaoDoFoco(minutos)}`;
}

/** A rodada que acabou de fechar com a pausa longa ("Rodada completa"), para o resumo da Alba. */
export interface RodadaCompleta {
  /** A pausa longa que fechou a rodada: o "Fechar por aqui" some até a próxima. */
  chave: string;
  fim: number;
  focos: EtapaFoco[];
  minutos: number;
  /** Todas as etapas dela, para a barra da rodada inteira. */
  etapas: EtapaDaRodada[];
}

/**
 * Sem nada correndo e com a pausa longa como a última etapa de hoje, a rodada está completa: o
 * resumo dela, até o usuário começar outra ou fechar por aqui.
 */
export function rodadaCompleta(estado: EstadoFoco, hoje: readonly EtapaFoco[]): RodadaCompleta | null {
  const ultima = hoje.at(-1);
  if (
    estado.etapa !== null ||
    estado.proxima !== "foco" ||
    ultima?.tipo !== "pausa_longa" ||
    ultima.fim === null
  )
    return null;
  const antes = voltarNaRodada(hoje.slice(0, -1), estado.ciclosAtePausaLonga);
  const focos = antes.filter((e) => e.tipo === "foco");
  if (focos.length === 0) return null;
  return {
    chave: ultima.id,
    fim: Date.parse(ultima.fim),
    focos,
    minutos: focos.reduce((soma, e) => soma + (e.duracaoRealMin ?? 0), 0),
    etapas: jaAconteceram([...antes, ultima], 0, null),
  };
}

/**
 * A fala da Alba no fim da rodada (até duas frases): quantos ciclos, quanto foco e, com até duas
 * tarefas, quanto foi para cada uma.
 */
export function falaDaRodada(rodada: RodadaCompleta, titulos: ReadonlyMap<string, string>): string {
  const porTarefa = new Map<string | null, number>();
  for (const f of rodada.focos) porTarefa.set(f.tarefaId, (porTarefa.get(f.tarefaId) ?? 0) + 1);
  const nome = (id: string | null) => (id === null ? null : (titulos.get(id) ?? null));
  const conta = `${ciclosEmTexto(rodada.focos.length)}, ${duracaoDoFoco(rodada.minutos)} de foco`;
  const tarefas = [...porTarefa];
  let detalhe = "";
  if (tarefas.length === 1) {
    const titulo = nome(tarefas[0]![0]);
    if (titulo) detalhe = ` em “${titulo}”`;
  } else if (tarefas.length === 2) {
    const partes = tarefas.map(([id, n]) => {
      const titulo = nome(id);
      return titulo ? `${n} em “${titulo}”` : `${n} sem tarefa`;
    });
    detalhe = `: ${partes.join(" e ")}`;
  }
  return `${conta}${detalhe}. Começo outra rodada ou fecho por aqui?`;
}

/** O foco que acabou de terminar, se está no histórico de hoje: é a última etapa dele. */
function focoTerminado(hoje: readonly EtapaFoco[]): EtapaFoco | null {
  const ultima = hoje.at(-1);
  return ultima?.tipo === "foco" && ultima.fim !== null ? ultima : null;
}

/**
 * "25 min de foco em “Revisar PR”. Começo a pausa de 5 min?" Sem o foco no histórico, a fala
 * não diz quanto durou.
 */
export function falaDoCicloTerminado(
  foco: EtapaFoco | null,
  titulo: string | null,
  proxima: TipoEtapa,
  ciclos: CiclosFoco | null,
): string {
  const onde = titulo ? ` em “${titulo}”` : " livre";
  const pausa = proxima === "pausa_longa" ? "pausa longa" : "pausa";
  const quanto = ciclos ? ` de ${minutosDoTipo(proxima, ciclos)} min` : "";
  const feito = foco
    ? `${duracaoDoFoco(foco.duracaoRealMin ?? foco.duracaoPlanejadaMin)} de foco${onde}.`
    : `Ciclo de foco${onde} terminado.`;
  return `${feito} Começo a ${pausa}${quanto}?`;
}

/** O que o cartão do ciclo mostra (AreaFoco.dc.html e AreaFocoEstados.dc.html). */
export type SituacaoDoCiclo =
  | { tipo: "etapa"; etapa: EtapaFoco }
  /** `foco` vazio: o serviço propõe a pausa, mas o foco não está no histórico de hoje. */
  | { tipo: "terminado"; foco: EtapaFoco | null }
  | { tipo: "completa"; rodada: RodadaCompleta }
  | { tipo: "comecar" };

/**
 * A etapa que corre (ou está em pausa); sem ela, o foco que acabou de terminar com a pausa
 * proposta, a rodada que fechou (até `fechada`, o "Fechar por aqui") ou começar um foco.
 */
export function situacaoDoCiclo(
  estado: EstadoFoco,
  hoje: readonly EtapaFoco[],
  fechada: string | null,
): SituacaoDoCiclo {
  if (estado.etapa) return { tipo: "etapa", etapa: estado.etapa };
  // Quem diz que o ciclo terminou é o serviço: o cartão de começar nunca começa uma pausa.
  if (estado.proxima !== "foco") return { tipo: "terminado", foco: focoTerminado(hoje) };
  const rodada = rodadaCompleta(estado, hoje);
  if (rodada && rodada.chave !== fechada) return { tipo: "completa", rodada };
  return { tipo: "comecar" };
}

// ---------- o dia, a semana e o relatório ----------

export interface CicloDoDia {
  chave: string;
  tarefaId: string | null;
  /** "09:40–10:05" ou, no que corre, "desde 14:42". */
  hora: string;
  minutos: number;
  atual: boolean;
  interrompido: boolean;
}

/**
 * Os focos de hoje, do primeiro ao que corre agora (AreaFoco.dc.html, "Hoje"): as pausas não
 * entram. O que corre conta o que já passou dele (`decorridoMin`).
 */
export function ciclosDoDia(hoje: readonly EtapaFoco[], decorridoMin: number): CicloDoDia[] {
  return hoje
    .filter((e) => e.tipo === "foco")
    .map((e) => {
      const atual = e.fim === null;
      return {
        chave: e.id,
        tarefaId: e.tarefaId,
        hora: atual
          ? `desde ${hora(Date.parse(e.inicio))}`
          : intervalo(Date.parse(e.inicio), Date.parse(e.fim!)),
        minutos: atual ? decorridoMin : (e.duracaoRealMin ?? 0),
        atual,
        interrompido: e.interrompida,
      };
    });
}

const NOMES_DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const NOMES_DIAS_LONGOS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const paraDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A segunda-feira da semana do dia `AAAA-MM-DD` (a semana do quadro vai de segunda a domingo). */
export function inicioDaSemana(dia: string): string {
  const ms = Date.parse(`${dia}T00:00:00.000Z`);
  const semana = (new Date(ms).getUTCDay() + 6) % 7;
  return paraDia(ms - semana * DIA_MS);
}

export interface DiaDaSemana {
  dia: string;
  nome: string;
  minutos: number;
  ciclos: number;
  /** Do maior dia da semana, de 0 a 1. */
  fracao: number;
  hoje: boolean;
  futuro: boolean;
}

export interface SemanaDoFoco {
  dias: DiaDaSemana[];
  minutos: number;
  ciclos: number;
  /** "Média de 1h53 por dia com foco. Quarta foi o dia mais longo, com 2h30." */
  resumo: string;
}

/** Os sete dias da semana de `hoje`, de segunda a domingo, com o foco de cada um. */
export function semanaDoFoco(porDia: readonly FocoPorDia[], hoje: string): SemanaDoFoco {
  const segunda = Date.parse(`${inicioDaSemana(hoje)}T00:00:00.000Z`);
  const doDia = new Map(porDia.map((d) => [d.dia, d]));
  const base = NOMES_DIAS.map((nome, i) => {
    const dia = paraDia(segunda + i * DIA_MS);
    const d = doDia.get(dia);
    return {
      dia,
      nome,
      minutos: d?.minutos ?? 0,
      ciclos: d?.ciclos ?? 0,
      hoje: dia === hoje,
      futuro: dia > hoje,
    };
  });
  const maior = Math.max(0, ...base.map((d) => d.minutos));
  const dias = base.map((d) => ({ ...d, fracao: maior > 0 ? d.minutos / maior : 0 }));
  const minutos = dias.reduce((s, d) => s + d.minutos, 0);
  const ciclos = dias.reduce((s, d) => s + d.ciclos, 0);
  const comFoco = dias.filter((d) => d.minutos > 0);
  let resumo = "";
  if (comFoco.length > 0) {
    resumo = `Média de ${duracaoDoFoco(Math.round(minutos / comFoco.length))} por dia com foco.`;
    if (comFoco.length > 1) {
      const i = dias.findIndex((d) => d.minutos === maior);
      resumo += ` ${NOMES_DIAS_LONGOS[i]} foi o dia mais longo, com ${duracaoDoFoco(maior)}.`;
    }
  }
  return { dias, minutos, ciclos, resumo };
}

export interface LinhaPorTarefa {
  chave: string;
  titulo: string;
  minutos: number;
  ciclos: number;
  fracao: number;
  semTarefa: boolean;
}

/**
 * O relatório por tarefa da semana: da que recebeu mais foco para a que recebeu menos, com o foco
 * livre ("Sem tarefa ligada") por último, e a barra contra a maior.
 */
export function relatorioPorTarefa(porTarefa: readonly FocoPorTarefa[]): LinhaPorTarefa[] {
  const maior = Math.max(0, ...porTarefa.map((t) => t.minutos));
  const linhas = porTarefa.map((t) => ({
    chave: t.tarefaId ?? "livre",
    titulo: t.tarefaId === null ? "Sem tarefa ligada" : (t.titulo ?? "Tarefa apagada"),
    minutos: t.minutos,
    ciclos: t.ciclos,
    fracao: maior > 0 ? t.minutos / maior : 0,
    semTarefa: t.tarefaId === null,
  }));
  return [...linhas.filter((l) => !l.semTarefa), ...linhas.filter((l) => l.semTarefa)];
}

/** Os títulos que a área conhece: os do relatório, os das tarefas de hoje e o da etapa atual. */
export function titulosConhecidos(
  historico: HistoricoFoco | null,
  tarefas: readonly Tarefa[] | null,
  estado: EstadoFoco | null,
): Map<string, string> {
  const titulos = new Map<string, string>();
  for (const t of historico?.porTarefa ?? []) if (t.tarefaId && t.titulo) titulos.set(t.tarefaId, t.titulo);
  for (const t of tarefas ?? []) titulos.set(t.id, t.titulo);
  const id = estado?.etapa?.tarefaId;
  if (id && estado?.tarefaTitulo) titulos.set(id, estado.tarefaTitulo);
  return titulos;
}

/** As tarefas que o "Ligar a uma tarefa de hoje" oferece: abertas, sem subtarefa, na ordem do serviço. */
export const opcoesDeTarefa = (tarefas: readonly Tarefa[]) =>
  tarefas.filter((t) => t.estado === "aberta" && t.tarefaPaiId === null).slice(0, OPCOES_DE_TAREFA);

/** "Trabalho · 50 min", "15:00": a etiqueta e a estimativa, ou a hora marcada. */
export function metaDaTarefa(t: Tarefa): string {
  const quanto = t.duracaoEstimadaMin !== null ? duracaoCurta(t.duracaoEstimadaMin) : t.hora;
  return [t.etiquetas[0]?.nome, quanto].filter(Boolean).join(" · ");
}

const EVENTOS_HISTORICO: readonly NomeEvento[] = ["foco.mudou", "tarefas.mudou"];

/** O histórico e o relatório dos dias pedidos, relidos a cada mudança no foco e nas tarefas. */
export function useHistoricoFoco(canal: EstadoConexao, de: string, ate: string): HistoricoFoco | null {
  const pedir = useCallback(() => servico.pedir("foco.historico", { de, ate }), [de, ate]);
  return useRelida(canal, pedir, EVENTOS_HISTORICO);
}
