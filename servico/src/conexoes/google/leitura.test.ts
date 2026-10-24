import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { RepositorioAgenda, ServicoAgenda } from "../../areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../../areas/agenda/tarefas-do-dia.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import type { ClienteOAuth } from "./cliente.ts";
import { abrirGoogleFalso, credenciaisNaMemoria, type GoogleFalso } from "./fixtures/google-falso.ts";
import {
  AVISO_LEITURA,
  CORPO_LEITURA_FALHOU,
  ServicoGoogleAgenda,
  TITULO_LEITURA_FALHOU,
} from "./google-agenda.ts";
import {
  ESPERAS_DA_COTA_MS,
  INTERVALO_LEITURA_MS,
  LeituraGoogleAgenda,
  MAXIMO_PAGINAS,
  RepositorioLeituraGoogle,
  type MudancaCache,
} from "./leitura.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const googles: GoogleFalso[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const g of googles.splice(0)) await g.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const CLIENTE: ClienteOAuth = { id: "teste.apps.googleusercontent.com", segredo: "segredo-de-teste" };
const CONTA = "voce@gmail.com";
const FUSO = "America/Sao_Paulo";
/** Segunda-feira, 10h em São Paulo (UTC−3, sem horário de verão desde 2019). */
const HOJE = "2026-10-19";
const AGORA = new Date(`${HOJE}T10:00:00.000-03:00`);

/** A data e hora de São Paulo como o Google manda. */
const sp = (dia: string, hora: string) => ({ dateTime: `${dia}T${hora}:00-03:00`, timeZone: FUSO });
const utc = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

