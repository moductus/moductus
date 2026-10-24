import type {
  FalhaProvedor,
  ModeloDoProvedor,
  ResultadoModelosProvedor,
  TipoProvedorApi,
} from "@moductus/contrato";
import { BASE_URL_OPENAI, falhaDaRecusa, lerRecusa, limparDetalhe, maiuscula } from "./openai-compativel.ts";

/**
 * A lista de modelos de um endereço que fala a API da OpenAI (F3-52): `GET {base_url}/models`, o
 * mesmo que a OpenAI, um roteador local, o Ollama e o LM Studio respondem. Serve para o usuário
 * escolher o modelo em vez de digitar; não chama modelo nenhum nem gasta nada. A chave só passa
 * pela memória, no cabeçalho, e nenhuma mensagem leva a chave nem o endereço inteiro.
 */

/** Para onde pedir a lista; a chave já lida do Gerenciador, ou a que o usuário digitou. */
export interface DestinoModelos {
  tipo: TipoProvedorApi;
  baseUrl: string | null;
  chave: string | null;
}

export interface OpcoesModelos {
  sinal?: AbortSignal;
  /** Quem faz o pedido HTTP; os testes trocam pela resposta gravada, sem rede. */
  buscar?: typeof fetch;
  agora?: () => Date;
}

/** Os nomes com que as APIs dizem, num modelo, que ele chama ferramentas. */
const DIZ_FERRAMENTAS = new Set(["tools", "tool_use", "tool_calling", "function_calling"]);

/**
 * O que o item da lista diz sobre ferramentas: `supported_parameters` (roteadores de nuvem),
 * `capabilities` em lista ou em objeto (LM Studio, Ollama e parecidos). Calado é `null`.
 */
export function ferramentasDoItem(item: Record<string, unknown>): boolean | null {
  for (const campo of [item.supported_parameters, item.capabilities]) {
    if (Array.isArray(campo)) return campo.some((c) => typeof c === "string" && DIZ_FERRAMENTAS.has(c));
    if (campo && typeof campo === "object") {
      const valores = Object.entries(campo).filter(([nome]) => DIZ_FERRAMENTAS.has(nome));
      if (valores.length > 0) return valores.some(([, valor]) => valor === true);
    }
  }
  return null;
}

/** Os modelos do corpo (`{"data": [...]}` ou a lista solta), sem repetir e em ordem; `null` se não é lista. */
export function modelosDoCorpo(corpo: unknown): ModeloDoProvedor[] | null {
  const lista = Array.isArray(corpo)
    ? corpo
    : corpo && typeof corpo === "object" && Array.isArray((corpo as { data?: unknown }).data)
      ? (corpo as { data: unknown[] }).data
      : null;
  if (!lista) return null;
  const vistos = new Map<string, ModeloDoProvedor>();
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim() || vistos.has(id)) continue;
    vistos.set(id, { id, ferramentas: ferramentasDoItem(item as Record<string, unknown>) });
  }
  return [...vistos.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listarModelos(
  destino: DestinoModelos,
  opcoes: OpcoesModelos = {},
): Promise<ResultadoModelosProvedor> {
  const base = destino.tipo === "openai" ? BASE_URL_OPENAI : destino.baseUrl;
  if (!base) return falhou("ausente", "Falta o endereço (base_url) para listar os modelos.");
  const quem = quemResponde(destino.tipo, base);
  const cabecalhos: Record<string, string> = { Accept: "application/json" };
  if (destino.chave) cabecalhos.Authorization = `Bearer ${destino.chave}`;

  let resposta: Response;
  try {
    resposta = await (opcoes.buscar ?? fetch)(`${base.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: cabecalhos,
      ...(opcoes.sinal ? { signal: opcoes.sinal } : {}),
    });
  } catch (erro) {
    opcoes.sinal?.throwIfAborted();
    return falhou("fora_do_ar", `${maiuscula(quem)} não respondeu (${causa(erro, destino.chave)}).`);
  }

  const texto = await resposta.text().catch(() => "");
  opcoes.sinal?.throwIfAborted();
  if (!resposta.ok) {
    if (resposta.status === 404) {
      return falhou(
        "ausente",
        `A lista de modelos não está em ${hostDe(base) ?? "esse endereço"}. Confira se o endereço termina em /v1.`,
      );
    }
    const erro = lerRecusa(texto, resposta.status);
    const recusa = {
      ...erro,
      mensagem: limparDetalhe(erro.mensagem, destino.chave),
      retryAfter: resposta.headers.get("retry-after"),
    };
    const falha = falhaDaRecusa(recusa, quem, (opcoes.agora ?? (() => new Date()))());
    if (falha) return { ok: false, falha };
    const detalhe = recusa.mensagem ? `: ${recusa.mensagem}` : ".";
    return falhou(
      "fora_do_ar",
      `${maiuscula(quem)} recusou a lista de modelos (HTTP ${resposta.status})${detalhe}`,
    );
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = undefined;
  }
  const modelos = modelosDoCorpo(corpo);
  if (!modelos) {
    return falhou(
      "ausente",
      `${maiuscula(quem)} respondeu algo que não é a lista de modelos. Confira se o endereço termina em /v1.`,
    );
  }
  return { ok: true, modelos };
}

function quemResponde(tipo: TipoProvedorApi, base: string): string {
  if (tipo === "openai") return "a OpenAI";
  const host = hostDe(base);
  return host ? `o endereço ${host}` : "o endereço";
}

/** O host, nunca o endereço inteiro (pode levar usuário e senha). */
function hostDe(base: string): string | null {
  try {
    return new URL(base).host || null;
  } catch {
    return null;
  }
}

/** O código da falha de rede (`ECONNREFUSED`) quando houver; senão a mensagem, limpa. */
function causa(erro: unknown, chave: string | null): string {
  const motivo = (erro as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  if (typeof motivo?.code === "string") return motivo.code;
  const mensagem =
    typeof motivo?.message === "string"
      ? motivo.message
      : erro instanceof Error
        ? erro.message
        : String(erro);
  return limparDetalhe(mensagem, chave) || "sem detalhe";
}

function falhou(motivo: FalhaProvedor["motivo"], mensagem: string): ResultadoModelosProvedor {
  return { ok: false, falha: { motivo, mensagem, voltaEm: null } };
}
