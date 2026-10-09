import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ConfigProvedor, EventoAgente, PedidoDoAgente } from "../provedor.ts";
import { RegistroProvedores } from "../registro.ts";
import {
  argumentosDoClaude,
  fabricaClaudeCli,
  montarPrompt,
  ProvedorClaudeCli,
  type OpcoesClaudeCli,
} from "./claude-cli.ts";

const CLI_FALSO = fileURLToPath(new URL("./fixtures/cli-falso.mjs", import.meta.url));
const gravada = (nome: string) => fileURLToPath(new URL(`./fixtures/2.1.287/${nome}`, import.meta.url));

const config = (mudanca: Partial<ConfigProvedor> = {}): ConfigProvedor => ({
  id: "01JA0000000000000000000001",
  tipo: "claude-cli",
  modelo: null,
  baseUrl: null,
  credencial: null,
  ...mudanca,
});

const pedido = (mudanca: Partial<PedidoDoAgente> = {}): PedidoDoAgente => ({
  agenteId: "nuno",
  execucaoId: "exec-1",
  instrucoes: "Você é o Nuno, agente de dev do Moductus.",
  mensagens: [{ papel: "usuario", texto: "Quais sessões de IA estão abertas agora?" }],
  ferramentas: [{ nome: "sessoes.listar", descricao: "Lista as sessões de IA", esquema: { type: "object" } }],
  executarFerramenta: () => Promise.reject(new Error("o CLI roda a ferramenta pelo MCP")),
  continuarDe: null,
  ...mudanca,
});

async function coletar(eventos: AsyncIterable<EventoAgente>): Promise<EventoAgente[]> {
  const lista: EventoAgente[] = [];
  for await (const evento of eventos) lista.push(evento);
  return lista;
}

let pasta: string;
/** Os processos que o adaptador iniciou, na ordem, para o teste conferir vida e morte. */
let processos: ChildProcessWithoutNullStreams[];

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "moductus-claude-cli-"));
  processos = [];
});

afterEach(async () => {
  // No Windows a pasta só sai depois que nenhum processo a usa como pasta de trabalho.
  for (const p of processos) if (p.exitCode === null) p.kill();
  await Promise.all(processos.map(esperarSaida));
  rmSync(pasta, { recursive: true, force: true });
});

/** O adaptador com o CLI trocado pelo falso, que devolve a saída gravada. */
function comCliFalso(saidas: string[], modo = "normal", extra: OpcoesClaudeCli = {}) {
  const anotacao = join(pasta, "anotacao.json");
  const provedor = new ProvedorClaudeCli(config({ modelo: "haiku" }), {
    pasta,
    ...extra,
    iniciar: (argumentos, opcoes) => {
      const saida = saidas[processos.length] ?? saidas.at(-1) ?? "-";
      const processo = spawn(
        process.execPath,
        [CLI_FALSO, saida, modo, anotacao, "--", ...argumentos],
        opcoes,
      );
      processos.push(processo);
      return processo;
    },
  });
  const anotado = () =>
    JSON.parse(readFileSync(anotacao, "utf8")) as { argumentos: string[]; entrada: string; pasta: string };
  return { provedor, anotado };
}

