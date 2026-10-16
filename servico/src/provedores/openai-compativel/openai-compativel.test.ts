import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { ChamadaDeFerramenta, ConfigProvedor, EventoAgente, PedidoDoAgente } from "../provedor.ts";
import { RegistroProvedores } from "../registro.ts";
import {
  conteudoDoResultado,
  fabricaOpenAiCompativel,
  falhaDaRecusa,
  horaDoRetryAfter,
  LIMITE_VOLTAS,
  limparDetalhe,
  ProvedorOpenAiCompativel,
  type Recusa,
} from "./openai-compativel.ts";

/** Um pedido recebido pelo servidor falso: os cabeçalhos e o corpo já lido como JSON. */
interface Recebido {
  cabecalhos: IncomingHttpHeaders;
  caminho: string;
  corpo: {
    model: string;
    stream: boolean;
    messages: Array<Record<string, unknown>>;
    tools?: Array<Record<string, unknown>>;
    stream_options?: unknown;
  };
}

type Atender = (res: ServerResponse, recebido: Recebido) => void;

/**
 * Servidor HTTP local no lugar da API: cada pedido é atendido pela próxima resposta da lista, e
 * pedido sem resposta roteirizada é erro de teste (500 com aviso).
 */
let servidor: Server | null = null;
let recebidos: Recebido[] = [];

