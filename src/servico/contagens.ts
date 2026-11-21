import type { ContagensAreas } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import type { RotuloContagem } from "../componentes/Selo.tsx";
import { servico } from "./conexao.ts";

/** Qual número de `areas.contagens` uma área mostra. */
export type CampoContagem = keyof ContagensAreas;

/** Do que é cada número, para o leitor de tela ("4 tarefas pendentes"). */
export const ROTULOS_CONTAGEM: Readonly<Record<CampoContagem, RotuloContagem>> = {
  tarefasPendentes: { um: "tarefa pendente", varios: "tarefas pendentes" },
  lembretesAtrasados: { um: "lembrete atrasado", varios: "lembretes atrasados" },
  sessoesEsperando: { um: "sessão esperando você", varios: "sessões esperando você" },
  devPrecisando: { um: "aviso de dev", varios: "avisos de dev" },
};

export const SEM_CONTAGENS: ContagensAreas = {
  tarefasPendentes: 0,
  lembretesAtrasados: 0,
  sessoesEsperando: 0,
  devPrecisando: 0,
};

/**
 * As contagens das áreas (PRODUCT.md §4), contadas no serviço: a carga ao conectar
 * (`areas.contagens`) e a contagem nova a cada aviso do mesmo nome. A janela não soma nada, para o
 * dock e o Sistema mostrarem o mesmo. Sem conexão, ou com a carga recusada, tudo zero: zero não
 * desenha número.
 */
export function useContagens(canal: EstadoConexao): ContagensAreas {
  const [contagens, setContagens] = useState<ContagensAreas>(SEM_CONTAGENS);

  useEffect(() => servico.ouvir("areas.contagens", setContagens), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("areas.contagens")
      .then((carga) => {
        if (vivo) setContagens(carga);
      })
      .catch(() => {
        if (vivo) setContagens(SEM_CONTAGENS);
      });
    return () => {
      vivo = false;
      setContagens(SEM_CONTAGENS);
    };
  }, [canal]);

  return canal === "conectado" ? contagens : SEM_CONTAGENS;
}
