// @vitest-environment happy-dom
import {
  CONFIG_PADRAO,
  MISSOES_TUTORIAL,
  PASSOS_PRIMEIRO_USO,
  type Config,
  type EstadoPrimeiroUso,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar, marcos } from "../../../teste/acessibilidade.ts";
import { Sistema } from "../Sistema.tsx";

// A casca não existe no teste: eventos, janela e comandos falsos.
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
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve({ estado: "parado" })) }));

/** Serviço falso em memória: guarda o que a interface pede e responde como o de verdade. */
const falso = vi.hoisted(() => {
  const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
  return {
    ouvintes,
    estado: null as unknown,
    config: null as unknown,
    pedidos: [] as [string, unknown][],
    /** O que a detecção do serviço acha e os provedores que ele guarda. */
    detectados: [] as unknown[],
    provedores: [] as { id: string; tipo: string; nome: string }[],
    criados: 0,
    /** Quando preenchido, criar provedor é recusado com esta mensagem. */
    recusarCriar: null as string | null,
    /** Como o teste de cada provedor termina. */
    teste: (_id: string): unknown => null,
    emitir(nome: string, dados: unknown) {
      for (const fn of ouvintes.get(nome) ?? []) fn(dados);
    },
  };
});

vi.mock("../../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    ouvir(nome: string, fn: (dados: unknown) => void) {
      const lista = falso.ouvintes.get(nome) ?? new Set();
      lista.add(fn);
      falso.ouvintes.set(nome, lista);
      return () => lista.delete(fn);
    },
    pedir(metodo: string, dados?: unknown) {
      falso.pedidos.push([metodo, dados]);
      // Como o canal: o erro do serviço chega como promessa recusada.
      try {
        return Promise.resolve(atender(metodo, dados));
      } catch (erro) {
        return Promise.reject(erro as Error);
      }
    },
  },
}));

function estadoConfig() {
  return { config: falso.config as Config, portable: false, falhasAtalhos: {} };
}

function atender(metodo: string, dados: unknown): unknown {
  const estado = falso.estado as EstadoPrimeiroUso;
  switch (metodo) {
    case "provedores.detectar":
      return falso.detectados;
    case "provedores.listar":
      return falso.provedores;
    case "provedores.criar": {
      if (falso.recusarCriar) throw new Error(falso.recusarCriar);
      const novo = { id: `prov-${++falso.criados}`, ...(dados as { tipo: string; nome: string }) };
      falso.provedores = [...falso.provedores, novo];
      return novo;
    }
    case "provedores.remover": {
      const { id } = dados as { id: string };
      if (!falso.provedores.some((p) => p.id === id)) throw new Error("provedor não encontrado");
      falso.provedores = falso.provedores.filter((p) => p.id !== id);
      return falso.provedores;
    }
    case "provedores.testar": {
      // Como o serviço: id que não existe é erro; o que passa toma o lugar dos que substitui.
      const { id, substitui = [] } = dados as { id: string; substitui?: string[] };
      if (!falso.provedores.some((p) => p.id === id)) throw new Error("provedor não encontrado");
      const resultado = falso.teste(id) as { ok: boolean };
      if (resultado.ok) falso.provedores = falso.provedores.filter((p) => !substitui.includes(p.id));
      return resultado;
    }
    case "config.obter":
      return estadoConfig();
    case "config.definir":
      falso.config = { ...(falso.config as Config), ...(dados as Partial<Config>) };
      falso.emitir("config.mudou", estadoConfig());
      return estadoConfig();
    case "primeiroUso.obter":
      return estado;
    case "primeiroUso.concluir": {
      const { passos } = dados as { passos: Record<string, string> };
      falso.estado = {
        ...estado,
        concluido: true,
        concluidoEm: "2026-10-08T12:00:00.000Z",
        passos: Object.fromEntries(PASSOS_PRIMEIRO_USO.map((p) => [p, passos[p] ?? "pulado"])),
      };
      break;
    }
    case "primeiroUso.marcar": {
      const pedido = dados as { alvo: string; missao?: string; estado: string };
      falso.estado =
        pedido.alvo === "tutorial"
          ? { ...estado, tutorial: pedido.estado }
          : { ...estado, missoes: { ...estado.missoes, [pedido.missao!]: pedido.estado } };
      break;
    }
    default:
      throw new Error(`método inesperado: ${metodo}`);
  }
  falso.emitir("primeiroUso.mudou", falso.estado);
  return falso.estado;
}

