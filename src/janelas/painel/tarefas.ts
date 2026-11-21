import {
  LISTA_ENTRADA,
  type Lista,
  type PreviaCaptura,
  type Tarefa,
  type TipoCaptura,
} from "@moductus/contrato";
import { diaCurto, diaPassado, horaDosMinutos, minutosDaHora } from "./dia.ts";

/**
 * As tarefas nos painéis Hoje e Tarefas (PainelTarefas.dc.html, LembreteHoje.dc.html). Quem decide
 * o que é de hoje e o que está atrasado é o serviço (`tarefas.listar` com a vista); aqui só a ordem
 * na tela e o que cada linha escreve.
 */

/** Quantas linhas de tarefa cabem no Hoje, com o lembrete, o foco e a captura em volta. */
export const LINHAS_NO_HOJE = 4;

/** Só as tarefas de cima: a subtarefa aparece dentro da mãe, na área Tarefas. */
export const deCima = (tarefas: readonly Tarefa[]) => tarefas.filter((t) => t.tarefaPaiId === null);

/**
 * A ordem do dia: as com hora primeiro, pela hora; depois as sem hora, na ordem do serviço. A feita
 * fica no lugar dela, apagada e riscada.
 */
export function ordemDoDia(tarefas: readonly Tarefa[]): Tarefa[] {
  return tarefas
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ha = a.t.hora === null ? Infinity : minutosDaHora(a.t.hora);
      const hb = b.t.hora === null ? Infinity : minutosDaHora(b.t.hora);
      return ha - hb || a.i - b.i;
    })
    .map(({ t }) => t);
}

/** "2 de 6 feitas": as feitas e o total do dia, sem as canceladas. */
export function feitasDoDia(tarefas: readonly Tarefa[]): { feitas: number; total: number } {
  const validas = tarefas.filter((t) => t.estado !== "cancelada");
  return { feitas: validas.filter((t) => t.estado === "feita").length, total: validas.length };
}

/**
 * As linhas do Hoje: as atrasadas primeiro, depois as de hoje na ordem do dia. Sobrando linha
 * demais, saem primeiro as feitas mais cedo (o quadro tira a Daily, já feita); `fora` é quantas
 * ficaram só na área Tarefas.
 */
export function linhasDoHoje(
  atrasadas: readonly Tarefa[],
  hoje: readonly Tarefa[],
  limite = LINHAS_NO_HOJE,
): { linhas: Tarefa[]; fora: number } {
  const todas = [...deCima(atrasadas), ...ordemDoDia(deCima(hoje).filter((t) => t.estado !== "cancelada"))];
  const sobra = todas.length - limite;
  if (sobra <= 0) return { linhas: todas, fora: 0 };
  const sair = new Set(
    todas
      .filter((t) => t.estado === "feita")
      .slice(0, sobra)
      .map((t) => t.id),
  );
  const linhas = todas.filter((t) => !sair.has(t.id)).slice(0, limite);
  return { linhas, fora: todas.length - linhas.length };
}

/** A prioridade na barrinha à esquerda; o texto vai junto para o leitor de tela. */
export function prioridadeDa(tarefa: Tarefa): { tom: "perigo" | "aviso"; texto: string } | null {
  if (tarefa.prioridade >= 3) return { tom: "perigo", texto: "prioridade alta" };
  if (tarefa.prioridade === 2) return { tom: "aviso", texto: "prioridade média" };
  return null;
}

/** "repete todo mês", da regra que o serviço guarda; regra que não é simples diz só "repete". */
export function textoDaRecorrencia(regra: string): string {
  const campos = new Map(
    regra
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((par) => par.split("=") as [string, string | undefined])
      .map(([chave, valor]) => [chave.trim().toUpperCase(), (valor ?? "").trim().toUpperCase()]),
  );
  const freq = campos.get("FREQ");
  const dias = campos.get("BYDAY");
  const intervalo = campos.get("INTERVAL");
  if (intervalo !== undefined && intervalo !== "1") return "repete";
  if (freq === "WEEKLY" && dias === "MO,TU,WE,TH,FR") return "repete em dias úteis";
  // Mais de um dia na semana, ou dia da semana fora da semanal: a frase curta não diz direito.
  if (dias !== undefined && (freq !== "WEEKLY" || dias.includes(","))) return "repete";
  switch (freq) {
    case "DAILY":
      return "repete todo dia";
    case "WEEKLY":
      return "repete toda semana";
    case "MONTHLY":
      return "repete todo mês";
    case "YEARLY":
      return "repete todo ano";
    default:
      return "repete";
  }
}

