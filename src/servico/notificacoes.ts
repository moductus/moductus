import type { Notificacao } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { eAgente, type Agente } from "../componentes/personagem/agentes.ts";
import { servico } from "./conexao.ts";

/** Quantos avisos ainda não vistos cada agente do time tem; quem não tem fica de fora. */
export type PontosTime = Partial<Record<Agente, number>>;

const SEM_PONTOS: PontosTime = {};

/** Conta os avisos não vistos por agente; aviso sem agente ou de fora do time não vira ponto. */
export function contarPontos(naoVistas: readonly Notificacao[]): PontosTime {
  const pontos: PontosTime = {};
  for (const n of naoVistas) {
    if (n.agenteId && eAgente(n.agenteId)) pontos[n.agenteId] = (pontos[n.agenteId] ?? 0) + 1;
  }
  return pontos;
}

/**
 * O ponto de cada agente no dock (PRODUCT.md §4 "Avisos"): os avisos não vistos ao conectar
 * (`notificacoes.naoVistas`) e a lista nova a cada mudança. Sem conexão, nenhum ponto.
 */
export function usePontosTime(canal: EstadoConexao): PontosTime {
  const [pontos, setPontos] = useState<PontosTime>(SEM_PONTOS);

  useEffect(() => servico.ouvir("notificacoes.naoVistas", (lista) => setPontos(contarPontos(lista))), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("notificacoes.naoVistas")
      .then((lista) => {
        if (vivo) setPontos(contarPontos(lista));
      })
      .catch(() => {
        if (vivo) setPontos(SEM_PONTOS);
      });
    return () => {
      vivo = false;
      setPontos(SEM_PONTOS);
    };
  }, [canal]);

  return canal === "conectado" ? pontos : SEM_PONTOS;
}

/** Abrir o time tira o ponto do agente: o que ele tinha para você já está à vista. */
export function marcarVistasDe(agente: Agente): void {
  servico.pedir("notificacoes.marcarVistas", { agenteId: agente }).catch(() => undefined);
}
