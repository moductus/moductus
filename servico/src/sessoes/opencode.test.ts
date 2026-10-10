import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { estadoDepois, lerEventoHook, type EventoHook } from "./hooks.ts";
import { VARIAVEL_TOKEN } from "./ligacao.ts";
import {
  caminhoPluginOpenCode,
  codigoDoPlugin,
  LigacaoOpenCode,
  MARCA_PLUGIN,
  PluginDeOutro,
} from "./opencode.ts";
import { abrirReceptorHooks, type ReceptorHooks } from "./receptor.ts";

const TOKEN = "t".repeat(43);
const SESSAO = "ses_edce5e8d5ffe8xr05SUM7L7SHk";
const PASTA_PROJETO = "V:\\moductus";

const pastas: string[] = [];
const receptores: ReceptorHooks[] = [];
const tokenAntes = process.env[VARIAVEL_TOKEN];
afterEach(async () => {
  for (const r of receptores.splice(0)) await r.fechar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
  if (tokenAntes === undefined) delete process.env[VARIAVEL_TOKEN];
  else process.env[VARIAVEL_TOKEN] = tokenAntes;
});

function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "moductus-opencode-"));
  pastas.push(p);
  return p;
}

/**
 * Carrega o plugin gerado como o OpenCode faz (import do arquivo, chamada de cada export) e o liga
 * a um receptor de verdade, que guarda o que chega.
 */
async function plugin(token: string | null = TOKEN) {
  const recebidos: { evento: EventoHook }[] = [];
  const brutos: string[] = [];
  const fetchReal = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    brutos.push(String(init?.body));
    return fetchReal(url, init);
  });
  const receptor = await abrirReceptorHooks(
    TOKEN,
    (ferramenta, evento) => {
      expect(ferramenta).toBe("opencode");
      recebidos.push({ evento });
      return undefined;
    },
    0,
  );
  receptores.push(receptor);
  const arquivo = join(pasta(), "moductus.js");
  writeFileSync(arquivo, codigoDoPlugin(receptor.porta));
  if (token === null) delete process.env[VARIAVEL_TOKEN];
  else process.env[VARIAVEL_TOKEN] = token;
  const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
  // O OpenCode chama todo export como plugin: só pode haver um.
  expect(Object.keys(modulo)).toEqual(["Moductus"]);
  const ganchos = await (modulo.Moductus as (c: object) => Promise<{ event?: (e: object) => Promise<void> }>)(
    {
      directory: PASTA_PROJETO,
    },
  );
  const enviar = async (event: object) => ganchos.event?.({ event });
  const esperar = async (n: number) => {
    for (let i = 0; i < 100 && recebidos.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return recebidos.map((r) => r.evento);
  };
  return { enviar, esperar, recebidos, brutos, ganchos };
}

// Formas conferidas no OpenCode 1.18.29 (serve + plugin de captura, 09/10/2026).
const sessaoCriada = (extra: object = {}, id = SESSAO) => ({
  type: "session.created",
  properties: { sessionID: id, info: { id, directory: "V:\\moductus\\servico", title: "t", ...extra } },
});
const status = (tipo: string) => ({
  type: "session.status",
  properties: { sessionID: SESSAO, status: { type: tipo } },
});
const parte = (estado: string, tool = "bash", input: object = { command: "pnpm test" }, callID = "c1") => ({
  type: "message.part.updated",
  properties: {
    sessionID: SESSAO,
    part: {
      type: "tool",
      sessionID: SESSAO,
      tool,
      callID,
      state: { status: estado, input, output: "segredo" },
    },
  },
});

