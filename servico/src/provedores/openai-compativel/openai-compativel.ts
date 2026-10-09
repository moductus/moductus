import type { FalhaProvedor } from "@moductus/contrato";
import type { Credenciais } from "../../casca/credenciais.ts";
import type {
  ChamadaDeFerramenta,
  ConfigProvedor,
  EventoAgente,
  PedidoDoAgente,
  Provedor,
  ResultadoDeFerramenta,
} from "../provedor.ts";
import type { FabricaProvedor } from "../registro.ts";
import { dadosSse, ErroNoFluxo, LeitorChatCompletions, type ChamadaPedida } from "./leitor.ts";

/**
 * Adaptador de API compatível com OpenAI (AGENTS.md §3): `POST {base_url}/chat/completions` com
 * streaming. Serve OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM e o que mais falar o mesmo
 * formato. Ao contrário do CLI, quem roda o ciclo de agente é o serviço: manda as mensagens e as
 * ferramentas, roda cada chamada pelo `executarFerramenta` do pedido (escopo, cartão e registro do
 * runtime), devolve o resultado ao modelo e repete até ele responder sem pedir ferramenta.
 *
 * A chave mora no Gerenciador de Credenciais e é lida pela casca a cada execução; só passa pela
 * memória, no cabeçalho. Sem chave configurada (Ollama, LM Studio), o pedido vai sem
 * `Authorization`.
 */

/** O endereço da API da OpenAI, para o tipo `openai`, que não pede `base_url`. */
export const BASE_URL_OPENAI = "https://api.openai.com/v1";

/**
 * Quantas voltas modelo → ferramentas → modelo uma execução pode dar. Um modelo que pede
 * ferramenta sem parar (comum em modelo local pequeno) não pode prender o agente para sempre.
 */
export const LIMITE_VOLTAS = 25;

/** Quanto do texto de erro do servidor entra na mensagem da falha. */
const TAMANHO_DETALHE = 300;

export interface OpcoesOpenAiCompativel {
  /** O Gerenciador de Credenciais pela casca; o adaptador só lê. */
  credenciais: Pick<Credenciais, "ler">;
  agora?: () => Date;
}

