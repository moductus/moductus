import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CONFIG_PADRAO,
  LancamentoCaptura,
  PreviaCaptura,
  type CamposCaptura,
  type PedidoLancar,
} from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioNotificacoes, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import { RepositorioAgenda, ServicoAgenda } from "../agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../agenda/tarefas-do-dia.ts";
import { RepositorioLembretes, ServicoLembretes } from "../lembretes/lembretes.ts";
import { RepositorioNotas, ServicoNotas } from "../notas/notas.ts";
import { RepositorioTarefas } from "../tarefas/repositorio.ts";
import { ServicoTarefas } from "../tarefas/tarefas.ts";
import {
  AVISO_GASTO,
  AVISO_LEMBRETE_VIRA_TAREFA,
  AVISO_MEMORIA,
  ErroDaCaptura,
  MENSAGEM_DESFAZER_SUMIU,
  MENSAGEM_EVENTO_SEM_DIA,
  MENSAGEM_HORA_SEM_DIA,
  MENSAGEM_JA_DESFEITO,
  MENSAGEM_LEMBRETE_MUDA_O_DIA,
  MENSAGEM_LEMBRETE_SEM_HORA,
  MENSAGEM_PRAZO_DESFAZER,
  MENSAGEM_REPETICAO,
  PRAZO_DESFAZER_MS,
  ServicoCaptura,
} from "./captura.ts";
import { atendentesDaCaptura, MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import {
  NAO_PERGUNTOU,
  type Interpretacao,
  type Interprete,
  type PedidoInterpretar,
  type RespostaDoModelo,
} from "./modelo.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const FUSO = "America/Sao_Paulo";
/** Domingo, 18/10/2026, 09:00 em São Paulo (UTC−3, sem horário de verão). */
const DOMINGO_9H = "2026-10-18T12:00:00.000Z";

/** O que o modelo diria, com tudo vazio menos o que o teste pede. */
const resposta = (r: Partial<Interpretacao>): Interpretacao => ({
  tipo: null,
  titulo: null,
  dia: null,
  hora: null,
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: null,
  valorCentavos: null,
  ...r,
});

/** O modelo perguntado, com o que ele disse. */
const veio = (interpretacao: Interpretacao | null): Promise<RespostaDoModelo> =>
  Promise.resolve({ perguntou: true, interpretacao });

/**
 * Banco migrado de verdade e as quatro áreas de verdade (Tarefas, Lembretes, Agenda e Notas), com
 * um relógio que só anda quando o teste manda. O modelo, quando há, é uma função do teste: nenhum
 * provedor, nenhuma rede.
 */
function montar(opcoes: { interpretar?: Interprete | null } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-captura-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const relogio = { agora: new Date(DOMINGO_9H) };
  const agora = () => relogio.agora;
  const andar = (ms: number) => {
    relogio.agora = new Date(relogio.agora.getTime() + ms);
  };
  const notas = new ServicoNotas(new RepositorioNotas(db), { mudou: () => {} }, { agora });
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => FUSO, notas },
    { tarefas: () => {}, listas: () => {}, lembretes: () => {} },
    { agora },
  );
  const agentes = new RepositorioAgentes(db);
  const notificacoes = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentes.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => CONFIG_PADRAO.silencio,
      windows: {
        mostrar: () => Promise.resolve(),
        retirar: () => Promise.resolve(),
        telaCheia: () => Promise.resolve(false),
      },
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const lembretes = new ServicoLembretes(
    new RepositorioLembretes(db),
    { lerFuso: () => FUSO, notificacoes },
    { mudou: () => {}, hoje: () => {} },
    { agora },
  );
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: new RepositorioExecucoes(db),
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: () => {}, calendarios: () => {} },
    { agora },
  );
  const missoes = { lembrete: 0 };
  const captura = new ServicoCaptura(
    {
      lerFuso: () => FUSO,
      tarefas,
      lembretes,
      agenda,
      notas,
      interpretar: opcoes.interpretar ?? null,
      pediuLembrete: () => missoes.lembrete++,
    },
    { agora },
  );
  return { db, captura, tarefas, lembretes, agenda, notas, andar, missoes };
}

