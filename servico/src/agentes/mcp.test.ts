import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { RepositorioAprovacoes, ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta, type Ferramenta } from "../ferramentas/ferramenta.ts";
import type { ExecucaoMcp } from "../mcp/protocolo.ts";
import { abrirServidorMcp, type ServidorMcp } from "../mcp/servidor.ts";
import { fabricaClaudeCli } from "../provedores/claude-cli/claude-cli.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import { autorizarPorAprovacao } from "./autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "./execucoes.ts";
import { aberturaMcpDoRuntime, MENSAGEM_EXECUCAO_ENCERRADA } from "./mcp.ts";
import { Runtime } from "./runtime.ts";

const CLI_MCP_FALSO = fileURLToPath(new URL("./fixtures/cli-mcp-falso.mjs", import.meta.url));

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const servidores: ServidorMcp[] = [];
afterEach(async () => {
  for (const s of servidores.splice(0)) await s.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const anotar = ferramenta({
  nome: "teste.anotar",
  descricao: "Anota um texto",
  entrada: z.object({ texto: z.string().min(1) }),
  efeito: "interno",
  executar: ({ texto }) => ({ anotado: texto }),
});

/**
 * O runtime com a Alba num CLI falso que fala com o MCP e o hook de verdade, e com o cartão de
 * aprovação de verdade. `falso` são os argumentos do falso antes do `--`.
 */
async function montarComCli(ferramentas: Ferramenta[], falso: string[]) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-runtime-mcp-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES ('p-cli', 'claude-cli', 'Claude Code');
    UPDATE agentes SET provedor_id = 'p-cli', ferramentas = '["teste.*"]' WHERE id = 'alba';
  `);
  const servidor = await abrirServidorMcp();
  servidores.push(servidor);
  const repositorioAprovacoes = new RepositorioAprovacoes(db);
  const aprovacoes = new ServicoAprovacoes(repositorioAprovacoes, { aprovacao: () => {}, regras: () => {} });
  const execucoes = new RepositorioExecucoes(db);
  const provedores = new RegistroProvedores().registrar(
    "claude-cli",
    fabricaClaudeCli({
      pasta,
      mcp: aberturaMcpDoRuntime(servidor, (id) => runtime.executorDaExecucao(id)),
      iniciar: (argumentos, opcoes) =>
        spawn(process.execPath, [CLI_MCP_FALSO, ...falso, "--", ...argumentos], opcoes),
    }),
  );
  const runtime: Runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores,
      catalogo: new Catalogo(ferramentas),
      autorizar: autorizarPorAprovacao(aprovacoes),
    },
    { execucao: () => {}, agente: () => {} },
  );
  return { runtime, aprovacoes, repositorioAprovacoes, historico: new ServicoExecucoes(execucoes) };
}

describe("runtime pelo MCP do Moductus", () => {
  test("a chamada do CLI chega pelo MCP, roda no executor da execução e fica em chamadas_ferramenta", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-runtime-mcp-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta);
    bancos.push(db);
    db.exec(`
      INSERT INTO provedores (id, tipo, nome) VALUES ('p-cli', 'claude-cli', 'Claude Code');
      UPDATE agentes SET provedor_id = 'p-cli', ferramentas = '["teste.*"]' WHERE id = 'alba';
    `);
    const servidor = await abrirServidorMcp();
    servidores.push(servidor);
    const execucoes = new RepositorioExecucoes(db);
    // O CLI de verdade não roda: o falso faz o que ele faria com o `--mcp-config` e o token.
    const provedores = new RegistroProvedores().registrar(
      "claude-cli",
      fabricaClaudeCli({
        pasta,
        mcp: aberturaMcpDoRuntime(servidor, (id) => runtime.executorDaExecucao(id)),
        iniciar: (argumentos, opcoes) =>
          spawn(
            process.execPath,
            [CLI_MCP_FALSO, JSON.stringify({ texto: "pelo MCP" }), "--", ...argumentos],
            opcoes,
          ),
      }),
    );
    const runtime: Runtime = new Runtime(
      {
        agentes: new RepositorioAgentes(db),
        execucoes,
        provedores,
        catalogo: new Catalogo([anotar]),
      },
      { execucao: () => {}, agente: () => {} },
    );

    const r = await runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "anota aí" }],
    });
    expect(r.execucao).toMatchObject({ estado: "ok", tokensEntrada: 3, tokensSaida: 1 });
    expect(r.continuacao).toBe("sessao-mcp");
    expect(new ServicoExecucoes(execucoes).obter({ id: r.execucao.id }).chamadas).toEqual([
      expect.objectContaining({
        execucaoId: r.execucao.id,
        ferramenta: "teste.anotar",
        efeito: "interno",
        entrada: { texto: "pelo MCP" },
        resultado: { ok: true, valor: { anotado: "pelo MCP" } },
      }),
    ]);
  }, 20_000);

  test("externo pelo CLI: o PreToolUse deixa passar e a chamada espera o cartão do dock", async () => {
    const publicados: string[] = [];
    const publicar = ferramenta({
      nome: "teste.publicar",
      descricao: "Publica fora do Moductus",
      entrada: z.object({ alvo: z.string() }),
      efeito: "externo",
      executar: ({ alvo }) => {
        publicados.push(alvo);
        return { publicado: alvo };
      },
      cartao: ({ alvo }) => ({ descricao: `Vou publicar em ${alvo}.`, rotulo: `Publicar em ${alvo}` }),
    });
    const { runtime, aprovacoes, repositorioAprovacoes, historico } = await montarComCli(
      [publicar],
      [JSON.stringify({ alvo: "#7" })],
    );

    const execucao = runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "publica no #7" }],
    });
    await vi.waitFor(() => expect(repositorioAprovacoes.pendentes()).toHaveLength(1));
    const cartao = repositorioAprovacoes.pendentes()[0]!;
    expect(cartao).toMatchObject({ agenteId: "alba", descricao: "Vou publicar em #7." });
    // O hook já respondeu e o CLI está parado na chamada, esperando o cartão: nada rodou.
    expect(publicados).toEqual([]);

    await aprovacoes.decidir({ id: cartao.id, decisao: "permitir" });
    const r = await execucao;
    expect(publicados).toEqual(["#7"]);
    expect(historico.obter({ id: r.execucao.id }).chamadas).toEqual([
      expect.objectContaining({ ferramenta: "teste.publicar", efeito: "externo", aprovacaoId: cartao.id }),
    ]);
  }, 20_000);

  test("Bash pedido pelo CLI é negado pelo PreToolUse com o motivo, e nada roda", async () => {
    const { runtime, historico, repositorioAprovacoes } = await montarComCli(
      [anotar],
      [JSON.stringify({ command: "rm -rf ." }), "Bash"],
    );
    const r = await runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "limpa a pasta" }],
    });
    // O falso devolve como resposta o que o CLI de verdade mostraria ao modelo.
    expect(r.execucao.estado).toBe("ok");
    expect(r.texto).toMatch(/^negado: "Bash" não é uma ferramenta deste agente\./);
    expect(historico.obter({ id: r.execucao.id }).chamadas).toEqual([]);
    expect(repositorioAprovacoes.pendentes()).toEqual([]);
  }, 20_000);

  test("chamada que chega depois do fim da execução não roda", async () => {
    let aberta: ExecucaoMcp | null = null;
    const servidor = {
      abrir: (execucao: ExecucaoMcp) => {
        aberta = execucao;
        return { url: "http://127.0.0.1/mcp", token: "t", fechar: () => {} };
      },
    };
    const executores = new Map([["E1", () => Promise.resolve({ ok: true as const, valor: "rodou" })]]);
    const abertura = aberturaMcpDoRuntime(servidor, (id) => executores.get(id) ?? null);
    abertura.abrir({ execucaoId: "E1", ferramentas: [], executarFerramenta: () => Promise.reject() });
    const chamada = { id: "c1", nome: "teste__anotar", entrada: {} };

    expect(await aberta!.executarFerramenta(chamada)).toEqual({ ok: true, valor: "rodou" });
    executores.delete("E1");
    expect(await aberta!.executarFerramenta(chamada)).toEqual({
      ok: false,
      erro: MENSAGEM_EXECUCAO_ENCERRADA,
    });
  });
});