async function servidorFalso(...respostas: Atender[]): Promise<string> {
  recebidos = [];
  servidor = createServer((req, res) => {
    let corpo = "";
    req.setEncoding("utf8");
    req.on("data", (pedaco: string) => (corpo += pedaco));
    req.on("end", () => {
      const recebido = {
        cabecalhos: req.headers,
        caminho: req.url ?? "",
        corpo: JSON.parse(corpo) as Recebido["corpo"],
      };
      recebidos.push(recebido);
      const atender = respostas.shift();
      if (!atender) {
        res.writeHead(500).end("pedido sem resposta roteirizada no teste");
        return;
      }
      atender(res, recebido);
    });
  });
  await new Promise<void>((resolve) => servidor!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`;
}

afterEach(async () => {
  if (!servidor) return;
  servidor.closeAllConnections();
  await new Promise((resolve) => servidor!.close(resolve));
  servidor = null;
});

/** Responde em `text/event-stream`, um `data:` por pedaço, e fecha com `[DONE]`. */
const sse =
  (pedacos: readonly unknown[], { fechar = true } = {}): Atender =>
  (res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const p of pedacos) res.write(`data: ${JSON.stringify(p)}\n\n`);
    if (fechar) res.end("data: [DONE]\n\n");
    // Derruba a conexão só depois de o que foi escrito sair, como um servidor que cai no meio.
    else res.write("", () => setTimeout(() => res.destroy(), 20));
  };

const recusa =
  (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}): Atender =>
  (res) => {
    res.writeHead(status, { "Content-Type": "application/json", ...cabecalhos }).end(JSON.stringify(corpo));
  };

const delta = (d: Record<string, unknown>, fim: string | null = null) => ({
  id: "chatcmpl-1",
  model: "llama3.2",
  choices: [{ index: 0, delta: d, finish_reason: fim }],
});

const uso = (entrada: number, saida: number, cache = 0) => ({
  id: "chatcmpl-1",
  model: "gpt-5-mini-2025-08-07",
  choices: [],
  usage: {
    prompt_tokens: entrada,
    completion_tokens: saida,
    prompt_tokens_details: { cached_tokens: cache },
  },
});

/** Resposta de texto em pedaços, com o uso no fim, como a OpenAI manda com `include_usage`. */
const respostaDeTexto = (...pedacos: string[]) =>
  sse([
    delta({ role: "assistant", content: "" }),
    ...pedacos.map((p) => delta({ content: p })),
    delta({}, "stop"),
    uso(120, 30, 64),
  ]);

const CHAVE = "sk-teste-nao-e-de-verdade";
const cofre = new Map([["moductus/provedor/01JA", CHAVE]]);
const credenciais = { ler: (nome: string) => Promise.resolve(cofre.get(nome) ?? null) };
const AGORA = new Date("2026-10-09T12:00:00.000Z");

const config = (mudanca: Partial<ConfigProvedor> = {}): ConfigProvedor => ({
  id: "01JA0000000000000000000002",
  tipo: "openai-compativel",
  modelo: "llama3.2",
  baseUrl: null,
  credencial: null,
  ...mudanca,
});

const pedido = (mudanca: Partial<PedidoDoAgente> = {}): PedidoDoAgente => ({
  agenteId: "nuno",
  execucaoId: "exec-1",
  instrucoes: "Você é o Nuno, agente de dev do Moductus.",
  mensagens: [
    { papel: "usuario", texto: "Oi" },
    { papel: "agente", texto: "Oi. O que precisa?" },
    { papel: "usuario", texto: "Quais sessões de IA estão abertas?" },
  ],
  ferramentas: [],
  executarFerramenta: () => Promise.reject(new Error("nenhuma ferramenta neste teste")),
  continuarDe: null,
  ...mudanca,
});

const provedor = (c: ConfigProvedor) => new ProvedorOpenAiCompativel(c, { credenciais, agora: () => AGORA });

async function coletar(eventos: AsyncIterable<EventoAgente>): Promise<EventoAgente[]> {
  const lista: EventoAgente[] = [];
  for await (const evento of eventos) lista.push(evento);
  return lista;
}

const rodar = (c: ConfigProvedor, p: PedidoDoAgente = pedido(), sinal = new AbortController().signal) =>
  coletar(provedor(c).executar(p, sinal));

const falhaDe = (eventos: EventoAgente[]) => {
  const erro = eventos.find((e) => e.tipo === "erro");
  if (erro?.tipo !== "erro") throw new Error("a execução não terminou em erro");
  return erro.falha;
};

describe("texto em streaming", () => {
  test("repassa cada pedaço, informa o uso com cache e modelo, e fecha sem continuação", async () => {
    const baseUrl = await servidorFalso(respostaDeTexto("Duas ", "sessões ", "abertas."));

    const eventos = await rodar(config({ baseUrl }));

    expect(eventos).toEqual([
      { tipo: "texto", texto: "Duas " },
      { tipo: "texto", texto: "sessões " },
      { tipo: "texto", texto: "abertas." },
      {
        tipo: "uso",
        tokensEntrada: 120,
        tokensSaida: 30,
        tokensCacheLidos: 64,
        modelo: "gpt-5-mini-2025-08-07",
      },
      { tipo: "fim", continuacao: null },
    ]);
  });

  test("manda modelo, instruções como sistema e o histórico com os papéis da API", async () => {
    const baseUrl = await servidorFalso(respostaDeTexto("ok"));

    await rodar(config({ baseUrl: `${baseUrl}/` }));

    const [{ caminho, corpo, cabecalhos }] = recebidos as [Recebido];
    expect(caminho).toBe("/v1/chat/completions");
    expect(corpo.model).toBe("llama3.2");
    expect(corpo.stream).toBe(true);
    expect(corpo.stream_options).toEqual({ include_usage: true });
    expect(corpo.messages).toEqual([
      { role: "system", content: "Você é o Nuno, agente de dev do Moductus." },
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Oi. O que precisa?" },
      { role: "user", content: "Quais sessões de IA estão abertas?" },
    ]);
    // Sem ferramentas no pedido, o campo nem vai: há modelos locais que se perdem com lista vazia.
    expect(corpo.tools).toBeUndefined();
    expect(cabecalhos.accept).toContain("text/event-stream");
  });

  test("sem uso informado pelo servidor, não há evento de uso", async () => {
    const baseUrl = await servidorFalso(sse([delta({ content: "oi" }), delta({}, "stop")]));

    const eventos = await rodar(config({ baseUrl }));

    expect(eventos.map((e) => e.tipo)).toEqual(["texto", "fim"]);
  });

  test("servidor que ignora o stream e manda o JSON inteiro também serve", async () => {
    const baseUrl = await servidorFalso((res) =>
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          model: "qwen3",
          choices: [
            { index: 0, message: { role: "assistant", content: "Tudo certo." }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 5 },
        }),
      ),
    );

    const eventos = await rodar(config({ baseUrl }));

    expect(eventos).toEqual([
      { tipo: "texto", texto: "Tudo certo." },
      { tipo: "uso", tokensEntrada: 50, tokensSaida: 5, modelo: "qwen3" },
      { tipo: "fim", continuacao: null },
    ]);
  });
});

describe("chave pelo Gerenciador de Credenciais", () => {
  test("lê a chave pelo nome guardado e manda no Authorization", async () => {
    const baseUrl = await servidorFalso(respostaDeTexto("ok"));

    await rodar(config({ baseUrl, credencial: "moductus/provedor/01JA" }));

    expect(recebidos[0]!.cabecalhos.authorization).toBe(`Bearer ${CHAVE}`);
  });

  test("sem credencial configurada (Ollama, LM Studio), vai sem Authorization", async () => {
    const baseUrl = await servidorFalso(respostaDeTexto("ok"));

    await rodar(config({ baseUrl }));

    expect(recebidos[0]!.cabecalhos.authorization).toBeUndefined();
  });

  test("credencial configurada que sumiu do Gerenciador é falha de credencial, sem chamar a API", async () => {
    const baseUrl = await servidorFalso();

    const eventos = await rodar(config({ baseUrl, credencial: "moductus/provedor/apagada" }));

    expect(falhaDe(eventos)).toMatchObject({ motivo: "credencial", voltaEm: null });
    expect(recebidos).toHaveLength(0);
  });

  test("OpenAI sem chave é falha de credencial", async () => {
    const eventos = await rodar(config({ tipo: "openai", modelo: "gpt-5-mini" }));

    expect(falhaDe(eventos)).toMatchObject({ motivo: "credencial", voltaEm: null });
  });

  test("sem endereço ou sem modelo, o provedor está ausente até o usuário configurar", async () => {
    expect(falhaDe(await rodar(config()))).toMatchObject({ motivo: "ausente", voltaEm: null });
    const baseUrl = await servidorFalso();
    expect(falhaDe(await rodar(config({ baseUrl, modelo: null })))).toMatchObject({ motivo: "ausente" });
    expect(recebidos).toHaveLength(0);
  });

  test("endereço com usuário e senha é recusado sem ecoar o endereço nem chamar a API", async () => {
    const baseUrl = await servidorFalso();
    const comSenha = baseUrl.replace("http://", "http://fulano:senha-secreta@");

    const falha = falhaDe(await rodar(config({ baseUrl: comSenha })));

    expect(falha).toMatchObject({ motivo: "ausente", voltaEm: null });
    expect(falha.mensagem).toContain("usuário ou senha");
    expect(falha.mensagem).not.toContain("senha-secreta");
    expect(falha.mensagem).not.toContain("fulano");
    expect(recebidos).toHaveLength(0);
  });

  test("OpenAI vai sempre a api.openai.com, mesmo com outra base_url guardada", async () => {
    const urls: string[] = [];
    const buscar: typeof fetch = (url) => {
      urls.push(String(url));
      return Promise.resolve(
        new Response(`data: ${JSON.stringify(delta({ content: "oi" }, "stop"))}\n\ndata: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    };
    const openai = new ProvedorOpenAiCompativel(
      config({
        tipo: "openai",
        modelo: "gpt-5-mini",
        baseUrl: "http://127.0.0.1:9/v1",
        credencial: "moductus/provedor/01JA",
      }),
      { credenciais, buscar },
    );

    const eventos = await coletar(openai.executar(pedido(), new AbortController().signal));

    expect(urls).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(eventos.at(-1)).toEqual({ tipo: "fim", continuacao: null });
  });
});

