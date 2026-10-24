import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Aprovacao } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { RepositorioAprovacoes, ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta, type Ferramenta } from "../ferramentas/ferramenta.ts";
import type { ExecucaoMcp } from "../mcp/protocolo.ts";
import { abrirServidorMcp, type ServidorMcp } from "../mcp/servidor.ts";
import { fabricaClaudeCli, rotaPreToolUse } from "../provedores/claude-cli/claude-cli.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import { autorizarPorAprovacao } from "./autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "./execucoes.ts";
import { aberturaMcpDoRuntime, MENSAGEM_EXECUCAO_ENCERRADA } from "./mcp.ts";
import { MENSAGEM_CANCELADA, Runtime } from "./runtime.ts";

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
  desfazer: () => {},
  executar: ({ texto }) => ({ anotado: texto }),
});

/** O que a ferramenta `externo` do teste publicou fora do Moductus. */
const publicados: string[] = [];
afterEach(() => void publicados.splice(0));

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

/**
 * Os avisos de cartão que as janelas receberiam. `quando` espera o primeiro que satisfaz, já
 * recebido ou ainda por vir: o teste segue pelo evento, não por quanto o CLI falso demora.
 */
function avisosDeCartao() {
  const recebidos: Aprovacao[] = [];
  const esperas: { satisfaz: (a: Aprovacao) => boolean; resolver: (a: Aprovacao) => void }[] = [];
  return {
    aviso: (aprovacao: Aprovacao) => {
      recebidos.push(aprovacao);
      for (const espera of esperas.filter((e) => e.satisfaz(aprovacao))) {
        esperas.splice(esperas.indexOf(espera), 1);
        espera.resolver(aprovacao);
      }
    },
    quando: (satisfaz: (a: Aprovacao) => boolean): Promise<Aprovacao> => {
      const ja = recebidos.find(satisfaz);
      return ja ? Promise.resolve(ja) : new Promise((resolver) => esperas.push({ satisfaz, resolver }));
    },
  };
}

/**
 * O runtime com a Alba num CLI falso que fala com o MCP e o hook de verdade, e com o cartão de
 * aprovação de verdade. `falso` são os argumentos do falso antes do `--`.
 */
async function montarComCli(ferramentas: Ferramenta[], falso: string[]) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-runtime-mcp-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES ('p-cli', 'claude-cli', 'Claude Code');
    UPDATE agentes SET provedor_id = 'p-cli', ferramentas = '["teste.*"]' WHERE id = 'alba';
  `);
  const servidor = await abrirServidorMcp(0, [rotaPreToolUse]);
  servidores.push(servidor);
  const repositorioAprovacoes = new RepositorioAprovacoes(db);
  const cartoes = avisosDeCartao();
  const aprovacoes = new ServicoAprovacoes(repositorioAprovacoes, {
    aprovacao: cartoes.aviso,
    regras: () => {},
  });
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
  const historico = new ServicoExecucoes(execucoes, new Catalogo(ferramentas));
  return { runtime, aprovacoes, repositorioAprovacoes, historico, cartaoQuando: cartoes.quando };
}

describe("runtime pelo MCP do Moductus", () => {
  test("a chamada do CLI chega pelo MCP, roda no executor da execução e fica em chamadas_ferramenta", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-runtime-mcp-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta, { duravel: false });
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
    expect(
      new ServicoExecucoes(execucoes, new Catalogo([anotar])).obter({ id: r.execucao.id }).chamadas,
    ).toEqual([
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
    const { runtime, aprovacoes, repositorioAprovacoes, historico, cartaoQuando } = await montarComCli(
      [publicar],
      [JSON.stringify({ alvo: "#7" })],
    );

    const execucao = runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "publica no #7" }],
    });
    const cartao = await cartaoQuando((a) => a.estado === "pendente");
    expect(repositorioAprovacoes.pendentes().map((a) => a.id)).toEqual([cartao.id]);
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

  test("CLI cai com o cartão pendente: a execução fecha, o cartão expira e o sim depois não roda nada", async () => {
    const gatilhos = mkdtempSync(join(tmpdir(), "moductus-cli-cai-"));
    pastas.push(gatilhos);
    const cair = join(gatilhos, "cair");
    const { runtime, aprovacoes, repositorioAprovacoes, historico, cartaoQuando } = await montarComCli(
      [publicar],
      [JSON.stringify({ alvo: "#8" }), "", cair],
    );

    const execucao = runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "publica no #8" }],
    });
    const cartao = await cartaoQuando((a) => a.estado === "pendente");
    expect(repositorioAprovacoes.pendentes().map((a) => a.id)).toEqual([cartao.id]);
    // O CLI cai no meio da chamada, sem esperar a resposta do MCP.
    writeFileSync(cair, "");
    const r = await execucao;
    expect(r.execucao.estado).toBe("erro");
    await cartaoQuando((a) => a.id === cartao.id && a.estado === "expirada");
    expect(repositorioAprovacoes.aprovacao(cartao.id)?.estado).toBe("expirada");

    // A chamada largada fica no histórico como cancelada: o executor dela terminou sem rodar a
    // ferramenta. O registro vem logo depois de o cartão expirar, sem processo no meio.
    await vi.waitFor(() =>
      expect(historico.obter({ id: r.execucao.id }).chamadas).toEqual([
        expect.objectContaining({
          ferramenta: "teste.publicar",
          aprovacaoId: cartao.id,
          resultado: { ok: false, erro: MENSAGEM_CANCELADA },
        }),
      ]),
    );
    // O sim que chega depois encontra o cartão expirado e não roda nada.
    expect(await aprovacoes.decidir({ id: cartao.id, decisao: "permitir" })).toMatchObject({
      estado: "expirada",
    });
    expect(publicados).toEqual([]);
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
