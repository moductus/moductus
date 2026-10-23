import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { RepositorioAgenda, ServicoAgenda } from "../../areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../../areas/agenda/tarefas-do-dia.ts";
import {
  RepositorioLembretes,
  ServicoLembretes,
  type NotificacoesDoLembrete,
} from "../../areas/lembretes/lembretes.ts";
import { RepositorioTarefas } from "../../areas/tarefas/repositorio.ts";
import { ServicoTarefas } from "../../areas/tarefas/tarefas.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import type { ClienteOAuth } from "./cliente.ts";
import {
  CORPO_RECRIADO,
  ESPERA_INICIAL_MS,
  EspelhoGoogleAgenda,
  MARCA_DO_ESPELHO,
  RepositorioEspelhoGoogle,
  TITULO_RECRIADO,
  type AdotarDoGoogle,
} from "./espelho.ts";
import { abrirGoogleFalso, credenciaisNaMemoria, type GoogleFalso } from "./fixtures/google-falso.ts";
import { ServicoGoogleAgenda } from "./google-agenda.ts";
import type { MudancaCache } from "./leitura.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const googles: GoogleFalso[] = [];
afterEach(async () => {
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
const AMANHA = "2026-10-20";
const AGORA = new Date(`${HOJE}T10:00:00.000-03:00`);
const CONEXAO = { origem: "conexao" } as const;

/** O instante UTC da hora de São Paulo, como o banco guarda. */
const utc = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();
/** A data e hora de São Paulo como o Google manda. */
const sp = (dia: string, hora: string) => ({ dateTime: `${dia}T${hora}:00-03:00`, timeZone: FUSO });

/** Notificações que não vão a lugar nenhum: o espelho não depende delas. */
const notificacoesMudas = {
  avisar: () => Promise.resolve(),
  resolvido: () => Promise.resolve(),
  registrarAcao: () => () => undefined,
} as unknown as NotificacoesDoLembrete;

/**
 * Banco migrado de verdade, as áreas de verdade (Tarefas, Lembretes, Agenda), o Google falso em
 * 127.0.0.1 com a conexão feita pelo fluxo de verdade, e uma rede que o teste derruba: `fora`
 * falha todo pedido do espelho antes de sair; `perderRespostas` deixa o pedido chegar ao Google e
 * perde a resposta. O relógio da próxima tentativa não arma timer: o teste chama a passada.
 */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-espelho-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const google = await abrirGoogleFalso(CLIENTE, CONTA);
  googles.push(google);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const relogio = { agora: AGORA };
  const agora = () => relogio.agora;
  const servico = new ServicoGoogleAgenda({
    conexoes: new RepositorioConexoes(db),
    credenciais: credenciaisNaMemoria(),
    abrir: { endereco: (url) => google.abrir.endereco(url) },
    avisar: () => undefined,
    clienteDoAutor: CLIENTE,
    enderecos: google.enderecos,
    agora,
  });
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => FUSO, notas: { notaParaTarefa: () => null } },
    { tarefas: () => undefined, listas: () => undefined, lembretes: () => undefined },
    { agora },
  );
  const lembretes = new ServicoLembretes(
    new RepositorioLembretes(db),
    { lerFuso: () => FUSO, notificacoes: notificacoesMudas },
    { mudou: () => undefined, hoje: () => undefined },
    { agora },
  );
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: new RepositorioExecucoes(db),
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => undefined, calendarios: () => undefined },
    { agora },
  );
  const rede = { fora: false, perderRespostas: 0, perderCriacao: 0 };
  const buscar: typeof fetch = async (entrada, init) => {
    if (rede.fora) throw new TypeError("fetch failed");
    const resposta = await fetch(entrada, init);
    const post = init?.method === "POST";
    const perder =
      post && String(entrada).endsWith("/events")
        ? rede.perderRespostas > 0 && rede.perderRespostas-- > 0
        : post &&
          String(entrada).endsWith("/calendars") &&
          rede.perderCriacao > 0 &&
          rede.perderCriacao-- > 0;
    if (perder) {
      await resposta.body?.cancel();
      throw new TypeError("fetch failed");
    }
    return resposta;
  };
  const recriados: { titulo: string; corpo: string }[] = [];
  const eventos: MudancaCache[] = [];
  const armados: number[] = [];
  const avisosDeCalendarios = { n: 0 };
  const adotarDeVerdade: AdotarDoGoogle = {
    tarefa: (id, mudanca) => void tarefas.definir({ id, ...mudanca }, CONEXAO),
    lembrete: async (id, mudanca) => void (await lembretes.definir({ id, ...mudanca }, CONEXAO)),
  };
  const novoEspelho = (adotar: AdotarDoGoogle = adotarDeVerdade) =>
    new EspelhoGoogleAgenda({
      google: servico,
      repo: new RepositorioEspelhoGoogle(db),
      lerFuso: () => FUSO,
      adotar,
      avisos: {
        eventos: (m) => eventos.push(m),
        calendarios: () => avisosDeCalendarios.n++,
        recriado: (a) => recriados.push(a),
      },
      enderecos: google.enderecos,
      buscar,
      agora,
      aleatorio: () => 0.5,
      programar: (ms) => {
        armados.push(ms);
        return () => undefined;
      },
    });
  const espelho = novoEspelho();

  const calendarioDoEspelho = () =>
    db
      .prepare("SELECT id, nome, id_externo, ler FROM calendarios WHERE espelho = 1 AND apagado_em IS NULL")
      .get() as { id: string; nome: string; id_externo: string; ler: number } | undefined;
  const noGoogle = () => google.eventosDe(calendarioDoEspelho()!.id_externo);
  const fila = () =>
    db
      .prepare(
        "SELECT item_tipo, item_id, operacao, tentativas, proxima_tentativa_em, ultimo_erro FROM agenda_saida ORDER BY item_id",
      )
      .all() as {
      item_tipo: string;
      item_id: string;
      operacao: string;
      tentativas: number;
      proxima_tentativa_em: string;
      ultimo_erro: string | null;
    }[];
  const mapa = (id: string) =>
    db
      .prepare("SELECT id_externo, etag_externo, desligado, recusado FROM agenda_espelho WHERE item_id = ?")
      .get(id) as
      { id_externo: string; etag_externo: string | null; desligado: number; recusado: number } | undefined;
  /** O evento de um item como está no Google agora. */
  const noGoogleDe = (id: string) => noGoogle().find((e) => e.id === mapa(id)?.id_externo);
  /** Muda o evento de um item no Google, como no celular. */
  const mudarLa = (id: string, mudanca: Record<string, unknown>) =>
    google.mudarEvento(calendarioDoEspelho()!.id_externo, mapa(id)!.id_externo, mudanca);
  const escritas = (metodo?: string) =>
    google.escritas
      .filter((e) => metodo === undefined || e.metodo === metodo)
      .map((e) => `${e.metodo} ${e.rota}`);
  const tarefa = (id: string) => tarefas.obter({ id });
  const passar = (ms: number) => {
    relogio.agora = new Date(relogio.agora.getTime() + ms);
  };
  await servico.ligar();
  return {
    db,
    google,
    servico,
    tarefas,
    lembretes,
    agenda,
    espelho,
    novoEspelho,
    rede,
    log,
    relogio,
    recriados,
    eventos,
    armados,
    avisosDeCalendarios,
    calendarioDoEspelho,
    noGoogle,
    noGoogleDe,
    mudarLa,
    fila,
    mapa,
    escritas,
    tarefa,
    passar,
  };
}

