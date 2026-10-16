import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta } from "../ferramentas/ferramenta.ts";
import {
  ROTA_PRE_TOOL_USE,
  rotaPreToolUse,
  type RespostaPreToolUse,
} from "../provedores/claude-cli/pre-tool-use.ts";
import type { PedidoDoAgente } from "../provedores/provedor.ts";
import { VERSOES_MCP, type ExecucaoMcp } from "./protocolo.ts";
import { abrirServidorMcp, RECUSA_TOKEN_MCP, type RotaDaExecucao, type ServidorMcp } from "./servidor.ts";

const abertos: ServidorMcp[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.fechar();
  vi.restoreAllMocks();
});

async function servidor(rotas: readonly RotaDaExecucao[] = []): Promise<ServidorMcp> {
  const s = await abrirServidorMcp(0, rotas);
  abertos.push(s);
  return s;
}

const executadas: unknown[] = [];

const catalogo = new Catalogo([
  ferramenta({
    nome: "sessoes.listar",
    descricao: "Lista as sessões de IA abertas",
    entrada: z.object({ projeto: z.string().optional() }),
    efeito: "leitura",
    executar: (entrada) => {
      executadas.push(entrada);
      return [{ id: "s1", projeto: entrada.projeto ?? "moductus" }];
    },
  }),
  ferramenta({
    nome: "financas.lancar",
    descricao: "Registra um gasto",
    entrada: z.object({ valor: z.number().positive() }),
    efeito: "interno",
    desfazer: () => {},
    executar: () => "lançado",
  }),
  ferramenta({
    nome: "github.comentar",
    descricao: "Comenta num PR",
    entrada: z.object({ texto: z.string() }),
    efeito: "externo",
    executar: () => "comentado",
    cartao: () => ({ descricao: "Vou comentar no PR.", rotulo: "Comentar no PR" }),
  }),
]);

/** O que o runtime monta para uma execução: o recorte do agente e o executor dele. */
function execucao(padroes: string[], sinal = new AbortController().signal): ExecucaoMcp {
  const escopo = catalogo.doAgente(padroes);
  const pedido: Pick<PedidoDoAgente, "ferramentas" | "executarFerramenta"> = {
    ferramentas: escopo.oferecidas(),
    executarFerramenta: escopo.executor({ agenteId: "nuno", execucaoId: "exec-1", sinal }),
  };
  return pedido;
}

let proximoId = 1;
function postar(url: string, corpo: unknown, cabecalhos: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...cabecalhos,
    },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

/** Um pedido JSON-RPC com o token da execução; devolve o `result` ou o `error`. */
async function rpc(
  acesso: { url: string; token: string },
  method: string,
  params?: unknown,
): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const id = proximoId++;
  const res = await postar(
    acesso.url,
    { jsonrpc: "2.0", id, method, params },
    { authorization: `Bearer ${acesso.token}` },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const resposta = (await res.json()) as { id: number };
  expect(resposta.id).toBe(id);
  return resposta as never;
}

