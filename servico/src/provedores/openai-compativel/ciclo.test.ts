import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { Catalogo } from "../../ferramentas/catalogo.ts";
import { ferramenta } from "../../ferramentas/ferramenta.ts";
import { RegistroProvedores } from "../registro.ts";
import { fabricaOpenAiCompativel } from "./openai-compativel.ts";

/**
 * O ciclo inteiro no serviço: runtime, catálogo e banco de verdade, o adaptador falando HTTP com um
 * servidor local no lugar da API. A ferramenta roda pelo executor do runtime (escopo e registro),
 * e a execução grava tokens e custo estimado pela tabela de preços.
 */

let servidor: Server | null = null;
let pasta: string | null = null;
let db: DatabaseSync | null = null;

afterEach(async () => {
  if (db?.isOpen) db.close();
  if (pasta) rmSync(pasta, { recursive: true, force: true });
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise((resolve) => servidor!.close(resolve));
  }
  servidor = db = pasta = null;
});

const sse = (res: ServerResponse, pedacos: readonly unknown[]) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const p of pedacos) res.write(`data: ${JSON.stringify(p)}\n\n`);
  res.end("data: [DONE]\n\n");
};

const escolha = (delta: Record<string, unknown>, fim: string | null = null) => ({
  model: "gpt-5-mini-2025-08-07",
  choices: [{ index: 0, delta, finish_reason: fim }],
});

const uso = (prompt_tokens: number, completion_tokens: number, cached_tokens = 0) => ({
  model: "gpt-5-mini-2025-08-07",
  choices: [],
  usage: { prompt_tokens, completion_tokens, prompt_tokens_details: { cached_tokens } },
});

test("a ferramenta pedida pela API roda no serviço, fica no histórico e a execução grava tokens e custo", async () => {
  const corpos: Array<{ messages: Array<{ role: string; content?: string }> }> = [];
  const respostas = [
    (res: ServerResponse) =>
      sse(res, [
        escolha({
          tool_calls: [
            { index: 0, id: "call_1", type: "function", function: { name: "teste__anotar", arguments: "" } },
          ],
        }),
        escolha({ tool_calls: [{ index: 0, function: { arguments: '{"texto":"comprar café"}' } }] }),
        escolha({}, "tool_calls"),
        uso(200, 15),
      ]),
    (res: ServerResponse) =>
      sse(res, [escolha({ content: "Anotei: comprar café." }), escolha({}, "stop"), uso(300, 10, 128)]),
  ];
  servidor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (p: Buffer) => (corpo += p.toString("utf8")));
    req.on("end", () => {
      corpos.push(JSON.parse(corpo) as (typeof corpos)[number]);
      const atender = respostas.shift();
      if (atender) atender(res);
      else res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => servidor!.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`;

  pasta = mkdtempSync(join(tmpdir(), "moductus-openai-ciclo-"));
  db = abrirBanco(pasta);
  db.prepare(
    "INSERT INTO provedores (id, tipo, nome, modelo, base_url) VALUES ('p-api', 'openai-compativel', 'Local', 'gpt-5-mini', ?)",
  ).run(baseUrl);
  db.exec(`UPDATE agentes SET provedor_id = 'p-api', ferramentas = '["teste.*"]' WHERE id = 'alba'`);
  const anotados: string[] = [];
  const catalogo = new Catalogo([
    ferramenta({
      nome: "teste.anotar",
      descricao: "Anota um texto",
      entrada: z.object({ texto: z.string().min(1) }),
      efeito: "interno",
      desfazer: () => {},
      executar: ({ texto }) => {
        anotados.push(texto);
        return { anotado: texto };
      },
    }),
  ]);
  const execucoes = new RepositorioExecucoes(db);
  const credenciais = { ler: () => Promise.resolve(null) };
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar(
        "openai-compativel",
        fabricaOpenAiCompativel({ credenciais }),
      ),
      catalogo,
    },
    { execucao: () => {}, agente: () => {} },
  );

  const resultado = await runtime.executar({
    agenteId: "alba",
    gatilho: "mensagem",
    mensagens: [{ papel: "usuario", texto: "Anota aí: comprar café" }],
  });

  expect(anotados).toEqual(["comprar café"]);
  expect(resultado.texto).toBe("Anotei: comprar café.");
  expect(resultado.falha).toBeNull();
  expect(resultado.execucao).toMatchObject({
    estado: "ok",
    tokensEntrada: 500,
    tokensSaida: 25,
    cobranca: "por_token",
    // gpt-5-mini: 200×0,25 + 15×2 = 80; (172×0,25 + 128×0,025) + 10×2 = 66,2 → 146 microdólares.
    custoEstimadoMicrodolares: 146,
  });
  expect(execucoes.chamadas(resultado.execucao.id)).toMatchObject([
    { ferramenta: "teste.anotar", efeito: "interno", entrada: { texto: "comprar café" } },
  ]);
  // O modelo recebeu o resultado da ferramenta na segunda volta.
  expect(corpos).toHaveLength(2);
  expect(corpos[1]!.messages.at(-1)).toMatchObject({ role: "tool", content: '{"anotado":"comprar café"}' });
});
