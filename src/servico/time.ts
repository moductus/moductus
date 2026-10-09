import type { Agente as AgenteServico, SituacaoAgente } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { eAgente, type Agente } from "../componentes/personagem/agentes.ts";
import { servico } from "./conexao.ts";

/** O que o runtime diz de cada agente do time; quem não veio fica de fora. */
export type SituacaoTime = Partial<Record<Agente, SituacaoAgente>>;

const SEM_NOTICIA: SituacaoTime = {};

/** Junta agentes do serviço ao que já se sabia; agente fora do time de fábrica fica de fora. */
export function juntarSituacoes(atual: SituacaoTime, agentes: readonly AgenteServico[]): SituacaoTime {
  const proximo = { ...atual };
  for (const a of agentes) if (eAgente(a.id)) proximo[a.id] = a.situacao;
  return proximo;
}

/**
 * A situação real do time, pelo canal: a lista ao conectar (`agentes.listar`) e cada mudança
 * depois (`agentes.mudou`). Sem conexão, ou com o serviço ainda sem resposta para o método, fica
 * vazia e quem mostra cai no time dormindo da fase 1: sem serviço, nenhum agente trabalha.
 */
export function useSituacaoTime(canal: EstadoConexao): SituacaoTime {
  const [time, setTime] = useState<SituacaoTime>(SEM_NOTICIA);

  useEffect(() => servico.ouvir("agentes.mudou", (a) => setTime((t) => juntarSituacoes(t, [a]))), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    // A lista nova substitui o que ficou de uma conexão anterior.
    servico
      .pedir("agentes.listar")
      .then((agentes) => {
        if (vivo) setTime(juntarSituacoes(SEM_NOTICIA, agentes));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [canal]);

  return canal === "conectado" ? time : SEM_NOTICIA;
}
