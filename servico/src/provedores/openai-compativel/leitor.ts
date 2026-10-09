import type { EventoAgente } from "../provedor.ts";

/**
 * Lê a resposta de `POST /chat/completions` de uma API compatível com OpenAI (OpenAI, OpenRouter,
 * Groq, Ollama, LM Studio, vLLM) e traduz para o que o adaptador usa. Tolerante como o leitor do
 * CLI (spec §7): dado que não é JSON, campo novo e campo ausente são ignorados; só o que importa
 * é lido.
 *
 * - texto: de `delta.content`, na hora, para o streaming;
 * - chamadas de ferramenta: de `delta.tool_calls`, montadas pedaço a pedaço pelo `index`, porque
 *   os argumentos chegam em fatias de JSON;
 * - uso: do `usage` (o último que vier), com `cached_tokens` e o modelo que respondeu (F2-09).
 */

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Objeto) : null;
const texto = (valor: unknown): string | null => (typeof valor === "string" ? valor : null);
const numero = (valor: unknown): number => (typeof valor === "number" && Number.isFinite(valor) ? valor : 0);
const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);

/** Uma chamada de ferramenta como o modelo pediu: os argumentos ainda em texto JSON. */
export interface ChamadaPedida {
  id: string | null;
  nome: string;
  argumentos: string;
}

/** O servidor mandou um erro no meio do fluxo (`{"error": {...}}`), depois do 200. */
export class ErroNoFluxo extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: string | null,
  ) {
    super(mensagem);
  }
}

export class LeitorChatCompletions {
  private readonly chamadas = new Map<number, ChamadaPedida>();
  private textoDaResposta = "";
  private usoDaResposta: Extract<EventoAgente, { tipo: "uso" }> | null = null;
  private modelo: string | null = null;
  private fechou = false;
  private motivoDoFim: string | null = null;

  /** Veio o `[DONE]`: nada mais desta chamada chega depois. */
  get terminou(): boolean {
    return this.fechou;
  }

  /** O modelo disse por que parou (`stop`, `tool_calls`, `length`): a resposta veio inteira. */
  get completa(): boolean {
    return this.fechou || this.motivoDoFim !== null;
  }

  /** O que o modelo escreveu nesta chamada, para voltar no histórico junto com as chamadas. */
  get texto(): string {
    return this.textoDaResposta;
  }

  /** Tokens da chamada; `null` quando o servidor não informa (nada de número inventado). */
  get uso(): Extract<EventoAgente, { tipo: "uso" }> | null {
    if (!this.usoDaResposta) return null;
    return this.modelo ? { ...this.usoDaResposta, modelo: this.modelo } : this.usoDaResposta;
  }

  /** As chamadas de ferramenta pedidas, na ordem do `index`. */
  get chamadasPedidas(): ChamadaPedida[] {
    return [...this.chamadas.entries()].sort(([a], [b]) => a - b).map(([, chamada]) => chamada);
  }

  /** Um `data:` do fluxo SSE. Devolve os pedaços de texto que ele trouxe. */
  lerPedaco(dado: string): EventoAgente[] {
    if (this.fechou) return [];
    if (dado.trim() === "[DONE]") {
      this.fechou = true;
      return [];
    }
    let pedaco: Objeto | null;
    try {
      pedaco = objeto(JSON.parse(dado));
    } catch {
      return [];
    }
    if (!pedaco) return [];
    this.lerErro(pedaco);
    this.lerComum(pedaco);
    const escolha = objeto(lista(pedaco.choices)[0]);
    if (!escolha) return [];
    this.motivoDoFim = texto(escolha.finish_reason) ?? this.motivoDoFim;
    const delta = objeto(escolha.delta);
    if (!delta) return [];
    for (const item of lista(delta.tool_calls)) this.lerChamada(objeto(item));
    const fala = texto(delta.content);
    if (!fala) return [];
    this.textoDaResposta += fala;
    return [{ tipo: "texto", texto: fala }];
  }

