// @vitest-environment happy-dom
import type { Nota } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { esquecerRascunhos } from "../../areas/notas/notas.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { PainelNotas } from "./PainelNotas.tsx";

/*
 * O painel Notas do dock com um serviço de mentira que guarda as notas na memória, com a versão
 * que recusa o salvar atrasado e o aviso `notas.mudou`, e a casca falsa, que só anota os comandos.
 */
const falso = vi.hoisted(() => {
  const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
  return {
    notas: new Map<string, Nota>(),
    pedidos: [] as { metodo: string; dados: unknown }[],
    relogio: 0,
    ouvintes,
    emitir(nome: string, dados: unknown) {
      for (const fn of ouvintes.get(nome) ?? []) fn(dados);
    },
  };
});

const versao = () => new Date(Date.now() + ++falso.relogio).toISOString();
const resumo = (n: Nota) => {
  const { conteudo, ...resto } = n;
  return { ...resto, trecho: conteudo.split("\n").filter(Boolean).join(" · ") };
};

function responder(metodo: string, dados: Record<string, unknown> = {}): unknown {
  const n = typeof dados.id === "string" ? falso.notas.get(dados.id) : undefined;
  switch (metodo) {
    case "notas.listar":
      return [...falso.notas.values()].map(resumo);
    case "notas.obter":
      if (!n) throw new Error("nota não encontrada");
      return n;
    case "notas.salvar": {
      if (!n) throw new Error("nota não encontrada");
      const texto = {
        titulo: String(dados.titulo ?? n.titulo),
        conteudo: String(dados.conteudo ?? n.conteudo),
      };
      if (dados.versao !== n.atualizadoEm) return { salvou: false, atual: n, recusada: texto };
      const salva = { ...n, ...texto, atualizadoEm: versao() };
      falso.notas.set(salva.id, salva);
      falso.emitir("notas.mudou", { notas: [salva], apagadas: [] });
      return { salvou: true, nota: salva };
    }
    case "notas.criar": {
      const nova = { ...REUNIAO, id: "01NOVA", titulo: "", conteudo: "", atualizadoEm: versao() };
      falso.notas.set(nova.id, nova);
      return nova;
    }
    case "notas.buscar":
      return [...falso.notas.values()]
        .filter((x) => x.conteudo.includes(String(dados.texto)))
        .map((x) => ({
          ...resumo(x),
          destaques: [
            {
              inicio: x.conteudo.indexOf(String(dados.texto)),
              fim: x.conteudo.indexOf(String(dados.texto)) + String(dados.texto).length,
            },
          ],
        }));
  }
  throw new Error(`sem resposta para ${metodo}`);
}

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: Record<string, unknown>) => {
      falso.pedidos.push({ metodo, dados });
      try {
        return Promise.resolve(responder(metodo, dados));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
}));
const casca = vi.hoisted(() => ({ comandos: [] as { comando: string; args: unknown }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: unknown) => {
    casca.comandos.push({ comando, args });
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCO: Nota = {
  id: "bloco_rapido",
  titulo: "Bloco rápido",
  conteudo: "código do portão 4471\ntrocar filtro da água",
  fixada: true,
  pasta: null,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-18T10:00:00.000Z",
  atualizadoEm: "2026-10-18T14:59:00.000Z",
};
const VIAGEM: Nota = {
  ...BLOCO,
  id: "01VIAGEM",
  titulo: "Ideias para a viagem de dezembro",
  conteudo: "Três dias na serra",
  fixada: false,
  atualizadoEm: "2026-10-18T11:00:00.000Z",
};
const REUNIAO: Nota = {
  ...VIAGEM,
  id: "01REUNIAO",
  titulo: "Reunião de planejamento",
  conteudo: "Prioridades do trimestre",
  origem: "agente",
  agenteId: "alba",
  atualizadoEm: "2026-10-17T11:00:00.000Z",
};

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function andar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<PainelNotas canal="conectado" />));
  await andar();
  await andar();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00.000Z"));
  falso.notas = new Map([BLOCO, VIAGEM, REUNIAO].map((n) => [n.id, n]));
  falso.pedidos.length = 0;
  casca.comandos.length = 0;
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  esquecerRascunhos();
  vi.useRealTimers();
});

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor);
const botao = (texto: string) =>
  [...recipiente.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto);
const salvos = () => falso.pedidos.filter((p) => p.metodo === "notas.salvar").map((p) => p.dados);
const comandos = () => casca.comandos.map((c) => c.comando);

