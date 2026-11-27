import { CONFIG_PADRAO } from "@moductus/contrato";
import { useEffect, useRef, useState } from "react";
import { useServico } from "../nativo/eventos.ts";
import { servico, useCanal } from "./conexao.ts";

export interface PrivacidadeDaJanela {
  ativo: boolean;
  /** O atalho do modo na configuração; vazio é sem atalho. */
  atalho: string;
}

/**
 * O modo privacidade (ADR-0047) como a janela o vê: `privacidade.ativo` da configuração ao
 * conectar e cada `privacidade.mudou` (atalho, bandeja, Configurações ou o selo do dock, de
 * qualquer janela). Enquanto o estado não chega, a janela fica mascarada: com o modo ligado, um
 * valor não pode aparecer nem por um instante. A resposta do `config.obter` que chega depois de
 * um evento é mais velha que ele e não vale.
 */
export function usePrivacidadeDaJanela(): PrivacidadeDaJanela {
  const canal = useCanal(useServico({ silencioso: true }));
  // `null` é ainda não sei, e conta como ligado.
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [atalho, setAtalho] = useState(CONFIG_PADRAO.atalhos.privacidade);
  const eventos = useRef(0);

  useEffect(() => {
    const pararModo = servico.ouvir("privacidade.mudou", (p) => {
      eventos.current++;
      setAtivo(p.ativo);
    });
    const pararConfig = servico.ouvir("config.mudou", (estado) => {
      eventos.current++;
      setAtivo(estado.config.privacidade.ativo);
      setAtalho(estado.config.atalhos.privacidade);
    });
    return () => {
      pararModo();
      pararConfig();
    };
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let valendo = true;
    const antes = eventos.current;
    servico
      .pedir("config.obter")
      .then((estado) => {
        if (!valendo || eventos.current !== antes) return;
        setAtivo(estado.config.privacidade.ativo);
        setAtalho(estado.config.atalhos.privacidade);
      })
      .catch(() => undefined);
    return () => {
      valendo = false;
    };
  }, [canal]);

  return { ativo: ativo ?? true, atalho };
}

/** Desliga (ou liga) o modo pela configuração; quem grava e avisa as janelas é o serviço. */
export function definirPrivacidade(ativo: boolean): Promise<unknown> {
  return servico.pedir("config.definir", { privacidade: { ativo } });
}
