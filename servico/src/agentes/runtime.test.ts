import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Execucao, ExecucaoDetalhada, type Aprovacao } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { MENSAGEM_NEGADO, RepositorioAprovacoes, ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta } from "../ferramentas/ferramenta.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import type { EventoAgente, MensagemModelo } from "../provedores/provedor.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import { autorizarPorAprovacao } from "./autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "./execucoes.ts";
import { HISTORICO_CURTO, VOZ_DA_FAMILIA } from "./pedido.ts";
import { MENSAGEM_CANCELADA, MENSAGEM_SEM_MODELO, Runtime, type PedidoExecucao } from "./runtime.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Uma porta que a ferramenta `teste.esperar` segura até o teste abrir. */
function portoes() {
  const abertos = new Map<string, () => void>();
  const esperando = new Set<string>();
  const esperar = (chave: string) =>
    new Promise<void>((resolve) => {
      esperando.add(chave);
      abertos.set(chave, resolve);
    });
  const abrir = (chave: string) => {
    const abrirPorta = abertos.get(chave);
    if (!abrirPorta) throw new Error(`ninguém esperando em ${chave}`);
    abrirPorta();
  };
  return { esperar, abrir, esperando };
}

/**
 * Banco migrado de verdade, Alba e Nuno com um provedor falso cada (Tula sem modelo), um catálogo
 * de teste e o relógio andando um segundo por leitura, para a ordem das datas ser estrita.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-runtime-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso da Alba'), ('p-nuno', 'claude-cli', 'Falso do Nuno');
    UPDATE agentes SET provedor_id = 'p-' || id, ferramentas = '["teste.*"]' WHERE id IN ('alba', 'nuno');
  `);
  const falsos: Record<string, ProvedorFalso> = {
    "p-alba": new ProvedorFalso("p-alba"),
    "p-nuno": new ProvedorFalso("p-nuno"),
  };
  const provedores = new RegistroProvedores().registrar("claude-cli", (config) => falsos[config.id]!);

  const porta = portoes();
  const publicados: string[] = [];
  const catalogo = new Catalogo([
    ferramenta({
      nome: "teste.esperar",
      descricao: "Espera a porta abrir",
      entrada: z.object({ chave: z.string() }),
      efeito: "leitura",
      executar: async ({ chave }) => {
        await porta.esperar(chave);
        return { abriu: chave };
      },
    }),
    ferramenta({
      nome: "teste.anotar",
      descricao: "Anota um texto",
      entrada: z.object({ texto: z.string().min(1) }),
      efeito: "interno",
      executar: ({ texto }) => ({ anotado: texto }),
    }),
    ferramenta({
      nome: "teste.publicar",
      descricao: "Publica fora do Moductus",
      entrada: z.object({ alvo: z.string() }),
      efeito: "externo",
      executar: ({ alvo }) => {
        publicados.push(alvo);
        return { publicado: alvo };
      },
      cartao: ({ alvo }) => ({ descricao: `Vou publicar em ${alvo}.`, rotulo: `Publicar em ${alvo}` }),
    }),
    ferramenta({
      nome: "outro.coisa",
      descricao: "Fora do escopo de todos",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => null,
    }),
  ]);

  const repositorioAprovacoes = new RepositorioAprovacoes(db);
  const aprovacoes = new ServicoAprovacoes(repositorioAprovacoes, { aprovacao: () => {}, regras: () => {} });
  const agentes = new RepositorioAgentes(db);
  const repositorioExecucoes = new RepositorioExecucoes(db);
  const avisosExecucao: Execucao[] = [];
  const avisosAgente: string[] = [];
  let segundos = 0;
  const runtime = new Runtime(
    {
      agentes,
      execucoes: repositorioExecucoes,
      provedores,
      catalogo,
      autorizar: autorizarPorAprovacao(aprovacoes),
    },
    { execucao: (e) => avisosExecucao.push(e), agente: (id) => avisosAgente.push(id) },
    {
      agora: () => new Date(Date.UTC(2026, 9, 9, 12, 0, segundos++)),
      // Um preço qualquer, só para ver o custo chegar à execução.
      estimarCusto: (_config, uso) => uso.tokensEntrada * 3 + uso.tokensSaida * 15,
    },
  );
  const situacao = (id: string) => runtime.situacao(agentes.agente(id)!);
  const historico = new ServicoExecucoes(repositorioExecucoes);
  return {
    db,
    runtime,
    falsos,
    porta,
    publicados,
    aprovacoes,
    repositorioAprovacoes,
    avisosExecucao,
    avisosAgente,
    situacao,
    historico,
  };
}

const pedir = (agenteId: string, texto: string, mudanca: Partial<PedidoExecucao> = {}): PedidoExecucao => ({
  agenteId,
  gatilho: "mensagem",
  mensagens: [{ papel: "usuario", texto }],
  ...mudanca,
});

const linhasRodando = (db: DatabaseSync) =>
  (db.prepare("SELECT count(*) AS n FROM execucoes WHERE estado = 'rodando'").get() as { n: number }).n;

describe("runtime: fila por agente", () => {
  test("dois pedidos ao mesmo agente saem em ordem, um de cada vez", async () => {
    const { runtime, falsos, porta, situacao, db } = montar();
    falsos["p-alba"]!.roteirizar(
      [{ tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "a" } }, ...roteiros.resposta("um")],
      roteiros.resposta("dois"),
    );

    const primeiro = runtime.executar(pedir("alba", "primeiro"));
    const segundo = runtime.executar(pedir("alba", "segundo"));
    await vi.waitFor(() => expect(porta.esperando.has("a")).toBe(true));

    // O segundo espera a vez: não chegou ao provedor nem virou execução.
    expect(falsos["p-alba"]!.pedidos).toHaveLength(1);
    expect(linhasRodando(db)).toBe(1);
    expect(situacao("alba")).toMatchObject({ atividade: "trabalhando", fila: 1 });

    porta.abrir("a");
    const [r1, r2] = await Promise.all([primeiro, segundo]);
    expect(falsos["p-alba"]!.pedidos.map((p) => p.mensagens.at(-1)?.texto)).toEqual(["primeiro", "segundo"]);
    expect([r1.texto, r2.texto]).toEqual(["um", "dois"]);
    expect(r1.execucao.fim! < r2.execucao.inicio!).toBe(true);
    expect(situacao("alba")).toMatchObject({ atividade: "ocioso", fila: 0 });
  });

  test("dois agentes rodam juntos", async () => {
    const { runtime, falsos, porta, situacao, db } = montar();
    falsos["p-alba"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "alba" } },
      ...roteiros.resposta("Alba pronta"),
    ]);
    falsos["p-nuno"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "nuno" } },
      ...roteiros.resposta("Nuno pronto"),
    ]);

    const alba = runtime.executar(pedir("alba", "oi, Alba"));
    const nuno = runtime.executar(pedir("nuno", "oi, Nuno"));
    await vi.waitFor(() => expect([...porta.esperando].sort()).toEqual(["alba", "nuno"]));
    expect(linhasRodando(db)).toBe(2);
    expect(situacao("alba").atividade).toBe("trabalhando");
    expect(situacao("nuno").atividade).toBe("trabalhando");

    // O Nuno termina sem esperar a Alba.
    porta.abrir("nuno");
    expect((await nuno).execucao.estado).toBe("ok");
    expect(situacao("alba").atividade).toBe("trabalhando");
    porta.abrir("alba");
    expect((await alba).execucao.estado).toBe("ok");
  });

  test("cancelar quem espera na fila tira o pedido sem execução e não atrasa quem vem depois", async () => {
    const { runtime, falsos, porta, db } = montar();
    falsos["p-alba"]!.roteirizar(
      [{ tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "a" } }, ...roteiros.resposta("um")],
      roteiros.resposta("três"),
    );
    const cancelar = new AbortController();
    const primeiro = runtime.executar(pedir("alba", "um"));
    const segundo = runtime.executar(pedir("alba", "dois", { sinal: cancelar.signal }));
    const terceiro = runtime.executar(pedir("alba", "três"));
    await vi.waitFor(() => expect(porta.esperando.has("a")).toBe(true));

    cancelar.abort(new Error("desisti"));
    await expect(segundo).rejects.toThrow("desisti");
    porta.abrir("a");
    expect((await primeiro).texto).toBe("um");
    expect((await terceiro).texto).toBe("três");
    expect(falsos["p-alba"]!.pedidos.map((p) => p.mensagens.at(-1)?.texto)).toEqual(["um", "três"]);
    const n = (db.prepare("SELECT count(*) AS n FROM execucoes").get() as { n: number }).n;
    expect(n).toBe(2);
  });

  test("agente que não existe não entra na fila", async () => {
    const { runtime } = montar();
    await expect(runtime.executar(pedir("ninguem", "oi"))).rejects.toThrow("agente não encontrado");
  });
});

describe("runtime: pedido ao modelo", () => {
  test("leva as instruções com a voz da família, só as ferramentas do escopo e o histórico curto", async () => {
    const { runtime, falsos, db } = montar();
    db.prepare("UPDATE agentes SET instrucoes = ? WHERE id = 'alba'").run("Você é a Alba e cuida do dia.");
    falsos["p-alba"]!.roteirizar(roteiros.resposta("Feito."));
    const conversa: MensagemModelo[] = Array.from({ length: 30 }, (_, i) => ({
      papel: i % 2 === 0 ? "usuario" : "agente",
      texto: `fala ${i}`,
    }));

    const r = await runtime.executar(pedir("alba", "", { mensagens: conversa, continuarDe: "sessao-7" }));
    const enviado = falsos["p-alba"]!.pedidos[0]!;
    expect(enviado.agenteId).toBe("alba");
    expect(enviado.execucaoId).toBe(r.execucao.id);
    expect(enviado.instrucoes).toBe(`Você é a Alba e cuida do dia.\n\n${VOZ_DA_FAMILIA}`);
    expect(enviado.ferramentas.map((f) => f.nome)).toEqual([
      "teste__anotar",
      "teste__esperar",
      "teste__publicar",
    ]);
    expect(enviado.mensagens).toHaveLength(HISTORICO_CURTO.mensagens);
    expect(enviado.mensagens.at(-1)?.texto).toBe("fala 29");
    expect(enviado.continuarDe).toBe("sessao-7");
  });

  test("configuração mudada enquanto o pedido esperava vale na vez dele", async () => {
    const { runtime, falsos, porta, db } = montar();
    falsos["p-alba"]!.roteirizar(
      [{ tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "a" } }, ...roteiros.resposta("um")],
      roteiros.resposta("dois"),
    );
    const primeiro = runtime.executar(pedir("alba", "um"));
    const segundo = runtime.executar(pedir("alba", "dois"));
    await vi.waitFor(() => expect(porta.esperando.has("a")).toBe(true));
    db.prepare("UPDATE agentes SET instrucoes = 'Instrução nova.' WHERE id = 'alba'").run();
    porta.abrir("a");
    await Promise.all([primeiro, segundo]);
    expect(falsos["p-alba"]!.pedidos[1]!.instrucoes.startsWith("Instrução nova.")).toBe(true);
  });
});

describe("runtime: registro em execucoes", () => {
  test("execução que dá certo grava tokens somados, custo, duração, resumo e a continuação", async () => {
    const { runtime, falsos, avisosExecucao, historico } = montar();
    falsos["p-nuno"]!.roteirizar([
      { tipo: "texto", texto: "2 PRs esperam " },
      { tipo: "uso", tokensEntrada: 100, tokensSaida: 20 },
      { tipo: "texto", texto: "seu review." },
      { tipo: "uso", tokensEntrada: 50, tokensSaida: 10 },
      { tipo: "fim", continuacao: "sessao-1" },
    ]);
    const vistos: EventoAgente[] = [];

    const r = await runtime.executar(
      pedir("nuno", "O que precisa de mim?", { gatilho: "evento", aoEvento: (e) => vistos.push(e) }),
    );
    expect(r.texto).toBe("2 PRs esperam seu review.");
    expect(r.continuacao).toBe("sessao-1");
    expect(r.falha).toBeNull();
    expect(r.sono).toBeNull();
    expect(r.execucao).toEqual({
      id: r.execucao.id,
      agenteId: "nuno",
      gatilho: "evento",
      provedorId: "p-nuno",
      inicio: "2026-10-09T12:00:00.000Z",
      fim: "2026-10-09T12:00:01.000Z",
      estado: "ok",
      erro: null,
      tokensEntrada: 150,
      tokensSaida: 30,
      custoEstimadoMicrodolares: 150 * 3 + 30 * 15,
      resumo: "2 PRs esperam seu review.",
    });
    expect(Execucao.safeParse(r.execucao).success).toBe(true);
    // Streaming: quem pediu viu cada evento na hora.
    expect(vistos.filter((e) => e.tipo === "texto")).toHaveLength(2);
    // A interface soube do começo e do fim.
    expect(avisosExecucao.map((e) => e.estado)).toEqual(["rodando", "ok"]);
    expect(historico.listar({ agenteId: "nuno" }).itens).toEqual([r.execucao]);
  });

  test("sem evento de uso, tokens e custo ficam vazios em vez de zero", async () => {
    const { runtime, falsos } = montar();
    falsos["p-nuno"]!.roteirizar([{ tipo: "texto", texto: "ok" }, { tipo: "fim" }]);
    const { execucao } = await runtime.executar(pedir("nuno", "oi"));
    expect(execucao).toMatchObject({
      tokensEntrada: null,
      tokensSaida: null,
      custoEstimadoMicrodolares: null,
    });
  });

  test("falha do provedor fica registrada e diz até quando o agente dorme", async () => {
    const { runtime, falsos, situacao } = montar();
    falsos["p-nuno"]!.roteirizar(
      roteiros.falha("limite", "2026-10-09T15:00:00.000Z"),
      roteiros.resposta("voltei"),
    );

    const r = await runtime.executar(pedir("nuno", "oi"));
    expect(r.execucao).toMatchObject({ estado: "erro", erro: "falha roteirizada: limite", resumo: null });
    expect(r.falha?.motivo).toBe("limite");
    expect(r.sono).toEqual({ motivo: "limite", ate: "2026-10-09T15:00:00.000Z" });
    expect(situacao("nuno").atividade).toBe("erro");

    await runtime.executar(pedir("nuno", "e agora?"));
    expect(situacao("nuno").atividade).toBe("ocioso");
  });

  test("agente sem modelo registra o erro sem chamar provedor e pede sono sem hora", async () => {
    const { runtime } = montar();
    const r = await runtime.executar(pedir("tula", "quanto gastei?"));
    expect(r.execucao).toMatchObject({ estado: "erro", provedorId: null, erro: MENSAGEM_SEM_MODELO("Tula") });
    expect(r.sono).toEqual({ motivo: "sem_modelo", ate: null });
  });

  test("exceção do adaptador vira erro da execução, com o que já tinha sido dito no resumo", async () => {
    const { runtime, falsos } = montar();
    falsos["p-nuno"]!.roteirizar([
      { tipo: "texto", texto: "Começando" },
      { tipo: "excecao", erro: new Error("adaptador quebrou") },
    ]);
    const r = await runtime.executar(pedir("nuno", "oi"));
    expect(r.execucao).toMatchObject({ estado: "erro", erro: "adaptador quebrou", resumo: "Começando" });
    expect(r.sono).toBeNull();
  });

  test("cancelar durante a execução termina registrado como cancelado, sem pôr o agente em erro", async () => {
    const { runtime, falsos, porta, situacao } = montar();
    falsos["p-alba"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "a" } },
      ...roteiros.resposta("não chega"),
    ]);
    const cancelar = new AbortController();
    const execucao = runtime.executar(pedir("alba", "oi", { sinal: cancelar.signal }));
    await vi.waitFor(() => expect(porta.esperando.has("a")).toBe(true));
    cancelar.abort();
    porta.abrir("a");
    const r = await execucao;
    expect(r.execucao).toMatchObject({ estado: "erro", erro: MENSAGEM_CANCELADA });
    expect(situacao("alba").atividade).toBe("ocioso");
  });
});

describe("runtime: chamadas de ferramenta", () => {
  test("cada chamada a uma ferramenta do escopo fica em chamadas_ferramenta com entrada e resultado", async () => {
    const { runtime, falsos, historico } = montar();
    falsos["p-alba"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__anotar", entrada: { texto: "comprar pão" } },
      { tipo: "ferramenta", nome: "teste__anotar", entrada: { texto: "" } },
      // Fora do escopo e inexistente: voltam erro ao modelo e não entram no histórico.
      { tipo: "ferramenta", nome: "outro__coisa", entrada: {} },
      { tipo: "ferramenta", nome: "nada__disso", entrada: {} },
      ...roteiros.resposta("Anotei."),
    ]);

    const r = await runtime.executar(pedir("alba", "anota aí"));
    const detalhe = historico.obter({ id: r.execucao.id });
    expect(ExecucaoDetalhada.safeParse(detalhe).success).toBe(true);
    expect(detalhe.chamadas).toEqual([
      expect.objectContaining({
        execucaoId: r.execucao.id,
        ferramenta: "teste.anotar",
        efeito: "interno",
        entrada: { texto: "comprar pão" },
        resultado: { ok: true, valor: { anotado: "comprar pão" } },
        aprovacaoId: null,
      }),
      expect.objectContaining({
        ferramenta: "teste.anotar",
        entrada: { texto: "" },
        resultado: { ok: false, erro: expect.stringContaining("Entrada inválida") },
      }),
    ]);
  });

  test("o executor da execução em andamento fica disponível para o MCP e registra o que roda por ele", async () => {
    const { runtime, falsos, porta, avisosExecucao, historico } = montar();
    falsos["p-alba"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__esperar", entrada: { chave: "a" } },
      ...roteiros.resposta("ok"),
    ]);
    const execucao = runtime.executar(pedir("alba", "oi"));
    await vi.waitFor(() => expect(porta.esperando.has("a")).toBe(true));
    const id = avisosExecucao[0]!.id;

    const executor = runtime.executorDaExecucao(id);
    expect(executor).not.toBeNull();
    expect(await executor!({ id: "mcp-1", nome: "teste.anotar", entrada: { texto: "pelo MCP" } })).toEqual({
      ok: true,
      valor: { anotado: "pelo MCP" },
    });
    porta.abrir("a");
    await execucao;
    expect(runtime.executorDaExecucao(id)).toBeNull();
    expect(historico.obter({ id }).chamadas.map((c) => c.ferramenta)).toEqual([
      "teste.anotar",
      "teste.esperar",
    ]);
  });

  test("externo vira cartão do agente, deixa o agente esperando você e só roda com o sim", async () => {
    const { runtime, falsos, publicados, aprovacoes, repositorioAprovacoes, situacao, historico } = montar();
    falsos["p-nuno"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__publicar", entrada: { alvo: "#142" } },
      ...roteiros.resposta("Publiquei."),
    ]);
    const execucao = runtime.executar(pedir("nuno", "publica no #142"));
    let cartao!: Aprovacao;
    await vi.waitFor(() => {
      expect(repositorioAprovacoes.pendentes()).toHaveLength(1);
      cartao = repositorioAprovacoes.pendentes()[0]!;
    });
    expect(cartao).toMatchObject({
      fonte: "moductus",
      agenteId: "nuno",
      descricao: "Vou publicar em #142.",
      acao: { ferramenta: "teste.publicar", entrada: { alvo: "#142" }, rotulo: "Publicar em #142" },
    });
    expect(situacao("nuno").atividade).toBe("esperando");
    expect(publicados).toEqual([]);

    await aprovacoes.decidir({ id: cartao.id, decisao: "permitir" });
    const r = await execucao;
    expect(publicados).toEqual(["#142"]);
    expect(cartao.execucaoId).toBe(r.execucao.id);
    expect(historico.obter({ id: r.execucao.id }).chamadas).toEqual([
      expect.objectContaining({
        ferramenta: "teste.publicar",
        efeito: "externo",
        aprovacaoId: cartao.id,
        resultado: { ok: true, valor: { publicado: "#142" } },
      }),
    ]);
    expect(situacao("nuno").atividade).toBe("ocioso");
  });

  test("externo negado não roda e o modelo recebe o motivo", async () => {
    const { runtime, falsos, publicados, aprovacoes, repositorioAprovacoes, historico } = montar();
    falsos["p-nuno"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__publicar", entrada: { alvo: "#9" } },
      ...roteiros.resposta("Entendido."),
    ]);
    const execucao = runtime.executar(pedir("nuno", "publica no #9"));
    await vi.waitFor(() => expect(repositorioAprovacoes.pendentes()).toHaveLength(1));
    await aprovacoes.decidir({ id: repositorioAprovacoes.pendentes()[0]!.id, decisao: "negar" });
    const r = await execucao;
    expect(publicados).toEqual([]);
    expect(historico.obter({ id: r.execucao.id }).chamadas[0]?.resultado).toEqual({
      ok: false,
      erro: MENSAGEM_NEGADO,
    });
  });

  test("execução cancelada com cartão pendente tira o cartão do dock", async () => {
    const { runtime, falsos, repositorioAprovacoes } = montar();
    falsos["p-nuno"]!.roteirizar([
      { tipo: "ferramenta", nome: "teste__publicar", entrada: { alvo: "#1" } },
      ...roteiros.resposta("não chega"),
    ]);
    const cancelar = new AbortController();
    const execucao = runtime.executar(pedir("nuno", "publica", { sinal: cancelar.signal }));
    await vi.waitFor(() => expect(repositorioAprovacoes.pendentes()).toHaveLength(1));
    const id = repositorioAprovacoes.pendentes()[0]!.id;
    cancelar.abort();
    expect((await execucao).execucao.erro).toBe(MENSAGEM_CANCELADA);
    expect(repositorioAprovacoes.aprovacao(id)?.estado).toBe("expirada");
  });
});