describe("o calendário Moductus", () => {
  test("ao conectar nasce na conta, guardado como espelho; ao reiniciar é reaproveitado pelo id", async () => {
    const m = await montar();
    expect(await m.espelho.sincronizar()).toBe("enviado");
    const espelho = m.calendarioDoEspelho();
    expect(espelho).toMatchObject({ nome: "Moductus", ler: 1 });
    expect(m.google.calendarios.map((c) => c.summary)).toEqual([CONTA, "Moductus"]);
    expect(m.google.calendarios[1]?.description).toBe(MARCA_DO_ESPELHO);
    expect(m.escritas()).toEqual(["POST /calendars"]);
    expect(m.avisosDeCalendarios.n).toBe(1);

    // O serviço reiniciou: confere o que guardou, não cria outro.
    expect(await m.novoEspelho().sincronizar()).toBe("enviado");
    expect(m.escritas("POST")).toEqual(["POST /calendars"]);
    expect(m.google.pedidosCalendario.map((u) => u.pathname)).toContain(
      `/calendar/v3/calendars/${encodeURIComponent(espelho!.id_externo)}`,
    );
    expect(m.calendarioDoEspelho()?.id).toBe(espelho!.id);
  });

  test("apagado no Google, é criado de novo uma vez, com aviso, e tudo vai outra vez", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    const antigo = m.calendarioDoEspelho()!.id_externo;
    expect(m.noGoogle()).toHaveLength(1);

    m.google.apagarCalendario(antigo);
    expect(await m.espelho.sincronizar()).toBe("enviado");
    const novo = m.calendarioDoEspelho()!;
    expect(novo.id_externo).not.toBe(antigo);
    expect(m.recriados).toEqual([{ titulo: TITULO_RECRIADO, corpo: CORPO_RECRIADO }]);
    expect(m.noGoogle()).toEqual([expect.objectContaining({ summary: "Dentista" })]);
    expect(m.mapa(t.id)?.etag_externo).not.toBeNull();

    // Uma vez: a passada seguinte não recria nem avisa de novo.
    await m.espelho.sincronizar();
    expect(m.recriados).toHaveLength(1);
    expect(m.escritas("POST").filter((e) => e === "POST /calendars")).toHaveLength(2);
  });
});

