// @vitest-environment happy-dom
import type {
  Agenda,
  Calendario,
  Conexao,
  DiaDaAgenda,
  Lembrete,
  Lista,
  Ocorrencia,
  PreviaCaptura,
  Tarefa,
} from "@moductus/contrato";
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
  agenda?: Agenda;
  calendarios?: Calendario[];
  google?: Conexao | null;
}

const conexaoGoogle = (estado: Conexao["estado"]): Conexao => ({
  tipo: "google-agenda",
  estado,
  conta: estado === "desligada" ? null : "voce@exemplo.com",
  ultimoErro: null,
  conectadaEm: estado === "desligada" ? null : "2026-10-01T12:00:00.000Z",
});

const CALENDARIO_LOCAL: Calendario = {
  id: "local",
  nome: "Local",
  fonte: "local",
  cor: null,
  espelho: false,
  podeEscrever: true,
  ler: true,
  sincronizadoEm: null,
};

const diaDaAgenda = (extra: Partial<DiaDaAgenda> = {}): DiaDaAgenda => ({
  dia: "2026-10-08",
  livres: [],
  livreMin: 0,
  planejadoMin: 0,
  cheio: false,
  sugestoes: [],
  ...extra,
});

function responder({
  hoje = [],
  atrasadas = [],
  abertas,
  proximas = [],
  lembretes = [],
  pendentes = 0,
  agenda = { ocorrencias: [], dias: [diaDaAgenda()] },
  calendarios = [CALENDARIO_LOCAL],
  google = conexaoGoogle("desligada"),
}: Mundo) {
  const todas = abertas ?? [...atrasadas, ...hoje.filter((t) => t.estado === "aberta"), ...proximas];
  falso.servidor = {
    // Um expediente diferente do de fábrica (9h às 18h), para a régua mostrar que é o da configuração.
    "config.obter": {
      config: { dia: { fuso: "America/Sao_Paulo", expediente: { inicio: "08:00", fim: "17:00" } } },
      portable: false,
      falhasAtalhos: {},
    },
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
    "agenda.consultar": agenda,
    "agenda.calendarios": calendarios,
    "conexoes.listar": google ? [google] : [],
  };
}

