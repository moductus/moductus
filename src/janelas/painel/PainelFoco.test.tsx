// @vitest-environment happy-dom
import type { DiaDaAgenda, EstadoFoco, EtapaFoco, Tarefa } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * O painel Foco e o tempo no ícone do dock (PainelFoco.dc.html, Dock.dc.html). A casca abre o
 * painel pelo `painel:area`, disparado à mão; o canal é um serviço de mentira que responde o foco,
 * a configuração, as tarefas e a agenda, e deixa disparar o `foco.mudou` como o serviço faria.
 */
const eventosCasca = new Map<string, Set<(e: { payload: unknown }) => void>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) => {
    if (comando === "servico_estado") return { estado: "pronto", porta: 1, token: "t" };
    if (comando === "dock_configuracao") return { lado: "esquerda", modo: "fixo", forma: "colada" };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (nome: string, fn: (e: { payload: unknown }) => void) => {
    if (!eventosCasca.has(nome)) eventosCasca.set(nome, new Set());
    eventosCasca.get(nome)!.add(fn);
    return () => eventosCasca.get(nome)?.delete(fn);
  }),
}));

const MIN = 60_000;
/** 14:42 no relógio do PC, que é o que o painel escreve. */
const T0 = new Date(2026, 9, 18, 14, 42).getTime();
const local = (h: number, m = 0) => new Date(2026, 9, 18, h, m).toISOString();

function etapa(campos: Partial<EtapaFoco> = {}): EtapaFoco {
  return {
    id: "01JETAPA000000000000000000",
    tipo: "foco",
    tarefaId: "t-pr",
    inicio: new Date(T0 - 6 * MIN).toISOString(),
    // 18:42 restantes e meio segundo a menos, para o arredondamento aparecer.
    terminaEm: new Date(T0 + (18 * 60 + 42) * 1000 - 500).toISOString(),
    pausadaEm: null,
    fim: null,
    duracaoPlanejadaMin: 25,
    duracaoRealMin: null,
    interrompida: false,
    ...campos,
  };
}

function focoEm(campos: Partial<EstadoFoco> = {}): EstadoFoco {
  return {
    etapa: etapa(),
    tarefaTitulo: "Revisar PR do relatório mensal",
    cicloAtual: 2,
    ciclosAtePausaLonga: 4,
    proxima: "pausa",
    focoHojeMin: 75,
    ciclosHoje: 3,
    ...campos,
  };
}

function tarefa(id: string, titulo: string, campos: Partial<Tarefa> = {}): Tarefa {
  return {
    id,
    listaId: "trabalho",
    tarefaPaiId: null,
    titulo,
    notas: null,
    notaId: null,
    prioridade: 0,
    venceEm: "2026-10-18",
    hora: null,
    duracaoEstimadaMin: 25,
    recorrencia: null,
    estado: "aberta",
    concluidaEm: null,
    ordem: 0,
    etiquetas: [],
    lembreteMinutosAntes: null,
    origem: "usuario",
    agenteId: null,
    execucaoId: null,
    criadoEm: local(8),
    atualizadoEm: local(8),
    ...campos,
  } as Tarefa;
}

const CONFIG = {
  config: {
    atalhos: { sistema: "Ctrl+Alt+N", dock: "Ctrl+Alt+D", captura: "Ctrl+Alt+Space", foco: "Ctrl+Alt+P" },
    silencio: { horario: { ligado: false, inicio: "22:00", fim: "07:30" }, telaCheia: true, foco: true },
    dia: {
      fuso: "America/Sao_Paulo",
      expediente: { inicio: "09:00", fim: "18:00" },
      foco: { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 },
    },
  },
  portable: false,
  falhasAtalhos: {},
};

const servidor: {
  foco: EstadoFoco;
  config: typeof CONFIG;
  tarefas: Tarefa[];
  dia: DiaDaAgenda;
  falhar: Set<string>;
} = {
  foco: focoEm(),
  config: CONFIG,
  tarefas: [],
  dia: { dia: "2026-10-18", livres: [], livreMin: 0, planejadoMin: 0, cheio: false, sugestoes: [] },
  falhar: new Set(),
};

