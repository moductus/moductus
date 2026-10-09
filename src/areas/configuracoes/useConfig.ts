import type { EstadoConfig, MudancaConfig } from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";

export interface ConfigDaSecao {
  /** Null até o serviço responder. */
  estado: EstadoConfig | null;
  conectado: boolean;
  /** Motivo da última recusa do serviço ou da casca, como veio; some no próximo envio. */
  erro: string | null;
  /** Manda só a chave que mudou; quem valida, grava e aplica é o serviço. */
  definir: (mudanca: MudancaConfig) => Promise<boolean>;
}

/** O estado da configuração no serviço, acompanhando `config.mudou` de qualquer janela. */
export function useConfig(): ConfigDaSecao {
  const canal = useCanal(useServico({ silencioso: true }));
  const [estado, setEstado] = useState<EstadoConfig | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => servico.ouvir("config.mudou", setEstado), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("config.obter")
      .then(setEstado)
      .catch(() => undefined);
  }, [canal]);

  const definir = useCallback(async (mudanca: MudancaConfig) => {
    setErro(null);
    try {
      setEstado(await servico.pedir("config.definir", mudanca));
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  return { estado, conectado: canal === "conectado", erro, definir };
}
