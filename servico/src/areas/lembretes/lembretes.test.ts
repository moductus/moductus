import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  ADIAR_LEMBRETE_MIN,
  CONFIG_PADRAO,
  MENSAGEM_LEMBRETE_NAO_TOCA,
  METODOS,
  type LembretesDeHoje,
  type MudancaLembretes,
} from "@moductus/contrato";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import {
  RepositorioNotificacoes,
  ServicoNotificacoes,
  type AvisoWindows,
} from "../../notificacoes/notificacoes.ts";
import { GUARDA_MS, RelogioDoDia } from "../dia/relogio.ts";
import { RepositorioNotas, ServicoNotas } from "../notas/notas.ts";
import { RepositorioTarefas } from "../tarefas/repositorio.ts";
import { ServicoTarefas } from "../tarefas/tarefas.ts";
import {
  MENSAGEM_NAO_ENCONTRADO,
  MENSAGEM_TAREFA,
  REFERENCIA_ATRASADOS,
  RepositorioLembretes,
  ServicoLembretes,
} from "./lembretes.ts";

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
const DIA = 86_400_000;
/** Os horários do teste são de São Paulo (UTC−3, sem horário de verão): 14:45 é 17:45Z. */
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`);
const iso = (d: Date) => d.toISOString();
const HOJE = "2026-10-08";

/**
 * Banco migrado de verdade, as notificações de verdade com uma casca de mentira que só anota, e o
 * relógio do dia de verdade sobre o relógio falso do vitest. Nenhum provedor, nenhuma rede.
 */
function montar(opcoes: { agora?: Date; ligar?: boolean; noGoogle?: (lembreteId: string) => boolean } = {}) {
  vi.setSystemTime(opcoes.agora ?? sp(HOJE, "14:30"));
  const pasta = mkdtempSync(join(tmpdir(), "moductus-lembretes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const casca = { mostrados: [] as AvisoWindows[], retirados: [] as string[] };
  const agentes = new RepositorioAgentes(db);
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
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const relogio = new RelogioDoDia();
  const config = { fuso: "America/Sao_Paulo" };
  const eventos = { mudou: [] as MudancaLembretes[], hoje: [] as LembretesDeHoje[] };
  const lembretes = new ServicoLembretes(
    new RepositorioLembretes(db),
    { lerFuso: () => config.fuso, notificacoes, relogio, noGoogle: opcoes.noGoogle },
    { mudou: (m) => eventos.mudou.push(m), hoje: (h) => eventos.hoje.push(h) },
  );
  relogio.registrar(lembretes);
  return { db, casca, notificacoes, relogio, lembretes, eventos, config };
}

const unico = <T>(lista: readonly T[]): T => {
  expect(lista).toHaveLength(1);
  return lista[0] as T;
};

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

describe("disparo", () => {
  test("dispara uma vez, no minuto certo, sem provedor configurado e sem rede", async () => {
    const { db, casca, relogio, lembretes } = montar();
    expect(db.prepare("SELECT count(*) AS n FROM provedores").get()).toEqual({ n: 0 });
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:45")) });
    confere("lembretes.criar", criado);
    expect(criado.estado).toBe("agendado");

    await vi.advanceTimersByTimeAsync(15 * MIN - 1);
    expect(casca.mostrados).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const aviso = unico(casca.mostrados);
    expect(aviso).toMatchObject({
      agente: "Alba",
      titulo: "Ligar para o contador",
      corpo: "Lembrete das 14:45",
      botoes: [
        { id: "adiar", rotulo: "Adiar 10 min" },
        { id: "feito", rotulo: "Feito" },
      ],
    });
    const tocando = unico(lembretes.hoje().tocando);
    expect(tocando).toMatchObject({
      id: criado.id,
      estado: "disparado",
      disparadoEm: iso(sp(HOJE, "14:45")),
    });

    // Não toca de novo: nem no próximo minuto, nem horas depois.
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN);
    expect(casca.mostrados).toHaveLength(1);
    confere("lembretes.hoje", lembretes.hoje());
  });

  test("o lembrete da tarefa diz a tarefa e a hora dela no aviso", async () => {
    const { db, casca, relogio, lembretes } = montar();
    db.prepare(
      "INSERT INTO tarefas (id, lista_id, titulo, vence_em, hora) VALUES ('t1', 'pessoal', 'Ligar para o contador', ?, '15:00')",
    ).run(HOJE);
    await expect(
      lembretes.criar({ texto: "x", quando: iso(sp(HOJE, "14:45")), tarefaId: "nao-existe" }),
    ).rejects.toThrow(MENSAGEM_TAREFA);
    await relogio.ligar();
    await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:45")), tarefaId: "t1" });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(unico(casca.mostrados).corpo).toBe("Tarefa de hoje às 15:00");
  });

  test("o próximo aparece como chegando a partir de 30 min antes, e lembretes.hoje sai nessa hora", async () => {
    const { relogio, lembretes, eventos } = montar({ agora: sp(HOJE, "14:00") });
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Beber água", quando: iso(sp(HOJE, "15:00")) });
    expect(lembretes.hoje().chegando).toBeNull();
    const antes = eventos.hoje.length;

    // Sem esperar a guarda de 60 s: o relógio se arma para a entrada nos 30 min antes.
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(eventos.hoje).toHaveLength(antes + 1);
    expect(eventos.hoje.at(-1)?.chegando?.id).toBe(criado.id);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(eventos.hoje).toHaveLength(antes + 1);
  });

  test("mudar o fuso não remarca o que está gravado: o instante continua o mesmo", async () => {
    const { relogio, lembretes, config, casca } = montar();
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Reunião", quando: iso(sp(HOJE, "15:00")) });
    config.fuso = "Europe/Lisbon";
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(unico(lembretes.listar({})).quando).toBe(criado.quando);
    expect(unico(casca.mostrados).titulo).toBe("Reunião");
  });
});

describe("ausência", () => {
  test("suspensão simulada: o que venceu com o PC dormindo vira atrasado e sai num aviso só", async () => {
    const { casca, relogio, lembretes, notificacoes } = montar({ agora: sp(HOJE, "14:20") });
    await relogio.ligar();
    for (const [texto, hora] of [
      ["Ligar para o contador", "14:30"],
      ["Beber água", "15:00"],
      ["Tomar o remédio", "15:30"],
      ["Buscar as crianças", "16:30"],
    ] as const) {
      await lembretes.criar({ texto, quando: iso(sp(HOJE, hora)) });
    }

    // O PC dorme às 14:20 e volta às 16:05: o relógio do sistema anda, os timers não.
    vi.setSystemTime(sp(HOJE, "16:05"));
    await relogio.retomar();
    const aviso = unico(casca.mostrados);
    expect(aviso).toMatchObject({
      agente: "Alba",
      titulo: "3 lembretes passaram enquanto o PC dormia",
      corpo: "Ligar para o contador · Beber água · Tomar o remédio",
      botoes: [],
    });
    const hoje = lembretes.hoje();
    confere("lembretes.hoje", hoje);
    expect(hoje.tocando).toHaveLength(0);
    expect(hoje.atrasados.map((l) => l.texto)).toEqual([
      "Ligar para o contador",
      "Beber água",
      "Tomar o remédio",
    ]);
    expect(hoje.atrasados.every((l) => l.estado === "perdido")).toBe(true);
    expect(hoje.ausencia).toEqual({ de: iso(sp(HOJE, "14:20")), ate: iso(sp(HOJE, "16:05")) });

    // O que vence depois da volta toca normalmente.
    await vi.advanceTimersByTimeAsync(25 * MIN);
    expect(casca.mostrados.map((a) => a.titulo)).toEqual([aviso.titulo, "Buscar as crianças"]);

    // "Adiar os 2 em 30 min" e "Concluir" o último: o aviso agrupado sai junto com os atrasados.
    const [a, b, c] = hoje.atrasados.map((l) => l.id) as [string, string, string];
    const adiados = await lembretes.adiar({ ids: [a, b], minutos: 30 });
    expect(adiados.every((l) => l.estado === "adiado" && l.adiadoAte === iso(sp(HOJE, "17:00")))).toBe(true);
    expect(casca.retirados).toHaveLength(0);
    const feito = await lembretes.concluir({ ids: [c] });
    expect(feito).toEqual({ lembretes: [], removidos: [c] });
    expect(lembretes.hoje()).toMatchObject({ atrasados: [], ausencia: null });
    expect(casca.retirados).toEqual([aviso.id]);
    expect(notificacoes.naoVistas().some((n) => n.referencia === REFERENCIA_ATRASADOS)).toBe(false);
  });

  test("o timer que acorda muito depois da hora também agrupa, sem a casca avisar a retomada", async () => {
    const { casca, relogio, lembretes } = montar({ agora: sp(HOJE, "14:20") });
    await relogio.ligar();
    await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:30")) });
    await lembretes.criar({ texto: "Beber água", quando: iso(sp(HOJE, "15:00")) });
    vi.setSystemTime(sp(HOJE, "16:05"));
    await vi.advanceTimersByTimeAsync(GUARDA_MS);
    expect(unico(casca.mostrados).titulo).toBe("2 lembretes passaram enquanto o PC dormia");
    expect(lembretes.hoje().atrasados).toHaveLength(2);
  });

  test("na subida, o que venceu há mais de 2 min vira atrasado; o de 1 min ainda toca", async () => {
    const { casca, relogio, lembretes } = montar({ agora: sp(HOJE, "14:00") });
    // O serviço está parado: o relógio não foi ligado.
    await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:30")) });
    await lembretes.criar({ texto: "Beber água", quando: iso(sp(HOJE, "15:28")) });
    vi.setSystemTime(sp(HOJE, "15:29"));
    await relogio.ligar();
    expect(casca.mostrados.map((a) => a.titulo).sort()).toEqual(
      ["1 lembrete passou enquanto o Moductus estava fechado", "Beber água"].sort(),
    );
    const hoje = lembretes.hoje();
    expect(unico(hoje.atrasados).texto).toBe("Ligar para o contador");
    expect(unico(hoje.tocando).texto).toBe("Beber água");
    // Com o serviço parado, não se sabe desde quando: o cartão não inventa a ausência.
    expect(hoje.ausencia).toBeNull();
  });

  test("reagendado para um horário que já passou: até 2 min toca; mais que isso, vira atrasado quieto", async () => {
    const { casca, relogio, lembretes } = montar();
    await relogio.ligar();
    const a = await lembretes.criar({ texto: "Daqui a pouco", quando: iso(sp(HOJE, "18:00")) });
    const b = await lembretes.criar({ texto: "Outro", quando: iso(sp(HOJE, "18:00")) });
    await lembretes.definir({ id: a.id, quando: iso(sp(HOJE, "13:30")) });
    await lembretes.definir({ id: b.id, quando: iso(sp(HOJE, "14:29")) });
    await vi.advanceTimersByTimeAsync(0);
    expect(unico(casca.mostrados).titulo).toBe("Outro");
    const hoje = lembretes.hoje();
    expect(unico(hoje.atrasados).id).toBe(a.id);
    expect(hoje.ausencia).toBeNull();
  });
});

describe("aviso do Windows", () => {
  test("Adiar 10 min reagenda e toca de novo; Feito conclui", async () => {
    const { casca, relogio, lembretes, notificacoes } = montar();
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:45")) });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    const primeiro = unico(casca.mostrados);

    await notificacoes.aoClicar(primeiro.id, "adiar");
    expect(unico(lembretes.listar({}))).toMatchObject({
      estado: "adiado",
      adiadoAte: iso(sp(HOJE, "14:55")),
    });
    expect(casca.retirados).toEqual([primeiro.id]);
    expect(lembretes.hoje().tocando).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10 * MIN - 1);
    expect(casca.mostrados).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const segundo = casca.mostrados[1] as AvisoWindows;
    expect(segundo.titulo).toBe("Ligar para o contador");

    await notificacoes.aoClicar(segundo.id, "feito");
    expect(lembretes.listar({})).toEqual([]);
    expect(casca.retirados).toContain(segundo.id);
    await expect(lembretes.adiar({ ids: [criado.id], minutos: 10 })).rejects.toThrow(MENSAGEM_NAO_ENCONTRADO);
  });

  test("com a ocorrência, Adiar e Feito do painel só valem enquanto ela toca, como o botão do aviso", async () => {
    const { casca, relogio, lembretes } = montar();
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Ligar para o contador", quando: iso(sp(HOJE, "14:45")) });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    const tocando = unico(lembretes.hoje().tocando);
    const outra = iso(sp(HOJE, "14:44"));

    await expect(
      lembretes.adiar({ ids: [criado.id], minutos: ADIAR_LEMBRETE_MIN, quando: outra }),
    ).rejects.toThrow(MENSAGEM_LEMBRETE_NAO_TOCA);
    await expect(lembretes.concluir({ ids: [criado.id], quando: outra })).rejects.toThrow(
      MENSAGEM_LEMBRETE_NAO_TOCA,
    );
    expect(unico(lembretes.listar({}))).toMatchObject({ estado: "disparado" });

    await lembretes.adiar({ ids: [criado.id], minutos: ADIAR_LEMBRETE_MIN, quando: tocando.quando });
    expect(unico(lembretes.listar({}))).toMatchObject({
      estado: "adiado",
      adiadoAte: iso(sp(HOJE, "14:55")),
    });
    expect(casca.retirados).toHaveLength(1);

    // Adiado, o cartão velho do painel não conclui; o pedido sem ocorrência vale como sempre.
    await expect(lembretes.concluir({ ids: [criado.id], quando: tocando.quando })).rejects.toThrow(
      MENSAGEM_LEMBRETE_NAO_TOCA,
    );
    await lembretes.concluir({ ids: [criado.id] });
    expect(lembretes.listar({})).toEqual([]);
  });

  test("cancelar manda à lixeira e tira o aviso de quem estava tocando", async () => {
    const { casca, relogio, lembretes } = montar();
    await relogio.ligar();
    const criado = await lembretes.criar({ texto: "Beber água", quando: iso(sp(HOJE, "14:31")) });
    await vi.advanceTimersByTimeAsync(MIN);
    const aviso = unico(casca.mostrados);
    const r = await lembretes.cancelar({ ids: [criado.id] });
    confere("lembretes.cancelar", r);
    expect(r).toEqual({ ids: [criado.id] });
    expect(casca.retirados).toEqual([aviso.id]);
    expect(lembretes.listar({})).toEqual([]);
  });
});

describe("recorrentes", () => {
  test("o esquecido toca de novo na próxima; Feito volta na seguinte; a regra que acaba sai", async () => {
    const { casca, relogio, lembretes, notificacoes } = montar();
    await relogio.ligar();
    const criado = await lembretes.criar({
      texto: "Beber água",
      quando: iso(sp(HOJE, "15:00")),
      recorrencia: "FREQ=DAILY;COUNT=3",
    });
    await vi.advanceTimersByTimeAsync(30 * MIN);
    const primeiro = unico(casca.mostrados);

    // Ninguém respondeu: no dia seguinte ele toca de novo, no lugar do de ontem.
    await vi.advanceTimersByTimeAsync(DIA);
    expect(casca.mostrados).toHaveLength(2);
    expect(casca.retirados).toEqual([primeiro.id]);
    expect(unico(lembretes.listar({}))).toMatchObject({
      estado: "disparado",
      quando: iso(sp("2026-10-09", "15:00")),
      recorrencia: "FREQ=DAILY;COUNT=3",
    });
    // O aviso de ontem não decide pelo de hoje.
    await notificacoes.aoClicar(primeiro.id, "feito");
    expect(unico(lembretes.listar({})).estado).toBe("disparado");

    const feito = await lembretes.concluir({ ids: [criado.id] });
    confere("lembretes.concluir", feito);
    expect(feito.removidos).toEqual([]);
    expect(unico(feito.lembretes)).toMatchObject({
      estado: "agendado",
      quando: iso(sp("2026-10-10", "15:00")),
      recorrencia: "FREQ=DAILY;COUNT=3",
    });

    await vi.advanceTimersByTimeAsync(DIA);
    expect(casca.mostrados).toHaveLength(3);
    expect(await lembretes.concluir({ ids: [criado.id] })).toEqual({ lembretes: [], removidos: [criado.id] });
  });

  test("perdido por dias: um atrasado só, e Feito volta na próxima depois de agora", async () => {
    const { casca, relogio, lembretes } = montar({ agora: sp(HOJE, "14:00") });
    const criado = await lembretes.criar({
      texto: "Beber água",
      quando: iso(sp(HOJE, "15:00")),
      recorrencia: "FREQ=DAILY",
    });
    vi.setSystemTime(sp("2026-10-12", "16:00"));
    await relogio.ligar();
    expect(unico(casca.mostrados).titulo).toBe("1 lembrete passou enquanto o Moductus estava fechado");
    expect(unico(lembretes.hoje().atrasados).quando).toBe(iso(sp("2026-10-12", "15:00")));

    const feito = await lembretes.concluir({ ids: [criado.id] });
    expect(unico(feito.lembretes)).toMatchObject({
      estado: "agendado",
      quando: iso(sp("2026-10-13", "15:00")),
    });
  });

  test("Feito antes da hora pula para a ocorrência seguinte", async () => {
    const { lembretes } = montar();
    const criado = await lembretes.criar({
      texto: "Reunião semanal",
      quando: iso(sp(HOJE, "18:00")),
      recorrencia: "FREQ=WEEKLY",
    });
    const feito = await lembretes.concluir({ ids: [criado.id] });
    expect(unico(feito.lembretes).quando).toBe(iso(sp("2026-10-15", "18:00")));
  });
});

describe("pedidos", () => {
  test("listar por intervalo e estado; definir só o texto não reagenda", async () => {
    const { lembretes } = montar();
    const a = await lembretes.criar({ texto: "A", quando: iso(sp(HOJE, "15:00")) });
    await lembretes.criar({ texto: "B", quando: iso(sp("2026-10-09", "15:00")) });
    await lembretes.adiar({ ids: [a.id], minutos: 60 });
    const doDia = lembretes.listar({ de: iso(sp(HOJE, "00:00")), ate: iso(sp(HOJE, "23:59")) });
    confere("lembretes.listar", doDia);
    expect(doDia.map((l) => l.texto)).toEqual(["A"]);
    expect(lembretes.listar({ estados: ["agendado"] }).map((l) => l.texto)).toEqual(["B"]);

    const definido = await lembretes.definir({ id: a.id, texto: "A, com mais detalhe" });
    confere("lembretes.definir", definido);
    expect(definido).toMatchObject({ texto: "A, com mais detalhe", estado: "adiado" });
    expect((await lembretes.definir({ id: a.id, quando: iso(sp(HOJE, "16:00")) })).estado).toBe("agendado");
  });

  test("lembrete gravado por outra área rearma o relógio pelo aviso de mudança", async () => {
    const { db, casca, relogio, lembretes } = montar();
    await relogio.ligar();
    // As Tarefas gravam o lembrete da tarefa direto no banco e avisam.
    db.prepare("INSERT INTO lembretes (id, texto, quando) VALUES ('l1', 'Da tarefa', ?)").run(
      iso(new Date(Date.now() + 10_000)),
    );
    lembretes.mudaramPorFora({ lembretes: [], removidos: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unico(casca.mostrados).titulo).toBe("Da tarefa");

    // A tarefa fechada leva o lembrete junto: o aviso dele sai.
    db.prepare("UPDATE lembretes SET apagado_em = ? WHERE id = 'l1'").run(iso(new Date()));
    lembretes.mudaramPorFora({ lembretes: [], removidos: ["l1"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(casca.retirados).toEqual([casca.mostrados[0]?.id]);
  });

  test("o intervalo é o de quando ele toca: o adiado sai do dia de antes e entra no do adiamento", async () => {
    const { lembretes } = montar({ agora: sp(HOJE, "09:00") });
    const a = await lembretes.criar({ texto: "A", quando: iso(sp(HOJE, "10:00")) });
    await lembretes.adiar({ ids: [a.id], minutos: 24 * 60 });
    expect(lembretes.listar({ de: iso(sp(HOJE, "00:00")), ate: iso(sp(HOJE, "23:59")) })).toEqual([]);
    const depois = lembretes.listar({
      de: iso(sp("2026-10-09", "00:00")),
      ate: iso(sp("2026-10-09", "23:59")),
    });
    expect(depois.map((l) => l.id)).toEqual([a.id]);
  });
});

describe("com as Tarefas", () => {
  /** A área Tarefas de verdade, avisando os lembretes como o main.ts liga. */
  function comTarefas(m: ReturnType<typeof montar>) {
    const notas = new ServicoNotas(new RepositorioNotas(m.db), { mudou: () => {} });
    const mudancas: MudancaLembretes[] = [];
    const tarefas = new ServicoTarefas(
      new RepositorioTarefas(m.db),
      { lerFuso: () => m.config.fuso, notas },
      {
        tarefas: () => {},
        listas: () => {},
        lembretes: (mudanca) => {
          mudancas.push(mudanca);
          m.lembretes.mudaramPorFora(mudanca);
        },
      },
    );
    return { tarefas, mudancas };
  }

  test("tarefa reagendada ou apagada com o lembrete tocando: o relógio segue e o aviso velho sai", async () => {
    const m = montar();
    const { casca, relogio, lembretes } = m;
    const { tarefas, mudancas } = comTarefas(m);
    await relogio.ligar();
    const t = tarefas.criar({ titulo: "Ligar para o contador", venceEm: HOJE, hora: "15:00" });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    const primeiro = unico(casca.mostrados);
    expect(primeiro).toMatchObject({ titulo: "Ligar para o contador", corpo: "Tarefa de hoje às 15:00" });

    // A tarefa vai para as 16:00: o lembrete volta a agendado às 15:45 e o aviso das 14:45 sai.
    tarefas.definir({ id: t.id, hora: "16:00" });
    await vi.advanceTimersByTimeAsync(0);
    const lembrete = unico(lembretes.listar({}));
    expect(mudancas.at(-1)?.anteriores).toEqual([{ id: lembrete.id, quando: iso(sp(HOJE, "14:45")) }]);
    expect(casca.retirados).toEqual([primeiro.id]);
    expect(lembrete).toMatchObject({ estado: "agendado", quando: iso(sp(HOJE, "15:45")) });

    await vi.advanceTimersByTimeAsync(60 * MIN);
    const segundo = casca.mostrados[1] as AvisoWindows;
    expect(segundo.corpo).toBe("Tarefa de hoje às 16:00");

    // Apagar a tarefa leva o lembrete junto, e o aviso dele.
    tarefas.apagar({ id: t.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(casca.retirados).toEqual([primeiro.id, segundo.id]);
    expect(lembretes.hoje().tocando).toEqual([]);
  });
});

describe("volta 1", () => {
  test("o recorrente tocando entra como chegando pela próxima, e o relógio arma os 30 min antes", async () => {
    const { relogio, lembretes } = montar({ agora: sp(HOJE, "14:50") });
    await relogio.ligar();
    const criado = await lembretes.criar({
      texto: "Beber água",
      quando: iso(sp(HOJE, "15:00")),
      recorrencia: "FREQ=DAILY",
    });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(unico(lembretes.hoje().tocando).id).toBe(criado.id);

    vi.setSystemTime(sp("2026-10-09", "14:00"));
    expect(lembretes.proximo(new Date())).toEqual(sp("2026-10-09", "14:30"));
    expect(lembretes.hoje().chegando).toBeNull();
    vi.setSystemTime(sp("2026-10-09", "14:31"));
    const chegando = lembretes.hoje().chegando;
    confere("lembretes.hoje", lembretes.hoje());
    expect(chegando).toMatchObject({
      id: criado.id,
      estado: "agendado",
      quando: iso(sp("2026-10-09", "15:00")),
    });
  });

  test("horário de verão: o pulo vale só no dia do pulo, e a hora local volta a ser a do início", async () => {
    const m = montar({ agora: new Date("2026-03-07T06:00:00.000Z") });
    m.config.fuso = "America/New_York";
    // 02:30 em Nova York, todo dia; em 8/3 as 02:30 não existem (02:00 vira 03:00).
    const criado = await m.lembretes.criar({
      texto: "Remédio",
      quando: "2026-03-07T07:30:00.000Z",
      recorrencia: "FREQ=DAILY;COUNT=5",
    });
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));
    const dia8 = unico((await m.lembretes.concluir({ ids: [criado.id] })).lembretes);
    expect(dia8.quando).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    vi.setSystemTime(new Date("2026-03-08T08:00:00.000Z"));
    const dia9 = unico((await m.lembretes.concluir({ ids: [criado.id] })).lembretes);
    expect(dia9.quando).toBe("2026-03-09T06:30:00.000Z"); // 02:30 EDT de novo
    expect(dia9.recorrencia).toBe("FREQ=DAILY;COUNT=5");
    // O COUNT conta do início: 7, 8, 9, 10 e 11 de março.
    vi.setSystemTime(new Date("2026-03-11T08:00:00.000Z"));
    expect(await m.lembretes.concluir({ ids: [criado.id] })).toEqual({
      lembretes: [],
      removidos: [criado.id],
    });
  });

  test("UNTIL: o recorrente acaba no último dia da regra", async () => {
    const { lembretes } = montar();
    const criado = await lembretes.criar({
      texto: "Tomar o antibiótico",
      quando: iso(sp(HOJE, "15:00")),
      recorrencia: "FREQ=DAILY;UNTIL=20261009T235959Z",
    });
    const dia9 = unico((await lembretes.concluir({ ids: [criado.id] })).lembretes);
    expect(dia9.quando).toBe(iso(sp("2026-10-09", "15:00")));
    expect(await lembretes.concluir({ ids: [criado.id] })).toEqual({ lembretes: [], removidos: [criado.id] });
  });

  test("o único atrasado que volta a tocar leva o aviso agrupado junto", async () => {
    const { casca, relogio, lembretes } = montar({ agora: sp(HOJE, "14:00") });
    await lembretes.criar({ texto: "Beber água", quando: iso(sp(HOJE, "15:00")), recorrencia: "FREQ=DAILY" });
    vi.setSystemTime(sp(HOJE, "16:00"));
    await relogio.ligar();
    const agrupado = unico(casca.mostrados);
    expect(agrupado.titulo).toBe("1 lembrete passou enquanto o Moductus estava fechado");

    await vi.advanceTimersByTimeAsync(23 * 60 * MIN);
    expect(casca.mostrados.map((a) => a.titulo)).toEqual([agrupado.titulo, "Beber água"]);
    expect(casca.retirados).toContain(agrupado.id);
    expect(lembretes.hoje().atrasados).toEqual([]);
  });

  test("canal dock: toca só no painel Hoje, sem aviso do Windows, nem no agrupado", async () => {
    const { casca, relogio, lembretes } = montar({ agora: sp(HOJE, "14:20") });
    await relogio.ligar();
    const quieto = await lembretes.criar({ texto: "Alongar", quando: iso(sp(HOJE, "14:30")), canal: "dock" });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(casca.mostrados).toEqual([]);
    expect(unico(lembretes.hoje().tocando).id).toBe(quieto.id);

    await lembretes.criar({ texto: "Postura", quando: iso(sp(HOJE, "15:00")), canal: "dock" });
    vi.setSystemTime(sp(HOJE, "16:00"));
    await relogio.retomar();
    expect(casca.mostrados).toEqual([]);
    expect(unico(lembretes.hoje().atrasados).texto).toBe("Postura");
  });

  test("canal calendario: no Google, toca pelo celular; com o envio na fila ou sem Google, pelo Windows", async () => {
    const chegaram = new Set<string>();
    const { casca, relogio, lembretes } = montar({
      agora: sp(HOJE, "14:20"),
      noGoogle: (id) => chegaram.has(id),
    });
    await relogio.ligar();
    const noCelular = await lembretes.criar({
      texto: "Remédio",
      quando: iso(sp(HOJE, "14:30")),
      canal: "calendario",
    });
    chegaram.add(noCelular.id);
    await lembretes.criar({ texto: "Ainda na fila", quando: iso(sp(HOJE, "14:40")), canal: "calendario" });
    // O do canal Windows que também foi ao Google avisa nos dois: o canal é dele.
    const windows = await lembretes.criar({ texto: "Reunião", quando: iso(sp(HOJE, "14:50")) });
    chegaram.add(windows.id);
    await vi.advanceTimersByTimeAsync(31 * MIN);
    expect(casca.mostrados.map((a) => a.titulo)).toEqual(["Ainda na fila", "Reunião"]);
    expect(lembretes.hoje().tocando.map((l) => l.texto)).toEqual(["Remédio", "Ainda na fila", "Reunião"]);
  });

  test("cada atrasado com a ausência em que venceu: o cartão só mostra a que vale para todos", async () => {
    const { relogio, lembretes } = montar({ agora: sp(HOJE, "14:20") });
    await relogio.ligar();
    // Escrito para um horário que já passou: atrasado sem ausência.
    const quieto = await lembretes.criar({ texto: "Antigo", quando: iso(sp(HOJE, "13:00")) });
    await vi.advanceTimersByTimeAsync(0);
    await lembretes.criar({ texto: "Da suspensão", quando: iso(sp(HOJE, "14:30")) });
    vi.setSystemTime(sp(HOJE, "16:05"));
    await relogio.retomar();
    expect(lembretes.hoje().atrasados).toHaveLength(2);
    expect(lembretes.hoje().ausencia).toBeNull();

    await lembretes.concluir({ ids: [quieto.id] });
    expect(lembretes.hoje().ausencia).toEqual({ de: iso(sp(HOJE, "14:20")), ate: iso(sp(HOJE, "16:05")) });
  });
});
