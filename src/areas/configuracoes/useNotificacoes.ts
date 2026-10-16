import type { EstadoNotificacoes, MudancaPreferencia } from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";

export interface NotificacoesDaSecao {
  /** Null até o serviço responder. */
  estado: EstadoNotificacoes | null;
  conectado: boolean;
  /** Motivo da última recusa do serviço, como veio; some no próximo envio. */
  erro: string | null;
  /** Manda a preferência de um agente; quem valida e grava é o serviço. */
  definir: (mudanca: MudancaPreferencia) => Promise<boolean>;
}

/** As preferências de aviso no serviço, acompanhando `notificacoes.mudou` de qualquer janela. */
export function useNotificacoes(): NotificacoesDaSecao {
  const canal = useCanal(useServico({ silencioso: true }));
  const [estado, setEstado] = useState<EstadoNotificacoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => servico.ouvir("notificacoes.mudou", setEstado), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("notificacoes.obter")
      .then(setEstado)
      .catch(() => undefined);
  }, [canal]);

  const definir = useCallback(async (mudanca: MudancaPreferencia) => {
    setErro(null);
    try {
      setEstado(await servico.pedir("notificacoes.definir", mudanca));
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  return { estado, conectado: canal === "conectado", erro, definir };
}