const pendentes = <T extends string>(ids: readonly T[]) =>
  Object.fromEntries(ids.map((id) => [id, "pendente"])) as Record<T, "pendente">;

function bancoNovo(): EstadoPrimeiroUso {
  return {
    concluido: false,
    concluidoEm: null,
    passos: pendentes(PASSOS_PRIMEIRO_USO),
    tutorial: "pendente",
    missoes: pendentes(MISSOES_TUTORIAL),
  };
}

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

beforeEach(() => {
  localStorage.clear();
  falso.ouvintes.clear();
  falso.pedidos = [];
  falso.estado = bancoNovo();
  falso.config = structuredClone(CONFIG_PADRAO);
  falso.detectados = [];
  falso.provedores = [];
  falso.criados = 0;
  falso.recusarCriar = null;
  falso.teste = (id) => ({
    ok: true,
    provedorId: id,
    latenciaMs: 2100,
    testadoEm: "2026-10-10T12:00:00.000Z",
  });
});
afterEach(desmontar);

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const titulo = () => por("h1")?.textContent;
const indicador = () => por(".uso-rodape [aria-live]")?.textContent;
const botao = (texto: string) => todos("button").find((b) => b.textContent === texto);
const pedidosDe = (metodo: string) => falso.pedidos.filter(([m]) => m === metodo).map(([, d]) => d);

async function clicar(el: HTMLElement | undefined | null) {
  expect(el, "elemento para clicar").toBeTruthy();
  await act(async () => el!.click());
}

