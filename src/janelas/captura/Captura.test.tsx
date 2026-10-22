// @vitest-environment happy-dom
import type { CamposCaptura, PreviaCaptura } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar, marcos } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * A janela da captura sobre um serviço de mentira: cada método responde pelo que o teste deixou em
 * `atender`, e todo pedido fica anotado. Relógio falso para a espera da prévia, a pausa do modelo e
 * o prazo do desfazer.
 */
const comandos: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) => {
    comandos.push(comando);
  }),
}));
vi.mock("../../nativo/eventos.ts", () => ({
  registrar: () => undefined,
  useServico: () => ({ estado: "pronto", porta: 1, token: "x" }),
}));

type Atendente = (dados: unknown) => unknown;
const atender = new Map<string, Atendente>();
const pedidos: { metodo: string; dados: unknown }[] = [];
vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    ouvir: () => () => undefined,
    pedir: vi.fn(async (metodo: string, dados?: unknown) => {
      pedidos.push({ metodo, dados });
      const fn = atender.get(metodo);
      if (!fn) throw new RecusaDoServico(`sem ${metodo}`);
      return fn(dados);
    }),
  },
}));

const { Captura } = await import("./Captura.tsx");

const VAZIOS: CamposCaptura = {
  titulo: "",
  dia: null,
  hora: null,
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: null,
  listaId: null,
  valorCentavos: null,
};

/** O entendedor de mentira: "ligar pro banco amanhã 15h" é tarefa com dia e hora; "45 de mercado" é gasto. */
function entendedor(dados: unknown): PreviaCaptura {
  const { texto } = dados as { texto: string };
  if (texto.startsWith("45")) {
    return {
      texto,
      tipo: "gasto",
      campos: { ...VAZIOS, titulo: "mercado", dia: "2026-10-18", valorCentavos: 4500 },
      trechos: [],
      alternativas: ["tarefa", "nota"],
      aviso: "Gastos chegam com a Tula. Por enquanto, dá para lançar como tarefa ou nota.",
      entendidoPor: "codigo",
    };
  }
  const comData = texto.endsWith("amanhã 15h");
  return {
    texto,
    tipo: "tarefa",
    campos: {
      ...VAZIOS,
      // O ponto final não muda o que se entende: "ligar" e "ligar." dão a mesma prévia.
      titulo: comData ? texto.replace(" amanhã 15h", "") : texto.replace(/\.$/, ""),
      dia: comData ? "2026-10-19" : null,
      hora: comData ? "15:00" : null,
    },
    trechos: [],
    alternativas: ["lembrete", "evento", "nota"],
    aviso: null,
    entendidoPor: "codigo",
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00-03:00"));
  atender.set("config.obter", () => ({
    config: { dia: { fuso: "America/Sao_Paulo" }, atalhos: { captura: "Ctrl+Alt+Space" } },
    portable: false,
    falhasAtalhos: {},
  }));
  atender.set("listas.listar", () => []);
  atender.set("captura.entender", entendedor);
  atender.set("captura.lancar", () => ({
    id: "01LANCAMENTO",
    tipo: "tarefa",
    itemId: "01TAREFA",
    desfazerAte: new Date(Date.now() + 10_000).toISOString(),
  }));
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  comandos.length = 0;
  pedidos.length = 0;
  atender.clear();
  vi.useRealTimers();
});

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Captura />));
}

const frase = () => recipiente.querySelector<HTMLInputElement>('input[aria-label="Captura rápida"]')!;
const texto = (seletor: string) => recipiente.querySelector(seletor)?.textContent ?? null;
const anuncio = () => texto('[aria-live="polite"]');
const pedidosDe = (metodo: string) => pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
const definirValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