describe("o que vai ao Google", () => {
  test("a tarefa com hora vira evento com o alerta popup do lembrete dela, só com título e horário", async () => {
    const m = await montar();
    const t = m.tarefas.criar({
      titulo: "Ligar pro banco",
      venceEm: AMANHA,
      hora: "15:00",
      notas: "agência 123",
    });
    expect(await m.espelho.sincronizar()).toBe("enviado");
    const [evento] = m.noGoogle();
    expect(evento).toMatchObject({
      id: m.mapa(t.id)!.id_externo,
      summary: "Ligar pro banco",
      start: { dateTime: utc(AMANHA, "15:00"), timeZone: FUSO },
      end: { dateTime: utc(AMANHA, "15:30"), timeZone: FUSO },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
      transparency: "transparent",
      extendedProperties: { private: { moductus_tipo: "tarefa", moductus_id: t.id } },
    });
    expect(evento).not.toHaveProperty("description");
    expect(m.fila()).toEqual([]);
    // O lembrete da tarefa é o alerta dela: não vai sozinho.
    expect(m.noGoogle()).toHaveLength(1);
  });

  test("o lembrete com horário toca na hora; o recorrente vai com a regra; o do dock não vai", async () => {
    const m = await montar();
    const avulso = await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(AMANHA, "09:00") });
    const diario = await m.lembretes.criar({
      texto: "Remédio",
      quando: utc(AMANHA, "08:00"),
      recorrencia: "FREQ=DAILY",
      canal: "calendario",
    });
    await m.lembretes.criar({ texto: "Alongar", quando: utc(AMANHA, "11:00"), canal: "dock" });
    await m.espelho.sincronizar();
    const porTitulo = Object.fromEntries(m.noGoogle().map((e) => [e.summary, e]));
    expect(Object.keys(porTitulo).sort()).toEqual(["Pagar boleto", "Remédio"]);
    expect(porTitulo["Pagar boleto"]).toMatchObject({
      start: { dateTime: utc(AMANHA, "09:00") },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
      recurrence: [],
      extendedProperties: { private: { moductus_tipo: "lembrete", moductus_id: avulso.id } },
    });
    expect(porTitulo["Remédio"]).toMatchObject({
      start: { dateTime: utc(AMANHA, "08:00"), timeZone: FUSO },
      recurrence: ["RRULE:FREQ=DAILY"],
      extendedProperties: { private: { moductus_id: diario.id } },
    });
    expect(m.espelho.chegouAoGoogle(diario.id)).toBe(true);
  });

  test("o evento que a agenda pôs no Moductus vai inteiro, e apagado lá na agenda sai do Google", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const calendarioId = m.calendarioDoEspelho()!.id;
    const e = m.agenda.criarEvento({
      calendarioId,
      titulo: "Consulta",
      descricao: "levar exames",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
      alertas: [60, 10],
    });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([
      expect.objectContaining({
        summary: "Consulta",
        description: "levar exames",
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 10 },
            { method: "popup", minutes: 60 },
          ],
        },
        transparency: "opaque",
      }),
    ]);
    const idExterno = m.mapa(e.id)!.id_externo;
    expect(m.db.prepare("SELECT id_externo FROM eventos WHERE id = ?").get(e.id)).toEqual({
      id_externo: idExterno,
    });

    m.agenda.apagarEvento({ id: e.id });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);
    expect(m.escritas("DELETE")).toEqual([
      `DELETE /calendars/${encodeURIComponent(m.calendarioDoEspelho()!.id_externo)}/events/${idExterno}`,
    ]);
    expect(m.mapa(e.id)).toBeUndefined();
  });

  test("mudar a hora da tarefa espelhada aqui leva o lembrete junto e muda o evento lá, sem outro", async () => {
    const m = await montar();
    const t = m.tarefas.criar({
      titulo: "Dentista",
      venceEm: AMANHA,
      hora: "15:00",
      lembreteMinutosAntes: 30,
    });
    await m.espelho.sincronizar();
    const idExterno = m.mapa(t.id)!.id_externo;

    // O que o detalhe da tarefa manda ao trocar a hora.
    m.tarefas.definir({ id: t.id, hora: "16:30" });
    const [lembrete] = m.lembretes.listar({}).filter((l) => l.tarefaId === t.id);
    expect(lembrete).toMatchObject({ quando: utc(AMANHA, "16:00"), estado: "agendado" });
    expect(m.tarefa(t.id).lembreteMinutosAntes).toBe(30);

    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.noGoogle()).toEqual([
      expect.objectContaining({
        id: idExterno,
        start: { dateTime: utc(AMANHA, "16:30"), timeZone: FUSO },
        end: { dateTime: utc(AMANHA, "17:00"), timeZone: FUSO },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
      }),
    ]);
    expect(m.escritas("POST").filter((e) => e.endsWith("/events"))).toHaveLength(1);
    expect(m.fila()).toEqual([]);
  });

  test("o evento passado do local ao Moductus vai ao Google; de volta ao local, sai de lá", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const calendarioId = m.calendarioDoEspelho()!.id;
    const e = m.agenda.criarEvento({
      titulo: "Consulta",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
    });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);

    m.agenda.definirEvento({ id: e.id, calendarioId });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([expect.objectContaining({ summary: "Consulta" })]);
    const idExterno = m.mapa(e.id)!.id_externo;

    m.agenda.definirEvento({ id: e.id, calendarioId: "local" });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);
    expect(m.escritas("DELETE")).toEqual([
      `DELETE /calendars/${encodeURIComponent(m.calendarioDoEspelho()!.id_externo)}/events/${idExterno}`,
    ]);
    expect(m.mapa(e.id)).toBeUndefined();
    // O evento fica no local, inteiro: o apagar lá, lido de volta, não o leva à lixeira.
    await m.espelho.sincronizar();
    expect(m.agenda.obterEvento({ id: e.id })).toMatchObject({ calendarioId: "local", titulo: "Consulta" });
  });

  test("concluir a tarefa tira o evento; reaberta antes de o apagar sair, ele fica", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Entregar relatório", venceEm: AMANHA, hora: "17:00" });
    await m.espelho.sincronizar();
    m.rede.fora = true;
    m.tarefas.concluir({ id: t.id });
    await m.espelho.sincronizar();
    expect(m.fila()).toMatchObject([{ item_id: t.id, operacao: "apagar", tentativas: 1 }]);
    m.tarefas.reabrir({ id: t.id });
    m.rede.fora = false;
    await m.espelho.sincronizar();
    expect(m.fila()).toEqual([]);
    expect(m.noGoogle()).toHaveLength(1);
    expect(m.escritas("DELETE")).toEqual([]);

    m.tarefas.concluir({ id: t.id });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);
    expect(m.mapa(t.id)).toBeUndefined();
  });
});

