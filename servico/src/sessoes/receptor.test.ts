import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type MudancaSessao, type NomeMetodo } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirServidorWs, semAtendente, type ServidorWs } from "../api/servidor.ts";
import { abrirBanco } from "../banco/conexao.ts";
import type { EventoHook } from "./hooks.ts";
import {
  abrirReceptorHooks,
  CORPO_MAXIMO,
  PORTA_HOOKS_PADRAO,
  portaDosHooks,
  RECUSA_TOKEN,
  type AtenderHook,
  type ReceptorHooks,
} from "./receptor.ts";
import { RepositorioSessoes, ServicoSessoes } from "./sessoes.ts";

const TOKEN_HOOKS = "h".repeat(43);
const TOKEN_JANELAS = "j".repeat(64);

const abertos: { fechar(): Promise<void> }[] = [];
const clientes: ClienteServico[] = [];
const bancos: DatabaseSync[] = [];
const pastas: string[] = [];
afterEach(async () => {
  for (const c of clientes.splice(0)) c.fechar();
  for (const s of abertos.splice(0)) await s.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function receptor(atender: AtenderHook): Promise<ReceptorHooks> {
  // Porta 0 nos testes: a fixa pode estar com o Moductus de verdade.
  const r = await abrirReceptorHooks(TOKEN_HOOKS, atender, 0);
  abertos.push(r);
  return r;
}

const corpoHook = (tipo: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: "4f1c2e1a-8d7b-4b8e-9a3c-2f0d1e6b7a90",
    transcript_path: "C:\\t.jsonl",
    cwd: "V:\\moductus",
    hook_event_name: tipo,
    ...extra,
  });

function postar(
  porta: number,
  corpo: string,
  cabecalhos: Record<string, string> = {},
  rota = "/hooks/claude-code",
) {
  return fetch(`http://127.0.0.1:${porta}${rota}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN_HOOKS}`, ...cabecalhos },
    body: corpo,
  });
}