async function digitar(entrada: HTMLInputElement, valor: string) {
  await act(async () => {
    definirValor.call(entrada, valor);
    entrada.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function enter() {
  await act(async () => {
    recipiente.querySelector("form")!.requestSubmit();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tecla(key: string, extra: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function campo(rotulo: string): HTMLInputElement | HTMLSelectElement {
  const label = [...recipiente.querySelectorAll("label")].find((l) => l.textContent === rotulo);
  expect(label, `campo ${rotulo}`).toBeTruthy();
  return recipiente.querySelector(`#${CSS.escape(label!.htmlFor)}`)!;
}

describe("a captura entende enquanto a pessoa digita", () => {
  it("a prévia do código chega depois da espera curta, sem o modelo", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    expect(pedidosDe("captura.entender")).toEqual([]);
    await passar(100);
    expect(pedidosDe("captura.entender")).toEqual([{ texto: "ligar pro banco amanhã 15h" }]);
    expect(texto(".captura-entendeu")).toBe("Tarefas entendeu comoTarefa");
    expect((campo("Título") as HTMLInputElement).value).toBe("ligar pro banco");
    expect((campo("Dia") as HTMLInputElement).value).toBe("Amanhã");
    expect((campo("Hora") as HTMLInputElement).value).toBe("15:00");
    expect((campo("Lista") as HTMLSelectElement).value).toBe("");
    expect(
      [...recipiente.querySelectorAll(".captura-alternativas button")].map((b) => b.textContent),
    ).toEqual(["LembreteAlt1", "EventoAlt2", "NotaAlt3"]);
  });

  it("cada tecla só pede ao código; o modelo só depois de 1,5 s parado", async () => {
    await montar();
    await digitar(frase(), "ligar");
    await passar(50);
    await digitar(frase(), "ligar pro");
    await passar(100);
    expect(pedidosDe("captura.entender")).toEqual([{ texto: "ligar pro" }]);
    await passar(1400);
    expect(pedidosDe("captura.entender")).toEqual([
      { texto: "ligar pro" },
      { texto: "ligar pro", comModelo: true },
    ]);
  });

  it("descarta a resposta de uma frase que já não está no campo", async () => {
    let soltar: (p: PreviaCaptura) => void = () => undefined;
    atender.set(
      "captura.entender",
      (dados) => new Promise((pronto) => (soltar = () => pronto(entendedor(dados)))),
    );
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await digitar(frase(), "outra coisa");
    await act(async () => soltar(entendedor({ texto: "ligar pro banco amanhã 15h" })));
    expect(recipiente.querySelector(".captura-corpo")).toBeNull();
  });

  it("acessível: um main com nome, todo controle com nome e as dicas ligadas ao formulário", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    expect(auditar(recipiente)).toEqual([]);
    expect(marcos(recipiente)).toEqual(["main: Captura"]);
    const dicas = recipiente.querySelector("form")!.getAttribute("aria-describedby")!;
    expect(document.getElementById(dicas)?.textContent).toContain("Tab edita um campo");
  });
});

describe("Enter lança e o lançado dá para desfazer", () => {
  it("Enter manda o tipo e os campos da prévia; a janela diz o que criou", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    expect(pedidosDe("captura.lancar")).toEqual([
      {
        texto: "ligar pro banco amanhã 15h",
        tipo: "tarefa",
        campos: { ...VAZIOS, titulo: "ligar pro banco", dia: "2026-10-19", hora: "15:00" },
      },
    ]);
    expect(frase().value).toBe("");
    expect(texto(".captura-lancado-texto")).toBe("Tarefa criada: ligar pro banco");
  });

  it("um Enter só lança uma vez, mesmo com dois seguidos", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await act(async () => {
      recipiente.querySelector("form")!.requestSubmit();
      recipiente.querySelector("form")!.requestSubmit();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pedidosDe("captura.lancar")).toHaveLength(1);
  });

  it("Enter com a prévia de outra frase pede a nova e espera outro Enter se ela mudou", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco");
    await passar(100);
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await enter();
    expect(pedidosDe("captura.lancar")).toEqual([]);
    expect((campo("Dia") as HTMLInputElement).value).toBe("Amanhã");
    await enter();
    expect(pedidosDe("captura.lancar")).toHaveLength(1);
  });

  it("Enter com a prévia atrasada lança direto se a nova diz o mesmo que a tela", async () => {
    await montar();
    await digitar(frase(), "ligar");
    await passar(100);
    await digitar(frase(), "ligar.");
    await enter();
    expect(pedidosDe("captura.entender")).toEqual([{ texto: "ligar" }, { texto: "ligar." }]);
    expect(pedidosDe("captura.lancar")).toEqual([
      { texto: "ligar.", tipo: "tarefa", campos: { ...VAZIOS, titulo: "ligar" } },
    ]);
  });

  it("dois Enter com a prévia atrasada lançam uma vez só", async () => {
    await montar();
    await digitar(frase(), "ligar");
    await passar(100);
    let soltar: () => void = () => undefined;
    atender.set(
      "captura.entender",
      (dados) => new Promise((pronto) => (soltar = () => pronto(entendedor(dados)))),
    );
    await digitar(frase(), "ligar.");
    await act(async () => {
      recipiente.querySelector("form")!.requestSubmit();
      recipiente.querySelector("form")!.requestSubmit();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      soltar();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pedidosDe("captura.lancar")).toHaveLength(1);
  });

  it("a recusa do lançamento continua na tela quando a prévia do modelo chega depois", async () => {
    atender.set("captura.lancar", () => {
      throw new RecusaDoServico("O lembrete precisa de dia e hora: preencha com Tab.");
    });
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    expect(texto('[role="alert"]')).toBe("O lembrete precisa de dia e hora: preencha com Tab.");
    await passar(1500);
    expect(pedidosDe("captura.entender")).toContainEqual({
      texto: "ligar pro banco amanhã 15h",
      comModelo: true,
    });
    expect(texto('[role="alert"]')).toBe("O lembrete precisa de dia e hora: preencha com Tab.");
  });

  it("Ctrl+Z repetido desfaz uma vez só", async () => {
    let soltar: () => void = () => undefined;
    atender.set(
      "captura.desfazer",
      (dados) => new Promise((pronto) => (soltar = () => pronto({ ...(dados as object), tipo: "tarefa" }))),
    );
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    await tecla("z", { ctrlKey: true });
    await tecla("z", { ctrlKey: true });
    await act(async () => soltar());
    expect(pedidosDe("captura.desfazer")).toHaveLength(1);
  });

  it("Desfazer pelo botão e por Ctrl+Z, dentro dos 10 s", async () => {
    atender.set("captura.desfazer", (dados) => ({ ...(dados as object), tipo: "tarefa" }));
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    await tecla("z", { ctrlKey: true });
    expect(pedidosDe("captura.desfazer")).toEqual([{ id: "01LANCAMENTO" }]);
    expect(anuncio()).toBe("Desfeito: a tarefa saiu.");
    expect(recipiente.querySelector(".captura-lancado")).toBeNull();
  });

  it("o desfazer recusado pelo serviço explica por quê e o botão sai", async () => {
    atender.set("captura.desfazer", () => {
      throw new RecusaDoServico("Já passaram os 10 s para desfazer.");
    });
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    const botao = [...recipiente.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Desfazer"),
    )!;
    await act(async () => botao.click());
    expect(texto('[role="alert"]')).toBe("Já passaram os 10 s para desfazer.");
    expect(recipiente.querySelector(".captura-lancado")).toBeNull();
  });

  it("depois dos 10 s o desfazer some da tela", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await enter();
    expect(recipiente.querySelector(".captura-lancado")).not.toBeNull();
    await passar(10_000);
    expect(recipiente.querySelector(".captura-lancado")).toBeNull();
  });

  it("serviço fora do ar: a frase fica e a janela diz por quê", async () => {
    atender.set("captura.entender", () => {
      throw new ServicoIndisponivel();
    });
    await montar();
    await digitar(frase(), "ligar pro banco");
    await passar(100);
    expect(texto('[role="alert"]')).toBe("O Moductus está reconectando. A frase fica aqui até ele voltar.");
    expect(frase().value).toBe("ligar pro banco");
  });
});

describe("Tab corrige um campo e o Na verdade é troca o tipo", () => {
  it("a hora corrigida vai no lançamento", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await digitar(campo("Hora") as HTMLInputElement, "16h30");
    await enter();
    const [lancado] = pedidosDe("captura.lancar") as { campos: CamposCaptura }[];
    expect(lancado!.campos.hora).toBe("16:30");
  });

  it("campo que não se lê marca o erro e não deixa lançar", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await digitar(campo("Hora") as HTMLInputElement, "25h");
    expect(campo("Hora").getAttribute("aria-invalid")).toBe("true");
    expect(texto('[role="alert"]')).toBe("Hora: use HH:MM, como 15:00.");
    expect(recipiente.querySelector(".captura-lancar")!.getAttribute("aria-disabled")).toBe("true");
    await enter();
    expect(pedidosDe("captura.lancar")).toEqual([]);
  });

  it("a correção de um campo que o tipo novo esconde não vale nem bloqueia", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await digitar(campo("Hora") as HTMLInputElement, "25h");
    await tecla("3", { altKey: true });
    expect(texto(".captura-entendeu")).toBe("Vai comoNota");
    expect(recipiente.querySelector('[role="alert"]')).toBeNull();
    expect(recipiente.querySelector(".captura-lancar")!.getAttribute("aria-disabled")).toBe("false");
    await enter();
    const [lancado] = pedidosDe("captura.lancar") as { tipo: string; campos: CamposCaptura }[];
    expect(lancado!.tipo).toBe("nota");
    expect(lancado!.campos.hora).toBe("15:00");
  });

  it("apagar o lembrete no campo não some com o campo", async () => {
    atender.set("captura.entender", (dados) => {
      const p = entendedor(dados);
      return { ...p, campos: { ...p.campos, lembreteMinutosAntes: 15 } };
    });
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await digitar(campo("Lembrete") as HTMLInputElement, "");
    expect((campo("Lembrete") as HTMLInputElement).value).toBe("");
  });

  it("a lista suspensa tem a seta por cima", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    expect(campo("Lista").parentElement!.querySelector(".icone")).not.toBeNull();
  });

  it("Alt+2 troca para evento, que mostra a duração, e o Enter lança como evento", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await tecla("2", { altKey: true });
    expect(texto(".captura-entendeu")).toBe("Vai comoEvento");
    expect(recipiente.querySelector('label[for$="duracaoMin"]')).not.toBeNull();
    await enter();
    expect((pedidosDe("captura.lancar")[0] as { tipo: string }).tipo).toBe("evento");
  });

  it("gasto ainda não se lança: avisa, e o Enter só vai depois de escolher tarefa ou nota", async () => {
    await montar();
    await digitar(frase(), "45 de mercado no débito");
    await passar(100);
    expect(texto(".captura-entendeu")).toBe("Finanças entendeu comoGasto");
    expect(texto(".captura-linha")).toContain("Gastos chegam com a Tula");
    expect(anuncio()).toBe(
      "Finanças entendeu como Gasto. Gastos chegam com a Tula. Por enquanto, dá para lançar como tarefa ou nota.",
    );
    expect(recipiente.querySelector(".captura-lancar")!.getAttribute("aria-disabled")).toBe("true");
    await enter();
    expect(pedidosDe("captura.lancar")).toEqual([]);
    await tecla("2", { altKey: true });
    await enter();
    expect((pedidosDe("captura.lancar")[0] as { tipo: string }).tipo).toBe("nota");
  });
});

describe("abrir e fechar", () => {
  it("a janela focada põe o teclado na frase", async () => {
    await montar();
    frase().blur();
    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
    });
    expect(document.activeElement).toBe(frase());
  });

  it("Esc fecha e a próxima captura começa do zero", async () => {
    await montar();
    await digitar(frase(), "ligar pro banco amanhã 15h");
    await passar(100);
    await tecla("Escape");
    expect(comandos).toContain("captura_fechar");
    expect(frase().value).toBe("");
    expect(recipiente.querySelector(".captura-corpo")).toBeNull();
  });
});
