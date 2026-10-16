import type { FalhaProvedor } from "@moductus/contrato";
import type { EventoAgente, ResultadoDeFerramenta } from "../provedor.ts";
import { horaDeVolta, pareceLimite } from "./limite.ts";

/**
 * Lê, linha a linha, a saída `--output-format stream-json --verbose --include-partial-messages`
 * do Claude Code e traduz para `EventoAgente`. Tolerante por desenho (spec §7): linha que não é
 * JSON, tipo desconhecido e campo novo são ignorados; só o que o adaptador usa é lido. O que vem
 * de subagente (`parent_tool_use_id`) fica de fora: o agente fala por ele mesmo.
 *
 * - texto: dos `text_delta` parciais; a mensagem inteira só entra se não veio em pedaços.
 * - ferramenta: do `tool_use` da mensagem inteira (a entrada parcial não serve);
 * - resultado: do `tool_result` que o CLI devolve ao modelo depois de rodar a ferramenta no MCP;
 * - uso e fim: do `result`, que traz o total da execução e o `session_id` para o `--resume`.
 */

export interface ContextoLeitura {
  /** O nome no catálogo de uma ferramenta como o CLI a chama (`mcp__moductus__...`). */
  nomeDaFerramenta(nomeNoCli: string): string;
  agora(): Date;
}

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Objeto) : null;
const texto = (valor: unknown): string | null => (typeof valor === "string" ? valor : null);
const numero = (valor: unknown): number => (typeof valor === "number" && Number.isFinite(valor) ? valor : 0);
const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);

/** Erros que o Claude Code marca na mensagem do assistente quando a API recusa. */
const ERRO_CREDENCIAL = new Set(["authentication_failed", "billing_error"]);

export class LeitorStreamJson {
  private readonly emPedacos = new Set<string>();
  private mensagemAtual: string | null = null;
  /** `resetsAt` do último `rate_limit_event` recusado, a fonte mais firme da hora de volta. */
  private limiteRecusadoAte: string | null = null;
  /** O campo `error` da mensagem do assistente que relatou uma falha da API. */
  private erroDaApi: string | null = null;
  private fechou = false;

  constructor(private readonly contexto: ContextoLeitura) {}

  /** Já leu o `result`: nada mais da execução vem depois. */
  get terminou(): boolean {
    return this.fechou;
  }

  ler(linha: string): EventoAgente[] {
    if (this.fechou || !linha.trim()) return [];
    let mensagem: Objeto | null;
    try {
      mensagem = objeto(JSON.parse(linha));
    } catch {
      return [];
    }
    if (!mensagem || (mensagem.parent_tool_use_id ?? null) !== null) return [];
    switch (mensagem.type) {
      case "stream_event":
        return this.parcial(objeto(mensagem.event));
      case "assistant":
        return this.doAssistente(mensagem);
      case "user":
        return this.resultados(objeto(mensagem.message));
      case "rate_limit_event":
        this.limiteRecusado(objeto(mensagem.rate_limit_info));
        return [];
      case "result":
        this.fechou = true;
        return this.final(mensagem);
      default:
        return [];
    }
  }

  private parcial(evento: Objeto | null): EventoAgente[] {
    if (!evento) return [];
    if (evento.type === "message_start") {
      this.mensagemAtual = texto(objeto(evento.message)?.id);
      return [];
    }
    const delta = objeto(evento.delta);
    if (evento.type !== "content_block_delta" || delta?.type !== "text_delta") return [];
    const pedaco = texto(delta.text);
    if (!pedaco) return [];
    if (this.mensagemAtual) this.emPedacos.add(this.mensagemAtual);
    return [{ tipo: "texto", texto: pedaco }];
  }

  private doAssistente(mensagem: Objeto): EventoAgente[] {
    const corpo = objeto(mensagem.message);
    if (!corpo) return [];
    const erro = texto(mensagem.error);
    if (erro) {
      // O texto dessa mensagem é o erro da API, não a fala do agente.
      this.erroDaApi = erro;
      return [];
    }
    const jaVeio = this.emPedacos.has(texto(corpo.id) ?? "");
    const eventos: EventoAgente[] = [];
    for (const bloco of lista(corpo.content).map(objeto)) {
      if (bloco?.type === "text" && !jaVeio) {
        const fala = texto(bloco.text);
        if (fala) eventos.push({ tipo: "texto", texto: fala });
      } else if (bloco?.type === "tool_use") {
        const id = texto(bloco.id);
        const nome = texto(bloco.name);
        if (id && nome) {
          eventos.push({
            tipo: "ferramenta",
            chamada: { id, nome: this.contexto.nomeDaFerramenta(nome), entrada: bloco.input ?? {} },
          });
        }
      }
    }
    return eventos;
  }