describe("receptor dos hooks", () => {
  test("evento com token chega ao atendente com a ferramenta da rota; resposta vazia é {}", async () => {
    const recebidos: [string, EventoHook][] = [];
    const r = await receptor((ferramenta, evento) => void recebidos.push([ferramenta, evento]));
    const resposta = await postar(
      r.porta,
      corpoHook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
    );
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({});
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]?.[0]).toBe("claude-code");
    expect(recebidos[0]?.[1]).toMatchObject({ tipo: "PreToolUse", ferramenta: "Bash", resumo: "ls" });
  });

  test("o que o atendente devolve, mesmo demorando, vira o corpo da resposta", async () => {
    const decisao = {
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    };
    const r = await receptor(async () => {
      await new Promise((pronto) => setTimeout(pronto, 50));
      return decisao;
    });
    expect(await (await postar(r.porta, corpoHook("PermissionRequest"))).json()).toEqual(decisao);
  });

  test("sem token, com token errado ou com a variável não expandida: 401 com a explicação, e nada chega", async () => {
    const atender = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await receptor(atender);
    for (const authorization of [
      "",
      "Bearer ",
      "Bearer errado",
      `Basic ${TOKEN_HOOKS}`,
      "Bearer $MODUCTUS_HOOKS_TOKEN",
      `Bearer ${TOKEN_HOOKS}x`,
    ]) {
      const resposta = await postar(r.porta, corpoHook("SessionStart"), { authorization });
      expect(resposta.status, authorization).toBe(401);
      expect(await resposta.text()).toBe(RECUSA_TOKEN);
    }
    expect(atender).not.toHaveBeenCalled();
    // O log diz que recusou, sem nenhum token.
    expect(log).toHaveBeenCalled();
    for (const [linha] of log.mock.calls) expect(String(linha)).not.toContain(TOKEN_HOOKS.slice(0, 8));
  });

  test("rota, método, JSON e evento inválidos são recusados sem chegar ao atendente", async () => {
    const atender = vi.fn();
    const r = await receptor(atender);
    expect((await postar(r.porta, corpoHook("Stop"), {}, "/hooks/codex")).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${r.porta}/hooks/claude-code`)).status).toBe(405);
    expect((await postar(r.porta, "{não é json")).status).toBe(400);
    expect((await postar(r.porta, JSON.stringify({ cwd: "V:\\x" }))).status).toBe(400);
    expect((await postar(r.porta, "x".repeat(CORPO_MAXIMO + 1))).status).toBe(413);
    expect(atender).not.toHaveBeenCalled();
  });

  test("falha no atendente responde 500 sem decisão", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await receptor(() => {
      throw new Error("banco ocupado");
    });
    expect((await postar(r.porta, corpoHook("Stop"))).status).toBe(500);
  });

  test("porta ocupada rejeita a abertura", async () => {
    const r = await receptor(() => undefined);
    await expect(abrirReceptorHooks(TOKEN_HOOKS, () => undefined, r.porta)).rejects.toThrow();
  });

  test("porta fixa 47821, trocável pela variável", () => {
    expect(portaDosHooks({})).toBe(PORTA_HOOKS_PADRAO);
    expect(PORTA_HOOKS_PADRAO).toBe(47821);
    expect(portaDosHooks({ MODUCTUS_HOOKS_PORTA: "50000" })).toBe(50000);
    expect(portaDosHooks({ MODUCTUS_HOOKS_PORTA: "abc" })).toBe(PORTA_HOOKS_PADRAO);
    expect(portaDosHooks({ MODUCTUS_HOOKS_PORTA: "70000" })).toBe(PORTA_HOOKS_PADRAO);
  });
});

describe("do hook ao dock", () => {
  /** O caminho de verdade: receptor → serviço de sessões com banco → canal → cliente das janelas. */
  async function montar() {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-hooks-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta);
    bancos.push(db);
    let servidor: ServidorWs | null = null;
    const sessoes = new ServicoSessoes(
      new RepositorioSessoes(db),
      (m) => servidor?.emitir("sessoes.mudou", m),
      {
        raizDoProjeto: (cwd) => cwd,
      },
    );
    servidor = await abrirServidorWs(TOKEN_JANELAS, {
      ...semAtendente(Object.keys(METODOS) as NomeMetodo[]),
      "sessoes.listar": () => sessoes.listar(),
      "sessoes.eventos": (p) => sessoes.eventos(p),
    });
    abertos.push(servidor);
    const r = await receptor((ferramenta, evento) => void sessoes.registrar(ferramenta, evento));
    const dock = new ClienteServico();
    clientes.push(dock);
    const conectado = new Promise<void>((pronto) => dock.aoMudarEstado((e) => e === "conectado" && pronto()));
    dock.conectar({ porta: servidor.porta, token: TOKEN_JANELAS });
    await conectado;
    return { r, dock };
  }

  test("o evento chega ao dock em menos de 300 ms, com o estado e o projeto", async () => {
    const { r, dock } = await montar();
    const medidas: number[] = [];
    for (const [tipo, estado] of [
      ["SessionStart", "esperando"],
      ["PreToolUse", "trabalhando"],
      ["PermissionRequest", "esperando"],
      ["Stop", "terminou"],
    ] as const) {
      const chegou = new Promise<MudancaSessao>((pronto) => {
        const parar = dock.ouvir("sessoes.mudou", (m) => {
          parar();
          pronto(m);
        });
      });
      const inicio = performance.now();
      await postar(r.porta, corpoHook(tipo, { tool_name: "Bash", tool_input: { command: "pnpm test" } }));
      const m = await chegou;
      medidas.push(performance.now() - inicio);
      expect(m.sessao.estado).toBe(estado);
      expect(m.projeto?.caminho).toBe("V:\\moductus");
    }
    expect(Math.max(...medidas)).toBeLessThan(300);
    const lista = await dock.pedir("sessoes.listar");
    expect(lista.sessoes).toHaveLength(1);
    const eventos = await dock.pedir("sessoes.eventos", { sessaoId: lista.sessoes[0]?.id ?? "" });
    expect(eventos.map((e) => e.tipo)).toEqual(["Stop", "PermissionRequest", "PreToolUse", "SessionStart"]);
  });

  test("evento sem token não chega ao dock nem ao banco", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { r, dock } = await montar();
    const chegou = vi.fn();
    dock.ouvir("sessoes.mudou", chegou);
    expect((await postar(r.porta, corpoHook("SessionStart"), { authorization: "" })).status).toBe(401);
    await new Promise((pronto) => setTimeout(pronto, 100));
    expect(chegou).not.toHaveBeenCalled();
    expect((await dock.pedir("sessoes.listar")).sessoes).toEqual([]);
  });
});
