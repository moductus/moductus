import { ClienteServico, type EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { registrar, type EstadoServico } from "../nativo/eventos.ts";

/** Um cliente por janela, apontado para o serviço que a casca subiu. */
export const servico = new ClienteServico();

servico.aoMudarEstado((estado) => registrar(`canal ${estado}`));

/** Liga o cliente ao endereço que a casca entrega e devolve o estado da conexão. */
export function useCanal(estadoServico: EstadoServico): EstadoConexao {
  const [conexao, setConexao] = useState<EstadoConexao>(servico.estado);
  useEffect(() => servico.aoMudarEstado(setConexao), []);
  useEffect(() => {
    if (estadoServico.estado === "pronto") {
      servico.conectar({ porta: estadoServico.porta, token: estadoServico.token });
    }
  }, [estadoServico]);
  return conexao;
}