describe("plugin do OpenCode", () => {
  test("traduz o ciclo de uma sessão para os eventos dos hooks, e o estado segue", async () => {
    const { enviar, esperar } = await plugin();
    await enviar(sessaoCriada());
    await enviar(status("busy"));
    await enviar(parte("pending"));
    await enviar(parte("running"));
    await enviar(parte("running")); // atualização de metadata: não repete
    await enviar(parte("completed"));
    await enviar(status("idle"));
    await enviar({ type: "session.idle", properties: { sessionID: SESSAO } });
    await enviar({ type: "session.deleted", properties: { sessionID: SESSAO, info: { id: SESSAO } } });
    const eventos = await esperar(6);
    expect(eventos.map((e) => e?.tipo)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SessionEnd",
    ]);
    expect(eventos.every((e) => e?.idSessao === SESSAO)).toBe(true);
    expect(eventos[0]?.cwd).toBe("V:\\moductus\\servico");
    expect(eventos[2]).toMatchObject({ ferramenta: "bash", resumo: "pnpm test" });
    expect(eventos[1]?.cwd).toBe(PASTA_PROJETO);
    let estado: ReturnType<typeof estadoDepois> | null = null;
    const estados = eventos.map((e) => (estado = estadoDepois(e as EventoHook, estado)));
    expect(estados).toEqual([
      "esperando",
      "trabalhando",
      "trabalhando",
      "trabalhando",
      "terminou",
      "terminou",
    ]);
  });

  test("a chamada de ferramenta que falha vira PostToolUseFailure, e o caminho vai como file_path", async () => {
    const { enviar, esperar } = await plugin();
    await enviar(parte("running", "read", { filePath: "V:\\moductus\\README.md" }, "c2"));
    await enviar(parte("error", "read", { filePath: "V:\\moductus\\README.md" }, "c2"));
    const eventos = await esperar(2);
    expect(eventos.map((e) => e?.tipo)).toEqual(["PreToolUse", "PostToolUseFailure"]);
    expect(eventos[0]?.resumo).toBe("V:\\moductus\\README.md");
  });

  test("pedido de permissão deixa a sessão esperando você", async () => {
    const { enviar, esperar } = await plugin();
    await enviar({
      type: "permission.asked",
      properties: { id: "per_1", sessionID: SESSAO, permission: "bash" },
    });
    const [evento] = await esperar(1);
    expect(evento).toMatchObject({ tipo: "Notification", aviso: "permission_prompt", resumo: "bash" });
    expect(estadoDepois(evento as EventoHook, "trabalhando")).toBe("esperando");
  });

  test("nem o conteúdo escrito nem a saída da ferramenta saem do OpenCode", async () => {
    const { enviar, esperar, brutos } = await plugin();
    await enviar(parte("running", "write", { filePath: "a.txt", content: "SEGREDO-DO-ARQUIVO" }, "c3"));
    await enviar(parte("completed", "write", { filePath: "a.txt", content: "SEGREDO-DO-ARQUIVO" }, "c3"));
    await esperar(2);
    expect(brutos).toHaveLength(2);
    expect(brutos.join()).not.toMatch(/SEGREDO|segredo/);
    expect(brutos.join()).toContain("a.txt");
  });

  test("subagente (sessão filha) não vira sessão do Moductus", async () => {
    const { enviar, esperar } = await plugin();
    await enviar(sessaoCriada({ parentID: SESSAO }, "ses_filha"));
    await enviar({
      type: "session.status",
      properties: { sessionID: "ses_filha", status: { type: "busy" } },
    });
    await enviar({ type: "session.idle", properties: { sessionID: "ses_filha" } });
    await enviar(sessaoCriada());
    const eventos = await esperar(1);
    expect(eventos.map((e) => e?.idSessao)).toEqual([SESSAO]);
  });

  test("evento que o Moductus não usa é ignorado", async () => {
    const { enviar, esperar } = await plugin();
    for (const type of [
      "session.updated",
      "session.diff",
      "message.updated",
      "file.edited",
      "todo.updated",
    ]) {
      await enviar({ type, properties: { sessionID: SESSAO } });
    }
    await enviar({ type: "session.error", properties: { sessionID: SESSAO } });
    await enviar({ type: "session.idle", properties: { sessionID: SESSAO } });
    expect((await esperar(1)).map((e) => e?.tipo)).toEqual(["Stop"]);
  });

  test("sem o token do Moductus o plugin não registra nada e não quebra o OpenCode", async () => {
    const { ganchos, recebidos } = await plugin(null);
    expect(ganchos).toEqual({});
    expect(recebidos).toHaveLength(0);
  });

  test("evento torto ou receptor fora do ar nunca lança no OpenCode", async () => {
    const { enviar } = await plugin();
    await expect(
      enviar({ type: "message.part.updated", properties: { part: null } }),
    ).resolves.toBeUndefined();
    await expect(enviar({ type: "session.created" })).resolves.toBeUndefined();
    await expect(enviar({})).resolves.toBeUndefined();
    const arquivo = join(pasta(), "morto.js");
    writeFileSync(arquivo, codigoDoPlugin(1)); // porta onde nada escuta
    process.env[VARIAVEL_TOKEN] = TOKEN;
    const modulo = (await import(pathToFileURL(arquivo).href)) as {
      Moductus: (c: object) => Promise<{ event: (e: object) => Promise<void> }>;
    };
    const { event } = await modulo.Moductus({ directory: PASTA_PROJETO });
    await expect(event({ event: status("busy") })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 100)); // a rejeição do fetch não pode escapar
  });

  test("o token vai no cabeçalho e nunca literal no arquivo do plugin", () => {
    const codigo = codigoDoPlugin(47821);
    expect(codigo).toContain(`process.env.${VARIAVEL_TOKEN}`);
    expect(codigo).not.toContain(TOKEN);
    expect(codigo).toContain("http://127.0.0.1:47821/hooks/opencode");
  });
});