/**
 * Banco migrado de verdade, o Google falso em 127.0.0.1 (OAuth e Calendar API) e a conexão feita
 * pelo fluxo de verdade. A espera da cota não espera: anota quanto esperaria. O log fica mudo e
 * guardado, para conferir que token nenhum foi parar nele.
 */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-leitura-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const google = await abrirGoogleFalso(CLIENTE, CONTA);
  googles.push(google);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const relogio = { agora: AGORA };
  const servico = new ServicoGoogleAgenda({
    conexoes: new RepositorioConexoes(db),
    credenciais: credenciaisNaMemoria(),
    abrir: { endereco: (url) => google.abrir.endereco(url) },
    avisar: (c) => leitura?.aoMudarConexao(c),
    clienteDoAutor: CLIENTE,
    enderecos: google.enderecos,
    agora: () => relogio.agora,
  });
  const mudancas: MudancaCache[] = [];
  const erros: { titulo: string; corpo: string }[] = [];
  const esperas: number[] = [];
  let listas = 0;
  let leitura: LeituraGoogleAgenda | null = null;
  const deps: ConstructorParameters<typeof LeituraGoogleAgenda>[0] = {
    google: servico,
    repo: new RepositorioLeituraGoogle(db),
    lerFuso: () => FUSO,
    avisos: {
      eventos: (m) => mudancas.push(m),
      calendarios: () => listas++,
      erro: (a) => erros.push(a),
    },
    enderecos: google.enderecos,
    agora: () => relogio.agora,
    aleatorio: () => 0.5,
    esperar: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
  };
  leitura = new LeituraGoogleAgenda(deps);
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: new RepositorioExecucoes(db),
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => undefined, calendarios: () => undefined },
    { agora: () => relogio.agora },
  );
  const calendario = (idExterno: string) =>
    db
      .prepare(
        "SELECT id, nome, ler, token_sincronizacao, sincronizado_em, apagado_em FROM calendarios WHERE id_externo = ?",
      )
      .get(idExterno) as
      | {
          id: string;
          nome: string;
          ler: number;
          token_sincronizacao: string | null;
          sincronizado_em: string | null;
          apagado_em: string | null;
        }
      | undefined;
  const cache = () =>
    db
      .prepare(
        `SELECT e.id, e.id_externo, e.titulo, e.inicio, e.fim, e.recorrencia, e.excecoes, e.origem
           FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE c.fonte = 'google' ORDER BY e.id_externo`,
      )
      .all() as {
      id: string;
      id_externo: string;
      titulo: string;
      inicio: string;
      fim: string;
      recorrencia: string | null;
      excecoes: string;
      origem: string;
    }[];
  const conexao = () =>
    db.prepare("SELECT estado, ultimo_erro, lida_em FROM conexoes WHERE tipo = 'google-agenda'").get() as {
      estado: string;
      ultimo_erro: string | null;
      lida_em: string | null;
    };
  /** Os títulos e horários de hoje como a Agenda mostra, pela consulta de verdade. */
  const hoje = () =>
    agenda.consultar({ de: HOJE, ate: HOJE }).ocorrencias.map((o) => `${o.inicio} ${o.titulo}`);
  const pedidos = () => google.pedidosCalendario.map((u) => u.pathname + u.search);
  const conectar = async () => {
    await servico.ligar();
    return leitura;
  };
  return {
    db,
    google,
    servico,
    leitura,
    deps,
    agenda,
    log,
    relogio,
    mudancas,
    erros,
    esperas,
    listas: () => listas,
    calendario,
    cache,
    conexao,
    hoje,
    pedidos,
    conectar,
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;

/** Uma semana de agenda no calendário principal: o avulso de hoje, o de dia inteiro e o semanal. */
function semearSemana(m: Montado) {
  m.google.gravarEvento(CONTA, {
    id: "avulso",
    etag: '"1"',
    summary: "Dentista",
    start: sp(HOJE, "14:00"),
    end: sp(HOJE, "15:00"),
  });
  m.google.gravarEvento(CONTA, {
    id: "aniversario",
    summary: "Aniversário da Ana",
    start: { date: HOJE },
    end: { date: "2026-10-20" },
  });
  // Toda segunda às 9h, desde a semana passada.
  m.google.gravarEvento(CONTA, {
    id: "semanal",
    summary: "1:1",
    start: sp("2026-10-12", "09:00"),
    end: sp("2026-10-12", "09:30"),
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  });
  // Acabou há mais de 7 dias: fora do cache.
  m.google.gravarEvento(CONTA, {
    id: "antigo",
    summary: "Velho",
    start: sp("2026-10-01", "10:00"),
    end: sp("2026-10-01", "11:00"),
  });
}

/** A ocorrência de hoje do semanal mudou para as 11h; a da semana que vem foi cancelada. */
function mexerNoSemanal(m: Montado) {
  m.google.gravarEvento(CONTA, {
    id: "semanal_20261019T120000Z",
    summary: "1:1 (adiado)",
    recurringEventId: "semanal",
    originalStartTime: sp(HOJE, "09:00"),
    start: sp(HOJE, "11:00"),
    end: sp(HOJE, "11:30"),
  });
  m.google.gravarEvento(CONTA, {
    id: "semanal_20261026T120000Z",
    status: "cancelled",
    recurringEventId: "semanal",
    originalStartTime: sp("2026-10-26", "09:00"),
  });
}

describe("leitura completa", () => {
  test("lista os calendários (só o principal lido), lê desde 7 dias atrás em páginas e guarda o cache", async () => {
    const m = await montar();
    m.google.calendarios.push({ id: "feriados@group.v.calendar.google.com", summary: "Feriados" });
    m.google.porPagina = 2;
    semearSemana(m);
    mexerNoSemanal(m);
    const leitura = await m.conectar();
    expect(await leitura!.atualizar()).toBe("lida");

    expect(m.calendario(CONTA)).toMatchObject({
      nome: CONTA,
      ler: 1,
      token_sincronizacao: expect.any(String),
    });
    expect(m.calendario("feriados@group.v.calendar.google.com")).toMatchObject({
      nome: "Feriados",
      ler: 0,
      token_sincronizacao: null,
    });
    // O que não é lido não tem os eventos pedidos.
    expect(m.pedidos().some((p) => p.includes("feriados"))).toBe(false);
    const eventos = m.pedidos().filter((p) => p.includes("/events"));
    expect(eventos.length).toBeGreaterThan(1);
    expect(eventos[0]).toContain(
      `timeMin=${encodeURIComponent(new Date(AGORA.getTime() - 7 * 86_400_000).toISOString())}`,
    );
    expect(eventos.every((p) => !p.includes("syncToken") && !p.includes("singleEvents"))).toBe(true);

    expect(m.cache().map((e) => [e.id_externo, e.titulo, e.origem])).toEqual([
      ["aniversario", "Aniversário da Ana", "conexao"],
      ["avulso", "Dentista", "conexao"],
      ["semanal", "1:1", "conexao"],
      ["semanal_20261019T120000Z", "1:1 (adiado)", "conexao"],
    ]);
    const semanal = m.cache().find((e) => e.id_externo === "semanal")!;
    expect(semanal.recorrencia).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(JSON.parse(semanal.excecoes)).toEqual(
      expect.arrayContaining([utc(HOJE, "09:00"), utc("2026-10-26", "09:00")]),
    );

    // Os eventos de hoje batem com o Google: o 1:1 das 9h foi para as 11h, uma vez só.
    expect(m.hoje()).toEqual([
      `${HOJE} Aniversário da Ana`,
      `${utc(HOJE, "11:00")} 1:1 (adiado)`,
      `${utc(HOJE, "14:00")} Dentista`,
    ]);
    // A semana que vem não tem o cancelado; a outra tem o 1:1 de sempre.
    const proximas = m.agenda
      .consultar({ de: "2026-10-26", ate: "2026-11-02" })
      .ocorrencias.map((o) => o.inicio);
    expect(proximas).toEqual([utc("2026-11-02", "09:00")]);

    expect(m.conexao()).toEqual({ estado: "ligada", ultimo_erro: null, lida_em: AGORA.toISOString() });
    expect(m.calendario(CONTA)?.sincronizado_em).toBe(AGORA.toISOString());
    expect(m.listas()).toBeGreaterThan(0);
    expect(m.mudancas.flatMap((x) => x.mudados)).toHaveLength(4);
    expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/acesso-|renovacao-/);
  });

  test("o recorrente de dia inteiro também perde o dia cancelado no Google", async () => {
    const m = await montar();
    m.google.gravarEvento(CONTA, {
      id: "plantao",
      summary: "Plantão",
      start: { date: HOJE },
      end: { date: "2026-10-20" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });
    m.google.gravarEvento(CONTA, {
      id: "plantao_20261026",
      status: "cancelled",
      recurringEventId: "plantao",
      originalStartTime: { date: "2026-10-26" },
    });
    const leitura = await m.conectar();
    await leitura!.atualizar();
    const dias = m.agenda.consultar({ de: HOJE, ate: "2026-11-02" }).ocorrencias.map((o) => o.inicio);
    expect(dias).toEqual([HOJE, "2026-11-02"]);
  });

  test("conectar já lê, e um evento sem forma não atrapalha os outros", async () => {
    const m = await montar();
    semearSemana(m);
    m.google.gravarEvento(CONTA, { id: "quebrado", summary: "sem início" });
    await m.conectar();
    await vi.waitFor(() => expect(m.cache()).toHaveLength(3));
    expect(m.cache().some((e) => e.id_externo === "quebrado")).toBe(false);
  });
});

describe("leitura incremental", () => {
  test("pelo token: o apagado sai, o mudado guarda o id daqui, o novo entra, e a exceção nova vale", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    const antes = new Map(m.cache().map((e) => [e.id_externo, e.id]));
    const token = m.calendario(CONTA)!.token_sincronizacao!;
    m.mudancas.length = 0;
    m.google.pedidosCalendario.length = 0;

    m.google.apagarEvento(CONTA, "avulso");
    m.google.gravarEvento(CONTA, {
      id: "aniversario",
      summary: "Aniversário da Ana Paula",
      start: { date: HOJE },
      end: { date: "2026-10-20" },
    });
    m.google.gravarEvento(CONTA, {
      id: "novo",
      summary: "Almoço",
      start: sp(HOJE, "12:00"),
      end: sp(HOJE, "13:00"),
    });
    mexerNoSemanal(m);
    expect(await leitura!.atualizar()).toBe("lida");

    const eventos = m.pedidos().filter((p) => p.includes("/events"));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toContain(`syncToken=${encodeURIComponent(token)}`);
    expect(eventos[0]).not.toContain("timeMin");

    const depois = new Map(m.cache().map((e) => [e.id_externo, e]));
    expect(depois.has("avulso")).toBe(false);
    expect(depois.get("aniversario")).toMatchObject({
      id: antes.get("aniversario"),
      titulo: "Aniversário da Ana Paula",
    });
    expect(depois.get("novo")?.titulo).toBe("Almoço");
    expect(m.mudancas.flatMap((x) => x.apagados)).toEqual([antes.get("avulso")]);
    expect(m.mudancas.flatMap((x) => x.mudados)).toContain(antes.get("semanal"));
    expect(m.hoje()).toEqual([
      `${HOJE} Aniversário da Ana Paula`,
      `${utc(HOJE, "11:00")} 1:1 (adiado)`,
      `${utc(HOJE, "12:00")} Almoço`,
    ]);
    expect(m.calendario(CONTA)!.token_sincronizacao).not.toBe(token);
  });

  test("o recorrente que volta sem as ocorrências tiradas guarda as exceções que já tinha", async () => {
    const m = await montar();
    semearSemana(m);
    mexerNoSemanal(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();

    m.google.gravarEvento(CONTA, {
      id: "semanal",
      summary: "1:1 semanal",
      start: sp("2026-10-12", "09:00"),
      end: sp("2026-10-12", "09:30"),
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    });
    await leitura!.atualizar();
    expect(m.hoje()).toEqual([
      `${HOJE} Aniversário da Ana`,
      `${utc(HOJE, "11:00")} 1:1 (adiado)`,
      `${utc(HOJE, "14:00")} Dentista`,
    ]);
    const proximas = m.agenda.consultar({ de: "2026-10-26", ate: "2026-11-02" }).ocorrencias;
    expect(proximas.map((o) => `${o.inicio} ${o.titulo}`)).toEqual([
      `${utc("2026-11-02", "09:00")} 1:1 semanal`,
    ]);
  });

  test("410: a leitura recomeça do zero, o que continua no Google guarda o id daqui", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    const antes = new Map(m.cache().map((e) => [e.id_externo, e.id]));
    m.mudancas.length = 0;
    m.google.pedidosCalendario.length = 0;

    m.google.apagarEvento(CONTA, "avulso");
    m.google.vencerSincronizacao();
    expect(await leitura!.atualizar()).toBe("lida");

    const eventos = m.pedidos().filter((p) => p.includes("/events"));
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toContain("syncToken=");
    expect(eventos[1]).toContain("timeMin=");
    expect(m.cache().map((e) => [e.id_externo, e.id])).toEqual([
      ["aniversario", antes.get("aniversario")],
      ["semanal", antes.get("semanal")],
    ]);
    expect(m.mudancas.flatMap((x) => x.apagados)).toEqual([antes.get("avulso")]);
    expect(m.conexao().estado).toBe("ligada");
    // O token novo vale: a próxima é incremental de novo.
    m.google.pedidosCalendario.length = 0;
    await leitura!.atualizar();
    expect(m.pedidos().filter((p) => p.includes("/events"))[0]).toContain("syncToken=");
  });
});

