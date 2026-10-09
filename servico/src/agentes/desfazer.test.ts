import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ChamadaFerramenta, type Execucao } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { abrirBanco } from "../banco/conexao.ts";
import { DO_USUARIO } from "../banco/tabela.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta, RecusaDesfazer, type ContextoDesfazer } from "../ferramentas/ferramenta.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import {
  MENSAGENS_DESFAZER,
  PRAZO_DESFAZER_MS,
  RepositorioExecucoes,
  ServicoExecucoes,
} from "./execucoes.ts";
import { MENSAGEM_CANCELADA, Runtime } from "./runtime.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const INICIO = Date.UTC(2026, 9, 9, 12, 0, 0);

/**
 * Uma área de notas de mentira no banco do serviço: `teste.anotar` cria, a inversa apaga. A
 * inversa só apaga a nota que continua como o agente deixou, como uma área de verdade faria, e
 * pode ser mandada quebrar depois de já ter apagado (gravou metade).
 */
function areaDeNotas(banco: { db: DatabaseSync }) {
  const inversas: { resultado: unknown; ctx: ContextoDesfazer }[] = [];
  const estado = { quebrarDepoisDeApagar: false };
  let proxima = 1;
  const portas = new Map<string, () => void>();
  const ferramentas = [
    ferramenta({
      nome: "teste.anotar",
      descricao: "Anota um texto",
      entrada: z.object({ texto: z.string().min(1) }),
      efeito: "interno",
      executar: ({ texto }) => {
        const id = `n${proxima++}`;
        banco.db.prepare("INSERT INTO notas_teste (id, texto) VALUES (?, ?)").run(id, texto);
        return { id, texto };
      },
      desfazer: (resultado, ctx) => {
        inversas.push({ resultado, ctx });
        const { id, texto } = resultado as { id: string; texto: string };
        const nota = banco.db.prepare("SELECT texto FROM notas_teste WHERE id = ?").get(id) as
          { texto: string } | undefined;
        if (nota?.texto !== texto) throw new RecusaDesfazer("a nota mudou depois que o agente anotou.");
        banco.db.prepare("DELETE FROM notas_teste WHERE id = ?").run(id);
        if (estado.quebrarDepoisDeApagar) throw new TypeError("cannot read properties of undefined");
      },
    }),
    ferramenta({
      nome: "teste.ler",
      descricao: "Lê as notas",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => banco.db.prepare("SELECT texto FROM notas_teste").all(),
    }),
    ferramenta({
      nome: "teste.esperar",
      descricao: "Espera a porta abrir",
      entrada: z.object({ chave: z.string() }),
      efeito: "leitura",
      executar: ({ chave }) => new Promise<null>((resolve) => portas.set(chave, () => resolve(null))),
    }),
    ferramenta({
      nome: "teste.publicar",
      descricao: "Publica fora do Moductus",
      entrada: z.object({ alvo: z.string() }),
      efeito: "externo",
      executar: () => null,
      cartao: ({ alvo }) => ({ descricao: `Vou publicar em ${alvo}.`, rotulo: `Publicar em ${alvo}` }),
    }),
    ferramenta({
      nome: "teste.quebrar",
      descricao: "Sempre falha",
      entrada: z.object({}),
      efeito: "interno",
      executar: () => {
        throw new Error("não deu");
      },
      desfazer: () => {
        throw new Error("não devia rodar");
      },
    }),
    ferramenta({
      nome: "teste.demorar",
      descricao: "Grava e trabalha até a execução ser cancelada",
      entrada: z.object({}),
      efeito: "interno",
      executar: (_entrada, ctx) =>
        new Promise((_resolve, rejeitar) => {
          banco.db.prepare("INSERT INTO notas_teste (id, texto) VALUES ('meio', 'pela metade')").run();
          portas.set("demorar", () => {});
          ctx.sinal.addEventListener("abort", () => rejeitar(new Error("parou no meio")), { once: true });
        }),
      desfazer: () => {
        throw new Error("não devia rodar");
      },
    }),
  ];
  const abrir = (chave: string) => {
    const abrirPorta = portas.get(chave);
    if (!abrirPorta) throw new Error(`ninguém esperando em ${chave}`);
    abrirPorta();
  };
  const notas = () =>
    (banco.db.prepare("SELECT texto FROM notas_teste ORDER BY id").all() as { texto: string }[]).map(
      (n) => n.texto,
    );
  return { inversas, ferramentas, estado, portas, abrir, notas };
}

