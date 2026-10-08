// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditar, marcos } from "../../teste/acessibilidade.ts";
import { Captura } from "./Captura.tsx";

const chamadas: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) => {
    chamadas.push(comando);
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Captura />));
}

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  chamadas.length = 0;
});

describe("acessibilidade da captura", () => {
  it("um main com nome e o campo com nome acessível", async () => {
    await montar();
    expect(auditar(recipiente)).toEqual([]);
    expect(marcos(recipiente)).toEqual(["main: Captura"]);
    expect(recipiente.querySelector("input")?.getAttribute("aria-label")).toBe("Capturar");
  });

  it("a janela focada põe o teclado no campo, e Esc fecha", async () => {
    await montar();
    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
    });
    expect(document.activeElement).toBe(recipiente.querySelector("input"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(chamadas).toContain("captura_fechar");
  });
});