type Montado = ReturnType<typeof montar>;

/** Entende e lança com o tipo da prévia (ou o do "Na verdade é"), como o Enter faz. */
async function capturar(m: Montado, texto: string, outro?: Partial<PedidoLancar>) {
  const previa = PreviaCaptura.parse(await m.captura.entender({ texto }));
  const pedido = { texto, tipo: previa.tipo, campos: previa.campos, ...outro } as PedidoLancar;
  const lancamento = LancamentoCaptura.parse(await m.captura.lancar(pedido));
  return { previa, lancamento };
}

const vazios = (titulo: string): CamposCaptura => ({
  titulo,
  dia: null,
  hora: null,
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: null,
  listaId: null,
  valorCentavos: null,
});

describe("entender", () => {
  test("a prévia diz o tipo, os campos, o trecho e as alternativas, sem criar nada", async () => {
    const m = montar();
    const previa = await m.captura.entender({ texto: "  ligar pro banco amanhã 15h  " });
    expect(PreviaCaptura.parse(previa)).toEqual({
      texto: "ligar pro banco amanhã 15h",
      tipo: "tarefa",
      campos: { ...vazios("ligar pro banco"), dia: "2026-10-19", hora: "15:00" },
      trechos: [
        { campo: "dia", inicio: 16, fim: 22 },
        { campo: "hora", inicio: 23, fim: 26 },
      ],
      alternativas: ["lembrete", "evento", "nota"],
      aviso: null,
      entendidoPor: "codigo",
    });
    expect(m.tarefas.listar({})).toEqual([]);
  });

  test("gasto e memória dizem que ainda não chegaram e oferecem tarefa ou nota", async () => {
    const m = montar();
    const gasto = await m.captura.entender({ texto: "45 de mercado no débito" });
    expect(gasto).toMatchObject({
      tipo: "gasto",
      aviso: AVISO_GASTO,
      alternativas: ["tarefa", "nota"],
      campos: { titulo: "mercado no débito", valorCentavos: 4500 },
    });
    const memoria = await m.captura.entender({ texto: "guarda isso: a senha do wifi é jabuticaba" });
    expect(memoria).toMatchObject({
      tipo: "memoria",
      aviso: AVISO_MEMORIA,
      alternativas: ["nota", "tarefa"],
    });
    // O contrato não deixa lançar gasto.
    await expect(
      m.captura.lancar({ texto: "45 de mercado no débito", tipo: "gasto", campos: gasto.campos } as never),
    ).rejects.toThrow();
  });

  test("a lista citada na frase vem pelo id", async () => {
    const m = montar();
    const viagem = m.tarefas.criarLista({ nome: "Viagem" });
    const previa = await m.captura.entender({ texto: "comprar protetor #viagem" });
    expect(previa.campos.listaId).toBe(viagem.id);
    const { lancamento } = await capturar(m, "comprar protetor #viagem");
    expect(m.tarefas.obter({ id: lancamento.itemId }).listaId).toBe(viagem.id);
  });

  test("frase só de sinais de controle é recusada com explicação", async () => {
    const m = montar();
    await expect(m.captura.entender({ texto: "\u0001\u0002" })).rejects.toBeInstanceOf(ErroDaCaptura);
  });
});

describe("sem provedor", () => {
  test("a frase que o código não entende vira tarefa sem data na Entrada", async () => {
    const m = montar();
    const { previa, lancamento } = await capturar(m, "comprar pão");
    expect(previa).toMatchObject({ tipo: "tarefa", campos: vazios("comprar pão"), entendidoPor: "codigo" });
    const tarefa = m.tarefas.obter({ id: lancamento.itemId });
    expect(tarefa).toMatchObject({ titulo: "comprar pão", listaId: "entrada", venceEm: null, hora: null });
    expect(m.missoes.lembrete).toBe(0);
  });
});

