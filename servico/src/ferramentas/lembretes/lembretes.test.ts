import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG_PADRAO, Lembrete, type ChamadaFerramenta, type MudancaLembretes } from "@moductus/contrato";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { DE_FABRICA } from "../../agentes/de-fabrica.ts";
import { MENSAGENS_DESFAZER, RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { classificadorPeloRuntime, Roteador } from "../../agentes/roteador.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { RepositorioAgenda, ServicoAgenda } from "../../areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../../areas/agenda/tarefas-do-dia.ts";
import { TempoDoDia } from "../../areas/dia/tempo.ts";
import { RepositorioFoco, ServicoFoco } from "../../areas/foco/foco.ts";
import {
  MENSAGEM_DESFAZER_DE_OUTRO,
  MENSAGEM_DESFAZER_MUDOU,
  RepositorioLembretes,
  ServicoLembretes,
  type NotificacoesDoLembrete,
} from "../../areas/lembretes/lembretes.ts";
import { RepositorioNotas, ServicoNotas } from "../../areas/notas/notas.ts";
import { RepositorioTarefas } from "../../areas/tarefas/repositorio.ts";
import { ServicoTarefas } from "../../areas/tarefas/tarefas.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { escritaSemGoogle } from "../../conexoes/google/fixtures/google-falso.ts";
import { RepositorioConversas, ServicoConversas } from "../../conversas/conversas.ts";
import { RepositorioNotificacoes, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { ferramentasAgenda } from "../agenda/agenda.ts";
import { Catalogo } from "../catalogo.ts";
import { ferramenta } from "../ferramenta.ts";
import { ferramentasFoco } from "../foco/foco.ts";
import { ferramentasNotas } from "../notas/notas.ts";
import { ferramentasTarefas } from "../tarefas/tarefas.ts";
import { MENSAGEM_DIA_E_HORA, MENSAGEM_HORARIO_PASSOU, ferramentasLembretes } from "./lembretes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** São Paulo, UTC−3 o ano todo: sexta, 09/10/2026, 14:00 é 17:00Z. */
const FUSO = "America/Sao_Paulo";
const INICIO = Date.parse("2026-10-09T14:00:00.000-03:00");

/** Uma ferramenta de outra área, para provar que a Alba não a vê nem a chama. */
const lidasDoNuno = { n: 0 };
const doNuno = ferramenta({
  nome: "sessoes.listar",
  descricao: "As sessões de IA",
  entrada: z.object({}),
  efeito: "leitura",
  executar: () => {
    lidasDoNuno.n++;
    return [];
  },
});
beforeEach(() => {
  lidasDoNuno.n = 0;
});

/**
 * Banco migrado de verdade, as áreas do dia de verdade, o catálogo da Alba como o serviço monta (com
 * uma ferramenta do Nuno ao lado), o runtime e as conversas de verdade e um provedor falso na Alba.
 * As notificações só anotam; nenhum modelo, nenhuma rede.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-lembretes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso da Alba');
    UPDATE agentes SET provedor_id = 'p-alba' WHERE id = 'alba';
  `);
  const relogio = { ms: INICIO };
  const agora = () => new Date(relogio.ms);
  const tempo = new TempoDoDia(() => FUSO, agora);
  // As notificações de verdade, com uma casca que não mostra nada; o teste anota o que sai.
  const agentesDoTime = new RepositorioAgentes(db);
  const reais = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentesDoTime.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => CONFIG_PADRAO.silencio,
      windows: {
        mostrar: () => Promise.resolve(),
        retirar: () => Promise.resolve(),
        telaCheia: () => Promise.resolve(false),
      },
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const resolvidos: string[] = [];
  /** Roda uma vez no meio da espera de tirar um aviso: o que acontece enquanto a área espera. */
  const noMeio: { acao: (() => Promise<void>) | null } = { acao: null };
  const notificacoes: NotificacoesDoLembrete = {
    avisar: (aviso) => reais.avisar(aviso),
    resolvido: async (referencia) => {
      resolvidos.push(referencia);
      const acao = noMeio.acao;
      noMeio.acao = null;
      // Como o timer do relógio: num tique próprio, depois de quem esperava já ter seguido.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await acao?.();
      return reais.resolvido(referencia);
    },
    registrarAcao: (prefixo, acao) => reais.registrarAcao(prefixo, acao),
  };
  const avisos: MudancaLembretes[] = [];
  const lembretes = new ServicoLembretes(
    new RepositorioLembretes(db),
    { lerFuso: () => FUSO, notificacoes },
    { mudou: (m) => avisos.push(m), hoje: () => {} },
    { agora },
  );
  const notas = new ServicoNotas(new RepositorioNotas(db), { mudou: () => {} }, { agora });
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => FUSO, notas },
    { tarefas: () => {}, listas: () => {}, lembretes: () => {} },
    { agora },
  );
  const execucoes = new RepositorioExecucoes(db);
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: execucoes,
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => {}, calendarios: () => {} },
    { agora },
  );
  const foco = new ServicoFoco(
    new RepositorioFoco(db),
    {
      lerDia: () => ({
        fuso: FUSO,
        foco: { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 },
      }),
      notificacoes,
    },
    { mudou: () => {} },
    { agora },
  );
  const catalogo = new Catalogo([
    doNuno,
    ...ferramentasAgenda(agenda, tempo, escritaSemGoogle()),
    ...ferramentasTarefas(tarefas, tempo),
    ...ferramentasLembretes(lembretes, tempo),
    ...ferramentasFoco(foco, tempo),
    ...ferramentasNotas(notas),
  ]);
  const falso = new ProvedorFalso("p-alba");
  const agentes = agentesDoTime;
  const runtime = new Runtime(
    {
      agentes,
      execucoes,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora, fuso: FUSO });
  const conversas = new ServicoConversas(
    {
      repo: new RepositorioConversas(db),
      agentes,
      runtime,
      roteador: new Roteador(classificadorPeloRuntime(runtime, agentes)),
    },
    { conversa: () => {}, mensagem: () => {}, parcial: () => {} },
    { agora },
  );
  /** Uma execução da Alba que faz as chamadas na ordem; volta as chamadas gravadas. */
  const rodar = async (...passos: PassoRoteiro[]): Promise<ChamadaFerramenta[]> => {
    falso.roteirizar([...passos, ...roteiros.resposta("Feito.")]);
    const r = await runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "pode fazer" }],
    });
    expect(r.execucao.estado).toBe("ok");
    return historico.obter({ id: r.execucao.id }).chamadas;
  };
  const vivo = (id: string) =>
    db.prepare("SELECT 1 FROM lembretes WHERE id = ? AND apagado_em IS NULL").get(id);
  return {
    db,
    relogio,
    lembretes,
    tarefas,
    historico,
    conversas,
    falso,
    catalogo,
    avisos,
    resolvidos,
    noMeio,
    rodar,
    vivo,
  };
}