describe("ciclo de ferramentas no serviço", () => {
  const ferramentas = [
    {
      nome: "sessoes__listar",
      descricao: "Lista as sessões de IA",
      esquema: { type: "object", properties: { projeto: { type: "string" } } },
    },
  ];

  test("monta a chamada em pedaços, roda pelo executor, devolve o resultado e segue até a resposta", async () => {
    const baseUrl = await servidorFalso(
      sse([
        delta({ role: "assistant", content: "" }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "sessoes__listar", arguments: "" },
            },
          ],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"proj' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'eto":"moductus"}' } }] }),
        delta({}, "tool_calls"),
        uso(200, 15),
      ]),
      respostaDeTexto("Duas sessões no moductus."),
    );
    const chamadas: ChamadaDeFerramenta[] = [];
    const executarFerramenta = (chamada: ChamadaDeFerramenta) => {
      chamadas.push(chamada);
      return Promise.resolve({ ok: true as const, valor: [{ id: "s1" }, { id: "s2" }] });
    };

    const eventos = await rodar(config({ baseUrl }), pedido({ ferramentas, executarFerramenta }));

    expect(chamadas).toEqual([{ id: "call_1", nome: "sessoes__listar", entrada: { projeto: "moductus" } }]);
    expect(eventos.map((e) => e.tipo)).toEqual(["uso", "ferramenta", "resultado", "texto", "uso", "fim"]);
    expect(eventos[2]).toEqual({
      tipo: "resultado",
      chamadaId: "call_1",
      resultado: { ok: true, valor: [{ id: "s1" }, { id: "s2" }] },
    });

    const [primeiro, segundo] = recebidos as [Recebido, Recebido];
    expect(primeiro.corpo.tools).toEqual([
      {
        type: "function",
        function: {
          name: "sessoes__listar",
          description: "Lista as sessões de IA",
          parameters: ferramentas[0]!.esquema,
        },
      },
    ]);
    // A segunda volta leva a chamada do modelo e o resultado, na ordem que a API exige.
    expect(segundo.corpo.messages.slice(-2)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "sessoes__listar", arguments: '{"projeto":"moductus"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '[{"id":"s1"},{"id":"s2"}]' },
    ]);
  });

  test("duas chamadas na mesma volta rodam na ordem do índice; sem id, o adaptador dá um", async () => {
    const baseUrl = await servidorFalso(
      sse([
        delta({
          tool_calls: [
            { index: 1, function: { name: "b", arguments: "{}" } },
            { index: 0, function: { name: "a", arguments: "{}" } },
          ],
        }),
        delta({}, "tool_calls"),
      ]),
      respostaDeTexto("pronto"),
    );
    const nomes: string[] = [];
    const executarFerramenta = (chamada: ChamadaDeFerramenta) => {
      nomes.push(`${chamada.nome}:${chamada.id}`);
      return Promise.resolve({ ok: false as const, erro: "sem permissão" });
    };

    await rodar(config({ baseUrl }), pedido({ ferramentas, executarFerramenta }));

    expect(nomes).toEqual(["a:chamada-1-1", "b:chamada-1-2"]);
    const mensagens = recebidos[1]!.corpo.messages;
    expect(mensagens.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "chamada-1-2",
      content: JSON.stringify({ erro: "sem permissão" }),
    });
  });

  test("argumento que não é JSON não roda: volta ao modelo como erro para ele corrigir", async () => {
    const baseUrl = await servidorFalso(
      sse([
        delta({
          tool_calls: [{ index: 0, id: "c1", function: { name: "sessoes__listar", arguments: "{proj" } }],
        }),
        delta({}, "tool_calls"),
      ]),
      respostaDeTexto("desculpe"),
    );
    let rodou = false;
    const executarFerramenta = () => {
      rodou = true;
      return Promise.resolve({ ok: true as const, valor: null });
    };

    const eventos = await rodar(config({ baseUrl }), pedido({ ferramentas, executarFerramenta }));

    expect(rodou).toBe(false);
    const resultado = eventos.find((e) => e.tipo === "resultado");
    expect(resultado).toMatchObject({ tipo: "resultado", chamadaId: "c1", resultado: { ok: false } });
    expect(eventos.at(-1)).toEqual({ tipo: "fim", continuacao: null });
  });

  test(`modelo que pede ferramenta sem parar é cortado em ${LIMITE_VOLTAS} chamadas, sem rodar a última`, async () => {
    const pedeDeNovo = sse([
      delta({ tool_calls: [{ index: 0, id: "c", function: { name: "sessoes__listar", arguments: "{}" } }] }),
      delta({}, "tool_calls"),
    ]);
    const baseUrl = await servidorFalso(...Array.from({ length: LIMITE_VOLTAS }, () => pedeDeNovo));
    let execucoes = 0;
    const executarFerramenta = () => {
      execucoes++;
      return Promise.resolve({ ok: true as const, valor: [] });
    };

    await expect(rodar(config({ baseUrl }), pedido({ ferramentas, executarFerramenta }))).rejects.toThrow(
      `${LIMITE_VOLTAS} vezes seguidas`,
    );
    expect(recebidos).toHaveLength(LIMITE_VOLTAS);
    // A ferramenta da última chamada não roda: o resultado não voltaria ao modelo.
    expect(execucoes).toBe(LIMITE_VOLTAS - 1);
    expect(execucoes).toBe(24);
  });
});

