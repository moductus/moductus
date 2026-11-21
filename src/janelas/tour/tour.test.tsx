// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A casca não existe no teste: os comandos ficam anotados e o evento emitido chega a quem ouve,
// como entre as janelas de verdade.
const comandos: [string, unknown][] = [];
const emitidos: unknown[] = [];
const ouvintes = new Set<(e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: unknown) => {
    comandos.push([comando, args]);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_nome: string, fn: (e: { payload: unknown }) => void) => {
    ouvintes.add(fn);
    return () => ouvintes.delete(fn);
  }),
  emit: vi.fn(async (_nome: string, payload: unknown) => {
    emitidos.push(payload);
    for (const fn of ouvintes) fn({ payload });
  }),
}));

const { irPara, useTour } = await import("./tour.ts");
const { CamadaTour } = await import("./CamadaTour.tsx");

beforeEach(() => {
  comandos.length = 0;
  emitidos.length = 0;
});

describe("andar entre as paradas", () => {
  it("cada parada abre a janela dela e fecha a da anterior", async () => {
    await irPara(1, null);
    expect(comandos).toEqual([
      ["painel_abrir", { area: "tour" }],
      ["painel_foco", { quer: true }],
    ]);
    comandos.length = 0;
    await irPara(2, 1);
    expect(comandos).toEqual([
      ["painel_abrir", { area: "hoje" }],
      ["painel_foco", { quer: true }],
    ]);
    comandos.length = 0;
    await irPara(3, 2);
    expect(comandos).toEqual([
      ["painel_fechar", undefined],
      ["sistema_abrir", { area: "inicio" }],
    ]);
    comandos.length = 0;
    await irPara(4, 3);
    expect(comandos).toEqual([["captura_alternar", undefined]]);
    comandos.length = 0;
    // Voltar da captura: ela fecha e o Sistema volta.
    await irPara(3, 4);
    expect(comandos).toEqual([
      ["captura_fechar", undefined],
      ["sistema_abrir", { area: "inicio" }],
    ]);
    expect(emitidos).toEqual([1, 2, 3, 4, 3]);
  });

  it("pular fecha a janela da parada e não abre nada; terminar leva ao Início", async () => {
    await irPara(null, 2);
    expect(comandos).toEqual([["painel_fechar", undefined]]);
    comandos.length = 0;
    await irPara(null, 4, { terminou: true });
    expect(comandos).toEqual([
      ["captura_fechar", undefined],
      ["sistema_abrir", { area: "inicio" }],
    ]);
    expect(emitidos).toEqual([null, null]);
  });

  it("pedir a parada em que já está não faz nada: abrir o painel de novo o fecharia", async () => {
    await irPara(1, 1);
    expect(comandos).toEqual([]);
    expect(emitidos).toEqual([]);
  });

  it("comando que a casca recusa não derruba o tour", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementationOnce(async () => {
      throw new Error("sem janela");
    });
    await expect(irPara(3, 2)).resolves.toBeUndefined();
  });
});

let raiz: Root | null = null;
let recipiente: HTMLElement;

/** Uma janela de mentira com a lateral do Sistema e a camada do tour, como na parada 3. */
function JanelaDeTeste() {
  const tour = useTour();
  return (
    <>
      <nav className="barra-lateral" aria-label="Áreas" />
      <CamadaTour parada={tour.parada} ir={tour.ir} minha={3} medir={medir} lado="direita" />
    </>
  );
}
const medir = () => ({ left: 0, top: 40, width: 232, height: 600 });

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<JanelaDeTeste />));
}

async function naParada(p: 1 | 2 | 3 | 4 | null) {
  await act(async () => {
    for (const fn of ouvintes) fn({ payload: p });
  });
  // A medida do anel vem no quadro seguinte.
  await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
}

async function teclar(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const botao = (texto: string) =>
  [...recipiente.querySelectorAll("button")].find((b) => b.textContent === texto);

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  ouvintes.clear();
});

describe("a camada do tour numa janela", () => {
  it("sem tour, nada; na parada de outra janela, só o véu, sem bolha", async () => {
    await montar();
    expect(por(".tour-camada")).toBeNull();
    await naParada(1);
    expect(por(".tour-camada")!.dataset.tour).toBe("veu");
    expect(por(".tour-veu")).toBeTruthy();
    expect(por(".tour-bolha")).toBeNull();
  });

  it("na parada dela, o anel no que aponta e a bolha ao lado, com o texto do quadro", async () => {
    await montar();
    await naParada(3);
    const anel = por(".tour-anel")!;
    expect([anel.style.left, anel.style.top, anel.style.width, anel.style.height]).toEqual([
      "0px",
      "40px",
      "232px",
      "600px",
    ]);
    const bolha = por(".tour-bolha")!;
    expect(bolha.getAttribute("aria-label")).toBe("Tour, 3 de 4");
    expect(bolha.style.left).toBe("232px");
    expect(bolha.querySelector("h2")!.textContent).toBe("O Sistema");
    expect(bolha.textContent).toMatch(/Aqui as áreas têm espaço/);
    expect([...bolha.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Pular tour",
      "Voltar",
      "Próximo",
    ]);
    expect(document.activeElement?.textContent).toBe("Próximo");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Próximo, Voltar e Pular tour andam pela parada de agora", async () => {
    await montar();
    await naParada(3);
    await act(async () => botao("Próximo")!.click());
    expect(emitidos.at(-1)).toBe(4);
    await naParada(3);
    await act(async () => botao("Voltar")!.click());
    expect(emitidos.at(-1)).toBe(2);
    await naParada(3);
    await act(async () => botao("Pular tour")!.click());
    expect(emitidos.at(-1)).toBeNull();
  });

  it("teclado: → anda, ← volta, Esc pula; nas pontas, a seta não sai do tour", async () => {
    await montar();
    await naParada(3);
    await teclar("ArrowRight");
    expect(emitidos.at(-1)).toBe(4);
    await naParada(3);
    await teclar("ArrowLeft");
    expect(emitidos.at(-1)).toBe(2);
    await naParada(1);
    emitidos.length = 0;
    await teclar("ArrowLeft");
    expect(emitidos).toEqual([]);
    await teclar("Escape");
    expect(emitidos).toEqual([null]);
  });

  it("o Esc do tour vem antes do Esc da janela, que não roda", async () => {
    await montar();
    const daJanela = vi.fn();
    window.addEventListener("keydown", daJanela);
    await naParada(2);
    await teclar("Escape");
    expect(daJanela).not.toHaveBeenCalled();
    window.removeEventListener("keydown", daJanela);
  });
});
