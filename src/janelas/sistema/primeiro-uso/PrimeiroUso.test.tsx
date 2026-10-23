// @vitest-environment happy-dom
import {
  CONFIG_PADRAO,
  MISSOES_TUTORIAL,
  PASSOS_PRIMEIRO_USO,
  type Config,
  type EstadoPrimeiroUso,
} from "@moductus/contrato";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar, marcos } from "../../../teste/acessibilidade.ts";
import { SEGURA_FIM_MS } from "../../../areas/inicio/PrimeirosPassos.tsx";
import { Sistema } from "../Sistema.tsx";

// A casca não existe no teste: eventos, janela e comandos falsos. O evento emitido chega a quem ouve,
// como entre as janelas de verdade.
const tauri = vi.hoisted(() => ({
  emitidos: [] as [string, unknown][],
  ouvintes: new Map<string, Set<(e: { payload: unknown }) => void>>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (nome: string, fn: (e: { payload: unknown }) => void) => {
    const lista = tauri.ouvintes.get(nome) ?? new Set();
    lista.add(fn);
    tauri.ouvintes.set(nome, lista);
    return () => lista.delete(fn);
  }),
  emit: vi.fn(async (nome: string, payload: unknown) => {
    tauri.emitidos.push([nome, payload]);
    for (const fn of tauri.ouvintes.get(nome) ?? []) fn({ payload });
  }),
}));
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
    /** As conexões do Nuno (Claude Code e GitHub) e o Google Agenda da Alba. */
    conexoes: [] as { tipo: string; estado: string }[],
    /** Os calendários que a leitura do Google trouxe. */
    calendarios: [] as { id: string; ler: boolean }[],
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

/** O bloco `hooks` que ligar grava: dois eventos do Moductus, como a prévia do serviço devolve. */
const HOOKS = JSON.stringify(
  Object.fromEntries(
    ["SessionStart", "Stop"].map((evento) => [
      evento,
      [{ hooks: [{ type: "http", url: "http://127.0.0.1:47821/hooks/claude-code" }] }],
    ]),
  ),
  null,
  2,
);

const calendarioGoogle = (id: string, nome: string, mudar: { espelho?: boolean; ler?: boolean } = {}) => ({
  id,
  nome,
  fonte: "google",
  cor: null,
  espelho: false,
  podeEscrever: true,
  ler: false,
  sincronizadoEm: null,
  ...mudar,
});
const CALENDARIOS_GOOGLE = [
  calendarioGoogle("01K7MODUCTUS0000000000000A", "Moductus", { espelho: true, ler: true }),
  calendarioGoogle("01K7PESSOAL00000000000000B", "Pessoal", { ler: true }),
  calendarioGoogle("01K7FERIADOS0000000000000C", "Feriados no Brasil"),
];

const desligada = (tipo: string) => ({
  tipo,
  estado: "desligada",
  conta: null,
  ultimoErro: null,
  conectadaEm: null,
});

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
    case "conexoes.listar":
      return falso.conexoes;
    case "conexoes.previa":
      return {
        tipo: "hooks-claude-code",
        arquivos: [
          { caminho: "C:\\Users\\voce\\.claude\\settings.json", trecho: "hooks", antes: null, depois: HOOKS },
        ],
      };
    case "conexoes.ligar": {
      const { tipo } = dados as { tipo: string };
      const conta = tipo === "google-agenda" ? "voce@gmail.com" : null;
      falso.conexoes = falso.conexoes.map((c) => (c.tipo === tipo ? { ...c, estado: "ligada", conta } : c));
      // Conectado o Google, a leitura traz a lista de calendários da conta.
      if (tipo === "google-agenda") {
        falso.calendarios = CALENDARIOS_GOOGLE;
        falso.emitir("agenda.calendarios", falso.calendarios);
      }
      return falso.conexoes.find((c) => c.tipo === tipo);
    }
    case "google.obter":
      return { autorizacao: null, lidaEm: null, fila: 0, clienteProprio: false, problema: null };
    case "agenda.calendarios":
      return falso.calendarios;
    case "agenda.definirCalendario": {
      const { id, ler } = dados as { id: string; ler: boolean };
      falso.calendarios = falso.calendarios.map((c) => (c.id === id ? { ...c, ler } : c));
      return falso.calendarios.find((c) => c.id === id);
    }
    case "conexoes.desligar": {
      const { tipo } = dados as { tipo: string };
      falso.conexoes = falso.conexoes.map((c) => (c.tipo === tipo ? { ...c, estado: "desligada" } : c));
      return falso.conexoes.find((c) => c.tipo === tipo);
    }
    case "github.obter":
      return { itens: [], atualizadoEm: null };
    case "sessoes.listar":
      return { projetos: [], sessoes: [] };
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
  tauri.emitidos = [];
  tauri.ouvintes.clear();
  vi.mocked(invoke).mockClear();
  falso.ouvintes.clear();
  falso.pedidos = [];
  falso.estado = bancoNovo();
  falso.config = structuredClone(CONFIG_PADRAO);
  falso.detectados = [];
  falso.provedores = [];
  falso.criados = 0;
  falso.recusarCriar = null;
  falso.conexoes = [desligada("hooks-claude-code"), desligada("github"), desligada("google-agenda")];
  falso.calendarios = [];
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
/** O botão dentro de um bloco: o Google e o Nuno têm, os dois, "Conectar" e "Agora não". */
const botaoEm = (seletor: string, texto: string) =>
  todos(`${seletor} button`).find((b) => b.textContent === texto);
