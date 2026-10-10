// @vitest-environment happy-dom
import type { Conexao, ItemGithub, SituacaoGithub } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcoesSistemaContexto } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { Dev } from "./Dev.tsx";

// O serviço é falso: responde do `servidor` e guarda os ouvintes para os avisos do canal.
const falso = vi.hoisted(() => ({
  pedidos: [] as string[],
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
  servidor: {} as Record<string, unknown>,
}));
vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string) => {
      falso.pedidos.push(metodo);
      if (metodo in falso.servidor) return Promise.resolve(falso.servidor[metodo]);
      return Promise.reject(new Error(`sem resposta para ${metodo}`));
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGORA = new Date("2026-10-09T14:00:00.000Z");

let seq = 0;
const item = (extra: Partial<ItemGithub> = {}): ItemGithub => ({
  id: `i${++seq}`,
  repositorio: "gustavo/api-pedidos",
  numero: 412,
  tipo: "pr",
  titulo: "Importação de pedidos em lote",
  autor: "ana",
  estado: "aberto",
  meuPapel: "revisor",
  precisaDeMim: true,
  ciEstado: null,
  atualizadoNoGithub: "2026-10-08T12:00:00.000Z",
  url: "https://github.com/gustavo/api-pedidos/pull/412",
  ...extra,
});

const ITENS = [
  item(),
  item({
    repositorio: "gustavo/site",
    numero: 57,
    titulo: "Novo cabeçalho",
    meuPapel: "autor",
    ciEstado: "falhou",
  }),
  item({
    repositorio: "gustavo/moductus",
    numero: 31,
    tipo: "issue",
    meuPapel: "atribuido",
    titulo: "Dock some",
  }),
];

const conexao = (estado: Conexao["estado"], ultimoErro: string | null = null): Conexao => ({
  tipo: "github",
  estado,
  conta: estado === "ligada" ? "gustavo" : null,
  ultimoErro,
  conectadaEm: null,
});

function responder(situacao: SituacaoGithub, github: Conexao | null) {
  falso.servidor = {
    "github.obter": situacao,
    "conexoes.listar": github ? [github] : [],
  };
}

const ir = vi.fn();
let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () =>
    raiz!.render(
      <AcoesSistemaContexto.Provider value={{ ir, aoMudarPrimeiroUso: () => undefined }}>
        <Dev />
      </AcoesSistemaContexto.Provider>,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  ir.mockClear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const botao = (texto: string) =>
  [...recipiente.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto);
const colunas = () =>
  [...recipiente.querySelectorAll<HTMLElement>(".dev-coluna")].map((c) => ({
    nome: c.querySelector("h2")?.textContent,
    cartoes: [...c.querySelectorAll(".dev-item")].map((i) => i.getAttribute("aria-label")),
  }));

describe("Dev vazia", () => {
  it("sem o GitHub conectado, explica como ligar e leva às Conexões", async () => {
    responder({ itens: [], atualizadoEm: null }, conexao("desligada"));
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("O GitHub ainda não está conectado");
    expect(por(".estado-vazio-texto")?.textContent).toContain("gh instalado e logado");
    act(() => botao("Abrir Conexões")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "conexoes" });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("conexão em erro diz o que fazer, como o serviço escreveu", async () => {
    responder({ itens: [], atualizadoEm: null }, conexao("erro", "Rode gh auth login no terminal."));
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Não consegui ler o GitHub");
    expect(por(".estado-vazio-texto")?.textContent).toBe("Rode gh auth login no terminal.");
  });

  it("ligado e sem nada aberto, diz que não há nada esperando", async () => {
    responder(
      { itens: [item({ estado: "mesclado" })], atualizadoEm: AGORA.toISOString() },
      conexao("ligada"),
    );
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nada esperando você no GitHub");
    expect(botao("Abrir Conexões")).toBeUndefined();
  });
});

describe("Dev com dados", () => {
  it("separa as colunas, conta os repositórios e o Nuno fala do mais urgente", async () => {
    responder({ itens: ITENS, atualizadoEm: "2026-10-09T13:58:00.000Z" }, conexao("ligada"));
    await montar();
    expect(colunas()).toEqual([
      { nome: "Esperando seu review", cartoes: ["api-pedidos #412: Importação de pedidos em lote"] },
      { nome: "Seus PRs", cartoes: ["site #57: Novo cabeçalho"] },
      { nome: "Issues para você", cartoes: ["moductus #31: Dock some"] },
    ]);
    expect(por(".dev-leitura")?.textContent).toBe("3 repositórios · atualizado há 2 min");
    expect(por(".dev-fala-texto")?.textContent).toBe(
      "O api-pedidos #412 espera seu review. Mais 2 itens precisam de você.",
    );
    const selos = [...recipiente.querySelectorAll(".dev-item .selo")].map((s) => s.textContent);
    expect(selos).toEqual(["pedido a você", "CI falhou", "issue"]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("coluna sem item diz que não há nada, com a contagem zero", async () => {
    responder({ itens: [item()], atualizadoEm: null }, conexao("ligada"));
    await montar();
    const [, meus] = [...recipiente.querySelectorAll<HTMLElement>(".dev-coluna")];
    expect(meus!.querySelector(".dev-coluna-vazia")?.textContent).toBe("Nada aqui.");
    expect(meus!.querySelector(".dev-coluna-cabecalho .so-leitor")?.textContent).toBe("0 itens");
  });

  it("erro com o cache ainda na tela: o Nuno diz o que houve no lugar da fala", async () => {
    responder(
      { itens: ITENS, atualizadoEm: null },
      conexao("erro", "O gh não está logado. Rode gh auth login."),
    );
    await montar();
    expect(por(".dev-fala")?.getAttribute("role")).toBe("alert");
    expect(por(".dev-fala-texto")?.textContent).toBe("O gh não está logado. Rode gh auth login.");
    act(() => botao("Abrir Conexões")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "conexoes" });
  });

  it("a leitura nova do GitHub chega pelo github.mudou", async () => {
    responder({ itens: [item()], atualizadoEm: null }, conexao("ligada"));
    await montar();
    act(() =>
      falso.ouvintes
        .get("github.mudou")
        ?.forEach((fn) => fn({ itens: [], atualizadoEm: AGORA.toISOString() })),
    );
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nada esperando você no GitHub");
    // A área não manda o serviço ir ao GitHub: quem lê é o vigia.
    expect(falso.pedidos).not.toContain("github.atualizar");
  });
});
