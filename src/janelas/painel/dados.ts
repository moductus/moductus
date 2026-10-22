import type {
  Agente,
  Aprovacao,
  EstadoFoco,
  Execucao,
  LembretesDeHoje,
  Lista,
  Provedor,
  Tarefa,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Leitura } from "../../areas/leitura.ts";
import { juntarAprovacao } from "../../servico/aprovacoes.ts";
import { servico } from "../../servico/conexao.ts";

/** Uma mudança que um aviso do canal faz no que foi lido. */
export type Mudanca<T> = (atual: T) => T;

/** Liga os avisos do canal a quem aplica a mudança; devolve como parar de ouvir. */
export type Ouvinte<T> = (aplicar: (mudar: Mudanca<T>) => void) => () => void;

/**
 * Uma leitura do serviço para o painel: a carga ao conectar (e a cada `recarregar`, quando o
 * painel abre de novo) e cada aviso depois. Aviso que chega com a carga a caminho é aplicado de
 * novo sobre ela, para a resposta mais antiga não apagá-lo. Sem conexão, ou com a carga recusada,
 * fica `null`: o painel diz que não sabe em vez de mostrar o que já não vale. `pedir` e `ouvir`
 * precisam ser estáveis (funções de módulo).
 */
export function useCarga<T>(
  canal: EstadoConexao,
  pedir: () => Promise<T>,
  ouvir: Ouvinte<T>,
  recarregar?: unknown,
): T | null {
  const [valor, setValor] = useState<T | null>(null);
  const durante = useRef<Mudanca<T>[] | null>(null);

  useEffect(
    () =>
      ouvir((mudar) => {
        durante.current?.push(mudar);
        setValor((atual) => (atual === null ? atual : mudar(atual)));
      }),
    [ouvir],
  );

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    const mudancas: Mudanca<T>[] = [];
    durante.current = mudancas;
    pedir()
      .then((carga) => {
        if (vivo) setValor(mudancas.reduce((v, mudar) => mudar(v), carga));
      })
      .catch(() => {
        if (vivo) setValor(null);
      })
      .finally(() => {
        if (durante.current === mudancas) durante.current = null;
      });
    return () => {
      vivo = false;
      if (durante.current === mudancas) durante.current = null;
    };
  }, [canal, pedir, recarregar]);

  return canal === "conectado" ? valor : null;
}

/** Troca o agente que mudou na lista; agente novo entra no fim. */
export function juntarAgente(lista: readonly Agente[], agente: Agente): Agente[] {
  return lista.some((a) => a.id === agente.id)
    ? lista.map((a) => (a.id === agente.id ? agente : a))
    : [...lista, agente];
}

/** A execução que mudou troca de lugar com a antiga e vai ao topo (a lista é da mais nova). */
export function juntarExecucao(lista: readonly Execucao[], execucao: Execucao): Execucao[] {
  return [execucao, ...lista.filter((e) => e.id !== execucao.id)];
}

/** Quantas execuções o painel lê: o bastante para achar a última de cada um dos quatro. */
export const EXECUCOES_DO_PAINEL = 40;

const pedirAgentes = () => servico.pedir("agentes.listar");
const ouvirAgentes: Ouvinte<Agente[]> = (aplicar) =>
  servico.ouvir("agentes.mudou", (agente) => aplicar((lista) => juntarAgente(lista, agente)));

const pedirProvedores = () => servico.pedir("provedores.listar");
const ouvirProvedores: Ouvinte<Provedor[]> = (aplicar) =>
  servico.ouvir("provedores.mudou", (lista) => aplicar(() => lista));

const pedirExecucoes = () =>
  servico.pedir("execucoes.listar", { limite: EXECUCOES_DO_PAINEL }).then((pagina) => pagina.itens);
const ouvirExecucoes: Ouvinte<Execucao[]> = (aplicar) =>
  servico.ouvir("execucoes.mudou", (execucao) => aplicar((lista) => juntarExecucao(lista, execucao)));

const pedirPedidosDosAgentes = () =>
  servico.pedir("aprovacoes.pendentes").then((lista) => lista.filter((a) => a.fonte === "moductus"));
const ouvirPedidosDosAgentes: Ouvinte<Aprovacao[]> = (aplicar) =>
  servico.ouvir("aprovacoes.mudou", (aprovacao) => {
    if (aprovacao.fonte === "moductus") aplicar((lista) => juntarAprovacao(lista, aprovacao));
  });

const pedirAtalho = () => servico.pedir("config.obter").then((estado) => estado.config.atalhos.sistema);
const ouvirAtalho: Ouvinte<string> = (aplicar) =>
  servico.ouvir("config.mudou", (estado) => aplicar(() => estado.config.atalhos.sistema));

/** O atalho que abre o Sistema, como você configurou (Configurações › Atalhos). */
export const useAtalhoDoSistema = (canal: EstadoConexao) => useCarga(canal, pedirAtalho, ouvirAtalho);

/** O time como o serviço guarda: configuração (o modelo de cada um) e a situação do runtime. */
export const useAgentes = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirAgentes, ouvirAgentes, recarregar);

/** Os modelos conectados, para dizer com qual o time trabalha e de qual o limite acabou. */
export const useProvedores = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirProvedores, ouvirProvedores, recarregar);

/** As execuções mais recentes do time, da mais nova para a mais antiga. */
export const useExecucoes = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirExecucoes, ouvirExecucoes, recarregar);

/** Os pedidos de aprovação dos agentes do Moductus (os do terminal vêm de `usePedidosDoTerminal`). */
export const usePedidosDosAgentes = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirPedidosDosAgentes, ouvirPedidosDosAgentes, recarregar);