describe("cota e erro", () => {
  test("429 espera com backoff e repete o mesmo pedido", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.google.cota = { restantes: 2, status: 429 };
    m.google.gravarEvento(CONTA, {
      id: "novo",
      summary: "Almoço",
      start: sp(HOJE, "12:00"),
      end: sp(HOJE, "13:00"),
    });

    expect(await leitura!.atualizar()).toBe("lida");
    expect(m.esperas).toEqual([ESPERAS_DA_COTA_MS[0], ESPERAS_DA_COTA_MS[1]]);
    expect(m.cache().some((e) => e.id_externo === "novo")).toBe(true);
    expect(m.erros).toEqual([]);
  });

  test("403 de cota que não passa: a leitura para sem erro na conexão e sem mexer no cache", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    const cache = m.cache();
    const token = m.calendario(CONTA)!.token_sincronizacao;
    m.google.cota = { restantes: 100, status: 403 };

    expect(await leitura!.atualizar()).toBe("cota");
    expect(m.esperas).toHaveLength(ESPERAS_DA_COTA_MS.length);
    expect(m.conexao()).toMatchObject({ estado: "ligada", ultimo_erro: null });
    expect(m.cache()).toEqual(cache);
    expect(m.calendario(CONTA)!.token_sincronizacao).toBe(token);
    expect(m.erros).toEqual([]);
  });

  test("falha põe a conexão em erro com a fala da Alba, avisa uma vez e volta sozinha", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    const cache = m.cache();
    m.google.falharCalendario = 500;

    expect(await leitura!.atualizar()).toBe("erro");
    expect(m.conexao()).toMatchObject({ estado: "erro", ultimo_erro: AVISO_LEITURA });
    expect(m.servico.conexao()).toMatchObject({ estado: "erro", ultimoErro: AVISO_LEITURA });
    expect(m.erros).toEqual([{ titulo: TITULO_LEITURA_FALHOU, corpo: CORPO_LEITURA_FALHOU }]);
    expect(AVISO_LEITURA).toBe(
      "Não consegui ler o Google Agenda. Os eventos de hoje podem estar incompletos; tento de novo em 10 minutos.",
    );
    // O cache da última leitura que deu certo continua.
    expect(m.cache()).toEqual(cache);

    expect(await leitura!.atualizar()).toBe("erro");
    expect(m.erros).toHaveLength(1);

    m.google.falharCalendario = null;
    expect(await leitura!.atualizar()).toBe("lida");
    expect(m.conexao()).toMatchObject({ estado: "ligada", ultimo_erro: null });
  });

  test("o erro de reconectar não é trocado pelo de leitura", async () => {
    const m = await montar();
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.google.revogarTudoNoGoogle();
    m.google.esquecerAcessos();

    expect(await leitura!.atualizar()).toBe("erro");
    expect(m.conexao().ultimo_erro).not.toBe(AVISO_LEITURA);
    expect(m.conexao().estado).toBe("erro");
    expect(m.erros).toEqual([]);
  });

  test("401 renova o token de acesso uma vez e segue", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.google.esquecerAcessos();
    m.google.gravarEvento(CONTA, {
      id: "novo",
      summary: "Almoço",
      start: sp(HOJE, "12:00"),
      end: sp(HOJE, "13:00"),
    });

    expect(await leitura!.atualizar()).toBe("lida");
    expect(m.cache().some((e) => e.id_externo === "novo")).toBe(true);
    expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/acesso-|renovacao-/);
  });
});