describe("com o modelo da Alba", () => {
  test("só entra quando a janela pede e o código não reconhece nada além do título", async () => {
    const pedidos: PedidoInterpretar[] = [];
    const interpretar: Interprete = (pedido) => {
      pedidos.push(pedido);
      return veio(resposta({ tipo: "lembrete", titulo: "regar as plantas", hora: "18:00" }));
    };
    const m = montar({ interpretar });
    const frase = "não esquecer das plantas no fim da tarde";
    await m.captura.entender({ texto: "ligar pro banco amanhã 15h", comModelo: true });
    // Sem a flag, a frase que o código não entende fica com ele: tarefa sem data, nenhuma execução.
    expect(await m.captura.entender({ texto: frase })).toMatchObject({
      tipo: "tarefa",
      campos: vazios(frase),
      entendidoPor: "codigo",
    });
    expect(pedidos).toHaveLength(0);

    const previa = await m.captura.entender({ texto: frase, comModelo: true });
    expect(pedidos.map((p) => [p.texto, p.hoje, p.agora])).toEqual([[frase, "2026-10-18", "09:00"]]);
    // Hora sem dia é hoje (ainda não passou); o trecho não vem, porque o modelo não diz onde estava.
    expect(previa).toMatchObject({
      tipo: "lembrete",
      campos: { titulo: "regar as plantas", dia: "2026-10-18", hora: "18:00" },
      trechos: [],
      entendidoPor: "modelo",
    });
    // A mesma frase no mesmo dia não pergunta de novo.
    await m.captura.entender({ texto: frase, comModelo: true });
    expect(pedidos).toHaveLength(1);
  });

  test("o modelo que só repete o título, falha ou não responde deixa a prévia do código", async () => {
    const respostas: (() => Promise<RespostaDoModelo>)[] = [
      () => veio(resposta({ titulo: "outra coisa" })),
      () => Promise.reject(new Error("caiu")),
      () => veio(null),
    ];
    const m = montar({ interpretar: () => respostas.shift()!() });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const texto of ["comprar pão", "comprar leite", "comprar café"]) {
      const previa = await m.captura.entender({ texto, comModelo: true });
      expect(previa).toMatchObject({ tipo: "tarefa", campos: vazios(texto), entendidoPor: "codigo" });
    }
    expect(erro).toHaveBeenCalledOnce();
  });

  test("a Alba que não podia ser chamada não deixa resposta guardada: acordada, pergunta", async () => {
    const respostas: RespostaDoModelo[] = [NAO_PERGUNTOU, { perguntou: true, interpretacao: null }];
    let chamadas = 0;
    const m = montar({
      interpretar: () => {
        chamadas++;
        return Promise.resolve(respostas.shift() ?? NAO_PERGUNTOU);
      },
    });
    await m.captura.entender({ texto: "comprar pão", comModelo: true });
    await m.captura.entender({ texto: "comprar pão", comModelo: true });
    expect(chamadas).toBe(2);
    // O "não sei" de quem perguntou fica guardado.
    await m.captura.entender({ texto: "comprar pão", comModelo: true });
    expect(chamadas).toBe(2);
  });

  test("evento sem dia e lembrete sem hora do modelo viram tarefa; antecedência só com hora", async () => {
    const respostas = [
      resposta({ tipo: "evento", titulo: "churrasco", duracaoMin: 180 }),
      resposta({ tipo: "lembrete", dia: "2026-10-20", lembreteMinutosAntes: 30 }),
    ];
    const m = montar({ interpretar: () => veio(respostas.shift()!) });
    expect(await m.captura.entender({ texto: "churras com a turma", comModelo: true })).toMatchObject({
      tipo: "tarefa",
      campos: { titulo: "churrasco", duracaoMin: 180, dia: null },
      entendidoPor: "modelo",
    });
    expect(await m.captura.entender({ texto: "vacina do gato", comModelo: true })).toMatchObject({
      tipo: "tarefa",
      campos: { titulo: "vacina do gato", dia: "2026-10-20", hora: null, lembreteMinutosAntes: null },
    });
  });

  test("qualquer frase nova cancela a pergunta da anterior, que fica com o código", async () => {
    const sinais: AbortSignal[] = [];
    const m = montar({
      interpretar: ({ sinal }) => {
        sinais.push(sinal);
        if (sinais.length !== 2) {
          return new Promise((resolve) =>
            sinal.addEventListener("abort", () => resolve({ perguntou: true, interpretacao: null })),
          );
        }
        return veio(resposta({ tipo: "nota", titulo: "ideia" }));
      },
    });
    const primeira = m.captura.entender({ texto: "comprar pã", comModelo: true });
    const segunda = await m.captura.entender({ texto: "comprar pão", comModelo: true });
    expect(segunda).toMatchObject({ tipo: "nota", entendidoPor: "modelo" });
    expect(sinais[0]!.aborted).toBe(true);
    expect(await primeira).toMatchObject({ tipo: "tarefa", entendidoPor: "codigo" });

    // A frase reconhecida, que não pergunta nada, também encerra a que esperava.
    const terceira = m.captura.entender({ texto: "comprar pã", comModelo: true });
    // A cancelada não ficou guardada como "não sei": a frase volta a perguntar.
    expect(sinais).toHaveLength(3);
    await m.captura.entender({ texto: "comprar pão amanhã" });
    expect(sinais[2]!.aborted).toBe(true);
    expect(await terceira).toMatchObject({ entendidoPor: "codigo" });
  });
});