const chamar = (nome: string, entrada: unknown): PassoRoteiro => ({ tipo: "ferramenta", nome, entrada });

/** O valor que a chamada devolveu ao modelo; falha alto se ela deu errado. */
function valor<T>(chamada: ChamadaFerramenta | undefined, schema: z.ZodType<T>): T {
  const resultado = chamada?.resultado as { ok: boolean; valor?: unknown; erro?: string } | undefined;
  expect(resultado?.ok, resultado?.erro).toBe(true);
  return schema.parse(resultado?.valor);
}

const erroDe = (chamada: ChamadaFerramenta | undefined) => (chamada?.resultado as { erro?: string }).erro;

/** Os avisos do desfazer saem depois da transação dele. */
const depoisDaTransacao = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("na conversa com a Alba", () => {
  test("“me lembra de ligar pro banco amanhã 15h” cria o lembrete pela ferramenta, fica no histórico da Alba e desfaz", async () => {
    const m = montar();
    m.falso.roteirizar([
      chamar("lembretes__criar", { texto: "Ligar pro banco", dia: "amanha", hora: "15:00" }),
      ...roteiros.resposta("Te lembro amanhã às 15h."),
    ]);
    const conversa = m.conversas.abrir({ agenteId: "alba" });
    await m.conversas.enviar({
      conversaId: conversa.id,
      conteudo: "me lembra de ligar pro banco amanhã 15h",
    });
    await m.conversas.ocioso();

    // O modelo recebeu as ferramentas das áreas dela, e nenhuma de outra.
    const oferecidas = m.falso.pedidos[0]!.ferramentas.map((f) => f.nome);
    expect(oferecidas).toContain("lembretes__criar");
    // A lista dela no banco já tem as listas de tarefas (migração alba-listas).
    expect(oferecidas).toContain("listas__listar");
    expect(oferecidas).not.toContain("sessoes__listar");
    expect(oferecidas).not.toContain("agenda__aplicar_sugestao");

    // Amanhã, 15:00 em São Paulo, pela conta do serviço.
    const [lembrete] = m.lembretes.listar({});
    expect(lembrete).toMatchObject({
      texto: "Ligar pro banco",
      quando: "2026-10-10T18:00:00.000Z",
      estado: "agendado",
      canal: "windows",
      origem: "agente",
      agenteId: "alba",
    });

    // O histórico da Alba mostra a chamada com o desfazer.
    const execucao = m.historico.obter({ id: lembrete!.execucaoId! });
    expect(execucao.agenteId).toBe("alba");
    const [criar] = execucao.chamadas;
    expect(criar).toMatchObject({ ferramenta: "lembretes.criar", efeito: "interno", desfeitaEm: null });
    expect(criar!.desfazerAte).not.toBeNull();
    expect(Lembrete.parse(valor(criar, z.unknown())).id).toBe(lembrete!.id);

    m.relogio.ms += 60_000;
    m.historico.desfazer({ chamadaId: criar!.id });
    expect(m.vivo(lembrete!.id)).toBeUndefined();
    expect(m.lembretes.listar({})).toEqual([]);
    await depoisDaTransacao();
    expect(m.avisos.at(-1)).toEqual({ lembretes: [], removidos: [lembrete!.id] });
  });

  test("a Alba não chama ferramenta de outra área nem pelo nome", async () => {
    const m = montar();
    const chamadas = await m.rodar(chamar("sessoes__listar", {}));
    // Fora do escopo não roda nem entra no histórico dela.
    expect(chamadas).toEqual([]);
    expect(lidasDoNuno.n).toBe(0);
  });

  test("o recorte de cada agente de fábrica: a Alba só as áreas do dia; o Nuno só o tarefas.criar delas", () => {
    const m = montar();
    const nomes = (id: "alba" | "nuno") =>
      m.catalogo.doAgente(DE_FABRICA[id].ferramentas).ferramentas.map((f) => f.nome);
    const alba = nomes("alba");
    expect(alba).toContain("listas.listar");
    expect(alba.every((n) => /^(agenda|tarefas|listas|lembretes|foco|notas)\./.test(n))).toBe(true);
    expect(alba).not.toContain("agenda.aplicar_sugestao");
    expect(alba.filter((n) => n.startsWith("tarefas."))).toEqual([
      "tarefas.adiar",
      "tarefas.cancelar",
      "tarefas.concluir",
      "tarefas.criar",
      "tarefas.definir",
      "tarefas.listar",
      "tarefas.obter",
    ]);
    expect(nomes("nuno")).toEqual(["sessoes.listar", "tarefas.criar"]);
  });
});