describe("os calendários lidos", () => {
  test("escolher ler um calendário faz a próxima leitura trazê-lo; o que some da conta sai com os eventos", async () => {
    const m = await montar();
    const feriados = "feriados@group.v.calendar.google.com";
    m.google.calendarios.push({ id: feriados, summary: "Feriados" });
    m.google.gravarEvento(feriados, {
      id: "f1",
      summary: "Feriado",
      start: { date: "2026-11-02" },
      end: { date: "2026-11-03" },
    });
    const leitura = await m.conectar();
    await leitura!.atualizar();
    expect(m.cache()).toEqual([]);

    m.agenda.definirCalendario({ id: m.calendario(feriados)!.id, ler: true });
    await leitura!.atualizar();
    expect(m.cache().map((e) => e.id_externo)).toEqual(["f1"]);
    // A escolha fica: a lista de novo não a desfaz.
    await leitura!.atualizar();
    expect(m.calendario(feriados)?.ler).toBe(1);

    m.google.calendarios.splice(1, 1);
    await leitura!.atualizar();
    expect(m.calendario(feriados)?.apagado_em).toBe(AGORA.toISOString());
    expect(m.cache()).toEqual([]);
    expect(m.agenda.calendarios().map((c) => c.nome)).toEqual(["Local", CONTA]);
  });

  test("desconectar esquece os calendários do Google e o cache; a leitura não vai mais lá", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    expect(m.cache()).not.toEqual([]);

    await m.servico.desligar();
    expect(m.cache()).toEqual([]);
    expect(m.agenda.calendarios().map((c) => c.fonte)).toEqual(["local"]);
    m.google.pedidosCalendario.length = 0;
    expect(await leitura!.atualizar()).toBe("desligada");
    expect(m.google.pedidosCalendario).toEqual([]);
  });

  test("o evento que acabou há mais de 7 dias sai do cache com o tempo; o recorrente fica", async () => {
    const m = await montar();
    semearSemana(m);
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.relogio.agora = new Date(AGORA.getTime() + 8 * 86_400_000);
    await leitura!.atualizar();
    expect(m.cache().map((e) => e.id_externo)).toEqual(["semanal"]);
  });
});

