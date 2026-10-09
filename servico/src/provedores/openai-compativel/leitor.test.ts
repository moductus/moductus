import { describe, expect, test } from "vitest";
import { dadosSse, ErroNoFluxo, LeitorChatCompletions } from "./leitor.ts";

/** Um corpo que chega nos pedaços dados, cortados onde a rede quiser. */
function corpo(...pedacos: string[]): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  return new ReadableStream({
    start(controle) {
      for (const p of pedacos) controle.enqueue(codificador.encode(p));
      controle.close();
    },
  });
}

async function dados(fluxo: ReadableStream<Uint8Array>): Promise<string[]> {
  const lista: string[] = [];
  for await (const dado of dadosSse(fluxo)) lista.push(dado);
  return lista;
}

describe("dadosSse", () => {
  test("junta linha cortada entre pedaços, aceita CRLF e ignora comentário e outros campos", async () => {
    const lidos = await dados(
      corpo(": ping\r\n\r\nevent: x\r\nda", 'ta: {"a":1}\r', "\n\r\ndata:[DONE]\n\n"),
    );

    expect(lidos).toEqual(['{"a":1}', "[DONE]"]);
  });

  test("várias linhas data do mesmo evento se juntam; o último evento sem linha em branco também sai", async () => {
    expect(await dados(corpo("data: a\ndata: b\n\ndata: c"))).toEqual(["a\nb", "c"]);
  });
});

describe("LeitorChatCompletions", () => {
  test("chamada sem índice (servidor que manda inteira) vira uma chamada por item", () => {
    const leitor = new LeitorChatCompletions();
    leitor.lerPedaco(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { id: "a", function: { name: "x", arguments: { n: 1 } } },
                { id: "b", function: { name: "y", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    expect(leitor.chamadasPedidas).toEqual([
      { id: "a", nome: "x", argumentos: '{"n":1}' },
      { id: "b", nome: "y", argumentos: "{}" },
    ]);
    expect(leitor.completa).toBe(true);
  });

  test("pedaço que não é JSON é ignorado; [DONE] fecha", () => {
    const leitor = new LeitorChatCompletions();
    expect(leitor.lerPedaco("isto não é json")).toEqual([]);
    expect(leitor.completa).toBe(false);
    leitor.lerPedaco("[DONE]");
    expect(leitor.terminou).toBe(true);
    expect(leitor.lerPedaco(JSON.stringify({ choices: [{ delta: { content: "tarde" } }] }))).toEqual([]);
  });

  test("erro no fluxo sobe com status e código", () => {
    const leitor = new LeitorChatCompletions();
    let erro: unknown;
    try {
      leitor.lerPedaco(JSON.stringify({ error: { code: 502, message: "Provider returned error" } }));
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroNoFluxo);
    expect(erro).toMatchObject({ status: 502, codigo: null, message: "Provider returned error" });
  });

  test("uso da Groq em x_groq também conta", () => {
    const leitor = new LeitorChatCompletions();
    leitor.lerPedaco(
      JSON.stringify({
        model: "llama-3.3-70b-versatile",
        choices: [{ delta: {}, finish_reason: "stop" }],
        x_groq: { usage: { prompt_tokens: 40, completion_tokens: 8 } },
      }),
    );
    expect(leitor.uso).toEqual({
      tipo: "uso",
      tokensEntrada: 40,
      tokensSaida: 8,
      modelo: "llama-3.3-70b-versatile",
    });
  });

  test("uso zerado não vira número", () => {
    const leitor = new LeitorChatCompletions();
    leitor.lerPedaco(JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }));
    expect(leitor.uso).toBeNull();
  });
});
