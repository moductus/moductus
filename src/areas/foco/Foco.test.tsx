// @vitest-environment happy-dom
import type { EstadoFoco, EtapaFoco, HistoricoFoco, Tarefa } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { Foco } from "./Foco.tsx";

/*
 * Sistema · Foco contra um serviço de mentira: o estado, o histórico da semana, a configuração e
 * as tarefas de hoje vêm de `falso`; cada pedido fica anotado para ver o que o botão pediu.
 */
const falso = vi.hoisted(() => ({
  estado: null as unknown,
  historico: null as unknown,
  tarefas: [] as unknown[],
  falhar: new Set<string>(),
  pedidos: [] as { metodo: string; dados: unknown }[],
}));

function responder(metodo: string, dados: Record<string, unknown> = {}): unknown {
  if (falso.falhar.has(metodo)) throw new Error("falhou por dentro");
  switch (metodo) {
    case "foco.obter":
      return falso.estado;
    case "foco.historico":
      return falso.historico;
    case "config.obter":
      return {
        config: {
          atalhos: { foco: "Ctrl+Alt+P" },
          silencio: { foco: true },
          dia: { fuso: null, foco: { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 } },
        },
      };
    case "tarefas.listar":
      return dados.vista === "hoje" ? falso.tarefas : [];
    case "agenda.consultar":
      return { dias: [] };
    default:
      return falso.estado;
  }
}

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: Record<string, unknown>) => {
      falso.pedidos.push({ metodo, dados });
      try {
        return Promise.resolve(responder(metodo, dados));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    ouvir: () => () => undefined,
  },
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MIN = 60_000;
const AGORA = new Date(2026, 9, 21, 14, 48, 18).getTime();
const local = (h: number, m = 0) => new Date(2026, 9, 21, h, m).getTime();

function etapa(
  id: string,
  tipo: EtapaFoco["tipo"],
  inicio: number,
  minutos: number,
  campos: Partial<EtapaFoco> = {},
) {
  return {
    id,
    tipo,
    tarefaId: "t1",
    inicio: new Date(inicio).toISOString(),
    terminaEm: new Date(inicio + minutos * MIN).toISOString(),
    pausadaEm: null,
    fim: new Date(inicio + minutos * MIN).toISOString(),
    duracaoPlanejadaMin: minutos,
    duracaoRealMin: minutos,
    interrompida: false,
    ...campos,
  } satisfies EtapaFoco;
}

function estado(campos: Partial<EstadoFoco> = {}): EstadoFoco {
  return {
    etapa: null,
    tarefaTitulo: null,
    cicloAtual: 1,
    ciclosAtePausaLonga: 4,
    proxima: "foco",
    podeEstender: false,
    focoHojeMin: 0,
    ciclosHoje: 0,
    ...campos,
  };
}

const historico = (etapas: EtapaFoco[], extra: Partial<HistoricoFoco> = {}): HistoricoFoco => ({
  etapas: [...etapas].reverse(),
  porTarefa: [{ tarefaId: "t1", titulo: "Revisar PR do relatório mensal", minutos: 50, ciclos: 2 }],
  porDia: [{ dia: "2026-10-21", minutos: 50, ciclos: 2 }],
  ...extra,
});

const tarefa = (id: string, titulo: string, extra: Partial<Tarefa> = {}): Tarefa => ({
  id,
  listaId: "entrada",
  tarefaPaiId: null,
  titulo,
  notas: null,
  notaId: null,
  prioridade: 0,
  venceEm: "2026-10-21",
  hora: null,
  duracaoEstimadaMin: null,
  recorrencia: null,
  estado: "aberta",
  concluidaEm: null,
  ordem: 0,
  etiquetas: [],
  lembreteMinutosAntes: null,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-21T11:00:00.000Z",
  atualizadoEm: "2026-10-21T11:00:00.000Z",
  ...extra,
});

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Foco />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(AGORA);
  falso.estado = estado();
  falso.historico = historico([], { porTarefa: [], porDia: [] });
  falso.tarefas = [
    tarefa("t1", "Revisar PR do relatório mensal", {
      duracaoEstimadaMin: 50,
      etiquetas: [{ id: "e1", nome: "Trabalho" }],
    }),
    tarefa("t2", "Separar comprovantes do mês"),
  ];
  falso.falhar.clear();
  falso.pedidos.length = 0;
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const texto = (seletor: string) => por(seletor)?.textContent ?? null;
const botao = (rotulo: string) =>
  [...recipiente.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === rotulo);
const clicar = async (rotulo: string) => {
  const b = botao(rotulo);
  if (!b) throw new Error(`sem o botão ${rotulo}`);
  await act(async () => b.click());
};
const pediu = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);

