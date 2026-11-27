import { useEffect, useState } from "react";
import { useServico } from "../nativo/eventos.ts";
import { servico, useCanal } from "./conexao.ts";

/**
 * O modo privacidade (ADR-0047) como a janela o vê: `privacidade.ativo` da configuração ao
 * conectar e cada `privacidade.mudou` (atalho, bandeja, Configurações ou o selo do dock, de
 * qualquer janela). Antes de conectar, desligado: a janela ainda não tem valor nenhum para mostrar.
 */
export function usePrivacidadeDaJanela(): boolean {
  const canal = useCanal(useServico({ silencioso: true }));
  const [ativo, setAtivo] = useState(false);

  useEffect(() => servico.ouvir("privacidade.mudou", (p) => setAtivo(p.ativo)), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("config.obter")
      .then((estado) => setAtivo(estado.config.privacidade.ativo))
      .catch(() => undefined);
  }, [canal]);

  return ativo;
}

/** Desliga (ou liga) o modo pela configuração; quem grava e avisa as janelas é o serviço. */
export function definirPrivacidade(ativo: boolean): Promise<unknown> {
  return servico.pedir("config.definir", { privacidade: { ativo } });
}
