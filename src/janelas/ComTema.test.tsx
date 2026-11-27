// @vitest-environment happy-dom
import { CONFIG_PADRAO, type EstadoConfig } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextoSensivel } from "../componentes/TextoSensivel.tsx";
import { Valor } from "../componentes/Valor.tsx";

// O serviço é falso: `config.obter` responde o estado guardado e os eventos são disparados à mão.
// `obter` troca a resposta (uma promessa que o teste resolve na hora que quiser).
const falso = vi.hoisted(() => ({
  estado: null as unknown as EstadoConfig,
  canal: "conectado" as string,
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
  pedidos: [] as { metodo: string; dados: unknown }[],
  obter: null as null | (() => Promise<EstadoConfig>),
}));
vi.mock("../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      if (metodo === "config.obter") return falso.obter ? falso.obter() : Promise.resolve(falso.estado);
      if (metodo === "config.definir") return Promise.resolve(falso.estado);
      return Promise.reject(new Error(metodo));
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
  useCanal: () => falso.canal,
}));
vi.mock("../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
  registrar: () => undefined,
}));
// Sem casca: o material e a animação do Windows não respondem.
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject(new Error("sem casca")) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));

const { ComTema } = await import("./ComTema.tsx");
const { useAtalhoPrivacidade } = await import("../componentes/privacidade.ts");
const { definirPrivacidade } = await import("../servico/privacidade.ts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

/** Uma tela qualquer com dinheiro, como as das janelas: um valor e uma descrição de lançamento. */
function TelaComDinheiro() {
  return (
    <p>
      <TextoSensivel>Mercado do bairro</TextoSensivel> <Valor centavos={-4500} />
      <kbd>{useAtalhoPrivacidade()}</kbd>
    </p>
  );
}

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<ComTema Tela={TelaComDinheiro} />));
}

async function emitir(evento: string, dados: unknown) {
  await act(async () => falso.ouvintes.get(evento)?.forEach((fn) => fn(dados)));
}

/** O que o leitor de tela ouve do valor. */
const lido = () => recipiente.querySelector(".valor .so-leitor")!.textContent;
const mascarados = () => [...recipiente.querySelectorAll("[data-mascarado]")].length;

beforeEach(() => {
  falso.estado = { config: CONFIG_PADRAO, portable: false, falhasAtalhos: {} };
  falso.canal = "conectado";
  falso.ouvintes.clear();
  falso.pedidos.length = 0;
  falso.obter = null;
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

// main.tsx monta toda janela (dock, painel, Sistema e captura) dentro de ComTema.
describe("modo privacidade em toda janela", () => {
  it("ligado ao abrir, todo Valor e todo texto sensível já nascem mascarados", async () => {
    falso.estado = { ...falso.estado, config: { ...CONFIG_PADRAO, privacidade: { ativo: true } } };
    await montar();
    expect(mascarados()).toBe(2);
    expect(lido()).toBe("valor escondido");
  });

  it("o privacidade.mudou de qualquer janela mascara e desmascara na hora", async () => {
    await montar();
    expect(mascarados()).toBe(0);
    expect(lido()).toBe("menos 45 reais");

    await emitir("privacidade.mudou", { ativo: true });
    expect(mascarados()).toBe(2);

    await emitir("privacidade.mudou", { ativo: false });
    expect(mascarados()).toBe(0);
  });

  it("antes de conectar ao serviço, tudo fica mascarado e nada é pedido", async () => {
    falso.canal = "conectando";
    await montar();
    expect(mascarados()).toBe(2);
    expect(lido()).toBe("valor escondido");
    expect(falso.pedidos).toEqual([]);
  });

  it("enquanto o config.obter não volta, a janela fica mascarada", async () => {
    let responder: (estado: EstadoConfig) => void = () => {};
    falso.obter = () => new Promise((r) => (responder = r));
    await montar();
    expect(mascarados()).toBe(2);
    await act(async () => responder(falso.estado));
    expect(mascarados()).toBe(0);
  });

  it("a resposta do config.obter que chega depois de um privacidade.mudou não desmascara", async () => {
    let responder: (estado: EstadoConfig) => void = () => {};
    falso.obter = () => new Promise((r) => (responder = r));
    await montar();
    // O serviço leu "desligado"; antes da resposta chegar, o Ctrl+Alt+H ligou o modo.
    await emitir("privacidade.mudou", { ativo: true });
    await act(async () => responder(falso.estado));
    expect(mascarados()).toBe(2);
  });

  it("o atalho do modo vai para as telas e acompanha a configuração", async () => {
    await montar();
    expect(recipiente.querySelector("kbd")!.textContent).toBe("Ctrl+Alt+H");
    const atalhos = { ...CONFIG_PADRAO.atalhos, privacidade: "" };
    await emitir("config.mudou", { ...falso.estado, config: { ...CONFIG_PADRAO, atalhos } });
    expect(recipiente.querySelector("kbd")!.textContent).toBe("");
  });

  it("desligar pede ao serviço só a chave da privacidade", async () => {
    await definirPrivacidade(false);
    expect(falso.pedidos).toEqual([{ metodo: "config.definir", dados: { privacidade: { ativo: false } } }]);
  });
});
