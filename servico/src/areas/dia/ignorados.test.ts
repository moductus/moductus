import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  ApresentacaoRotina,
  CONFIG_PADRAO,
  LINHAS_DO_BRIEFING_CURTO,
  METODOS,
  PERGUNTA_DOS_IGNORADOS,
  RotinasDeHoje,
  type Rotina,
} from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { redacaoPelaAlba, VigiaAlba } from "../../agentes/vigias/alba.ts";
import { RepositorioMarcasDosVigias } from "../../agentes/vigias/marcas.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { Catalogo } from "../../ferramentas/catalogo.ts";
import {
  RepositorioNotificacoes,
  ServicoNotificacoes,
  type AvisoWindows,
} from "../../notificacoes/notificacoes.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { RepositorioAgenda, ServicoAgenda } from "../agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../agenda/tarefas-do-dia.ts";
import { RepositorioFoco, ServicoFoco } from "../foco/foco.ts";
import { RepositorioLembretes, ServicoLembretes } from "../lembretes/lembretes.ts";
import { RepositorioTarefas } from "../tarefas/repositorio.ts";
import { ServicoTarefas } from "../tarefas/tarefas.ts";
import { PrimeiraAtividade, RepositorioAtividade, type InicioDoDia } from "./atividade.ts";
import { ServicoBriefing, type ResumoDoAgente } from "./briefing.ts";
import { atendentesDasRotinas } from "./canal.ts";
import { ServicoFechamento } from "./fechamento.ts";
import { RepositorioRotinas, ServicoRotinas } from "./horarios.ts";
import {
  MARCA_PERGUNTA,
  MENSAGEM_JA_RESPONDIDA,
  MENSAGEM_SEM_PERGUNTA,
  ServicoIgnorados,
} from "./ignorados.ts";
import { RelogioDoDia } from "./relogio.ts";
import { RepositorioRegistroRotinas } from "./rotinas.ts";
import { TempoDoDia, somarDias } from "./tempo.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const relogios: RelogioDoDia[] = [];
afterEach(() => {
  for (const r of relogios.splice(0)) r.parar();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** São Paulo não tem horário de verão desde 2019: a hora local é sempre UTC−3. */
const FUSO = "America/Sao_Paulo";
/** Segunda-feira: o primeiro dos dias simulados. */
const SEG = "2026-10-19";
const dia = (n: number) => somarDias(SEG, n);
const sp = (d: string, hora: string) => new Date(`${d}T${hora}:00.000-03:00`);

/**
 * Banco migrado de verdade e o serviço do dia como no main.ts: Agenda, Tarefas, Foco, as rotinas,
 * o briefing pela primeira atividade, o fechamento, a pergunta dos ignorados, as notificações com
 * uma casca que só anota, os lembretes e o vigia da Alba. A Alba não tem provedor: sai o molde,
 * sem modelo e sem rede. Só o `Date` é falso; os dias passam por `vi.setSystemTime`, e o relógio do
 * dia só liga quando o teste pede (`ligarRelogio`).
 */
function montar(resumos: ResumoDoAgente[] = []) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(sp(SEG, "07:00"));
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ignorados-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec("UPDATE agentes SET provedor_id = NULL WHERE id = 'alba'");
  const lerFuso = () => FUSO;
  const agentes = new RepositorioAgentes(db);
  const runtime = new Runtime(
    {
      agentes,
      execucoes: new RepositorioExecucoes(db),
      provedores: new RegistroProvedores(),
      catalogo: new Catalogo([]),
    },
    { execucao: () => {}, agente: () => {} },
  );
  const redigir = redacaoPelaAlba(runtime, agentes, { prazoMs: 2_000 });
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: new RepositorioExecucoes(db),
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => {}, calendarios: () => {} },
  );
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso, notas: { notaParaTarefa: () => null } },
    { tarefas: () => {}, listas: () => {}, lembretes: () => {} },
  );
  const foco = new ServicoFoco(
    new RepositorioFoco(db),
    {
      lerDia: () => ({ ...CONFIG_PADRAO.dia, fuso: FUSO }),
      notificacoes: {
        avisar: () => Promise.reject(new Error("sem avisos do foco neste teste")),
        resolvido: () => Promise.resolve(),
        registrarAcao: () => () => {},
      },
    },
    { mudou: () => {} },
  );
  const relogio = new RelogioDoDia();
  relogios.push(relogio);
  const registro = new RepositorioRegistroRotinas(db);
  const atividade = new RepositorioAtividade(db);
  const marcas = new RepositorioMarcasDosVigias(db);
  const repoRotinas = new RepositorioRotinas(db);
  const mudancasDasRotinas: Rotina[][] = [];
  const rotinas = new ServicoRotinas({
    repo: repoRotinas,
    emitir: (lista) => mudancasDasRotinas.push(lista),
    relogio,
  });
  const mostrados: AvisoWindows[] = [];
  // As notificações perguntam ao fechamento se o dia está encerrado; ele nasce logo depois.
  let fechamento: ServicoFechamento | null = null;
  const notificacoes = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentes.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => ({ ...CONFIG_PADRAO.silencio, foco: false, telaCheia: false }),
      windows: {
        mostrar: async (aviso) => void mostrados.push(aviso),
        retirar: async () => {},
        telaCheia: async () => false,
      },
      diaEncerrado: () => fechamento?.diaEncerrado() ?? false,
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const comum = {
    lerFuso,
    agenda,
    resumos,
    estadoDo: () => "ativo" as const,
    redigir,
    painel: { mostrar: async () => true, aberto: async () => false },
    avisar: (aviso: Parameters<ServicoNotificacoes["avisar"]>[0]) => notificacoes.avisar(aviso),
    relogio,
  };
  const apareceram: ApresentacaoRotina[] = [];
  const f = new ServicoFechamento({
    ...comum,
    tarefas,
    foco,
    registro,
    rotinas: atividade,
    apareceu: (a) => apareceram.push(a),
  });
  fechamento = f;
  const ignorados = new ServicoIgnorados({ lerFuso, registro, marcas, rotinas });
  const briefing = new ServicoBriefing({
    ...comum,
    tarefas,
    registro,
    apareceu: (a) => apareceram.push(a),
    semFechamento: (hoje) => f.semFechamento(hoje),
    curto: () => repoRotinas.porId("briefing")?.curta ?? false,
    ignorados,
  });
  const comecos: Promise<ApresentacaoRotina>[] = [];
  const primeira = new PrimeiraAtividade(atividade, new TempoDoDia(lerFuso), (inicio: InicioDoDia) => {
    const vez = briefing.aparecer(inicio);
    comecos.push(vez);
    return vez;
  });
  const canal = atendentesDasRotinas(f, ignorados);
  /** `rotinas.hoje` pelo canal, conferido pelo schema do contrato. */
  const hoje = () => RotinasDeHoje.parse(canal["rotinas.hoje"](undefined));

  /** Desbloqueia o PC às 08:00 do dia: o briefing aparece, se a rotina dele vale. */
  const manha = async (d: string) => {
    vi.setSystemTime(sp(d, "08:00"));
    const antes = comecos.length;
    primeira.sinal("desbloqueio");
    if (comecos.length === antes) return null;
    return comecos.at(-1)!;
  };
  /** A hora de parar do dia, como o vigia da Alba avisa. */
  const tarde = (d: string) => {
    vi.setSystemTime(sp(d, "18:00"));
    return f.aparecer({ dia: d, previsto: sp(d, "18:00"), atrasado: false });
  };
  /** Um dia em que você não responde nem o briefing nem o fechamento. */
  const ignorar = async (d: string) => {
    const b = await manha(d);
    const fe = await tarde(d);
    return { briefing: b, fechamento: fe };
  };
  /** O relógio do dia com os lembretes e o vigia da Alba, como no main.ts. */
  const ligarRelogio = async () => {
    const agora = new Date();
    vi.useFakeTimers();
    vi.setSystemTime(agora);
    const lembretes = new ServicoLembretes(
      new RepositorioLembretes(db),
      { lerFuso, notificacoes, relogio },
      { mudou: () => {}, hoje: () => {} },
    );
    const lidas = new RepositorioNotificacoes(db);
    const vigia = new VigiaAlba({
      lerFuso,
      abertasEntre: (desde, ate) => tarefas.abertasQueVenciam(desde, ate),
      compromissos: (janela) => agenda.alertasDeCompromissos(janela),
      jaAvisou: (referencia) => lidas.idsDa(referencia).length > 0,
      avisar: (aviso) => notificacoes.avisar(aviso),
      rotinas: atividade,
      briefingNoHorario: () => void primeira.sinal("horario"),
      marcas,
      relogio,
      avisos: { virou: () => {}, fechamento: (h) => void f.aparecer(h) },
    });
    for (const fonte of vigia.fontes) relogio.registrar(fonte);
    relogio.registrar(lembretes);
    relogio.registrar(f);
    relogio.registrar(briefing);
    await relogio.ligar();
    return lembretes;
  };
  const ate = (instante: Date) => vi.advanceTimersByTimeAsync(instante.getTime() - Date.now());
  return {
    db,
    agenda,
    tarefas,
    registro,
    marcas,
    rotinas,
    mudancasDasRotinas,
    fechamento: f,
    briefing,
    ignorados,
    canal,
    hoje,
    primeira,
    apareceram,
    mostrados,
    manha,
    tarde,
    ignorar,
    ligarRelogio,
    ate,
  };
}