async function teclar(alvo: EventTarget, key: string) {
  await act(async () => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const TITULOS = [
  "Seu time no PC",
  "Como o Moductus fica na sua tela",
  "Qual IA move os agentes",
  "Alba, Tula, Faina e Nuno",
  "O que cada agente pode alcançar",
];

describe("primeiro uso", () => {
  it("banco novo: o Sistema abre no passo 1, sem as áreas, com o foco no título", async () => {
    await montar();
    expect(titulo()).toBe("Seu time no PC");
    expect(indicador()).toBe("Passo 1 de 5");
    expect(por('nav[aria-label="Áreas"]')).toBeNull();
    expect(document.activeElement).toBe(por("h1"));
    expect(botao("Voltar")).toBeUndefined();
    expect(todos(".uso-passo[aria-current='step']").map((p) => p.textContent)).toEqual(["1Boas-vindas"]);
  });

  it("os cinco passos na ordem, cada um com o seu botão de seguir", async () => {
    await montar();
    const seguir = ["Começar", "Continuar", "Depois", "Continuar", "Concluir"];
    for (const [i, nome] of TITULOS.entries()) {
      expect(titulo()).toBe(nome);
      expect(indicador()).toBe(`Passo ${i + 1} de 5`);
      expect(por(".uso-passo[aria-current='step']")!.textContent).toContain(
        ["Boas-vindas", "Tema e dock", "Modelo", "Conhecer o time", "Conexões"][i]!,
      );
      expect(document.activeElement).toBe(por("h1"));
      if (i < TITULOS.length - 1) await clicar(botao(seguir[i]!));
    }
    expect(botao("Concluir")).toBeTruthy();
    // Os passos já vistos ficam marcados na lateral.
    expect(todos(".uso-passo[data-estado='feito']")).toHaveLength(4);
  });

  it("voltar pelo botão e pelo Esc; no passo 1 o Esc não faz nada", async () => {
    await montar();
    await clicar(botao("Começar"));
    await clicar(botao("Continuar"));
    expect(titulo()).toBe(TITULOS[2]);
    await clicar(botao("Voltar"));
    expect(titulo()).toBe(TITULOS[1]);
    await teclar(por("h1")!, "Escape");
    expect(titulo()).toBe(TITULOS[0]);
    await teclar(por("h1")!, "Escape");
    expect(titulo()).toBe(TITULOS[0]);
  });

  it("Enter numa opção segue para o próximo passo", async () => {
    await montar();
    const zero = por<HTMLInputElement>('input[name="origem"]')!;
    expect(zero.checked).toBe(true);
    await teclar(zero, "Enter");
    expect(titulo()).toBe(TITULOS[1]);
  });

  it("tema e dock gravam na hora pela configuração do serviço", async () => {
    await montar();
    await clicar(botao("Começar"));
    const temas = todos('input[name="tema"]') as HTMLInputElement[];
    expect(temas.map((t) => t.closest("label")!.querySelector(".uso-opcao-titulo")!.textContent)).toEqual([
      "Automático",
      "Grafite",
      "Papel",
      "Vidro",
    ]);
    expect(temas[0]!.checked).toBe(true);

    await clicar(temas[3]);
    await clicar(por('[role="radiogroup"][aria-label="Lado do dock"] [role="radio"]:last-child'));
    await clicar(por('[role="radiogroup"][aria-label="Forma do dock"] [role="radio"]:last-child'));
    await clicar(por('[role="radiogroup"][aria-label="Comportamento do dock"] [role="radio"]:nth-child(3)'));

    expect(pedidosDe("config.definir")).toEqual([
      { tema: "vidro" },
      { dock: { lado: "direita", modo: "fixo", forma: "colada" } },
      { dock: { lado: "direita", modo: "fixo", forma: "flutuante" } },
      { dock: { lado: "direita", modo: "inteligente", forma: "flutuante" } },
    ]);
    expect((todos('input[name="tema"]') as HTMLInputElement[])[3]!.checked).toBe(true);
    expect(por('[role="radiogroup"][aria-label="Lado do dock"] [aria-checked="true"]')!.textContent).toBe(
      "Direita",
    );
  });

  it("sem modelo testado, o passo segue com Depois e conta como pulado", async () => {
    await noModelo();
    expect(botao("Continuar")).toBeUndefined();
    await clicar(botao("Depois"));
    expect(titulo()).toBe(TITULOS[3]);
    expect(falso.pedidos.map(([m]) => m)).not.toContain("primeiroUso.concluir");
    expect(pedidosDe("provedores.testar")).toEqual([]);
  });

  it("concluir grava como cada passo terminou e abre o Início com os Primeiros passos", async () => {
    await montar();
    for (const nome of ["Começar", "Continuar", "Depois", "Continuar", "Concluir"]) await clicar(botao(nome));
    expect(pedidosDe("primeiroUso.concluir")).toEqual([
      {
        passos: {
          "boas-vindas": "feito",
          "tema-dock": "feito",
          modelo: "pulado",
          time: "feito",
          conexoes: "feito",
        },
      },
    ]);
    expect(por("main")!.dataset.area).toBe("inicio");
    expect(por('nav[aria-label="Áreas"]')).toBeTruthy();
    expect(por(".primeiros-passos h2")!.textContent).toBe("Primeiros passos");
  });

  it("pular a configuração no meio grava o que foi visto e vai ao Início", async () => {
    await montar();
    await clicar(botao("Começar"));
    await clicar(botao("Pular configuração"));
    expect(pedidosDe("primeiroUso.concluir")).toEqual([{ passos: { "boas-vindas": "feito" } }]);
    expect(por("main")!.dataset.area).toBe("inicio");
  });

  it("já uso em outro PC: conclui e leva a Configurações, Levar para outro PC", async () => {
    await montar();
    await clicar(todos('input[name="origem"]')[1]);
    await clicar(botao("Importar o arquivo"));
    expect(pedidosDe("primeiroUso.concluir")).toEqual([{ passos: { "boas-vindas": "feito" } }]);
    expect(por("main")!.dataset.area).toBe("configuracoes");
    expect(por(".config-secao h2")!.textContent).toBe("Levar para outro PC");
  });

  it("depois de concluído não aparece de novo: o Sistema abre direto nas áreas", async () => {
    await montar();
    await clicar(botao("Pular configuração"));
    desmontar();
    await montar();
    expect(por(".uso")).toBeNull();
    expect(por("main")!.dataset.area).toBe("inicio");
    expect(pedidosDe("primeiroUso.concluir")).toHaveLength(1);
  });

  it("sem resposta do serviço, o Sistema abre normal em vez de prender a janela", async () => {
    falso.estado = new Promise(() => undefined);
    await montar();
    expect(por(".uso")).toBeNull();
    expect(por("main")!.dataset.area).toBe("inicio");
  });
});

const CLAUDE = {
  tipo: "claude-cli",
  caminho: "C:\\bin\\claude.exe",
  versao: "2.1.287",
  logado: true,
  impedimento: null,
  versaoMinima: null,
};

async function noModelo() {
  await montar();
  await clicar(botao("Começar"));
  await clicar(botao("Continuar"));
  expect(titulo()).toBe("Qual IA move os agentes");
}

/** Cada cartão de modelo: título, selo, texto e se dá para escolher. */
const modelos = () =>
  todos('input[name="modelo"]').map((r) => {
    const cartao = r.closest("label")!;
    return {
      nome: cartao.querySelector(".uso-opcao-titulo")!.textContent,
      selo: cartao.querySelector(".selo")?.textContent ?? null,
      texto: cartao.querySelector(".uso-opcao-texto")!.textContent,
      marcado: (r as HTMLInputElement).checked,
      desativado: (r as HTMLInputElement).disabled,
    };
  });

async function digitar(rotulo: string, valor: string) {
  const campo = todos("label").find((l): l is HTMLLabelElement => l.textContent === rotulo);
  const entrada = campo && recipiente.querySelector<HTMLInputElement>(`#${CSS.escape(campo.htmlFor)}`);
  expect(entrada, `campo ${rotulo}`).toBeTruthy();
  const definirValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    definirValor.call(entrada, valor);
    entrada!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("primeiro uso: modelo", () => {
  it("mostra o que o serviço achou no PC: só o que dá para usar pode ser escolhido", async () => {
    falso.detectados = [
      CLAUDE,
      {
        ...CLAUDE,
        tipo: "gemini-cli",
        caminho: "C:\\npm\\gemini.cmd",
        versao: "0.42.0",
        logado: null,
        impedimento: "sem_adaptador",
      },
    ];
    await noModelo();
    expect(pedidosDe("provedores.detectar")).toHaveLength(1);
    expect(modelos()).toEqual([
      {
        nome: "Claude Code",
        selo: "detectado · conectado",
        texto: "CLI no PATH, versão 2.1.287 · login da assinatura",
        marcado: true,
        desativado: false,
      },
      {
        nome: "Codex",
        selo: "não encontrado",
        texto: "Instale o Codex e volte aqui.",
        marcado: false,
        desativado: true,
      },
      {
        nome: "Gemini CLI",
        selo: "detectado",
        texto: "CLI no PATH, versão 0.42.0 · esta versão do Moductus ainda não conecta a ele.",
        marcado: false,
        desativado: true,
      },
      {
        nome: "OpenCode",
        selo: "não encontrado",
        texto: "Instale o OpenCode e volte aqui.",
        marcado: false,
        desativado: true,
      },
      {
        nome: "Chave de API",
        selo: null,
        texto: "OpenAI ou compatível com OpenAI (Ollama, OpenRouter, LM Studio) · paga por uso",
        marcado: false,
        desativado: false,
      },
    ]);
    // Nada chama o modelo sem o usuário pedir.
    expect(pedidosDe("provedores.testar")).toEqual([]);

    falso.detectados = [{ ...CLAUDE, versao: "2.1.100", versaoMinima: "2.1.257" }];
    await clicar(botao("Procurar de novo"));
    expect(modelos()[0]).toMatchObject({ selo: "desatualizado", desativado: true });
  });

  it("Testar conecta o CLI escolhido e mostra a latência real; aí o passo segue com Continuar", async () => {
    falso.detectados = [CLAUDE];
    await noModelo();
    await clicar(botao("Testar"));

    expect(pedidosDe("provedores.criar")).toEqual([{ tipo: "claude-cli", nome: "Claude Code" }]);
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "prov-1" }]);
    const nota = por(".uso-nota")!;
    expect(nota.querySelector(".uso-item-nome")!.textContent).toBe(
      "Teste feito: Claude Code respondeu em 2,1 s",
    );
    expect(nota.textContent).toContain("Usa a sua assinatura.");
    expect(nota.querySelector(".selo")!.textContent).toBe("funcionando");

    await clicar(botao("Continuar"));
    for (const nome of ["Continuar", "Concluir"]) await clicar(botao(nome));
    expect(pedidosDe("primeiroUso.concluir")).toEqual([
      {
        passos: {
          "boas-vindas": "feito",
          "tema-dock": "feito",
          modelo: "feito",
          time: "feito",
          conexoes: "feito",
        },
      },
    ]);
  });

  it("o provedor que já existe é testado sem criar outro; voltar e seguir não perde o teste", async () => {
    falso.detectados = [CLAUDE];
    falso.provedores = [{ id: "ja-existia", tipo: "claude-cli", nome: "Claude Code" }];
    await noModelo();
    await clicar(botao("Testar"));
    expect(pedidosDe("provedores.criar")).toEqual([]);
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "ja-existia" }]);

    await clicar(botao("Voltar"));
    await clicar(botao("Continuar"));
    expect(por(".uso-nota .selo")!.textContent).toBe("funcionando");
    expect(botao("Continuar")).toBeTruthy();
  });

  it("falha do teste diz o motivo do serviço e o passo continua como Depois", async () => {
    falso.detectados = [CLAUDE];
    falso.teste = (id) => ({
      ok: false,
      provedorId: id,
      falha: { motivo: "limite", mensagem: "O limite de uso acabou.", voltaEm: null },
      testadoEm: "2026-10-10T12:00:00.000Z",
    });
    await noModelo();
    await clicar(botao("Testar"));

    const nota = por(".uso-nota")!;
    expect(nota.querySelector(".uso-item-nome")!.textContent).toBe("Claude Code não passou no teste");
    expect(nota.textContent).toContain("O limite de uso acabou.");
    expect(nota.querySelector(".selo")!.textContent).toBe("não funcionou");
    expect(botao("Testar de novo")).toBeTruthy();
    expect(botao("Depois")).toBeTruthy();
  });

  it("chave de API: o formulário vira o provedor, e o CLI testado antes neste passo sai", async () => {
    falso.detectados = [CLAUDE];
    await noModelo();
    await clicar(botao("Testar"));
    expect(falso.provedores.map((p) => p.id)).toEqual(["prov-1"]);

    await clicar(todos('input[name="modelo"]').at(-1));
    expect(botao("Depois")).toBeTruthy();
    await clicar(por('[role="radiogroup"][aria-label="Provedor da chave"] [role="radio"]:last-child'));
    await digitar("Endereço (base_url)", "http://localhost:11434/v1");
    await digitar("Modelo", "qwen3:8b");
    await digitar("Chave", "sk-local");
    expect(por<HTMLInputElement>('input[type="password"]')!.value).toBe("sk-local");
    await clicar(botao("Testar"));

    // A troca é do serviço, no teste: a interface não remove nada sozinha.
    expect(pedidosDe("provedores.remover")).toEqual([]);
    expect(pedidosDe("provedores.criar").at(-1)).toEqual({
      tipo: "openai-compativel",
      nome: "localhost:11434",
      baseUrl: "http://localhost:11434/v1",
      modelo: "qwen3:8b",
      chave: "sk-local",
    });
    expect(pedidosDe("provedores.testar").at(-1)).toEqual({ id: "prov-2", substitui: ["prov-1"] });
    expect(falso.provedores.map((p) => p.id)).toEqual(["prov-2"]);
    expect(por(".uso-nota")!.textContent).toContain("Paga por uso");
    // A chave foi para o Gerenciador de Credenciais e saiu da tela.
    expect(por<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("criar que falha não estraga o passo: o Testar seguinte funciona e o primeiro fica", async () => {
    falso.detectados = [CLAUDE];
    await noModelo();
    await clicar(botao("Testar"));
    expect(falso.provedores.map((p) => p.id)).toEqual(["prov-1"]);

    await clicar(todos('input[name="modelo"]').at(-1));
    await clicar(por('[role="radiogroup"][aria-label="Provedor da chave"] [role="radio"]:last-child'));
    await digitar("Endereço (base_url)", "http://localhost:11434/v1");
    falso.recusarCriar = "O endereço (base_url) não é válido.";
    await clicar(botao("Testar"));
    expect(por(".uso-nota")!.textContent).toContain("O endereço (base_url) não é válido.");
    expect(falso.provedores.map((p) => p.id)).toEqual(["prov-1"]);

    // De volta ao Claude Code: o mesmo provedor, sem nada a substituir.
    await clicar(todos('input[name="modelo"]')[0]);
    await clicar(botao("Testar"));
    expect(pedidosDe("provedores.testar").at(-1)).toEqual({ id: "prov-1" });
    expect(por(".uso-nota .selo")!.textContent).toBe("funcionando");

    // E a chave de API, agora aceita, toma o lugar dele.
    falso.recusarCriar = null;
    await clicar(todos('input[name="modelo"]').at(-1));
    await clicar(botao("Testar"));
    expect(pedidosDe("provedores.testar").at(-1)).toEqual({ id: "prov-2", substitui: ["prov-1"] });
    expect(falso.provedores.map((p) => p.id)).toEqual(["prov-2"]);
  });

  it("o que falhou sai junto quando outro passa; o que já existia antes do passo nunca", async () => {
    falso.detectados = [CLAUDE];
    falso.provedores = [{ id: "ja-existia", tipo: "claude-cli", nome: "Claude Code" }];
    await noModelo();
    await clicar(botao("Testar"));

    await clicar(todos('input[name="modelo"]').at(-1));
    await digitar("Modelo", "gpt-5-mini");
    falso.teste = (id) => ({
      ok: false,
      provedorId: id,
      falha: { motivo: "credencial", mensagem: "A OpenAI pede uma chave.", voltaEm: null },
      testadoEm: "2026-10-10T12:00:00.000Z",
    });
    await clicar(botao("Testar"));
    expect(pedidosDe("provedores.testar").at(-1)).toEqual({ id: "prov-1" });

    falso.teste = (id) => ({
      ok: true,
      provedorId: id,
      latenciaMs: 900,
      testadoEm: "2026-10-10T12:00:00.000Z",
    });
    await digitar("Chave", "sk-certa");
    await clicar(botao("Testar"));
    expect(pedidosDe("provedores.testar").at(-1)).toEqual({ id: "prov-2", substitui: ["prov-1"] });
    expect(falso.provedores.map((p) => p.id)).toEqual(["ja-existia", "prov-2"]);
  });

  it("o Claude Code do npm aparece, mas não dá para escolher", async () => {
    falso.detectados = [{ ...CLAUDE, caminho: "C:\\npm\\claude.cmd", impedimento: "instalado_pelo_npm" }];
    await noModelo();
    expect(modelos()[0]).toEqual({
      nome: "Claude Code",
      selo: "instalado pelo npm",
      texto:
        "CLI no PATH, versão 2.1.287 · o Moductus usa o Claude Code do instalador nativo. Instale por ele e procure de novo.",
      marcado: false,
      desativado: true,
    });
  });
});

describe("Primeiros passos", () => {
  async function noInicio() {
    falso.estado = { ...bancoNovo(), concluido: true, concluidoEm: "2026-10-08T12:00:00.000Z" };
    await montar();
  }

  it("cinco missões, uma por agente, e o cartão de treino da Faina responde sem mexer em nada", async () => {
    await noInicio();
    expect(todos(".missao").map((m) => m.dataset.missao)).toEqual([...MISSOES_TUTORIAL]);
    expect(por(".primeiros-passos [role='progressbar']")!.getAttribute("aria-valuetext")).toBe("0 de 5");
    await clicar(botao("Mover 3 arquivos"));
    expect(pedidosDe("primeiroUso.marcar")).toEqual([
      { alvo: "missao", missao: "faina-aprovacao", estado: "feito" },
    ]);
    expect(por('[data-missao="faina-aprovacao"]')!.dataset.feita).toBe("true");
    expect(por(".primeiros-passos [role='progressbar']")!.getAttribute("aria-valuetext")).toBe("1 de 5");
    expect(por(".treino [role='status']")!.textContent).toMatch(/iriam para a Lixeira/);
  });

  it("Pular esconde; Rever o tutorial, em Configurações, Geral, traz de volta no Início", async () => {
    await noInicio();
    await clicar(botao("Pular"));
    expect(por(".primeiros-passos")).toBeNull();

    await clicar(por('nav[aria-label="Áreas"] [data-id="configuracoes"]'));
    await clicar(botao("Rever o tutorial"));
    expect(pedidosDe("primeiroUso.marcar")).toEqual([
      { alvo: "tutorial", estado: "pulado" },
      { alvo: "tutorial", estado: "pendente" },
    ]);
    expect(por("main")!.dataset.area).toBe("inicio");
    expect(por(".primeiros-passos")).toBeTruthy();
  });
});

describe("acessibilidade do primeiro uso", () => {
  it("os cinco passos: lateral e main com nome, rádios e botões com nome", async () => {
    await montar();
    const seguir = ["Começar", "Continuar", "Depois", "Continuar"];
    for (const [i, nome] of TITULOS.entries()) {
      expect(marcos(recipiente), nome).toEqual([
        "banner",
        "complementary: Configuração inicial",
        `main: ${nome}`,
      ]);
      expect(auditar(recipiente), nome).toEqual([]);
      if (i < seguir.length) await clicar(botao(seguir[i]!));
    }
  });

  it("depois de pular, os Primeiros passos no Início também passam", async () => {
    await montar();
    await clicar(botao("Pular configuração"));
    expect(por(".primeiros-passos")).toBeTruthy();
    expect(auditar(recipiente)).toEqual([]);
    expect(marcos(recipiente)).toEqual(["banner", "navigation: Áreas", "main"]);
  });
});