describe("lembretes.criar", () => {
  test("hoje no fuso do usuário; horário que já passou volta ao modelo sem criar nada", async () => {
    const m = montar();
    const [cedo, tarde] = await m.rodar(
      chamar("lembretes__criar", { texto: "Café", dia: "hoje", hora: "09:00" }),
      chamar("lembretes__criar", { texto: "Remédio", dia: "hoje", hora: "21:30" }),
    );
    expect(erroDe(cedo)).toBe(`lembretes.criar falhou: ${MENSAGEM_HORARIO_PASSOU}`);
    expect(valor(tarde, Lembrete).quando).toBe("2026-10-10T00:30:00.000Z");
    expect(m.lembretes.listar({}).map((l) => l.texto)).toEqual(["Remédio"]);
  });

  test("tocar não impede o desfazer; você mexer depois, sim", async () => {
    const m = montar();
    const [a, b] = await m.rodar(
      chamar("lembretes__criar", { texto: "A", dia: "hoje", hora: "14:30" }),
      chamar("lembretes__criar", { texto: "B", dia: "hoje", hora: "15:00" }),
    );
    const idA = valor(a, Lembrete).id;
    const idB = valor(b, Lembrete).id;
    // O relógio tocou o A (sem trocar quem escreveu); o usuário mudou o texto do B.
    m.relogio.ms = Date.parse("2026-10-09T14:30:00.000-03:00");
    await m.lembretes.conferir({ agora: new Date(m.relogio.ms), ausencia: null });
    expect(m.lembretes.listar({ estados: ["disparado"] }).map((l) => l.id)).toEqual([idA]);
    await m.lembretes.definir({ id: idB, texto: "B do usuário" });

    m.historico.desfazer({ chamadaId: a!.id });
    expect(m.vivo(idA)).toBeUndefined();
    expect(() => m.historico.desfazer({ chamadaId: b!.id })).toThrow(
      MENSAGENS_DESFAZER.areaRecusou(MENSAGEM_DESFAZER_DE_OUTRO),
    );
    expect(m.vivo(idB)).toBeDefined();
    await depoisDaTransacao();
    // O aviso do Windows do que tocou sai junto.
    expect(m.resolvidos.some((r) => r.startsWith(`lembrete:${idA}@`))).toBe(true);
  });
});