const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const pedir = vi.fn(async (metodo: string, dados?: unknown): Promise<unknown> => {
  if (servidor.falhar.has(metodo)) throw new Error("recusado");
  if (metodo.startsWith("foco.")) return servidor.foco;
  switch (metodo) {
    case "config.obter":
      return servidor.config;
    case "tarefas.listar":
      return (dados as { vista: string }).vista === "hoje" ? servidor.tarefas : [];
    case "agenda.consultar":
      return { ocorrencias: [], dias: [servidor.dia] };
    case "agenda.aplicarSugestao":
      return { evento: {}, chamadaId: "01JCHAMADA0000000000000000", desfazerAte: local(23) };
    case "execucoes.desfazer":
    case "tarefas.concluir":
      return {};
    case "agentes.listar":
    case "provedores.listar":
    case "notificacoes.naoVistas":
      return [];
    case "areas.contagens":
      return { tarefasPendentes: 0, lembretesAtrasados: 0, sessoesEsperando: 0, devPrecisando: 0 };
  }
  throw new Error(`método ${metodo} sem atendente`);
});

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
      ouvintes.get(nome)!.add(fn);
      return () => ouvintes.get(nome)?.delete(fn);
    },
    pedir,
  },
}));

const { Painel } = await import("./Painel.tsx");
const { Dock } = await import("../dock/Dock.tsx");

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar(comDock = false) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () =>
    raiz!.render(
      <>
        {comDock && <Dock />}
        <Painel />
      </>,
    ),
  );
  await act(async () => eventosCasca.get("painel:area")?.forEach((fn) => fn({ payload: "foco" })));
}

async function emitir(nome: string, dados: unknown) {
  await act(async () => ouvintes.get(nome)?.forEach((fn) => fn(dados)));
}

async function clicar(texto: string) {
  const botao = [...recipiente.querySelectorAll("button")].find((b) => b.textContent === texto);
  if (!botao) throw new Error(`sem o botão ${texto}`);
  await act(async () => botao.click());
}

const painel = () => recipiente.querySelector<HTMLElement>("main.painel")!;
const relogio = () => painel().querySelector<HTMLElement>('[role="timer"]')!;
const tempoNoDock = () => recipiente.querySelector<HTMLElement>(".dock-tempo");
const botaoFocoNoDock = () => recipiente.querySelector<HTMLElement>('.dock-botao[data-area="foco"]')!;
const pedidos = (metodo: string) => pedir.mock.calls.filter(([m]) => m === metodo).map(([, d]) => d);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(T0);
  eventosCasca.clear();
  ouvintes.clear();
  pedir.mockClear();
  servidor.foco = focoEm();
  servidor.config = CONFIG;
  servidor.tarefas = [];
  servidor.dia = { dia: "2026-10-18", livres: [], livreMin: 0, planejadoMin: 0, cheio: false, sugestoes: [] };
  servidor.falhar = new Set();
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

