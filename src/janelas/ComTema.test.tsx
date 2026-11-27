// @vitest-environment happy-dom
import { CONFIG_PADRAO, type EstadoConfig } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextoSensivel } from "../componentes/TextoSensivel.tsx";
import { Valor } from "../componentes/Valor.tsx";

// O serviço é falso: `config.obter` responde o estado guardado e os eventos são disparados à mão.
const falso = vi.hoisted(() => ({
  estado: null as unknown as EstadoConfig,
  canal: "conectado" as string,
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
}));
vi.mock("../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string) =>
      metodo === "config.obter" ? Promise.resolve(falso.estado) : Promise.reject(new Error(metodo)),
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

/** Uma tela qualquer com dinheiro, como as das janelas: um valor e uma descrição de lançamento. */
function TelaComDinheiro() {
  return (
    <p>
      <TextoSensivel>Mercado do bairro</TextoSensivel> <Valor centavos={-4500} />
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

  it("antes de conectar ao serviço, nada é mascarado e nada é pedido", async () => {
    falso.canal = "conectando";
    falso.estado = { ...falso.estado, config: { ...CONFIG_PADRAO, privacidade: { ativo: true } } };
    await montar();
    expect(mascarados()).toBe(0);
  });
});
