import { randomUUID } from "node:crypto";
import type {
  ChamadaDeFerramenta,
  FerramentaOferecida,
  ResultadoDeFerramenta,
} from "../provedores/provedor.ts";

/**
 * O pedaço do MCP que o Moductus fala (ADR-0014): JSON-RPC 2.0 com `initialize`, `ping`,
 * `tools/list` e `tools/call`. Só ferramentas: sem recursos, prompts nem amostragem, e sem
 * mensagens do servidor para o cliente, então cada pedido tem uma resposta e acabou.
 */

/** As versões do protocolo que este servidor entende, da mais nova para a mais antiga. */
export const VERSOES_MCP = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/**
 * O que uma execução expõe pelo MCP: as ferramentas que o agente dela enxerga e quem as roda, com
 * escopo e aprovação (o `executarFerramenta` do pedido, montado pelo catálogo).
 */
export interface ExecucaoMcp {
  ferramentas: readonly FerramentaOferecida[];
  executarFerramenta(chamada: ChamadaDeFerramenta): Promise<ResultadoDeFerramenta>;
}

type IdJsonRpc = string | number;

export type RespostaJsonRpc =
  | { jsonrpc: "2.0"; id: IdJsonRpc | null; result: unknown }
  | { jsonrpc: "2.0"; id: IdJsonRpc | null; error: { code: number; message: string } };

/** Os códigos de erro do JSON-RPC que o servidor usa. */
export const ERRO_JSON_RPC = {
  json: -32700,
  pedidoInvalido: -32600,
  metodo: -32601,
  parametros: -32602,
  interno: -32603,
} as const;

export function erroJsonRpc(id: IdJsonRpc | null, code: number, message: string): RespostaJsonRpc {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function idValido(valor: unknown): valor is IdJsonRpc {
  return typeof valor === "string" || (typeof valor === "number" && Number.isFinite(valor));
}

/** A versão que o cliente pediu, se este servidor a entende; senão, a mais nova daqui. */
export function versaoNegociada(pedida: unknown): string {
  return VERSOES_MCP.find((v) => v === pedida) ?? VERSOES_MCP[0];
}

/**
 * Atende uma mensagem JSON-RPC já lida. Notificação (`notifications/initialized`) e resposta do
 * cliente não têm resposta: devolve `null`. Erro da ferramenta volta como resultado com `isError`,
 * que o modelo lê e corrige; erro de protocolo volta como erro JSON-RPC.
 */
export async function atenderMensagem(
  mensagem: unknown,
  execucao: ExecucaoMcp,
  versaoServidor: string,
): Promise<RespostaJsonRpc | null> {
  if (!objeto(mensagem) || mensagem.jsonrpc !== "2.0") {
    return erroJsonRpc(null, ERRO_JSON_RPC.pedidoInvalido, "mensagem fora do JSON-RPC 2.0");
  }
  const { id, method, params } = mensagem;
  if (typeof method !== "string") {
    // Resposta do cliente a um pedido do servidor: este servidor não pede nada, então só ignora.
    if (idValido(id) && ("result" in mensagem || "error" in mensagem)) return null;
    return erroJsonRpc(idValido(id) ? id : null, ERRO_JSON_RPC.pedidoInvalido, "falta o method");
  }
  if (id === undefined) return null;
  if (!idValido(id)) return erroJsonRpc(null, ERRO_JSON_RPC.pedidoInvalido, "id inválido");

  const responder = (result: unknown): RespostaJsonRpc => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return responder({
        protocolVersion: versaoNegociada(objeto(params) ? params.protocolVersion : undefined),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "moductus", version: versaoServidor },
      });
    case "ping":
      return responder({});
    case "tools/list":
      // Sem paginação: o recorte de um agente cabe numa página.
      return responder({
        tools: execucao.ferramentas.map((f) => ({
          name: f.nome,
          description: f.descricao,
          inputSchema: f.esquema,
        })),
      });
    case "tools/call":
      return chamarFerramenta(id, params, execucao);
    default:
      return erroJsonRpc(id, ERRO_JSON_RPC.metodo, `método desconhecido: ${method}`);
  }
}

async function chamarFerramenta(
  id: IdJsonRpc,
  params: unknown,
  execucao: ExecucaoMcp,
): Promise<RespostaJsonRpc> {
  if (!objeto(params) || typeof params.name !== "string") {
    return erroJsonRpc(id, ERRO_JSON_RPC.parametros, "tools/call sem o nome da ferramenta");
  }
  const { name } = params;
  const responder = (texto: string, erro: boolean): RespostaJsonRpc => ({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: texto }], isError: erro },
  });
  // Só o que foi listado para esta execução roda por aqui, seja qual for o executor do outro lado.
  if (!execucao.ferramentas.some((f) => f.nome === name)) {
    return responder(`A ferramenta "${name}" não está disponível. Use uma das ferramentas oferecidas.`, true);
  }
  const chamada: ChamadaDeFerramenta = {
    id: `mcp-${randomUUID()}`,
    nome: name,
    entrada: params.arguments ?? {},
  };
  try {
    const resultado = await execucao.executarFerramenta(chamada);
    if (!resultado.ok) return responder(resultado.erro, true);
    const { valor } = resultado;
    return responder(typeof valor === "string" ? valor : JSON.stringify(valor ?? null), false);
  } catch (erro) {
    // O executor só lança quando a execução foi cancelada: não há resultado para o modelo.
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return erroJsonRpc(id, ERRO_JSON_RPC.interno, `${name} não rodou: ${motivo}`);
  }
}