describe("ligação do OpenCode", () => {
  const montar = () => {
    const raiz = pasta();
    const caminho = join(raiz, "opencode", "plugins", "moductus.js");
    return { caminho, ligacao: new LigacaoOpenCode({ caminho, porta: 47821 }) };
  };

  test("liga, mostra a prévia antes, religa sem escrever e desliga apagando o arquivo", () => {
    const { caminho, ligacao } = montar();
    expect(ligacao.situacao()).toBe("desligada");
    const previa = ligacao.previa();
    expect(previa).toMatchObject({ caminho, antes: null });
    expect(existsSync(caminho)).toBe(false);
    expect(ligacao.ligar()).toEqual({ mudou: true });
    expect(readFileSync(caminho, "utf8")).toBe(previa.depois);
    expect(ligacao.situacao()).toBe("ligada");
    expect(ligacao.ligar()).toEqual({ mudou: false });
    expect(ligacao.desligar()).toEqual({ mudou: true });
    expect(existsSync(caminho)).toBe(false);
    expect(ligacao.desligar()).toEqual({ mudou: false });
  });

  test("porta nova deixa a ligação desatualizada e ligar de novo arruma", () => {
    const { caminho, ligacao } = montar();
    ligacao.ligar();
    const outra = new LigacaoOpenCode({ caminho, porta: 50000 });
    expect(outra.situacao()).toBe("desatualizada");
    outra.ligar();
    expect(outra.situacao()).toBe("ligada");
    expect(readFileSync(caminho, "utf8")).toContain(":50000/hooks/opencode");
  });

  test("arquivo de mesmo nome que não é do Moductus não é lido como dele, trocado nem apagado", () => {
    const { caminho, ligacao } = montar();
    mkdirSync(join(caminho, ".."), { recursive: true });
    writeFileSync(caminho, "export const MeuPlugin = async () => ({});\n");
    expect(ligacao.situacao()).toBe("desligada");
    expect(() => ligacao.previa()).toThrow(PluginDeOutro);
    expect(() => ligacao.ligar()).toThrow(PluginDeOutro);
    expect(ligacao.desligar()).toEqual({ mudou: false });
    expect(readFileSync(caminho, "utf8")).toBe("export const MeuPlugin = async () => ({});\n");
  });

  test("a marca é a primeira linha do arquivo", () => {
    expect(codigoDoPlugin(1).startsWith(`${MARCA_PLUGIN}\n`)).toBe(true);
  });

  test("a pasta segue o XDG_CONFIG_HOME, como o OpenCode", () => {
    expect(caminhoPluginOpenCode({ XDG_CONFIG_HOME: "D:\\cfg" }, "C:\\Users\\x")).toBe(
      join("D:\\cfg", "opencode", "plugins", "moductus.js"),
    );
    expect(caminhoPluginOpenCode({}, "C:\\Users\\x")).toBe(
      join("C:\\Users\\x", ".config", "opencode", "plugins", "moductus.js"),
    );
  });
});

describe("hooks do Codex", () => {
  // Corpo de um hook de comando do Codex, nos campos que a documentação lista (hooks, 09/10/2026):
  // o mesmo que o Claude Code manda, então a leitura do serviço é a mesma.
  test("o payload documentado do Codex entra pelo mesmo leitor, e a rota é a do Codex", () => {
    const base = {
      session_id: "019a-codex",
      transcript_path: null,
      cwd: PASTA_PROJETO,
      model: "gpt-5-codex",
      turn_id: "t1",
      permission_mode: "default",
    };
    const stop = lerEventoHook({ ...base, hook_event_name: "Stop", last_assistant_message: "pronto" });
    expect(stop).toMatchObject({
      tipo: "Stop",
      idSessao: "019a-codex",
      cwd: PASTA_PROJETO,
      modelo: "gpt-5-codex",
    });
    expect(estadoDepois(stop as EventoHook, "trabalhando")).toBe("terminou");
    const pedido = lerEventoHook({
      ...base,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "npm test", description: null },
    });
    expect(pedido).toMatchObject({ tipo: "PermissionRequest", ferramenta: "Bash", resumo: "npm test" });
    expect(estadoDepois(pedido as EventoHook, null)).toBe("esperando");
  });
});
