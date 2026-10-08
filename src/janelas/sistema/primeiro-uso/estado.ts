import type { EstadoPrimeiroUso } from "@moductus/contrato";
import { createContext, useContext, useEffect, useState } from "react";
import type { Destino } from "../../../areas/areas.ts";
import { useServico } from "../../../nativo/eventos.ts";
import { servico, useCanal } from "../../../servico/conexao.ts";

/**
 * Estado do primeiro uso, vindo do serviço e acompanhado por `primeiroUso.mudou`. Fica `null`
 * até o serviço responder: sem resposta, o Sistema abre normal em vez de prender a janela.
 */
export function usePrimeiroUso(): [EstadoPrimeiroUso | null, (estado: EstadoPrimeiroUso) => void] {
  const canal = useCanal(useServico({ silencioso: true }));
  const [estado, setEstado] = useState<EstadoPrimeiroUso | null>(null);

  useEffect(() => servico.ouvir("primeiroUso.mudou", setEstado), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("primeiroUso.obter")
      .then(setEstado)
      .catch(() => undefined);
  }, [canal]);

  return [estado, setEstado];
}

export interface AcoesSistema {
  ir: (destino: Destino) => void;
  /** Estado novo do primeiro uso, vindo da resposta de um pedido. */
  aoMudarPrimeiroUso: (estado: EstadoPrimeiroUso) => void;
}

/** Ações do Sistema para quem está fundo na árvore (o "Rever o tutorial" das Configurações). */
export const AcoesSistemaContexto = createContext<AcoesSistema>({
  ir: () => undefined,
  aoMudarPrimeiroUso: () => undefined,
});

export const useAcoesSistema = () => useContext(AcoesSistemaContexto);