describe("Foco: vazio", () => {
  it("sem ciclo hoje, explica como funciona e começa ligado à primeira tarefa de hoje", async () => {
    await montar();
    expect(texto(".area-foco-cartao .area-foco-rotulo")).toBe("Nenhum ciclo hoje");
    expect(por('[aria-label="Começar um foco"] .area-foco-relogio')?.textContent).toBe("25:00");
    expect(texto(".area-foco-passos")).toContain(
      "25 min de foco e 5 de pausa. A cada 4 focos, uma pausa de 15.",
    );
    expect(
      [...recipiente.querySelectorAll(".area-foco-vazio")].map((v) => v.querySelector("h2")?.textContent),
    ).toEqual(["Hoje", "Esta semana", "Por tarefa"]);
    expect(texto(".area-foco-opcao")).toBe("Revisar PR do relatório mensalTrabalho · 50 min");
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Começar 25 min de foco");
    expect(pediu("foco.iniciar")).toEqual([{ tarefaId: "t1" }]);
  });

  it("“Sem tarefa” começa o foco livre", async () => {
    await montar();
    await clicar("Sem tarefa");
    await clicar("Começar 25 min de foco");
    expect(pediu("foco.iniciar")).toEqual([{ tarefaId: null }]);
  });
});

describe("Foco: ciclo rodando", () => {
  beforeEach(() => {
    const f1 = etapa("F1", "foco", local(14, 12), 25);
    const p1 = etapa("P1", "pausa", local(14, 37), 5);
    const f2 = etapa("F2", "foco", local(14, 42), 25, { fim: null, duracaoRealMin: null });
    falso.estado = estado({
      etapa: f2,
      cicloAtual: 2,
      proxima: "pausa",
      tarefaTitulo: "Revisar PR do relatório mensal",
      focoHojeMin: 25,
      ciclosHoje: 1,
    });
    falso.historico = historico([f1, p1, f2]);
  });

  it("mostra o relógio, a tarefa, o silêncio e as etapas da rodada; os botões pedem ao serviço", async () => {
    await montar();
    expect(por('[role="timer"]')?.textContent).toBe("18:42");
    expect(por('[role="timer"]')?.getAttribute("aria-label")).toBe("18 minutos e 42 segundos restantes");
    expect(texto(".area-foco-cartao .area-foco-rotulo")).toBe("Ciclo 2 de 4 · foco de 25 mintermina 15:07");
    expect(texto(".area-foco-ligado")).toBe("Ligado aRevisar PR do relatório mensalTrabalho");
    expect(texto(".area-foco-nota")).toBe("Avisos em silêncio até 15:07, menos aprovações e lembretes.");
    const etapas = [...recipiente.querySelectorAll(".area-foco-etapa")].map((li) =>
      li.getAttribute("data-situacao"),
    );
    expect(etapas).toEqual(["feito", "feito", "agora", "falta", "falta", "falta", "falta", "falta"]);
    expect(texto(".area-foco-lista-dia")).toContain("desde 14:42");
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Pausar");
    await clicar("+5 min");
    await clicar("Terminar ciclo");
    expect(
      falso.pedidos
        .map((p) => p.metodo)
        .filter((m) => m.startsWith("foco.") && m !== "foco.obter" && m !== "foco.historico"),
    ).toEqual(["foco.pausar", "foco.estender", "foco.terminar"]);
    expect(pediu("foco.estender")).toEqual([{ minutos: 5 }]);
  });

  it("o relógio anda sozinho, sem pedir nada ao serviço", async () => {
    await montar();
    const antes = falso.pedidos.length;
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(por('[role="timer"]')?.textContent).toBe("18:40");
    expect(falso.pedidos.length).toBe(antes);
  });

  it("o pedido recusado vira uma linha na área, sem o texto do serviço", async () => {
    falso.falhar.add("foco.pausar");
    await montar();
    await clicar("Pausar");
    expect(texto('[role="alert"]')).toBe("Não consegui pausar agora. Tente de novo.");
  });
});