/** Uma mensagem no formato da API. */
type MensagemApi =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ChamadaApi[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChamadaApi {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** O servidor respondeu 200 com um corpo que não dá para ler: erro do servidor, não da rede. */
class RespostaIlegivel extends Error {}

interface Destino {
  url: string;
  cabecalhos: Record<string, string>;
  modelo: string;
}

/** O que vai ao modelo no começo: as instruções como prompt de sistema e o histórico curto. */
export function mensagensDoPedido(pedido: PedidoDoAgente): MensagemApi[] {
  const mensagens: MensagemApi[] = [];
  if (pedido.instrucoes) mensagens.push({ role: "system", content: pedido.instrucoes });
  for (const m of pedido.mensagens) {
    mensagens.push(
      m.papel === "agente" ? { role: "assistant", content: m.texto } : { role: "user", content: m.texto },
    );
  }
  return mensagens;
}

/** O resultado como o modelo lê: texto puro, ou JSON; erro vai marcado para ele corrigir. */
export function conteudoDoResultado(resultado: ResultadoDeFerramenta): string {
  if (!resultado.ok) return JSON.stringify({ erro: resultado.erro });
  return typeof resultado.valor === "string" ? resultado.valor : JSON.stringify(resultado.valor ?? null);
}

/** `Retry-After` em segundos ou em data HTTP; o que não for nenhum dos dois é `null`. */
export function horaDoRetryAfter(valor: string | null, agora: Date): string | null {
  const limpo = valor?.trim();
  if (!limpo) return null;
  if (/^\d+(\.\d+)?$/.test(limpo))
    return new Date(agora.getTime() + Math.ceil(Number(limpo) * 1000)).toISOString();
  const data = Date.parse(limpo);
  return Number.isNaN(data) ? null : new Date(data).toISOString();
}

/**
 * Qual falha do provedor uma recusa do servidor é, pelo status HTTP e pelo código de erro que as
 * APIs mandam no corpo. `null`: o erro é do pedido (contexto longo demais, ferramenta mal
 * descrita), não do provedor; a execução falha e o agente não dorme.
 */
export function falhaDaRecusa(
  recusa: { status: number; mensagem: string; codigo: string | null; retryAfter: string | null },
  quem: string,
  agora: Date,
): FalhaProvedor | null {
  const { status, codigo } = recusa;
  const detalhe = recusa.mensagem ? `: ${recusa.mensagem.slice(0, TAMANHO_DETALHE)}` : ".";
  if (codigo === "insufficient_quota") {
    return { motivo: "credencial", mensagem: `A conta d${quem} está sem crédito${detalhe}`, voltaEm: null };
  }
  if (status === 401 || status === 403 || codigo === "invalid_api_key") {
    return { motivo: "credencial", mensagem: `${maiuscula(quem)} recusou a chave${detalhe}`, voltaEm: null };
  }
  if (status === 429 || /rate_limit/i.test(codigo ?? "")) {
    return {
      motivo: "limite",
      mensagem: `O limite de uso d${quem} acabou${detalhe}`,
      voltaEm: horaDoRetryAfter(recusa.retryAfter, agora),
    };
  }
  if (status === 404 || codigo === "model_not_found") {
    return {
      motivo: "ausente",
      mensagem: `${maiuscula(quem)} não achou o modelo ou o endereço. Confira em Configurações › Modelos${detalhe}`,
      voltaEm: null,
    };
  }
  if (status === 408 || status >= 500) {
    return {
      motivo: "fora_do_ar",
      mensagem: `${maiuscula(quem)} está fora do ar${detalhe}`,
      voltaEm: horaDoRetryAfter(recusa.retryAfter, agora),
    };
  }
  return null;
}

export class ProvedorOpenAiCompativel implements Provedor {
  readonly id: string;
  private readonly agora: () => Date;

  constructor(
    private readonly config: ConfigProvedor,
    private readonly opcoes: OpcoesOpenAiCompativel,
  ) {
    this.id = config.id;
    this.agora = opcoes.agora ?? (() => new Date());
  }

  async *executar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente> {
    sinal.throwIfAborted();
    const destino = await this.destino();
    sinal.throwIfAborted();
    if ("falha" in destino) {
      yield { tipo: "erro", falha: destino.falha };
      return;
    }
    const mensagens = mensagensDoPedido(pedido);
    const ferramentas = pedido.ferramentas.map((f) => ({
      type: "function" as const,
      function: { name: f.nome, description: f.descricao, parameters: f.esquema },
    }));

    for (let volta = 1; volta <= LIMITE_VOLTAS; volta++) {
      const corpo = {
        model: destino.modelo,
        messages: mensagens,
        stream: true,
        // Sem isso a OpenAI não manda o uso no streaming; quem não conhece o campo o ignora.
        stream_options: { include_usage: true },
        ...(ferramentas.length > 0 ? { tools: ferramentas } : {}),
      };
      const leitor = new LeitorChatCompletions();
      const falha = yield* this.chamar(destino, corpo, leitor, sinal);
      if (leitor.uso) yield leitor.uso;
      if (falha) {
        yield { tipo: "erro", falha };
        return;
      }
      const pedidas = leitor.chamadasPedidas;
      if (pedidas.length === 0) {
        // A API não guarda sessão: o histórico vai inteiro a cada execução.
        yield { tipo: "fim", continuacao: null };
        return;
      }
      const chamadas = pedidas.map((p, i) => ({ ...p, id: p.id ?? `chamada-${volta}-${i + 1}` }));
      mensagens.push({
        role: "assistant",
        // Vazio e não `null`: há servidores compatíveis que recusam conteúdo nulo.
        content: leitor.texto,
        tool_calls: chamadas.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.nome, arguments: c.argumentos || "{}" },
        })),
      });
      for (const chamada of chamadas) {
        const resultado = yield* this.rodarFerramenta(chamada, pedido, sinal);
        mensagens.push({ role: "tool", tool_call_id: chamada.id, content: conteudoDoResultado(resultado) });
      }
    }
    throw new Error(
      `O modelo pediu ferramentas ${LIMITE_VOLTAS} vezes seguidas sem chegar a uma resposta. Nada mais foi feito.`,
    );
  }

  /** Para quem as mensagens de falha falam: o endereço, sem caminho nem credencial. */
  private get quem(): string {
    const base = this.baseUrl();
    if (this.config.tipo === "openai" && base === BASE_URL_OPENAI) return "a OpenAI";
    try {
      return base ? `o provedor em ${new URL(base).host}` : "o provedor";
    } catch {
      return "o provedor";
    }
  }

  private baseUrl(): string | null {
    return this.config.baseUrl ?? (this.config.tipo === "openai" ? BASE_URL_OPENAI : null);
  }

  /** Endereço, modelo e chave; o que faltar é falha que só o usuário resolve. */
  private async destino(): Promise<Destino | { falha: FalhaProvedor }> {
    const base = this.baseUrl();
    if (!base) {
      return ausente("Falta o endereço (base_url) deste provedor. Informe em Configurações › Modelos.");
    }
    if (!this.config.modelo) {
      return ausente("Falta escolher o modelo deste provedor. Escolha em Configurações › Modelos.");
    }
    const cabecalhos: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    };
    if (this.config.credencial) {
      const chave = await this.opcoes.credenciais.ler(this.config.credencial);
      if (!chave) {
        return {
          falha: {
            motivo: "credencial",
            mensagem:
              "A chave deste provedor não está no Gerenciador de Credenciais. Informe de novo em Configurações › Modelos.",
            voltaEm: null,
          },
        };
      }
      cabecalhos.Authorization = `Bearer ${chave}`;
    } else if (this.config.tipo === "openai") {
      return {
        falha: {
          motivo: "credencial",
          mensagem: "A OpenAI pede uma chave. Informe em Configurações › Modelos.",
          voltaEm: null,
        },
      };
    }
    return { url: `${base.replace(/\/+$/, "")}/chat/completions`, cabecalhos, modelo: this.config.modelo };
  }

  /**
   * Uma chamada ao modelo: repassa o texto na hora e deixa no leitor as chamadas de ferramenta e o
   * uso. Devolve a falha tipada do provedor, se houver; erro do pedido sobe como exceção.
   */
  private async *chamar(
    destino: Destino,
    corpo: unknown,
    leitor: LeitorChatCompletions,
    sinal: AbortSignal,
  ): AsyncGenerator<EventoAgente, FalhaProvedor | null> {
    let resposta: Response;
    try {
      resposta = await fetch(destino.url, {
        method: "POST",
        headers: destino.cabecalhos,
        body: JSON.stringify(corpo),
        signal: sinal,
      });
    } catch (erro) {
      sinal.throwIfAborted();
      return this.foraDoAr(`não respondeu (${causa(erro)})`);
    }

    if (!resposta.ok) {
      const { mensagem, codigo } = lerRecusa(await resposta.text().catch(() => ""));
      const recusa = {
        status: resposta.status,
        mensagem,
        codigo,
        retryAfter: resposta.headers.get("retry-after"),
      };
      const falha = falhaDaRecusa(recusa, this.quem, this.agora());
      if (falha) return falha;
      throw new Error(
        `${maiuscula(this.quem)} recusou o pedido (HTTP ${resposta.status})${mensagem ? `: ${mensagem.slice(0, TAMANHO_DETALHE)}` : "."}`,
      );
    }

    const tipo = resposta.headers.get("content-type") ?? "";
    try {
      if (tipo.includes("application/json")) {
        // Servidor que ignorou o `stream: true`: a resposta vem inteira, num JSON só.
        const texto = await resposta.text();
        let inteira: unknown;
        try {
          inteira = JSON.parse(texto);
        } catch {
          throw new RespostaIlegivel(`${maiuscula(this.quem)} respondeu algo que não é JSON.`);
        }
        yield* leitor.lerInteira(inteira);
      } else if (resposta.body) {
        for await (const dado of dadosSse(resposta.body)) {
          yield* leitor.lerPedaco(dado);
          if (leitor.terminou) break;
        }
      }
    } catch (erro) {
      sinal.throwIfAborted();
      if (erro instanceof ErroNoFluxo) {
        const recusa = { status: erro.status, mensagem: erro.message, codigo: erro.codigo, retryAfter: null };
        const falha = falhaDaRecusa(recusa, this.quem, this.agora());
        if (falha) return falha;
        throw new Error(
          `${maiuscula(this.quem)} parou a resposta com erro: ${erro.message.slice(0, TAMANHO_DETALHE)}`,
          { cause: erro },
        );
      }
      if (erro instanceof RespostaIlegivel) throw erro;
      // O resto é da conexão: o servidor caiu ou fechou no meio do corpo.
      return this.foraDoAr(`caiu no meio da resposta (${causa(erro)})`);
    }
    if (!leitor.completa) return this.foraDoAr("parou de responder no meio da resposta");
    return null;
  }

  /**
   * Roda uma chamada pelo executor do runtime e relata ao streaming. Argumento que não é JSON não
   * chega a rodar: volta ao modelo como erro, para ele mandar de novo.
   */
  private async *rodarFerramenta(
    pedida: ChamadaPedida & { id: string },
    pedido: PedidoDoAgente,
    sinal: AbortSignal,
  ): AsyncGenerator<EventoAgente, ResultadoDeFerramenta> {
    let entrada: unknown;
    let legivel = true;
    try {
      entrada = pedida.argumentos.trim() ? JSON.parse(pedida.argumentos) : {};
    } catch {
      entrada = pedida.argumentos;
      legivel = false;
    }
    const chamada: ChamadaDeFerramenta = { id: pedida.id, nome: pedida.nome, entrada };
    yield { tipo: "ferramenta", chamada };
    const resultado: ResultadoDeFerramenta = legivel
      ? await pedido.executarFerramenta(chamada)
      : {
          ok: false,
          erro: `Os argumentos de "${pedida.nome}" não são um JSON válido. Mande a chamada de novo com um objeto JSON.`,
        };
    sinal.throwIfAborted();
    yield { tipo: "resultado", chamadaId: chamada.id, resultado };
    return resultado;
  }

  private foraDoAr(oQue: string): FalhaProvedor {
    return { motivo: "fora_do_ar", mensagem: `${maiuscula(this.quem)} ${oQue}.`, voltaEm: null };
  }
}

