// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoMidia } from "../../nativo/eventos.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A casca não existe no teste: invoke responde como ela e os eventos são disparados à mão.
const chamadas: { comando: string; args: unknown }[] = [];
const estado: { midia: EstadoMidia | null; mic: boolean | null } = { midia: null, mic: false };
const ouvintes = new Map<string, Set<(e: { payload: unknown }) => void>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: unknown) => {
    chamadas.push({ comando, args });
    switch (comando) {
      case "midia_estado":
        return estado.midia;
      case "mic_estado":
        return estado.mic;
      case "awake_estado":
        return false;
      case "servico_estado":
        return { estado: "iniciando" };
      case "dock_configuracao":
        return { lado: "esquerda", modo: "fixo", forma: "colada" };
      default:
        return undefined;
    }
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (evento: string, fn: (e: { payload: unknown }) => void) => {
    if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
    ouvintes.get(evento)!.add(fn);
    return () => ouvintes.get(evento)?.delete(fn);
  }),
}));

const { Dock, CONVITE_AGENTES } = await import("./Dock.tsx");
const { Painel } = await import("../painel/Painel.tsx");
const { formatarHora, ateProximoMinuto } = await import("./relogio.ts");
const { proximoIndice } = await import("./navegacao.ts");

let raiz: Root | null = null;
let recipiente: HTMLElement;

/** Monta e deixa as promessas do invoke e do listen resolverem. */
async function montar(no: ReactNode) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(no));
  return recipiente;
}

async function emitir(evento: string, payload: unknown) {
  await act(async () => ouvintes.get(evento)?.forEach((fn) => fn({ payload })));
}

function teclar(tecla: string, shift = false) {
  const alvo = (document.activeElement as HTMLElement | null) ?? document.body;
  act(() => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { key: tecla, shiftKey: shift, bubbles: true }));
  });
}

const rotulos = (el: ParentNode) =>
  Array.from(el.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
const focado = () => document.activeElement?.getAttribute("aria-label");

beforeEach(() => {
  chamadas.length = 0;
  ouvintes.clear();
  estado.midia = null;
  estado.mic = false;
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

const MIDIA: EstadoMidia = {
  app: "Spotify",
  titulo: "Faixa",
  artista: "Artista",
  tocando: true,
  pode_anterior: true,
  pode_proxima: true,
  capa: null,
};

describe("Dock", () => {
  it("segue a ordem do canvas: marca, sete áreas, o time, controles e relógio", async () => {
    estado.midia = MIDIA;
    const el = await montar(<Dock />);
    const nav = el.querySelector("nav")!;
    expect(rotulos(nav)).toEqual([
      "Abrir o Sistema",
      "Hoje",
      "Tarefas",
      "Foco",
      "Finanças",
      "Dev",
      "Notas",
      "Arquivos",
      `Alba, dormindo. ${CONVITE_AGENTES}`,
      `Tula, dormindo. ${CONVITE_AGENTES}`,
      `Faina, dormindo. ${CONVITE_AGENTES}`,
      `Nuno, dormindo. ${CONVITE_AGENTES}`,
      "Pausar Faixa",
      "Microfone mudo",
      "Manter acordado",
    ]);
    // Divisores em volta do time; espaçador antes da mídia; relógio por último, antes do estado.
    const filhos = Array.from(nav.children).map((c) => c.className.split(" ").pop());
    expect(filhos.indexOf("dock-agentes")).toBe(filhos.indexOf("dock-divisor") + 1);
    expect(filhos.lastIndexOf("dock-divisor")).toBe(filhos.indexOf("dock-agentes") + 1);
    expect(filhos.indexOf("dock-espaco")).toBe(filhos.lastIndexOf("dock-divisor") + 1);
    expect(filhos.slice(-2)).toEqual(["dock-relogio", "dock-estado"]);
    // Todo botão tem nome acessível.
    expect(rotulos(nav).every((r) => r && r.length > 0)).toBe(true);
  });

  it("as áreas abrem o painel e ficam marcadas enquanto ele está aberto", async () => {
    const el = await montar(<Dock />);
    const tarefas = el.querySelector<HTMLButtonElement>('[data-area="tarefas"]')!;
    act(() => tarefas.click());
    expect(chamadas).toContainEqual({ comando: "painel_abrir", args: { area: "tarefas" } });
    await emitir("painel:area", "tarefas");
    expect(tarefas.getAttribute("aria-expanded")).toBe("true");
    await emitir("painel:fechado", null);
    expect(tarefas.getAttribute("aria-expanded")).toBe("false");
    // Fase 1: sem badge.
    expect(el.querySelector(".contagem")).toBeNull();
  });

  it("mídia some sem sessão e aparece com a sessão", async () => {
    const el = await montar(<Dock />);
    expect(el.querySelector("[data-midia]")).toBeNull();
    await emitir("midia", { ...MIDIA, tocando: false });
    expect(el.querySelector("[data-midia]")?.getAttribute("aria-label")).toBe("Tocar Faixa");
    act(() => el.querySelector<HTMLButtonElement>("[data-midia]")!.click());
    expect(chamadas.map((c) => c.comando)).toContain("midia_alternar");
    await emitir("midia", null);
    expect(el.querySelector("[data-midia]")).toBeNull();
  });

  it("sem microfone o Mic fica desativado", async () => {
    estado.mic = null;
    const el = await montar(<Dock />);
    const mic = el.querySelector<HTMLButtonElement>('[aria-label="Microfone mudo"]')!;
    expect(mic.disabled).toBe(true);
  });

  it("o time convida a conectar um modelo e abre o painel do time", async () => {
    const el = await montar(<Dock />);
    const cabecas = el.querySelectorAll<HTMLButtonElement>(".dock-agente");
    expect(cabecas).toHaveLength(4);
    for (const c of cabecas) {
      expect(c.title).toContain(CONVITE_AGENTES);
      expect(c.querySelector('.personagem[data-estado="dormindo"][data-modo="cabeca"]')).not.toBeNull();
      expect(c.querySelector(".personagem-moldura")).not.toBeNull();
    }
    act(() => cabecas[2]!.click());
    expect(chamadas).toContainEqual({ comando: "painel_abrir", args: { area: "agentes" } });
  });

  it("forma flutuante e lado vêm da configuração do dock, ao vivo", async () => {
    const el = await montar(<Dock />);
    const nav = el.querySelector("nav")!;
    expect(nav.dataset.forma).toBe("colada");
    await emitir("dock:configuracao", { lado: "direita", modo: "fixo", forma: "flutuante" });
    expect(nav.dataset.forma).toBe("flutuante");
    expect(nav.dataset.lado).toBe("direita");
  });

  it("modo teclado: foco na primeira área, setas, Tab, Home, End e Esc", async () => {
    const el = await montar(<Dock />);
    await emitir("dock:teclado", true);
    expect(focado()).toBe("Hoje");

    teclar("ArrowDown");
    expect(focado()).toBe("Tarefas");
    teclar("ArrowUp");
    teclar("ArrowUp");
    expect(focado()).toBe("Abrir o Sistema");
    teclar("ArrowUp");
    expect(focado()).toBe("Manter acordado");
    teclar("Tab");
    expect(focado()).toBe("Abrir o Sistema");
    teclar("Tab", true);
    expect(focado()).toBe("Manter acordado");
    teclar("Home");
    expect(focado()).toBe("Abrir o Sistema");
    teclar("End");
    expect(focado()).toBe("Manter acordado");

    teclar("Escape");
    expect(el.contains(document.activeElement)).toBe(false);
    expect(chamadas).toContainEqual({ comando: "dock_soltar_foco", args: { devolver: true } });
  });

  it("o teclado pula o Mic desativado", async () => {
    estado.mic = null;
    await montar(<Dock />);
    await emitir("dock:teclado", true);
    teclar("End");
    expect(focado()).toBe("Manter acordado");
    teclar("ArrowUp");
    expect(focado()).toBe(`Nuno, dormindo. ${CONVITE_AGENTES}`);
  });

  it("relógio mostra HH:MM e vira no minuto", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 9, 4, 58));
    const el = await montar(<Dock />);
    const relogio = el.querySelector("time")!;
    expect(relogio.textContent).toBe("09:04");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(relogio.textContent).toBe("09:05");
  });
});