const ir = vi.fn();

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () =>
    raiz!.render(
      <AcoesSistemaContexto.Provider value={{ ir, aoMudarPrimeiroUso: () => undefined }}>
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
  ir.mockClear();
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
// Os avisos do mesmo instante viram uma recarga só, no próximo giro do relógio.
const avisar = (evento: string, dados: unknown) =>
  act(async () => {
    falso.ouvintes.get(evento)?.forEach((fn) => fn(dados));
    vi.advanceTimersByTime(0);
  });

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

  it("Alt+seta devolve o foco à tarefa movida uma vez só, quando a ordem nova chega", async () => {
    responder({ hoje: [plantas, comprovantes] });
    await montar();
    const caixa = () => por('[data-tarefa="h3"] [role="checkbox"]')!;
    caixa().focus();
    await tecla(caixa(), "ArrowDown", { altKey: true });
    caixa().blur();
    responder({ hoje: [comprovantes, plantas] });
    await avisar("tarefas.mudou", { tarefas: [], apagadas: [] });
    expect(todos(".tarefa").map((l) => l.dataset.tarefa)).toEqual(["h4", "h3"]);
    expect(document.activeElement).toBe(caixa());
    // Depois disso, a pessoa vai para outro lugar e nada puxa o foco de volta.
    caixa().blur();
    responder({ hoje: [plantas, comprovantes] });
    await avisar("tarefas.mudou", { tarefas: [], apagadas: [] });
    expect(document.activeElement).toBe(document.body);
  });

  it("avisos do mesmo instante viram uma recarga; lembretes.mudou recarrega só os lembretes", async () => {
    responder({ hoje: [contador] });
    await montar();
    const antes = pedidosDe("tarefas.listar").length;
    await act(async () => {
      falso.ouvintes.get("tarefas.mudou")?.forEach((fn) => fn({ tarefas: [], apagadas: [] }));
      falso.ouvintes.get("listas.mudou")?.forEach((fn) => fn(LISTAS));
      vi.advanceTimersByTime(0);
    });
    expect(pedidosDe("tarefas.listar").length - antes).toBe(4);
    const lembretes = pedidosDe("lembretes.listar").length;
    await avisar("lembretes.mudou", { lembretes: [], removidos: [] });
    expect(pedidosDe("tarefas.listar").length - antes).toBe(4);
    expect(pedidosDe("lembretes.listar").length).toBe(lembretes + 1);
  });

  it("à meia-noite e com outro fuso que muda o dia, os recortes são pedidos de novo", async () => {
    // 23:59:30 de quinta em São Paulo.
    vi.setSystemTime(new Date("2026-10-09T02:59:30.000Z"));
    responder({ hoje: [contador] });
    await montar();
    const antes = pedidosDe("tarefas.listar").length;
    // Os recortes do dia novo demoram: até chegarem, a tela fica no dia dos que estão nela.
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((r) => (soltar = r));
    const listar = falso.servidor["tarefas.listar"] as (p: unknown) => unknown;
    falso.servidor["tarefas.listar"] = (p: unknown) => segura.then(() => listar(p));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(pedidosDe("tarefas.listar").length - antes).toBe(4);
    expect(por(".pagina-data")?.textContent).toBe("Quinta, 8 de outubro");
    await act(async () => soltar());
    expect(por(".pagina-data")?.textContent).toBe("Sexta, 9 de outubro");
    falso.servidor["tarefas.listar"] = listar;
    // O mesmo fuso não recarrega; um fuso em que ainda é quinta, sim.
    await avisar("config.mudou", { config: { dia: { fuso: "America/Sao_Paulo" } } });
    expect(pedidosDe("tarefas.listar").length - antes).toBe(4);
    await avisar("config.mudou", { config: { dia: { fuso: "America/Los_Angeles" } } });
    expect(pedidosDe("tarefas.listar").length - antes).toBe(8);
    expect(por(".pagina-data")?.textContent).toBe("Quinta, 8 de outubro");
  });

  it("a subtarefa de amanhã com a mãe longe aparece em Próximos e conta na lateral", async () => {
    const longe = tarefa({ id: "m1", titulo: "Mudança", venceEm: "2026-10-30" });
    const filha = tarefa({ id: "f1", titulo: "Separar caixas", tarefaPaiId: "m1", venceEm: "2026-10-09" });
    responder({ proximas: [longe, filha] });
    await montar();
    expect(item("Próximos 7 dias")?.getAttribute("aria-label")).toBe("Próximos 7 dias, 1 tarefa aberta");
    await act(async () => item("Próximos 7 dias")!.click());
    expect(grupos()).toEqual([["Amanhã", ["Separar caixas"]]]);
  });

  it("lembretes que falham antes dos recortes chegarem não deixam a tela presa esperando", async () => {
    responder({ hoje: [contador] });
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((r) => (soltar = r));
    const listar = falso.servidor["tarefas.listar"] as (p: unknown) => unknown;
    falso.servidor["tarefas.listar"] = (p: unknown) => segura.then(() => listar(p));
    delete falso.servidor["lembretes.listar"];
    await montar();
    await act(async () => soltar());
    expect(por(".estado-vazio-titulo")?.textContent).toBe("O serviço não respondeu");
    falso.servidor["lembretes.listar"] = [];
    await act(async () => botao("Tentar de novo")!.click());
    expect(grupos()).toEqual([["Tarde", ["Ligar para o contador"]]]);
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
    const campo = await digitar("ligar pro banco amanhã 15h");
    // Enter antes da prévia: entende na hora e mostra; quem lança é o segundo Enter.
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")).toEqual([]);
    expect(por(".tarefas-entendi")?.textContent).toBe("Entendi:lembretesexta, 9 out15:00");
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")[0]).toMatchObject({ tipo: "lembrete" });
    expect(por(".tarefas-frase-erro")?.textContent).toBe(
      "O lembrete precisa de dia e hora: preencha com Tab.",
    );
    expect(campo.value).toBe("ligar pro banco amanhã 15h");
    await tecla(campo, "Escape");
    expect(campo.value).toBe("");
    expect(por(".tarefas-frase-erro")).toBeNull();
  });

  it("o Entendi some quando a frase muda, e o Enter com ele velho só mostra o novo", async () => {
    responder({});
    falso.servidor["captura.entender"] = (p: { texto: string }) =>
      p.texto === "ligar pro banco amanhã 15h" ? previa() : previa({ hora: "16:00" }, { texto: p.texto });
    falso.servidor["captura.lancar"] = {
      id: "c4",
      tipo: "tarefa",
      itemId: "t12",
      desfazerAte: AGORA.toISOString(),
    };
    await montar();
    await digitar("ligar pro banco amanhã 15h");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    expect(por(".tarefas-entendi")?.textContent).toContain("15:00");
    const campo = await digitar("ligar pro banco amanhã 16h");
    // A prévia da frase velha não fica na tela.
    expect(por(".tarefas-entendi")).toBeNull();
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")).toEqual([]);
    expect(por(".tarefas-entendi")?.textContent).toContain("16:00");
    await tecla(campo, "Enter");
    expect(pedidosDe("captura.lancar")[0]).toMatchObject({ campos: { hora: "16:00" } });
  });

  it("o que a pessoa digita enquanto o lançamento vai não é apagado quando ele volta", async () => {
    responder({});
    falso.servidor["captura.entender"] = previa();
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((r) => (soltar = r));
    falso.servidor["captura.lancar"] = () =>
      segura.then(() => ({ id: "c6", tipo: "tarefa", itemId: "t14", desfazerAte: AGORA.toISOString() }));
    await montar();
    const campo = await digitar("ligar pro banco amanhã 15h");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    await tecla(campo, "Enter");
    await digitar("comprar pão");
    await act(async () => soltar());
    expect(campo.value).toBe("comprar pão");
    expect(por('[role="status"]')?.textContent).toContain("Tarefa criada: ligar pro banco.");
  });

  it("trocar de vista não apaga a frase nem o Desfazer; o status fica montado", async () => {
    responder({});
    falso.servidor["captura.entender"] = previa();
    falso.servidor["captura.lancar"] = {
      id: "c5",
      tipo: "tarefa",
      itemId: "t13",
      desfazerAte: new Date(AGORA.getTime() + 10_000).toISOString(),
    };
    await montar();
    expect(por('.tarefas-frase [role="status"]')).not.toBeNull();
    const campo = await digitar("ligar pro banco amanhã 15h");
    await act(async () => vi.advanceTimersByTime(ESPERA_PREVIA_MS));
    await tecla(campo, "Enter");
    await act(async () => item("Próximos 7 dias")!.click());
    expect(por(".pagina-titulo")?.textContent).toBe("Próximos 7 dias");
    expect(botao("Desfazer")).not.toBeUndefined();
    await digitar("comprar pão");
    await act(async () => item("Todas")!.click());
    expect((por(".tarefas-frase-entrada") as HTMLInputElement).value).toBe("comprar pão");
  });
});

