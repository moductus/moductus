import { ResultadoModelosProvedor } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import { ferramentasDoItem, listarModelos } from "./modelos.ts";

const CHAVE = "sk-segredo-de-teste-123";

/** O `fetch` no lugar da rede: guarda o pedido e devolve a resposta gravada. */
function buscarFalso(resposta: () => Response) {
  const pedidos: { url: string; cabecalhos: Record<string, string> }[] = [];
  const buscar = ((url: string, init?: RequestInit) => {
    pedidos.push({ url, cabecalhos: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(resposta());
  }) as typeof fetch;
  return { buscar, pedidos };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

describe("lista de modelos do endereço", () => {
  test("GET /models com a chave no cabeçalho; os modelos sem repetir, em ordem", async () => {
    const { buscar, pedidos } = buscarFalso(() =>
      json({
        object: "list",
        data: [{ id: "qwen3:8b" }, { id: "gemma3:4b" }, { id: "qwen3:8b" }, { id: "" }, { nome: "x" }],
      }),
    );
    const resultado = await listarModelos(
      { tipo: "openai-compativel", baseUrl: "http://localhost:20128/v1/", chave: CHAVE },
      { buscar },
    );

    expect(ResultadoModelosProvedor.parse(resultado)).toEqual({
      ok: true,
      modelos: [
        { id: "gemma3:4b", ferramentas: null },
        { id: "qwen3:8b", ferramentas: null },
      ],
    });
    expect(pedidos).toEqual([
      {
        url: "http://localhost:20128/v1/models",
        cabecalhos: { Accept: "application/json", Authorization: `Bearer ${CHAVE}` },
      },
    ]);
  });

  test("sem chave vai sem Authorization; a OpenAI usa o endereço dela", async () => {
    const { buscar, pedidos } = buscarFalso(() => json({ data: [] }));
    await listarModelos({ tipo: "openai", baseUrl: "http://outro.exemplo/v1", chave: null }, { buscar });
    expect(pedidos[0]).toEqual({
      url: "https://api.openai.com/v1/models",
      cabecalhos: { Accept: "application/json" },
    });
  });

  test("o que o endereço diz sobre ferramentas, e calado é null", () => {
    expect(ferramentasDoItem({ supported_parameters: ["temperature", "tools"] })).toBe(true);
    expect(ferramentasDoItem({ supported_parameters: ["temperature"] })).toBe(false);
    expect(ferramentasDoItem({ capabilities: ["completion", "tool_use"] })).toBe(true);
    expect(ferramentasDoItem({ capabilities: { function_calling: false } })).toBe(false);
    expect(ferramentasDoItem({ capabilities: { vision: true } })).toBeNull();
    expect(ferramentasDoItem({ id: "x" })).toBeNull();
  });

  test("endereço sem a lista (falta o /v1) e resposta que não é lista dizem o que conferir", async () => {
    const semLista = buscarFalso(() => new Response("not found", { status: 404 }));
    await expect(
      listarModelos({ tipo: "openai-compativel", baseUrl: "http://localhost:20128", chave: null }, semLista),
    ).resolves.toEqual({
      ok: false,
      falha: {
        motivo: "ausente",
        mensagem: "A lista de modelos não está em localhost:20128. Confira se o endereço termina em /v1.",
        voltaEm: null,
      },
    });
    const pagina = buscarFalso(() => new Response("<html>painel</html>", { status: 200 }));
    await expect(
      listarModelos({ tipo: "openai-compativel", baseUrl: "http://localhost:20128", chave: null }, pagina),
    ).resolves.toMatchObject({ ok: false, falha: { motivo: "ausente" } });
  });

  test("chave recusada e servidor fora do ar viram falha tipada, sem a chave nem o endereço", async () => {
    const recusa = buscarFalso(() =>
      json({ error: { message: `chave ${CHAVE} inválida`, code: "invalid_api_key" } }, 401),
    );
    const r = await listarModelos(
      { tipo: "openai-compativel", baseUrl: "http://localhost:20128/v1", chave: CHAVE },
      { buscar: recusa.buscar },
    );
    expect(r).toMatchObject({ ok: false, falha: { motivo: "credencial" } });
    expect(JSON.stringify(r)).not.toContain(CHAVE);

    const caido = (() =>
      Promise.reject(
        Object.assign(new TypeError("fetch failed http://localhost:20128/v1/models"), {
          cause: { code: "ECONNREFUSED" },
        }),
      )) as typeof fetch;
    await expect(
      listarModelos(
        { tipo: "openai-compativel", baseUrl: "http://localhost:20128/v1", chave: null },
        { buscar: caido },
      ),
    ).resolves.toEqual({
      ok: false,
      falha: {
        motivo: "fora_do_ar",
        mensagem: "O endereço localhost:20128 não respondeu (ECONNREFUSED).",
        voltaEm: null,
      },
    });
  });
});