describe("painel Foco", () => {
  it("mostra o ciclo como o quadro: atalho, rótulo, relógio, tarefa, silêncio e o foco de hoje", async () => {
    servidor.tarefas = [
      tarefa("t-pr", "Revisar PR do relatório mensal", { etiquetas: [{ id: "e1", nome: "dev" }] }),
      tarefa("t1", "Separar comprovantes do mês"),
      tarefa("t2", "Responder e-mail do contador", { duracaoEstimadaMin: 10 }),
      tarefa("t3", "Atualizar planilha de viagem", { duracaoEstimadaMin: 50 }),
    ];
    await montar();
    const texto = painel().textContent!;
    expect(texto).toContain("Alba guarda o tempo · 3 ciclos hoje");
    expect(painel().querySelector("kbd.atalho")?.textContent).toBe("CtrlAltP");
    expect(texto).toContain("Ciclo 2 de 4 · 25 min");
    expect(texto).toContain("termina 15:00");
    expect(relogio().textContent).toBe("18:42");
    expect(relogio().getAttribute("aria-label")).toBe("18 minutos e 42 segundos restantes");
    expect(painel().querySelector(".foco-etiqueta")?.textContent).toBe("dev");
    expect(texto).toContain("Avisos em silêncio até 15:00, menos aprovações e lembretes.");
    expect(texto).toContain("1h15");
    expect([...painel().querySelectorAll(".foco-ciclo")].map((c) => c.getAttribute("data-situacao"))).toEqual(
      ["feito", "atual", "falta", "falta"],
    );
    // "Depois deste": sem a tarefa do foco, com a estimativa de cada uma.
    expect([...painel().querySelectorAll(".foco-lista-linha")].map((l) => l.textContent)).toEqual([
      "Separar comprovantes do mês25 min",
      "Responder e-mail do contador10 min",
      "Atualizar planilha de viagem50 min",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Pausar pede ao serviço, e o foco.mudou deixa o relógio parado e apagado com o Continuar", async () => {
    await montar();
    await clicar("Pausar");
    expect(pedidos("foco.pausar")).toHaveLength(1);

    const pausadaEm = new Date(T0).toISOString();
    await emitir("foco.mudou", focoEm({ etapa: etapa({ pausadaEm }) }));
    expect(relogio().dataset.pausado).toBeDefined();
    expect(painel().textContent).toContain("Em pausa, os avisos voltam ao normal.");
    await act(async () => vi.advanceTimersByTime(3 * MIN));
    expect(relogio().textContent).toBe("18:42");
    expect(painel().textContent).toContain("em pausa há 3 min");
    await clicar("Continuar");
    expect(pedidos("foco.retomar")).toHaveLength(1);
    await clicar("+5 min");
    expect(pedidos("foco.estender")).toEqual([{ minutos: 5 }]);
  });

  it("o relógio do painel e o número do dock batem a cada momento, até o fim", async () => {
    await montar(true);
    expect(tempoNoDock()?.textContent).toBe("18");
    expect(botaoFocoNoDock().getAttribute("aria-label")).toBe("Foco, 18 min restantes");
    for (let passo = 0; passo < 170; passo++) {
      await act(async () => vi.advanceTimersByTime(6_700));
      // O relógio falso não roda os efeitos no meio do avanço: o reagendar de cada janela vem aqui.
      await act(async () => vi.advanceTimersByTime(0));
      const [minutos] = relogio().textContent!.split(":");
      const restante = Date.parse(servidor.foco.etapa!.terminaEm) - Date.now();
      if (restante <= 0) {
        expect(relogio().textContent).toBe("00:00");
        break;
      }
      expect(tempoNoDock()?.textContent).toBe(String(Number(minutos)));
    }
    expect(tempoNoDock()?.textContent).toBe("0");
  });

  it("no dock, a etapa pausada fica apagada e o rótulo diz que está em pausa; sem etapa, nada", async () => {
    await montar(true);
    await emitir("foco.mudou", focoEm({ etapa: etapa({ pausadaEm: new Date(T0).toISOString() }) }));
    expect(tempoNoDock()?.dataset.pausado).toBeDefined();
    expect(botaoFocoNoDock().getAttribute("aria-label")).toBe("Foco, em pausa, 18 min restantes");
    await emitir("foco.mudou", focoEm({ etapa: null }));
    expect(tempoNoDock()).toBeNull();
    expect(botaoFocoNoDock().getAttribute("aria-label")).toBe("Foco");
  });

  it("na pausa, o próximo foco começa sozinho e os botões voltam ao foco ou encerram a rodada", async () => {
    servidor.foco = focoEm({
      etapa: etapa({
        tipo: "pausa",
        duracaoPlanejadaMin: 5,
        terminaEm: new Date(T0 + 3 * MIN).toISOString(),
      }),
    });
    await montar();
    const texto = painel().textContent!;
    expect(texto).toContain("Pausa · 5 min");
    expect(texto).toContain("foco 3 de 4 começa 14:45");
    expect(texto).toContain("O próximo foco começa sozinho às 14:45.");
    await clicar("Voltar ao foco agora");
    await clicar("Encerrar a rodada");
    expect(pedidos("foco.pularPausa")).toHaveLength(1);
    expect(pedidos("foco.terminar")).toHaveLength(1);
  });

  it("depois do foco, a Alba propõe a pausa; parado, oferece começar", async () => {
    servidor.foco = focoEm({ etapa: null, proxima: "pausa" });
    await montar();
    expect(painel().textContent).toContain("Ciclo 2 de 4 terminou. Começo a pausa de 5 min?");
    await clicar("Começar a pausa");
    expect(pedidos("foco.iniciar")).toEqual([{ tipo: "pausa" }]);

    await emitir("foco.mudou", focoEm({ etapa: null, proxima: "foco", cicloAtual: 1, tarefaTitulo: null }));
    expect(painel().textContent).toContain("Ciclo 1 de 4 · 25 min");
    expect(relogio().textContent).toBe("25:00");
    await clicar("Começar foco");
    expect(pedidos("foco.iniciar")).toEqual([{ tipo: "pausa" }, {}]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("a Alba sugere o próximo bloco livre; Guardar aplica a sugestão como veio, e dá para desfazer", async () => {
    servidor.tarefas = [tarefa("t1", "Separar comprovantes do mês")];
    const sugestao = { tarefaId: "t1", inicio: local(16), fim: local(16, 25) };
    servidor.dia = {
      dia: "2026-10-18",
      livres: [{ inicio: local(16), fim: local(17, 30), minutos: 90 }],
      livreMin: 90,
      planejadoMin: 25,
      cheio: false,
      sugestoes: [sugestao],
    };
    await montar();
    expect(pedidos("agenda.consultar")).toContainEqual({ de: "2026-10-18", ate: "2026-10-18" });
    expect(painel().textContent).toContain(
      "Seu próximo bloco livre é das 16h às 17h30. Guardo das 16h às 16h25 para “Separar comprovantes do mês”?",
    );
    await clicar("Guardar bloco");
    expect(pedidos("agenda.aplicarSugestao")).toEqual([sugestao]);
    expect(painel().textContent).toContain("Guardei das 16h às 16h25 para “Separar comprovantes do mês”.");
    await clicar("Desfazer");
    expect(pedidos("execucoes.desfazer")).toEqual([{ chamadaId: "01JCHAMADA0000000000000000" }]);
  });

  it("Não guarda a recusa: a mesma sugestão não volta quando a agenda é relida", async () => {
    servidor.tarefas = [tarefa("t1", "Separar comprovantes do mês")];
    servidor.dia = {
      dia: "2026-10-18",
      livres: [{ inicio: local(16), fim: local(17, 30), minutos: 90 }],
      livreMin: 90,
      planejadoMin: 25,
      cheio: false,
      sugestoes: [{ tarefaId: "t1", inicio: local(16), fim: local(16, 25) }],
    };
    await montar();
    await clicar("Não");
    expect(painel().querySelector(".foco-sugestao")).toBeNull();
    await emitir("agenda.mudou", { eventos: [], apagados: [] });
    expect(painel().querySelector(".foco-sugestao")).toBeNull();
    expect(pedidos("agenda.aplicarSugestao")).toHaveLength(0);
  });

  it("pedido recusado vira uma linha no painel, sem o texto do serviço", async () => {
    servidor.falhar.add("foco.pausar");
    await montar();
    await clicar("Pausar");
    const alerta = painel().querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe("Não consegui pausar agora. Tente de novo.");
    expect(painel().textContent).not.toContain("recusado");
  });

  it("sem o atalho do foco (colidiu com um atalho seu), o chip não aparece", async () => {
    servidor.config = {
      ...CONFIG,
      config: { ...CONFIG.config, atalhos: { ...CONFIG.config.atalhos, foco: "" } },
    };
    await montar();
    expect(painel().querySelector("kbd.atalho")).toBeNull();
  });
});