function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PainelNotas", () => {
  it("a nota fixa no alto, editável, e as recentes com quem as escreveu", async () => {
    await montar();
    expect(por(".painel-subtitulo")?.textContent).toBe("Alba · 2 notas");
    const fixa = por<HTMLTextAreaElement>("#" + CSS.escape(por("label")!.getAttribute("for")!))!;
    expect(fixa.tagName).toBe("TEXTAREA");
    expect(fixa.value).toBe(BLOCO.conteudo);
    expect(por(".painel-nota-fixa")?.textContent).toContain("salva há 1 min");
    expect(por(".painel-secao-cabecalho")?.textContent).toBe("Recentes2 de 2");
    expect([...recipiente.querySelectorAll(".painel-nota")].map((b) => b.textContent)).toEqual([
      "Ideias para a viagem de dezembrohojeTrês dias na serra",
      "Reunião de planejamentoontemPrioridades do trimestrecriada pela Alba",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("escrever na nota fixa pede o teclado à casca e salva sozinho, na hora ao sair do campo", async () => {
    await montar();
    const fixa = por<HTMLTextAreaElement>("textarea")!;
    act(() => {
      fixa.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      fixa.focus();
    });
    expect(casca.comandos).toContainEqual({ comando: "painel_foco", args: { quer: true } });
    digitar(fixa, `${BLOCO.conteudo}\nlevar o casaco`);
    await andar(800);
    expect(salvos()).toEqual([
      {
        id: "bloco_rapido",
        versao: BLOCO.atualizadoEm,
        titulo: BLOCO.titulo,
        conteudo: `${BLOCO.conteudo}\nlevar o casaco`,
      },
    ]);
    await andar();
    digitar(fixa, `${BLOCO.conteudo}\nlevar o casaco na costureira`);
    act(() => fixa.blur());
    expect(salvos()).toHaveLength(2);
    expect(casca.comandos.at(-1)).toEqual({ comando: "painel_foco", args: { quer: false } });
  });

  it("Esc na nota fixa salva antes de o painel fechar", async () => {
    await montar();
    const fixa = por<HTMLTextAreaElement>("textarea")!;
    digitar(fixa, "só isto");
    act(() => fixa.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(salvos().map((p) => (p as { conteudo: string }).conteudo)).toEqual(["só isto"]);
  });

  it("o Sistema mudou a nota fixa enquanto você escrevia aqui: as duas versões ficam para escolher", async () => {
    await montar();
    digitar(por<HTMLTextAreaElement>("textarea")!, "do painel");
    const doSistema = { ...BLOCO, conteudo: "do sistema", atualizadoEm: versao() };
    act(() => falso.emitir("notas.mudou", { notas: [doSistema], apagadas: [] }));
    expect(por('[role="alert"]')?.textContent).toContain("Esta nota mudou em outra janela.");
    act(() => botao("Usar o da outra janela")!.click());
    expect(por<HTMLTextAreaElement>("textarea")?.value).toBe("do sistema");
    await andar(2000);
    expect(salvos()).toEqual([]);
  });

  it("uma nota recente abre no Sistema e o painel fecha", async () => {
    await montar();
    act(() => [...recipiente.querySelectorAll<HTMLButtonElement>(".painel-nota")][1]!.click());
    expect(casca.comandos).toEqual([
      { comando: "sistema_abrir", args: { area: "notas/01REUNIAO" } },
      { comando: "painel_fechar", args: undefined },
    ]);
  });

  it("a busca troca as recentes pelo que bateu; Esc limpa a busca sem fechar o painel", async () => {
    await montar();
    const busca = por<HTMLInputElement>('input[type="search"]')!;
    digitar(busca, "serra");
    await andar(150);
    await andar();
    expect(por(".painel-secao-cabecalho")?.textContent).toBe("Achadas1 nota");
    expect(por(".painel-nota mark")?.textContent).toBe("serra");
    const naJanela = vi.fn();
    window.addEventListener("keydown", naJanela);
    act(() => busca.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    window.removeEventListener("keydown", naJanela);
    expect(busca.value).toBe("");
    expect(naJanela).not.toHaveBeenCalled();
    expect(por(".painel-secao-cabecalho")?.textContent).toBe("Recentes2 de 2");
  });

  it("nova nota nasce em branco e abre no Sistema", async () => {
    await montar();
    await act(async () => botao("Nova nota")!.click());
    expect(comandos()).toEqual(["sistema_abrir", "painel_fechar"]);
    expect(casca.comandos[0]?.args).toEqual({ area: "notas/01NOVA" });
  });
});