/** Registro dos tipos `openai-compativel` e `openai`: `registro.registrar(tipo, fabricaOpenAiCompativel(opcoes))`. */
export function fabricaOpenAiCompativel(opcoes: OpcoesOpenAiCompativel): FabricaProvedor {
  return (config) => new ProvedorOpenAiCompativel(config, opcoes);
}

function ausente(mensagem: string): { falha: FalhaProvedor } {
  return { falha: { motivo: "ausente", mensagem, voltaEm: null } };
}

/** A mensagem e o código de erro do corpo de uma recusa, nos formatos que as APIs usam. */
function lerRecusa(corpo: string): { mensagem: string; codigo: string | null } {
  try {
    const json = JSON.parse(corpo) as { error?: unknown; message?: unknown };
    const erro = json.error;
    if (typeof erro === "string") return { mensagem: erro, codigo: null };
    if (typeof erro === "object" && erro !== null) {
      const { message, code, type } = erro as Record<string, unknown>;
      const codigo = typeof code === "string" ? code : typeof type === "string" ? type : null;
      return { mensagem: typeof message === "string" ? message : "", codigo };
    }
    if (typeof json.message === "string") return { mensagem: json.message, codigo: null };
  } catch {
    // Corpo que não é JSON: vale o texto.
  }
  return { mensagem: corpo.trim(), codigo: null };
}

/** O motivo técnico de uma falha de rede (`ECONNREFUSED`, `terminated`), sem pilha. */
function causa(erro: unknown): string {
  const motivo = (erro as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  if (typeof motivo?.code === "string") return motivo.code;
  if (typeof motivo?.message === "string") return motivo.message;
  return erro instanceof Error ? erro.message : String(erro);
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