describe("a fila de saída", () => {
  test("sem rede a escrita espera, com backoff, e sai ao voltar, sem duplicar", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    m.rede.fora = true;
    const l = await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(AMANHA, "09:00") });
    expect(await m.espelho.sincronizar()).toBe("esperando");
    const [linha] = m.fila();
    expect(linha).toMatchObject({ item_id: l.id, operacao: "criar", tentativas: 1, ultimo_erro: "sem rede" });
    expect(Date.parse(linha!.proxima_tentativa_em) - AGORA.getTime()).toBe(ESPERA_INICIAL_MS);
    // O relógio da próxima tentativa fica armado para depois da espera, não a cada segundo.
    expect(m.armados.at(-1)).toBeGreaterThanOrEqual(ESPERA_INICIAL_MS);

    // Ainda sem rede: a segunda falha espera o dobro.
    m.passar(ESPERA_INICIAL_MS);
    await m.espelho.sincronizar();
    expect(m.fila()).toMatchObject([{ tentativas: 2 }]);
    expect(Date.parse(m.fila()[0]!.proxima_tentativa_em) - m.relogio.agora.getTime()).toBe(
      2 * ESPERA_INICIAL_MS,
    );

    // A rede voltou, mas a vez dele ainda não: espera.
    m.rede.fora = false;
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);
    m.passar(2 * ESPERA_INICIAL_MS);
    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.noGoogle()).toEqual([expect.objectContaining({ summary: "Pagar boleto" })]);
    expect(m.fila()).toEqual([]);

    // Outras passadas não mandam de novo.
    await m.espelho.sincronizar();
    await m.novoEspelho().sincronizar();
    expect(m.escritas("POST").filter((e) => e.endsWith("/events"))).toHaveLength(1);
    expect(m.noGoogle()).toHaveLength(1);
    // Nenhum token de acesso foi parar no log.
    expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/acesso-\d/);
  });

  test("o Google gravou e a resposta se perdeu: a nova tentativa dá 409 e não duplica", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    m.rede.perderRespostas = 1;
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    expect(await m.espelho.sincronizar()).toBe("esperando");
    expect(m.noGoogle()).toHaveLength(1);
    expect(m.mapa(t.id)?.etag_externo).toBeNull();

    m.passar(ESPERA_INICIAL_MS);
    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.noGoogle()).toHaveLength(1);
    const evento = m.mapa(t.id)!.id_externo;
    expect(m.escritas().filter((e) => e.includes("/events"))).toEqual([
      expect.stringMatching(/^POST .*\/events$/),
      expect.stringMatching(/^POST .*\/events$/),
      expect.stringMatching(new RegExp(`^PATCH .*/events/${evento}$`)),
    ]);
    expect(m.mapa(t.id)?.etag_externo).not.toBeNull();
  });

  test("a mudança daqui que ainda não saiu vence a que foi feita no Google", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.rede.fora = true;
    m.tarefas.definir({ id: t.id, hora: "18:00" });
    await m.espelho.sincronizar();
    m.google.mudarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(t.id)!.id_externo, {
      start: sp(AMANHA, "16:30"),
      end: sp(AMANHA, "17:00"),
    });
    m.rede.fora = false;
    m.passar(ESPERA_INICIAL_MS);
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id).hora).toBe("18:00");
    expect(m.noGoogle()).toEqual([
      expect.objectContaining({ start: { dateTime: utc(AMANHA, "18:00"), timeZone: FUSO } }),
    ]);
  });
});

