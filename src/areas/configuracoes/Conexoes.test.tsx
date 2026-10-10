// @vitest-environment happy-dom
import type { Conexao, TipoConexao } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { SecaoConexoes } from "./Conexoes.tsx";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAMINHO = "C:\\Users\\voce\\.claude\\settings.json";
const ANTES = JSON.stringify({ Stop: [{ hooks: [{ type: "command", command: "notificar.ps1" }] }] }, null, 2);
const DEPOIS = JSON.stringify(
  {
    SessionStart: [{ hooks: [{ type: "http", url: "http://127.0.0.1:47821/hooks/claude-code" }] }],
    Stop: [
      { hooks: [{ type: "command", command: "notificar.ps1" }] },
      { hooks: [{ type: "http", url: "http://127.0.0.1:47821/hooks/claude-code" }] },
    ],
  },
  null,
  2,
);

const conexao = (tipo: TipoConexao, mudar: Partial<Conexao> = {}): Conexao => ({
  tipo,
  estado: "desligada",
  conta: null,
  ultimoErro: null,
  conectadaEm: null,
  ...mudar,
});

function servico(claude = conexao("hooks-claude-code"), github = conexao("github")) {
  falso.responder = (metodo, dados) => {
    switch (metodo) {
      case "conexoes.listar":
        return Promise.resolve([claude, github]);
      case "conexoes.previa":
        return Promise.resolve({
          tipo: "hooks-claude-code",
          arquivos: [{ caminho: CAMINHO, trecho: "hooks", antes: ANTES, depois: DEPOIS }],
        });
      case "conexoes.ligar":
        if ((dados as { tipo: string }).tipo === "github") {
          github = { ...github, estado: "ligada", conta: "voce-dev" };
          return Promise.resolve(github);
        }
        claude = {
          ...claude,
          estado: "ligada",
          ligacao: { caminho: CAMINHO, eventos: 8, porta: 47821, copia: "settings.json.moductus-1.bak" },
        };
        return Promise.resolve(claude);
      case "conexoes.desligar":
        claude = conexao("hooks-claude-code");
        return Promise.resolve(claude);
      case "github.obter":
        return Promise.resolve({ itens: [], atualizadoEm: null });
      case "sessoes.listar":
        return Promise.resolve({ projetos: [], sessoes: [] });
      default:
        return Promise.reject(new Error(`sem resposta para ${metodo}`));
    }
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<SecaoConexoes />));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) => todos("button").find((b) => b.textContent === texto)!;
const clicar = (texto: string) => act(async () => botao(texto).click());
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
const cartao = (nome: string) =>
  todos(".config-conexao").find((c) => c.querySelector("h3")?.textContent === nome)!;

describe("Conexões", () => {
  it("nenhuma ligada: o Nuno explica, e o OpenCode só avisa que vem depois", async () => {
    servico();
    await montar();
    expect(por(".fala")!.textContent).toContain("Sem conexão, eu não vejo suas sessões de IA nem o GitHub.");
    expect(cartao("OpenCode").querySelector("button")).toBeNull();
    expect(cartao("OpenCode").textContent).toContain("em breve");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Claude Code: a prévia mostra antes e depois e não grava; só o sim liga", async () => {
    servico();
    await montar();
    await clicar("Ver o que muda");
    expect(pedidosDe("conexoes.previa")).toEqual([{ tipo: "hooks-claude-code" }]);
    expect(pedidosDe("conexoes.ligar")).toEqual([]);
    expect(por(".config-previa-arquivo")!.textContent).toContain(CAMINHO);
    // As linhas novas vêm marcadas com "+", não só pela cor.
    const novas = todos(".config-bloco-linha[data-nova]");
    expect(novas.length).toBeGreaterThan(0);
    expect(novas.every((l) => l.querySelector(".config-bloco-marca")!.textContent === "+")).toBe(true);
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Ligar 2 hooks no Claude Code");
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "hooks-claude-code" }]);
    expect(por(".config-previa")).toBeNull();
    const dados = todos(".config-conexao-dado").map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ]);
    expect(dados.slice(0, 4)).toEqual([
      ["Arquivo", CAMINHO],
      ["Hooks", "8 eventos · porta 47821"],
      ["Cópia de antes", "settings.json.moductus-1.bak"],
      ["Último evento", "nenhum ainda: abra um terminal novo e rode o claude"],
    ]);
  });

  it("Agora não fecha a prévia sem gravar; desligar tira o que é do Moductus", async () => {
    servico();
    await montar();
    await clicar("Ver o que muda");
    await clicar("Agora não");
    expect(por(".config-previa")).toBeNull();
    expect(pedidosDe("conexoes.ligar")).toEqual([]);

    await clicar("Ver o que muda");
    await clicar("Ligar 2 hooks no Claude Code");
    await clicar("Desligar");
    expect(pedidosDe("conexoes.desligar")).toEqual([{ tipo: "hooks-claude-code" }]);
    expect(botao("Ver o que muda")).toBeTruthy();
  });

  it("Esc durante o Ligando… não fecha a prévia: o arquivo já está sendo escrito", async () => {
    servico();
    await montar();
    await clicar("Ver o que muda");
    const responder = falso.responder;
    let terminar: () => void = () => undefined;
    falso.responder = (metodo, dados) =>
      metodo === "conexoes.ligar"
        ? new Promise((ok) => {
            terminar = () => ok(responder(metodo, dados));
          })
        : responder(metodo, dados);
    await clicar("Ligar 2 hooks no Claude Code");
    expect(botao("Ligando…")).toBeTruthy();
    await act(async () => {
      por(".config-previa")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(por(".config-previa")).not.toBeNull();
    await act(async () => terminar());
    expect(por(".config-previa")).toBeNull();
    expect(cartao("Claude Code").textContent).toContain("ligada");
  });

  it("GitHub com erro diz o motivo, mostra o comando e conecta de novo", async () => {
    servico(
      conexao("hooks-claude-code"),
      conexao("github", {
        estado: "erro",
        ultimoErro: "O gh não está conectado a uma conta. Rode gh auth login no terminal e conecte de novo.",
      }),
    );
    await montar();
    const github = cartao("GitHub");
    expect(github.querySelector(".config-conexao-erro")!.textContent).toContain("Rode gh auth login");
    expect(github.querySelector(".config-conexao-comando")!.textContent).toBe("gh auth login");
    expect(botao("Copiar o comando")).toBeTruthy();
    await clicar("Conectar de novo");
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "github" }]);
    expect(cartao("GitHub").textContent).toContain("voce-dev");
    expect(auditar(recipiente)).toEqual([]);
  });
});