const pedidosDe = (metodo: string) => falso.pedidos.filter(([m]) => m === metodo).map(([, d]) => d);
/** As paradas que o tour avisou às janelas, em ordem. */
const paradas = () => tauri.emitidos.filter(([nome]) => nome === "tour:parada").map(([, p]) => p);
const comandos = () => vi.mocked(invoke).mock.calls.map(([comando, args]) => [comando, args]);
/** Um evento da casca (a Ajuda da bandeja), como chega à janela. */
async function daCasca(nome: string) {
  await act(async () => {
    for (const fn of tauri.ouvintes.get(nome) ?? []) fn({ payload: null });
  });
}

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
    // O tour começa logo depois: a parada 1 vai a todas as janelas e o painel abre ao lado do dock.
    expect(paradas()).toEqual([1]);
    expect(comandos()).toContainEqual(["painel_abrir", { area: "tour" }]);
    expect(comandos()).toContainEqual(["painel_foco", { quer: true }]);
    // O Sistema escurece e sai do teclado; a parada é de outra janela, então aqui só o véu.
    expect(por(".sistema")!.inert).toBe(true);
    expect(por(".tour-camada")!.dataset.tour).toBe("veu");
    expect(por(".tour-bolha")).toBeNull();
  });

  it("conexões do Nuno de verdade: a prévia do settings.json vem antes, e só o sim liga", async () => {
    await montar();
    for (const nome of ["Começar", "Continuar", "Depois", "Continuar"]) await clicar(botao(nome));
    expect(titulo()).toBe(TITULOS[4]);
    // As outras ainda chegam com a área de cada agente; a do Nuno conecta.
    expect(todos(".uso-item > .selo").map((s) => s.textContent)).toEqual([
      "chega com Arquivos",
      "chega com Finanças",
    ]);
    await clicar(botaoEm(".uso-item--nuno", "Conectar"));
    expect(pedidosDe("conexoes.ligar")).toEqual([]);

    await clicar(botao("Ver o que muda"));
    expect(pedidosDe("conexoes.previa")).toEqual([{ tipo: "hooks-claude-code" }]);
    expect(por(".config-previa")!.textContent).toContain("C:\\Users\\voce\\.claude\\settings.json");
    // Esc fecha só a prévia: o passo continua o mesmo.
    await teclar(por(".config-previa")!, "Escape");
    expect(por(".config-previa")).toBeNull();
    expect(titulo()).toBe(TITULOS[4]);

    await clicar(botao("Ver o que muda"));
    await clicar(botao("Ligar 2 hooks no Claude Code"));
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "hooks-claude-code" }]);
    expect(todos(".uso-item--nuno .uso-item-linha .selo").map((s) => s.textContent)).toEqual([
      "1 de 2 ligada",
    ]);
    await clicar(botaoEm(".uso-item--nuno", "Conectar"));
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "hooks-claude-code" }, { tipo: "github" }]);
    expect(todos(".uso-item--nuno .uso-item-linha .selo").map((s) => s.textContent)).toEqual(["conectado"]);
    expect(auditar(recipiente)).toEqual([]);

    // Conectado, como no quadro: "Desconectar" desfaz as duas.
    await clicar(botaoEm(".uso-item--nuno", "Desconectar"));
    expect(pedidosDe("conexoes.desligar")).toEqual([{ tipo: "hooks-claude-code" }, { tipo: "github" }]);
    // "Agora não" fecha os cartões e deixa para depois, sem ligar nada.
    await clicar(botaoEm(".uso-item--nuno", "Agora não"));
    expect(por(".uso-conexoes-nuno")).toBeNull();
    expect(todos(".uso-item--nuno .uso-item-linha .selo").map((s) => s.textContent)).toEqual(["depois"]);
    expect(botaoEm(".uso-item--nuno", "Conectar")).toBeTruthy();
  });

  it("Google Agenda da Alba: o que ela pode fazer antes do navegador, depois os calendários ali mesmo", async () => {
    await montar();
    for (const nome of ["Começar", "Continuar", "Depois", "Continuar"]) await clicar(botao(nome));
    expect(titulo()).toBe(TITULOS[4]);
    // "Agora não" deixa para depois, sem pedir nada ao Google.
    await clicar(botaoEm(".uso-item--google", "Agora não"));
    expect(todos(".uso-item--google .uso-item-linha .selo").map((s) => s.textContent)).toEqual(["depois"]);

    // "Conectar" abre o cartão de Configurações: antes do navegador, o que a Alba pode fazer.
    await clicar(botaoEm(".uso-item--google", "Conectar"));
    expect(por(".uso-item--google .config-google-autorizar")!.textContent).toContain("O que sai deste PC");
    expect(pedidosDe("conexoes.ligar")).toEqual([]);
    // O Esc fecha só o cartão: o passo continua o mesmo.
    await teclar(por(".config-google-autorizar")!, "Escape");
    expect(por(".config-google-autorizar")).toBeNull();
    expect(titulo()).toBe(TITULOS[4]);

    await clicar(botaoEm(".uso-item--google", "Conectar"));
    await clicar(botao("Conectar com o Google"));
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "google-agenda" }]);
    // Conectado, como no quadro: a conta, o "Moductus" criado e os calendários sem ele, para marcar.
    expect(todos(".uso-item--google .uso-item-linha .selo").map((s) => s.textContent)).toEqual(["conectado"]);
    expect(por(".uso-item--google .uso-item-descricao")!.textContent).toBe(
      "voce@gmail.com · criei o calendário “Moductus” para os lembretes chegarem ao celular.",
    );
    const caixas = todos('.uso-google-calendarios [role="checkbox"]');
    expect(caixas.map((c) => [c.textContent, c.getAttribute("aria-checked")])).toEqual([
      ["Pessoal", "true"],
      ["Feriados no Brasil", "false"],
    ]);
    await clicar(caixas[1]);
    expect(pedidosDe("agenda.definirCalendario")).toEqual([{ id: "01K7FERIADOS0000000000000C", ler: true }]);
    expect(todos('.uso-google-calendarios [role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(auditar(recipiente)).toEqual([]);

    await clicar(botaoEm(".uso-item--google", "Desconectar"));
    expect(pedidosDe("conexoes.desligar")).toEqual([{ tipo: "google-agenda" }]);
    expect(botaoEm(".uso-item--google", "Conectar")).toBeTruthy();

    // Conectou de novo e desconectou em outra janela: a linha oferece "Conectar", sem o cartão aberto.
    await clicar(botaoEm(".uso-item--google", "Conectar"));
    await clicar(botao("Conectar com o Google"));
    expect(todos(".uso-item--google .uso-item-linha .selo").map((s) => s.textContent)).toEqual(["conectado"]);
    await act(async () => falso.emitir("conexoes.mudou", desligada("google-agenda")));
    expect(por(".uso-item--google .config-google-autorizar")).toBeNull();
    expect(botaoEm(".uso-item--google", "Conectar")).toBeTruthy();
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
    // Quem vai importar segue para lá: o tour não começa por cima.
    expect(paradas()).toEqual([]);
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
      // Na ordem do quadro (Uso3Modelo.dc.html): Claude, Gemini, Codex e OpenCode.
      {
        nome: "Gemini CLI",
        selo: "detectado",
        texto: "CLI no PATH, versão 0.42.0 · esta versão do Moductus ainda não conecta a ele.",
        marcado: false,
        desativado: true,
      },
      {
        nome: "Codex",
        selo: "não encontrado",
        texto: "Instale o Codex e volte aqui.",
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

  it("Entrar abre o terminal de login do CLI sem login, pela chave, e Procurar de novo acha o logado", async () => {
    falso.detectados = [{ ...CLAUDE, logado: false }];
    await noModelo();
    const invocar = vi.mocked(invoke);
    invocar.mockClear();
    const entrar = todos("button").filter((b) => b.textContent === "Entrar");
    expect(entrar.map((b) => b.getAttribute("aria-label"))).toEqual(["Entrar no Claude Code pelo terminal"]);
    expect(entrar[0]!.closest("label")).toBeNull();
    await clicar(entrar[0]!);
    // Vai só a chave: o comando é da casca.
    expect(invocar).toHaveBeenCalledWith("abrir_terminal", { cli: "claude-cli" });
    expect(modelos()[0]).toMatchObject({ selo: "sem login", desativado: true });

    invocar.mockImplementationOnce(() => Promise.reject("esse CLI não entra pelo Moductus"));
    await clicar(entrar[0]!);
    expect(todos('.uso-erro[role="alert"]').map((e) => e.textContent)).toEqual([
      "Não consegui abrir: esse CLI não entra pelo Moductus.",
    ]);

    falso.detectados = [CLAUDE];
    await clicar(botao("Procurar de novo"));
    expect(modelos()[0]).toMatchObject({ selo: "detectado · conectado", desativado: false });
    expect(todos("button").filter((b) => b.textContent === "Entrar")).toEqual([]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Como instalar abre a página do CLI que falta, pela casca, fora do rótulo da opção", async () => {
    falso.detectados = [CLAUDE, { ...CLAUDE, tipo: "gemini-cli", impedimento: "sem_adaptador" }];
    await noModelo();
    const invocar = vi.mocked(invoke);
    invocar.mockClear();
    const instalar = todos("button").filter((b) => b.textContent === "Como instalar");
    expect(instalar.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Como instalar o Codex",
      "Como instalar o OpenCode",
    ]);
    // O botão não entra no nome do rádio nem marca a opção.
    expect(instalar.every((b) => b.closest("label") === null)).toBe(true);
    await clicar(instalar[1]);
    expect(invocar).toHaveBeenCalledWith("abrir_endereco", { endereco: "https://opencode.ai/docs/" });
    expect(modelos().find((m) => m.nome === "OpenCode")?.marcado).toBe(false);

    invocar.mockImplementationOnce(() => Promise.reject("o Windows não abriu"));
    await clicar(instalar[0]);
    expect(todos('.uso-erro[role="alert"]').map((e) => e.textContent)).toEqual([
      "Não consegui abrir: o Windows não abriu.",
    ]);
    expect(auditar(recipiente)).toEqual([]);
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
        "CLI no PATH, versão 2.1.287 · o npm instalou o Claude Code de um jeito que o Moductus não consegue rodar. Instale pelo instalador nativo e procure de novo.",
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

  const progresso = () => por(".primeiros-passos [role='progressbar']")!.getAttribute("aria-valuetext");

  it("contam as três missões desta versão; Tula e Downloads ficam embaixo, sem ação, até a área chegar", async () => {
    await noInicio();
    expect(todos(".missao:not([data-depois])").map((m) => m.dataset.missao)).toEqual([
      "alba-lembrete",
      "faina-aprovacao",
      "nuno-sessao",
    ]);
    expect(progresso()).toBe("0 de 3");
    const depois = todos(".missao[data-depois]");
    expect(depois.map((m) => m.dataset.missao)).toEqual(["tula-extrato", "faina-downloads"]);
    expect(depois.map((m) => m.querySelector(".selo")!.textContent)).toEqual([
      "chega com Finanças",
      "chega com Arquivos",
    ]);
    expect(depois.some((m) => m.querySelector("button"))).toBe(false);
    expect(por(".primeiros-passos-depois")!.textContent).toBe("Chegam depois · não contam agora");
    // A da vez (a primeira que falta) fica em destaque; feita, passa para a seguinte.
    expect(por(".missao[data-atual]")!.dataset.missao).toBe("alba-lembrete");
  });

  it("o cartão de treino da Faina responde sem mexer em nada e conta como 1 de 3", async () => {
    await noInicio();
    await clicar(botao("Mover 3 arquivos"));
    expect(pedidosDe("primeiroUso.marcar")).toEqual([
      { alvo: "missao", missao: "faina-aprovacao", estado: "feito" },
    ]);
    expect(por('[data-missao="faina-aprovacao"]')!.dataset.feita).toBe("true");
    expect(progresso()).toBe("1 de 3");
    expect(por(".treino [role='status']")!.textContent).toMatch(/iriam para a Lixeira/);
    // Só o serviço; nenhum comando da casca mexe em arquivo.
    expect(comandos().map(([c]) => c)).not.toContain("abrir_arquivo");
  });

  it("o lembrete da Alba chega pelo serviço e a lista some quando as três ficam feitas", async () => {
    await noInicio();
    await act(async () =>
      falso.emitir("primeiroUso.mudou", {
        ...(falso.estado as EstadoPrimeiroUso),
        missoes: { ...(falso.estado as EstadoPrimeiroUso).missoes, "alba-lembrete": "feito" },
      }),
    );
    expect(por('[data-missao="alba-lembrete"]')!.dataset.feita).toBe("true");
    expect(progresso()).toBe("1 de 3");
    // O serviço encerra o tutorial quando as que valem ficam feitas (primeiro-uso.ts); a lista fica
    // um instante e some.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () =>
        falso.emitir("primeiroUso.mudou", { ...(falso.estado as EstadoPrimeiroUso), tutorial: "feito" }),
      );
      expect(por(".primeiros-passos")).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(SEGURA_FIM_MS));
      expect(por(".primeiros-passos")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("o cartão de treino como última missão: a resposta fica na tela um instante antes de a lista sumir", async () => {
    const base = bancoNovo();
    falso.estado = {
      ...base,
      concluido: true,
      concluidoEm: "2026-10-08T12:00:00.000Z",
      missoes: { ...base.missoes, "alba-lembrete": "feito", "nuno-sessao": "feito" },
    };
    await montar();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await clicar(botao("Mover 3 arquivos"));
      // O serviço de verdade encerra o tutorial nessa resposta.
      await act(async () =>
        falso.emitir("primeiroUso.mudou", { ...(falso.estado as EstadoPrimeiroUso), tutorial: "feito" }),
      );
      expect(progresso()).toBe("3 de 3");
      expect(por(".treino [role='status']")!.textContent).toMatch(/iriam para a Lixeira/);
      await act(async () => vi.advanceTimersByTimeAsync(SEGURA_FIM_MS - 100));
      expect(por(".primeiros-passos")).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(por(".primeiros-passos")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Pular some na hora, sem segurar", async () => {
    await noInicio();
    await clicar(botao("Pular"));
    expect(por(".primeiros-passos")).toBeNull();
  });

  it("Ver o tour de novo começa o tour do começo", async () => {
    await noInicio();
    await clicar(botao("Ver o tour de novo"));
    expect(paradas()).toEqual([1]);
    expect(comandos()).toContainEqual(["painel_abrir", { area: "tour" }]);
  });

  it("Como funciona, na missão do Nuno, leva às Sessões de IA", async () => {
    await noInicio();
    await clicar(botao("Como funciona"));
    expect(por("main")!.dataset.area).toBe("sessoes");
  });

  it("a Ajuda da bandeja traz os Primeiros passos de volta ao Início e o tour de novo", async () => {
    falso.estado = {
      ...bancoNovo(),
      concluido: true,
      concluidoEm: "2026-10-08T12:00:00.000Z",
      tutorial: "feito",
    };
    localStorage.setItem("moductus.sistema.destino", "notas");
    await montar();
    expect(por(".primeiros-passos")).toBeNull();
    await daCasca("tutorial:rever");
    expect(pedidosDe("primeiroUso.marcar")).toEqual([{ alvo: "tutorial", estado: "pendente" }]);
    expect(por("main")!.dataset.area).toBe("inicio");
    expect(por(".primeiros-passos")).toBeTruthy();

    await daCasca("tutorial:tour");
    expect(paradas()).toEqual([1]);
  });

  it("a Ajuda não começa o tour no meio da configuração inicial", async () => {
    await montar();
    await daCasca("tutorial:tour");
    expect(paradas()).toEqual([]);
    expect(comandos().map(([c]) => c)).not.toContain("painel_abrir");
  });

  it("o Sistema escondido na parada 3 encerra o tour", async () => {
    await noInicio();
    await act(async () => {
      for (const fn of tauri.ouvintes.get("tour:parada") ?? []) fn({ payload: 3 });
    });
    expect(por(".tour-camada")!.dataset.tour).toBe("parada");
    const visibilidade = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
      if (visibilidade) Object.defineProperty(Document.prototype, "visibilityState", visibilidade);
    }
    expect(paradas()).toEqual([null]);
    expect(por(".tour-camada")).toBeNull();
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