describe("lançar pela área", () => {
  test("tarefa com dia e hora ganha o lembrete das Tarefas; antecedência dita conta como pedido de lembrete", async () => {
    const m = montar();
    const { lancamento } = await capturar(m, "ligar pro banco amanhã 15h");
    expect(lancamento).toMatchObject({ tipo: "tarefa", desfazerAte: "2026-10-18T12:00:10.000Z" });
    expect(m.tarefas.obter({ id: lancamento.itemId })).toMatchObject({
      titulo: "ligar pro banco",
      venceEm: "2026-10-19",
      hora: "15:00",
      lembreteMinutosAntes: 15,
    });
    expect(m.missoes.lembrete).toBe(0);

    const { lancamento: boleto } = await capturar(m, "pagar boleto amanhã 9h com lembrete 1 dia antes");
    expect(m.tarefas.obter({ id: boleto.itemId }).lembreteMinutosAntes).toBe(1440);
    expect(m.missoes.lembrete).toBe(1);
  });

  test("lembrete toca na hora dita e faz a missão da Alba", async () => {
    const m = montar();
    const { previa, lancamento } = await capturar(m, "me lembra de tomar remédio às 22h");
    expect(previa.tipo).toBe("lembrete");
    expect(lancamento.tipo).toBe("lembrete");
    const [lembrete] = m.lembretes.listar({});
    expect(lembrete).toMatchObject({
      id: lancamento.itemId,
      texto: "tomar remédio",
      quando: "2026-10-19T01:00:00.000Z",
      tarefaId: null,
    });
    expect(m.missoes.lembrete).toBe(1);
  });

  test("lembrete que repete com o aviso em outro dia vai como tarefa, que avisa antes de cada vez", async () => {
    const m = montar();
    const semanal = "me lembra de ligar pra mãe toda segunda 9h com lembrete 1 dia antes";
    const { previa, lancamento } = await capturar(m, semanal);
    expect(previa).toMatchObject({
      tipo: "tarefa",
      aviso: AVISO_LEMBRETE_VIRA_TAREFA,
      alternativas: ["evento", "nota"],
      campos: {
        dia: "2026-10-19",
        hora: "09:00",
        lembreteMinutosAntes: 1440,
        recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      },
    });
    expect(m.tarefas.obter({ id: lancamento.itemId })).toMatchObject({
      titulo: "ligar pra mãe",
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      lembreteMinutosAntes: 1440,
    });
    expect(m.lembretes.listar({})).toHaveLength(1);
    expect(m.lembretes.listar({})[0]).toMatchObject({ tarefaId: lancamento.itemId });

    const mensal = "me lembra de pagar o aluguel todo dia 10 às 9h com lembrete 1 dia antes";
    const doMes = await capturar(m, mensal);
    expect(doMes.previa).toMatchObject({
      tipo: "tarefa",
      aviso: AVISO_LEMBRETE_VIRA_TAREFA,
      campos: { recorrencia: "FREQ=MONTHLY;BYMONTHDAY=10", lembreteMinutosAntes: 1440 },
    });
    expect(m.tarefas.obter({ id: doMes.lancamento.itemId }).recorrencia).toBe("FREQ=MONTHLY;BYMONTHDAY=10");
    // Pedido direto como lembrete, a captura recusa e diz o que fazer.
    await expect(
      m.captura.lancar({ texto: semanal, tipo: "lembrete", campos: previa.campos }),
    ).rejects.toThrow(MENSAGEM_LEMBRETE_MUDA_O_DIA);

    // Aviso no mesmo dia, ou todo dia: o lembrete repete certo e continua lembrete.
    const mesmoDia = await m.captura.entender({
      texto: "me lembra de tomar remédio toda segunda 9h com lembrete 30 min antes",
    });
    expect(mesmoDia).toMatchObject({ tipo: "lembrete", aviso: null });
    const todoDia = await m.captura.entender({
      texto: "me lembra de regar as plantas todo dia 9h com lembrete 1 dia antes",
    });
    expect(todoDia.tipo).toBe("lembrete");
  });

  test("evento com hora dura uma hora; sem hora, é de dia inteiro", async () => {
    const m = montar();
    const { lancamento } = await capturar(m, "reunião com o contador quinta 10h");
    expect(m.agenda.obterEvento({ id: lancamento.itemId })).toMatchObject({
      titulo: "reunião com o contador",
      inicio: "2026-10-22T13:00:00.000Z",
      fim: "2026-10-22T14:00:00.000Z",
      diaInteiro: false,
      calendarioId: "local",
    });
    const { lancamento: diaTodo } = await capturar(m, "aniversário da Ana", {
      tipo: "evento",
      campos: { ...vazios("aniversário da Ana"), dia: "2026-10-25" },
    });
    expect(m.agenda.obterEvento({ id: diaTodo.itemId })).toMatchObject({
      inicio: "2026-10-25",
      fim: "2026-10-26",
      diaInteiro: true,
    });
  });

  test("o gasto lançado como tarefa ou nota leva a frase inteira, para o valor não se perder", async () => {
    const m = montar();
    const comoNota = await capturar(m, "45 de mercado no débito", { tipo: "nota" });
    expect(m.notas.obter({ id: comoNota.lancamento.itemId })).toMatchObject({
      titulo: "mercado no débito",
      conteudo: "45 de mercado no débito",
    });
    const comoTarefa = await capturar(m, "45 de mercado no débito", { tipo: "tarefa" });
    expect(m.tarefas.obter({ id: comoTarefa.lancamento.itemId }).notas).toBe("45 de mercado no débito");
    const nota = await capturar(m, "nota: ideias para o presente", { tipo: "nota" });
    expect(m.notas.obter({ id: nota.lancamento.itemId }).conteudo).toBe("");
  });

  test("o que falta para o tipo é recusado com o que fazer, sem criar nada", async () => {
    const m = montar();
    const lancar = (tipo: PedidoLancar["tipo"], campos: Partial<CamposCaptura>) =>
      m.captura.lancar({ texto: "x", tipo, campos: { ...vazios("x"), ...campos } });
    await expect(lancar("lembrete", { dia: "2026-10-19" })).rejects.toThrow(MENSAGEM_LEMBRETE_SEM_HORA);
    await expect(lancar("evento", {})).rejects.toThrow(MENSAGEM_EVENTO_SEM_DIA);
    await expect(lancar("tarefa", { hora: "10:00" })).rejects.toThrow(MENSAGEM_HORA_SEM_DIA);
    await expect(lancar("tarefa", { dia: "2026-10-19", recorrencia: "FREQ=HOURLY" })).rejects.toThrow(
      MENSAGEM_REPETICAO("").slice(0, 30),
    );
    expect(m.tarefas.listar({})).toEqual([]);
    expect(m.lembretes.listar({})).toEqual([]);
  });
});

