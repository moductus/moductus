// @vitest-environment happy-dom
import type { AutorizacaoArquivo } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { AlvoDeArquivo, tamanhoLegivel } from "./AlvoDeArquivo.tsx";

type EventoSoltar =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

// O serviço é falso: cada pedido fica registrado e a resposta vem de `responder`.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> => Promise.resolve(undefined),
  soltar: null as ((evento: { payload: EventoSoltar }) => void) | null,
  parou: 0,
  escolher: vi.fn<(primeiro?: string) => Promise<string | null>>(),
}));
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      return falso.responder(metodo, dados);
    },
  },
}));
// A janela de verdade entrega o `onDragDropEvent`; aqui o teste solta o que quiser.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (fn: (evento: { payload: EventoSoltar }) => void) => {
      falso.soltar = fn;
      return Promise.resolve(() => {
        falso.parou++;
        falso.soltar = null;
      });
    },
  }),
}));
// O diálogo é do Windows; a finalidade pela extensão é a de verdade.
vi.mock("../../nativo/arquivos.ts", async (original) => ({
  ...(await original<typeof import("../../nativo/arquivos.ts")>()),
  escolherArquivoDoUsuario: falso.escolher,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUTORIZACAO: AutorizacaoArquivo = {
  id: "5f0c9a52-7d1e-4c43-9b8e-2a6f0d1c3b47",
  finalidade: "extrato",
  nome: "Extrato Nubank.ofx",
  bytes: 23_552,
  valeAte: "2026-11-27T12:10:00.000Z",
};

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar(aoAutorizar?: (a: AutorizacaoArquivo) => void, compacto = false) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<AlvoDeArquivo aoAutorizar={aoAutorizar} compacto={compacto} />));
}

async function soltar(evento: EventoSoltar) {
  await act(async () => falso.soltar?.({ payload: evento }));
}

const alvo = () => recipiente.querySelector(".alvo-arquivo") as HTMLElement;
const estado = () => recipiente.querySelector(".alvo-arquivo-estado");

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.parou = 0;
  falso.escolher.mockReset();
  falso.responder = (metodo) =>
    metodo === "arquivos.autorizar" ? Promise.resolve(AUTORIZACAO) : Promise.reject(new Error(metodo));
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

