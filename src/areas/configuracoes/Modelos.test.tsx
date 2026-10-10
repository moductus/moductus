// @vitest-environment happy-dom
import type { Agente, MudancaAgente, Provedor, SituacaoAgente } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { SecaoModelos } from "./Modelos.tsx";

// O serviço é falso: cada pedido fica registrado e a resposta vem de `responder`.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> => Promise.resolve(undefined),
  ouvintes: new Map<string, (dados: unknown) => void>(),
}));
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      return falso.responder(metodo, dados);
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      falso.ouvintes.set(nome, fn);
      return () => falso.ouvintes.delete(nome);
    },
  },
  useCanal: () => "conectado",
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SITUACAO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const agente = (id: string, nome: string, principal: string | null, reserva: string | null): Agente => ({
  id,
  nome,
  funcao: "x",
  instrucoes: "",
  personagem: { silhueta: "a", traco: "b", tom: "c" },
  ferramentas: [],
  provedorId: principal,
  provedorReservaId: reserva,
  gatilhos: [],
  escoposMemoria: [],
  tetoDiarioCentavos: null,
  deFabrica: true,
  situacao: principal ? SITUACAO : { ...SITUACAO, estado: "dormindo", motivoSono: "sem_modelo" },
});

const PROVEDORES: Provedor[] = [
  {
    id: "p1",
    tipo: "claude-cli",
    nome: "Claude Code",
    modelo: null,
    baseUrl: null,
    temChave: false,
    testadoEm: null,
  },
  {
    id: "p2",
    tipo: "openai-compativel",
    nome: "Ollama neste PC",
    modelo: "llama3.1:8b",
    baseUrl: "http://127.0.0.1:11434/v1",
    temChave: false,
    testadoEm: null,
  },
];

/** Serviço que aceita a troca como o de verdade: aplica a mudança e devolve o agente. */
function servico(provedores = PROVEDORES, inicial?: Agente[]) {
  let agentes = inicial ?? [
    agente("alba", "Alba", "p1", "p2"),
    agente("tula", "Tula", "p1", null),
    agente("faina", "Faina", "p2", null),
    agente("nuno", "Nuno", "p1", null),
  ];
  falso.responder = (metodo, dados) => {
    switch (metodo) {
      case "provedores.listar":
        return Promise.resolve(provedores);
      case "agentes.listar":
        return Promise.resolve(agentes);
      case "execucoes.listar":
        return Promise.resolve({ itens: [], proximo: null });
      case "provedores.detectar":
        return Promise.resolve([
          {
            tipo: "claude-cli",
            caminho: "C:\\claude.exe",
            versao: "2.4",
            logado: true,
            impedimento: null,
            versaoMinima: null,
          },
        ]);
      case "provedores.criar":
        return Promise.resolve({ ...PROVEDORES[0], id: "novo", ...(dados as object) });
      case "provedores.testar":
        return Promise.resolve({
          ok: true,
          provedorId: (dados as { id: string }).id,
          latenciaMs: 2100,
          testadoEm: new Date().toISOString(),
        });
      case "agentes.definir": {
        const m = dados as MudancaAgente;
        if (m.tetoDiarioCentavos) return Promise.reject(new Error("teto sem moeda"));
        agentes = agentes.map((a) => (a.id === m.id ? { ...a, ...m } : a));
        return Promise.resolve(agentes.find((a) => a.id === m.id));
      }
      default:
        return Promise.reject(new Error(`sem resposta para ${metodo}`));
    }
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<SecaoModelos />));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) =>
  todos("button").find((b) => b.textContent === texto || b.getAttribute("aria-label") === texto)!;
const lista = (rotulo: string) => por(`select[aria-label="${rotulo}"]`) as HTMLSelectElement;
const escolhido = (rotulo: string) => lista(rotulo).options[lista(rotulo).selectedIndex]?.textContent ?? null;
const escolher = (rotulo: string, valor: string) =>
  act(async () => {
    lista(rotulo).value = valor;
    lista(rotulo).dispatchEvent(new Event("change", { bubbles: true }));
  });
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);

