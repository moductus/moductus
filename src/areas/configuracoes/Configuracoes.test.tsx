// @vitest-environment happy-dom
import { CONFIG_PADRAO, type EstadoConfig } from "@moductus/contrato";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combinacaoDoTeclado } from "../../componentes/CampoAtalho.tsx";
import { SecaoAtalhos } from "./Atalhos.tsx";
import { SecaoGeral } from "./Geral.tsx";
import { SecaoModelos } from "./Modelos.tsx";
import { SecaoOutroPc } from "./OutroPc.tsx";
import { SecaoTemaDock } from "./TemaDock.tsx";

// O serviço é falso: cada pedido fica registrado e a resposta vem de `responder`.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> => Promise.resolve(undefined),
  ouvintes: new Map<string, (dados: unknown) => void>(),
}));
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      return falso.responder(metodo, dados);
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      falso.ouvintes.set(nome, fn);
      return () => falso.ouvintes.delete(nome);
    },
  },
  useCanal: () => "conectado",
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));
const dialogo = vi.hoisted(() => ({ escolherArquivo: vi.fn(), escolherOndeSalvar: vi.fn() }));
vi.mock("../../nativo/arquivos.ts", () => dialogo);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estadoBase = (mudar: Partial<EstadoConfig> = {}): EstadoConfig => ({
  config: CONFIG_PADRAO,
  portable: false,
  falhasAtalhos: {},
  ...mudar,
});

/** Serviço que aceita tudo: config.definir devolve o estado com a mudança aplicada. */
function servicoQueAceita(inicial = estadoBase()) {
  let atual = inicial;
  falso.responder = (metodo, dados) => {
    if (metodo === "config.obter") return Promise.resolve(atual);
    if (metodo === "config.definir") {
      atual = { ...atual, config: { ...atual.config, ...(dados as object) } };
      return Promise.resolve(atual);
    }
    return Promise.reject(new Error(`sem resposta para ${metodo}`));
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar(no: ReactNode) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(no));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  dialogo.escolherArquivo.mockReset();
  dialogo.escolherOndeSalvar.mockReset();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor)!;
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) => todos("button").find((b) => b.textContent === texto)!;
const opcao = (grupo: string, texto: string) =>
  [...por(`[role="radiogroup"][aria-label="${grupo}"]`).querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (r) => r.textContent === texto,
  )!;
const definicoes = () => falso.pedidos.filter((p) => p.metodo === "config.definir").map((p) => p.dados);
const alerta = () => por('[role="alert"]')?.textContent ?? null;

async function clicar(el: HTMLElement) {
  await act(async () => el.click());
}