describe("de volta do Google", () => {
  test("a mudança de hora e de título feita lá é adotada, e o lembrete da tarefa vai junto", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    const escritasAntes = m.escritas().length;
    m.google.mudarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(t.id)!.id_externo, {
      summary: "Dentista (Dra. Ana)",
      start: sp(HOJE, "16:30"),
      end: sp(HOJE, "17:00"),
    });

    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.tarefa(t.id)).toMatchObject({ titulo: "Dentista (Dra. Ana)", venceEm: HOJE, hora: "16:30" });
    const [lembrete] = m.lembretes.listar({}).filter((l) => l.tarefaId === t.id);
    expect(lembrete).toMatchObject({ quando: utc(HOJE, "16:15"), texto: "Dentista (Dra. Ana)" });
    // O que veio de lá não volta como eco: nada foi escrito no Google.
    await m.espelho.sincronizar();
    expect(m.escritas()).toHaveLength(escritasAntes);
  });

  test("a própria escrita lida de volta não muda nada", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    const versao = m.tarefa(t.id).atualizadoEm;
    const escritasAntes = m.escritas().length;
    await m.espelho.sincronizar();
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id).atualizadoEm).toBe(versao);
    expect(m.escritas()).toHaveLength(escritasAntes);
  });

  test("o lembrete mudado de hora lá é adotado", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(AMANHA, "09:00") });
    await m.espelho.sincronizar();
    m.google.mudarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(l.id)!.id_externo, {
      start: sp(AMANHA, "10:00"),
      end: sp(AMANHA, "10:15"),
    });
    await m.espelho.sincronizar();
    expect(m.lembretes.listar({}).find((x) => x.id === l.id)).toMatchObject({
      quando: utc(AMANHA, "10:00"),
      estado: "agendado",
    });
  });

  test("o evento apagado lá desliga o espelho daquele item; a tarefa fica", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.google.apagarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(t.id)!.id_externo);
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id)).toMatchObject({ estado: "aberta", hora: "15:00" });
    expect(m.mapa(t.id)?.desligado).toBe(1);

    const escritasAntes = m.escritas().length;
    m.tarefas.definir({ id: t.id, hora: "16:00" });
    await m.espelho.sincronizar();
    expect(m.escritas()).toHaveLength(escritasAntes);
    expect(m.fila()).toEqual([]);
  });

  test("o evento da agenda apagado lá vai para a lixeira daqui", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const e = m.agenda.criarEvento({
      calendarioId: m.calendarioDoEspelho()!.id,
      titulo: "Consulta",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
    });
    await m.espelho.sincronizar();
    m.google.apagarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(e.id)!.id_externo);
    await m.espelho.sincronizar();
    await Promise.resolve();
    expect(() => m.agenda.obterEvento({ id: e.id })).toThrow();
    expect(m.eventos).toEqual([{ mudados: [], apagados: [e.id] }]);
  });

  test("o espelho que outro PC pôs lá, com o moductus_id, é achado e não duplica", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    m.google.gravarEvento(m.calendarioDoEspelho()!.id_externo, {
      id: "deoutropc0001",
      etag: '"x1"',
      summary: "Dentista",
      start: sp(AMANHA, "15:00"),
      end: sp(AMANHA, "15:30"),
      extendedProperties: { private: { moductus_tipo: "tarefa", moductus_id: t.id } },
    });
    await m.espelho.sincronizar();
    expect(m.noGoogle().map((e) => e.id)).toEqual(["deoutropc0001"]);
    expect(m.mapa(t.id)?.id_externo).toBe("deoutropc0001");
    // Não cria outro: atualiza aquele com o que a tarefa é aqui.
    expect(m.escritas().filter((e) => e.includes("/events"))).toEqual([
      expect.stringMatching(/^PATCH .*\/events\/deoutropc0001$/),
    ]);
  });
});