describe("desfazer", () => {
  test("dentro de 10 s apaga pela área; de novo, diz que já foi", async () => {
    const m = montar();
    const tarefa = await capturar(m, "comprar pão");
    const lembrete = await capturar(m, "me lembra de tomar remédio às 22h");
    const evento = await capturar(m, "reunião às 15h");
    const nota = await capturar(m, "nota: ideias", { tipo: "nota" });
    m.andar(PRAZO_DESFAZER_MS);
    for (const { lancamento } of [tarefa, lembrete, evento, nota]) {
      expect(await m.captura.desfazer({ id: lancamento.id })).toEqual(lancamento);
    }
    expect(m.tarefas.listar({})).toEqual([]);
    expect(m.lembretes.listar({})).toEqual([]);
    expect(() => m.agenda.obterEvento({ id: evento.lancamento.itemId })).toThrow();
    expect(() => m.notas.obter({ id: nota.lancamento.itemId })).toThrow();
    await expect(m.captura.desfazer({ id: tarefa.lancamento.id })).rejects.toThrow(MENSAGEM_JA_DESFEITO);
  });

  test("depois de 10 s explica por quê e onde tirar; o item fica", async () => {
    const m = montar();
    const { lancamento } = await capturar(m, "comprar pão");
    m.andar(PRAZO_DESFAZER_MS + 1);
    const recusa = m.captura.desfazer({ id: lancamento.id });
    await expect(recusa).rejects.toBeInstanceOf(ErroDaCaptura);
    await expect(m.captura.desfazer({ id: lancamento.id })).rejects.toThrow(
      MENSAGEM_PRAZO_DESFAZER("tarefa"),
    );
    expect(MENSAGEM_PRAZO_DESFAZER("tarefa")).toContain("10 s");
    expect(m.tarefas.obter({ id: lancamento.itemId }).estado).toBe("aberta");
    // O que o serviço não conhece (reiniciou, ou passou muito tempo) também diz por quê.
    await expect(m.captura.desfazer({ id: "01K7A0000000000000000000ZZ" })).rejects.toThrow(
      MENSAGEM_DESFAZER_SUMIU,
    );
  });

  test("o item apagado por fora antes do desfazer volta o erro da área e pode ser tentado de novo", async () => {
    const m = montar();
    const { lancamento } = await capturar(m, "nota: rascunho", { tipo: "nota" });
    m.notas.apagar({ id: lancamento.itemId });
    await expect(m.captura.desfazer({ id: lancamento.id })).rejects.toBeInstanceOf(ErroDaCaptura);
    await expect(m.captura.desfazer({ id: lancamento.id })).rejects.not.toThrow(MENSAGEM_JA_DESFEITO);
  });
});

describe("canal", () => {
  test("erro da regra vai como veio; falha por dentro vira um texto só", async () => {
    const m = montar();
    const canal = atendentesDaCaptura(m.captura);
    await expect(
      canal["captura.lancar"]({ texto: "x", tipo: "evento", campos: vazios("x") }),
    ).rejects.toThrow(MENSAGEM_EVENTO_SEM_DIA);
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    m.db.close();
    await expect(
      canal["captura.lancar"]({ texto: "x", tipo: "tarefa", campos: vazios("x") }),
    ).rejects.toThrow(new Error(MENSAGEM_ERRO_INTERNO));
    expect(erro).toHaveBeenCalledOnce();
  });
});