describe("relógio e navegação (funções puras)", () => {
  it("formata com dois dígitos, 24 h", () => {
    expect(formatarHora(new Date(2026, 9, 8, 9, 5))).toBe("09:05");
    expect(formatarHora(new Date(2026, 9, 8, 23, 59))).toBe("23:59");
    expect(formatarHora(new Date(2026, 9, 8, 0, 0))).toBe("00:00");
  });

  it("espera só até a virada do minuto", () => {
    expect(ateProximoMinuto(new Date(2026, 9, 8, 9, 4, 58, 500))).toBe(1_500);
    expect(ateProximoMinuto(new Date(2026, 9, 8, 9, 4, 0, 0))).toBe(60_000);
  });

  it("anda em círculo e ignora teclas que não navegam", () => {
    expect(proximoIndice("ArrowDown", false, 4, 5)).toBe(0);
    expect(proximoIndice("ArrowUp", false, 0, 5)).toBe(4);
    expect(proximoIndice("ArrowDown", false, -1, 5)).toBe(0);
    expect(proximoIndice("ArrowUp", false, -1, 5)).toBe(4);
    expect(proximoIndice("End", false, 1, 5)).toBe(4);
    expect(proximoIndice("a", false, 1, 5)).toBeNull();
    expect(proximoIndice("Home", false, 1, 0)).toBeNull();
  });
});

describe("Painel", () => {
  it("mostra cabeçalho e o estado vazio da área aberta", async () => {
    const el = await montar(<Painel />);
    await emitir("painel:area", "financas");
    expect(el.querySelector("h1")?.textContent).toBe("Finanças");
    expect(el.querySelector(".painel-vazio-titulo")?.textContent).toBe("0 lançamentos");
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Fechar painel"]')!.click());
    expect(chamadas.map((c) => c.comando)).toContain("painel_fechar");
  });

  it("no time, convida a conectar um modelo e leva às Configurações", async () => {
    const el = await montar(<Painel />);
    await emitir("painel:area", "agentes");
    expect(el.textContent).toContain("Conecte um modelo para acordar o time");
    expect(el.querySelectorAll('.painel-time .personagem[data-estado="dormindo"]')).toHaveLength(4);
    const botao = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent === "Abrir Configurações",
    )!;
    act(() => botao.click());
    expect(chamadas).toContainEqual({ comando: "sistema_abrir", args: { area: "configuracoes" } });
    expect(chamadas.map((c) => c.comando)).toContain("painel_fechar");
  });

  it("Esc fecha o painel", async () => {
    await montar(<Painel />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(chamadas.map((c) => c.comando)).toContain("painel_fechar");
  });
});
