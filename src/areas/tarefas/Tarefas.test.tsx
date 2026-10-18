// @vitest-environment happy-dom
import type { Lembrete, Lista, PreviaCaptura, Tarefa } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcoesSistemaContexto } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { ESPERA_PREVIA_MS, PAUSA_MODELO_MS } from "./CampoFrase.tsx";
import { Tarefas } from "./Tarefas.tsx";
import { HOJE, lembrete, tarefa } from "./exemplos.ts";

// O serviço é falso: responde pelo `servidor` (valor ou função do pedido) e guarda os ouvintes.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
  servidor: {} as Record<string, unknown>,
}));
vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      if (!(metodo in falso.servidor)) return Promise.reject(new Error(`sem resposta para ${metodo}`));
      const resposta = falso.servidor[metodo];
      try {
        return Promise.resolve(typeof resposta === "function" ? resposta(dados) : resposta);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 11:00 de quinta, 8 de outubro, em São Paulo.
const AGORA = new Date("2026-10-08T14:00:00.000Z");

const LISTAS: Lista[] = [
  { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false },
  { id: "trabalho", nome: "Trabalho", ordem: 1, cor: null, arquivada: false },
  { id: "pessoal", nome: "Pessoal", ordem: 2, cor: null, arquivada: false },
  { id: "antiga", nome: "Antiga", ordem: 3, cor: null, arquivada: true },
];

interface Mundo {
  hoje?: Tarefa[];
  atrasadas?: Tarefa[];
  abertas?: Tarefa[];
  proximas?: Tarefa[];
  lembretes?: Lembrete[];
  pendentes?: number;
}

function responder({
  hoje = [],
  atrasadas = [],
  abertas,
  proximas = [],
  lembretes = [],
  pendentes = 0,
}: Mundo) {
  const todas = abertas ?? [...atrasadas, ...hoje.filter((t) => t.estado === "aberta"), ...proximas];
  falso.servidor = {
    "config.obter": { config: { dia: { fuso: "America/Sao_Paulo" } }, portable: false, falhasAtalhos: {} },
    "areas.contagens": {
      tarefasPendentes: pendentes,
      lembretesAtrasados: 0,
      sessoesEsperando: 0,
      devPrecisando: 0,
    },
    "listas.listar": LISTAS,
    "tarefas.listar": (pedido: { vista?: string }) =>
      pedido.vista === "hoje"
        ? hoje
        : pedido.vista === "atrasadas"
          ? atrasadas
          : pedido.vista === "proximas"
            ? proximas
            : todas,
    "lembretes.listar": lembretes,
    "tarefas.concluir": { tarefa: hoje[0], proxima: null },
    "tarefas.reabrir": hoje[0],
    "tarefas.ordenar": [],
    "tarefas.adiar": [],
    "lembretes.concluir": { lembretes: [], removidos: [] },
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () =>
    raiz!.render(
      <AcoesSistemaContexto.Provider value={{ ir: () => undefined, aoMudarPrimeiroUso: () => undefined }}>
        <Tarefas />
      </AcoesSistemaContexto.Provider>,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(AGORA);
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) => todos("button").find((b) => b.textContent === texto);
const item = (nome: string) => todos(".navegacao-item").find((b) => b.textContent?.startsWith(nome));
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
const grupos = () =>
  todos(".tarefas-grupo").map((g) => [
    g.querySelector("h2")?.textContent,
    [...g.querySelectorAll(".tarefa-titulo")].map((t) => t.textContent),
  ]);
const avisar = (evento: string, dados: unknown) =>
  act(async () => falso.ouvintes.get(evento)?.forEach((fn) => fn(dados)));

async function digitar(texto: string) {
  const campo = por(".tarefas-frase-entrada") as HTMLInputElement;
  await act(async () => {
    const valor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    valor.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return campo;
}

const tecla = (alvo: HTMLElement, key: string, extra: KeyboardEventInit = {}) =>
  act(async () => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
  });

const previa = (campos: Partial<PreviaCaptura["campos"]> = {}, extra: Partial<PreviaCaptura> = {}) =>
  ({
    texto: "ligar pro banco amanhã 15h",
    tipo: "tarefa",
    campos: {
      titulo: "ligar pro banco",
      dia: "2026-10-09",
      hora: "15:00",
      duracaoMin: null,
      recorrencia: null,
      lembreteMinutosAntes: null,
      listaId: "pessoal",
      valorCentavos: null,
      ...campos,
    },
    trechos: [{ campo: "dia", inicio: 16, fim: 22 }],
    alternativas: ["lembrete", "evento", "nota"],
    aviso: null,
    entendidoPor: "codigo",
    ...extra,
  }) satisfies PreviaCaptura;

describe("Tarefas vazia", () => {
  it("explica como começar, com o campo pronto para a primeira frase", async () => {
    responder({});
    await montar();
    expect(por(".pagina-titulo")?.textContent).toBe("Hoje");
    expect(por(".pagina-data")?.textContent).toBe("Quinta, 8 de outubro");
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nenhuma tarefa ainda");
    expect(por(".estado-vazio-texto")?.textContent).toContain("“ligar pro banco amanhã 15h”");
    expect(por(".estado-vazio-texto")?.textContent).toContain("Enter cria, Esc limpa");
    expect(por(".tarefas-frase-entrada")).not.toBeNull();
    // A lista arquivada não aparece na sub-navegação.
    expect(todos(".navegacao-item").map((b) => b.textContent)).toEqual([
      "Hoje",
      "Próximos 7 dias",
      "Todas",
      "Lembretes",
      "Entrada",
      "Trabalho",
      "Pessoal",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("a leitura que falha diz isso, com a Alba, e tenta de novo", async () => {
    falso.servidor = {};
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("O serviço não respondeu");
    expect(por(".estado-vazio-texto")?.textContent).toContain("as suas tarefas");
    expect(por("[data-agente]")?.dataset.agente).toBe("alba");
    responder({});
    await act(async () => botao("Tentar de novo")!.click());
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nenhuma tarefa ainda");
  });
});

describe("Tarefas · Hoje", () => {
  const atrasada = tarefa({
    id: "a1",
    titulo: "Enviar documentos do aluguel",
    venceEm: "2026-10-07",
    listaId: "pessoal",
  });
  const daily = tarefa({
    id: "h1",
    titulo: "Daily",
    hora: "09:30",
    listaId: "trabalho",
    estado: "feita",
    concluidaEm: "2026-10-08T12:40:00.000Z",
  });
  const contador = tarefa({ id: "h2", titulo: "Ligar para o contador", hora: "15:00", prioridade: 3 });
  const plantas = tarefa({ id: "h3", titulo: "Regar as plantas" });
  const comprovantes = tarefa({ id: "h4", titulo: "Separar comprovantes" });

  it("mostra as atrasadas no alto, os períodos, o progresso e as contagens", async () => {
    responder({ hoje: [daily, contador, plantas], atrasadas: [atrasada], pendentes: 3 });
    await montar();
    expect(grupos()).toEqual([
      ["Atrasada", ["Enviar documentos do aluguel"]],
      ["Manhã", ["Daily"]],
      ["Tarde", ["Ligar para o contador"]],
      ["Sem hora", ["Regar as plantas"]],
    ]);
    expect(por(".pagina-cabecalho .tarefas-rotulo")?.textContent).toBe("1 de 4 feitas");
    expect(por('[data-tarefa="a1"] .tarefa-nota')?.textContent).toBe("veio de ontem");
    expect(por('[data-tarefa="a1"] .tarefa-lista')?.textContent).toBe("Pessoal");
    expect(por('[data-tarefa="h2"] .tarefa-quando')?.textContent).toBe("15:00");
    expect(por('[data-tarefa="h2"] .tarefa-prioridade')?.textContent).toBe("prioridade alta");
    expect(por('[data-tarefa="h1"]')?.hasAttribute("data-feita")).toBe(true);
    // Hoje conta pelo serviço; as outras, pelas abertas que a vista mostra.
    expect(item("Hoje")?.getAttribute("aria-label")).toBe("Hoje, 3 tarefas pendentes");
    expect(item("Todas")?.getAttribute("aria-label")).toBe("Todas, 3 tarefas abertas");
    expect(item("Pessoal")?.getAttribute("aria-label")).toBe("Pessoal, 1 tarefa aberta");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("marcar conclui; desmarcar a feita reabre", async () => {
    responder({ hoje: [daily, contador] });
    await montar();
    await act(async () => por('[data-tarefa="h2"] [role="checkbox"]')!.click());
    expect(pedidosDe("tarefas.concluir")).toEqual([{ id: "h2" }]);
    await act(async () => por('[data-tarefa="h1"] [role="checkbox"]')!.click());
    expect(pedidosDe("tarefas.reabrir")).toEqual([{ id: "h1" }]);
  });

  it("a recusa do serviço aparece no alto, como veio", async () => {
    responder({ hoje: [contador] });
    const { RecusaDoServico } = await import("@moductus/contrato/cliente");
    falso.servidor["tarefas.concluir"] = () => {
      throw new RecusaDoServico("tarefa não encontrada");
    };
    await montar();
    await act(async () => por('[data-tarefa="h2"] [role="checkbox"]')!.click());
    expect(por(".tarefas-erro")?.getAttribute("role")).toBe("alert");
    expect(por(".tarefas-erro")?.textContent).toBe("Tarefa não encontrada");
  });

  it("Alt+↓ e Alt+↑ mudam a ordem dentro do grupo, entre as da mesma hora", async () => {
    responder({ hoje: [plantas, comprovantes, contador] });
    await montar();
    const caixa = por('[data-tarefa="h3"] [role="checkbox"]')!;
    await tecla(caixa, "ArrowDown", { altKey: true });
    expect(pedidosDe("tarefas.ordenar")).toEqual([{ ids: ["h4", "h3"] }]);
    // Sem vizinha da mesma hora, nada muda.
    await tecla(por('[data-tarefa="h2"] [role="checkbox"]')!, "ArrowUp", { altKey: true });
    await tecla(caixa, "ArrowUp", { altKey: true });
    expect(pedidosDe("tarefas.ordenar")).toHaveLength(1);
    // Seta sem Alt não ordena.
    await tecla(por('[data-tarefa="h4"] [role="checkbox"]')!, "ArrowUp");
    expect(pedidosDe("tarefas.ordenar")).toHaveLength(1);
  });

  it("as atrasadas vêm para hoje de uma vez", async () => {
    const outra = tarefa({ id: "a2", titulo: "Outra", venceEm: "2026-10-01" });
    responder({ hoje: [contador], atrasadas: [atrasada, outra] });
    await montar();
    await act(async () => botao("Trazer para hoje")!.click());
    expect(pedidosDe("tarefas.adiar")).toEqual([{ ids: ["a2", "a1"], para: "hoje" }]);
  });

  it("o que muda em qualquer lugar chega pelo tarefas.mudou e a vista recarrega", async () => {
    responder({ hoje: [contador] });
    await montar();
    responder({ hoje: [contador, plantas] });
    await avisar("tarefas.mudou", { tarefas: [plantas], apagadas: [] });
    expect(grupos()).toEqual([
      ["Tarde", ["Ligar para o contador"]],
      ["Sem hora", ["Regar as plantas"]],
    ]);
  });
});

describe("Tarefas · o campo em linguagem natural", () => {
  it("mostra o Entendi antes do Enter e lança o que mostrou", async () => {
    responder({});
    falso.servidor["captura.entender"] = previa();
    falso.servidor["captura.lancar"] = {
      id: "c1",
      tipo: "tarefa",
      itemId: "t9",
      desfazerAte: new Date(AGORA.getTime() + 10_000).toISOString(),
    };
    falso.servidor["captura.desfazer"] = falso.servidor["captura.lancar"];
    await montar();
    const campo = await digitar("ligar pro banco amanhã 15h");
    expect(pedidosDe("captura.entender")).toEqual([]);
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    expect(pedidosDe("captura.entender")).toEqual([{ texto: "ligar pro banco amanhã 15h" }]);
    expect(por(".tarefas-entendi")?.textContent).toBe(
      "Entendi:tarefasexta, 9 out15:00lembrete 15 min antesPessoal",
    );
    expect(campo.getAttribute("aria-describedby")).toBe(por(".tarefas-entendi")?.id);
    expect(auditar(recipiente)).toEqual([]);

    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")).toEqual([
      { texto: "ligar pro banco amanhã 15h", tipo: "tarefa", campos: previa().campos },
    ]);
    expect(campo.value).toBe("");
    expect(por(".tarefas-entendi")).toBeNull();
    expect(por('[role="status"]')?.textContent).toContain("Tarefa criada: ligar pro banco.");

    await act(async () => botao("Desfazer")!.click());
    expect(pedidosDe("captura.desfazer")).toEqual([{ id: "c1" }]);
    expect(botao("Desfazer")).toBeUndefined();
  });

  it("no Hoje, a frase sem dia fica para hoje e o Entendi já diz isso", async () => {
    responder({});
    falso.servidor["captura.entender"] = previa(
      { titulo: "comprar pão", dia: null, hora: null, listaId: null },
      { texto: "comprar pão", trechos: [] },
    );
    falso.servidor["captura.lancar"] = {
      id: "c2",
      tipo: "tarefa",
      itemId: "t10",
      desfazerAte: AGORA.toISOString(),
    };
    await montar();
    const campo = await digitar("comprar pão");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    expect(por(".tarefas-entendi")?.textContent).toBe("Entendi:tarefaquinta, 8 outEntrada");
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")[0]).toMatchObject({ campos: { dia: HOJE, listaId: null } });
  });

  it("o modelo só entra depois da pausa longa e só na frase que o código não entendeu", async () => {
    responder({});
    falso.servidor["captura.entender"] = (p: { texto: string }) =>
      p.texto === "algo vago"
        ? previa(
            { titulo: "algo vago", dia: null, hora: null, listaId: null },
            { texto: p.texto, trechos: [] },
          )
        : previa();
    await montar();
    await digitar("ligar pro banco amanhã 15h");
    await act(async () => vi.advanceTimersByTime(PAUSA_MODELO_MS + 100));
    expect(pedidosDe("captura.entender")).toEqual([{ texto: "ligar pro banco amanhã 15h" }]);

    await digitar("algo vago");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    await act(async () => vi.advanceTimersByTime(PAUSA_MODELO_MS - ESPERA_PREVIA_MS - 1));
    expect(pedidosDe("captura.entender")).toHaveLength(2);
    await act(async () => vi.advanceTimersByTime(1));
    expect(pedidosDe("captura.entender").at(-1)).toEqual({ texto: "algo vago", comModelo: true });
  });

  it("Esc limpa a frase; a recusa do lançamento aparece embaixo do campo", async () => {
    responder({});
    const { RecusaDoServico } = await import("@moductus/contrato/cliente");
    falso.servidor["captura.entender"] = previa({}, { tipo: "lembrete" });
    falso.servidor["captura.lancar"] = () => {
      throw new RecusaDoServico("O lembrete precisa de dia e hora: preencha com Tab.");
    };
    await montar();
    const campo = await digitar("me lembra");
    // Enter antes da prévia: entende na hora e lança o que entendeu.
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")[0]).toMatchObject({ tipo: "lembrete" });
    expect(por(".tarefas-frase-erro")?.textContent).toBe(
      "O lembrete precisa de dia e hora: preencha com Tab.",
    );
    expect(campo.value).toBe("me lembra");
    await tecla(campo, "Escape");
    expect(campo.value).toBe("");
    expect(por(".tarefas-frase-erro")).toBeNull();
  });
});

describe("Tarefas · outras vistas", () => {
  it("uma lista mostra só as dela, sem a coluna da lista, e a frase vai para ela", async () => {
    const trabalho = tarefa({ id: "w1", titulo: "Planejamento", listaId: "trabalho", venceEm: null });
    const pessoal = tarefa({ id: "p1", titulo: "Academia", listaId: "pessoal", venceEm: null });
    responder({ abertas: [trabalho, pessoal] });
    falso.servidor["captura.entender"] = previa({ listaId: null, dia: null, hora: null });
    falso.servidor["captura.lancar"] = {
      id: "c3",
      tipo: "tarefa",
      itemId: "t11",
      desfazerAte: AGORA.toISOString(),
    };
    await montar();
    await act(async () => item("Trabalho")!.click());
    expect(por(".pagina-titulo")?.textContent).toBe("Trabalho");
    expect(grupos()).toEqual([["Sem data", ["Planejamento"]]]);
    expect(por(".tarefa-lista")).toBeNull();
    expect(item("Trabalho")?.getAttribute("aria-current")).toBe("page");
    const campo = await digitar("ligar pro banco");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    expect(por(".tarefas-entendi")?.textContent).toBe("Entendi:tarefaTrabalho");
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")[0]).toMatchObject({ campos: { listaId: "trabalho", dia: null } });
  });

  it("lista sem nada aberta explica para onde vai a frase", async () => {
    responder({ abertas: [tarefa({ listaId: "trabalho" })] });
    await montar();
    await act(async () => item("Pessoal")!.click());
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nada aberto em Pessoal");
  });

  it("Próximos 7 dias agrupa por dia e conta só o que cabe na semana", async () => {
    responder({
      proximas: [
        tarefa({ titulo: "Mercado", venceEm: "2026-10-09", hora: "18:00" }),
        tarefa({ titulo: "Longe", venceEm: "2026-11-20" }),
      ],
    });
    await montar();
    expect(item("Próximos 7 dias")?.getAttribute("aria-label")).toBe("Próximos 7 dias, 1 tarefa aberta");
    await act(async () => item("Próximos 7 dias")!.click());
    expect(grupos()).toEqual([["Amanhã", ["Mercado"]]]);
    expect(por(".tarefa-quando")?.textContent).toBe("18:00");
  });

  it("Nova lista: Enter cria e abre a lista; Esc desiste", async () => {
    responder({ abertas: [tarefa()] });
    const viagem: Lista = { id: "viagem", nome: "Viagem de dezembro", ordem: 4, cor: null, arquivada: false };
    falso.servidor["listas.criar"] = viagem;
    await montar();
    const abrir = por('button[aria-label="Nova lista"]')!;
    await act(async () => abrir.click());
    expect(abrir.getAttribute("aria-expanded")).toBe("true");
    const nome = por(".tarefas-nova-lista input") as HTMLInputElement;
    await tecla(nome, "Escape");
    expect(por(".tarefas-nova-lista")).toBeNull();

    await act(async () => abrir.click());
    const campo = por(".tarefas-nova-lista input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        campo,
        "Viagem de dezembro",
      );
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    falso.servidor["listas.listar"] = [...LISTAS, viagem];
    await tecla(campo, "Enter");
    expect(pedidosDe("listas.criar")).toEqual([{ nome: "Viagem de dezembro" }]);
    await avisar("listas.mudou", [...LISTAS, viagem]);
    expect(por(".pagina-titulo")?.textContent).toBe("Viagem de dezembro");
  });

  it("Lembretes mostra os vivos na ordem em que tocam e marcar é o Feito", async () => {
    responder({ lembretes: [lembrete({ id: "l1" })] });
    await montar();
    await act(async () => item("Lembretes")!.click());
    expect(grupos()).toEqual([["Hoje", ["Beber água"]]]);
    expect(por(".tarefa-quando")?.textContent).toBe("15:00");
    await act(async () => por('[role="checkbox"]')!.click());
    expect(pedidosDe("lembretes.concluir")).toEqual([{ ids: ["l1"] }]);
    expect(auditar(recipiente)).toEqual([]);
  });
});
