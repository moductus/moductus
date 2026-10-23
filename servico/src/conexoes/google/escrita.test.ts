import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Aprovacao, ChamadaFerramenta } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { autorizarPorAprovacao } from "../../agentes/autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { MENSAGEM_NEGADO, RepositorioAprovacoes, ServicoAprovacoes } from "../../aprovacoes/aprovacoes.ts";
import { RepositorioAgenda, ServicoAgenda } from "../../areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../../areas/agenda/tarefas-do-dia.ts";
import { TempoDoDia } from "../../areas/dia/tempo.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { ferramentasAgenda } from "../../ferramentas/agenda/agenda.ts";
import { Catalogo } from "../../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import {
  ESCOPO_ESCREVER_NOS_OUTROS,
  ESCOPOS_AO_CONECTAR,
  ESCOPOS_PARA_ESCREVER,
  type ClienteOAuth,
} from "./cliente.ts";
import {
  EscritaGoogleAgenda,
  MENSAGEM_NAO_E_DE_FORA,
  MENSAGEM_REPETE_NO_GOOGLE,
  mensagemSoVer,
} from "./escrita.ts";
import { abrirGoogleFalso, credenciaisNaMemoria, type GoogleFalso } from "./fixtures/google-falso.ts";
import {
  AVISO_ESCRITA_ESCOPO,
  AVISO_ESCRITA_NEGADA,
  CREDENCIAL_GOOGLE,
  ServicoGoogleAgenda,
} from "./google-agenda.ts";
import { LeituraGoogleAgenda, RepositorioLeituraGoogle } from "./leitura.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const googles: GoogleFalso[] = [];
/** As leituras que a escrita disparou: terminam antes de o banco fechar. */
const leituras: Promise<unknown>[] = [];
afterEach(async () => {
  await Promise.all(leituras.splice(0));
  vi.restoreAllMocks();
  for (const g of googles.splice(0)) await g.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const CLIENTE: ClienteOAuth = { id: "teste.apps.googleusercontent.com", segredo: "segredo-de-teste" };
const CONTA = "voce@gmail.com";
const FUSO = "America/Sao_Paulo";
/** Segunda-feira, 19/10/2026, 08:00 em São Paulo (UTC−3). */
const HOJE = "2026-10-19";
const AGORA = new Date(`${HOJE}T08:00:00.000-03:00`);
const TRABALHO = "trabalho@group.calendar.google.com";
const FERIADOS = "feriados@group.v.calendar.google.com";
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

/**
 * Banco migrado de verdade, o Google falso em 127.0.0.1 com o principal, o "Trabalho" (que você
 * edita) e os feriados (que você só vê), a conexão feita pelo fluxo de verdade com os três escopos,
 * a leitura, a agenda, o catálogo e o runtime com a Alba num provedor falso e o cartão de verdade.
 */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-escrita-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-alba' WHERE id = 'alba';
  `);
  const google = await abrirGoogleFalso(CLIENTE, CONTA);
  googles.push(google);
  google.calendarios.push(
    { id: TRABALHO, summary: "Trabalho", accessRole: "writer" },
    { id: FERIADOS, summary: "Feriados", accessRole: "reader" },
  );
  google.gravarEvento(TRABALHO, {
    id: "daily",
    summary: "Daily",
    start: { dateTime: "2026-10-19T09:30:00-03:00", timeZone: FUSO },
    end: { dateTime: "2026-10-19T10:00:00-03:00", timeZone: FUSO },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  });
  google.gravarEvento(TRABALHO, {
    id: "revisao",
    summary: "Revisão",
    start: { dateTime: "2026-10-20T14:00:00-03:00", timeZone: FUSO },
    end: { dateTime: "2026-10-20T15:00:00-03:00", timeZone: FUSO },
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const agora = () => AGORA;
  const credenciais = credenciaisNaMemoria();
  let leitura: LeituraGoogleAgenda | null = null;
  const conexao = new ServicoGoogleAgenda({
    conexoes: new RepositorioConexoes(db),
    credenciais,
    abrir: { endereco: (url) => google.abrir.endereco(url) },
    avisar: (c) => leitura?.aoMudarConexao(c),
    clienteDoAutor: CLIENTE,
    enderecos: google.enderecos,
    agora,
  });
  const repoLeitura = new RepositorioLeituraGoogle(db);
  leitura = new LeituraGoogleAgenda({
    google: conexao,
    repo: repoLeitura,
    lerFuso: () => FUSO,
    avisos: { eventos: () => undefined, calendarios: () => undefined, erro: () => undefined },
    enderecos: google.enderecos,
    agora,
  });
  await conexao.ligar();
  await leitura.atualizar();
  // A Alba lê o "Trabalho": os eventos dele entram no cache.
  db.prepare("UPDATE calendarios SET ler = 1 WHERE id_externo = ?").run(TRABALHO);
  await leitura.atualizar();
  let escritas = 0;
  const escrita = new EscritaGoogleAgenda({
    google: conexao,
    repo: repoLeitura,
    lerFuso: () => FUSO,
    aoEscrever: () => {
      escritas++;
      if (leitura) leituras.push(leitura.atualizar());
    },
    enderecos: google.enderecos,
  });
  const execucoes = new RepositorioExecucoes(db);
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: execucoes,
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => undefined, calendarios: () => undefined },
    { agora },
  );
  const catalogo = new Catalogo(ferramentasAgenda(agenda, new TempoDoDia(() => FUSO, agora), escrita));
  const repositorioAprovacoes = new RepositorioAprovacoes(db);
  const aprovacoes = new ServicoAprovacoes(repositorioAprovacoes, { aprovacao: () => {}, regras: () => {} });
  const falso = new ProvedorFalso("p-alba");
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
      autorizar: autorizarPorAprovacao(aprovacoes),
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora, fuso: FUSO });

  /** A Alba chama a ferramenta; o pedido fica rodando até o cartão ser decidido. */
  const alba = (passo: PassoRoteiro) => {
    falso.roteirizar([passo, ...roteiros.resposta("Pronto.")]);
    return runtime
      .executar({ agenteId: "alba", gatilho: "mensagem", mensagens: [{ papel: "usuario", texto: "marca" }] })
      .then((r): ChamadaFerramenta => historico.obter({ id: r.execucao.id }).chamadas[0]!);
  };
  /** O cartão que a chamada abriu no dock. */
  const cartao = async (): Promise<Aprovacao> => {
    let pendente: Aprovacao | undefined;
    await vi.waitFor(() => {
      pendente = repositorioAprovacoes.pendentes()[0];
      expect(pendente).toBeDefined();
    });
    return pendente!;
  };
  const decidir = (a: Aprovacao, decisao: "permitir" | "negar") => aprovacoes.decidir({ id: a.id, decisao });
  const idDaqui = (idExterno: string) =>
    (db.prepare("SELECT id FROM calendarios WHERE id_externo = ?").get(idExterno) as { id: string }).id;
  const eventoDaqui = (idExterno: string) =>
    db.prepare("SELECT id, titulo, inicio, fim FROM eventos WHERE id_externo = ?").get(idExterno) as
      { id: string; titulo: string; inicio: string; fim: string } | undefined;
  const escoposGuardados = async () =>
    (JSON.parse((await credenciais.ler(CREDENCIAL_GOOGLE)) ?? "{}") as { escopos: string[] }).escopos;
  /** Só as escritas em eventos dos outros calendários (o "Moductus" não entra neste teste). */
  const escritasNoGoogle = () => google.escritas.filter((e) => e.rota.includes("/events"));
  return {
    db,
    google,
    conexao,
    log,
    alba,
    cartao,
    decidir,
    idDaqui,
    eventoDaqui,
    escoposGuardados,
    escritasNoGoogle,
    repositorioAprovacoes,
    escritas: () => escritas,
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;

const criarEm = (m: Montado, extra: Record<string, unknown> = {}): PassoRoteiro => ({
  tipo: "ferramenta",
  nome: "agenda__criar_evento_em",
  entrada: {
    calendarioId: m.idDaqui(TRABALHO),
    titulo: "Reunião com a Ana",
    quando: { dia: "2026-10-22", hora: "15:00" },
    local: "Sala 3",
    ...extra,
  },
});

const erroDe = (c: ChamadaFerramenta) => (c.resultado as { ok: boolean; erro?: string }).erro;

describe("criar nos outros calendários", () => {
  test("sem aprovação nada é escrito, e negar o cartão não pede o escopo", async () => {
    const m = await montar();
    const chamada = m.alba(criarEm(m));
    const cartao = await m.cartao();
    expect(cartao.descricao).toBe(
      'Vou criar "Reunião com a Ana" no calendário "Trabalho" do Google, quinta, 22/10/2026, das 15:00 às 16:00; não se desfaz por aqui; na primeira vez, o Google pede no navegador a permissão de editar eventos.\n\nLocal: Sala 3',
    );
    expect(cartao.acao).toMatchObject({
      rotulo: "Criar em Trabalho",
      rotuloRecusar: "Não criar",
      desfazivel: false,
    });
    // Pendente, nada foi ao Google nem ao navegador.
    expect(m.escritasNoGoogle()).toEqual([]);
    expect(m.google.autorizacoes).toHaveLength(1);

    await m.decidir(cartao, "negar");
    expect(erroDe(await chamada)).toBe(MENSAGEM_NEGADO);
    expect(m.escritasNoGoogle()).toEqual([]);
    expect(m.google.autorizacoes).toHaveLength(1);
    expect(await m.escoposGuardados()).not.toContain(ESCOPO_ESCREVER_NOS_OUTROS);
    expect(m.escritas()).toBe(0);
  });

  test("aprovado na primeira vez, refaz o consentimento com os quatro escopos, escreve e lê de volta", async () => {
    const m = await montar();
    const chamada = m.alba(criarEm(m));
    await m.decidir(await m.cartao(), "permitir");
    const feita = await chamada;
    expect(feita.resultado).toMatchObject({
      ok: true,
      valor: {
        calendario: "Trabalho",
        titulo: "Reunião com a Ana",
        inicio: sp("2026-10-22", "15:00"),
        fim: sp("2026-10-22", "16:00"),
        diaInteiro: false,
      },
    });
    const pedido = m.google.autorizacoes.at(-1)!;
    expect(m.google.autorizacoes).toHaveLength(2);
    expect(pedido.searchParams.get("scope")?.split(" ")).toEqual([...ESCOPOS_PARA_ESCREVER]);
    expect(pedido.searchParams.get("prompt")).toBe("consent");
    expect(await m.escoposGuardados()).toEqual([...ESCOPOS_PARA_ESCREVER]);
    expect(m.conexao.escreveNosOutros()).toBe(true);
    expect(m.conexao.conexao()).toMatchObject({ estado: "ligada", conta: CONTA });

    const { idExterno } = (feita.resultado as { valor: { idExterno: string } }).valor;
    const noGoogle = m.google.eventosDe(TRABALHO).find((e) => e.id === idExterno);
    expect(noGoogle).toMatchObject({
      summary: "Reunião com a Ana",
      location: "Sala 3",
      start: { dateTime: sp("2026-10-22", "15:00"), timeZone: FUSO },
      end: { dateTime: sp("2026-10-22", "16:00"), timeZone: FUSO },
      reminders: { useDefault: true },
    });
    // A leitura traz o evento para o cache da agenda.
    await vi.waitFor(() => expect(m.eventoDaqui(idExterno)?.titulo).toBe("Reunião com a Ana"));

    // Da segunda vez a permissão já está lá: o cartão não avisa do navegador, e ele não abre.
    const outra = m.alba(criarEm(m, { titulo: "1:1", local: undefined }));
    const cartao = await m.cartao();
    expect(cartao.descricao).not.toContain("navegador");
    await m.decidir(cartao, "permitir");
    expect((await outra).resultado).toMatchObject({ ok: true });
    expect(m.google.autorizacoes).toHaveLength(2);
    // Nenhum token no log.
    expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/acesso-|renovacao-/);
  });

  test("consentimento negado no navegador: nada escrito e a conexão segue lendo", async () => {
    const m = await montar();
    m.google.navegacao = "negar";
    const chamada = m.alba(criarEm(m));
    await m.decidir(await m.cartao(), "permitir");
    expect(erroDe(await chamada)).toBe(`agenda.criar_evento_em falhou: ${AVISO_ESCRITA_NEGADA}`);
    expect(m.escritasNoGoogle()).toEqual([]);
    expect(m.conexao.conexao().estado).toBe("ligada");
    expect(await m.escoposGuardados()).toEqual([...ESCOPOS_AO_CONECTAR]);
  });

  test("a permissão de editar desmarcada na tela do Google não escreve nem troca a credencial", async () => {
    const m = await montar();
    m.google.escoposConcedidos = [...ESCOPOS_AO_CONECTAR];
    const chamada = m.alba(criarEm(m));
    await m.decidir(await m.cartao(), "permitir");
    expect(erroDe(await chamada)).toBe(`agenda.criar_evento_em falhou: ${AVISO_ESCRITA_ESCOPO}`);
    expect(m.escritasNoGoogle()).toEqual([]);
    expect(await m.escoposGuardados()).toEqual([...ESCOPOS_AO_CONECTAR]);
    // A credencial antiga continua valendo: nada foi revogado.
    expect(m.google.revogados).toEqual([]);
  });

  test('calendário que você só vê, o local e o "Moductus" não viram cartão', async () => {
    const m = await montar();
    const feriados = await m.alba(criarEm(m, { calendarioId: m.idDaqui(FERIADOS) }));
    expect(erroDe(feriados)).toBe(`agenda.criar_evento_em falhou: ${mensagemSoVer("Feriados")}`);
    const local = await m.alba(criarEm(m, { calendarioId: "local" }));
    expect(erroDe(local)).toBe(`agenda.criar_evento_em falhou: ${MENSAGEM_NAO_E_DE_FORA}`);
    expect(m.repositorioAprovacoes.pendentes()).toEqual([]);
    expect(m.escritasNoGoogle()).toEqual([]);
  });
});

describe("mudar nos outros calendários", () => {
  test("o cartão diz o que muda e onde; aprovado, só os campos pedidos vão no PATCH", async () => {
    const m = await montar();
    const revisao = m.eventoDaqui("revisao")!;
    const chamada = m.alba({
      tipo: "ferramenta",
      nome: "agenda__mudar_evento_em",
      entrada: { id: revisao.id, quando: { dia: "2026-10-21" } },
    });
    const cartao = await m.cartao();
    expect(cartao.descricao).toBe(
      'Vou mudar "Revisão" no calendário "Trabalho" do Google: passa de terça, 20/10/2026, das 14:00 às 15:00 para quarta, 21/10/2026, das 14:00 às 15:00. Não se desfaz por aqui; na primeira vez, o Google pede no navegador a permissão de editar eventos.',
    );
    expect(cartao.acao.rotulo).toBe("Mudar em Trabalho");
    await m.decidir(cartao, "permitir");
    expect((await chamada).resultado).toMatchObject({
      ok: true,
      valor: {
        evento: { titulo: "Revisão", inicio: sp("2026-10-21", "14:00"), fim: sp("2026-10-21", "15:00") },
        antes: { inicio: sp("2026-10-20", "14:00") },
      },
    });
    expect(m.escritasNoGoogle()).toEqual([
      {
        metodo: "PATCH",
        rota: `/calendars/${encodeURIComponent(TRABALHO)}/events/revisao`,
        corpo: {
          start: { dateTime: sp("2026-10-21", "14:00"), timeZone: FUSO, date: null },
          end: { dateTime: sp("2026-10-21", "15:00"), timeZone: FUSO, date: null },
        },
      },
    ]);
    await vi.waitFor(() => expect(m.eventoDaqui("revisao")?.inicio).toBe(sp("2026-10-21", "14:00")));
  });

  test("o horário de um evento que se repete não muda por aqui; o título muda em todas", async () => {
    const m = await montar();
    const daily = m.eventoDaqui("daily")!;
    const horario = await m.alba({
      tipo: "ferramenta",
      nome: "agenda__mudar_evento_em",
      entrada: { id: daily.id, quando: { dia: "hoje", hora: "10:00" } },
    });
    expect(erroDe(horario)).toBe(`agenda.mudar_evento_em falhou: ${MENSAGEM_REPETE_NO_GOOGLE}`);
    expect(m.repositorioAprovacoes.pendentes()).toEqual([]);

    const titulo = m.alba({
      tipo: "ferramenta",
      nome: "agenda__mudar_evento_em",
      entrada: { id: daily.id, titulo: "Daily do time" },
    });
    const cartao = await m.cartao();
    expect(cartao.descricao).toMatch(
      /^Vou mudar "Daily", em todas as repetições, no calendário "Trabalho" do Google: o título vira "Daily do time"\./,
    );
    await m.decidir(cartao, "negar");
    expect(erroDe(await titulo)).toBe(MENSAGEM_NEGADO);
    expect(m.escritasNoGoogle()).toEqual([]);
  });
});