// ---------- O dia: painéis Hoje e Tarefas ----------

/**
 * Uma leitura que o serviço refaz inteira a cada aviso (`tarefas.mudou` não diz em que vista a
 * tarefa caiu: quem sabe o que é "hoje" é o serviço). Cada aviso e cada `recarregar` pede de novo;
 * a resposta de um pedido que já foi superado é descartada. Falhou, diz isso e oferece tentar de
 * novo, em vez de mostrar o que já não vale. `pedir` precisa ser estável.
 */
export function useRelida<T>(
  canal: EstadoConexao,
  pedir: () => Promise<T>,
  aviso: "tarefas.mudou" | "lembretes.mudou",
  recarregar?: unknown,
): Leitura<T> {
  const [lido, setLido] = useState<{ ok: true; dados: T } | { ok: false } | null>(null);
  const [vez, setVez] = useState(0);
  const tentarDeNovo = useCallback(() => setVez((v) => v + 1), []);

  useEffect(() => servico.ouvir(aviso, () => setVez((v) => v + 1)), [aviso]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    pedir()
      .then((dados) => {
        if (vivo) setLido({ ok: true, dados });
      })
      .catch(() => {
        if (vivo) setLido({ ok: false });
      });
    return () => {
      vivo = false;
    };
  }, [canal, pedir, recarregar, vez]);

  if (canal !== "conectado" || lido === null) return { estado: "esperando" };
  return lido.ok ? { estado: "pronta", dados: lido.dados } : { estado: "falhou", tentarDeNovo };
}

/** Junta duas leituras: falhou se uma falhou (tentar de novo refaz as duas), pronta se as duas. */
export function juntarLeituras<A, B>(a: Leitura<A>, b: Leitura<B>): Leitura<[A, B]> {
  if (a.estado === "falhou" || b.estado === "falhou") {
    return {
      estado: "falhou",
      tentarDeNovo: () => {
        if (a.estado === "falhou") a.tentarDeNovo();
        if (b.estado === "falhou") b.tentarDeNovo();
      },
    };
  }
  if (a.estado === "esperando" || b.estado === "esperando") return { estado: "esperando" };
  return { estado: "pronta", dados: [a.dados, b.dados] };
}

const pedirFuso = () => servico.pedir("config.obter").then((estado) => estado.config.dia.fuso);
const ouvirFuso: Ouvinte<string> = (aplicar) =>
  servico.ouvir("config.mudou", (estado) => aplicar(() => estado.config.dia.fuso));

/** O fuso em que "hoje" é contado (Configurações › O dia); `null` até a configuração chegar. */
export const useFuso = (canal: EstadoConexao) => useCarga(canal, pedirFuso, ouvirFuso);

const pedirLembretesDeHoje = () => servico.pedir("lembretes.hoje");
const ouvirLembretesDeHoje: Ouvinte<LembretesDeHoje> = (aplicar) =>
  servico.ouvir("lembretes.hoje", (hoje) => aplicar(() => hoje));

/** O lembrete do Hoje: o que está chegando, os que tocam e os atrasados, como o relógio decidiu. */
export const useLembretesDeHoje = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirLembretesDeHoje, ouvirLembretesDeHoje, recarregar);

const pedirFoco = () => servico.pedir("foco.obter");
const ouvirFoco: Ouvinte<EstadoFoco> = (aplicar) =>
  servico.ouvir("foco.mudou", (foco) => aplicar(() => foco));

/** O foco agora: a etapa em andamento (ou nenhuma), o ciclo e o que vem depois. */
export const useFoco = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirFoco, ouvirFoco, recarregar);

const pedirListas = () => servico.pedir("listas.listar");
const ouvirListas: Ouvinte<Lista[]> = (aplicar) =>
  servico.ouvir("listas.mudou", (listas) => aplicar(() => listas));

/** As listas, para a linha de baixo da tarefa dizer de qual ela é. */
export const useListas = (canal: EstadoConexao, recarregar?: unknown) =>
  useCarga(canal, pedirListas, ouvirListas, recarregar);

const pedirHoje = () => servico.pedir("tarefas.listar", { vista: "hoje" });
const pedirAtrasadas = () => servico.pedir("tarefas.listar", { vista: "atrasadas" });
const pedirProximas = () => servico.pedir("tarefas.listar", { vista: "proximas" });

/**
 * As tarefas de hoje (abertas e feitas hoje) e as atrasadas, relidas a cada mudança e na virada do
 * dia (`dia` entra no `recarregar`).
 */
export function useTarefasDoDia(
  canal: EstadoConexao,
  dia: string,
  recarregar?: unknown,
): Leitura<{ hoje: Tarefa[]; atrasadas: Tarefa[] }> {
  const chave = `${dia}|${String(recarregar)}`;
  const leitura = juntarLeituras(
    useRelida(canal, pedirHoje, "tarefas.mudou", chave),
    useRelida(canal, pedirAtrasadas, "tarefas.mudou", chave),
  );
  return leitura.estado === "pronta"
    ? { estado: "pronta", dados: { hoje: leitura.dados[0], atrasadas: leitura.dados[1] } }
    : leitura;
}

/** As abertas de amanhã em diante ("Próximos 7 dias" no pé do painel Tarefas). */
export const useProximas = (canal: EstadoConexao, dia: string, recarregar?: unknown) =>
  useRelida(canal, pedirProximas, "tarefas.mudou", `${dia}|${String(recarregar)}`);
