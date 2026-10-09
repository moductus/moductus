import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ChamadaFerramenta, type Execucao } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta, type ContextoDesfazer } from "../ferramentas/ferramenta.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import {
  MENSAGENS_DESFAZER,
  PRAZO_DESFAZER_MS,
  RepositorioExecucoes,
  ServicoExecucoes,
} from "./execucoes.ts";
import { Runtime } from "./runtime.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const INICIO = Date.UTC(2026, 9, 9, 12, 0, 0);

/**
 * Uma área de notas de mentira, fora do banco: `teste.anotar` cria, a inversa apaga. A inversa só
 * apaga a nota que continua como o agente deixou, como uma área de verdade faria.
 */
function areaDeNotas() {
  const notas = new Map<string, string>();
  const inversas: { entrada: unknown; resultado: unknown; ctx: ContextoDesfazer }[] = [];
  let proxima = 1;
  let segurar: Promise<void> | null = null;
  const ferramentas = [
    ferramenta({
      nome: "teste.anotar",
      descricao: "Anota um texto",
      entrada: z.object({ texto: z.string().min(1), fixar: z.boolean().default(false) }),
      efeito: "interno",
      executar: ({ texto }) => {
        const id = `n${proxima++}`;
        notas.set(id, texto);
        return { id };
      },
      desfazer: async (entrada, resultado, ctx) => {
        inversas.push({ entrada, resultado, ctx });
        if (segurar) await segurar;
        const { id } = resultado as { id: string };
        if (notas.get(id) !== entrada.texto) throw new Error("a nota mudou depois que o agente anotou.");
        notas.delete(id);
      },
    }),
    ferramenta({
      nome: "teste.ler",
      descricao: "Lê as notas",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => [...notas.values()],
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
  ];
  return {
    notas,
    inversas,
    ferramentas,
    /** Segura a inversa até a promessa resolver, para ver dois pedidos ao mesmo tempo. */
    segurarInversa: (p: Promise<void> | null) => {
      segurar = p;
    },
  };
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
  const falso = new ProvedorFalso("p-alba");
  const area = areaDeNotas();
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
  return { db, pasta, falso, area, catalogo, relogio, runtime, historico, mudou };
}

/** Roda uma execução da Alba que chama as ferramentas na ordem, e devolve as chamadas gravadas. */
async function rodar(
  m: ReturnType<typeof montar>,
  chamadas: { nome: string; entrada: unknown }[],
): Promise<{ execucaoId: string; chamadas: ChamadaFerramenta[] }> {
  m.falso.roteirizar([
    ...chamadas.map((c) => ({ tipo: "ferramenta" as const, nome: c.nome, entrada: c.entrada })),
    ...roteiros.resposta("Feito."),
  ]);
  const r = await m.runtime.executar({
    agenteId: "alba",
    gatilho: "mensagem",
    mensagens: [{ papel: "usuario", texto: "anota aí" }],
  });
  expect(r.execucao.estado).toBe("ok");
  return { execucaoId: r.execucao.id, chamadas: m.historico.obter({ id: r.execucao.id }).chamadas };
}

const carimbo = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT origem, agente_id, execucao_id FROM chamadas_ferramenta WHERE id = ?").get(id);

describe("desfazer pelo histórico do agente", () => {
  test("ida e volta: o agente anota, o usuário desfaz e a nota some; a chamada fica desfeita e dele", async () => {
    const m = montar();
    const { execucaoId, chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "pão" } }]);
    expect([...m.area.notas.values()]).toEqual(["pão"]);
    const [anotar] = chamadas;
    // O prazo conta da hora da chamada.
    expect(anotar).toMatchObject({
      efeito: "interno",
      desfeitaEm: null,
      desfazerAte: new Date(Date.parse(anotar!.criadoEm) + PRAZO_DESFAZER_MS).toISOString(),
    });

    m.relogio.ms += 60 * 60 * 1000;
    const desfeita = await m.historico.desfazer({ chamadaId: anotar!.id });

    expect(m.area.notas.size).toBe(0);
    expect(ChamadaFerramenta.safeParse(desfeita).success).toBe(true);
    expect(desfeita).toMatchObject({
      id: anotar!.id,
      desfeitaEm: new Date(m.relogio.ms).toISOString(),
      desfazerAte: null,
    });
    // A inversa recebe a entrada validada (com o padrão), o valor que voltou ao modelo e de quem foi a ação.
    expect(m.area.inversas).toEqual([
      {
        entrada: { texto: "pão", fixar: false },
        resultado: { id: "n1" },
        ctx: { chamadaId: anotar!.id, agenteId: "alba", execucaoId },
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
    const { chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "leite" } }]);
    m.db.close();

    const db = abrirBanco(m.pasta);
    bancos.push(db);
    const reaberto = new ServicoExecucoes(new RepositorioExecucoes(db), m.catalogo, {
      agora: () => new Date(m.relogio.ms),
    });
    await reaberto.desfazer({ chamadaId: chamadas[0]!.id });
    expect(m.area.notas.size).toBe(0);
  });

  test("fora do prazo, explica até quando dava e não roda a inversa", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "pão" } }]);
    const anotar = chamadas[0]!;

    // No último milissegundo ainda dá; um depois, não.
    m.relogio.ms = Date.parse(anotar.desfazerAte!) + 1;
    const erro = MENSAGENS_DESFAZER.foraDoPrazo("10/10 às 09:00");
    expect(erro).toBe("O prazo para desfazer é de 24 horas e acabou em 10/10 às 09:00.");
    await expect(m.historico.desfazer({ chamadaId: anotar.id })).rejects.toThrow(erro);
    expect(m.area.inversas).toEqual([]);
    expect([...m.area.notas.values()]).toEqual(["pão"]);
    // O instante continua no histórico: a interface diz até quando dava.
    expect(m.historico.obter({ id: anotar.execucaoId! }).chamadas[0]).toMatchObject({
      desfeitaEm: null,
      desfazerAte: anotar.desfazerAte,
    });

    m.relogio.ms -= 1;
    await m.historico.desfazer({ chamadaId: anotar.id });
    expect(m.area.notas.size).toBe(0);
  });

  test("leitura, externo, chamada que falhou e já desfeita não se desfazem, cada uma dizendo por quê", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [
      { nome: "teste__ler", entrada: {} },
      { nome: "teste__publicar", entrada: { alvo: "#142" } },
      { nome: "teste__quebrar", entrada: {} },
      { nome: "teste__anotar", entrada: { texto: "pão" } },
    ]);
    const [ler, publicar, quebrar, anotar] = chamadas;
    expect(chamadas.map((c) => [c.ferramenta, c.desfazerAte === null])).toEqual([
      ["teste.ler", true],
      ["teste.publicar", true],
      ["teste.quebrar", true],
      ["teste.anotar", false],
    ]);

    await expect(m.historico.desfazer({ chamadaId: ler!.id })).rejects.toThrow(MENSAGENS_DESFAZER.leitura);
    await expect(m.historico.desfazer({ chamadaId: publicar!.id })).rejects.toThrow(
      MENSAGENS_DESFAZER.externo,
    );
    await expect(m.historico.desfazer({ chamadaId: quebrar!.id })).rejects.toThrow(MENSAGENS_DESFAZER.falhou);
    await expect(m.historico.desfazer({ chamadaId: "nada" })).rejects.toThrow(
      MENSAGENS_DESFAZER.naoEncontrada,
    );

    // 12:00 UTC é 09:00 em São Paulo.
    await m.historico.desfazer({ chamadaId: anotar!.id });
    await expect(m.historico.desfazer({ chamadaId: anotar!.id })).rejects.toThrow(
      "Já foi desfeita em 09/10 às 09:00.",
    );
    expect(m.area.inversas).toHaveLength(1);
    expect(m.mudou).toHaveLength(1);
  });

  test("a área que não consegue desfazer explica, e a chamada continua desfazível", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "pão" } }]);
    // O usuário mexeu na nota depois do agente.
    m.area.notas.set("n1", "pão integral");

    await expect(m.historico.desfazer({ chamadaId: chamadas[0]!.id })).rejects.toThrow(
      "Não deu para desfazer: a nota mudou depois que o agente anotou.",
    );
    expect(m.historico.obter({ id: chamadas[0]!.execucaoId! }).chamadas[0]).toMatchObject({
      desfeitaEm: null,
      desfazerAte: chamadas[0]!.desfazerAte,
    });
    expect(carimbo(m.db, chamadas[0]!.id)).toMatchObject({ origem: "agente", agente_id: "alba" });
    expect(m.mudou).toEqual([]);
  });

  test("ferramenta que saiu do catálogo não se desfaz e o histórico não oferece", async () => {
    const m = montar();
    const { execucaoId, chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "pão" } }]);
    const semAnotar = new ServicoExecucoes(new RepositorioExecucoes(m.db), new Catalogo(), {
      agora: () => new Date(m.relogio.ms),
    });

    expect(semAnotar.obter({ id: execucaoId }).chamadas[0]!.desfazerAte).toBeNull();
    await expect(semAnotar.desfazer({ chamadaId: chamadas[0]!.id })).rejects.toThrow(
      MENSAGENS_DESFAZER.semFerramenta("teste.anotar"),
    );
  });

  test("dois pedidos ao mesmo tempo desfazem uma vez só", async () => {
    const m = montar();
    const { chamadas } = await rodar(m, [{ nome: "teste__anotar", entrada: { texto: "pão" } }]);
    let soltar = () => {};
    m.area.segurarInversa(new Promise<void>((resolve) => (soltar = resolve)));

    const primeiro = m.historico.desfazer({ chamadaId: chamadas[0]!.id });
    await vi.waitFor(() => expect(m.area.inversas).toHaveLength(1));
    await expect(m.historico.desfazer({ chamadaId: chamadas[0]!.id })).rejects.toThrow(
      MENSAGENS_DESFAZER.emAndamento,
    );
    soltar();
    await expect(primeiro).resolves.toMatchObject({ desfazerAte: null });
    expect(m.area.inversas).toHaveLength(1);
  });
});