  private resultados(corpo: Objeto | null): EventoAgente[] {
    const eventos: EventoAgente[] = [];
    for (const bloco of lista(corpo?.content).map(objeto)) {
      const chamadaId = texto(bloco?.tool_use_id);
      if (bloco?.type !== "tool_result" || !chamadaId) continue;
      const conteudo = textoDoConteudo(bloco.content);
      const resultado: ResultadoDeFerramenta =
        bloco.is_error === true ? { ok: false, erro: conteudo } : { ok: true, valor: conteudo };
      eventos.push({ tipo: "resultado", chamadaId, resultado });
    }
    return eventos;
  }

  private limiteRecusado(info: Objeto | null): void {
    if (info?.status !== "rejected") return;
    const segundos = numero(info.resetsAt);
    if (segundos > 0) this.limiteRecusadoAte = new Date(segundos * 1000).toISOString();
  }

  private final(resultado: Objeto): EventoAgente[] {
    const eventos: EventoAgente[] = [];
    const uso = objeto(resultado.usage);
    if (uso) {
      // Entrada conta tudo o que o modelo leu, inclusive o que veio do cache do prompt.
      const tokensEntrada =
        numero(uso.input_tokens) +
        numero(uso.cache_creation_input_tokens) +
        numero(uso.cache_read_input_tokens);
      const tokensSaida = numero(uso.output_tokens);
      if (tokensEntrada + tokensSaida > 0) eventos.push({ tipo: "uso", tokensEntrada, tokensSaida });
    }
    const subtipo = texto(resultado.subtype) ?? "";
    if (resultado.is_error !== true && !subtipo.startsWith("error")) {
      eventos.push({ tipo: "fim", continuacao: texto(resultado.session_id) });
      return eventos;
    }
    const mensagem = (texto(resultado.result) ?? "").trim();
    const falha = this.classificar(mensagem, numero(resultado.api_error_status));
    if (!falha) {
      // Erro que não é do provedor (limite de turnos, falha interna): a execução falha, o agente não dorme.
      throw new Error(
        `O Claude Code terminou com erro (${subtipo || "sem subtipo"}): ${mensagem || "sem mensagem"}`,
      );
    }
    eventos.push({ tipo: "erro", falha });
    return eventos;
  }

  private classificar(mensagem: string, status: number): FalhaProvedor | null {
    const detalhe = mensagem ? `: ${mensagem.slice(0, 300)}` : ".";
    if (
      this.limiteRecusadoAte ||
      this.erroDaApi === "rate_limit" ||
      status === 429 ||
      pareceLimite(mensagem)
    ) {
      return {
        motivo: "limite",
        mensagem: `O limite de uso do Claude Code acabou${detalhe}`,
        voltaEm: this.limiteRecusadoAte ?? horaDeVolta(mensagem, this.contexto.agora()),
      };
    }
    if (
      ERRO_CREDENCIAL.has(this.erroDaApi ?? "") ||
      status === 401 ||
      status === 403 ||
      /\/login|\blog ?in\b|\bapi key\b|\bauthenticat|\boauth\b|\bcredit balance\b/i.test(mensagem)
    ) {
      return { motivo: "credencial", mensagem: `O Claude Code recusou o login${detalhe}`, voltaEm: null };
    }
    if (
      this.erroDaApi === "server_error" ||
      status >= 500 ||
      /\bapi error\b|\boverloaded\b|\bconnection\b|\bnetwork\b|\bfetch failed\b|\btimed? ?out\b|\beconn|\benotfound\b/i.test(
        mensagem,
      )
    ) {
      return {
        motivo: "fora_do_ar",
        mensagem: `O Claude Code não conseguiu falar com o modelo${detalhe}`,
        voltaEm: null,
      };
    }
    return null;
  }
}

/** O conteúdo de um `tool_result`: texto puro ou lista de blocos `text`. */
function textoDoConteudo(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  return lista(conteudo)
    .map(objeto)
    .map((bloco) => (bloco?.type === "text" ? (texto(bloco.text) ?? "") : ""))
    .join("");
}