describe("alvo de soltar das Finanças (ADR-0044)", () => {
  it("soltar um .ofx manda o caminho uma vez ao arquivos.autorizar e entrega o id", async () => {
    const aoAutorizar = vi.fn();
    await montar(aoAutorizar);

    await soltar({ type: "enter", paths: ["C:\\Users\\eu\\Downloads\\Extrato Nubank.ofx"] });
    expect(alvo().dataset.sobre).toBe("true");
    expect(alvo().textContent).toContain("Solte para conferir o arquivo");

    await soltar({ type: "drop", paths: ["C:\\Users\\eu\\Downloads\\Extrato Nubank.ofx", "C:\\outro.csv"] });

    expect(falso.pedidos).toEqual([
      {
        metodo: "arquivos.autorizar",
        dados: { caminho: "C:\\Users\\eu\\Downloads\\Extrato Nubank.ofx", finalidade: "extrato" },
      },
    ]);
    expect(aoAutorizar).toHaveBeenCalledWith(AUTORIZACAO);
    expect(alvo().dataset.sobre).toBeUndefined();
    expect(estado()?.getAttribute("role")).toBe("status");
    expect(estado()?.getAttribute("data-autorizacao")).toBe(AUTORIZACAO.id);
    expect(estado()?.textContent).toBe("Extrato Nubank.ofx recebido, 23 KB.");
    // O caminho não fica na tela.
    expect(recipiente.textContent).not.toContain("Downloads");
  });

  it("arrastar e desistir apaga o destaque sem pedir nada", async () => {
    await montar();
    await soltar({ type: "enter", paths: ["C:\\a.ofx"] });
    await soltar({ type: "over" });
    await soltar({ type: "leave" });
    expect(alvo().dataset.sobre).toBeUndefined();
    expect(falso.pedidos).toEqual([]);
  });

  it("arquivo que não é extrato nem comprovante é recusado na tela, sem ir ao serviço", async () => {
    await montar();
    await soltar({ type: "drop", paths: ["C:\\Users\\eu\\Downloads\\instalar.exe"] });
    expect(falso.pedidos).toEqual([]);
    expect(estado()?.getAttribute("role")).toBe("alert");
    expect(estado()?.textContent).toMatch(/não é um extrato nem um comprovante/);
  });

  it("a resposta de um arquivo anterior que chega depois é descartada", async () => {
    const respostas = new Map<string, (a: AutorizacaoArquivo) => void>();
    falso.responder = (_metodo, dados) =>
      new Promise((resolver) => respostas.set((dados as { caminho: string }).caminho, resolver));
    const aoAutorizar = vi.fn();
    await montar(aoAutorizar);

    await soltar({ type: "drop", paths: ["C:\\primeiro.ofx"] });
    await soltar({ type: "drop", paths: ["C:\\segundo.csv"] });
    const segundo = { ...AUTORIZACAO, id: "segundo", nome: "segundo.csv" };
    await act(async () => respostas.get("C:\\segundo.csv")!(segundo));
    await act(async () => respostas.get("C:\\primeiro.ofx")!({ ...AUTORIZACAO, id: "primeiro" }));

    expect(estado()?.getAttribute("data-autorizacao")).toBe("segundo");
    expect(aoAutorizar.mock.calls).toEqual([[segundo]]);
  });

  it("a recusa do serviço aparece como veio", async () => {
    falso.responder = () => Promise.reject(new Error("O arquivo tem 50 MB; o extrato vai até 10 MB."));
    await montar();
    await soltar({ type: "drop", paths: ["C:\\grande.csv"] });
    expect(estado()?.getAttribute("role")).toBe("alert");
    expect(estado()?.textContent).toBe("O arquivo tem 50 MB; o extrato vai até 10 MB.");
  });

  it("Escolher arquivo abre o diálogo e a imagem vai como comprovante", async () => {
    falso.escolher.mockResolvedValue("C:\\Users\\eu\\Pictures\\pix.PNG");
    await montar();
    const botao = recipiente.querySelector("button") as HTMLButtonElement;
    expect(botao.textContent).toBe("Escolher arquivo");

    await act(async () => botao.click());

    expect(falso.escolher).toHaveBeenCalledWith("extrato");
    expect(falso.pedidos).toEqual([
      {
        metodo: "arquivos.autorizar",
        dados: { caminho: "C:\\Users\\eu\\Pictures\\pix.PNG", finalidade: "comprovante" },
      },
    ]);
  });

  it("cancelar o diálogo não pede nada", async () => {
    falso.escolher.mockResolvedValue(null);
    await montar();
    await act(async () => (recipiente.querySelector("button") as HTMLButtonElement).click());
    expect(falso.pedidos).toEqual([]);
    expect(estado()).toBeNull();
  });

  it("sai de cena e para de ouvir a janela; nome acessível em tudo", async () => {
    await montar(undefined, true);
    expect(alvo().getAttribute("aria-label")).toBe("Extrato ou comprovante");
    expect(auditar(recipiente)).toEqual([]);
    act(() => raiz?.unmount());
    raiz = null;
    await act(async () => {});
    expect(falso.parou).toBe(1);
  });
});

describe("tamanhoLegivel", () => {
  it("KB abaixo de 1 MB, MB com uma casa acima", () => {
    expect(tamanhoLegivel(13)).toBe("1 KB");
    expect(tamanhoLegivel(23_552)).toBe("23 KB");
    expect(tamanhoLegivel(10 * 1024 * 1024)).toBe("10 MB");
    expect(tamanhoLegivel(1.4 * 1024 * 1024)).toBe("1,4 MB");
  });
});
