import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { abrirBanco } from "../banco/conexao.ts";
import { ProvedorFalso } from "../provedores/falso.ts";
import type { EventoAgente, PedidoDoAgente } from "../provedores/provedor.ts";
import { Catalogo, cobre, type Autorizar } from "./catalogo.ts";
import { ferramenta, type ContextoFerramenta } from "./ferramenta.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** A lista de ferramentas de cada agente de fábrica, como a migração 003 semeia. */
function listasDeFabrica(): Record<string, string[]> {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-catalogo-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const linhas = db.prepare("SELECT id, ferramentas FROM agentes").all() as {
    id: string;
    ferramentas: string;
  }[];
  return Object.fromEntries(linhas.map((l) => [l.id, JSON.parse(l.ferramentas) as string[]]));
}

/** Um catálogo de mentira com uma ferramenta de cada domínio e efeito; anota o que rodou. */
function montar() {
  const rodou: { nome: string; entrada: unknown; ctx: ContextoFerramenta }[] = [];
  const anotar = (nome: string) => (entrada: unknown, ctx: ContextoFerramenta) => {
    rodou.push({ nome, entrada, ctx });
    return { ok: nome };
  };
  const catalogo = new Catalogo([
    ferramenta({
      nome: "sessoes.listar",
      descricao: "Lista as sessões de IA abertas",
      entrada: z.object({ projeto: z.string().optional() }),
      efeito: "leitura",
      executar: anotar("sessoes.listar"),
    }),
    ferramenta({
      nome: "github.comentar",
      descricao: "Comenta num PR",
      entrada: z.object({ pr: z.number().int().positive(), texto: z.string().min(1) }),
      efeito: "externo",
      executar: anotar("github.comentar"),
    }),
    ferramenta({
      nome: "tarefas.criar",
      descricao: "Cria uma tarefa",
      entrada: z.object({ titulo: z.string().min(1) }),
      efeito: "interno",
      executar: anotar("tarefas.criar"),
    }),
    ferramenta({
      nome: "tarefas.apagar",
      descricao: "Manda uma tarefa para a lixeira",
      entrada: z.object({ id: z.string() }),
      efeito: "interno",
      executar: anotar("tarefas.apagar"),
    }),
    ferramenta({
      nome: "financas.lancar",
      descricao: "Registra um gasto ou receita",
      entrada: z.object({ valorCentavos: z.number().int(), descricao: z.string().min(1) }),
      efeito: "interno",
      executar: anotar("financas.lancar"),
    }),
    ferramenta({
      nome: "financas.quebrar",
      descricao: "Sempre falha, como uma área com erro de regra",
      entrada: z.object({}),
      efeito: "interno",
      executar: () => {
        throw new Error("o mês 13 não existe");
      },
    }),
  ]);
  return { catalogo, rodou };
}

const contexto = (agenteId: string, sinal = new AbortController().signal): ContextoFerramenta => ({
  agenteId,
  execucaoId: "exec-1",
  sinal,
});

describe("escopo por agente", () => {
  test("dominio.* cobre o domínio inteiro; o resto, só o nome exato", () => {
    expect(cobre("sessoes.*", "sessoes.listar")).toBe(true);
    expect(cobre("sessoes.*", "sessoes_velhas.listar")).toBe(false);
    expect(cobre("tarefas.criar", "tarefas.criar")).toBe(true);
    expect(cobre("tarefas.criar", "tarefas.apagar")).toBe(false);
  });

  test("cada agente de fábrica só enxerga as ferramentas da lista dele", () => {
    const { catalogo } = montar();
    const listas = listasDeFabrica();
    const nomes = (agente: string) =>
      catalogo
        .doAgente(listas[agente] ?? [])
        .capacidades()
        .map((c) => c.nome);

    expect(nomes("nuno")).toEqual(["github.comentar", "sessoes.listar", "tarefas.criar"]);
    expect(nomes("tula")).toEqual(["financas.lancar", "financas.quebrar"]);
    // Alba tem tarefas.* inteiro; Faina não tem nada deste catálogo.
    expect(nomes("alba")).toEqual(["tarefas.apagar", "tarefas.criar"]);
    expect(nomes("faina")).toEqual([]);
  });

  test("o que vai ao modelo e o que vai a /capacidades saem do mesmo recorte", () => {
    const { catalogo } = montar();
    const nuno = catalogo.doAgente(["sessoes.*", "github.*", "tarefas.criar"]);
    expect(nuno.oferecidas().map((f) => f.nome)).toEqual([
      "github__comentar",
      "sessoes__listar",
      "tarefas__criar",
    ]);
    expect(nuno.oferecidas()[0]?.esquema).toMatchObject({ type: "object", required: ["pr", "texto"] });
    expect(nuno.capacidades()).toEqual([
      { nome: "github.comentar", descricao: "Comenta num PR", efeito: "externo" },
      { nome: "sessoes.listar", descricao: "Lista as sessões de IA abertas", efeito: "leitura" },
      { nome: "tarefas.criar", descricao: "Cria uma tarefa", efeito: "interno" },
    ]);
  });

  test("ferramenta de outro agente não roda nem chamada pelo nome, e a resposta não diz que ela existe", async () => {
    const { catalogo, rodou } = montar();
    const executar = catalogo.doAgente(["sessoes.*"]).executor(contexto("nuno"));
    const deOutro = await executar({
      id: "c1",
      nome: "financas__lancar",
      entrada: { valorCentavos: 1, descricao: "x" },
    });
    const inventada = await executar({ id: "c2", nome: "financas__inventar", entrada: {} });
    expect(deOutro).toEqual({
      ok: false,
      erro: 'A ferramenta "financas__lancar" não está disponível. Use uma das ferramentas oferecidas.',
    });
    expect(inventada).toEqual({
      ok: false,
      erro: 'A ferramenta "financas__inventar" não está disponível. Use uma das ferramentas oferecidas.',
    });
    expect(rodou).toEqual([]);
  });

  test("nome repetido no catálogo é erro de montagem", () => {
    const { catalogo } = montar();
    const outra = ferramenta({
      nome: "tarefas.criar",
      descricao: "de novo",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => null,
    });
    expect(() => catalogo.registrar(outra)).toThrow(/tarefas\.criar.*duas vezes/);
  });
});

