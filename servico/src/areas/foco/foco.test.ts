import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG_PADRAO, METODOS, type CiclosFoco, type EstadoFoco } from "@moductus/contrato";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import {
  RepositorioNotificacoes,
  ServicoNotificacoes,
  type AvisoWindows,
} from "../../notificacoes/notificacoes.ts";
import { RelogioDoDia } from "../dia/relogio.ts";
import {
  BOTOES_DO_CICLO,
  MENSAGEM_EM_ANDAMENTO,
  MENSAGEM_JA_PAUSADA,
  MENSAGEM_NAO_PAUSADA,
  MENSAGEM_PARADO,
  MENSAGEM_SEM_PAUSA,
  MENSAGEM_TAREFA,
  RepositorioFoco,
  ServicoFoco,
} from "./foco.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const MIN = 60_000;
/** Os horários do teste são de São Paulo (UTC−3, sem horário de verão): 14:00 é 17:00Z. */
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`);
const iso = (d: Date) => d.toISOString();
const HOJE = "2026-10-08";
const TAREFA = "Revisar PR do relatório mensal";

/**
 * Banco migrado de verdade, as notificações de verdade com uma casca de mentira que só anota, e o
 * relógio do dia de verdade sobre o relógio falso do vitest. Nenhum provedor, nenhuma rede.
 */
function montar(opcoes: { agora?: Date; pasta?: string } = {}) {
  vi.setSystemTime(opcoes.agora ?? sp(HOJE, "14:00"));
  const pasta = opcoes.pasta ?? mkdtempSync(join(tmpdir(), "moductus-foco-"));
  if (!opcoes.pasta) pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const casca = { mostrados: [] as AvisoWindows[], retirados: [] as string[] };
  const agentes = new RepositorioAgentes(db);
  let foco: ServicoFoco | null = null;
  const notificacoes = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentes.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => CONFIG_PADRAO.silencio,
      windows: {
        mostrar: (aviso) => {
          casca.mostrados.push(aviso);
          return Promise.resolve();
        },
        retirar: (id) => {
          casca.retirados.push(id);
          return Promise.resolve();
        },
        telaCheia: () => Promise.resolve(false),
      },
      // Como no main.ts: o silêncio pergunta ao foco de verdade.
      emFoco: () => foco?.emFoco() ?? false,
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const relogio = new RelogioDoDia();
  const config: { fuso: string; foco: CiclosFoco } = {
    fuso: "America/Sao_Paulo",
    foco: { ...CONFIG_PADRAO.dia.foco },
  };
  const mudancas: EstadoFoco[] = [];
  foco = new ServicoFoco(
    new RepositorioFoco(db),
    { lerDia: () => config, notificacoes, relogio },
    { mudou: (estado) => mudancas.push(estado) },
  );
  relogio.registrar(foco);
  return { db, pasta, casca, notificacoes, relogio, foco, mudancas, config };
}

const comTarefa = (db: DatabaseSync, id = "t1", titulo = TAREFA) =>
  db.prepare("INSERT INTO tarefas (id, lista_id, titulo) VALUES (?, 'trabalho', ?)").run(id, titulo);

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

const avancar = (minutos: number) => vi.advanceTimersByTimeAsync(minutos * MIN);

describe("ciclo", () => {
  test("começa livre com a duração da configuração e fecha pelo relógio do dia, avisando uma vez", async () => {
    const { casca, relogio, foco, mudancas } = montar();
    await relogio.ligar();
    const estado = foco.iniciar({});
    confere("foco.iniciar", estado);
    expect(estado).toMatchObject({
      etapa: {
        tipo: "foco",
        tarefaId: null,
        inicio: iso(sp(HOJE, "14:00")),
        terminaEm: iso(sp(HOJE, "14:25")),
        pausadaEm: null,
        fim: null,
        duracaoPlanejadaMin: 25,
        interrompida: false,
      },
      tarefaTitulo: null,
      cicloAtual: 1,
      ciclosAtePausaLonga: 4,
      proxima: "pausa",
      podeEstender: true,
      focoHojeMin: 0,
      ciclosHoje: 0,
    });
    expect(mudancas.at(-1)).toEqual(estado);

    await vi.advanceTimersByTimeAsync(25 * MIN - 1);
    expect(foco.obter().etapa).not.toBeNull();
    expect(casca.mostrados).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const terminado = foco.obter();
    confere("foco.obter", terminado);
    expect(terminado).toMatchObject({
      etapa: null,
      cicloAtual: 1,
      proxima: "pausa",
      // O foco que o relógio fechou completo ainda estica pelo "+5 min".
      podeEstender: true,
      focoHojeMin: 25,
      ciclosHoje: 1,
    });
    expect(mudancas.at(-1)).toEqual(terminado);
    expect(casca.mostrados).toEqual([
      expect.objectContaining({
        agente: "Alba",
        titulo: "Ciclo 1 de 4 terminou",
        corpo: "25 min de foco. Começo a pausa de 5 min?",
        botoes: BOTOES_DO_CICLO,
      }),
    ]);

    // Nada começa sozinho depois do foco, e o aviso não repete.
    await avancar(60);
    expect(foco.obter().etapa).toBeNull();
    expect(casca.mostrados).toHaveLength(1);
  });

  test("a pausa corre e o foco seguinte começa sozinho, sem tocar, ligado à mesma tarefa", async () => {
    const { db, casca, relogio, foco } = montar();
    comTarefa(db);
    await relogio.ligar();
    expect(foco.iniciar({ tarefaId: "t1" })).toMatchObject({
      etapa: { tarefaId: "t1" },
      tarefaTitulo: TAREFA,
    });
    await avancar(25);
    const [aviso] = casca.mostrados;
    expect(aviso?.corpo).toBe(`25 min de foco em ${TAREFA}. Começo a pausa de 5 min?`);
    // Na proposta da pausa, a tarefa da rodada continua no painel.
    expect(foco.obter().tarefaTitulo).toBe(TAREFA);

    const pausa = foco.iniciar({});
    expect(pausa).toMatchObject({
      etapa: { tipo: "pausa", tarefaId: "t1", terminaEm: iso(sp(HOJE, "14:30")) },
      cicloAtual: 1,
      proxima: "foco",
    });
    // Começar a pausa resolve o aviso do ciclo.
    await vi.advanceTimersByTimeAsync(0);
    expect(casca.retirados).toContain(aviso?.id);

    await avancar(5);
    const seguinte = foco.obter();
    expect(seguinte).toMatchObject({
      etapa: {
        tipo: "foco",
        tarefaId: "t1",
        inicio: iso(sp(HOJE, "14:30")),
        terminaEm: iso(sp(HOJE, "14:55")),
      },
      tarefaTitulo: TAREFA,
      cicloAtual: 2,
      proxima: "pausa",
      focoHojeMin: 25,
      ciclosHoje: 1,
    });
    expect(casca.mostrados).toHaveLength(1);
  });

  test("depois do quarto foco vem a pausa longa; no fim dela a rodada fecha e a Alba resume", async () => {
    const { db, casca, relogio, foco } = montar();
    comTarefa(db);
    await relogio.ligar();
    foco.iniciar({ tarefaId: "t1" });
    for (let ciclo = 1; ciclo <= 3; ciclo++) {
      await avancar(25);
      expect(foco.obter()).toMatchObject({ cicloAtual: ciclo, proxima: "pausa" });
      foco.iniciar({});
      await avancar(5);
    }
    expect(foco.obter()).toMatchObject({ etapa: { tipo: "foco" }, cicloAtual: 4, proxima: "pausa_longa" });
    await avancar(25);
    expect(casca.mostrados.at(-1)).toMatchObject({
      titulo: "Ciclo 4 de 4 terminou",
      corpo: `25 min de foco em ${TAREFA}. Começo a pausa longa de 15 min?`,
    });
    expect(foco.iniciar({})).toMatchObject({ etapa: { tipo: "pausa_longa", duracaoPlanejadaMin: 15 } });
    await avancar(15);
    expect(foco.obter()).toMatchObject({
      etapa: null,
      cicloAtual: 1,
      proxima: "foco",
      focoHojeMin: 100,
      ciclosHoje: 4,
      tarefaTitulo: null,
    });
    expect(casca.mostrados.at(-1)).toMatchObject({
      agente: "Alba",
      titulo: "Rodada completa",
      corpo: "4 ciclos, 1h40 de foco. Começo outra rodada?",
    });
    // A rodada nova começa no ciclo 1 e livre.
    expect(foco.iniciar({})).toMatchObject({ etapa: { tipo: "foco", tarefaId: null }, cicloAtual: 1 });
  });

  test("pausar congela; o tempo parado empurra o fim e não conta no histórico", async () => {
    const { relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(10);
    expect(foco.pausar()).toMatchObject({
      etapa: { pausadaEm: iso(sp(HOJE, "14:10")), terminaEm: iso(sp(HOJE, "14:25")) },
    });
    expect(foco.emFoco()).toBe(false);
    // Parada, a etapa não vence.
    await avancar(30);
    expect(foco.obter().etapa).toMatchObject({ fim: null, pausadaEm: iso(sp(HOJE, "14:10")) });
    expect(foco.retomar()).toMatchObject({ etapa: { pausadaEm: null, terminaEm: iso(sp(HOJE, "14:55")) } });
    expect(foco.emFoco()).toBe(true);
    await avancar(15);
    const { etapas } = foco.historico({ de: HOJE, ate: HOJE });
    expect(etapas).toEqual([
      expect.objectContaining({
        fim: iso(sp(HOJE, "14:55")),
        duracaoRealMin: 25,
        interrompida: false,
      }),
    ]);
    expect(foco.obter()).toMatchObject({ focoHojeMin: 25, ciclosHoje: 1 });
  });

  test("+5 min estica a etapa; no ciclo terminado, o foco volta a correr sem contar o intervalo", async () => {
    const { casca, relogio, foco } = montar();
    await relogio.ligar();
    const inicio = foco.iniciar({});
    expect(foco.estender({ minutos: 5 })).toMatchObject({
      etapa: { terminaEm: iso(sp(HOJE, "14:30")), duracaoPlanejadaMin: 30 },
    });
    await avancar(30);
    expect(foco.obter().etapa).toBeNull();
    const aviso = casca.mostrados[0];
    await avancar(2);
    const reaberta = foco.estender({ minutos: 5 });
    expect(reaberta).toMatchObject({
      etapa: { id: inicio.etapa?.id, fim: null, terminaEm: iso(sp(HOJE, "14:37")), duracaoPlanejadaMin: 35 },
      focoHojeMin: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(casca.retirados).toContain(aviso?.id);
    await avancar(5);
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas).toEqual([
      expect.objectContaining({ fim: iso(sp(HOJE, "14:37")), duracaoRealMin: 35, interrompida: false }),
    ]);
    expect(foco.obter()).toMatchObject({ focoHojeMin: 35, ciclosHoje: 1 });
  });

  test("terminar antes da hora fica interrompido: conta os minutos, não o ciclo; terminar a pausa encerra a rodada", async () => {
    const { casca, relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(10);
    expect(foco.terminar()).toMatchObject({
      etapa: null,
      cicloAtual: 1,
      proxima: "pausa",
      podeEstender: false,
      focoHojeMin: 10,
      ciclosHoje: 0,
    });
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      fim: iso(sp(HOJE, "14:10")),
      duracaoRealMin: 10,
      interrompida: true,
    });
    // Quem terminou foi o usuário: a Alba não avisa.
    await avancar(30);
    expect(casca.mostrados).toHaveLength(0);
    // O foco interrompido não volta a correr pelo "+5 min".
    expect(() => foco.estender({ minutos: 5 })).toThrow(MENSAGEM_PARADO);

    foco.iniciar({});
    await avancar(1);
    expect(foco.terminar()).toMatchObject({ etapa: null, cicloAtual: 1, proxima: "foco" });
    expect(foco.iniciar({})).toMatchObject({ etapa: { tipo: "foco" }, cicloAtual: 1 });
  });

  test("pular a pausa: da proposta do ciclo terminado e da pausa correndo", async () => {
    const { relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    expect(() => foco.pularPausa()).toThrow(MENSAGEM_SEM_PAUSA);
    await avancar(25);
    expect(foco.pularPausa()).toMatchObject({
      etapa: { tipo: "foco", inicio: iso(sp(HOJE, "14:25")) },
      cicloAtual: 2,
    });
    await avancar(25);
    foco.iniciar({});
    await avancar(2);
    expect(foco.pularPausa()).toMatchObject({ etapa: { tipo: "foco" }, cicloAtual: 3 });
    const pausa = foco.historico({ de: HOJE, ate: HOJE }).etapas.find((e) => e.tipo === "pausa");
    expect(pausa).toMatchObject({ duracaoRealMin: 2, interrompida: true });
  });

  test("o atalho alterna: parado inicia, rodando pausa, pausado retoma", async () => {
    const { relogio, foco } = montar();
    await relogio.ligar();
    expect(foco.alternar()).toMatchObject({ etapa: { tipo: "foco", pausadaEm: null } });
    await avancar(3);
    expect(foco.alternar()).toMatchObject({ etapa: { pausadaEm: iso(sp(HOJE, "14:03")) } });
    await avancar(2);
    confere("foco.alternar", foco.alternar());
    expect(foco.obter().etapa).toMatchObject({ pausadaEm: null, terminaEm: iso(sp(HOJE, "14:27")) });
  });

  test("o que não vale agora volta com o motivo", async () => {
    const { db, relogio, foco } = montar();
    await relogio.ligar();
    expect(() => foco.pausar()).toThrow(MENSAGEM_PARADO);
    expect(() => foco.retomar()).toThrow(MENSAGEM_PARADO);
    expect(() => foco.terminar()).toThrow(MENSAGEM_PARADO);
    expect(() => foco.estender({ minutos: 5 })).toThrow(MENSAGEM_PARADO);
    expect(() => foco.iniciar({ tarefaId: "nao-existe" })).toThrow(MENSAGEM_TAREFA);
    comTarefa(db, "apagada");
    db.prepare("UPDATE tarefas SET apagado_em = ? WHERE id = 'apagada'").run(iso(sp(HOJE, "13:00")));
    expect(() => foco.iniciar({ tarefaId: "apagada" })).toThrow(MENSAGEM_TAREFA);
    foco.iniciar({});
    expect(() => foco.iniciar({})).toThrow(MENSAGEM_EM_ANDAMENTO);
    expect(() => foco.retomar()).toThrow(MENSAGEM_NAO_PAUSADA);
    foco.pausar();
    expect(() => foco.pausar()).toThrow(MENSAGEM_JA_PAUSADA);
  });
});

describe("silêncio das notificações", () => {
  test("com foco rodando, um aviso não sai no Windows e uma aprovação sai; na pausa e parado, tudo sai", async () => {
    const { casca, notificacoes, relogio, foco } = montar();
    await relogio.ligar();
    const aviso = (titulo: string) => notificacoes.avisar({ agenteId: "nuno", tipo: "aviso", titulo });
    const titulos = () => casca.mostrados.map((m) => m.titulo);

    foco.iniciar({});
    expect(foco.emFoco()).toBe(true);
    const calado = await aviso("CI passou");
    await notificacoes.avisar({ agenteId: "nuno", tipo: "aprovacao", titulo: "Rodar os testes?" });
    expect(titulos()).toEqual(["Rodar os testes?"]);
    // Calado só no Windows: o ponto no dock e o histórico continuam.
    expect(notificacoes.naoVistas().map((n) => n.id)).toContain(calado.id);

    // Foco pausado não silencia.
    foco.pausar();
    await aviso("Sessão esperando");
    foco.retomar();
    await aviso("Outra sessão");
    expect(titulos()).toEqual(["Rodar os testes?", "Sessão esperando"]);

    // Na pausa, os avisos voltam ao normal.
    await avancar(25);
    foco.iniciar({});
    expect(foco.obter().etapa?.tipo).toBe("pausa");
    expect(foco.emFoco()).toBe(false);
    await aviso("PR aprovado");
    expect(titulos()).toEqual([
      "Rodar os testes?",
      "Sessão esperando",
      "Ciclo 1 de 4 terminou",
      "PR aprovado",
    ]);
  });
});

describe("reinício e suspensão", () => {
  test("o serviço que reinicia no prazo retoma a etapa, e ela fecha na hora", async () => {
    const primeiro = montar();
    await primeiro.relogio.ligar();
    primeiro.foco.iniciar({});
    primeiro.relogio.parar();

    const { casca, relogio, foco } = montar({ agora: sp(HOJE, "14:20"), pasta: primeiro.pasta });
    await relogio.ligar();
    expect(foco.obter().etapa).toMatchObject({ fim: null, terminaEm: iso(sp(HOJE, "14:25")) });
    await avancar(5);
    expect(foco.obter()).toMatchObject({ etapa: null, ciclosHoje: 1, focoHojeMin: 25 });
    expect(casca.mostrados.map((m) => m.titulo)).toEqual(["Ciclo 1 de 4 terminou"]);
  });

  test("fora do prazo, fecha interrompida na última conferência, sem aviso e sem começar a seguinte", async () => {
    const primeiro = montar();
    await primeiro.relogio.ligar();
    primeiro.foco.iniciar({});
    await avancar(25);
    primeiro.foco.iniciar({});
    // O serviço para sem avisar às 14:28, no meio da pausa.
    await avancar(3);
    primeiro.relogio.parar();

    const { casca, relogio, foco } = montar({ agora: sp(HOJE, "16:00"), pasta: primeiro.pasta });
    await relogio.ligar();
    expect(foco.obter()).toMatchObject({ etapa: null, proxima: "foco", cicloAtual: 1 });
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      tipo: "pausa",
      fim: iso(sp(HOJE, "14:28")),
      duracaoRealMin: 3,
      interrompida: true,
    });
    expect(casca.mostrados).toHaveLength(0);
  });

  test("com o PC suspenso, a etapa que venceu dormindo fecha na hora em que ele dormiu", async () => {
    const { relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(10);
    // O PC dorme às 14:10 e volta às 16:00: o timer não roda, a casca avisa a retomada.
    vi.setSystemTime(sp(HOJE, "16:00"));
    await relogio.retomar();
    expect(foco.obter()).toMatchObject({ etapa: null, focoHojeMin: 10, ciclosHoje: 0 });
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      fim: iso(sp(HOJE, "14:10")),
      duracaoRealMin: 10,
      interrompida: true,
    });
  });

  test("a etapa pausada de outro dia fecha na volta; a de hoje continua pausada", async () => {
    const { relogio, foco } = montar({ agora: sp(HOJE, "23:40") });
    await relogio.ligar();
    foco.iniciar({});
    await avancar(10);
    foco.pausar();
    vi.setSystemTime(sp(HOJE, "23:55"));
    await relogio.retomar();
    expect(foco.obter().etapa).toMatchObject({ pausadaEm: iso(sp(HOJE, "23:50")) });

    vi.setSystemTime(sp("2026-10-09", "08:00"));
    await relogio.retomar();
    expect(foco.obter().etapa).toBeNull();
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      fim: iso(sp(HOJE, "23:50")),
      duracaoRealMin: 10,
      interrompida: true,
    });
  });
});

describe("histórico e relatório", () => {
  test("as etapas dos dias pedidos, as somas por tarefa e por dia, sem as pausas", async () => {
    const { db, relogio, foco } = montar({ agora: sp("2026-10-07", "09:00") });
    comTarefa(db);
    comTarefa(db, "t2", "Comprovantes");
    await relogio.ligar();
    foco.iniciar({ tarefaId: "t1" });
    await avancar(25);
    foco.iniciar({});
    await avancar(5);
    await avancar(10);
    foco.terminar();

    vi.setSystemTime(sp(HOJE, "10:00"));
    foco.iniciar({ tarefaId: "t2" });
    await avancar(25);
    foco.iniciar({ tipo: "foco" });
    await avancar(25);
    // A tarefa foi para a lixeira: o histórico guarda o nome.
    db.prepare("UPDATE tarefas SET apagado_em = ? WHERE id = 't2'").run(iso(sp(HOJE, "11:00")));

    const semana = foco.historico({ de: "2026-10-05", ate: "2026-10-11" });
    confere("foco.historico", semana);
    expect(semana.etapas.map((e) => [e.tipo, e.inicio])).toEqual([
      ["foco", iso(sp(HOJE, "10:25"))],
      ["foco", iso(sp(HOJE, "10:00"))],
      ["foco", iso(sp("2026-10-07", "09:30"))],
      ["pausa", iso(sp("2026-10-07", "09:25"))],
      ["foco", iso(sp("2026-10-07", "09:00"))],
    ]);
    expect(semana.porTarefa).toEqual([
      { tarefaId: "t2", titulo: "Comprovantes", minutos: 50, ciclos: 2 },
      { tarefaId: "t1", titulo: TAREFA, minutos: 35, ciclos: 1 },
    ]);
    expect(semana.porDia).toEqual([
      { dia: "2026-10-07", minutos: 35, ciclos: 1 },
      { dia: HOJE, minutos: 50, ciclos: 2 },
    ]);
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas).toHaveLength(2);
    // O fim do calendário não tem dia seguinte e não derruba a conta.
    expect(foco.historico({ de: "2026-10-08", ate: "9999-12-31" }).etapas).toHaveLength(2);
  });
});

describe("aviso do Windows", () => {
  test("o botão do ciclo terminado começa a pausa; o de um aviso que já não vale não faz nada", async () => {
    const { casca, notificacoes, relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(25);
    const aviso = casca.mostrados[0];
    expect(aviso).toBeDefined();
    await notificacoes.aoClicar(aviso?.id ?? "", "pausa");
    expect(foco.obter().etapa).toMatchObject({ tipo: "pausa" });
    expect(notificacoes.naoVistas().map((n) => n.id)).not.toContain(aviso?.id);

    // A pausa já correu: o "Pular a pausa" desse aviso não vale mais.
    await notificacoes.aoClicar(aviso?.id ?? "", "pular");
    expect(foco.obter().etapa).toMatchObject({ tipo: "pausa" });
  });

  test("o +5 min do aviso faz o foco voltar a correr", async () => {
    const { casca, notificacoes, relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(25);
    await notificacoes.aoClicar(casca.mostrados[0]?.id ?? "", "mais");
    expect(foco.obter().etapa).toMatchObject({ tipo: "foco", terminaEm: iso(sp(HOJE, "14:30")) });
  });
});

describe("volta 1 da revisão", () => {
  test("a tarefa herdada que foi à lixeira deixa a etapa livre: o fim da pausa e o atalho não travam", async () => {
    const { db, relogio, foco } = montar();
    comTarefa(db);
    await relogio.ligar();
    foco.iniciar({ tarefaId: "t1" });
    await avancar(25);
    expect(foco.iniciar({})).toMatchObject({ etapa: { tipo: "pausa", tarefaId: "t1" } });
    db.prepare("UPDATE tarefas SET apagado_em = ? WHERE id = 't1'").run(iso(sp(HOJE, "14:27")));
    await avancar(5);
    expect(foco.obter()).toMatchObject({ etapa: { tipo: "foco", tarefaId: null }, cicloAtual: 2 });
    await avancar(25);
    // O Ctrl+Alt+P começa a pausa proposta, livre.
    expect(foco.alternar()).toMatchObject({ etapa: { tipo: "pausa", tarefaId: null } });
    // A tarefa pedida que não existe continua recusada.
    foco.terminar();
    expect(() => foco.iniciar({ tarefaId: "t1" })).toThrow(MENSAGEM_TAREFA);
  });

  test("pular a pausa com a tarefa herdada na lixeira começa o foco livre", async () => {
    const { db, relogio, foco } = montar();
    comTarefa(db);
    await relogio.ligar();
    foco.iniciar({ tarefaId: "t1" });
    await avancar(25);
    db.prepare("UPDATE tarefas SET apagado_em = ? WHERE id = 't1'").run(iso(sp(HOJE, "14:26")));
    expect(foco.pularPausa()).toMatchObject({ etapa: { tipo: "foco", tarefaId: null }, cicloAtual: 2 });
  });

  test("a etapa pausada de outro dia fecha mesmo sem ausência, na conferência do relógio", async () => {
    const { relogio, foco } = montar({ agora: sp(HOJE, "23:40") });
    await relogio.ligar();
    foco.iniciar({});
    await avancar(10);
    foco.pausar();
    await avancar(5);
    expect(foco.obter().etapa).toMatchObject({ pausadaEm: iso(sp(HOJE, "23:50")) });
    // Passa da meia-noite com o PC acordado: a guarda do relógio confere e a etapa fecha.
    await avancar(10);
    expect(foco.obter().etapa).toBeNull();
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      fim: iso(sp(HOJE, "23:50")),
      duracaoRealMin: 10,
      interrompida: true,
    });
  });

  test("subida sem ausência conhecida: fecha na última conferência gravada e encerra a rodada", async () => {
    const primeiro = montar();
    comTarefa(primeiro.db);
    await primeiro.relogio.ligar();
    primeiro.foco.iniciar({ tarefaId: "t1" });
    await avancar(25);
    primeiro.foco.pularPausa();
    // O PC desliga às 14:30, cinco minutos dentro do ciclo 2.
    await avancar(5);
    primeiro.relogio.parar();

    const { relogio, foco } = montar({ agora: sp(HOJE, "16:00"), pasta: primeiro.pasta });
    await relogio.ligar();
    expect(foco.historico({ de: HOJE, ate: HOJE }).etapas[0]).toMatchObject({
      tipo: "foco",
      fim: iso(sp(HOJE, "14:30")),
      duracaoRealMin: 5,
      interrompida: true,
    });
    // O trecho desconhecido não conta, e a rodada acabou: sem proposta de pausa, ciclo 1, livre.
    expect(foco.obter()).toMatchObject({
      etapa: null,
      proxima: "foco",
      cicloAtual: 1,
      tarefaTitulo: null,
      focoHojeMin: 30,
      ciclosHoje: 1,
    });
    expect(() => foco.pularPausa()).toThrow(MENSAGEM_SEM_PAUSA);
    expect(foco.iniciar({})).toMatchObject({ etapa: { tipo: "foco", tarefaId: null }, cicloAtual: 1 });
  });

  test("o Pular a pausa do aviso começa o foco seguinte", async () => {
    const { casca, notificacoes, relogio, foco } = montar();
    await relogio.ligar();
    foco.iniciar({});
    await avancar(25);
    const aviso = casca.mostrados[0];
    await notificacoes.aoClicar(aviso?.id ?? "", "pular");
    expect(foco.obter()).toMatchObject({
      etapa: { tipo: "foco", inicio: iso(sp(HOJE, "14:25")) },
      cicloAtual: 2,
    });
    expect(notificacoes.naoVistas().map((n) => n.id)).not.toContain(aviso?.id);
  });

  test("o Começar outra rodada do aviso abre o ciclo 1; a pausa longa livre não fecha rodada", async () => {
    const { casca, notificacoes, relogio, foco, config } = montar();
    config.foco = { ...config.foco, ciclosAtePausaLonga: 1 };
    await relogio.ligar();
    // Pausa longa sem foco antes: não há rodada para resumir.
    expect(foco.iniciar({ tipo: "pausa_longa" })).toMatchObject({ etapa: { tipo: "pausa_longa" } });
    await avancar(15);
    expect(casca.mostrados).toHaveLength(0);

    foco.iniciar({});
    await avancar(25);
    foco.iniciar({});
    expect(foco.obter().etapa?.tipo).toBe("pausa_longa");
    await avancar(15);
    const rodada = casca.mostrados.at(-1);
    expect(rodada).toMatchObject({
      titulo: "Rodada completa",
      corpo: "1 ciclo, 25 min de foco. Começo outra rodada?",
    });
    await notificacoes.aoClicar(rodada?.id ?? "", "outra");
    expect(foco.obter()).toMatchObject({ etapa: { tipo: "foco" }, cicloAtual: 1 });
    expect(notificacoes.naoVistas().map((n) => n.id)).not.toContain(rodada?.id);
  });
});