describe("fecham sozinhos e reaparecem resumidos", () => {
  test("o briefing sem resposta fecha quando o fechamento aparece; o fechamento, no briefing seguinte", async () => {
    const m = montar();
    const b1 = (await m.manha(dia(0)))!;
    expect(b1.acao).toBeNull();
    const f1 = await m.tarde(dia(0));
    // O fechamento apareceu: o briefing de hoje, sem resposta, fechou sozinho, com a hora.
    expect(m.registro.porId(b1.id)).toMatchObject({
      acao: "ignorado",
      acaoEm: sp(dia(0), "18:00").toISOString(),
    });
    expect(m.registro.porId(f1.id)).toMatchObject({ acao: null });
    expect(ApresentacaoRotina.parse(m.registro.porId(b1.id))).toBeTruthy();

    const b2 = (await m.manha(dia(1)))!;
    expect(m.registro.porId(f1.id)).toMatchObject({
      acao: "ignorado",
      acaoEm: sp(dia(1), "08:00").toISOString(),
    });
    // Nada se acumula: hoje há um briefing só, o de hoje.
    expect(m.hoje()).toEqual({
      briefing: b2,
      fechamento: null,
      diaEncerrado: false,
      pergunta: null,
    });
  });

  test("o respondido não fecha sozinho, e a resposta depois do fechar sozinho vale", async () => {
    const m = montar();
    const b1 = (await m.manha(dia(0)))!;
    m.fechamento.agir({ id: b1.id, acao: "comecar" });
    const f1 = await m.tarde(dia(0));
    expect(m.registro.porId(b1.id)!.acao).toBe("comecar");
    m.fechamento.agir({ id: f1.id, acao: "adiar" });
    await m.manha(dia(1));
    // Adiado é resposta: fica como está (e vira o Ontem, como antes).
    expect(m.registro.porId(f1.id)!.acao).toBe("adiar");

    const b2 = m.registro.doDia("briefing", dia(1))!;
    await m.tarde(dia(1));
    expect(m.registro.porId(b2.id)!.acao).toBe("ignorado");
    expect(m.fechamento.agir({ id: b2.id, acao: "fechar" }).acao).toBe("fechar");
  });

  test("o fechamento ignorado volta resumido no Ontem; a pendência não replanejada vem marcada", async () => {
    const m = montar();
    m.tarefas.concluir({ id: m.tarefas.criar({ titulo: "Mandar o relatório", venceEm: dia(0) }).id });
    const ficou = m.tarefas.criar({ titulo: "Ligar para o contador", venceEm: dia(0) });
    const replanejada = m.tarefas.criar({ titulo: "Separar comprovantes", venceEm: dia(0) });
    await m.manha(dia(0));
    const f1 = await m.tarde(dia(0));
    expect(f1.abertas.map((t) => t.id)).toEqual([ficou.id, replanejada.id]);
    // No fechamento, só uma ganhou outra data ("Amanhã"); a outra ficou sem resposta.
    m.tarefas.adiar({ ids: [replanejada.id], para: "amanha" });

    const b2 = (await m.manha(dia(1)))!;

    expect(b2.linhas[0]).toEqual({
      agenteId: "alba",
      rotulo: "Ontem",
      texto: "1 feita. 1 ficou aberta.",
      tarefaIds: [ficou.id],
    });
    // A não replanejada está no Hoje, na vista das atrasadas, marcada pelo dia em que vencia; a
    // replanejada é de hoje e não entra no Ontem.
    expect(m.tarefas.listar({ vista: "atrasadas" }).map((t) => [t.id, t.venceEm])).toEqual([
      [ficou.id, dia(0)],
    ]);
    expect(m.tarefas.listar({ vista: "hoje" }).map((t) => t.id)).toEqual([replanejada.id]);
    expect(b2.linhas[1]!.tarefaIds).toEqual([replanejada.id]);
  });
});

