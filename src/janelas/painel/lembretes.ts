import type { Ausencia, Lembrete, Tarefa } from "@moductus/contrato";
import { DADOS_AGENTES, eAgente } from "../../componentes/personagem/agentes.ts";
import { diaCurto, duracao, horaNoFuso } from "./dia.ts";

/**
 * O lembrete no painel Hoje (LembreteHoje.dc.html; DESIGN.md §5 "Lembrete"): chegando, tocando e
 * os atrasados juntos. Quem põe cada um no grupo é o relógio do dia no serviço (`lembretes.hoje`);
 * aqui só o texto de cada linha.
 */

/** A hora em que ele toca agora: a do adiamento, se foi adiado. */
export const horaDoLembrete = (l: Lembrete): string => l.adiadoAte ?? l.quando;

/** A tarefa do lembrete, entre as que o painel já leu. */
export function tarefaDoLembrete(l: Lembrete, tarefas: readonly Tarefa[]): Tarefa | null {
  return l.tarefaId === null ? null : (tarefas.find((t) => t.id === l.tarefaId) ?? null);
}

/** "lembrete às 14:45 · tarefa às 15:00", embaixo do que está chegando. */
export function linhaDoChegando(l: Lembrete, tarefa: Tarefa | null, fuso: string): string {
  const lembrete = `lembrete às ${horaNoFuso(horaDoLembrete(l), fuso)}`;
  return tarefa?.hora ? `${lembrete} · tarefa às ${tarefa.hora}` : lembrete;
}

/** Quem criou, como o padrão "Origem" escreve: "você" ou o nome do agente. */
function quemCriou(l: Lembrete): string | null {
  if (l.origem === "usuario") return "você";
  if (l.origem === "agente" && l.agenteId !== null && eAgente(l.agenteId))
    return DADOS_AGENTES[l.agenteId].nome;
  return null;
}

/**
 * A linha de baixo do lembrete tocando: de onde ele vem ("Tarefa de hoje às 15:00") e quem o
 * criou ("você"), como no aviso do Windows.
 */
export function contextoDoTocando(l: Lembrete, tarefa: Tarefa | null, hoje: string): string | null {
  const partes: string[] = [];
  if (tarefa !== null) {
    const dia =
      tarefa.venceEm === null ? "" : tarefa.venceEm === hoje ? " de hoje" : ` de ${diaCurto(tarefa.venceEm)}`;
    partes.push(`Tarefa${dia}${tarefa.hora ? ` às ${tarefa.hora}` : ""}`);
  }
  const quem = quemCriou(l);
  if (quem) partes.push(quem);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** "PC suspenso 14:20–16:05", no alto do cartão dos atrasados. */
export function metaDaAusencia(ausencia: Ausencia, fuso: string): string {
  return `PC suspenso ${horaNoFuso(ausencia.de, fuso)}–${horaNoFuso(ausencia.ate, fuso)}`;
}

/**
 * A fala da Alba no cartão dos atrasados: o tamanho da ausência e quantos passaram, e que eles
 * esperam a sua decisão. Sem ausência (o serviço não soube dizer quando), só quantos passaram.
 */
export function falaDosAtrasados(n: number, ausencia: Ausencia | null): string {
  const quantos = n === 1 ? "1 lembrete passou" : `${n} lembretes passaram`;
  const esperam = n === 1 ? "Segue aqui até você decidir." : "Seguem aqui até você decidir.";
  if (ausencia === null) return `${quantos} da hora. ${esperam}`;
  const tempo = duracao(Date.parse(ausencia.ate) - Date.parse(ausencia.de));
  return `O PC ficou suspenso por ${tempo} e ${quantos} nesse tempo. ${esperam}`;
}

/** Os botões do grupo, verbo com objeto: "Adiar os 2 em 30 min", "Concluir os 2". */
export function acoesDosAtrasados(n: number, minutos: number): { adiar: string; concluir: string } {
  return n === 1
    ? { adiar: `Adiar ${minutos} min`, concluir: "Concluir o lembrete" }
    : { adiar: `Adiar os ${n} em ${minutos} min`, concluir: `Concluir os ${n}` };
}
