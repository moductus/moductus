// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A casca não existe no teste: o invoke responde como ela responderia.
const chamadas: { comando: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: { vidro?: boolean }) => {
    chamadas.push({ comando, args });
    if (comando === "tema_material") return args?.vidro ? "acrylic" : "solido";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { aplicarMaterial, aplicarTema, resolverTema } = await import("./tema.ts");

/** matchMedia controlável: `mudar` simula o Windows trocando entre claro e escuro. */
function windowsComModo(escuro: boolean) {
  const ouvintes = new Set<(e: MediaQueryListEvent) => void>();
  const consulta = {
    matches: escuro,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.delete(fn),
  };
  window.matchMedia = vi.fn(() => consulta as unknown as MediaQueryList);
  return {
    mudar(agoraEscuro: boolean) {
      consulta.matches = agoraEscuro;
      for (const fn of ouvintes) fn({ matches: agoraEscuro } as MediaQueryListEvent);
    },
    ouvintes,
  };
}

const variavel = (nome: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(nome).trim().toLowerCase();

beforeAll(() => {
  const estilo = document.createElement("style");
  // Lido do disco: o vitest não entrega o CSS importado. O caminho é relativo à raiz do repo.
  estilo.textContent = readFileSync("src/tokens/temas.css", "utf8");
  document.head.appendChild(estilo);
});

beforeEach(() => {
  chamadas.length = 0;
  delete document.documentElement.dataset.tema;
  delete document.documentElement.dataset.material;
});

describe("tema", () => {
  it("automático segue o Windows: escuro é Grafite, claro é Papel", () => {
    expect(resolverTema("automatico", true)).toBe("grafite");
    expect(resolverTema("automatico", false)).toBe("papel");
    expect(resolverTema("vidro", false)).toBe("vidro");
  });

  it("trocar tema em sequência não recarrega o documento e muda as variáveis", () => {
    windowsComModo(true);
    const marcador = Symbol("mesma janela");
    (window as unknown as Record<string, unknown>).marcadorTema = marcador;
    const documento = document;

    const vistos: Record<string, string> = {};
    for (const tema of ["grafite", "papel", "vidro", "grafite"] as const) {
      aplicarTema(tema);
      expect(document.documentElement.dataset.tema).toBe(tema);
      vistos[tema] = variavel("--fundo-janela");
    }

    expect((window as unknown as Record<string, unknown>).marcadorTema).toBe(marcador);
    expect(document).toBe(documento);
    expect(vistos).toEqual({ grafite: "#131417", papel: "#ffffff", vidro: "#1b1f2b" });
  });

  it("automático reage à mudança do Windows ao vivo e para de ouvir ao trocar de tema", () => {
    const windows = windowsComModo(true);
    const aplicados: string[] = [];
    aplicarTema("automatico", (t) => aplicados.push(t));
    expect(document.documentElement.dataset.tema).toBe("grafite");
    expect(variavel("--texto")).toBe("#e8e9eb");

    windows.mudar(false);
    expect(document.documentElement.dataset.tema).toBe("papel");
    expect(variavel("--texto")).toBe("#1a1a18");
    expect(variavel("--fonte-interface")).toContain("instrument sans");
    expect(aplicados).toEqual(["grafite", "papel"]);

    aplicarTema("vidro");
    expect(windows.ouvintes.size).toBe(0);
    windows.mudar(true);
    expect(document.documentElement.dataset.tema).toBe("vidro");
  });

  it("os temas valem por escopo: um contêiner com data-tema próprio não muda a raiz", () => {
    windowsComModo(true);
    aplicarTema("grafite");
    const colunas = (["papel", "vidro"] as const).map((tema) => {
      const div = document.createElement("div");
      div.dataset.tema = tema;
      document.body.appendChild(div);
      return div;
    });
    const fundo = (el: Element) =>
      getComputedStyle(el).getPropertyValue("--fundo-janela").trim().toLowerCase();

    expect(colunas.map(fundo)).toEqual(["#ffffff", "#1b1f2b"]);
    expect(variavel("--fundo-janela")).toBe("#131417");
    colunas.forEach((c) => c.remove());
  });

  it("Vidro com Acrylic usa o fundo translúcido; sem Acrylic, o sólido #1B1F2B", async () => {
    windowsComModo(true);
    aplicarTema("vidro");
    expect(variavel("--fundo-dock")).toBe("#1b1f2b");

    expect(await aplicarMaterial("vidro")).toBe("acrylic");
    expect(document.documentElement.dataset.material).toBe("acrylic");
    expect(variavel("--fundo-dock").replace(/\s/g, "")).toBe("rgba(20,23,31,0.55)");

    expect(await aplicarMaterial("grafite")).toBe("solido");
    expect(chamadas.filter((c) => c.comando === "tema_material").map((c) => c.args)).toEqual([
      { vidro: true },
      { vidro: false },
    ]);
    expect(chamadas.filter((c) => c.comando === "interface_registro").map((c) => c.args)).toEqual([
      { linha: "tema vidro material acrylic" },
      { linha: "tema grafite material solido" },
    ]);
  });
});
