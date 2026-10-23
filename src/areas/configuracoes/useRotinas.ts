import type { MudancaRotina, Rotina } from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";

export interface RotinasDaSecao {
  /** Null até o serviço responder. */
  rotinas: Rotina[] | null;
  conectado: boolean;
  /** Motivo da última recusa do serviço, como veio; some no próximo envio. */
  erro: string | null;
  /** Manda a mudança de uma rotina; quem valida, grava e rearma o relógio é o serviço. */
  definir: (mudanca: MudancaRotina) => Promise<Rotina | null>;
}

/** O briefing e o fechamento no serviço, acompanhando `rotinas.mudou` de qualquer janela. */
export function useRotinas(): RotinasDaSecao {
  const canal = useCanal(useServico({ silencioso: true }));
  const [rotinas, setRotinas] = useState<Rotina[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => servico.ouvir("rotinas.mudou", setRotinas), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("rotinas.listar")
      .then(setRotinas)
      .catch(() => undefined);
  }, [canal]);

  const definir = useCallback(async (mudanca: MudancaRotina) => {
    setErro(null);
    try {
      const rotina = await servico.pedir("rotinas.definir", mudanca);
      // Os dias são os de trabalho: o serviço grava os mesmos nas duas rotinas.
      const dias = mudanca.diasSemana === undefined ? null : rotina.diasSemana;
      setRotinas(
        (atuais) =>
          atuais?.map((r) =>
            r.id === rotina.id ? rotina : dias === null ? r : { ...r, diasSemana: dias },
          ) ?? atuais,
      );
      return rotina;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  return { rotinas, conectado: canal === "conectado", erro, definir };
}