describe("volta 1 da revisão", () => {
  test("403 de cota não é calendário sumido: espera, sem criar outro nem avisar", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    const antes = m.calendarioDoEspelho()!.id_externo;
    // Na conferência do calendário (serviço reiniciado) e na leitura de volta.
    m.google.cota = { restantes: 1, status: 403 };
    expect(await m.novoEspelho().sincronizar()).toBe("esperando");
    m.google.cota = { restantes: 1, status: 403 };
    await m.espelho.sincronizar();
    expect(m.recriados).toEqual([]);
    expect(m.calendarioDoEspelho()!.id_externo).toBe(antes);
    expect(m.escritas("POST").filter((e) => e === "POST /calendars")).toHaveLength(1);
    expect(m.mapa(t.id)?.etag_externo).not.toBeNull();
  });

  test("criar o calendário de novo que falha espera, não tenta a cada segundo", async () => {
    const m = await montar();
    m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.google.apagarCalendario(m.calendarioDoEspelho()!.id_externo);
    m.google.falharCriarCalendario = 500;
    m.tarefas.criar({ titulo: "Outra", venceEm: AMANHA, hora: "16:00" });
    expect(await m.espelho.sincronizar()).toBe("esperando");
    expect(m.armados.at(-1)).toBeGreaterThanOrEqual(ESPERA_INICIAL_MS);
    expect(m.recriados).toEqual([]);
  });

  test("a criação do calendário que perdeu a resposta não deixa dois Moductus", async () => {
    const m = await montar();
    m.rede.perderCriacao = 1;
    expect(await m.espelho.sincronizar()).toBe("esperando");
    expect(m.calendarioDoEspelho()).toBeUndefined();
    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.google.calendarios.filter((c) => c.summary === "Moductus")).toHaveLength(1);
    expect(m.calendarioDoEspelho()?.id_externo).toBe(m.google.calendarios[1]?.id);
    expect(m.escritas("POST").filter((e) => e === "POST /calendars")).toHaveLength(1);
  });

  test("canal calendario: sem conexão ligada, o lembrete não conta como no Google", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({
      texto: "Remédio",
      quando: utc(AMANHA, "08:00"),
      canal: "calendario",
    });
    await m.espelho.sincronizar();
    expect(m.espelho.chegouAoGoogle(l.id)).toBe(true);
    await m.servico.desligar();
    expect(m.espelho.chegouAoGoogle(l.id)).toBe(false);
  });

  test("canal calendario: o que o Google recusou de vez não conta como no Google, até ir de novo", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({
      texto: "Remédio",
      quando: utc(AMANHA, "08:00"),
      canal: "calendario",
    });
    await m.espelho.sincronizar();
    m.google.recusarEventos = true;
    await m.lembretes.definir({ id: l.id, texto: "Remédio da pressão" });
    expect(await m.espelho.sincronizar()).toBe("enviado");
    expect(m.mapa(l.id)?.recusado).toBe(1);
    expect(m.fila()).toEqual([]);
    expect(m.espelho.chegouAoGoogle(l.id)).toBe(false);
    // Não insiste no mesmo conteúdo; mudou de novo, vai.
    await m.espelho.sincronizar();
    expect(m.escritas("PATCH")).toHaveLength(1);
    m.google.recusarEventos = false;
    await m.lembretes.definir({ id: l.id, texto: "Remédio da manhã" });
    await m.espelho.sincronizar();
    expect(m.noGoogleDe(l.id)).toMatchObject({ summary: "Remédio da manhã" });
    expect(m.espelho.chegouAoGoogle(l.id)).toBe(true);
  });

  test("canal calendario: apagado lá antes de um 410, a leitura completa desliga o espelho", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({
      texto: "Remédio",
      quando: utc(AMANHA, "08:00"),
      canal: "calendario",
    });
    const fica = await m.lembretes.criar({ texto: "Água", quando: utc(AMANHA, "09:00") });
    await m.espelho.sincronizar();
    m.google.apagarEvento(m.calendarioDoEspelho()!.id_externo, m.mapa(l.id)!.id_externo);
    m.google.vencerSincronizacao();
    await m.espelho.sincronizar();
    expect(m.mapa(l.id)?.desligado).toBe(1);
    expect(m.espelho.chegouAoGoogle(l.id)).toBe(false);
    expect(m.mapa(fica.id)?.desligado).toBe(0);
    expect(m.espelho.chegouAoGoogle(fica.id)).toBe(true);
  });

  test("lembretes da tarefa: o do dock não é alerta, o adiado conta pela hora do adiamento, o que não cabe vai sozinho", async () => {
    const m = await montar();
    // A tarefa nasce com o lembrete dela 15 min antes.
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.lembretes.criar({ texto: "Quieto", quando: utc(AMANHA, "14:00"), tarefaId: t.id, canal: "dock" });
    const depois = await m.lembretes.criar({
      texto: "Pagar a consulta",
      quando: utc(AMANHA, "16:00"),
      tarefaId: t.id,
    });
    const adiado = await m.lembretes.criar({
      texto: "Separar exames",
      quando: utc(HOJE, "09:55"),
      tarefaId: t.id,
    });
    await m.lembretes.adiar({ ids: [adiado.id], minutos: 10 });
    await m.espelho.sincronizar();
    // 15:00 de amanhã menos 10:10 de hoje (agora + 10 min) são 1730 min.
    expect(m.noGoogleDe(t.id)).toMatchObject({
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 15 },
          { method: "popup", minutes: 1730 },
        ],
      },
    });
    expect(m.noGoogleDe(depois.id)).toMatchObject({
      summary: "Pagar a consulta",
      start: { dateTime: utc(AMANHA, "16:00") },
    });
    expect(m.noGoogle()).toHaveLength(2);
    // O lembrete que é alerta da tarefa conta pelo evento dela.
    expect(m.espelho.chegouAoGoogle(adiado.id)).toBe(true);
  });

  test("o evento da agenda criado com a resposta perdida e apagado aqui sai do Google", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    m.rede.perderRespostas = 1;
    const e = m.agenda.criarEvento({
      calendarioId: m.calendarioDoEspelho()!.id,
      titulo: "Consulta",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
    });
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toHaveLength(1);
    m.agenda.apagarEvento({ id: e.id });
    expect(m.fila()).toEqual([]);
    await m.espelho.sincronizar();
    expect(m.noGoogle()).toEqual([]);
    expect(m.mapa(e.id)).toBeUndefined();
  });

  test("título vazio lá não é adotado e volta; a hora mudada junto é adotada", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.mudarLa(t.id, { summary: "  ", start: sp(AMANHA, "16:00"), end: sp(AMANHA, "16:30") });
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id)).toMatchObject({ titulo: "Dentista", hora: "16:00" });
    expect(m.noGoogleDe(t.id)).toMatchObject({
      summary: "Dentista",
      start: { dateTime: utc(AMANHA, "16:00") },
    });
  });

  test("a tarefa que virou dia inteiro lá volta a ter hora lá", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.mudarLa(t.id, { start: { date: AMANHA }, end: { date: "2026-10-21" } });
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id)).toMatchObject({ venceEm: AMANHA, hora: "15:00" });
    expect(m.noGoogleDe(t.id)).toMatchObject({ start: { dateTime: utc(AMANHA, "15:00") } });
  });

  test("a adoção que a área recusa esquece o que foi: o próximo envio leva o daqui inteiro", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    m.mudarLa(t.id, { start: sp(AMANHA, "16:00"), end: sp(AMANHA, "16:30") });
    const recusa = m.novoEspelho({
      tarefa: () => {
        throw new Error("a tarefa não está aberta");
      },
      lembrete: () => Promise.resolve(),
    });
    await recusa.sincronizar();
    expect(m.tarefa(t.id).hora).toBe("15:00");
    expect(m.noGoogleDe(t.id)).toMatchObject({ start: { dateTime: utc(AMANHA, "15:00") } });
  });

  test("o evento da agenda adota de lá o fim, a descrição e o local", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const e = m.agenda.criarEvento({
      calendarioId: m.calendarioDoEspelho()!.id,
      titulo: "Consulta",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
    });
    await m.espelho.sincronizar();
    const escritasAntes = m.escritas().length;
    m.mudarLa(e.id, { end: sp(AMANHA, "15:30"), description: "levar exames", location: "Clínica" });
    await m.espelho.sincronizar();
    expect(m.agenda.obterEvento({ id: e.id })).toMatchObject({
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:30"),
      descricao: "levar exames",
      local: "Clínica",
    });
    expect(m.escritas()).toHaveLength(escritasAntes);
  });

  test("o lembrete adiado movido lá de volta para a hora de antes volta a agendado nela", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(HOJE, "11:00") });
    await m.lembretes.adiar({ ids: [l.id], minutos: 90 });
    await m.espelho.sincronizar();
    expect(m.noGoogleDe(l.id)).toMatchObject({ start: { dateTime: utc(HOJE, "11:30") } });
    m.mudarLa(l.id, { start: sp(HOJE, "11:00"), end: sp(HOJE, "11:15") });
    await m.espelho.sincronizar();
    expect(m.lembretes.listar({}).find((x) => x.id === l.id)).toMatchObject({
      quando: utc(HOJE, "11:00"),
      estado: "agendado",
      adiadoAte: null,
    });
  });
});