/**
 * Banco migrado, a Alba com um provedor falso e as ferramentas de teste, e um relógio que o teste
 * adianta. O runtime e o histórico leem o mesmo relógio.
 */
function montar(pasta = mkdtempSync(join(tmpdir(), "moductus-desfazer-"))) {
  if (!pastas.includes(pasta)) pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso da Alba');
    UPDATE agentes SET provedor_id = 'p-alba', ferramentas = '["teste.*"]' WHERE id = 'alba';
  `);
  db.exec("CREATE TABLE notas_teste (id TEXT PRIMARY KEY, texto TEXT NOT NULL) STRICT");
  const falso = new ProvedorFalso("p-alba");
  // A área lê o banco por aqui, para o teste trocar pelo banco reaberto.
  const banco = { db };
  const area = areaDeNotas(banco);
  const catalogo = new Catalogo(area.ferramentas);
  const relogio = { ms: INICIO };
  const agora = () => new Date(relogio.ms);
  const repositorio = new RepositorioExecucoes(db);
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes: repositorio,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
      // Nenhum cartão aprova: a chamada externo fica no histórico como recusada.
      autorizar: async () => ({ permitida: false, motivo: "negado no teste" }),
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const mudou: Execucao[] = [];
  const historico = new ServicoExecucoes(repositorio, catalogo, {
    agora,
    fuso: "America/Sao_Paulo",
    mudou: (e) => mudou.push(e),
  });
  return { db, banco, pasta, falso, area, catalogo, relogio, runtime, repositorio, historico, mudou };
}

const chamar = (nome: string, entrada: unknown): PassoRoteiro => ({ tipo: "ferramenta", nome, entrada });

const pedido = (sinal?: AbortSignal) => ({
  agenteId: "alba",
  gatilho: "mensagem" as const,
  mensagens: [{ papel: "usuario" as const, texto: "anota aí" }],
  sinal,
});

/** Roda uma execução da Alba que chama as ferramentas na ordem, e devolve as chamadas gravadas. */
async function rodar(
  m: ReturnType<typeof montar>,
  chamadas: PassoRoteiro[],
): Promise<{ execucaoId: string; chamadas: ChamadaFerramenta[] }> {
  m.falso.roteirizar([...chamadas, ...roteiros.resposta("Feito.")]);
  const r = await m.runtime.executar(pedido());
  expect(r.execucao.estado).toBe("ok");
  return { execucaoId: r.execucao.id, chamadas: m.historico.obter({ id: r.execucao.id }).chamadas };
}

const carimbo = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT origem, agente_id, execucao_id FROM chamadas_ferramenta WHERE id = ?").get(id);

describe("desfazer pelo histórico do agente", () => {
  test("ida e volta: o agente anota, o usuário desfaz e a nota some; a chamada fica desfeita e dele", async () => {
    const m = montar();
    const { execucaoId, chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "pão" })]);
    expect(m.area.notas()).toEqual(["pão"]);
    const [anotar] = chamadas;
    // O prazo conta da hora da chamada.
    expect(anotar).toMatchObject({
      efeito: "interno",
      desfeitaEm: null,
      desfazerAte: new Date(Date.parse(anotar!.criadoEm) + PRAZO_DESFAZER_MS).toISOString(),
    });

    m.relogio.ms += 60 * 60 * 1000;
    const desfeita = m.historico.desfazer({ chamadaId: anotar!.id });

    expect(m.area.notas()).toEqual([]);
    expect(ChamadaFerramenta.safeParse(desfeita).success).toBe(true);
    expect(desfeita).toMatchObject({
      id: anotar!.id,
      desfeitaEm: new Date(m.relogio.ms).toISOString(),
      desfazerAte: null,
    });
    // A inversa recebe o valor que voltou ao modelo, de quem foi a ação e o carimbo de quem desfaz.
    expect(m.area.inversas).toEqual([
      {
        resultado: { id: "n1", texto: "pão" },
        ctx: { chamadaId: anotar!.id, agenteId: "alba", execucaoId, carimbo: DO_USUARIO },
      },
    ]);
    // Quem mexeu por último foi o usuário (DATA.md §1); a execução continua dona da chamada.
    expect(carimbo(m.db, anotar!.id)).toEqual({ origem: "usuario", agente_id: null, execucao_id: null });
    expect(m.historico.obter({ id: execucaoId }).chamadas[0]).toMatchObject({
      execucaoId,
      desfeitaEm: desfeita.desfeitaEm,
      desfazerAte: null,
    });
    expect(m.mudou.map((e) => e.id)).toEqual([execucaoId]);
  });

  test("depois de reabrir o serviço, a chamada ainda se desfaz pela ferramenta do catálogo", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "leite" })]);
    m.db.close();

    const db = abrirBanco(m.pasta);
    bancos.push(db);
    m.banco.db = db;
    const reaberto = new ServicoExecucoes(new RepositorioExecucoes(db), m.catalogo, {
      agora: () => new Date(m.relogio.ms),
    });
    reaberto.desfazer({ chamadaId: chamadas[0]!.id });
    expect(m.area.notas()).toEqual([]);
  });

  test("fora do prazo, explica até quando dava e não roda a inversa", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "pão" })]);
    const anotar = chamadas[0]!;

    // No último milissegundo ainda dá; um depois, não.
    m.relogio.ms = Date.parse(anotar.desfazerAte!) + 1;
    const erro = MENSAGENS_DESFAZER.foraDoPrazo("10/10 às 09:00");
    expect(erro).toBe("O prazo para desfazer é de 24 horas e acabou em 10/10 às 09:00.");
    expect(() => m.historico.desfazer({ chamadaId: anotar.id })).toThrow(erro);
    expect(m.area.inversas).toEqual([]);
    expect(m.area.notas()).toEqual(["pão"]);
    // O instante continua no histórico: a interface diz até quando dava.
    expect(m.historico.obter({ id: anotar.execucaoId! }).chamadas[0]).toMatchObject({
      desfeitaEm: null,
      desfazerAte: anotar.desfazerAte,
    });

    m.relogio.ms -= 1;
    m.historico.desfazer({ chamadaId: anotar.id });
    expect(m.area.notas()).toEqual([]);
  });

  test("leitura, externo, chamada que falhou e já desfeita não se desfazem, cada uma dizendo por quê", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [
      chamar("teste__ler", {}),
      chamar("teste__publicar", { alvo: "#142" }),
      chamar("teste__quebrar", {}),
      chamar("teste__anotar", { texto: "pão" }),
    ]);
    const [ler, publicar, quebrar, anotar] = chamadas;
    expect(chamadas.map((c) => [c.ferramenta, c.desfazerAte === null])).toEqual([
      ["teste.ler", true],
      ["teste.publicar", true],
      ["teste.quebrar", true],
      ["teste.anotar", false],
    ]);

    const desfazer = (id: string) => () => m.historico.desfazer({ chamadaId: id });
    expect(desfazer(ler!.id)).toThrow(MENSAGENS_DESFAZER.leitura);
    expect(desfazer(publicar!.id)).toThrow(MENSAGENS_DESFAZER.externo);
    expect(desfazer(quebrar!.id)).toThrow(MENSAGENS_DESFAZER.falhou);
    expect(desfazer("nada")).toThrow(MENSAGENS_DESFAZER.naoEncontrada);

    // 12:00 UTC é 09:00 em São Paulo. O segundo clique encontra a chamada já desfeita.
    desfazer(anotar!.id)();
    expect(desfazer(anotar!.id)).toThrow("Já foi desfeita em 09/10 às 09:00.");
    expect(m.area.inversas).toHaveLength(1);
    expect(m.mudou).toHaveLength(1);
  });

  test("a recusa da área chega ao usuário, e a chamada continua desfazível", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "pão" })]);
    // O usuário mexeu na nota depois do agente.
    m.db.prepare("UPDATE notas_teste SET texto = 'pão integral'").run();

    expect(() => m.historico.desfazer({ chamadaId: chamadas[0]!.id })).toThrow(
      "Não deu para desfazer: a nota mudou depois que o agente anotou.",
    );
    expect(m.historico.obter({ id: chamadas[0]!.execucaoId! }).chamadas[0]).toMatchObject({
      desfeitaEm: null,
      desfazerAte: chamadas[0]!.desfazerAte,
    });
    expect(carimbo(m.db, chamadas[0]!.id)).toMatchObject({ origem: "agente", agente_id: "alba" });
    expect(m.mudou).toEqual([]);
  });

  test("inversa que grava metade e lança não deixa nada gravado; o erro vai ao log, não ao usuário", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "pão" })]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.area.estado.quebrarDepoisDeApagar = true;

    expect(() => m.historico.desfazer({ chamadaId: chamadas[0]!.id })).toThrow(
      MENSAGENS_DESFAZER.falhaInterna,
    );
    // A inversa apagou a nota antes de quebrar: a transação volta com ela.
    expect(m.area.notas()).toEqual(["pão"]);
    expect(m.historico.obter({ id: chamadas[0]!.execucaoId! }).chamadas[0]).toMatchObject({
      desfeitaEm: null,
      desfazerAte: chamadas[0]!.desfazerAte,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cannot read properties of undefined"));
    expect(m.mudou).toEqual([]);

    m.area.estado.quebrarDepoisDeApagar = false;
    m.historico.desfazer({ chamadaId: chamadas[0]!.id });
    expect(m.area.notas()).toEqual([]);
  });

  test("ferramenta que saiu do catálogo ou deixou de ser interno não se desfaz e o histórico não oferece", async () => {
    const m = montar();
    const { execucaoId, chamadas } = await rodar(m, [chamar("teste__anotar", { texto: "pão" })]);
    const com = (catalogo: Catalogo) =>
      new ServicoExecucoes(new RepositorioExecucoes(m.db), catalogo, { agora: () => new Date(m.relogio.ms) });
    const semAnotar = com(new Catalogo());
    const anotarVirouLeitura = com(
      new Catalogo([
        ferramenta({
          nome: "teste.anotar",
          descricao: "Agora só mostra",
          entrada: z.object({}),
          efeito: "leitura",
          executar: () => null,
        }),
      ]),
    );

    for (const servico of [semAnotar, anotarVirouLeitura]) {
      expect(servico.obter({ id: execucaoId }).chamadas[0]!.desfazerAte).toBeNull();
    }
    expect(() => semAnotar.desfazer({ chamadaId: chamadas[0]!.id })).toThrow(
      MENSAGENS_DESFAZER.semFerramenta("teste.anotar"),
    );
    expect(() => anotarVirouLeitura.desfazer({ chamadaId: chamadas[0]!.id })).toThrow(
      MENSAGENS_DESFAZER.ferramentaMudou("teste.anotar"),
    );
    expect(m.area.notas()).toEqual(["pão"]);
  });

  test("chamada cancelada no meio da área não diz que nada mudou e não se desfaz", async () => {
    const m = montar();
    m.falso.roteirizar([chamar("teste__demorar", {}), ...roteiros.resposta("não chega")]);
    const cancelar = new AbortController();
    const execucao = m.runtime.executar(pedido(cancelar.signal));
    await vi.waitFor(() => expect(m.area.portas.has("demorar")).toBe(true));
    cancelar.abort();
    const r = await execucao;

    const [demorar] = m.historico.obter({ id: r.execucao.id }).chamadas;
    expect(demorar).toMatchObject({
      ferramenta: "teste.demorar",
      resultado: { ok: false, erro: MENSAGEM_CANCELADA },
      desfazerAte: null,
    });
    expect(() => m.historico.desfazer({ chamadaId: demorar!.id })).toThrow(MENSAGENS_DESFAZER.cancelada);
    expect(MENSAGENS_DESFAZER.cancelada).toBe("A execução foi cancelada no meio; confira o que ficou.");
    // O que a área gravou antes do cancelamento continua lá para o usuário conferir.
    expect(m.area.notas()).toEqual(["pela metade"]);
  });

  test("enquanto a execução roda, desfazer espera o agente terminar", async () => {
    const m = montar();
    m.falso.roteirizar([
      chamar("teste__anotar", { texto: "pão" }),
      chamar("teste__esperar", { chave: "fim" }),
      ...roteiros.resposta("Feito."),
    ]);
    const execucao = m.runtime.executar(pedido());
    await vi.waitFor(() => expect(m.area.portas.has("fim")).toBe(true));
    const { id } = m.db
      .prepare("SELECT id FROM chamadas_ferramenta WHERE ferramenta = 'teste.anotar'")
      .get() as {
      id: string;
    };

    expect(() => m.historico.desfazer({ chamadaId: id })).toThrow(MENSAGENS_DESFAZER.rodando);
    expect(MENSAGENS_DESFAZER.rodando).toBe(
      "O agente ainda está trabalhando nisso. Dá para desfazer quando ele terminar.",
    );
    expect(m.area.notas()).toEqual(["pão"]);

    m.area.abrir("fim");
    await execucao;
    m.historico.desfazer({ chamadaId: id });
    expect(m.area.notas()).toEqual([]);
  });
});