describe("mudar, adiar, concluir e cancelar se desfazem", () => {
  test("cada um volta o lembrete como estava, inclusive da lixeira", async () => {
    const m = montar();
    const [criar] = await m.rodar(chamar("lembretes__criar", { texto: "Água", dia: "hoje", hora: "16:00" }));
    const id = valor(criar, Lembrete).id;
    const antes = m.lembretes.listar({})[0]!;

    const [definir, adiar, concluir] = await m.rodar(
      chamar("lembretes__definir", { id, texto: "Beber água", dia: "amanha", hora: "08:00" }),
      chamar("lembretes__adiar", { ids: [id], minutos: 30 }),
      chamar("lembretes__concluir", { ids: [id] }),
    );
    expect(definir!.resultado).toMatchObject({ ok: true });
    expect(adiar!.resultado).toMatchObject({ ok: true });
    // O de uma vez concluído vai para a lixeira.
    expect(m.vivo(id)).toBeUndefined();

    // Do último para o primeiro, cada passo volta ao anterior.
    m.historico.desfazer({ chamadaId: concluir!.id });
    expect(m.lembretes.listar({})[0]).toMatchObject({ estado: "adiado", texto: "Beber água" });
    m.historico.desfazer({ chamadaId: adiar!.id });
    expect(m.lembretes.listar({})[0]).toMatchObject({
      estado: "agendado",
      adiadoAte: null,
      quando: "2026-10-10T11:00:00.000Z",
    });
    m.historico.desfazer({ chamadaId: definir!.id });
    expect(m.lembretes.listar({})[0]).toMatchObject({
      texto: antes.texto,
      quando: antes.quando,
      estado: "agendado",
      origem: "usuario",
    });

    const [cancelar] = await m.rodar(chamar("lembretes__cancelar", { ids: [id] }));
    expect(m.vivo(id)).toBeUndefined();
    m.historico.desfazer({ chamadaId: cancelar!.id });
    expect(m.vivo(id)).toBeDefined();
  });

  test("o que mudou depois da chamada (o relógio também conta) não se desfaz", async () => {
    const m = montar();
    const [criar] = await m.rodar(chamar("lembretes__criar", { texto: "Água", dia: "hoje", hora: "16:00" }));
    const id = valor(criar, Lembrete).id;
    const [adiar] = await m.rodar(chamar("lembretes__adiar", { ids: [id], minutos: 10 }));
    // Passaram os 10 minutos: tocou.
    m.relogio.ms += 10 * 60_000;
    await m.lembretes.conferir({ agora: new Date(m.relogio.ms), ausencia: null });

    expect(() => m.historico.desfazer({ chamadaId: adiar!.id })).toThrow(
      MENSAGENS_DESFAZER.areaRecusou(MENSAGEM_DESFAZER_MUDOU),
    );
    expect(m.lembretes.listar({})[0]).toMatchObject({ estado: "disparado" });
  });

  test("o que toca enquanto a área tira o aviso conta como depois da chamada", async () => {
    const m = montar();
    const [criar] = await m.rodar(chamar("lembretes__criar", { texto: "Água", dia: "hoje", hora: "16:00" }));
    const id = valor(criar, Lembrete).id;
    // Mudar para agora grava e, esperando o aviso velho sair, o relógio passa e toca.
    m.noMeio.acao = () => {
      m.relogio.ms += 1000;
      return m.lembretes.conferir({ agora: new Date(m.relogio.ms), ausencia: null });
    };
    const [definir] = await m.rodar(chamar("lembretes__definir", { id, dia: "hoje", hora: "14:00" }));
    expect(m.noMeio.acao).toBeNull();
    expect(m.lembretes.listar({})[0]).toMatchObject({ estado: "disparado" });

    // O retrato do depois é o da gravação da Alba, não o do toque: desfazer não passa por cima dele.
    expect(() => m.historico.desfazer({ chamadaId: definir!.id })).toThrow(
      MENSAGENS_DESFAZER.areaRecusou(MENSAGEM_DESFAZER_MUDOU),
    );
    expect(m.lembretes.listar({})[0]).toMatchObject({ estado: "disparado", texto: "Água" });
  });

  test("dia sem hora volta ao modelo como erro", async () => {
    const m = montar();
    const [criar] = await m.rodar(chamar("lembretes__criar", { texto: "Água", dia: "hoje", hora: "16:00" }));
    const [definir] = await m.rodar(
      chamar("lembretes__definir", { id: valor(criar, Lembrete).id, dia: "amanha" }),
    );
    expect(erroDe(definir)).toBe(`lembretes.definir falhou: ${MENSAGEM_DIA_E_HORA}`);
  });
});

describe("lembretes.listar", () => {
  test("de um dia a outro no fuso do usuário, com a data de hoje", async () => {
    const m = montar();
    await m.rodar(
      chamar("lembretes__criar", { texto: "Hoje à noite", dia: "hoje", hora: "23:30" }),
      chamar("lembretes__criar", { texto: "Amanhã cedo", dia: "amanha", hora: "00:30" }),
    );
    const [listar] = await m.rodar(chamar("lembretes__listar", { de: "hoje", ate: "hoje" }));
    const lido = valor(listar, z.object({ hoje: z.string(), lembretes: z.array(Lembrete) }));
    expect(lido.hoje).toBe("2026-10-09");
    // 23:30 de hoje é 02:30Z de amanhã: o dia é o do usuário, não o UTC.
    expect(lido.lembretes.map((l) => l.texto)).toEqual(["Hoje à noite"]);
  });
});
