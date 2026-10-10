import type { Agente, Aprovacao, Execucao, Provedor } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useRef, useState } from "react";
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