describe("execução pelo catálogo", () => {
  test("chamada válida roda a função da área com o contexto da execução", async () => {
    const { catalogo, rodou } = montar();
    const ctx = contexto("alba");
    const executar = catalogo.doAgente(["tarefas.*"]).executor(ctx);
    // O modelo chama com `__`; a interface e o MCP podem chamar pelo nome do catálogo.
    expect(await executar({ id: "c1", nome: "tarefas__criar", entrada: { titulo: "Pagar luz" } })).toEqual({
      ok: true,
      valor: { ok: "tarefas.criar" },
    });
    expect(await executar({ id: "c2", nome: "tarefas.apagar", entrada: { id: "t1" } })).toMatchObject({
      ok: true,
    });
    expect(rodou).toEqual([
      { nome: "tarefas.criar", entrada: { titulo: "Pagar luz" }, ctx },
      { nome: "tarefas.apagar", entrada: { id: "t1" }, ctx },
    ]);
  });

  test("entrada inválida volta ao modelo como erro legível e a área não roda", async () => {
    const { catalogo, rodou } = montar();
    const executar = catalogo.doAgente(["financas.*"]).executor(contexto("tula"));
    const r = await executar({ id: "c1", nome: "financas__lancar", entrada: { valorCentavos: 12.5 } });
    expect(r).toEqual({
      ok: false,
      erro: "Entrada inválida para financas.lancar. valorCentavos: esperava um número inteiro, recebeu um número; descricao: campo obrigatório.",
    });
    expect(rodou).toEqual([]);
  });

  test("erro da área volta ao modelo como texto, com o nome da ferramenta", async () => {
    const { catalogo } = montar();
    const executar = catalogo.doAgente(["financas.*"]).executor(contexto("tula"));
    expect(await executar({ id: "c1", nome: "financas__quebrar", entrada: {} })).toEqual({
      ok: false,
      erro: "financas.quebrar falhou: o mês 13 não existe",
    });
  });

  test("cancelar a execução não vira resultado: sobe como exceção", async () => {
    const { catalogo } = montar();
    const controle = new AbortController();
    const executar = catalogo.doAgente(["financas.*"]).executor(contexto("tula", controle.signal));
    controle.abort(new Error("cancelada"));
    await expect(executar({ id: "c1", nome: "financas__quebrar", entrada: {} })).rejects.toThrow("cancelada");
  });

  test("execução já cancelada não roda a ferramenta, nem a que daria certo", async () => {
    const { catalogo, rodou } = montar();
    const controle = new AbortController();
    const executar = catalogo.doAgente(["tarefas.*"]).executor(contexto("alba", controle.signal));
    controle.abort(new Error("cancelada"));
    await expect(
      executar({ id: "c1", nome: "tarefas__criar", entrada: { titulo: "Pagar luz" } }),
    ).rejects.toThrow("cancelada");
    expect(rodou).toEqual([]);
  });

  test("externo com a execução cancelada não pede aprovação", async () => {
    const { catalogo, rodou } = montar();
    const controle = new AbortController();
    let pedidos = 0;
    const autorizar: Autorizar = () => {
      pedidos++;
      return Promise.resolve({ permitida: true });
    };
    const executar = catalogo.doAgente(["github.*"]).executor(contexto("nuno", controle.signal), autorizar);
    controle.abort(new Error("cancelada"));
    await expect(
      executar({ id: "c1", nome: "github__comentar", entrada: { pr: 7, texto: "Pronto" } }),
    ).rejects.toThrow("cancelada");
    expect(pedidos).toBe(0);
    expect(rodou).toEqual([]);
  });

  test("externo sem quem autorize é recusado e não roda", async () => {
    const { catalogo, rodou } = montar();
    const executar = catalogo.doAgente(["github.*"]).executor(contexto("nuno"));
    const r = await executar({ id: "c1", nome: "github__comentar", entrada: { pr: 7, texto: "Pronto" } });
    expect(r).toEqual({
      ok: false,
      erro: "github.comentar age fora do Moductus e precisa da aprovação do usuário, que esta execução não pode pedir.",
    });
    expect(rodou).toEqual([]);
  });

  test("externo roda com o sim e volta o motivo com o não; leitura e interno não pedem", async () => {
    const { catalogo, rodou } = montar();
    const pedidos: { ferramenta: string; entrada: unknown }[] = [];
    let resposta: Awaited<ReturnType<Autorizar>> = {
      permitida: false,
      motivo: "Negado pelo dock do Moductus",
    };
    const autorizar: Autorizar = (p) => {
      pedidos.push({ ferramenta: p.ferramenta.nome, entrada: p.entrada });
      return Promise.resolve(resposta);
    };
    const executar = catalogo
      .doAgente(["github.*", "sessoes.*", "tarefas.criar"])
      .executor(contexto("nuno"), autorizar);

    expect(
      await executar({ id: "c1", nome: "github__comentar", entrada: { pr: 7, texto: "Pronto" } }),
    ).toEqual({
      ok: false,
      erro: "Negado pelo dock do Moductus",
    });
    resposta = { permitida: true };
    expect(
      await executar({ id: "c2", nome: "github__comentar", entrada: { pr: 7, texto: "Pronto" } }),
    ).toMatchObject({
      ok: true,
    });
    await executar({ id: "c3", nome: "sessoes__listar", entrada: {} });
    await executar({ id: "c4", nome: "tarefas__criar", entrada: { titulo: "Revisar PR 7" } });
    // Entrada inválida não chega a pedir aprovação.
    await executar({ id: "c5", nome: "github__comentar", entrada: { pr: -1 } });

    expect(pedidos).toEqual([
      { ferramenta: "github.comentar", entrada: { pr: 7, texto: "Pronto" } },
      { ferramenta: "github.comentar", entrada: { pr: 7, texto: "Pronto" } },
    ]);
    expect(rodou.map((r) => r.nome)).toEqual(["github.comentar", "sessoes.listar", "tarefas.criar"]);
  });

  test("com o provedor falso, o agente recebe só as dele e o modelo lê o erro do que errou", async () => {
    const { catalogo, rodou } = montar();
    const listas = listasDeFabrica();
    const escopo = catalogo.doAgente(listas.nuno ?? []);
    const provedor = new ProvedorFalso("falso", [
      { tipo: "ferramenta", nome: "financas__lancar", entrada: { valorCentavos: 100, descricao: "café" } },
      { tipo: "ferramenta", nome: "tarefas__criar", entrada: {} },
      { tipo: "ferramenta", nome: "tarefas__criar", entrada: { titulo: "Revisar PR 7" } },
      { tipo: "fim" },
    ]);
    const pedido: PedidoDoAgente = {
      agenteId: "nuno",
      execucaoId: "exec-1",
      instrucoes: "",
      mensagens: [{ papel: "usuario", texto: "anota o café e cria a tarefa" }],
      ferramentas: escopo.oferecidas(),
      executarFerramenta: escopo.executor(contexto("nuno")),
      continuarDe: null,
    };

    const eventos: EventoAgente[] = [];
    for await (const e of provedor.executar(pedido, new AbortController().signal)) eventos.push(e);

    expect(provedor.pedidos[0]?.ferramentas.map((f) => f.nome)).not.toContain("financas__lancar");
    const resultados = eventos.flatMap((e) => (e.tipo === "resultado" ? [e.resultado] : []));
    expect(resultados).toEqual([
      { ok: false, erro: expect.stringContaining("não está disponível") },
      { ok: false, erro: "Entrada inválida para tarefas.criar. titulo: campo obrigatório." },
      { ok: true, valor: { ok: "tarefas.criar" } },
    ]);
    expect(rodou.map((r) => r.nome)).toEqual(["tarefas.criar"]);
  });
});