/** A hora do lembrete de uma tarefa com hora: "lembrete 14:45", ou no dia anterior. */
export function lembreteDaTarefa(hora: string, minutosAntes: number): string {
  const minutos = minutosDaHora(hora) - minutosAntes;
  return minutos >= 0 ? `lembrete ${horaDosMinutos(minutos)}` : "lembrete no dia anterior";
}

/**
 * A linha de baixo da tarefa (PainelTarefas.dc.html): a lista (a Entrada não, que é onde tudo
 * cai), o lembrete e a repetição. Nada a dizer, nada aparece.
 */
export function notaDaTarefa(tarefa: Tarefa, listas: readonly Lista[] | null): string | null {
  const partes: string[] = [];
  if (tarefa.listaId !== LISTA_ENTRADA) {
    const lista = listas?.find((l) => l.id === tarefa.listaId);
    if (lista) partes.push(lista.nome);
  }
  if (tarefa.hora !== null && tarefa.lembreteMinutosAntes !== null) {
    partes.push(lembreteDaTarefa(tarefa.hora, tarefa.lembreteMinutosAntes));
  }
  if (tarefa.recorrencia !== null) partes.push(textoDaRecorrencia(tarefa.recorrencia));
  return partes.length > 0 ? partes.join(" · ") : null;
}

/**
 * O que vai na coluna da direita: a hora da de hoje, o dia da atrasada. `aviso` marca a atrasada
 * e a aberta de hoje cuja hora já passou (LembreteHoje.dc.html, depois da suspensão).
 */
export function quandoDaTarefa(
  tarefa: Tarefa,
  hoje: string,
  minutoAgora: number,
): { texto: string; aviso: boolean } {
  const aberta = tarefa.estado === "aberta";
  if (tarefa.venceEm !== null && tarefa.venceEm < hoje) {
    return { texto: diaPassado(tarefa.venceEm, hoje), aviso: aberta };
  }
  if (tarefa.hora === null) return { texto: "", aviso: false };
  return {
    texto: tarefa.hora,
    aviso: aberta && tarefa.venceEm === hoje && minutosDaHora(tarefa.hora) < minutoAgora,
  };
}

/** O nome do tipo na prévia ("Entendi: tarefa"). */
export const NOME_DO_TIPO: Readonly<Record<TipoCaptura, string>> = {
  tarefa: "tarefa",
  lembrete: "lembrete",
  evento: "evento",
  nota: "nota",
  gasto: "gasto",
  memoria: "memória",
};

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Os chips do "Entendi:" (PainelTarefas.dc.html): o tipo e o que a frase deu, na ordem do quadro
 * (tipo, dia, hora, lembrete). O que a frase não disse não aparece.
 */
export function chipsDaPrevia(previa: PreviaCaptura): string[] {
  const { campos } = previa;
  const chips = [NOME_DO_TIPO[previa.tipo]];
  if (campos.dia !== null) chips.push(diaCurto(campos.dia));
  if (campos.hora !== null) chips.push(campos.hora);
  if (campos.duracaoMin !== null) chips.push(`${campos.duracaoMin} min`);
  if (campos.recorrencia !== null) chips.push(textoDaRecorrencia(campos.recorrencia));
  if (previa.tipo !== "lembrete" && campos.hora !== null && campos.lembreteMinutosAntes !== null) {
    chips.push(lembreteDaTarefa(campos.hora, campos.lembreteMinutosAntes));
  }
  if (previa.tipo === "gasto" && campos.valorCentavos !== null) {
    chips.push(reais.format(campos.valorCentavos / 100));
  }
  return chips;
}