describe("volta 2 da revisão", () => {
  test("o evento da agenda com o título apagado lá não adota e volta ao Google", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    const e = m.agenda.criarEvento({
      calendarioId: m.calendarioDoEspelho()!.id,
      titulo: "Consulta",
      inicio: utc(AMANHA, "14:00"),
      fim: utc(AMANHA, "15:00"),
      diaInteiro: false,
    });
    await m.espelho.sincronizar();
    m.mudarLa(e.id, { summary: "  ", end: sp(AMANHA, "15:30") });
    await m.espelho.sincronizar();
    expect(m.agenda.obterEvento({ id: e.id })).toMatchObject({
      titulo: "Consulta",
      fim: utc(AMANHA, "15:30"),
    });
    expect(m.noGoogleDe(e.id)).toMatchObject({
      summary: "Consulta",
      end: { dateTime: utc(AMANHA, "15:30") },
    });
    expect(m.fila()).toEqual([]);
  });

  test("a duração mudada lá vira a estimativa da tarefa; a que não cabe volta", async () => {
    const m = await montar();
    const t = m.tarefas.criar({ titulo: "Dentista", venceEm: AMANHA, hora: "15:00" });
    await m.espelho.sincronizar();
    const escritasAntes = m.escritas().length;
    m.mudarLa(t.id, { end: sp(AMANHA, "16:15") });
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id)).toMatchObject({ hora: "15:00", duracaoEstimadaMin: 75 });
    expect(m.escritas()).toHaveLength(escritasAntes);

    // Mais de um dia não é estimativa de tarefa: o evento volta a 75 min.
    m.mudarLa(t.id, { end: sp("2026-10-22", "15:00") });
    await m.espelho.sincronizar();
    expect(m.tarefa(t.id).duracaoEstimadaMin).toBe(75);
    expect(m.noGoogleDe(t.id)).toMatchObject({ end: { dateTime: utc(AMANHA, "16:15") } });
  });

  test("o lembrete com evento próprio fica com a duração que você deu lá", async () => {
    const m = await montar();
    const l = await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(AMANHA, "09:00") });
    await m.espelho.sincronizar();
    const escritasAntes = m.escritas().length;
    m.mudarLa(l.id, { end: sp(AMANHA, "09:45") });
    await m.espelho.sincronizar();
    expect(m.escritas()).toHaveLength(escritasAntes);
    // Mudou aqui depois: vai a hora nova, com a duração de lá.
    await m.lembretes.definir({ id: l.id, quando: utc(AMANHA, "10:00") });
    await m.espelho.sincronizar();
    expect(m.noGoogleDe(l.id)).toMatchObject({
      start: { dateTime: utc(AMANHA, "10:00") },
      end: { dateTime: utc(AMANHA, "10:45") },
    });
  });

  test("a passada que termina sem falha zera a espera: a próxima queda recomeça dos 15 s", async () => {
    const m = await montar();
    await m.espelho.sincronizar();
    m.rede.fora = true;
    await m.lembretes.criar({ texto: "Pagar boleto", quando: utc(AMANHA, "09:00") });
    await m.espelho.sincronizar();
    m.passar(ESPERA_INICIAL_MS);
    await m.espelho.sincronizar();
    // A rede voltou, mas o lembrete ainda espera a vez: a passada não manda nada e não falha.
    m.rede.fora = false;
    expect(await m.espelho.sincronizar()).toBe("esperando");
    m.rede.fora = true;
    await m.lembretes.criar({ texto: "Ligar pro banco", quando: utc(AMANHA, "10:00") });
    await m.espelho.sincronizar();
    expect(m.armados.at(-1)).toBe(ESPERA_INICIAL_MS);
  });
});
