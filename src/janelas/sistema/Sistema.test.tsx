// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AREAS, areaDoAtalho, IDS_AREAS, lerDestino } from "../../areas/areas.ts";
import { SECOES } from "../../areas/configuracoes/secoes.ts";
import { auditar, marcos, nomeAcessivel, ordemDoTab } from "../../teste/acessibilidade.ts";
import { CHAVE_DESTINO, EVENTO_IR, Sistema } from "./Sistema.tsx";

// A casca não existe no teste: eventos guardados para disparar à mão, janela e comandos falsos.
const ouvintes = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((nome: string, fn: (e: { payload: unknown }) => void) => {
    ouvintes.set(nome, fn);
    return Promise.resolve(() => ouvintes.delete(nome));
  }),
}));
const janela = {
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onResized: vi.fn(() => Promise.resolve(() => undefined)),
};
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => janela }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((comando: string) =>
    Promise.resolve(comando === "servico_estado" ? { estado: "parado" } : undefined),
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Sistema />));
}

function desmontar() {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
}

beforeEach(() => localStorage.clear());
afterEach(desmontar);

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor)!;
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const areaAtual = () => por("main").dataset.area;
const itemArea = (id: string) => por(`nav[aria-label="Áreas"] [data-id="${id}"]`);

function teclar(init: KeyboardEventInit, alvo: EventTarget = window) {
  act(() => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

describe("áreas", () => {
  it("lista as 12 na ordem, com Ctrl+1…9 só nas 9 primeiras", () => {
    expect(AREAS.map((a) => a.nome)).toEqual([
      "Início",
      "Agentes",
      "Sessões de IA",
      "Tarefas",
      "Foco",
      "Finanças",
      "Dev",
      "Notas",
      "Arquivos",
      "Memória",
      "Ferramentas",
      "Configurações",
    ]);
    expect(AREAS.map((a) => a.atalho ?? null)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null]);
    expect([0, 10].map(areaDoAtalho)).toEqual([null, null]);
  });

  it("lê destinos do evento e da memória, e recusa o que não é área", () => {
    expect(lerDestino("dev")).toEqual({ area: "dev" });
    expect(lerDestino("configuracoes/modelos")).toEqual({ area: "configuracoes", secao: "modelos" });
    expect([lerDestino("hoje"), lerDestino(""), lerDestino(3), lerDestino(null)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("Sistema", () => {
  it("abre no Início com a barra de título e as 12 áreas na lateral", async () => {
    await montar();
    expect(areaAtual()).toBe("inicio");
    expect(todos(".botao-janela").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Minimizar",
      "Maximizar",
      "Fechar",
    ]);
    expect(por(".barra-titulo").hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(todos('nav[aria-label="Áreas"] .navegacao-item').map((b) => b.dataset.id)).toEqual([...IDS_AREAS]);
    expect(itemArea("inicio").getAttribute("aria-current")).toBe("page");
    expect(itemArea("foco").getAttribute("aria-keyshortcuts")).toBe("Control+5");
    expect(itemArea("memoria").hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("nenhuma das 12 áreas fica em branco: título, estado vazio e a fase", async () => {
    await montar();
    for (const area of AREAS) {
      act(() => itemArea(area.id).click());
      expect(areaAtual()).toBe(area.id);
      expect(por("main h1").textContent).toBe(area.nome);
      // Configurações já funciona: abre na Geral, com opções em vez de estado vazio.
      if (area.id === "configuracoes") {
        expect(por("main .config-secao").textContent!.length).toBeGreaterThan(30);
        continue;
      }
      // Sessões de IA e Dev já leem o serviço: sem ele, dizem que esperam a resposta.
      if (area.id === "sessoes" || area.id === "dev") {
        expect(por('main [role="status"]').textContent).toBe("Esperando o serviço responder.");
        continue;
      }
      const vazio = por("main .estado-vazio");
      expect(vazio.querySelector(".estado-vazio-titulo")!.textContent!.length).toBeGreaterThan(3);
      expect(vazio.querySelector(".estado-vazio-texto")!.textContent!.length).toBeGreaterThan(30);
      expect(vazio.querySelector(".selo")!.textContent).toMatch(/fase \d/i);
    }
  });

  it("Ctrl+1…9 abre cada uma das 9 primeiras, pela tecla física ou pelo caractere", async () => {
    await montar();
    for (let n = 9; n >= 1; n--) {
      teclar({ ctrlKey: true, code: `Digit${n}`, key: String(n) });
      expect(areaAtual()).toBe(AREAS[n - 1]!.id);
    }
    teclar({ ctrlKey: true, code: "Numpad7", key: "7" });
    expect(areaAtual()).toBe("dev");
    // Sem Ctrl, com Alt ou Ctrl+0: nada muda.
    teclar({ code: "Digit3", key: "3" });
    teclar({ ctrlKey: true, altKey: true, code: "Digit3", key: "3" });
    teclar({ ctrlKey: true, code: "Digit0", key: "0" });
    expect(areaAtual()).toBe("dev");
  });

  it("Ctrl+K foca a busca, que explica quando a busca chega", async () => {
    await montar();
    const busca = por<HTMLInputElement>('input[type="search"]');
    const aviso = document.getElementById(busca.getAttribute("aria-describedby")!)!;
    expect(aviso.hidden).toBe(true);
    teclar({ ctrlKey: true, code: "KeyK", key: "k" });
    expect(document.activeElement).toBe(busca);
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toMatch(/fase 3/);
  });

  it("as setas andam pela lateral e abrem a área, com volta nas pontas", async () => {
    await montar();
    teclar({ key: "ArrowDown" }, itemArea("inicio"));
    expect(areaAtual()).toBe("agentes");
    expect(document.activeElement).toBe(itemArea("agentes"));
    teclar({ key: "End" }, itemArea("agentes"));
    expect(areaAtual()).toBe("configuracoes");
    teclar({ key: "ArrowDown" }, itemArea("configuracoes"));
    expect(areaAtual()).toBe("inicio");
    teclar({ key: "ArrowUp" }, itemArea("inicio"));
    expect(areaAtual()).toBe("configuracoes");
  });

  it("o evento sistema:ir do dock navega, inclusive para uma seção das Configurações", async () => {
    await montar();
    const emitir = (payload: unknown) => act(() => ouvintes.get(EVENTO_IR)!({ payload }));
    emitir("financas");
    expect(areaAtual()).toBe("financas");
    emitir("configuracoes/modelos");
    expect(areaAtual()).toBe("configuracoes");
    expect(por('nav[aria-label="Seções"] [aria-current="page"]').textContent).toBe("Modelos");
    expect(por(".config-secao h2").textContent).toBe("Modelos");
    emitir("nao-existe");
    emitir(42);
    expect(areaAtual()).toBe("configuracoes");
  });

  it("as Configurações têm as 9 seções, cada uma com conteúdo", async () => {
    await montar();
    act(() => itemArea("configuracoes").click());
    const nomes = [
      "Geral",
      "Tema e dock",
      "Notificações",
      "Modelos",
      "Agentes",
      "Conexões",
      "Atalhos",
      "Privacidade",
      "Levar para outro PC",
    ];
    expect(SECOES.map((s) => s.nome)).toEqual(nomes);
    const itens = () => todos('nav[aria-label="Seções"] .navegacao-item');
    expect(itens().map((i) => i.textContent)).toEqual(nomes);
    for (const [i, nome] of nomes.entries()) {
      act(() => itens()[i]!.click());
      expect(por(".config-secao h2").textContent).toBe(nome);
      // Fora do ar, a seção ainda diz algo: o estado vazio, o aviso de leitura ou o texto dela.
      const corpo = todos(".config-secao > :not(h2)")
        .map((el) => el.textContent)
        .join("");
      expect(corpo.length).toBeGreaterThan(30);
    }
  });

  it("lembra a última área ao abrir de novo, e sem armazenamento abre no Início", async () => {
    await montar();
    act(() => itemArea("notas").click());
    expect(localStorage.getItem(CHAVE_DESTINO)).toBe("notas");
    desmontar();
    await montar();
    expect(areaAtual()).toBe("notas");
    desmontar();

    const bloqueado = () => {
      throw new Error("armazenamento bloqueado");
    };
    vi.stubGlobal("localStorage", { getItem: bloqueado, setItem: bloqueado, clear: () => undefined });
    try {
      await montar();
      expect(areaAtual()).toBe("inicio");
      act(() => itemArea("dev").click());
      expect(areaAtual()).toBe("dev");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("os botões da barra de título minimizam, maximizam e fecham a janela", async () => {
    await montar();
    const [minimizar, maximizar, fechar] = todos(".botao-janela");
    act(() => minimizar!.click());
    act(() => maximizar!.click());
    act(() => fechar!.click());
    expect(janela.minimize).toHaveBeenCalledOnce();
    expect(janela.toggleMaximize).toHaveBeenCalledOnce();
    expect(janela.close).toHaveBeenCalledOnce();
  });
});

describe("acessibilidade do Sistema", () => {
  it("marcos: barra de título, navegação das áreas e um main", async () => {
    await montar();
    expect(marcos(recipiente)).toEqual(["banner", "navigation: Áreas", "main"]);
    act(() => itemArea("configuracoes").click());
    expect(marcos(recipiente)).toEqual(["banner", "navigation: Áreas", "main", "navigation: Seções"]);
  });

  it("as 12 áreas e as 9 seções das Configurações passam na checagem", async () => {
    await montar();
    for (const area of AREAS) {
      act(() => itemArea(area.id).click());
      expect(auditar(recipiente), area.id).toEqual([]);
      expect(todos("main h1"), area.id).toHaveLength(1);
    }
    for (const secao of SECOES) {
      act(() => por(`nav[aria-label="Seções"] [data-id="${secao.id}"]`).click());
      expect(auditar(recipiente), secao.id).toEqual([]);
    }
  });

  it("o Tab segue a tela: janela, busca, a área atual (uma só parada), depois o conteúdo", async () => {
    await montar();
    await act(async () => itemArea("configuracoes").click());
    // Sem serviço, o tema da lateral fica desativado e sai do Tab; a seção atual vem em seguida.
    const paradas = ordemDoTab(recipiente).map(nomeAcessivel);
    expect(paradas.slice(0, 6)).toEqual([
      "Minimizar",
      "Maximizar",
      "Fechar",
      "Buscar",
      "Configurações",
      "Geral",
    ]);
    // Nas duas listas de navegação, só o item atual é parada do Tab; as setas andam no resto.
    for (const nav of ["Áreas", "Seções"]) {
      expect(todos(`nav[aria-label="${nav}"] .navegacao-item`).filter((b) => b.tabIndex === 0)).toHaveLength(
        1,
      );
    }
  });

  it("Esc na busca devolve o campo e esconde o aviso", async () => {
    await montar();
    const busca = por<HTMLInputElement>('input[type="search"]');
    teclar({ ctrlKey: true, code: "KeyK", key: "k" });
    expect(document.activeElement).toBe(busca);
    teclar({ key: "Escape" }, busca);
    expect(document.activeElement).not.toBe(busca);
    expect(document.getElementById(busca.getAttribute("aria-describedby")!)!.hidden).toBe(true);
  });
});
