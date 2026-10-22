import type {
  BlocoLivre,
  DiaDaAgenda,
  EstadoConfig,
  NomeEvento,
  SugestaoEncaixe,
  Tarefa,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useState } from "react";
import { diaLocal } from "../../areas/tempo.ts";
import { servico } from "../../servico/conexao.ts";
import { horaFalada } from "../../servico/foco.ts";
import { useCarga, type Ouvinte } from "./dados.ts";

/**
 * O que o painel Foco (PainelFoco.dc.html) lê além do próprio foco: as tarefas de hoje, para o
 * "Depois deste", e o dia da agenda, para a sugestão da Alba do próximo bloco livre. Quem acha o
 * bloco e encaixa a tarefa é o serviço (`agenda.consultar`, F3-16); aqui só se escolhe qual mostrar.
 */

/** Quantas tarefas o "Depois deste" mostra. */
export const TAREFAS_DEPOIS = 3;

/**
 * As próximas tarefas do dia: as abertas que vieram de antes e as de hoje, sem a que está no foco
 * e sem subtarefa (ela aparece pela mãe), na ordem do serviço.
 */
export function depoisDeste(tarefas: readonly Tarefa[], atualId: string | null): Tarefa[] {
  return tarefas
    .filter((t) => t.estado === "aberta" && t.tarefaPaiId === null && t.id !== atualId)
    .slice(0, TAREFAS_DEPOIS);
}

/** Uma sugestão de encaixe com o bloco livre em que ela cai e o título da tarefa. */
export interface Encaixe {
  sugestao: SugestaoEncaixe;
  bloco: BlocoLivre;
  titulo: string;
}

/** Identifica a sugestão recusada ("Não"): a mesma tarefa no mesmo horário não volta. */
export const chaveDoEncaixe = (s: SugestaoEncaixe) => `${s.tarefaId}@${s.inicio}`;

/**
 * A primeira sugestão do dia que ainda vale mostrar: não é para a tarefa do foco, não foi
 * recusada e a tarefa é conhecida. O bloco é o livre que contém o início dela.
 */
export function proximoEncaixe(
  dia: DiaDaAgenda | null,
  tarefas: readonly Tarefa[],
  atualId: string | null,
  recusados: ReadonlySet<string>,
): Encaixe | null {
  if (!dia) return null;
  for (const sugestao of dia.sugestoes) {
    if (sugestao.tarefaId === atualId || recusados.has(chaveDoEncaixe(sugestao))) continue;
    const tarefa = tarefas.find((t) => t.id === sugestao.tarefaId && t.estado === "aberta");
    const inicio = Date.parse(sugestao.inicio);
    const bloco = dia.livres.find((b) => Date.parse(b.inicio) <= inicio && inicio < Date.parse(b.fim));
    if (tarefa && bloco) return { sugestao, bloco, titulo: tarefa.titulo };
  }
  return null;
}

/**
 * A fala da Alba (até duas frases): o bloco livre e o que ela guarda nele. Quando a tarefa ocupa o
 * bloco inteiro, "Guardo ele"; quando ocupa só um pedaço, ela diz o pedaço, para o "Guardar bloco"
 * não prometer mais do que cria.
 */
export function falaDoEncaixe({ sugestao, bloco, titulo }: Encaixe): string {
  const livre = `Seu próximo bloco livre é das ${horaFalada(bloco.inicio)} às ${horaFalada(bloco.fim)}.`;
  const inteiro = sugestao.inicio === bloco.inicio && sugestao.fim === bloco.fim;
  const quanto = inteiro
    ? "Guardo ele"
    : `Guardo das ${horaFalada(sugestao.inicio)} às ${horaFalada(sugestao.fim)}`;
  return `${livre} ${quanto} para “${titulo}”?`;
}

/** O dia `AAAA-MM-DD` de um instante no fuso do usuário; sem fuso conhecido, o do PC. */
export function diaNoFuso(agora: Date, fuso: string | null): string {
  if (!fuso) return diaLocal(agora);
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(agora);
    const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
    return `${parte("year")}-${parte("month")}-${parte("day")}`;
  } catch {
    return diaLocal(agora);
  }
}

/**
 * Uma leitura que se refaz inteira a cada aviso de `eventos` (e a cada `chave` nova): para as
 * tarefas e a agenda, onde a mudança pode tirar ou pôr um item no recorte e só o serviço sabe.
 * Sem conexão, ou com o pedido recusado, `null`. `pedir` e `eventos` precisam ser estáveis.
 */
export function useRelida<T>(
  canal: EstadoConexao,
  pedir: () => Promise<T>,
  eventos: readonly NomeEvento[],
  chave?: unknown,
): T | null {
  const [versao, setVersao] = useState(0);
  const [valor, setValor] = useState<T | null>(null);

  useEffect(() => {
    const paradas = eventos.map((nome) => servico.ouvir(nome, () => setVersao((v) => v + 1)));
    return () => paradas.forEach((parar) => parar());
  }, [eventos]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    pedir()
      .then((lido) => {
        if (vivo) setValor(lido);
      })
      .catch(() => {
        if (vivo) setValor(null);
      });
    return () => {
      vivo = false;
    };
  }, [canal, pedir, versao, chave]);

  return canal === "conectado" ? valor : null;
}

const EVENTOS_TAREFAS: readonly NomeEvento[] = ["tarefas.mudou"];
const EVENTOS_AGENDA: readonly NomeEvento[] = ["agenda.mudou", "agenda.calendarios", "tarefas.mudou"];

const pedirTarefas = () =>
  Promise.all([
    servico.pedir("tarefas.listar", { vista: "atrasadas" }),
    servico.pedir("tarefas.listar", { vista: "hoje" }),
  ]).then(([atrasadas, hoje]) => [...atrasadas, ...hoje]);

/** As abertas de antes e as de hoje, relidas a cada mudança nas tarefas e a cada abertura. */
export const useTarefasDoFoco = (canal: EstadoConexao, abertura: unknown) =>
  useRelida(canal, pedirTarefas, EVENTOS_TAREFAS, abertura);

/** O dia de hoje da agenda, com os blocos livres e as sugestões, relido a cada mudança. */
export function useDiaDaAgenda(canal: EstadoConexao, dia: string, abertura: unknown): DiaDaAgenda | null {
  const pedir = useCallback(
    () => servico.pedir("agenda.consultar", { de: dia, ate: dia }).then((a) => a.dias[0] ?? null),
    [dia],
  );
  return useRelida(canal, pedir, EVENTOS_AGENDA, abertura) ?? null;
}

const pedirConfig = () => servico.pedir("config.obter");
const ouvirConfig: Ouvinte<EstadoConfig> = (aplicar) =>
  servico.ouvir("config.mudou", (estado) => aplicar(() => estado));

/** O atalho do foco, o silêncio durante o foco, o fuso e os ciclos, como estão configurados. */
export const useConfigDoFoco = (canal: EstadoConexao) => useCarga(canal, pedirConfig, ouvirConfig);
