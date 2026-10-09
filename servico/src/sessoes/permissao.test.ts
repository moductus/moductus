import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type Aprovacao, type NomeMetodo } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test } from "vitest";
import { abrirServidorWs, semAtendente, type ServidorWs } from "../api/servidor.ts";
import { MENSAGEM_NEGADO, RepositorioAprovacoes, ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../banco/conexao.ts";
import {
  atenderHooks,
  descreverPedido,
  MENSAGEM_REGRA_NEGA,
  PRAZO_PERMISSAO_MS,
  respostaPermissao,
  TIMEOUT_HOOK_PERMISSAO_MS,
  type OpcoesPermissao,
} from "./permissao.ts";
import { abrirReceptorHooks } from "./receptor.ts";
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
});

const SESSAO = "4f1c2e1a-8d7b-4b8e-9a3c-2f0d1e6b7a90";

/** O corpo que o Claude Code 2.x manda no hook (AGENTS.md §5.1). */
const corpoHook = (tipo: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: SESSAO,
    transcript_path: "C:\\t.jsonl",
    cwd: "V:\\moductus",
    permission_mode: "default",
    hook_event_name: tipo,
    ...extra,
  });

const pedidoBash = (command: string) =>
  corpoHook("PermissionRequest", { tool_name: "Bash", tool_input: { command, description: "Roda" } });

/**
 * O caminho de verdade: receptor → sessões e aprovações num banco migrado → canal → o cliente
 * das janelas, que vê o cartão e decide como o dock decide.
 */