describe("falhas do provedor", () => {
  test("401 é credencial, sem a chave na mensagem", async () => {
    const baseUrl = await servidorFalso(
      recusa(401, { error: { message: "Incorrect API key provided", code: "invalid_api_key" } }),
    );

    const falha = falhaDe(await rodar(config({ baseUrl, credencial: "moductus/provedor/01JA" })));

    expect(falha).toMatchObject({ motivo: "credencial", voltaEm: null });
    expect(falha.mensagem).toContain("Incorrect API key provided");
    expect(falha.mensagem).not.toContain(CHAVE);
  });

  test("chave e endereço que o servidor devolve no erro saem da mensagem", async () => {
    const baseUrl = await servidorFalso(
      recusa(401, {
        error: { message: `Incorrect API key provided: ${CHAVE}. See https://u:p@exemplo.com/chaves` },
      }),
    );

    const falha = falhaDe(await rodar(config({ baseUrl, credencial: "moductus/provedor/01JA" })));

    expect(falha.mensagem).not.toContain(CHAVE);
    expect(falha.mensagem).not.toContain("u:p@");
    expect(falha.mensagem).toContain("Incorrect API key provided: ***. See (endereço)");
  });

  test("403 sem moderação é credencial", async () => {
    const baseUrl = await servidorFalso(recusa(403, { error: { message: "IP not authorized" } }));

    expect(falhaDe(await rodar(config({ baseUrl })))).toMatchObject({ motivo: "credencial" });
  });

  test("403 da moderação é erro do pedido: a execução falha e o agente não dorme", async () => {
    const baseUrl = await servidorFalso(
      recusa(403, {
        error: {
          code: 403,
          message: 'openai/gpt-5 requires moderation on OpenRouter. Your input was flagged for "violence".',
          metadata: {
            reasons: ["violence"],
            flagged_input: "...",
            provider_name: "OpenAI",
            model_slug: "openai/gpt-5",
          },
        },
      }),
    );

    await expect(rodar(config({ baseUrl }))).rejects.toThrow("HTTP 403");
  });

  test("conta sem crédito na OpenAI (429, formato atual) é credencial, não limite", async () => {
    const baseUrl = await servidorFalso(
      recusa(
        429,
        {
          error: {
            message: "You have run out of credits.",
            type: "insufficient_quota",
            param: null,
            code: "credit_balance_exhausted",
          },
        },
        { "Retry-After": "20" },
      ),
    );

    const falha = falhaDe(await rodar(config({ baseUrl })));

    expect(falha).toMatchObject({ motivo: "credencial", voltaEm: null });
    expect(falha.mensagem).toContain("sem crédito");
  });

  test("402 do OpenRouter (sem crédito) é credencial", async () => {
    const baseUrl = await servidorFalso(
      recusa(402, {
        error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/credits" },
      }),
    );

    const falha = falhaDe(await rodar(config({ baseUrl })));

    expect(falha).toMatchObject({ motivo: "credencial", voltaEm: null });
    expect(falha.mensagem).toContain("Insufficient credits. Add more using (endereço)");
  });

  test("429 é limite, com a hora de volta pelo Retry-After", async () => {
    const baseUrl = await servidorFalso(
      recusa(
        429,
        { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } },
        { "Retry-After": "120" },
      ),
    );

    const falha = falhaDe(await rodar(config({ baseUrl })));

    expect(falha).toEqual({
      motivo: "limite",
      mensagem: "O limite de uso do provedor em " + new URL(baseUrl).host + " acabou: Rate limit reached",
      voltaEm: "2026-10-09T12:02:00.000Z",
    });
  });

  test("404 do Ollama (modelo não baixado) é ausente", async () => {
    const baseUrl = await servidorFalso(
      recusa(404, {
        error: { message: 'model "llama9" not found, try pulling it first', type: "api_error" },
      }),
    );

    const falha = falhaDe(await rodar(config({ baseUrl, modelo: "llama9" })));

    expect(falha.motivo).toBe("ausente");
    expect(falha.mensagem).toContain("try pulling it first");
  });

  test("500 é fora do ar", async () => {
    const baseUrl = await servidorFalso(recusa(503, { error: "overloaded" }));

    expect(falhaDe(await rodar(config({ baseUrl })))).toMatchObject({ motivo: "fora_do_ar", voltaEm: null });
  });

  test("400 é erro do pedido, não do provedor: a execução falha e o agente não dorme", async () => {
    const baseUrl = await servidorFalso(
      recusa(400, { error: { message: "context length exceeded", code: "context_length_exceeded" } }),
    );

    await expect(rodar(config({ baseUrl }))).rejects.toThrow("HTTP 400");
  });

  test("ninguém escutando no endereço (Ollama fechado) é fora do ar", async () => {
    const baseUrl = await servidorFalso();
    servidor!.close();
    servidor = null;

    const falha = falhaDe(await rodar(config({ baseUrl })));

    expect(falha).toMatchObject({ motivo: "fora_do_ar", voltaEm: null });
  });

  test("conexão que cai no meio da resposta é fora do ar, depois do texto que já veio", async () => {
    const baseUrl = await servidorFalso(sse([delta({ content: "Começando" })], { fechar: false }));

    const eventos = await rodar(config({ baseUrl }));

    expect(eventos[0]).toEqual({ tipo: "texto", texto: "Começando" });
    expect(falhaDe(eventos).motivo).toBe("fora_do_ar");
  });

  test("erro mandado no meio do fluxo é classificado como os outros", async () => {
    const baseUrl = await servidorFalso(
      sse([
        delta({ content: "a" }),
        { error: { code: 429, message: "Rate limit exceeded: free-models-per-day" } },
      ]),
    );

    const falha = falhaDe(await rodar(config({ baseUrl })));

    expect(falha.motivo).toBe("limite");
  });

  test("402 no meio do fluxo (OpenRouter) é credencial", async () => {
    const baseUrl = await servidorFalso(
      sse([
        delta({ content: "a" }),
        {
          object: "chat.completion.chunk",
          error: { code: 402, message: "Insufficient credits", metadata: { error_type: "payment_required" } },
          choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
        },
      ]),
    );

    expect(falhaDe(await rodar(config({ baseUrl })))).toMatchObject({ motivo: "credencial", voltaEm: null });
  });

  test("finish_reason error sem objeto de erro é fora do ar", async () => {
    const baseUrl = await servidorFalso(sse([delta({ content: "a" }), delta({ content: "" }, "error")]));

    const eventos = await rodar(config({ baseUrl }));

    expect(falhaDe(eventos)).toMatchObject({ motivo: "fora_do_ar", voltaEm: null });
    expect(eventos.some((e) => e.tipo === "fim")).toBe(false);
  });
});

