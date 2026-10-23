import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CALENDARIO_LOCAL, METODOS, type MudancaAgenda, type NovoEvento } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MENSAGENS_DESFAZER, RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { escritaSemGoogle } from "../../conexoes/google/fixtures/google-falso.ts";
import { Catalogo } from "../../ferramentas/catalogo.ts";
import { ferramentasAgenda } from "../../ferramentas/agenda/agenda.ts";
import {
  FERRAMENTA_APLICAR_SUGESTAO,
  MENSAGEM_DURACAO_PASSA_DA_REGRA,
  MENSAGEM_ENCAIXE_MUDOU,
  MENSAGEM_NOME_SO_DO_LOCAL,
  MENSAGEM_REGRA_DE_FORA,
  MENSAGEM_SO_LEITURA,
  MENSAGEM_TAREFA_COM_HORA,
  MENSAGEM_TAREFA_FECHADA,
  MENSAGEM_TAREFA_NA_AGENDA,
  RepositorioAgenda,
  ServicoAgenda,
} from "./agenda.ts";
import { TempoDoDia } from "../dia/tempo.ts";
import { MAX_OCORRENCIAS_POR_EVENTO } from "./livre.ts";
import { RepositorioTarefasDoDia } from "./tarefas-do-dia.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** São Paulo não tem horário de verão desde 2019: a hora local é sempre UTC−3. */
const FUSO = "America/Sao_Paulo";
/** Segunda-feira. */
const DIA = "2026-10-19";

/** O instante UTC da hora local de São Paulo no dia. */
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

/**
 * Banco migrado de verdade (com o calendário local da 014 e as listas da 013), um relógio que o
 * teste acerta, o expediente padrão (09:00 às 18:00) e o desfazer do histórico com o catálogo.
 */
function montar(
  agora = sp(DIA, "07:00"),
  { fuso = FUSO, expediente = { inicio: "09:00", fim: "18:00" } } = {},
) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-agenda-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const relogio = { agora: new Date(agora) };
  const avisos: MudancaAgenda[] = [];
  const listas: unknown[] = [];
  const execucoes = new RepositorioExecucoes(db);
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: execucoes,
      lerDia: () => ({ fuso, expediente }),
    },
    { mudou: (m) => avisos.push(m), calendarios: (c) => listas.push(c) },
    { agora: () => relogio.agora },
  );
  const catalogo = new Catalogo(
    ferramentasAgenda(
      agenda,
      new TempoDoDia(
        () => fuso,
        () => relogio.agora,
      ),
      escritaSemGoogle(),
    ),
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora: () => relogio.agora });
  return { db, agenda, avisos, listas, relogio, catalogo, historico };
}

type Montado = ReturnType<typeof montar>;

/** Um evento com hora no calendário local, pelas horas de São Paulo. */
function marcar(m: Montado, titulo: string, inicio: string, fim: string, extra: Partial<NovoEvento> = {}) {
  return m.agenda.criarEvento({ titulo, inicio, fim, diaInteiro: false, ...extra });
}

/** Um calendário do Google lido pela Alba, com o evento em cache (como a F3-23 grava). */
function googleComEvento(db: DatabaseSync, titulo: string, inicio: string, fim: string, ler = true) {
  const calendario = `g-${titulo}`;
  db.prepare(
    "INSERT INTO calendarios (id, nome, fonte, id_externo, ler) VALUES (?, 'Trabalho', 'google', ?, ?)",
  ).run(calendario, `ext-${titulo}`, ler ? 1 : 0);
  db.prepare(
    `INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, id_externo, origem)
     VALUES (?, ?, ?, ?, ?, ?, 'conexao')`,
  ).run(`ev-${titulo}`, calendario, titulo, inicio, fim, `ext-ev-${titulo}`);
  return { calendario, evento: `ev-${titulo}` };
}

/** Um evento do cache do Google como veio de lá, sem passar pelas recusas da escrita local. */
function doGoogle(
  db: DatabaseSync,
  id: string,
  inicio: string,
  fim: string,
  extra: { diaInteiro?: boolean; recorrencia?: string } = {},
) {
  db.prepare(
    `INSERT OR IGNORE INTO calendarios (id, nome, fonte, id_externo, ler)
     VALUES ('g-cache', 'Cache', 'google', 'ext-cache', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, dia_inteiro, recorrencia, id_externo, origem)
     VALUES (?, 'g-cache', ?, ?, ?, ?, ?, ?, 'conexao')`,
  ).run(id, id, inicio, fim, extra.diaInteiro ? 1 : 0, extra.recorrencia ?? null, `ext-${id}`);
}

/** O que a consulta pode levar, mesmo no pior evento: o serviço é uma linha só. */
const PRAZO_MS = 1_000;

function cronometrar<T>(fazer: () => T): { valor: T; ms: number } {
  const inicio = performance.now();
  const valor = fazer();
  return { valor, ms: performance.now() - inicio };
}

