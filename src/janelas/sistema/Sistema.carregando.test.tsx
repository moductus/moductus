// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * O Sistema enquanto uma área ainda baixa. Início e Dev são módulos de mentira que só terminam de
 * carregar quando o teste abre o portão de cada um.
 */
const portoes = vi.hoisted(() => {
  const portao = () => {
    let abrir!: () => void;
    const aberto = new Promise<void>((r) => (abrir = r));
    return { aberto, abrir };
  };
  return { inicio: portao(), dev: portao() };
});
vi.mock("../../areas/inicio/Inicio.tsx", async () => {
  await portoes.inicio.aberto;
  return { Inicio: () => <h1>Início</h1> };
});
vi.mock("../../areas/dev/Dev.tsx", async () => {
  await portoes.dev.aberto;
  return { Dev: () => <h1>Dev</h1> };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((comando: string) =>
    Promise.resolve(comando === "servico_estado" ? { estado: "parado" } : undefined),
  ),
}));

const { Sistema } = await import("./Sistema.tsx");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;
const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
// O React esconde com `display: none` o que um Suspense tira da tela, sem desmontar.
function naTela(elemento: HTMLElement | null): boolean {
  for (let e = elemento; e; e = e.parentElement) if (e.style.display === "none") return false;
  return elemento !== null;
}
const titulo = () => [...recipiente.querySelectorAll<HTMLElement>("main h1")].find(naTela)?.textContent;
const aguardar = () => act(async () => new Promise((r) => setTimeout(r, 20)));

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

describe("Sistema com a área ainda baixando", () => {
  it("a lateral e a busca ficam na tela; ao trocar, a área atual fica até a nova chegar", async () => {
    localStorage.clear();
    recipiente = document.createElement("div");
    document.body.appendChild(recipiente);
    raiz = createRoot(recipiente);
    // O `use` só retoma a tela suspensa num act aguardado.
    await act(async () => raiz!.render(<Sistema />));

    expect(por('nav[aria-label="Áreas"] [data-id="inicio"]')?.getAttribute("aria-current")).toBe("page");
    expect(naTela(por(".barra-lateral"))).toBe(true);
    expect(naTela(por(".busca-entrada"))).toBe(true);
    expect(naTela(por("main.sistema-conteudo"))).toBe(true);
    expect(titulo()).toBeUndefined();

    portoes.inicio.abrir();
    await aguardar();
    expect(titulo()).toBe("Início");

    await act(async () => por('nav[aria-label="Áreas"] [data-id="dev"]')!.click());
    await aguardar();
    expect(titulo()).toBe("Início");
    expect(naTela(por(".barra-lateral"))).toBe(true);

    portoes.dev.abrir();
    await aguardar();
    expect(titulo()).toBe("Dev");
    expect(por("main.sistema-conteudo")?.dataset.area).toBe("dev");
    expect(por('nav[aria-label="Áreas"] [data-id="dev"]')?.getAttribute("aria-current")).toBe("page");
  });
});