describe("Tarefas · outras vistas", () => {
  it("uma lista mostra só as dela, sem a coluna da lista, e a frase vai para ela", async () => {
    const trabalho = tarefa({ id: "w1", titulo: "Planejamento", listaId: "trabalho", venceEm: null });
    const pessoal = tarefa({ id: "p1", titulo: "Academia", listaId: "pessoal", venceEm: null });
    responder({ abertas: [trabalho, pessoal] });
    falso.servidor["captura.entender"] = previa(
      { listaId: null, dia: null, hora: null },
      { texto: "ligar pro banco" },
    );
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

describe("Tarefas · a coluna Agenda", () => {
  /** Um instante na hora de São Paulo (UTC−3), no dia 8. */
  const as = (hora: string) =>
    `2026-10-08T${String(Number(hora.slice(0, 2)) + 3).padStart(2, "0")}:${hora.slice(3)}:00.000Z`;
  const ocorrencia = (extra: Partial<Ocorrencia>): Ocorrencia => ({
    eventoId: "e1",
    calendarioId: "local",
    titulo: "Daily",
    inicio: as("09:30"),
    fim: as("10:00"),
    diaInteiro: false,
    local: null,
    recorrente: false,
    editavel: true,
    ...extra,
  });
  const ESPELHO: Calendario = {
    ...CALENDARIO_LOCAL,
    id: "m",
    nome: "Moductus",
    fonte: "google",
    espelho: true,
  };
  const comprovantes = tarefa({ id: "c1", titulo: "Separar comprovantes" });
  const planilha = tarefa({ id: "c2", titulo: "Revisar a planilha" });
  const sugestao = { tarefaId: "c1", inicio: as("15:00"), fim: as("16:00") };
  const comSugestao = (): Agenda => ({
    ocorrencias: [ocorrencia({})],
    dias: [
      diaDaAgenda({
        livres: [{ inicio: as("15:00"), fim: as("17:00"), minutos: 120 }],
        sugestoes: [sugestao],
      }),
    ],
  });
  const aplicada = (extra: object = {}) => ({
    evento: { id: "ev1" },
    chamadaId: "01CHAMADA",
    desfazerAte: new Date(AGORA.getTime() + 86_400_000).toISOString(),
    ...extra,
  });
  const blocos = () =>
    todos(".tarefas-agenda-bloco").map((b) => [
      b.dataset.tipo,
      b.querySelector(".tarefas-agenda-bloco-nome")?.textContent,
      b.querySelector(".tarefas-agenda-bloco-hora")?.textContent,
    ]);
  const fala = () => por(".tarefas-agenda-sugestao .fala-texto")?.textContent;
  const horas = () => todos(".tarefas-agenda-hora-rotulo").map((h) => h.textContent);

  it("com o Google, mostra o local, o Moductus e os lidos, na régua do expediente, com a linha de agora", async () => {
    responder({
      agenda: {
        ocorrencias: [
          ocorrencia({
            eventoId: "p",
            calendarioId: "g1",
            titulo: "Planejamento",
            inicio: as("11:00"),
            fim: as("12:00"),
          }),
          ocorrencia({}),
        ],
        dias: [diaDaAgenda()],
      },
      calendarios: [
        CALENDARIO_LOCAL,
        ESPELHO,
        { ...CALENDARIO_LOCAL, id: "g1", nome: "Trabalho", fonte: "google", podeEscrever: false },
      ],
      google: conexaoGoogle("ligada"),
    });
    await montar();
    expect(pedidosDe("agenda.consultar")).toEqual([{ de: HOJE, ate: HOJE }]);
    expect(por(".tarefas-agenda-cabeca")?.textContent).toBe("AgendaGoogle · Moductus");
    expect(blocos()).toEqual([
      ["evento", "Daily", "9:30–10h"],
      ["evento", "Planejamento", "11h–12h"],
    ]);
    // O expediente da configuração (8h às 17h), não o de fábrica.
    expect(horas()).toEqual(["8h", "9h", "10h", "11h", "12h", "13h", "14h", "15h", "16h"]);
    // 11:00 está a 3 h do começo da régua.
    expect(por(".tarefas-agenda-agora")?.style.getPropertyValue("--inicio")).toBe("3");
    // Abaixo de uma hora, nome e hora numa linha.
    expect(por(".tarefas-agenda-bloco")?.hasAttribute("data-curto")).toBe(true);
    expect(todos(".tarefas-agenda-bloco")[1]?.hasAttribute("data-curto")).toBe(false);
    expect(por(".tarefas-agenda-convite")).toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("com a conexão desligada e o Moductus ainda no banco, só o local e o convite para conectar", async () => {
    responder({
      agenda: {
        ocorrencias: [
          ocorrencia({}),
          ocorrencia({ eventoId: "m1", calendarioId: "m", titulo: "Do espelho" }),
        ],
        dias: [diaDaAgenda()],
      },
      calendarios: [CALENDARIO_LOCAL, ESPELHO],
      google: conexaoGoogle("desligada"),
    });
    await montar();
    expect(por(".tarefas-agenda-cabeca")?.textContent).toBe("AgendaLocal");
    expect(blocos()).toEqual([["evento", "Daily", "9:30–10h"]]);
    expect(por(".tarefas-agenda-convite")?.textContent).toContain("Conecte o Google Agenda");
    await act(async () => botao("Abrir Conexões")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "conexoes" });
    // Conectar em Conexões chega pelo conexoes.mudou: o convite sai e o espelho entra.
    await avisar("conexoes.mudou", conexaoGoogle("ligada"));
    expect(por(".tarefas-agenda-cabeca")?.textContent).toBe("AgendaGoogle · Moductus");
    expect(blocos()).toHaveLength(2);
    expect(por(".tarefas-agenda-convite")).toBeNull();
  });

  it("a sugestão fica tracejada e só vira compromisso com o clique, que espera a resposta e dá para desfazer", async () => {
    responder({ hoje: [comprovantes], agenda: comSugestao() });
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((r) => (soltar = r));
    falso.servidor["agenda.aplicarSugestao"] = () => segura.then(() => aplicada());
    falso.servidor["execucoes.desfazer"] = {};
    await montar();
    expect(blocos()).toContainEqual(["sugestao", "Sugestão: Separar comprovantes", "15h–16h"]);
    expect(por(".tarefas-agenda-sugestao .fala-nome")?.textContent).toBe("Alba");
    expect(fala()).toBe("O bloco das 15h está livre. Coloquei “Separar comprovantes” ali como sugestão.");
    // Nada foi aplicado só por mostrar.
    expect(pedidosDe("agenda.aplicarSugestao")).toEqual([]);
    await act(async () => botao("Guardar o bloco")!.click());
    // Enquanto o pedido corre, o botão não aceita um segundo clique.
    expect(botao("Guardar o bloco")!.disabled).toBe(true);
    await act(async () => botao("Guardar o bloco")!.click());
    expect(pedidosDe("agenda.aplicarSugestao")).toEqual([sugestao]);
    await act(async () => soltar());
    expect(fala()).toBe("Guardei das 15h às 16h para “Separar comprovantes”.");
    expect(blocos().some(([tipo]) => tipo === "sugestao")).toBe(false);
    await act(async () => botao("Desfazer")!.click());
    expect(pedidosDe("execucoes.desfazer")).toEqual([{ chamadaId: "01CHAMADA" }]);
    expect(fala()).toContain("Coloquei");
  });

  it("o Guardei acaba na releitura depois da que trouxe o compromisso, e o próximo encaixe aparece", async () => {
    responder({ hoje: [comprovantes, planilha], agenda: comSugestao() });
    falso.servidor["agenda.aplicarSugestao"] = aplicada();
    await montar();
    await act(async () => botao("Guardar o bloco")!.click());
    expect(fala()).toContain("Guardei");
    // A releitura do aviso do serviço traz o compromisso guardado e o encaixe seguinte.
    falso.servidor["agenda.consultar"] = {
      ocorrencias: [
        ocorrencia({}),
        ocorrencia({
          eventoId: "ev1",
          titulo: "Separar comprovantes",
          inicio: as("15:00"),
          fim: as("16:00"),
        }),
      ],
      dias: [
        diaDaAgenda({
          livres: [{ inicio: as("16:00"), fim: as("17:00"), minutos: 60 }],
          sugestoes: [{ tarefaId: "c2", inicio: as("16:00"), fim: as("17:00") }],
        }),
      ],
    };
    await avisar("agenda.mudou", { eventos: [], apagados: [] });
    expect(fala()).toContain("Guardei");
    expect(blocos()).toContainEqual(["evento", "Separar comprovantes", "15h–16h"]);
    await avisar("agenda.mudou", { eventos: [], apagados: [] });
    expect(fala()).toBe("O bloco das 16h está livre. Coloquei “Revisar a planilha” ali como sugestão.");
    expect(botao("Desfazer")).toBeUndefined();
  });

  it("Agora não esconde a sugestão e o erro sem pedir nada; a recusa do serviço aparece na coluna", async () => {
    responder({ hoje: [comprovantes], agenda: comSugestao() });
    const { RecusaDoServico } = await import("@moductus/contrato/cliente");
    falso.servidor["agenda.aplicarSugestao"] = () => {
      throw new RecusaDoServico("a tarefa já está na agenda");
    };
    await montar();
    await act(async () => botao("Guardar o bloco")!.click());
    expect(por(".tarefas-agenda [role='alert']")?.textContent).toBe("A tarefa já está na agenda");
    await act(async () => botao("Agora não")!.click());
    expect(por(".tarefas-agenda-sugestao")).toBeNull();
    expect(por(".tarefas-agenda [role='alert']")).toBeNull();
    expect(blocos()).toEqual([["evento", "Daily", "9:30–10h"]]);
    expect(pedidosDe("agenda.aplicarSugestao")).toHaveLength(1);
  });

  it("relê a cada agenda.mudou; a leitura que falha diz isso e tenta de novo", async () => {
    responder({});
    delete falso.servidor["agenda.consultar"];
    await montar();
    expect(por(".tarefas-agenda-falha")?.textContent).toContain("Não consegui ler a agenda agora.");
    expect(por(".tarefas-agenda-regua")).toBeNull();
    falso.servidor["agenda.consultar"] = { ocorrencias: [], dias: [diaDaAgenda()] };
    await act(async () => botao("Tentar de novo")!.click());
    expect(por(".tarefas-agenda-falha")).toBeNull();
    expect(blocos()).toEqual([]);
    falso.servidor["agenda.consultar"] = { ocorrencias: [ocorrencia({})], dias: [diaDaAgenda()] };
    await avisar("agenda.mudou", { eventos: [], apagados: [] });
    expect(blocos()).toEqual([["evento", "Daily", "9:30–10h"]]);
  });

  it("na virada do dia com a releitura falhando, nada do dia velho fica: nem régua nem encaixe", async () => {
    // 23:59:30 de quinta em São Paulo.
    vi.setSystemTime(new Date("2026-10-09T02:59:30.000Z"));
    responder({ hoje: [comprovantes], agenda: comSugestao() });
    await montar();
    expect(blocos()).toContainEqual(["sugestao", "Sugestão: Separar comprovantes", "15h–16h"]);
    delete falso.servidor["agenda.consultar"];
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(por(".pagina-data")?.textContent).toBe("Sexta, 9 de outubro");
    expect(pedidosDe("agenda.consultar").at(-1)).toEqual({ de: "2026-10-09", ate: "2026-10-09" });
    expect(por(".tarefas-agenda-falha")).not.toBeNull();
    expect(por(".tarefas-agenda-regua")).toBeNull();
    expect(por(".tarefas-agenda-sugestao")).toBeNull();
  });

  it("config.mudou troca a régua pelo expediente novo e relê a agenda", async () => {
    responder({});
    await montar();
    expect(horas()[0]).toBe("8h");
    const antes = pedidosDe("agenda.consultar").length;
    await avisar("config.mudou", {
      config: { dia: { fuso: "America/Sao_Paulo", expediente: { inicio: "10:00", fim: "19:00" } } },
    });
    expect(horas()).toEqual(["10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h", "18h"]);
    expect(pedidosDe("agenda.consultar").length).toBe(antes + 1);
  });
});