describe("Foco: ciclo terminado e rodada completa", () => {
  it("a Alba propõe a pausa e a tarefa ligada pode ser marcada ali mesmo", async () => {
    const f1 = etapa("F1", "foco", local(14, 12), 25);
    falso.estado = estado({
      cicloAtual: 1,
      proxima: "pausa",
      podeEstender: true,
      focoHojeMin: 25,
      ciclosHoje: 1,
    });
    falso.historico = historico([f1]);
    await montar();
    expect(texto(".fala-texto")).toBe(
      "25 min de foco em “Revisar PR do relatório mensal”. Começo a pausa de 5 min?",
    );
    await clicar("Marcar como feita");
    expect(pediu("tarefas.concluir")).toEqual([{ id: "t1" }]);
    expect(botao("Marcar como feita")).toBeUndefined();
    await clicar("+5 min de foco");
    expect(pediu("foco.estender")).toEqual([{ minutos: 5 }]);
    await clicar("Começar a pausa");
    await clicar("Pular a pausa");
    expect(pediu("foco.iniciar")).toEqual([{ tipo: "pausa" }]);
    expect(pediu("foco.pularPausa")).toHaveLength(1);
  });

  it("o foco encerrado antes da hora não oferece o +5 min", async () => {
    const f1 = etapa("F1", "foco", local(14, 12), 25, { interrompida: true, duracaoRealMin: 10 });
    falso.estado = estado({ cicloAtual: 1, proxima: "pausa", podeEstender: false });
    falso.historico = historico([f1]);
    await montar();
    expect(botao("+5 min de foco")).toBeUndefined();
    expect(botao("Começar a pausa")).toBeDefined();
  });

  it("depois da pausa longa, o resumo da rodada até “Fechar por aqui”", async () => {
    const lista: EtapaFoco[] = [];
    let t = local(12);
    for (let i = 1; i <= 4; i++) {
      lista.push(etapa(`F${i}`, "foco", t, 25));
      t += 25 * MIN;
      lista.push(etapa(`P${i}`, i === 4 ? "pausa_longa" : "pausa", t, i === 4 ? 15 : 5));
      t += (i === 4 ? 15 : 5) * MIN;
    }
    falso.historico = historico(lista);
    falso.estado = estado({ focoHojeMin: 100, ciclosHoje: 4 });
    await montar();
    expect(texto(".area-foco-cartao .area-foco-rotulo")).toBe("Rodada completa · 14:10" + "4 de 4 focos");
    expect(texto(".fala-texto")).toBe(
      "4 ciclos, 1h40 de foco em “Revisar PR do relatório mensal”. Começo outra rodada ou fecho por aqui?",
    );
    await clicar("Fechar por aqui");
    expect(por('[aria-label="Começar um foco"]')).not.toBeNull();
    expect(texto(".area-foco-cartao .area-foco-rotulo")).toBe("4 ciclos hoje · 1h40");
  });
});