describe("servidor MCP do Moductus", () => {
  test("sem token, com token errado ou com acesso encerrado: 401", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await servidor();
    const acesso = s.abrir(execucao(["sessoes.*"]));
    const pedido = { jsonrpc: "2.0", id: 1, method: "tools/list" };

    const semToken = await postar(s.url, pedido);
    expect(semToken.status).toBe(401);
    expect(await semToken.text()).toBe(RECUSA_TOKEN_MCP);
    expect((await postar(s.url, pedido, { authorization: "Bearer outro" })).status).toBe(401);
    expect((await postar(s.url, pedido, { authorization: acesso.token })).status).toBe(401);
    expect((await postar(s.url, pedido, { authorization: `Bearer ${acesso.token}` })).status).toBe(200);

    acesso.fechar();
    expect((await postar(s.url, pedido, { authorization: `Bearer ${acesso.token}` })).status).toBe(401);
    // O token nunca vai para o log.
    for (const [linha] of vi.mocked(console.error).mock.calls)
      expect(String(linha)).not.toContain(acesso.token);
  });

  test("o ciclo do CLI: initialize, notificação, lista e chamada pelo catálogo", async () => {
    const s = await servidor();
    const acesso = s.abrir(execucao(["sessoes.*", "financas.lancar"]));
    expect(acesso.url).toBe(s.url);
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const inicio = await rpc(acesso, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1.287" },
    });
    expect(inicio.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "moductus" },
    });

    const notificacao = await postar(
      acesso.url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { authorization: `Bearer ${acesso.token}` },
    );
    expect(notificacao.status).toBe(202);
    expect(await notificacao.text()).toBe("");

    // O nome publicado é o do modelo (`dominio__acao`), o mesmo do --allowedTools.
    const lista = await rpc(acesso, "tools/list");
    expect(lista.result?.tools).toEqual([
      {
        name: "financas__lancar",
        description: "Registra um gasto",
        inputSchema: expect.objectContaining({ type: "object", required: ["valor"] }),
      },
      {
        name: "sessoes__listar",
        description: "Lista as sessões de IA abertas",
        inputSchema: expect.objectContaining({ type: "object" }),
      },
    ]);

    executadas.length = 0;
    const chamada = await rpc(acesso, "tools/call", {
      name: "sessoes__listar",
      arguments: { projeto: "moductus" },
    });
    expect(chamada.result).toEqual({
      content: [{ type: "text", text: '[{"id":"s1","projeto":"moductus"}]' }],
      isError: false,
    });
    expect(executadas).toEqual([{ projeto: "moductus" }]);

    // Sem `arguments`, a entrada é vazia; texto devolvido vai como está.
    const sem = await rpc(acesso, "tools/call", { name: "financas__lancar" });
    expect(sem.result).toMatchObject({ isError: true });
    const lancar = await rpc(acesso, "tools/call", { name: "financas__lancar", arguments: { valor: 10 } });
    expect(lancar.result).toEqual({ content: [{ type: "text", text: "lançado" }], isError: false });

    expect((await rpc(acesso, "ping")).result).toEqual({});
  });

  test("versão do protocolo desconhecida: responde com a mais nova que entende", async () => {
    const s = await servidor();
    const acesso = s.abrir(execucao([]));
    const inicio = await rpc(acesso, "initialize", { protocolVersion: "2099-01-01" });
    expect(inicio.result?.protocolVersion).toBe(VERSOES_MCP[0]);
  });

  test("cabeçalho MCP-Protocol-Version: versão desconhecida é 400; conhecida ou ausente, segue", async () => {
    const s = await servidor();
    const acesso = s.abrir(execucao([]));
    const auth = { authorization: `Bearer ${acesso.token}` };
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

    const desconhecida = await postar(acesso.url, ping, { ...auth, "mcp-protocol-version": "2099-01-01" });
    expect(desconhecida.status).toBe(400);
    expect(await desconhecida.text()).toBe("versão do protocolo MCP não suportada");

    for (const versao of VERSOES_MCP) {
      expect((await postar(acesso.url, ping, { ...auth, "mcp-protocol-version": versao })).status).toBe(200);
    }
    // Sem o cabeçalho, é um cliente de 2025-03-26: atendido normalmente.
    expect((await postar(acesso.url, ping, auth)).status).toBe(200);
  });

  test("cada execução só enxerga e só roda as ferramentas dela", async () => {
    const s = await servidor();
    const doNuno = s.abrir(execucao(["sessoes.*"]));
    const daTula = s.abrir(execucao(["financas.*"]));
    expect(doNuno.token).not.toBe(daTula.token);

    const nomes = async (acesso: typeof doNuno) =>
      ((await rpc(acesso, "tools/list")).result?.tools as { name: string }[]).map((t) => t.name);
    expect(await nomes(doNuno)).toEqual(["sessoes__listar"]);
    expect(await nomes(daTula)).toEqual(["financas__lancar"]);

    const fora = await rpc(doNuno, "tools/call", { name: "financas__lancar", arguments: { valor: 1 } });
    expect(fora.result).toEqual({
      content: [
        {
          type: "text",
          text: 'A ferramenta "financas__lancar" não está disponível. Use uma das ferramentas oferecidas.',
        },
      ],
      isError: true,
    });

    // Fechar o acesso de uma execução não mexe no da outra.
    doNuno.fechar();
    expect(await nomes(daTula)).toEqual(["financas__lancar"]);
  });

  test("o que roda pelo MCP passa pelo executor do pedido, nunca direto pelo catálogo", async () => {
    const s = await servidor();
    const executarFerramenta = vi.fn().mockResolvedValue({ ok: true, valor: { feito: true } });
    const escopo = catalogo.doAgente(["sessoes.*"]);
    const acesso = s.abrir({ ferramentas: escopo.oferecidas(), executarFerramenta });
    const r = await rpc(acesso, "tools/call", { name: "sessoes__listar", arguments: { projeto: "x" } });
    expect(r.result).toEqual({ content: [{ type: "text", text: '{"feito":true}' }], isError: false });
    expect(executarFerramenta).toHaveBeenCalledWith({
      id: expect.stringMatching(/^mcp-/),
      nome: "sessoes__listar",
      entrada: { projeto: "x" },
    });
  });

  test("entrada inválida e ação externa sem aprovação voltam ao modelo como erro legível", async () => {
    const s = await servidor();
    const acesso = s.abrir(execucao(["financas.*", "github.*"]));
    const invalida = await rpc(acesso, "tools/call", { name: "financas__lancar", arguments: { valor: -1 } });
    expect(invalida.result).toEqual({
      content: [
        { type: "text", text: "Entrada inválida para financas.lancar. valor: precisa ser maior que 0." },
      ],
      isError: true,
    });
    const externa = await rpc(acesso, "tools/call", { name: "github__comentar", arguments: { texto: "oi" } });
    expect(externa.result).toMatchObject({ isError: true });
    expect(JSON.stringify(externa.result)).toContain("precisa da aprovação do usuário");
  });

  test("execução cancelada: a chamada vira erro de protocolo, sem resultado", async () => {
    const s = await servidor();
    const controle = new AbortController();
    const acesso = s.abrir(execucao(["sessoes.*"], controle.signal));
    controle.abort(new Error("pausado pela bandeja"));
    const r = await rpc(acesso, "tools/call", { name: "sessoes__listar", arguments: {} });
    expect(r.error).toEqual({ code: -32603, message: "sessoes__listar não rodou: pausado pela bandeja" });
  });

  test("erros de protocolo: método desconhecido, sem nome, JSON quebrado e lote", async () => {
    const s = await servidor();
    const acesso = s.abrir(execucao(["sessoes.*"]));
    const auth = { authorization: `Bearer ${acesso.token}` };

    expect((await rpc(acesso, "resources/list")).error?.code).toBe(-32601);
    expect((await rpc(acesso, "tools/call", {})).error?.code).toBe(-32602);

    const quebrado = await postar(acesso.url, "{nao é json", auth);
    expect(quebrado.status).toBe(400);
    expect(await quebrado.json()).toMatchObject({ id: null, error: { code: -32700 } });

    const lote = await postar(
      acesso.url,
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "1.0", id: "b", method: "ping" },
      ],
      auth,
    );
    expect(lote.status).toBe(200);
    expect(await lote.json()).toEqual([
      { jsonrpc: "2.0", id: "a", result: {} },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "mensagem fora do JSON-RPC 2.0" } },
    ]);

    // Resposta do cliente a um pedido que o servidor não fez: aceita e ignora.
    const resposta = await postar(acesso.url, { jsonrpc: "2.0", id: 7, result: {} }, auth);
    expect(resposta.status).toBe(202);
  });

  test("HTTP: só POST em /mcp, sem Origin de navegador e com corpo de tamanho limitado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await servidor();
    const acesso = s.abrir(execucao(["sessoes.*"]));
    const auth = { authorization: `Bearer ${acesso.token}` };
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

    const get = await fetch(acesso.url, { headers: auth });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await fetch(acesso.url, { method: "DELETE", headers: auth })).status).toBe(405);
    expect((await postar(acesso.url.replace("/mcp", "/outra"), ping, auth)).status).toBe(404);
    expect(
      (await postar(acesso.url, ping, { ...auth, origin: "https://site-qualquer.example" })).status,
    ).toBe(403);
    expect((await postar(acesso.url, "x".repeat(1024 * 1024 + 1), auth)).status).toBe(413);
  });

  test("PreToolUse: o acesso da execução decide; Bash e o que é de outro agente são negados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Sem a rota injetada, o servidor não conhece o hook.
    const semRota = await servidor();
    const acessoSemRota = semRota.abrir(execucao(["sessoes.*"]));
    expect(
      (
        await postar(
          new URL(ROTA_PRE_TOOL_USE, semRota.url).href,
          {},
          {
            authorization: `Bearer ${acessoSemRota.token}`,
          },
        )
      ).status,
    ).toBe(404);

    const s = await servidor([rotaPreToolUse]);
    const doNuno = s.abrir(execucao(["sessoes.*", "github.*"]));
    const daTula = s.abrir(execucao(["financas.*"]));
    const rota = new URL(ROTA_PRE_TOOL_USE, s.url).href;
    const evento = (tool_name: string) => ({
      session_id: "s1",
      hook_event_name: "PreToolUse",
      tool_name,
      tool_input: {},
    });
    const decidir = async (acesso: { token: string }, corpo: unknown) => {
      const res = await postar(rota, corpo, { authorization: `Bearer ${acesso.token}` });
      expect(res.status).toBe(200);
      return ((await res.json()) as RespostaPreToolUse).hookSpecificOutput;
    };

    expect(await decidir(doNuno, evento("mcp__moductus__sessoes__listar"))).toMatchObject({
      permissionDecision: "allow",
    });
    // `externo` passa pelo hook; quem espera o cartão é a chamada pelo MCP.
    expect(await decidir(doNuno, evento("mcp__moductus__github__comentar"))).toMatchObject({
      permissionDecision: "allow",
    });
    const bash = await decidir(doNuno, evento("Bash"));
    expect(bash.permissionDecision).toBe("deny");
    expect(bash.permissionDecisionReason).toMatch(/^"Bash" não é uma ferramenta deste agente\./);
    // O mesmo nome, com o acesso de outra execução: a resposta é a da execução do token.
    expect(await decidir(daTula, evento("mcp__moductus__sessoes__listar"))).toMatchObject({
      permissionDecision: "deny",
    });
    expect(await decidir(daTula, evento("mcp__moductus__financas__lancar"))).toMatchObject({
      permissionDecision: "allow",
    });
    // Corpo que não é JSON também volta como negação, com 200: erro HTTP deixaria a chamada seguir.
    expect(await decidir(doNuno, "{quebrado")).toMatchObject({ permissionDecision: "deny" });

    // Sem acesso válido, 401 antes de ler o corpo, como no MCP.
    expect((await postar(rota, evento("Bash"))).status).toBe(401);
    doNuno.fechar();
    expect((await postar(rota, evento("Bash"), { authorization: `Bearer ${doNuno.token}` })).status).toBe(
      401,
    );
    expect((await fetch(rota, { headers: { authorization: `Bearer ${daTula.token}` } })).status).toBe(405);
  });
});
