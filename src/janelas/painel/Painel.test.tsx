// @vitest-environment happy-dom
import type { Aprovacao, ListaSessoes } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Os pedidos das sessões do terminal no painel do time. A casca abre o painel pelo evento
 * `painel:area`, disparado à mão; o canal é um serviço de mentira que responde os pendentes e as
 * sessões e deixa disparar `aprovacoes.mudou` como o serviço dispararia.
 */
const eventosCasca = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) => {
    if (comando === "servico_estado") return { estado: "pronto", porta: 1, token: "t" };
    if (comando === "dock_configuracao") return { lado: "esquerda", modo: "fixo", forma: "colada" };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (nome: string, fn: (e: { payload: unknown }) => void) => {
    eventosCasca.set(nome, fn);
    return () => eventosCasca.delete(nome);
  }),
}));

const servidor: { pendentes: Aprovacao[] | Promise<Aprovacao[]>; sessoes: ListaSessoes } = {
  pendentes: [],
  sessoes: { projetos: [], sessoes: [] },
};
const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const pedir = vi.fn(async (metodo: string, _dados?: unknown): Promise<unknown> => {
  if (metodo === "aprovacoes.pendentes") return servidor.pendentes;
  if (metodo === "sessoes.listar") return servidor.sessoes;
  if (metodo === "aprovacoes.decidir") return new Promise(() => {});
  throw new Error(`método ${metodo} sem atendente`);
});

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
      ouvintes.get(nome)!.add(fn);
      return () => ouvintes.get(nome)?.delete(fn);
    },
    pedir,
  },
}));

const { Painel } = await import("./Painel.tsx");

const INSTANTE = "2026-10-09T14:31:00.000Z";

const pedido = (id: string, command: string, extra: Partial<Aprovacao> = {}): Aprovacao => ({
  id,
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "s1",
  descricao: "Quer rodar o comando abaixo.",
  acao: { ferramenta: "Bash", entrada: { command }, rotulo: null, rotuloRecusar: null, desfazivel: false },
  estado: "pendente",
  criadoEm: INSTANTE,
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
  ...extra,
});

const SESSOES: ListaSessoes = {
  projetos: [
    { id: "p1", nome: "api-pedidos", caminho: "V:\\api-pedidos", repositorio: null, arquivado: false },
  ],
  sessoes: [
    {
      id: "s1",
      projetoId: "p1",
      ferramenta: "claude-code",
      idExterno: "x",
      modelo: null,
      estado: "esperando",
      iniciadaEm: INSTANTE,
      ultimoEventoEm: INSTANTE,
      encerradaEm: null,
      contexto: null,
      ultimoEvento: null,
    },
  ],
};

let raiz: Root | null = null;
let recipiente: HTMLElement;

beforeEach(() => {
  servidor.pendentes = [pedido("a1", "npm test -- --watch=false")];
  servidor.sessoes = SESSOES;
  pedir.mockClear();
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  ouvintes.clear();
});

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Painel />));
}

async function abrir(area: string) {
  await act(async () => eventosCasca.get("painel:area")?.({ payload: area }));
}

function avisar(aprovacao: Aprovacao) {
  act(() => ouvintes.get("aprovacoes.mudou")?.forEach((fn) => fn(aprovacao)));
}

const cartoes = () => [...recipiente.querySelectorAll<HTMLElement>(".aprovacao")];
const botao = (cartao: HTMLElement, texto: string) =>
  [...cartao.querySelectorAll("button")].find((b) => b.textContent === texto)!;