describe("quando lê", () => {
  test("a cada 10 minutos com variação de 25%, contados do fim da leitura", async () => {
    const m = await montar();
    vi.useFakeTimers();
    // A variação no máximo: 12,5 minutos.
    const leitura = new LeituraGoogleAgenda({ ...m.deps, aleatorio: () => 1 });
    const atualizarOutra = vi.spyOn(leitura, "atualizar").mockResolvedValue("lida");
    const parar = leitura.vigiar();
    expect(atualizarOutra).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVALO_LEITURA_MS * 1.25 - 1);
    expect(atualizarOutra).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(atualizarOutra).toHaveBeenCalledTimes(2);
    parar();
    await vi.advanceTimersByTimeAsync(INTERVALO_LEITURA_MS * 2);
    expect(atualizarOutra).toHaveBeenCalledTimes(2);
  });

  test("abrir a área lê, mas não logo depois de uma leitura", async () => {
    const m = await montar();
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.google.pedidosCalendario.length = 0;

    leitura!.aoAbrirArea();
    expect(m.google.pedidosCalendario).toEqual([]);
    m.relogio.agora = new Date(AGORA.getTime() + 61_000);
    leitura!.aoAbrirArea();
    await vi.waitFor(() => expect(m.pedidos().some((p) => p.includes("/events"))).toBe(true));
  });

  test("duas chamadas juntas viram uma leitura só", async () => {
    const m = await montar();
    const leitura = await m.conectar();
    await leitura!.atualizar();
    m.google.pedidosCalendario.length = 0;
    const [a, b] = await Promise.all([leitura!.atualizar(), leitura!.atualizar()]);
    expect([a, b]).toEqual(["lida", "lida"]);
    expect(m.pedidos().filter((p) => p.includes("calendarList"))).toHaveLength(1);
  });
});