describe("cancelamento", () => {
  test("abortar no meio do streaming encerra a execução e a conexão", async () => {
    let conexaoFechou!: () => void;
    const fechou = new Promise<void>((resolve) => (conexaoFechou = resolve));
    const baseUrl = await servidorFalso((res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify(delta({ content: "pensando" }))}\n\n`);
      res.on("close", conexaoFechou);
    });
    const controle = new AbortController();
    const eventos: EventoAgente[] = [];

    await expect(
      (async () => {
        for await (const evento of provedor(config({ baseUrl })).executar(pedido(), controle.signal)) {
          eventos.push(evento);
          controle.abort();
        }
      })(),
    ).rejects.toThrow();
    await fechou;
    expect(eventos).toEqual([{ tipo: "texto", texto: "pensando" }]);
  });

  test("cancelar enquanto lê uma recusa é cancelamento, não falha do provedor", async () => {
    const controle = new AbortController();
    const baseUrl = await servidorFalso((res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.write('{"error": {"message": "overlo');
      setTimeout(() => controle.abort(), 30);
    });

    await expect(
      coletar(provedor(config({ baseUrl })).executar(pedido(), controle.signal)),
    ).rejects.toThrow();
  });
});

describe("peças", () => {
  test("Retry-After em segundos ou em data HTTP", () => {
    expect(horaDoRetryAfter("30", AGORA)).toBe("2026-10-09T12:00:30.000Z");
    expect(horaDoRetryAfter("Fri, 09 Oct 2026 13:00:00 GMT", AGORA)).toBe("2026-10-09T13:00:00.000Z");
    expect(horaDoRetryAfter("logo", AGORA)).toBeNull();
    expect(horaDoRetryAfter(null, AGORA)).toBeNull();
  });

  const recusaDe = (mudanca: Partial<Recusa>): Recusa => ({
    status: 429,
    mensagem: "You exceeded your current quota",
    codigo: null,
    tipo: null,
    moderacao: false,
    retryAfter: "10",
    ...mudanca,
  });

  test.each([
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "insufficient_quota",
  ])("conta sem crédito da OpenAI (code %s) é credencial, sem hora", (codigo) => {
    expect(falhaDaRecusa(recusaDe({ codigo }), "a OpenAI", AGORA)).toEqual({
      motivo: "credencial",
      mensagem: "A conta da OpenAI está sem crédito: You exceeded your current quota",
      voltaEm: null,
    });
  });

  test("type insufficient_quota com outro code também é credencial; slow_down segue limite", () => {
    expect(
      falhaDaRecusa(recusaDe({ codigo: "novo_codigo", tipo: "insufficient_quota" }), "a OpenAI", AGORA),
    ).toMatchObject({ motivo: "credencial" });
    expect(
      falhaDaRecusa(recusaDe({ codigo: "slow_down", tipo: "rate_limit_error" }), "a OpenAI", AGORA),
    ).toMatchObject({ motivo: "limite", voltaEm: "2026-10-09T12:00:10.000Z" });
  });

  test("detalhe limpo: sem chave, sem endereço, curto", () => {
    expect(limparDetalhe(`chave ${CHAVE} em http://u:p@h:1/v1/x`, CHAVE)).toBe("chave *** em (endereço)");
    expect(limparDetalhe("x".repeat(500), null)).toHaveLength(300);
  });

  test("resultado em texto vai puro; o resto vai em JSON", () => {
    expect(conteudoDoResultado({ ok: true, valor: "feito" })).toBe("feito");
    expect(conteudoDoResultado({ ok: true, valor: undefined })).toBe("null");
    expect(conteudoDoResultado({ ok: false, erro: "não pode" })).toBe('{"erro":"não pode"}');
  });

  test("o registro monta o adaptador para os dois tipos de API", () => {
    const registro = new RegistroProvedores()
      .registrar("openai-compativel", fabricaOpenAiCompativel({ credenciais }))
      .registrar("openai", fabricaOpenAiCompativel({ credenciais }));

    expect(registro.obter(config())).toBeInstanceOf(ProvedorOpenAiCompativel);
    expect(registro.obter(config({ id: "outro", tipo: "openai" }))).toBeInstanceOf(ProvedorOpenAiCompativel);
  });
});