async function montar(opcoes: OpcoesPermissao = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-permissao-"));
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
  const aprovacoes = new ServicoAprovacoes(new RepositorioAprovacoes(db), {
    aprovacao: (a) => servidor?.emitir("aprovacoes.mudou", a),
    regras: (r) => servidor?.emitir("regras.mudou", r),
  });
  servidor = await abrirServidorWs(TOKEN_JANELAS, {
    ...semAtendente(Object.keys(METODOS) as NomeMetodo[]),
    "aprovacoes.pendentes": () => aprovacoes.pendentes(),
    "aprovacoes.decidir": (p) => aprovacoes.decidir(p),
    "regras.listar": () => aprovacoes.regras(),
  });
  abertos.push(servidor);
  const receptor = await abrirReceptorHooks(TOKEN_HOOKS, atenderHooks(sessoes, aprovacoes, opcoes), 0);
  abertos.push(receptor);
  const dock = new ClienteServico();
  clientes.push(dock);
  const conectado = new Promise<void>((pronto) => dock.aoMudarEstado((e) => e === "conectado" && pronto()));
  dock.conectar({ porta: servidor.porta, token: TOKEN_JANELAS });
  await conectado;

  /** O próximo aviso de cartão no estado pedido. */
  const aviso = (estado: Aprovacao["estado"]) =>
    new Promise<Aprovacao>((pronto) => {
      const parar = dock.ouvir("aprovacoes.mudou", (a) => {
        if (a.estado !== estado) return;
        parar();
        pronto(a);
      });
    });

  const postar = (corpo: string, sinal?: AbortSignal) =>
    fetch(`http://127.0.0.1:${receptor.porta}/hooks/claude-code`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN_HOOKS}` },
      body: corpo,
      signal: sinal,
    });

  return { dock, aviso, postar, receptor, aprovacoes };
}

describe("aprovar pelo dock", () => {
  test("o PermissionRequest vira cartão e a resposta espera o Permitir do dock", async () => {
    const { dock, aviso, postar } = await montar();
    const pendente = aviso("pendente");
    const resposta = postar(pedidoBash("pnpm test -- --watch=false"));
    const cartao = await pendente;
    expect(cartao).toMatchObject({
      fonte: "claude-code",
      agenteId: null,
      descricao: "Quer rodar o comando abaixo.",
      acao: {
        ferramenta: "Bash",
        entrada: { command: "pnpm test -- --watch=false", description: "Roda" },
        rotulo: null,
        rotuloRecusar: null,
      },
    });
    expect(await dock.pedir("aprovacoes.pendentes")).toHaveLength(1);

    // Até a decisão, a resposta não sai.
    const cedo = await Promise.race([
      resposta.then(() => "saiu"),
      new Promise((p) => setTimeout(p, 100, "esperando")),
    ]);
    expect(cedo).toBe("esperando");

    await dock.pedir("aprovacoes.decidir", { id: cartao.id, decisao: "permitir" });
    const r = await resposta;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(await dock.pedir("aprovacoes.pendentes")).toEqual([]);
  });

  test("Negar devolve deny com a mensagem escrita, ou a padrão", async () => {
    const { dock, aviso, postar } = await montar();
    for (const [mensagem, esperada] of [
      ["Use pnpm, não npm", "Use pnpm, não npm"],
      [undefined, MENSAGEM_NEGADO],
    ] as const) {
      const pendente = aviso("pendente");
      const resposta = postar(pedidoBash("npm install"));
      const { id } = await pendente;
      await dock.pedir("aprovacoes.decidir", { id, decisao: "negar", ...(mensagem ? { mensagem } : {}) });
      expect(await (await resposta).json()).toEqual({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "deny", message: esperada },
        },
      });
    }
  });

  test("Sempre neste projeto vira regra: o próximo pedido igual sai na hora, sem cartão; outro comando pede", async () => {
    const { dock, aviso, postar } = await montar();
    const pendente = aviso("pendente");
    const primeira = postar(pedidoBash("pnpm test"));
    const { id } = await pendente;
    const decidida = await dock.pedir("aprovacoes.decidir", { id, decisao: "permitir", sempre: "projeto" });
    expect(decidida.regraCriadaId).not.toBeNull();
    // Só o allow: nada de `updatedPermissions` no Claude Code; a regra é do Moductus.
    expect(await (await primeira).json()).toEqual(respostaPermissao("permitir", null));
    expect(await dock.pedir("regras.listar")).toMatchObject([
      { escopo: "projeto", ferramenta: "Bash", padrao: "pnpm test", decisao: "permitir" },
    ]);

    const cartoes: Aprovacao[] = [];
    const parar = dock.ouvir("aprovacoes.mudou", (a) => cartoes.push(a));
    const segunda = await postar(pedidoBash("pnpm test"));
    expect(await segunda.json()).toEqual(respostaPermissao("permitir", null));
    await new Promise((p) => setTimeout(p, 50));
    expect(cartoes).toEqual([]);
    parar();

    const outro = aviso("pendente");
    const terceira = postar(pedidoBash("pnpm test && rm -rf ."));
    const { id: idOutro } = await outro;
    await dock.pedir("aprovacoes.decidir", { id: idOutro, decisao: "negar" });
    expect((await (await terceira).json()) as object).toMatchObject({
      hookSpecificOutput: { decision: { behavior: "deny" } },
    });
  });

  test("regra de negar decide sem cartão, com a mensagem da regra", async () => {
    const { dock, aviso, postar } = await montar();
    const pendente = aviso("pendente");
    const primeira = postar(pedidoBash("git push --force"));
    const { id } = await pendente;
    await dock.pedir("aprovacoes.decidir", { id, decisao: "negar", sempre: "projeto" });
    await primeira;
    expect(await (await postar(pedidoBash("git push --force"))).json()).toEqual(
      respostaPermissao("negar", MENSAGEM_REGRA_NEGA),
    );
  });

  test("sem decisão no prazo, a resposta sai vazia (o terminal decide) e o cartão expira", async () => {
    const { dock, aviso, postar } = await montar({ prazoMs: 80 });
    const expirou = aviso("expirada");
    const r = await postar(pedidoBash("pnpm build"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({});
    expect((await expirou).acao.entrada).toEqual({ command: "pnpm build", description: "Roda" });
    expect(await dock.pedir("aprovacoes.pendentes")).toEqual([]);
  });

  test("o prazo fica abaixo do timeout de 600 s do hook", () => {
    expect(TIMEOUT_HOOK_PERMISSAO_MS).toBe(600_000);
    expect(PRAZO_PERMISSAO_MS).toBeLessThan(TIMEOUT_HOOK_PERMISSAO_MS);
    expect(PRAZO_PERMISSAO_MS).toBeGreaterThanOrEqual(TIMEOUT_HOOK_PERMISSAO_MS - 30_000);
  });

  test("a conexão do hook caiu (respondido no terminal, Claude Code fechado): o cartão expira", async () => {
    const { dock, aviso, postar } = await montar();
    const pendente = aviso("pendente");
    const expirou = aviso("expirada");
    const desistir = new AbortController();
    const resposta = postar(pedidoBash("pnpm lint"), desistir.signal).catch((e: unknown) => e);
    const { id } = await pendente;
    desistir.abort();
    expect(await resposta).toBeInstanceOf(Error);
    expect((await expirou).id).toBe(id);
    // Decidir depois não muda nada: o cartão volta como expirou.
    expect((await dock.pedir("aprovacoes.decidir", { id, decisao: "permitir" })).estado).toBe("expirada");
  });

  test("o Moductus fechando no meio solta o Claude Code e expira o cartão", async () => {
    const { aprovacoes, aviso, postar, receptor } = await montar();
    const pendente = aviso("pendente");
    const resposta = postar(pedidoBash("pnpm dev")).catch((e: unknown) => e);
    const { id } = await pendente;
    await receptor.fechar();
    // Sem resposta, o hook falha e o Claude Code segue com o diálogo do terminal.
    expect(await resposta).toBeInstanceOf(Error);
    await expect(aprovacoes.esperar(id)).resolves.toMatchObject({ aprovacao: { estado: "expirada" } });
  });

  test("a sessão seguiu (Stop ou novo pedido do usuário): o cartão pendente expira e a resposta sai vazia", async () => {
    const { aviso, postar } = await montar();
    for (const seguiu of ["Stop", "UserPromptSubmit"]) {
      const pendente = aviso("pendente");
      const expirou = aviso("expirada");
      const resposta = postar(pedidoBash("pnpm test"));
      await pendente;
      await postar(corpoHook(seguiu, { prompt: "deixa pra lá" }));
      await expirou;
      expect(await (await resposta).json(), seguiu).toEqual({});
    }
  });

  test("pergunta ao usuário (AskUserQuestion, ExitPlanMode) e pedido sem ferramenta não viram cartão", async () => {
    const { dock, postar } = await montar();
    for (const tool_name of ["AskUserQuestion", "ExitPlanMode", undefined]) {
      const r = await postar(corpoHook("PermissionRequest", { tool_name, tool_input: { plan: "x" } }));
      expect(await r.json(), String(tool_name)).toEqual({});
    }
    expect(await dock.pedir("aprovacoes.pendentes")).toEqual([]);
  });

  test("outros eventos seguem sem decisão", async () => {
    const { postar } = await montar();
    const r = await postar(corpoHook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }));
    expect(await r.json()).toEqual({});
  });
});

describe("descrição do cartão", () => {
  test("verbo pelo tipo da ferramenta; o resto diz o nome", () => {
    expect(descreverPedido("Bash")).toBe("Quer rodar o comando abaixo.");
    expect(descreverPedido("PowerShell")).toBe("Quer rodar o comando abaixo.");
    expect(descreverPedido("Edit")).toBe("Quer alterar o arquivo abaixo.");
    expect(descreverPedido("Write")).toBe("Quer alterar o arquivo abaixo.");
    expect(descreverPedido("Read")).toBe("Quer ler o arquivo abaixo.");
    expect(descreverPedido("WebFetch")).toBe("Quer abrir o endereço abaixo.");
    expect(descreverPedido("mcp__github__create_issue")).toBe("Quer usar mcp__github__create_issue.");
  });
});