describe("três dias ignorados seguidos", () => {
  test("a Alba pergunta uma vez, junto do quarto briefing; a pergunta não repete", async () => {
    const m = montar();
    for (const n of [0, 1, 2]) {
      await m.ignorar(dia(n));
      expect(m.hoje().pergunta).toBeNull();
    }
    expect(m.marcas.ler(MARCA_PERGUNTA)).toBeNull();

    // Quinta, 08:00: os briefings de segunda, terça e quarta fecharam sozinhos.
    const b4 = (await m.manha(dia(3)))!;
    const hoje = m.hoje();
    expect(METODOS["rotinas.hoje"].saida.parse(hoje)).toEqual(hoje);
    expect(hoje.briefing).toEqual(b4);
    expect(hoje.pergunta).toEqual({
      agenteId: "alba",
      dia: dia(3),
      texto: PERGUNTA_DOS_IGNORADOS,
      respostas: ["curto", "desligar", "manter"],
    });
    // O mesmo dia ainda espera a resposta; no dia seguinte, sem resposta, ela não volta.
    vi.setSystemTime(sp(dia(3), "17:00"));
    expect(m.hoje().pergunta).not.toBeNull();
    await m.tarde(dia(3));
    for (const n of [4, 5, 6, 7]) {
      await m.ignorar(dia(n));
      expect(m.hoje().pergunta).toBeNull();
    }
    // Ninguém respondeu: nada mudou no briefing.
    expect(m.rotinas.listar()[0]).toMatchObject({ id: "briefing", ativa: true, curta: false });
    expect(() => m.canal["rotinas.responder"]({ resposta: "desligar" })).toThrow(MENSAGEM_SEM_PERGUNTA);
  });

  test("um briefing respondido no meio quebra a sequência; o dia sem briefing, não", async () => {
    const m = montar();
    await m.ignorar(dia(0));
    const b2 = (await m.manha(dia(1)))!;
    m.fechamento.agir({ id: b2.id, acao: "ajustar" });
    await m.tarde(dia(1));
    await m.ignorar(dia(2));
    await m.ignorar(dia(3));
    await m.manha(dia(4));
    // Os 3 antes de sexta: quinta e quarta ignorados, terça respondido.
    expect(m.hoje().pergunta).toBeNull();
    await m.tarde(dia(4));
    // Sábado e domingo fora dos dias de trabalho: não há briefing, e a sequência segue na segunda.
    m.rotinas.definir({ id: "briefing", diasSemana: [1, 2, 3, 4, 5] });
    expect(await m.manha(dia(5))).toBeNull();
    expect(await m.manha(dia(6))).toBeNull();
    await m.manha(dia(7));
    expect(m.hoje().pergunta).toMatchObject({ dia: dia(7) });
  });

  test("Mais curto: grava a escolha e o briefing seguinte sai com 3 linhas", async () => {
    const resumos: ResumoDoAgente[] = [
      { agenteId: "tula", nome: "Tula", resumoDoDia: () => "Semana em dia: R$ 420 de R$ 600." },
      { agenteId: "nuno", nome: "Nuno", resumoDoDia: () => "2 PRs esperam seu review." },
      { agenteId: "faina", nome: "Faina", resumoDoDia: () => "1 aprovação: organizar Downloads." },
    ];
    const m = montar(resumos);
    for (const n of [0, 1, 2]) await m.ignorar(dia(n));
    const b4 = (await m.manha(dia(3)))!;
    expect(b4.linhas.map((l) => l.agenteId)).toEqual(["tula", "nuno", "faina"]);
    m.tarefas.criar({ titulo: "Fatura do cartão", venceEm: dia(4), prioridade: 3 });

    const briefing = m.canal["rotinas.responder"]({ resposta: "curto" });

    expect(briefing).toMatchObject({ id: "briefing", ativa: true, curta: true });
    expect(m.mudancasDasRotinas.at(-1)).toEqual(m.rotinas.listar());
    expect(JSON.parse(m.marcas.ler(MARCA_PERGUNTA)!)).toMatchObject({
      dia: dia(3),
      resposta: "curto",
      respondidaEm: sp(dia(3), "08:00").toISOString(),
    });
    expect(m.hoje().pergunta).toBeNull();
    expect(() => m.canal["rotinas.responder"]({ resposta: "manter" })).toThrow(MENSAGEM_JA_RESPONDIDA);
    // Com o carimbo do usuário, como em Configurações › O dia.
    expect(m.db.prepare("SELECT origem, agente_id FROM rotinas WHERE id = 'briefing'").get()).toEqual({
      origem: "usuario",
      agente_id: null,
    });

    await m.tarde(dia(3));
    const b5 = (await m.manha(dia(4)))!;
    expect(b5.linhas).toHaveLength(LINHAS_DO_BRIEFING_CURTO);
    expect(b5.linhas.map((l) => l.agenteId)).toEqual(["alba", "tula", "nuno"]);
  });

  test("Manter: grava a escolha e nada muda", async () => {
    const m = montar();
    for (const n of [0, 1, 2]) await m.ignorar(dia(n));
    await m.manha(dia(3));
    expect(m.canal["rotinas.responder"]({ resposta: "manter" })).toMatchObject({ ativa: true, curta: false });
    expect(m.mudancasDasRotinas).toEqual([]);
    expect(JSON.parse(m.marcas.ler(MARCA_PERGUNTA)!)).toMatchObject({ resposta: "manter" });
  });

  test("Desligar: o briefing não aparece mais, e os avisos de prazo continuam", async () => {
    const m = montar();
    for (const n of [0, 1, 2]) await m.ignorar(dia(n));
    await m.manha(dia(3));
    expect(m.canal["rotinas.responder"]({ resposta: "desligar" })).toMatchObject({
      id: "briefing",
      ativa: false,
    });
    await m.tarde(dia(3));

    // Sexta: o desbloqueio não abre briefing nenhum.
    vi.setSystemTime(sp(dia(4), "07:30"));
    const lembretes = await m.ligarRelogio();
    await lembretes.criar({ texto: "Pagar o boleto", quando: sp(dia(4), "14:45").toISOString() });
    m.agenda.criarEvento({
      titulo: "Reunião com a Ana",
      inicio: sp(dia(4), "15:00").toISOString(),
      fim: sp(dia(4), "16:00").toISOString(),
      diaInteiro: false,
      alertas: [10],
    });
    expect(await m.manha(dia(4))).toBeNull();
    expect(m.registro.doDia("briefing", dia(4))).toBeNull();

    await m.ate(sp(dia(4), "15:00"));
    const titulos = m.mostrados.map((a) => a.titulo);
    expect(titulos).toContain("Pagar o boleto");
    expect(titulos).toContain("Reunião com a Ana");
    // O fechamento continua no horário dele.
    await m.ate(sp(dia(4), "18:00"));
    expect(m.registro.doDia("fechamento", dia(4))).not.toBeNull();
  });
});