async function teclar(el: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

describe("Geral", () => {
  it("liga o início com o Windows mandando só o autostart", async () => {
    servicoQueAceita();
    await montar(<SecaoGeral />);
    const chave = por('[role="switch"]');
    expect(chave.getAttribute("aria-checked")).toBe("false");
    await clicar(chave);
    expect(definicoes()).toEqual([{ autostart: true }]);
    expect(chave.getAttribute("aria-checked")).toBe("true");
  });

  it("portable: mostra o modo só para ler e não deixa ligar o autostart", async () => {
    servicoQueAceita(estadoBase({ portable: true }));
    await montar(<SecaoGeral />);
    const chave = por('[role="switch"]');
    expect(chave.getAttribute("aria-disabled")).toBe("true");
    await clicar(chave);
    expect(definicoes()).toEqual([]);
    expect(recipiente.textContent).toContain("Indisponível no modo portable");
    // O modo em si é só leitura: um selo, nenhum controle.
    expect(por(".selo").textContent).toBe("Ligado");
    expect(todos("[role='switch']:not([aria-disabled])")).toEqual([]);
  });

  it("acompanha a mudança feita em outra janela", async () => {
    servicoQueAceita();
    await montar(<SecaoGeral />);
    await act(async () =>
      falso.ouvintes.get("config.mudou")!(estadoBase({ config: { ...CONFIG_PADRAO, autostart: true } })),
    );
    expect(por('[role="switch"]').getAttribute("aria-checked")).toBe("true");
  });
});

describe("Tema e dock", () => {
  it("tema e cada parte do dock vão ao serviço com o valor certo", async () => {
    servicoQueAceita();
    await montar(<SecaoTemaDock />);
    await clicar(opcao("Tema", "Papel"));
    await clicar(opcao("Lado do dock", "Direita"));
    await clicar(opcao("Comportamento do dock", "Inteligente"));
    await clicar(opcao("Forma do dock", "Flutuante"));
    expect(definicoes()).toEqual([
      { tema: "papel" },
      { dock: { lado: "direita", modo: "fixo", forma: "colada" } },
      { dock: { lado: "direita", modo: "inteligente", forma: "colada" } },
      { dock: { lado: "direita", modo: "inteligente", forma: "flutuante" } },
    ]);
    expect(opcao("Lado do dock", "Direita").getAttribute("aria-checked")).toBe("true");
  });

  it("a recusa da casca vira mensagem e a opção anterior continua marcada", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "config.definir"
        ? Promise.reject(new Error("O dock não pôde mudar de lado agora"))
        : aceitar(metodo, dados);
    await montar(<SecaoTemaDock />);
    await clicar(opcao("Lado do dock", "Direita"));
    expect(alerta()).toContain("O dock não pôde mudar de lado agora");
    expect(opcao("Lado do dock", "Esquerda").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Atalhos", () => {
  it("lê a combinação do teclado pela tecla física e espera a tecla comum", () => {
    const tecla = { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(combinacaoDoTeclado({ ...tecla, key: "Alt", code: "AltLeft" })).toBeNull();
    expect(combinacaoDoTeclado({ ...tecla, key: "k", code: "KeyK" })).toBe("Ctrl+Alt+K");
    expect(combinacaoDoTeclado({ ...tecla, key: "!", code: "Digit1", shiftKey: true })).toBe(
      "Ctrl+Alt+Shift+1",
    );
    expect(combinacaoDoTeclado({ ...tecla, key: " ", code: "Space" })).toBe("Ctrl+Alt+Space");
  });

  it("grava a nova combinação e manda os três atalhos com só ela trocada", async () => {
    servicoQueAceita();
    await montar(<SecaoAtalhos />);
    const campo = por('button[aria-label^="Captura rápida"]');
    expect(campo.textContent).toBe("CtrlAltEspaço");
    await clicar(campo);
    expect(campo.textContent).toContain("Pressione a combinação");
    await teclar(campo, { key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(definicoes()).toEqual([]);
    await teclar(campo, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    expect(definicoes()).toEqual([{ atalhos: { ...CONFIG_PADRAO.atalhos, captura: "Ctrl+Alt+K" } }]);
    expect(campo.textContent).toBe("CtrlAltK");
  });

  it("Esc cancela a gravação sem mandar nada", async () => {
    servicoQueAceita();
    await montar(<SecaoAtalhos />);
    const campo = por('button[aria-label^="Abrir o Sistema"]');
    await clicar(campo);
    await teclar(campo, { key: "Escape", code: "Escape" });
    expect(definicoes()).toEqual([]);
    expect(campo.textContent).toBe("CtrlAltN");
  });

  it("conflito: mostra o motivo que veio do serviço e o atalho anterior continua", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "config.definir"
        ? Promise.reject(new Error("Ctrl+Alt+K já está em uso por outro programa"))
        : aceitar(metodo, dados);
    await montar(<SecaoAtalhos />);
    const campo = por('button[aria-label^="Captura rápida"]');
    await clicar(campo);
    await teclar(campo, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    expect(alerta()).toBe(
      "Ctrl+Alt+K já está em uso por outro programa. O atalho anterior continua valendo.",
    );
    expect(campo.textContent).toBe("CtrlAltEspaço");
  });

  it("mostra a falha que a casca informou ao subir, na linha do atalho", async () => {
    servicoQueAceita(
      estadoBase({ falhasAtalhos: { captura: "Ctrl+Alt+Space já está em uso por outro programa" } }),
    );
    await montar(<SecaoAtalhos />);
    const linhas = todos(".config-atalho");
    expect(linhas[2]!.querySelector('[role="alert"]')!.textContent).toBe(
      "Ctrl+Alt+Space já está em uso por outro programa",
    );
    expect(linhas[0]!.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("Levar para outro PC", () => {
  const CAMINHO = "C:\\Users\\eu\\casa-2026-10-08.moductus";
  const previa = (mudancas: unknown[]) => ({
    pc_origem: "CASA",
    criado_em: "2026-10-07T21:14:00.000Z",
    versao_app: "0.5.0-alpha",
    mudancas,
  });

  it("exportar: escolhe onde salvar e pede ao serviço", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "config.exportar"
        ? Promise.resolve({ caminho: CAMINHO, bytes: 812, chaves: ["tema"] })
        : aceitar(metodo, dados);
    dialogo.escolherOndeSalvar.mockResolvedValue(CAMINHO);
    await montar(<SecaoOutroPc />);
    await clicar(botao("Gerar arquivo"));
    expect(falso.pedidos.find((p) => p.metodo === "config.exportar")?.dados).toEqual({ caminho: CAMINHO });
    expect(por('[role="status"]').textContent).toContain("812 bytes");
  });

  it("importar: mostra o que vai mudar e só grava depois de confirmar", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) => {
      if (metodo === "config.previaImportar") {
        const { modo } = dados as { modo: string };
        return Promise.resolve(
          previa([
            { chave: "tema", atual: "automatico", novo: "vidro" },
            ...(modo === "substituir" ? [{ chave: "autostart", atual: true, novo: false }] : []),
          ]),
        );
      }
      if (metodo === "config.importar") return Promise.resolve(estadoBase());
      return aceitar(metodo, dados);
    };
    dialogo.escolherArquivo.mockResolvedValue(CAMINHO);
    await montar(<SecaoOutroPc />);
    await clicar(botao("Escolher arquivo"));

    expect(recipiente.textContent).toContain("casa-2026-10-08.moductus");
    const itens = () => todos(".config-mudanca").map((li) => li.textContent);
    expect(itens()).toEqual(["TemaAutomático→passa aVidro"]);
    expect(falso.pedidos.some((p) => p.metodo === "config.importar")).toBe(false);

    // Substituir: a prévia é refeita no outro modo e o botão diz o que vai acontecer.
    await clicar(opcao("O que fazer com este PC", "Substituir"));
    expect(falso.pedidos.filter((p) => p.metodo === "config.previaImportar").map((p) => p.dados)).toEqual([
      { caminho: CAMINHO, modo: "juntar" },
      { caminho: CAMINHO, modo: "substituir" },
    ]);
    expect(itens()).toEqual(["TemaAutomático→passa aVidro", "Iniciar com o WindowsLigado→passa aDesligado"]);
    expect(falso.pedidos.some((p) => p.metodo === "config.importar")).toBe(false);

    await clicar(botao("Substituir neste PC"));
    expect(falso.pedidos.filter((p) => p.metodo === "config.importar").map((p) => p.dados)).toEqual([
      { caminho: CAMINHO, modo: "substituir" },
    ]);
    expect(por('[role="status"]').textContent).toBe("Pronto: 2 configurações trocadas.");
  });

  it("cancelar a prévia não importa nada", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "config.previaImportar"
        ? Promise.resolve(previa([{ chave: "tema", atual: "automatico", novo: "papel" }]))
        : aceitar(metodo, dados);
    dialogo.escolherArquivo.mockResolvedValue(CAMINHO);
    await montar(<SecaoOutroPc />);
    await clicar(botao("Escolher arquivo"));
    await clicar(botao("Cancelar"));
    expect(todos(".config-mudanca")).toEqual([]);
    expect(falso.pedidos.some((p) => p.metodo === "config.importar")).toBe(false);
  });

  it("arquivo recusado pelo serviço vira mensagem, sem prévia", async () => {
    servicoQueAceita();
    const aceitar = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "config.previaImportar"
        ? Promise.reject(new Error("O arquivo está corrompido ou não é um arquivo do Moductus."))
        : aceitar(metodo, dados);
    dialogo.escolherArquivo.mockResolvedValue(CAMINHO);
    await montar(<SecaoOutroPc />);
    await clicar(botao("Escolher arquivo"));
    expect(alerta()).toContain("corrompido");
    expect(todos(".config-mudanca")).toEqual([]);
  });
});

describe("Modelos", () => {
  it("continua no estado vazio, apontando para a fase 2", async () => {
    await montar(<SecaoModelos />);
    expect(por(".estado-vazio .selo").textContent).toBe("Fase 2");
  });
});