describe("adaptador Claude Code CLI", () => {
  test("roda a sessão gravada: ferramenta, resultado, texto, uso e fim, e o processo termina", async () => {
    const { provedor, anotado } = comCliFalso([gravada("sessao-com-ferramenta.jsonl")]);
    const eventos = await coletar(provedor.executar(pedido(), new AbortController().signal));

    expect(eventos[0]).toEqual({
      tipo: "ferramenta",
      chamada: {
        id: "toolu_01N6gwQaTSkzQRRptwy6srjm",
        nome: "sessoes.listar",
        entrada: { projeto: "moductus" },
      },
    });
    expect(eventos[1]).toMatchObject({ tipo: "resultado", resultado: { ok: true } });
    expect(eventos.flatMap((e) => (e.tipo === "texto" ? [e.texto] : [])).join("")).toMatch(
      /^Tem duas sessões/,
    );
    expect(eventos.slice(-2)).toEqual([
      { tipo: "uso", tokensEntrada: 20769, tokensSaida: 579 },
      { tipo: "fim", continuacao: "78e523d4-fecc-4ec2-9fd7-87a2c33372d6" },
    ]);
    expect(processos[0]?.exitCode).toBe(0);

    // O pedido chega pela entrada padrão; instruções e modelo pelos argumentos.
    const { argumentos, entrada } = anotado();
    expect(entrada).toBe("Quais sessões de IA estão abertas agora?");
    expect(argumentos.slice(0, 5)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
    expect(argumentos).toContain("Você é o Nuno, agente de dev do Moductus.");
    expect(argumentos[argumentos.indexOf("--append-system-prompt") + 1]).toBe(
      "Você é o Nuno, agente de dev do Moductus.",
    );
    expect(argumentos[argumentos.indexOf("--model") + 1]).toBe("haiku");
    // O argumento vazio sobrevive à linha de comando do Windows: nenhuma ferramenta nativa.
    expect(argumentos[argumentos.indexOf("--tools") + 1]).toBe("");
    expect(argumentos).not.toContain("--resume");
  });

  test("limite gravado vira erro `limite` com a hora de volta", async () => {
    const { provedor } = comCliFalso([gravada("limite-montada.jsonl")]);
    expect(await coletar(provedor.executar(pedido(), new AbortController().signal))).toEqual([
      {
        tipo: "erro",
        falha: {
          motivo: "limite",
          mensagem:
            "O limite de uso do Claude Code acabou: You've hit your limit · resets 5:40pm (America/Sao_Paulo)",
          voltaEm: "2026-10-09T20:40:00.000Z",
        },
      },
    ]);
  });

  test("continuidade: `--resume` com a sessão anterior e só a mensagem nova na entrada", async () => {
    const { provedor, anotado } = comCliFalso([gravada("sessao-com-ferramenta.jsonl")]);
    await coletar(
      provedor.executar(
        pedido({
          continuarDe: "78e523d4-fecc-4ec2-9fd7-87a2c33372d6",
          mensagens: [
            { papel: "usuario", texto: "Quais sessões estão abertas?" },
            { papel: "agente", texto: "Duas." },
            { papel: "usuario", texto: "E qual espera por mim?" },
          ],
        }),
        new AbortController().signal,
      ),
    );
    const { argumentos, entrada, pasta: pastaDoCli } = anotado();
    expect(argumentos[argumentos.indexOf("--resume") + 1]).toBe("78e523d4-fecc-4ec2-9fd7-87a2c33372d6");
    expect(entrada).toBe("E qual espera por mim?");
    // O --resume só acha a sessão na mesma pasta: a do adaptador, não a do serviço.
    expect(pastaDoCli.toLowerCase()).toBe(pasta.toLowerCase());
  });

  test("cancelar pelo AbortSignal encerra o processo e a execução falha com o motivo", async () => {
    // O CLI ainda está trabalhando: nada de `result`, e o processo não sai sozinho.
    const { provedor } = comCliFalso([gravadaSemResult()], "pendurar");
    const controle = new AbortController();
    const eventos = provedor.executar(pedido(), controle.signal)[Symbol.asyncIterator]();
    expect((await eventos.next()).value).toMatchObject({ tipo: "ferramenta" });
    controle.abort(new Error("pausado pela bandeja"));
    await expect(drenar(eventos)).rejects.toThrow("pausado pela bandeja");
    await esperarSaida(processos[0]);
    expect(processos[0]?.killed).toBe(true);
    // Já cancelado, nem sobe outro processo.
    await expect(coletar(provedor.executar(pedido(), controle.signal))).rejects.toThrow(
      "pausado pela bandeja",
    );
    expect(processos).toHaveLength(1);
  });

  test("depois do `result`, espera o CLI sair sozinho em vez de encerrá-lo", async () => {
    const { provedor } = comCliFalso([gravada("sessao-com-ferramenta.jsonl")]);
    await coletar(provedor.executar(pedido(), new AbortController().signal));
    expect(processos[0]?.killed).toBe(false);
    expect(processos[0]?.exitCode).toBe(0);
  });

  test("CLI que não está instalado vira erro `ausente`", async () => {
    const provedor = new ProvedorClaudeCli(config(), { comando: "claude-que-nao-existe-moductus", pasta });
    expect(await coletar(provedor.executar(pedido(), new AbortController().signal))).toEqual([
      {
        tipo: "erro",
        falha: {
          motivo: "ausente",
          mensagem:
            "O Claude Code não foi encontrado (claude-que-nao-existe-moductus). Instale o CLI ou escolha outro modelo para o agente.",
          voltaEm: null,
        },
      },
    ]);
  });

  test("CLI que sai sem `result` falha a execução com o que escreveu no stderr", async () => {
    const { provedor } = comCliFalso(["-"], "falhar");
    await expect(coletar(provedor.executar(pedido(), new AbortController().signal))).rejects.toThrow(
      /saiu sem resposta \(código 1\): Error: No conversation found/,
    );
  });

  test("um processo por agente: o segundo pedido do mesmo agente espera; outro agente não", async () => {
    const semResult = gravadaSemResult();
    const { provedor } = comCliFalso([semResult], "pendurar");
    const primeiro = new AbortController();
    const doNuno = provedor.executar(pedido(), primeiro.signal)[Symbol.asyncIterator]();
    expect((await doNuno.next()).value).toMatchObject({ tipo: "ferramenta" });

    const segundo = provedor.executar(pedido({ execucaoId: "exec-2" }), new AbortController().signal);
    const proximoDoNuno = segundo[Symbol.asyncIterator]().next();
    const daAlba = provedor.executar(pedido({ agenteId: "alba" }), new AbortController().signal);
    expect((await daAlba[Symbol.asyncIterator]().next()).value).toMatchObject({ tipo: "ferramenta" });
    expect(processos).toHaveLength(2); // Nuno e Alba; o segundo do Nuno ainda na fila

    primeiro.abort(new Error("fim do primeiro"));
    await expect(drenar(doNuno)).rejects.toThrow("fim do primeiro");
    expect((await proximoDoNuno).value).toMatchObject({ tipo: "ferramenta" });
    expect(processos).toHaveLength(3);
  });

  test("pedido cancelado enquanto espera na fila sai sem iniciar processo", async () => {
    const { provedor } = comCliFalso([gravadaSemResult()], "pendurar");
    const primeiro = new AbortController();
    const doNuno = provedor.executar(pedido(), primeiro.signal)[Symbol.asyncIterator]();
    await doNuno.next();

    const naFila = new AbortController();
    const esperando = provedor
      .executar(pedido({ execucaoId: "exec-2" }), naFila.signal)
      [Symbol.asyncIterator]();
    const resultado = esperando.next();
    naFila.abort(new Error("desisti"));
    await expect(resultado).rejects.toThrow("desisti");
    expect(processos).toHaveLength(1);

    primeiro.abort(new Error("fim"));
    await expect(drenar(doNuno)).rejects.toThrow("fim");
    // A fila andou: o próximo pedido do Nuno sobe na hora.
    const terceiro = provedor.executar(pedido({ execucaoId: "exec-3" }), new AbortController().signal);
    expect((await terceiro[Symbol.asyncIterator]().next()).value).toMatchObject({ tipo: "ferramenta" });
  });

  test("a fábrica registra o tipo claude-cli no registro de provedores", () => {
    const registro = new RegistroProvedores().registrar("claude-cli", fabricaClaudeCli({ pasta }));
    const provedor = registro.obter(config());
    expect(provedor).toBeInstanceOf(ProvedorClaudeCli);
    expect(provedor.id).toBe("01JA0000000000000000000001");
  });
});

describe("argumentos e prompt", () => {
  test("MCP do Moductus: token por variável, nunca literal, e só as ferramentas do agente", () => {
    const argumentos = argumentosDoClaude(pedido(), config(), {
      mcp: { url: "http://127.0.0.1:47822/mcp", variavelToken: "MODUCTUS_MCP_TOKEN" },
      ambiente: { MODUCTUS_MCP_TOKEN: "segredo-que-nao-pode-aparecer" },
    });
    const mcp = JSON.parse(argumentos[argumentos.indexOf("--mcp-config") + 1] ?? "{}");
    expect(mcp).toEqual({
      mcpServers: {
        moductus: {
          type: "http",
          url: "http://127.0.0.1:47822/mcp",
          headers: { Authorization: "Bearer ${MODUCTUS_MCP_TOKEN}" },
        },
      },
    });
    expect(argumentos[argumentos.indexOf("--allowedTools") + 1]).toBe("mcp__moductus__sessoes_listar");
    expect(argumentos).toContain("--strict-mcp-config");
    expect(argumentos.join(" ")).not.toContain("segredo-que-nao-pode-aparecer");
  });

  test("sem MCP ou sem ferramentas, nenhuma ferramenta é liberada", () => {
    expect(argumentosDoClaude(pedido(), config())).not.toContain("--allowedTools");
    const semFerramentas = argumentosDoClaude(pedido({ ferramentas: [] }), config(), {
      mcp: { url: "http://127.0.0.1:47822/mcp", variavelToken: "MODUCTUS_MCP_TOKEN" },
    });
    expect(semFerramentas).not.toContain("--mcp-config");
    expect(semFerramentas).not.toContain("--allowedTools");
  });

  test("sessão nova leva o histórico curto; continuando, só o que veio depois do agente", () => {
    const mensagens = [
      { papel: "usuario" as const, texto: "Tem PR esperando?" },
      { papel: "agente" as const, texto: "Um, o #12." },
      { papel: "usuario" as const, texto: "Resume ele." },
      { papel: "usuario" as const, texto: "Em uma frase." },
    ];
    expect(montarPrompt(pedido({ mensagens }))).toBe(
      "Conversa até aqui:\nUsuário: Tem PR esperando?\nVocê: Um, o #12.\n\nMensagem nova:\nResume ele.\n\nEm uma frase.",
    );
    expect(montarPrompt(pedido({ mensagens, continuarDe: "s1" }))).toBe("Resume ele.\n\nEm uma frase.");
  });
});

/** A sessão gravada até antes do `result`: o CLI ainda está trabalhando. */
function gravadaSemResult(): string {
  const destino = join(pasta, "sem-result.jsonl");
  const linhas = readFileSync(gravada("sessao-com-ferramenta.jsonl"), "utf8").split(/\r?\n/);
  const corte = linhas.findIndex((l) => l.includes('"type":"result"'));
  writeFileSync(destino, linhas.slice(0, corte).join("\n"));
  return destino;
}

async function drenar(eventos: AsyncIterator<EventoAgente>): Promise<void> {
  for (;;) if ((await eventos.next()).done) return;
}

function esperarSaida(processo: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!processo || processo.exitCode !== null || processo.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => processo.once("close", () => resolve()));
}