describe("Modelos", () => {
  it("lista os provedores e o principal e a reserva de cada agente", async () => {
    servico();
    await montar();
    expect(todos("tbody th .config-modelos-nome").map((n) => n.textContent)).toEqual([
      "Claude Code",
      "Ollama neste PC",
      "Alba",
      "Tula",
      "Faina",
      "Nuno",
    ]);
    expect(escolhido("Principal da Alba")).toBe("Claude Code");
    expect(escolhido("Reserva da Alba")).toBe("Ollama neste PC");
    expect(escolhido("Reserva da Tula")).toBe("Nenhuma");
    // A reserva nunca oferece o próprio principal.
    expect([...lista("Reserva da Tula").options].map((o) => o.textContent)).toEqual([
      "Nenhuma",
      "Ollama neste PC",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("escolher na lista da tabela não grava: abre o painel com a escolha, e o sim grava", async () => {
    servico();
    await montar();
    await escolher("Principal da Tula", "p2");
    expect(pedidosDe("agentes.definir")).toEqual([]);
    const radios = todos('input[name="principal-tula"]') as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    // A lista saiu de cena: o foco vai à escolha marcada no painel.
    expect(document.activeElement).toBe(radios[1]);
    await act(async () => botao("Usar Ollama neste PC na Tula").click());
    expect(pedidosDe("agentes.definir")).toEqual([{ id: "tula", provedorId: "p2", provedorReservaId: null }]);
    expect(escolhido("Principal da Tula")).toBe("Ollama neste PC");

    // A reserva escolhida como principal troca os dois de lugar.
    await escolher("Principal da Alba", "p2");
    expect(escolhido("Reserva da Alba")).toBe("Claude Code");
    await act(async () => botao("Usar Ollama neste PC na Alba").click());
    expect(pedidosDe("agentes.definir").at(-1)).toEqual({
      id: "alba",
      provedorId: "p2",
      provedorReservaId: "p1",
    });

    await escolher("Reserva da Faina", "p1");
    expect(pedidosDe("agentes.definir")).toHaveLength(2);
    await act(async () => botao("Guardar a reserva").click());
    expect(pedidosDe("agentes.definir").at(-1)).toEqual({
      id: "faina",
      provedorId: "p2",
      provedorReservaId: "p1",
    });
  });

  it("o painel de um agente só grava com o sim, e o botão diz o que vai acontecer", async () => {
    servico();
    await montar();
    await act(async () => botao("Modelo do Nuno: abrir as opções").click());
    const radios = todos('input[name="principal-nuno"]') as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    await act(async () => radios[1]!.click());
    expect(por(".config-modelos-painel .fala")!.textContent).toContain(
      "Na próxima execução eu passo a usar o Ollama neste PC. O que estou fazendo agora termina no Claude Code.",
    );
    expect(pedidosDe("agentes.definir")).toEqual([]);
    await act(async () => botao("Usar Ollama neste PC no Nuno").click());
    expect(pedidosDe("agentes.definir")).toEqual([{ id: "nuno", provedorId: "p2", provedorReservaId: null }]);
    expect(por(".config-modelos-painel")).toBeNull();
    expect(escolhido("Principal do Nuno")).toBe("Ollama neste PC");
  });

  it("o painel fecha com Esc sem gravar nada", async () => {
    servico();
    await montar();
    await act(async () => botao("Modelo da Faina: abrir as opções").click());
    await act(async () => (todos('input[name="principal-faina"]')[0] as HTMLInputElement).click());
    await act(async () => {
      por(".config-modelos-painel")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(por(".config-modelos-painel")).toBeNull();
    expect(pedidosDe("agentes.definir")).toEqual([]);
  });

  it("teto por dia: sem teto e o Definir travado, com a moeda pendente dita", async () => {
    servico();
    await montar();
    const definir = todos("button").filter((b) => b.textContent === "Definir");
    expect(definir).toHaveLength(4);
    expect(definir.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(por(".config-pendente")!.textContent).toBe("moeda do teto a decidir");
  });

  it("testar chama o teste de verdade do serviço e mostra a latência medida", async () => {
    servico();
    await montar();
    await act(async () => botao("Testar Claude Code").click());
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "p1" }]);
    const linha = todos("tbody tr")[0]!;
    expect(linha.querySelector(".selo")!.textContent).toBe("funcionando");
    expect(linha.querySelector(".config-modelos-numero")!.textContent).toBe("2,1 s");
  });

  it("nenhum provedor: o time dorme, a tela procura no PC e conecta o que dá para usar", async () => {
    servico([], [agente("alba", "Alba", null, null)]);
    await montar();
    expect(por(".config-modelos-vazio-titulo")!.textContent).toBe("Nenhum modelo conectado");
    expect(pedidosDe("provedores.detectar")).toHaveLength(1);
    await act(async () => botao("Conectar Claude Code e testar").click());
    expect(pedidosDe("provedores.criar")).toEqual([{ tipo: "claude-cli", nome: "Claude Code" }]);
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "novo" }]);
    expect(auditar(recipiente)).toEqual([]);
  });
});