describe("pedidos das sessões no painel do time", () => {
  it("mostra o cartão do pedido com projeto, ferramenta, estado e o comando inteiro", async () => {
    await montar();
    await abrir("agentes");
    const [cartao] = cartoes();
    expect(cartao).toBeDefined();
    const secao = recipiente.querySelector(".pedidos")!;
    expect(secao.querySelector("h2")?.textContent).toBe("Sessões de IA");
    expect(secao.querySelector(".pedidos-cabecalho")?.textContent).toContain("1 esperando você");
    expect(cartao!.querySelector(".aprovacao-origem")?.textContent).toBe(
      "esperando vocêapi-pedidosClaude Code",
    );
    expect(cartao!.textContent).toContain("Quer rodar o comando abaixo.");
    expect(cartao!.querySelector(".aprovacao-detalhe code")?.textContent).toBe("npm test -- --watch=false");
    expect([...cartao!.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Negar",
      "Sempre neste projeto",
      "Permitir",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("decidir manda ao serviço e o cartão diz o que valeu quando o aviso chega", async () => {
    await montar();
    await abrir("agentes");
    const [cartao] = cartoes();
    await act(async () => botao(cartao!, "Sempre neste projeto").click());
    expect(pedir).toHaveBeenCalledWith("aprovacoes.decidir", {
      id: "a1",
      decisao: "permitir",
      sempre: "projeto",
    });
    avisar(pedido("a1", "npm test -- --watch=false", { estado: "aprovada", regraCriadaId: "r1" }));
    const [decidido] = cartoes();
    expect(decidido!.querySelector("[role=status]")?.textContent).toContain("permitido");
    expect(decidido!.querySelector(".aprovacao-origem")?.textContent).not.toContain("esperando você");
    expect(recipiente.querySelector(".pedidos-cabecalho")?.textContent).not.toContain("esperando você");
  });

  it("pedido novo entra pelo aviso; pedido de agente do Moductus fica para o painel dele", async () => {
    servidor.pendentes = [];
    await montar();
    await abrir("agentes");
    expect(recipiente.querySelector(".pedidos")).toBeNull();
    avisar(pedido("a2", "pnpm build"));
    avisar(
      pedido("a3", "x", {
        fonte: "moductus",
        agenteId: "nuno",
        sessaoId: null,
        acao: {
          ferramenta: "github.comentar",
          entrada: {},
          rotulo: "Comentar",
          rotuloRecusar: null,
          desfazivel: false,
        },
      }),
    );
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]!.querySelector("code")?.textContent).toBe("pnpm build");
  });

  it("abrir de novo relê os pendentes: o já respondido sai", async () => {
    await montar();
    await abrir("agentes");
    avisar(pedido("a1", "npm test -- --watch=false", { estado: "expirada" }));
    expect(cartoes()).toHaveLength(1);
    servidor.pendentes = [];
    await abrir("agentes");
    expect(cartoes()).toHaveLength(0);
  });

  it("aviso que chega enquanto a lista está a caminho não se perde", async () => {
    let entregar!: (lista: Aprovacao[]) => void;
    servidor.pendentes = new Promise<Aprovacao[]>((pronto) => (entregar = pronto));
    await montar();
    await abrir("agentes");
    // A lista saiu antes destes avisos e volta sem eles.
    avisar(pedido("a2", "pnpm build"));
    avisar(pedido("a1", "npm test -- --watch=false", { estado: "aprovada" }));
    await act(async () => entregar([pedido("a1", "npm test -- --watch=false")]));
    expect(cartoes().map((c) => c.dataset.estado)).toEqual(["aprovada", "pendente"]);
    expect(cartoes()[1]!.querySelector("code")?.textContent).toBe("pnpm build");
  });

  it("sessão nova com o painel aberto: o nome do projeto chega pelo sessoes.mudou", async () => {
    servidor.pendentes = [];
    await montar();
    await abrir("agentes");
    avisar(pedido("a5", "cargo test", { sessaoId: "s2" }));
    expect(cartoes()[0]!.querySelector(".pedidos-projeto")).toBeNull();
    act(() =>
      ouvintes.get("sessoes.mudou")?.forEach((fn) =>
        fn({
          sessao: { ...SESSOES.sessoes[0]!, id: "s2", projetoId: "p2" },
          projeto: {
            id: "p2",
            nome: "moductus",
            caminho: "V:\\moductus",
            repositorio: null,
            arquivado: false,
          },
        }),
      ),
    );
    expect(cartoes()[0]!.querySelector(".pedidos-projeto")?.textContent).toBe("moductus");
  });

  it("pedido sem regra possível mostra só Negar e Permitir", async () => {
    servidor.pendentes = [pedido("a6", "x", { admiteSempre: false })];
    await montar();
    await abrir("agentes");
    expect([...cartoes()[0]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Negar",
      "Permitir",
    ]);
  });

  it("outras áreas não mostram os pedidos", async () => {
    await montar();
    await abrir("tarefas");
    expect(cartoes()).toHaveLength(0);
  });
});
