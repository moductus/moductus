import type { Calendario, EventoAgenda, MudancaTarefas, Origem, Tarefa } from "@moductus/contrato";
import { RecusaDoServico, type EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { DADOS_AGENTES, eAgente, type Agente } from "../../componentes/personagem/agentes.ts";
import { servico } from "../../servico/conexao.ts";
import { noGenero } from "../agentes/nomes.ts";
import {
  diasEntre,
  formatarAntes,
  formatarDia,
  formatarMinutos,
  formatarRepeticao,
  instanteNoFuso,
  relogioNoFuso,
  somarDias,
} from "../dia.ts";

/**
 * O detalhe de uma tarefa ou de um evento, ao lado da lista (DetalheTarefa.dc.html,
 * DetalheEvento.dc.html): as opções de cada campo em texto, o quando do evento entre a tela e o
 * contrato, e a origem. Quem decide o lembrete que acompanha a hora e a próxima da recorrente é o
 * serviço; aqui só o que se mostra e o que se manda.
 */

/** O que está aberto ao lado da lista. */
export type Aberto = { tipo: "tarefa"; id: string } | { tipo: "evento"; id: string };

const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

// ---------- Origem ----------

/** "hoje, 09:12", "ontem, 18:12", "sex, 9 out, 20:05", no fuso do usuário. */
export function momentoCurto(instante: string, fuso: string | null, agora: Date): string {
  const { dia, hora } = relogioNoFuso(new Date(instante), fuso);
  const hoje = relogioNoFuso(agora, fuso).dia;
  if (dia === hoje) return `hoje, ${hora}`;
  if (dia === somarDias(hoje, -1)) return `ontem, ${hora}`;
  return `${formatarDia(dia, hoje)}, ${hora}`;
}

interface ComOrigem {
  origem: Origem;
  agenteId: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Quem fez a última coisa no item, pelo carimbo de origem (que é de quem escreveu por último): o
 * que ninguém mudou desde que nasceu é "Criada pela Alba"; o que mudou é "Mudada por você". O
 * gênero é o do item (a tarefa, o evento).
 */
export function origemDoItem(
  item: ComOrigem,
  genero: "a" | "o",
  fuso: string | null,
  agora: Date,
): { agente: Agente | null; quem: string; quando: string } {
  const criado = item.criadoEm === item.atualizadoEm;
  const verbo = `${criado ? "Criad" : "Mudad"}${genero}`;
  const agente = item.origem === "agente" && eAgente(item.agenteId) ? item.agenteId : null;
  const por = agente
    ? `${noGenero(agente, "pela", "pelo")} ${DADOS_AGENTES[agente].nome}`
    : item.origem === "agente"
      ? "por um agente"
      : item.origem === "importacao"
        ? "pela importação"
        : item.origem === "conexao"
          ? "por uma conexão"
          : "por você";
  return {
    agente,
    quem: `${verbo} ${por}`,
    quando: momentoCurto(criado ? item.criadoEm : item.atualizadoEm, fuso, agora),
  };
}

// ---------- Opções dos campos ----------

export interface Opcao {
  /** O valor no `<select>`: vazio é "nenhum". */
  valor: string;
  rotulo: string;
}

/** As estimativas que a lista oferece, em minutos (o quadro usa 50). */
export const DURACOES = [15, 25, 30, 45, 50, 60, 90, 120, 180, 240] as const;

export function opcoesDuracao(atual: number | null): Opcao[] {
  const minutos: number[] = [...DURACOES];
  if (atual !== null && !minutos.includes(atual)) minutos.push(atual);
  return [
    { valor: "", rotulo: "Sem estimativa" },
    ...minutos.sort((a, b) => a - b).map((m) => ({ valor: String(m), rotulo: formatarMinutos(m) })),
  ];
}

/** As repetições prontas; a regra que veio de fora aparece como ela é. */
export const REPETICOES: readonly Opcao[] = [
  { valor: "FREQ=DAILY", rotulo: "Todo dia" },
  { valor: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", rotulo: "Dias úteis" },
  { valor: "FREQ=WEEKLY", rotulo: "Toda semana" },
  { valor: "FREQ=MONTHLY", rotulo: "Todo mês" },
  { valor: "FREQ=YEARLY", rotulo: "Todo ano" },
];

const NAO_REPETE: Opcao = { valor: "", rotulo: "Não repete" };

/** A regra como as opções a escrevem: sem o "RRULE:", em maiúsculas. */
const regraNormal = (regra: string) =>
  regra
    .replace(/^RRULE:/i, "")
    .trim()
    .toUpperCase();

/** O valor da lista para a regra atual (vazio quando não repete). */
export function valorDaRepeticao(regra: string | null): string {
  if (regra === null) return "";
  const normal = regraNormal(regra);
  return REPETICOES.find((o) => o.valor === normal)?.valor ?? regra;
}

/** As repetições da lista, com a regra atual quando ela não é uma das prontas. */
export function opcoesRepeticao(regra: string | null): Opcao[] {
  const opcoes = [NAO_REPETE, ...REPETICOES];
  const valor = valorDaRepeticao(regra);
  if (regra !== null && !opcoes.some((o) => o.valor === valor)) {
    const curta = formatarRepeticao(regra);
    opcoes.push({ valor: regra, rotulo: curta === "repete" ? "Regra própria" : maiuscula(curta) });
  }
  return opcoes;
}

/** As antecedências do lembrete e dos alertas, em minutos (o quadro usa 15, 30 e 1 dia). */
export const ANTECEDENCIAS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

/** A hora `minutos` antes de `hora` no mesmo dia ("09:45"); `null` se cai no dia anterior. */
export function horaAntes(hora: string, minutos: number): string | null {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  const total = h * 60 + m - minutos;
  if (total < 0) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "15 min antes · 09:45", "Na hora · 10:00", "1 dia antes". */
export function rotuloDoLembrete(minutos: number, hora: string | null): string {
  const toca = hora === null ? null : horaAntes(hora, minutos);
  const antes = maiuscula(formatarAntes(minutos));
  return toca === null ? antes : `${antes} · ${toca}`;
}

export function opcoesLembrete(atual: number | null, hora: string | null): Opcao[] {
  const minutos: number[] = [...ANTECEDENCIAS];
  if (atual !== null && !minutos.includes(atual)) minutos.push(atual);
  return [
    { valor: "", rotulo: "Sem lembrete" },
    ...minutos.sort((a, b) => a - b).map((m) => ({ valor: String(m), rotulo: rotuloDoLembrete(m, hora) })),
  ];
}

/** Os alertas do evento na ordem do quadro: o mais cedo primeiro ("1 dia antes", "30 min antes"). */
export const alertasEmOrdem = (alertas: readonly number[]) => [...new Set(alertas)].sort((a, b) => b - a);

/** As antecedências que ainda dá para pôr no evento. */
export const alertasQueFaltam = (alertas: readonly number[]): number[] =>
  ANTECEDENCIAS.filter((m) => !alertas.includes(m));

/** Até cinco (contrato `Alertas`). */
export const MAXIMO_ALERTAS = 5;

// ---------- O quando do evento ----------

/** O quando como os campos da tela o mostram: no de dia inteiro, o fim é o último dia. */
export interface QuandoNaTela {
  diaInteiro: boolean;
  inicioDia: string;
  inicioHora: string;
  fimDia: string;
  fimHora: string;
}

type Quando = Pick<EventoAgenda, "inicio" | "fim" | "diaInteiro">;

export function quandoNaTela(e: Quando, fuso: string | null): QuandoNaTela {
  if (e.diaInteiro) {
    const ultimo = somarDias(e.fim, -1);
    return {
      diaInteiro: true,
      inicioDia: e.inicio,
      inicioHora: "",
      fimDia: ultimo < e.inicio ? e.inicio : ultimo,
      fimHora: "",
    };
  }
  const inicio = relogioNoFuso(new Date(e.inicio), fuso);
  const fim = relogioNoFuso(new Date(e.fim), fuso);
  return {
    diaInteiro: false,
    inicioDia: inicio.dia,
    inicioHora: inicio.hora,
    fimDia: fim.dia,
    fimHora: fim.hora,
  };
}

/**
 * O quando para o `agenda.definirEvento`: instantes no evento com hora, dias no de dia inteiro
 * (com o fim no dia seguinte ao último). `null` quando o fim vem antes do início.
 */
export function quandoParaGravar(q: QuandoNaTela, fuso: string | null): Quando | null {
  if (q.diaInteiro) {
    if (q.fimDia < q.inicioDia) return null;
    return { diaInteiro: true, inicio: q.inicioDia, fim: somarDias(q.fimDia, 1) };
  }
  const inicio = instanteNoFuso(q.inicioDia, q.inicioHora, fuso);
  const fim = instanteNoFuso(q.fimDia, q.fimHora, fuso);
  if (Date.parse(fim) < Date.parse(inicio)) return null;
  return { diaInteiro: false, inicio, fim };
}

/** Mudar o começo leva o fim junto: a duração fica como era. */
export function moverInicio(q: QuandoNaTela, dia: string, hora: string, fuso: string | null): QuandoNaTela {
  if (q.diaInteiro) {
    return { ...q, inicioDia: dia, fimDia: somarDias(dia, diasEntre(q.inicioDia, q.fimDia)) };
  }
  const duracao =
    Date.parse(instanteNoFuso(q.fimDia, q.fimHora, fuso)) -
    Date.parse(instanteNoFuso(q.inicioDia, q.inicioHora, fuso));
  const inicio = instanteNoFuso(dia, hora, fuso);
  const fim = relogioNoFuso(new Date(Date.parse(inicio) + Math.max(0, duracao)), fuso);
  return { ...q, inicioDia: dia, inicioHora: hora, fimDia: fim.dia, fimHora: fim.hora };
}

/** Quanto dura o evento que deixa de ser de dia inteiro. */
const MINUTOS_AO_TIRAR_DIA_INTEIRO = 60;

/**
 * Liga ou desliga o "Dia inteiro". Ligar fica com os dias (o fim à meia-noite é do dia anterior);
 * desligar vira uma hora no primeiro dia, começando em `horaPadrao` (o início do expediente).
 */
export function alternarDiaInteiro(q: QuandoNaTela, horaPadrao: string): QuandoNaTela {
  if (!q.diaInteiro) {
    const fimDia = q.fimHora === "00:00" && q.fimDia > q.inicioDia ? somarDias(q.fimDia, -1) : q.fimDia;
    return { diaInteiro: true, inicioDia: q.inicioDia, inicioHora: "", fimDia, fimHora: "" };
  }
  const [h = 0, m = 0] = horaPadrao.split(":").map(Number);
  const fim = h * 60 + m + MINUTOS_AO_TIRAR_DIA_INTEIRO;
  const noDia = fim % 1440;
  return {
    diaInteiro: false,
    inicioDia: q.inicioDia,
    inicioHora: horaPadrao,
    fimDia: fim >= 1440 ? somarDias(q.inicioDia, 1) : q.inicioDia,
    fimHora: `${String(Math.floor(noDia / 60)).padStart(2, "0")}:${String(noDia % 60).padStart(2, "0")}`,
  };
}

// ---------- Leitura ----------

/**
 * O mais novo dos dois retratos da mesma tarefa; `b` é o que chegou depois e vence o empate (duas
 * escritas no mesmo milissegundo).
 */
export function maisNova(a: Tarefa | null, b: Tarefa | null): Tarefa | null {
  if (!a) return b;
  if (!b) return a;
  return b.atualizadoEm >= a.atualizadoEm ? b : a;
}

/**
 * A tarefa aberta: o retrato da lista ou o último que chegou por `tarefas.mudou` ou pela resposta
 * de um pedido (a feita que saiu da vista continua aberta). `sumiu` quando ela foi para a lixeira.
 */
export function useTarefaAberta(id: string, daLista: Tarefa | null) {
  const [chegou, setChegou] = useState<Tarefa | null>(null);
  const [sumiu, setSumiu] = useState(false);
  useEffect(
    () =>
      servico.ouvir("tarefas.mudou", (m: MudancaTarefas) => {
        const nova = m.tarefas.find((t) => t.id === id);
        if (nova) setChegou((antes) => maisNova(antes, nova));
        if (m.apagadas.includes(id)) setSumiu(true);
      }),
    [id],
  );
  const recebida = (t: Tarefa) => {
    if (t.id === id) setChegou((antes) => maisNova(antes, t));
  };
  const tarefa = maisNova(daLista, chegou?.id === id ? chegou : null);
  return { tarefa: sumiu ? null : tarefa, recebida };
}

/** Os calendários, para a escolha do evento; `null` até chegarem. */
export function useCalendarios(canal: EstadoConexao): Calendario[] | null {
  const [calendarios, setCalendarios] = useState<Calendario[] | null>(null);
  useEffect(() => servico.ouvir("agenda.calendarios", setCalendarios), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("agenda.calendarios")
      .then((c) => {
        if (vivo) setCalendarios(c);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [canal]);
  return calendarios;
}

/** A mensagem do serviço quando o evento não existe mais (`MENSAGEM_EVENTO_NAO_ENCONTRADO`). */
export const EVENTO_SUMIU = "evento não encontrado";

export type LeituraEvento =
  | { estado: "esperando" }
  | { estado: "falhou"; tentarDeNovo: () => void }
  | { estado: "sumiu" }
  | { estado: "pronto"; evento: EventoAgenda };

/** O evento aberto, pelo `agenda.obterEvento`, e de novo a cada `agenda.mudou` que o traz. */
export function useEvento(canal: EstadoConexao, id: string) {
  const [evento, setEvento] = useState<EventoAgenda | null>(null);
  const [sumiu, setSumiu] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(
    () =>
      servico.ouvir("agenda.mudou", (m) => {
        const novo = m.eventos.find((e) => e.id === id);
        if (novo) setEvento(novo);
        if (m.apagados.includes(id)) setSumiu(true);
      }),
    [id],
  );
  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("agenda.obterEvento", { id })
      .then((e) => {
        if (!vivo) return;
        setFalhou(false);
        setEvento(e);
      })
      .catch((erro: unknown) => {
        if (!vivo) return;
        if (erro instanceof RecusaDoServico && erro.message === EVENTO_SUMIU) setSumiu(true);
        else setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [canal, id, versao]);
  const recebido = (e: EventoAgenda) => {
    if (e.id === id) setEvento(e);
  };
  const leitura: LeituraEvento = sumiu
    ? { estado: "sumiu" }
    : evento?.id === id
      ? { estado: "pronto", evento }
      : falhou
        ? { estado: "falhou", tentarDeNovo: () => setVersao((v) => v + 1) }
        : { estado: "esperando" };
  return { leitura, recebido };
}
