import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { EVENTOS, type Aprovacao, type ContagensAreas } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { RepositorioGithub } from "../conexoes/github/github.ts";
import { ServicoContagens, sessoesEsperando, type FontesContagens } from "./contagens.ts";
import { RepositorioLembretes } from "./lembretes/lembretes.ts";
import { RepositorioNotas, ServicoNotas } from "./notas/notas.ts";
import { RepositorioTarefas } from "./tarefas/repositorio.ts";
import { ServicoTarefas } from "./tarefas/tarefas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Domingo, 18/10/2026, 23:30 em São Paulo (UTC−3): meia hora antes da virada do dia. */
const DOMINGO_23H30 = "2026-10-19T02:30:00.000Z";

/**
 * As Tarefas de verdade sobre um banco migrado, ligadas às contagens como no `main.ts`: o aviso de
 * cada mudança reconta, e o aviso das contagens é guardado com o instante em que saiu.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-contagens-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const relogio = { agora: new Date(DOMINGO_23H30) };
  const avisos: { contagens: ContagensAreas; ms: number }[] = [];
  const outras = { sessoes: 0 };
  let recontar = () => {};
  const notas = new ServicoNotas(
    new RepositorioNotas(db),
    { mudou: () => {} },
    { agora: () => relogio.agora },
  );
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => "America/Sao_Paulo", notas },
    { tarefas: () => recontar(), listas: () => {}, lembretes: () => recontar() },
    { agora: () => relogio.agora },
  );
  const lembretes = new RepositorioLembretes(db);
  const github = new RepositorioGithub(db);
  const contagens = new ServicoContagens(
    {
      tarefasPendentes: () => tarefas.pendentesDeHoje(),
      lembretesAtrasados: () => lembretes.contarPerdidos(),
      sessoesEsperando: () => outras.sessoes,
      devPrecisando: () => github.contarPrecisandoDeMim(),
    },
    (c) => avisos.push({ contagens: c, ms: performance.now() }),
  );
  recontar = () => contagens.recontar();
  return { db, relogio, tarefas, contagens, avisos, outras, github };
}

const ZERO: ContagensAreas = {
  tarefasPendentes: 0,
  lembretesAtrasados: 0,
  sessoesEsperando: 0,
  devPrecisando: 0,
};

describe("contagens das áreas", () => {
  test("concluir uma tarefa muda a contagem no aviso da própria operação, bem abaixo de 300 ms", () => {
    const { tarefas, contagens, avisos } = montar();
    expect(contagens.obter()).toEqual(ZERO);
    const tarefa = tarefas.criar({ titulo: "Ligar para o banco", venceEm: "2026-10-18" });
    expect(avisos.at(-1)!.contagens.tarefasPendentes).toBe(1);

    const antes = performance.now();
    tarefas.concluir({ id: tarefa.id });
    const aviso = avisos.at(-1)!;
    expect(aviso.contagens.tarefasPendentes).toBe(0);
    expect(aviso.ms - antes).toBeLessThan(300);
    // O que o aviso disse é o que o método devolve, e cabe no evento do contrato.
    expect(contagens.obter()).toEqual(aviso.contagens);
    expect(EVENTOS["areas.contagens"].parse(aviso.contagens)).toEqual(aviso.contagens);
  });

  test("pendentes de hoje são as abertas de hoje e as atrasadas; amanhã, sem dia e feitas ficam de fora", () => {
    const { tarefas, contagens } = montar();
    tarefas.criar({ titulo: "hoje", venceEm: "2026-10-18" });
    tarefas.criar({ titulo: "veio de ontem", venceEm: "2026-10-17" });
    tarefas.criar({ titulo: "amanhã", venceEm: "2026-10-19" });
    tarefas.criar({ titulo: "sem dia" });
    const feita = tarefas.criar({ titulo: "feita", venceEm: "2026-10-18" });
    tarefas.concluir({ id: feita.id });
    const apagada = tarefas.criar({ titulo: "apagada", venceEm: "2026-10-18" });
    tarefas.apagar({ id: apagada.id });
    expect(contagens.obter().tarefasPendentes).toBe(2);
  });

  test("a virada do dia no fuso entra na contagem sem ninguém mexer nas tarefas", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { tarefas, contagens, avisos, relogio } = montar();
    tarefas.criar({ titulo: "amanhã", venceEm: "2026-10-19" });
    expect(contagens.obter().tarefasPendentes).toBe(0);
    const parar = contagens.vigiar(60_000);
    // 00:00 em São Paulo: a de amanhã virou de hoje.
    relogio.agora = new Date("2026-10-19T03:00:00.000Z");
    vi.advanceTimersByTime(60_000);
    expect(avisos.at(-1)!.contagens.tarefasPendentes).toBe(1);
    parar();
  });

  test("lembretes atrasados são os perdidos vivos", () => {
    const { db, contagens } = montar();
    const inserir = db.prepare(
      `INSERT INTO lembretes (id, texto, quando, estado, criado_em, atualizado_em, apagado_em)
         VALUES (?, 'beber água', '2026-10-18T18:00:00.000Z', ?, '2026-10-18T12:00:00.000Z',
                 '2026-10-18T12:00:00.000Z', ?)`,
    );
    inserir.run("01JA0000000000000000000001", "perdido", null);
    inserir.run("01JA0000000000000000000002", "perdido", null);
    inserir.run("01JA0000000000000000000003", "perdido", "2026-10-18T13:00:00.000Z");
    inserir.run("01JA0000000000000000000004", "agendado", null);
    expect(contagens.obter().lembretesAtrasados).toBe(2);
  });

  test("só avisa quando algum número muda", () => {
    const { contagens, avisos, outras } = montar();
    contagens.recontar();
    contagens.recontar();
    expect(avisos).toHaveLength(1);
    outras.sessoes = 3;
    contagens.recontar();
    expect(avisos.map((a) => a.contagens.sessoesEsperando)).toEqual([0, 3]);
  });

  test("fonte que falha não derruba quem avisou: fica o último número dela", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let sessoes = 2;
    let falhar = false;
    const fontes: FontesContagens = {
      tarefasPendentes: () => 1,
      lembretesAtrasados: () => {
        if (falhar) throw new Error("banco travado");
        return 4;
      },
      sessoesEsperando: () => sessoes,
      devPrecisando: () => (falhar ? -1 : 0),
    };
    const avisos: ContagensAreas[] = [];
    const contagens = new ServicoContagens(fontes, (c) => avisos.push(c));
    contagens.recontar();
    falhar = true;
    sessoes = 3;
    expect(() => contagens.recontar()).not.toThrow();
    expect(avisos.at(-1)).toEqual({
      tarefasPendentes: 1,
      lembretesAtrasados: 4,
      sessoesEsperando: 3,
      devPrecisando: 0,
    });
    // O aviso que falha também não sobe para a área que gravou.
    const quebrado = new ServicoContagens(fontes, () => {
      throw new Error("canal fechado");
    });
    expect(() => quebrado.recontar()).not.toThrow();
  });
});

function pedido(id: string, sessaoId: string | null, fonte: Aprovacao["fonte"] = "claude-code"): Aprovacao {
  return {
    id,
    fonte,
    agenteId: null,
    execucaoId: null,
    sessaoId,
    descricao: "Quer rodar o comando abaixo.",
    acao: { ferramenta: "Bash", entrada: {}, rotulo: null, rotuloRecusar: null, desfazivel: false },
    estado: "pendente",
    criadoEm: "2026-10-18T12:00:00.000Z",
    decididaEm: null,
    regraCriadaId: null,
    admiteSempre: true,
  };
}

describe("sessoesEsperando", () => {
  test("conta sessões do terminal com pedido pendente; pedido sem sessão conta sozinho", () => {
    expect(
      sessoesEsperando([
        pedido("a1", "s1"),
        pedido("a2", "s1"),
        pedido("a3", "s2", "opencode"),
        pedido("a4", null),
        pedido("a5", null),
        pedido("a6", null, "moductus"),
        { ...pedido("a7", "s3"), estado: "aprovada" },
      ]),
    ).toBe(4);
  });
});

describe("devPrecisando", () => {
  const item = (
    numero: number,
    precisaDeMim: boolean,
    estado: "aberto" | "fechado" | "mesclado" = "aberto",
  ) => ({
    repositorio: "dono/repo",
    numero,
    tipo: "pr" as const,
    titulo: "t",
    autor: null,
    estado,
    meuPapel: "revisor" as const,
    precisaDeMim,
    ciEstado: null,
    atualizadoNoGithub: null,
    url: "https://github.com/dono/repo/pull/1",
  });

  test("conta no cache do GitHub os abertos que precisam de você", () => {
    const { contagens, github } = montar();
    github.substituir(
      [item(1, true), item(2, true), item(3, false), item(4, true, "mesclado")],
      "2026-10-18T12:00:00.000Z",
    );
    expect(contagens.obter().devPrecisando).toBe(2);
    github.limpar();
    expect(contagens.obter().devPrecisando).toBe(0);
  });
});