interface Tarefa {
  id: string;
  titulo?: string;
  venceEm?: string;
  hora?: string | null;
  duracao?: number | null;
  prioridade?: number;
  estado?: "aberta" | "feita";
  pai?: string | null;
}

/** A tarefa gravada direto na tabela da 013 (a área Tarefas é a F3-15). */
function tarefa(db: DatabaseSync, t: Tarefa) {
  db.prepare(
    `INSERT INTO tarefas (id, lista_id, titulo, vence_em, hora, duracao_estimada_min, prioridade, estado,
       concluida_em, tarefa_pai_id)
     VALUES (?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.titulo ?? t.id,
    t.venceEm ?? DIA,
    t.hora ?? null,
    t.duracao === undefined ? 60 : t.duracao,
    t.prioridade ?? 0,
    t.estado ?? "aberta",
    t.estado === "feita" ? "2026-10-19T10:00:00.000Z" : null,
    t.pai ?? null,
  );
}

const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

function dia(m: Montado, d = DIA) {
  const agenda = m.agenda.consultar({ de: d, ate: d });
  confere("agenda.consultar", agenda);
  const [unico] = agenda.dias;
  if (!unico) throw new Error("sem dia");
  return { ...unico, ocorrencias: agenda.ocorrencias };
}

describe("horário livre e dia cheio", () => {
  test("a fala do AGENTS: 7h planejadas para 5h livres, juntando o local e o cache do Google", () => {
    const m = montar();
    googleComEvento(m.db, "Daily", sp(DIA, "09:30"), sp(DIA, "10:00"));
    marcar(m, "Foco · PR do relatório", sp(DIA, "10:00"), sp(DIA, "11:00"));
    googleComEvento(m.db, "Planejamento", sp(DIA, "11:00"), sp(DIA, "12:00"));
    marcar(m, "Almoço", sp(DIA, "12:00"), sp(DIA, "13:00"));
    marcar(m, "Ligar para o contador", sp(DIA, "15:00"), sp(DIA, "15:30"));
    tarefa(m.db, { id: "a", duracao: 120, prioridade: 3 });
    tarefa(m.db, { id: "b", duracao: 90, prioridade: 2 });
    tarefa(m.db, { id: "c", duracao: 60, prioridade: 1 });
    tarefa(m.db, { id: "d", duracao: 90 });
    tarefa(m.db, { id: "e", duracao: 60 });
    // Sem estimativa não soma; feita não é planejada; de amanhã fica para amanhã.
    tarefa(m.db, { id: "sem-estimativa", duracao: null });
    tarefa(m.db, { id: "feita", duracao: 300, estado: "feita" });
    tarefa(m.db, { id: "amanha", duracao: 300, venceEm: "2026-10-20" });

    const d = dia(m);
    expect(d.ocorrencias.map((o) => o.titulo)).toEqual([
      "Daily",
      "Foco · PR do relatório",
      "Planejamento",
      "Almoço",
      "Ligar para o contador",
    ]);
    expect(d.livres).toEqual([
      { inicio: sp(DIA, "09:00"), fim: sp(DIA, "09:30"), minutos: 30 },
      { inicio: sp(DIA, "13:00"), fim: sp(DIA, "15:00"), minutos: 120 },
      { inicio: sp(DIA, "15:30"), fim: sp(DIA, "18:00"), minutos: 150 },
    ]);
    expect(d.livreMin).toBe(5 * 60);
    expect(d.planejadoMin).toBe(7 * 60);
    expect(d.cheio).toBe(true);
    // Os encaixes: da maior prioridade para a menor, no primeiro bloco em que cabem, até três.
    expect(d.sugestoes).toEqual([
      { tarefaId: "a", inicio: sp(DIA, "13:00"), fim: sp(DIA, "15:00") },
      { tarefaId: "b", inicio: sp(DIA, "15:30"), fim: sp(DIA, "17:00") },
      { tarefaId: "c", inicio: sp(DIA, "17:00"), fim: sp(DIA, "18:00") },
    ]);
  });

  test("eventos sobrepostos ocupam uma vez só; o intervalo de 10 min entre dois não é livre", () => {
    const m = montar();
    marcar(m, "Um", sp(DIA, "10:00"), sp(DIA, "11:00"));
    marcar(m, "Dois", sp(DIA, "10:30"), sp(DIA, "11:30"));
    marcar(m, "Dentro", sp(DIA, "10:15"), sp(DIA, "10:45"));
    marcar(m, "Três", sp(DIA, "12:00"), sp(DIA, "12:50"));
    marcar(m, "Quatro", sp(DIA, "13:00"), sp(DIA, "14:00"));
    const d = dia(m);
    expect(d.ocorrencias).toHaveLength(5);
    expect(d.livres).toEqual([
      { inicio: sp(DIA, "09:00"), fim: sp(DIA, "10:00"), minutos: 60 },
      { inicio: sp(DIA, "11:30"), fim: sp(DIA, "12:00"), minutos: 30 },
      { inicio: sp(DIA, "14:00"), fim: sp(DIA, "18:00"), minutos: 240 },
    ]);
    expect(d.livreMin).toBe(330);
    expect(d.cheio).toBe(false);
  });

  test("dia inteiro aparece uma vez no intervalo e não ocupa o expediente", () => {
    const m = montar();
    m.agenda.criarEvento({ titulo: "Congresso", inicio: DIA, fim: "2026-10-21", diaInteiro: true });
    marcar(m, "Reunião", sp(DIA, "16:00"), sp(DIA, "17:00"));
    const agenda = m.agenda.consultar({ de: "2026-10-18", ate: "2026-10-21" });
    confere("agenda.consultar", agenda);
    // O de dia inteiro vem antes do de hora no mesmo dia.
    expect(agenda.ocorrencias.map((o) => [o.titulo, o.inicio, o.fim, o.diaInteiro])).toEqual([
      ["Congresso", DIA, "2026-10-21", true],
      ["Reunião", sp(DIA, "16:00"), sp(DIA, "17:00"), false],
    ]);
    expect(agenda.dias.map((d) => [d.dia, d.livreMin])).toEqual([
      // Domingo já passou às 7h de segunda: nada livre nele.
      ["2026-10-18", 0],
      [DIA, 480],
      ["2026-10-20", 540],
      ["2026-10-21", 540],
    ]);
    // O congresso de dois dias ainda está acontecendo quando a consulta começa no segundo.
    expect(m.agenda.consultar({ de: "2026-10-20", ate: "2026-10-20" }).ocorrencias).toHaveLength(1);
  });

  test("recorrente aparece em cada ocorrência e ocupa o horário dela", () => {
    const m = montar();
    const semanal = marcar(m, "1:1", sp("2026-10-05", "10:00"), sp("2026-10-05", "11:00"), {
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
    });
    const agenda = m.agenda.consultar({ de: DIA, ate: "2026-10-27" });
    confere("agenda.consultar", agenda);
    expect(agenda.ocorrencias.map((o) => [o.eventoId, o.inicio, o.recorrente])).toEqual([
      [semanal.id, sp(DIA, "10:00"), true],
      [semanal.id, sp("2026-10-26", "10:00"), true],
    ]);
    const livre = new Map(agenda.dias.map((d) => [d.dia, d.livreMin]));
    expect(livre.get(DIA)).toBe(480);
    expect(livre.get("2026-10-20")).toBe(540);
    expect(livre.get("2026-10-26")).toBe(480);
  });

  test("o evento que atravessa a meia-noite ocupa a manhã do dia seguinte", () => {
    const m = montar();
    marcar(m, "Plantão", sp("2026-10-18", "22:00"), sp(DIA, "09:30"));
    const d = dia(m);
    expect(d.ocorrencias.map((o) => o.titulo)).toEqual(["Plantão"]);
    expect(d.livres[0]).toEqual({ inicio: sp(DIA, "09:30"), fim: sp(DIA, "18:00"), minutos: 510 });
  });

  test("hoje o livre começa no próximo múltiplo de 5 min; dia passado não tem livre nem encaixe", () => {
    const m = montar(sp(DIA, "13:07"));
    tarefa(m.db, { id: "ontem", venceEm: "2026-10-18", duracao: 60 });
    const agenda = m.agenda.consultar({ de: "2026-10-18", ate: DIA });
    const [ontem, hoje] = agenda.dias;
    expect(ontem).toMatchObject({ livres: [], livreMin: 0, planejadoMin: 0, cheio: false, sugestoes: [] });
    expect(hoje?.livres).toEqual([{ inicio: sp(DIA, "13:10"), fim: sp(DIA, "18:00"), minutos: 290 }]);
    // A atrasada conta hoje e ganha o encaixe.
    expect(hoje?.planejadoMin).toBe(60);
    expect(hoje?.sugestoes).toEqual([{ tarefaId: "ontem", inicio: sp(DIA, "13:10"), fim: sp(DIA, "14:10") }]);
  });

  test("calendário que a Alba não lê e evento na lixeira ficam de fora", () => {
    const m = montar();
    googleComEvento(m.db, "Pessoal", sp(DIA, "10:00"), sp(DIA, "12:00"), false);
    const apagado = marcar(m, "Cancelada", sp(DIA, "14:00"), sp(DIA, "15:00"));
    m.agenda.apagarEvento({ id: apagado.id });
    const d = dia(m);
    expect(d.ocorrencias).toEqual([]);
    expect(d.livreMin).toBe(540);
  });

  test("subtarefa coberta pela estimativa da mãe e tarefa com hora no planejado; com hora não é encaixada", () => {
    const m = montar();
    tarefa(m.db, { id: "mae", duracao: 120 });
    tarefa(m.db, { id: "filha", duracao: 30, pai: "mae" });
    tarefa(m.db, { id: "mae-sem", duracao: null });
    tarefa(m.db, { id: "filha-de-mae-sem", duracao: 45, pai: "mae-sem" });
    tarefa(m.db, { id: "com-hora", duracao: 30, hora: "15:00", prioridade: 3 });
    const d = dia(m);
    expect(d.planejadoMin).toBe(120 + 45 + 30);
    // Mesma prioridade e mesma ordem: desempata pelo id.
    expect(d.sugestoes.map((s) => s.tarefaId)).toEqual(["filha-de-mae-sem", "mae"]);
  });

  test("no dia em que o horário de verão começa, o expediente tem uma hora a menos e a reunião segue às 10h", () => {
    // Nova York, 08/03/2026: às 02:00 o relógio pula para 03:00 (de UTC−5 para UTC−4).
    const m = montar("2026-03-07T12:00:00.000Z", {
      fuso: "America/New_York",
      expediente: { inicio: "01:00", fim: "18:00" },
    });
    marcar(m, "Reunião", "2026-03-07T15:00:00.000Z", "2026-03-07T16:00:00.000Z", {
      recorrencia: "FREQ=DAILY",
    });
    tarefa(m.db, { id: "comprovantes", venceEm: "2026-03-08", duracao: 60 });
    const d = dia(m, "2026-03-08");
    // 10h do relógio, agora em UTC−4: 14:00Z, não 15:00Z.
    expect(d.ocorrencias.map((o) => [o.inicio, o.fim])).toEqual([
      ["2026-03-08T14:00:00.000Z", "2026-03-08T15:00:00.000Z"],
    ]);
    // 01:00 (UTC−5) a 18:00 (UTC−4) são 16 h, menos a reunião.
    expect(d.livres).toEqual([
      { inicio: "2026-03-08T06:00:00.000Z", fim: "2026-03-08T14:00:00.000Z", minutos: 480 },
      { inicio: "2026-03-08T15:00:00.000Z", fim: "2026-03-08T22:00:00.000Z", minutos: 420 },
    ]);
    expect(d.livreMin).toBe(900);
    expect(d.sugestoes).toEqual([
      { tarefaId: "comprovantes", inicio: "2026-03-08T06:00:00.000Z", fim: "2026-03-08T07:00:00.000Z" },
    ]);
  });
});

describe("limites do calendário e da expansão", () => {
  test("evento com fim em 9026 não derruba a consulta: aparece e ocupa o dia", () => {
    const m = montar();
    doGoogle(m.db, "sem-fim", sp(DIA, "10:00"), "9026-01-01T00:00:00.000Z");
    doGoogle(m.db, "ferias-sem-fim", DIA, "9026-01-01", { diaInteiro: true });
    const { valor: d, ms } = cronometrar(() => dia(m));
    expect(ms).toBeLessThan(PRAZO_MS);
    expect(d.ocorrencias.map((o) => [o.eventoId, o.inicio, o.fim])).toEqual([
      ["ferias-sem-fim", DIA, "9026-01-01"],
      ["sem-fim", sp(DIA, "10:00"), "9026-01-01T00:00:00.000Z"],
    ]);
    expect(d.livres).toEqual([{ inicio: sp(DIA, "09:00"), fim: sp(DIA, "10:00"), minutos: 60 }]);
    // Semanas depois, os dois continuam acontecendo.
    expect(m.agenda.consultar({ de: "2026-11-16", ate: "2026-11-16" }).ocorrencias).toHaveLength(2);
  });

  test("recorrente que cobre as próprias repetições: teto de ocorrências por consulta, com o corte no log", () => {
    const m = montar();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Diário de 1026 a 2026, como pode vir do Google: cada ocorrência dura mil anos.
    doGoogle(m.db, "mil-anos", "1026-01-01T13:00:00.000Z", "2026-12-31T13:00:00.000Z", {
      recorrencia: "FREQ=DAILY",
    });
    doGoogle(m.db, "mil-anos-dia-inteiro", "1026-01-01", "2026-12-31", {
      diaInteiro: true,
      recorrencia: "FREQ=DAILY",
    });
    const { valor: agenda, ms } = cronometrar(() => m.agenda.consultar({ de: DIA, ate: DIA }));
    expect(ms).toBeLessThan(PRAZO_MS);
    confere("agenda.consultar", agenda);
    const de = (id: string) => agenda.ocorrencias.filter((o) => o.eventoId === id).length;
    expect(de("mil-anos")).toBe(MAX_OCORRENCIAS_POR_EVENTO);
    expect(de("mil-anos-dia-inteiro")).toBe(MAX_OCORRENCIAS_POR_EVENTO);
    expect(agenda.dias[0]?.livreMin).toBe(0);
    const cortados = log.mock.calls.map(
      (c) => /o evento (\S+) passou de 500 ocorrências/.exec(String(c[0]))?.[1],
    );
    expect(cortados.sort()).toEqual(["mil-anos", "mil-anos-dia-inteiro"]);
  });

  test("recorrente que dura mais que o período da regra é recusado na escrita", () => {
    const m = montar();
    expect(() =>
      marcar(m, "Plantão diário", sp(DIA, "10:00"), sp("2026-10-20", "11:00"), { recorrencia: "FREQ=DAILY" }),
    ).toThrow(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    expect(() =>
      m.agenda.criarEvento({
        titulo: "Oito dias toda semana",
        inicio: DIA,
        fim: "2026-10-27",
        diaInteiro: true,
        recorrencia: "FREQ=WEEKLY",
      }),
    ).toThrow(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    // O mês conta pelo mais curto: 28 dias.
    expect(() =>
      marcar(m, "Mês longo", sp(DIA, "10:00"), sp("2026-11-16", "10:01"), { recorrencia: "FREQ=MONTHLY" }),
    ).toThrow(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    // No limite do período, ou com o INTERVAL que espaça as repetições, entra.
    marcar(m, "Plantão de 24 h", sp(DIA, "10:00"), sp("2026-10-20", "10:00"), { recorrencia: "FREQ=DAILY" });
    m.agenda.criarEvento({
      titulo: "A semana inteira",
      inicio: DIA,
      fim: "2026-10-26",
      diaInteiro: true,
      recorrencia: "FREQ=WEEKLY",
    });
    marcar(m, "Dia sim, dia não", sp(DIA, "10:00"), sp("2026-10-21", "09:00"), {
      recorrencia: "FREQ=DAILY;INTERVAL=2",
    });

    // Mudar o quando ou a regra passa pela mesma conta.
    const daily = marcar(m, "Daily", sp(DIA, "09:30"), sp(DIA, "10:00"), { recorrencia: "FREQ=DAILY" });
    expect(() =>
      m.agenda.definirEvento({
        id: daily.id,
        inicio: sp(DIA, "09:30"),
        fim: sp("2026-10-21", "09:30"),
        diaInteiro: false,
      }),
    ).toThrow(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    const congresso = m.agenda.criarEvento({
      titulo: "Congresso",
      inicio: DIA,
      fim: "2026-10-22",
      diaInteiro: true,
    });
    expect(() => m.agenda.definirEvento({ id: congresso.id, recorrencia: "FREQ=DAILY" })).toThrow(
      MENSAGEM_DURACAO_PASSA_DA_REGRA,
    );
    // O que já está gravado assim (vindo de antes) ainda se renomeia.
    m.db.prepare("UPDATE eventos SET fim = ? WHERE id = ?").run(sp("2026-10-22", "09:30"), daily.id);
    expect(m.agenda.definirEvento({ id: daily.id, titulo: "Daily do time" }).titulo).toBe("Daily do time");
  });

  test("intervalo nas pontas do calendário não lança; a ocorrência que passaria de 9999-12-31 fica de fora", () => {
    const m = montar();
    marcar(m, "Último dia", sp("9999-12-31", "10:00"), sp("9999-12-31", "11:00"));
    marcar(m, "Diária no fim", sp("9999-12-30", "12:00"), sp("9999-12-30", "13:00"), {
      recorrencia: "FREQ=DAILY",
    });
    m.agenda.criarEvento({
      titulo: "Dia a dia",
      inicio: "9999-12-30",
      fim: "9999-12-31",
      diaInteiro: true,
      recorrencia: "FREQ=DAILY",
    });
    for (const pedido of [
      { de: "9999-12-30", ate: "9999-12-31" },
      { de: "9999-12-31", ate: "9999-12-31" },
      { de: "0001-01-01", ate: "0001-01-02" },
    ]) {
      confere("agenda.consultar", m.agenda.consultar(pedido));
    }
    const fim = m.agenda.consultar({ de: "9999-12-30", ate: "9999-12-31" });
    expect(fim.dias.map((d) => [d.dia, d.livreMin])).toEqual([
      ["9999-12-30", 480],
      ["9999-12-31", 420],
    ]);
    // A de dia inteiro em 31/12 acabaria em 10000-01-01.
    expect(fim.ocorrencias.map((o) => [o.titulo, o.inicio])).toEqual([
      ["Dia a dia", "9999-12-30"],
      ["Diária no fim", sp("9999-12-30", "12:00")],
      ["Último dia", sp("9999-12-31", "10:00")],
      ["Diária no fim", sp("9999-12-31", "12:00")],
    ]);
  });
});

describe("encaixe aplicado e desfeito", () => {
  test("aplicar cria o evento local com o título da tarefa, liga a tarefa e o desfazer volta tudo", async () => {
    const m = montar();
    tarefa(m.db, { id: "comprovantes", titulo: "Separar comprovantes", duracao: 60 });
    const [sugestao] = dia(m).sugestoes;
    if (!sugestao) throw new Error("sem sugestão");
    expect(sugestao).toEqual({ tarefaId: "comprovantes", inicio: sp(DIA, "09:00"), fim: sp(DIA, "10:00") });

    const aplicada = m.agenda.aplicarSugestao(sugestao);
    confere("agenda.aplicarSugestao", aplicada);
    expect(aplicada.evento).toMatchObject({
      calendarioId: CALENDARIO_LOCAL,
      titulo: "Separar comprovantes",
      inicio: sugestao.inicio,
      fim: sugestao.fim,
      diaInteiro: false,
      editavel: true,
      origem: "usuario",
    });
    expect(aplicada.desfazerAte).toBe(sp("2026-10-20", "07:00"));
    expect(m.avisos.at(-1)).toEqual({ eventos: [aplicada.evento], apagados: [] });
    expect(m.db.prepare("SELECT evento_id FROM tarefas WHERE id = 'comprovantes'").get()).toEqual({
      evento_id: aplicada.evento.id,
    });

    // Na agenda, o tempo dela é o do evento: não conta de novo no planejado nem volta como sugestão.
    const depois = dia(m);
    expect(depois.planejadoMin).toBe(0);
    expect(depois.sugestoes).toEqual([]);
    expect(depois.livreMin).toBe(480);
    expect(() => m.agenda.aplicarSugestao(sugestao)).toThrow(MENSAGEM_TAREFA_NA_AGENDA);

    // O desfazer do histórico acha a inversa no catálogo pela chamada registrada.
    const chamada = m.historico.desfazer({ chamadaId: aplicada.chamadaId });
    expect(chamada).toMatchObject({ ferramenta: FERRAMENTA_APLICAR_SUGESTAO, execucaoId: null });
    expect(chamada.desfeitaEm).not.toBeNull();
    await Promise.resolve();
    expect(m.avisos.at(-1)).toEqual({ eventos: [], apagados: [aplicada.evento.id] });
    expect(m.db.prepare("SELECT evento_id FROM tarefas WHERE id = 'comprovantes'").get()).toEqual({
      evento_id: null,
    });
    const desfeito = dia(m);
    expect(desfeito.ocorrencias).toEqual([]);
    expect(desfeito.planejadoMin).toBe(60);
    expect(desfeito.sugestoes).toEqual([sugestao]);
  });

  test("evento mudado depois do encaixe não se desfaz; fora do prazo, também não", () => {
    const m = montar();
    tarefa(m.db, { id: "t", duracao: 30 });
    const aplicada = m.agenda.aplicarSugestao({
      tarefaId: "t",
      inicio: sp(DIA, "16:00"),
      fim: sp(DIA, "16:30"),
    });
    m.relogio.agora = new Date(m.relogio.agora.getTime() + 1000);
    m.agenda.definirEvento({ id: aplicada.evento.id, titulo: "Comprovantes de setembro" });
    expect(() => m.historico.desfazer({ chamadaId: aplicada.chamadaId })).toThrow(
      MENSAGENS_DESFAZER.areaRecusou(MENSAGEM_ENCAIXE_MUDOU),
    );
    // Nada mudou: o evento continua na agenda e a tarefa ligada a ele.
    expect(m.agenda.obterEvento({ id: aplicada.evento.id }).titulo).toBe("Comprovantes de setembro");

    tarefa(m.db, { id: "u", duracao: 30 });
    const outra = m.agenda.aplicarSugestao({
      tarefaId: "u",
      inicio: sp(DIA, "17:00"),
      fim: sp(DIA, "17:30"),
    });
    m.relogio.agora = new Date(m.relogio.agora.getTime() + 25 * 3_600_000);
    expect(() => m.historico.desfazer({ chamadaId: outra.chamadaId })).toThrow(/prazo para desfazer/);
  });

  test("tarefa feita, com hora ou que não existe não recebe encaixe", () => {
    const m = montar();
    tarefa(m.db, { id: "feita", estado: "feita" });
    tarefa(m.db, { id: "com-hora", hora: "15:00" });
    const bloco = { inicio: sp(DIA, "16:00"), fim: sp(DIA, "17:00") };
    expect(() => m.agenda.aplicarSugestao({ tarefaId: "feita", ...bloco })).toThrow(MENSAGEM_TAREFA_FECHADA);
    expect(() => m.agenda.aplicarSugestao({ tarefaId: "com-hora", ...bloco })).toThrow(
      MENSAGEM_TAREFA_COM_HORA,
    );
    expect(() => m.agenda.aplicarSugestao({ tarefaId: "nenhuma", ...bloco })).toThrow(
      "tarefa não encontrada",
    );
  });

  test("nenhum agente vê a ferramenta do encaixe; o catálogo a guarda para o desfazer", () => {
    const { catalogo } = montar();
    expect(catalogo.obter(FERRAMENTA_APLICAR_SUGESTAO)?.desfazivel).toBe(true);
    // A Alba tem `agenda.*`: vê as outras da agenda, nunca esta.
    const daAgenda = catalogo.doAgente(["agenda.*"]).ferramentas.map((f) => f.nome);
    expect(daAgenda.length).toBeGreaterThan(0);
    expect(daAgenda).not.toContain(FERRAMENTA_APLICAR_SUGESTAO);
    expect(catalogo.doAgente([FERRAMENTA_APLICAR_SUGESTAO]).ferramentas).toEqual([]);
  });
});

describe("eventos e calendários", () => {
  test("o local escreve; o calendário do Google é só leitura por aqui", () => {
    const m = montar();
    const { calendario, evento } = googleComEvento(m.db, "Daily", sp(DIA, "09:30"), sp(DIA, "10:00"));
    expect(m.agenda.obterEvento({ id: evento }).editavel).toBe(false);
    expect(() =>
      m.agenda.criarEvento({
        calendarioId: calendario,
        titulo: "x",
        inicio: DIA,
        fim: "2026-10-20",
        diaInteiro: true,
      }),
    ).toThrow(MENSAGEM_SO_LEITURA);
    expect(() => m.agenda.definirEvento({ id: evento, titulo: "y" })).toThrow(MENSAGEM_SO_LEITURA);
    expect(() => m.agenda.apagarEvento({ id: evento })).toThrow(MENSAGEM_SO_LEITURA);

    const local = marcar(m, "Dentista", sp(DIA, "14:00"), sp(DIA, "15:00"), { alertas: [30] });
    confere("agenda.criarEvento", local);
    expect(local).toMatchObject({ calendarioId: CALENDARIO_LOCAL, alertas: [30], editavel: true });
    const mudado = m.agenda.definirEvento({
      id: local.id,
      inicio: sp(DIA, "15:00"),
      fim: sp(DIA, "16:00"),
      diaInteiro: false,
      local: "Centro",
    });
    expect(mudado).toMatchObject({ inicio: sp(DIA, "15:00"), titulo: "Dentista", local: "Centro" });
    expect(m.agenda.apagarEvento({ id: local.id })).toEqual({ ids: [local.id] });
    expect(() => m.agenda.obterEvento({ id: local.id })).toThrow("evento não encontrado");
  });

  test("regra que o Moductus não sabe repetir não entra pelo local", () => {
    const m = montar();
    expect(() =>
      marcar(m, "A cada hora", sp(DIA, "10:00"), sp(DIA, "10:10"), { recorrencia: "FREQ=HOURLY" }),
    ).toThrow(MENSAGEM_REGRA_DE_FORA("").slice(0, 30));
  });

  test("o evento do espelho entra na fila de saída para o Google", () => {
    const m = montar();
    m.db
      .prepare(
        `INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever)
         VALUES ('moductus', 'Moductus', 'google', 'ext-moductus', 1, 1)`,
      )
      .run();
    const fila = () =>
      m.db
        .prepare("SELECT item_id, operacao FROM agenda_saida WHERE item_tipo = 'evento' ORDER BY item_id")
        .all();
    const e = marcar(m, "Lembrete", sp(DIA, "10:00"), sp(DIA, "10:15"), { calendarioId: "moductus" });
    expect(e.editavel).toBe(true);
    expect(fila()).toEqual([{ item_id: e.id, operacao: "criar" }]);
    // Ainda não chegou ao Google: mudar continua um criar, e apagar tira da fila sem ir.
    m.agenda.definirEvento({ id: e.id, titulo: "Lembrete 2" });
    expect(fila()).toEqual([{ item_id: e.id, operacao: "criar" }]);
    m.agenda.apagarEvento({ id: e.id });
    expect(fila()).toEqual([]);

    const f = marcar(m, "Outro", sp(DIA, "11:00"), sp(DIA, "11:15"), { calendarioId: "moductus" });
    m.db.prepare("UPDATE eventos SET id_externo = 'ext-f' WHERE id = ?").run(f.id);
    m.db.prepare("DELETE FROM agenda_saida").run();
    m.agenda.definirEvento({ id: f.id, titulo: "Outro 2" });
    expect(fila()).toEqual([{ item_id: f.id, operacao: "mudar" }]);
    m.agenda.apagarEvento({ id: f.id });
    expect(fila()).toEqual([{ item_id: f.id, operacao: "apagar" }]);
  });

  test("trocar de calendário: do local ao Moductus cria lá, de volta apaga lá; para o Google de fora, não", () => {
    const m = montar();
    m.db
      .prepare(
        `INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever)
         VALUES ('moductus', 'Moductus', 'google', 'ext-moductus', 1, 1)`,
      )
      .run();
    const { calendario: deFora } = googleComEvento(m.db, "Daily", sp(DIA, "09:30"), sp(DIA, "10:00"));
    const fila = () =>
      m.db
        .prepare("SELECT item_id, operacao FROM agenda_saida WHERE item_tipo = 'evento' ORDER BY item_id")
        .all();
    const e = marcar(m, "Dentista", sp(DIA, "14:00"), sp(DIA, "15:00"));
    expect(fila()).toEqual([]);

    const noMoductus = m.agenda.definirEvento({ id: e.id, calendarioId: "moductus", titulo: "Dentista 2" });
    confere("agenda.definirEvento", noMoductus);
    expect(noMoductus).toMatchObject({ calendarioId: "moductus", titulo: "Dentista 2", editavel: true });
    expect(fila()).toEqual([{ item_id: e.id, operacao: "criar" }]);

    // Chegou ao Google: voltar ao local apaga lá e esquece o id de lá no evento.
    m.db.prepare("UPDATE eventos SET id_externo = 'ext-e' WHERE id = ?").run(e.id);
    m.db.prepare("DELETE FROM agenda_saida").run();
    expect(m.agenda.definirEvento({ id: e.id, calendarioId: CALENDARIO_LOCAL }).calendarioId).toBe(
      CALENDARIO_LOCAL,
    );
    expect(fila()).toEqual([{ item_id: e.id, operacao: "apagar" }]);
    expect(m.db.prepare("SELECT id_externo FROM eventos WHERE id = ?").get(e.id)).toEqual({
      id_externo: null,
    });

    // Mudar o local depois não manda nada ao Google.
    m.db.prepare("DELETE FROM agenda_saida").run();
    m.agenda.definirEvento({ id: e.id, titulo: "Dentista 3" });
    expect(fila()).toEqual([]);

    expect(() => m.agenda.definirEvento({ id: e.id, calendarioId: deFora })).toThrow(MENSAGEM_SO_LEITURA);
    expect(() => m.agenda.definirEvento({ id: e.id, calendarioId: "nao-existe" })).toThrow(
      "calendário não encontrado",
    );
    expect(m.agenda.obterEvento({ id: e.id })).toMatchObject({
      calendarioId: CALENDARIO_LOCAL,
      titulo: "Dentista 3",
    });
  });

  test("calendários: o local primeiro; ler muda em todos, nome e cor só no local", () => {
    const m = montar();
    const { calendario } = googleComEvento(m.db, "Daily", sp(DIA, "09:30"), sp(DIA, "10:00"));
    const lista = m.agenda.calendarios();
    confere("agenda.calendarios", lista);
    expect(lista.map((c) => c.id)).toEqual([CALENDARIO_LOCAL, calendario]);

    expect(m.agenda.definirCalendario({ id: calendario, ler: false })).toMatchObject({ ler: false });
    expect(m.listas).toHaveLength(1);
    expect(dia(m).ocorrencias).toEqual([]);
    expect(() => m.agenda.definirCalendario({ id: calendario, nome: "Outro" })).toThrow(
      MENSAGEM_NOME_SO_DO_LOCAL,
    );
    const local = m.agenda.definirCalendario({ id: CALENDARIO_LOCAL, nome: "Meu", cor: "ambar" });
    confere("agenda.definirCalendario", local);
    expect(local).toMatchObject({ nome: "Meu", cor: "ambar", ler: true });
    // Sem mudança, sem aviso.
    m.agenda.definirCalendario({ id: CALENDARIO_LOCAL, ler: true });
    expect(m.listas).toHaveLength(2);
  });
});

describe("alertas dos compromissos", () => {
  test("cada ocorrência que ainda vai começar, com cada alerta que toca na janela, em ordem", () => {
    const m = montar(sp(DIA, "07:00"));
    const diario = marcar(m, "Daily", sp(DIA, "09:00"), sp(DIA, "09:15"), {
      recorrencia: "FREQ=DAILY",
      alertas: [15],
    });
    const aniversario = m.agenda.criarEvento({
      titulo: "Aniversário da Bia",
      inicio: "2026-10-20",
      fim: "2026-10-21",
      diaInteiro: true,
      alertas: [60],
    });
    // Sem alerta não entra; o que já começou antes da janela também não.
    marcar(m, "Sem alerta", sp(DIA, "10:00"), sp(DIA, "11:00"));
    marcar(m, "Começou", sp(DIA, "06:30"), sp(DIA, "08:00"), { alertas: [10] });

    const alertas = m.agenda.alertasDeCompromissos({
      comecamDepoisDe: new Date(sp(DIA, "07:00")),
      tocamAte: new Date(sp("2026-10-20", "12:00")),
    });
    expect(alertas.map((a) => [a.eventoId, a.inicio, a.minutos, a.toca.toISOString()])).toEqual([
      [diario.id, sp(DIA, "09:00"), 15, sp(DIA, "08:45")],
      // O de dia inteiro começa à meia-noite de São Paulo.
      [aniversario.id, "2026-10-20", 60, sp(DIA, "23:00")],
      [diario.id, sp("2026-10-20", "09:00"), 15, sp("2026-10-20", "08:45")],
    ]);
  });

  test("alerta que o contrato não aceita (veio de outro PC) não conta, e o repetido conta uma vez", () => {
    const m = montar(sp(DIA, "07:00"));
    const evento = marcar(m, "Reunião", sp(DIA, "10:00"), sp(DIA, "11:00"), { alertas: [10] });
    m.db.prepare("UPDATE eventos SET alertas = ? WHERE id = ?").run('[-5, "x", 10, 10, 99999]', evento.id);
    const alertas = m.agenda.alertasDeCompromissos({
      comecamDepoisDe: new Date(sp(DIA, "07:00")),
      tocamAte: new Date(sp(DIA, "12:00")),
    });
    expect(alertas.map((a) => a.minutos)).toEqual([10]);
  });
});