describe("volta 1", () => {
  /** Um `fetch` que responde os eventos do jeito que o teste quer e deixa o resto com o Google falso. */
  const comEventos =
    (eventos: (url: URL) => Response | Promise<Response>): typeof fetch =>
    (entrada, init) => {
      const url = new URL(String(entrada));
      return url.pathname.endsWith("/events") ? Promise.resolve(eventos(url)) : fetch(entrada, init);
    };

  test("a reunião semanal de Nova York segue o horário de verão de lá, vista de São Paulo", async () => {
    const m = await montar();
    const ny = (dia: string, hora: string, offset: string) => ({
      dateTime: `${dia}T${hora}:00${offset}`,
      timeZone: "America/New_York",
    });
    m.google.gravarEvento(CONTA, {
      id: "ny",
      summary: "Sync com NY",
      start: ny(HOJE, "10:00", "-04:00"),
      end: ny(HOJE, "10:30", "-04:00"),
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    });
    m.google.gravarEvento(CONTA, {
      id: "ny_20261026T140000Z",
      status: "cancelled",
      recurringEventId: "ny",
      originalStartTime: ny("2026-10-26", "10:00", "-04:00"),
    });
    const leitura = await m.conectar();
    await leitura!.atualizar();
    // Nova York sai do horário de verão em 01/11: 10h de lá passa de 11h para 12h em São Paulo.
    const vezes = m.agenda.consultar({ de: HOJE, ate: "2026-11-09" }).ocorrencias.map((o) => o.inicio);
    expect(vezes).toEqual([utc(HOJE, "11:00"), utc("2026-11-02", "12:00"), utc("2026-11-09", "12:00")]);
  });

  test("subir com a conexão desligada tira o cache e o token, mas o calendário e a escolha ficam", async () => {
    const m = await montar();
    // Como chega de outro PC (ou ficou de um desconectar que o serviço não terminou).
    m.db
      .prepare(
        `INSERT INTO calendarios (id, nome, fonte, id_externo, ler, token_sincronizacao)
         VALUES ('g1', 'Trabalho', 'google', 'trabalho@empresa.com', 1, 'sync:9')`,
      )
      .run();
    m.db
      .prepare(
        `INSERT INTO eventos (id, calendario_id, titulo, inicio, fim, id_externo)
         VALUES ('e1', 'g1', 'Velho', '2026-10-19T13:00:00.000Z', '2026-10-19T14:00:00.000Z', 'x')`,
      )
      .run();

    expect(await m.leitura!.atualizar()).toBe("desligada");
    expect(m.calendario("trabalho@empresa.com")).toMatchObject({
      ler: 1,
      apagado_em: null,
      token_sincronizacao: null,
    });
    expect(m.cache()).toEqual([]);
    expect(m.mudancas).toEqual([{ mudados: [], apagados: ["e1"] }]);
    expect(m.google.pedidosCalendario).toEqual([]);
  });

  test("a escolha feita no meio de uma leitura roda outra assim que ela termina", async () => {
    const m = await montar();
    const feriados = "feriados@group.v.calendar.google.com";
    m.google.calendarios.push({ id: feriados, summary: "Feriados" });
    m.google.gravarEvento(feriados, {
      id: "f1",
      summary: "Feriado",
      start: { date: "2026-11-02" },
      end: { date: "2026-11-03" },
    });
    await (await m.conectar())!.atualizar();
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((pronto) => (soltar = pronto));
    let segurou = false;
    const leitura = new LeituraGoogleAgenda({
      ...m.deps,
      buscar: async (entrada, init) => {
        // A leitura já escolheu os calendários e está no principal quando você escolhe o outro.
        if (!segurou && String(entrada).includes("/events")) {
          segurou = true;
          await segura;
        }
        return fetch(entrada, init);
      },
    });
    const primeira = leitura.atualizar();
    await vi.waitFor(() => expect(segurou).toBe(true));
    m.agenda.definirCalendario({ id: m.calendario(feriados)!.id, ler: true });
    leitura.aoEscolherCalendario();
    soltar();
    expect(await primeira).toBe("lida");
    await vi.waitFor(() => expect(m.cache().map((e) => e.id_externo)).toEqual(["f1"]));
  });

  test(`${MAXIMO_PAGINAS} páginas sem fim é erro, sem token e sem cache novo`, async () => {
    const m = await montar();
    await (await m.conectar())!.atualizar();
    let pedidos = 0;
    const leitura = new LeituraGoogleAgenda({
      ...m.deps,
      buscar: comEventos(() => {
        pedidos++;
        return Response.json({ items: [], nextPageToken: "de-novo" });
      }),
    });
    const token = m.calendario(CONTA)!.token_sincronizacao;
    expect(await leitura.atualizar()).toBe("erro");
    expect(pedidos).toBe(MAXIMO_PAGINAS);
    expect(m.calendario(CONTA)!.token_sincronizacao).toBe(token);
    expect(m.conexao().ultimo_erro).toBe(AVISO_LEITURA);
  });

  test("a leitura que termina sem token é erro", async () => {
    const m = await montar();
    await (await m.conectar())!.atualizar();
    const leitura = new LeituraGoogleAgenda({
      ...m.deps,
      buscar: comEventos(() => Response.json({ items: [] })),
    });
    expect(await leitura.atualizar()).toBe("erro");
    expect(m.conexao().ultimo_erro).toBe(AVISO_LEITURA);
  });

  test("as páginas somadas passando do teto é erro, sem gravar nada", async () => {
    const m = await montar();
    m.google.porPagina = 1;
    semearSemana(m);
    const ligada = await m.conectar();
    // A leitura que o conectar disparou termina antes de a de teto pequeno começar.
    await ligada!.atualizar();
    m.db.prepare("DELETE FROM eventos").run();
    m.db.prepare("UPDATE calendarios SET token_sincronizacao = NULL").run();
    const leitura = new LeituraGoogleAgenda({ ...m.deps, maximoLeituraBytes: 600 });
    expect(await leitura.atualizar()).toBe("erro");
    expect(m.cache()).toEqual([]);
  });
});