  /** A resposta inteira, de um servidor que ignorou o `stream: true` e mandou JSON de uma vez. */
  lerInteira(corpo: unknown): EventoAgente[] {
    const resposta = objeto(corpo);
    this.fechou = true;
    if (!resposta) return [];
    this.lerErro(resposta);
    this.lerComum(resposta);
    const escolha = objeto(lista(resposta.choices)[0]);
    this.motivoDoFim = texto(escolha?.finish_reason) ?? "stop";
    const mensagem = objeto(escolha?.message);
    if (!mensagem) return [];
    for (const item of lista(mensagem.tool_calls)) this.lerChamada(objeto(item));
    const fala = texto(mensagem.content);
    if (!fala) return [];
    this.textoDaResposta += fala;
    return [{ tipo: "texto", texto: fala }];
  }

  private lerErro(corpo: Objeto): void {
    const erro = objeto(corpo.error) ?? (typeof corpo.error === "string" ? { message: corpo.error } : null);
    if (!erro) return;
    const codigo = erro.code;
    throw new ErroNoFluxo(
      texto(erro.message) ?? "erro sem mensagem",
      typeof codigo === "number" ? codigo : numero(erro.status),
      texto(codigo) ?? texto(erro.type),
    );
  }

  private lerComum(corpo: Objeto): void {
    this.modelo = texto(corpo.model) ?? this.modelo;
    // A Groq manda o uso do streaming em `x_groq.usage`, no último pedaço.
    const uso = objeto(corpo.usage) ?? objeto(objeto(corpo.x_groq)?.usage);
    if (!uso) return;
    // `prompt_tokens` já conta a parte lida do cache; `cached_tokens` diz quanto foi.
    const tokensEntrada = numero(uso.prompt_tokens);
    const tokensSaida = numero(uso.completion_tokens);
    if (tokensEntrada + tokensSaida === 0) return;
    const cache = numero(objeto(uso.prompt_tokens_details)?.cached_tokens);
    this.usoDaResposta = {
      tipo: "uso",
      tokensEntrada,
      tokensSaida,
      ...(cache > 0 ? { tokensCacheLidos: cache } : {}),
    };
  }

  /**
   * Uma fatia de chamada. O `index` diz de qual chamada ela é; sem ele (servidor que manda a
   * chamada inteira de uma vez), cada item é uma chamada nova. Id e nome chegam na primeira fatia;
   * os argumentos se somam.
   */
  private lerChamada(item: Objeto | null): void {
    if (!item) return;
    const indice = typeof item.index === "number" ? item.index : this.chamadas.size;
    const funcao = objeto(item.function);
    const atual = this.chamadas.get(indice) ?? { id: null, nome: "", argumentos: "" };
    atual.id ??= texto(item.id) || null;
    if (!atual.nome) atual.nome = texto(funcao?.name) ?? "";
    const argumentos = funcao?.arguments;
    if (typeof argumentos === "string") atual.argumentos += argumentos;
    else if (objeto(argumentos)) atual.argumentos += JSON.stringify(argumentos);
    this.chamadas.set(indice, atual);
  }
}

/**
 * Os `data:` de um fluxo `text/event-stream`, um por evento. Linhas de comentário (`:`) e outros
 * campos (`event:`, `id:`) ficam de fora; várias linhas `data:` do mesmo evento se juntam com quebra
 * de linha, como manda o formato.
 */
export async function* dadosSse(corpo: ReadableStream<Uint8Array>): AsyncIterable<string> {
  let resto = "";
  let dados: string[] = [];
  const linhaLida = (linha: string): string | null => {
    if (linha === "") {
      const evento = dados.length > 0 ? dados.join("\n") : null;
      dados = [];
      return evento;
    }
    if (linha.startsWith("data:")) dados.push(linha.slice(linha.startsWith("data: ") ? 6 : 5));
    return null;
  };
  for await (const pedaco of corpo.pipeThrough(new TextDecoderStream())) {
    resto += pedaco;
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    for (const linha of linhas) {
      const evento = linhaLida(linha.endsWith("\r") ? linha.slice(0, -1) : linha);
      if (evento !== null) yield evento;
    }
  }
  const ultimo = linhaLida(resto.endsWith("\r") ? resto.slice(0, -1) : resto);
  if (ultimo !== null) yield ultimo;
  const pendente = linhaLida("");
  if (pendente !== null) yield pendente;
}
