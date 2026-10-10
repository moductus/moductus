// @vitest-environment happy-dom
import type { Aprovacao, Conexao, ListaSessoes, SessaoIa, UsoIa } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcoesSistemaContexto } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { Sessoes } from "./Sessoes.tsx";

// O serviço é falso: responde do `servidor` e guarda os ouvintes para os avisos do canal.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
  servidor: {} as Record<string, unknown>,
}));
vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      if (metodo === "aprovacoes.decidir") return new Promise(() => {});
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

const AGORA = new Date("2026-10-09T14:00:00");

const sessao = (extra: Partial<SessaoIa> = {}): SessaoIa => ({
  id: "s1",
  projetoId: "p1",
  ferramenta: "claude-code",
  idExterno: "x",
  modelo: "claude-opus-4-5",
  estado: "trabalhando",
  iniciadaEm: "2026-10-09T12:00:00",
  ultimoEventoEm: "2026-10-09T13:59:00",
  encerradaEm: null,
  contexto: null,
  ultimoEvento: null,
  ...extra,
});

const LISTA: ListaSessoes = {
  projetos: [
    { id: "p1", nome: "moductus", caminho: "V:\\moductus", repositorio: null, arquivado: false },
    { id: "p2", nome: "api-pedidos", caminho: "V:\\api-pedidos", repositorio: null, arquivado: false },
  ],
  sessoes: [
    sessao({
      ultimoEvento: {
        id: "e1",
        sessaoId: "s1",
        tipo: "PreToolUse",
        ferramentaUsada: "Edit",
        entradaResumo: "V:\\moductus\\src-tauri\\src\\appbar.rs",
        recebidoEm: "2026-10-09T13:59:00",
      },
    }),
    sessao({
      id: "s2",
      projetoId: "p2",
      estado: "esperando",
      contexto: { usadoTokens: 168_000, janelaTokens: 200_000 },
    }),
  ],
};

const USO: UsoIa[] = [
  {
    dia: "2026-10-09",
    ferramenta: "claude-code",
    modelo: "claude-opus-4-5",
    projetoId: "p1",
    tokensEntrada: 12_000,
    tokensSaida: 400,
    tokensCache: 0,
    custoEstimadoMicrodolares: null,
    fonte: "ferramenta",
  },
];

const conexao = (estado: Conexao["estado"], ultimoErro: string | null = null): Conexao => ({
  tipo: "hooks-claude-code",
  estado,
  conta: null,
  ultimoErro,
  conectadaEm: null,
});

const PEDIDO: Aprovacao = {
  id: "a1",
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "s2",
  descricao: "Quer rodar o comando abaixo.",
  acao: {
    ferramenta: "Bash",
    entrada: { command: "npm test -- --watch=false" },
    rotulo: null,
    rotuloRecusar: null,
    desfazivel: false,
  },
  estado: "pendente",
  criadoEm: "2026-10-09T13:59:00.000Z",
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
};

function responder({ lista = LISTA, conexoes = [conexao("ligada")], pendentes = [] as Aprovacao[] } = {}) {
  falso.servidor = {
    "sessoes.listar": lista,
    "sessoes.uso": USO,
    "conexoes.listar": conexoes,
    "aprovacoes.pendentes": pendentes,
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
        <Sessoes />
      </AcoesSistemaContexto.Provider>,
    ),
  );
}

function emitir(nome: string, dados: unknown) {
  act(() => falso.ouvintes.get(nome)?.forEach((fn) => fn(dados)));
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
const linhas = () =>
  [...recipiente.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent),
  );

describe("Sessões de IA vazia", () => {
  it("sem a ligação do Claude Code, explica como ligar e leva às Conexões", async () => {
    responder({ lista: { projetos: [], sessoes: [] }, conexoes: [conexao("desligada")] });
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("O Claude Code ainda não está ligado");
    expect(por(".estado-vazio-texto")?.textContent).toContain("Configurações › Conexões");
    expect(por(".estado-vazio .selo")).toBeNull();
    act(() => botao("Abrir Conexões")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "conexoes" });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("ligação em erro mostra o que o serviço disse", async () => {
    const erro = "A variável MODUCTUS_HOOKS_TOKEN não chegou ao Claude Code. Abra um terminal novo.";
    responder({ lista: { projetos: [], sessoes: [] }, conexoes: [conexao("erro", erro)] });
    await montar();
    expect(por(".estado-vazio-texto")?.textContent).toBe(erro);
  });

  it("ligado e sem sessão, diz como a primeira aparece, sem botão", async () => {
    responder({ lista: { projetos: [], sessoes: [] } });
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("Nenhuma sessão nas últimas 24 horas");
    expect(botao("Abrir Conexões")).toBeUndefined();
  });
});

describe("Sessões de IA com dados", () => {
  it("mostra cada sessão com estado, contexto, gasto e última ação", async () => {
    responder();
    await montar();
    expect(linhas()).toEqual([
      [
        "moductus",
        "Claude Code",
        "trabalhando",
        "não sei",
        "12,4 mil tokens12,4 mil tokens hoje no projeto",
        "Editando src-tauri/src/appbar.rs",
      ],
      [
        "api-pedidos",
        "Claude Code",
        "esperando você",
        "84%",
        "sem usosem uso do projeto registrado hoje",
        "—",
      ],
    ]);
    // Acima dos 80%, número e barra em aviso; sem número, nenhuma barra inventada.
    const contextos = [...recipiente.querySelectorAll<HTMLElement>(".sessao-contexto")];
    expect(contextos.map((c) => c.dataset.alto)).toEqual(["false", "true"]);
    expect(contextos[0]!.querySelector('[role="progressbar"]')).toBeNull();
    expect(contextos[1]!.querySelector('[role="progressbar"]')?.className).toContain("progresso--aviso");
    expect(por(".sessoes-ferramentas")?.textContent).toBe("Claude Code");
    expect(falso.pedidos.find((p) => p.metodo === "sessoes.uso")?.dados).toEqual({
      de: "2026-10-03",
      ate: "2026-10-09",
    });
    expect(por(".uso-rodape")?.textContent).toContain("12,4 mil tokens em 7 dias, 12,4 mil hoje.");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("o pedido da sessão aparece à direita com o projeto, e a resposta vai ao serviço", async () => {
    responder({ pendentes: [PEDIDO] });
    await montar();
    expect(por(".sessoes-alto")?.dataset.comPedidos).toBe("true");
    expect(por(".sessoes-pedidos .aprovacao-origem")?.textContent).toBe(
      "api-pedidosClaude Codeesperando você",
    );
    expect(por(".sessoes-pedidos code")?.textContent).toBe("npm test -- --watch=false");
    act(() => botao("Sempre neste projeto")!.click());
    expect(falso.pedidos.at(-1)).toEqual({
      metodo: "aprovacoes.decidir",
      dados: { id: "a1", decisao: "permitir", sempre: "projeto" },
    });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("sem pedido, o uso ocupa a largura toda", async () => {
    responder();
    await montar();
    expect(por(".sessoes-alto")?.dataset.comPedidos).toBe("false");
    expect(por(".sessoes-pedidos")).toBeNull();
  });

  it("sessão que muda sobe para o topo, com o projeto que acabou de ser reconhecido", async () => {
    responder();
    await montar();
    const projeto = { id: "p3", nome: "site", caminho: "V:\\site", repositorio: null, arquivado: false };
    emitir("sessoes.mudou", { sessao: sessao({ id: "s3", projetoId: "p3", estado: "terminou" }), projeto });
    expect(linhas().map((l) => [l[0], l[2]])).toEqual([
      ["site", "terminou"],
      ["moductus", "trabalhando"],
      ["api-pedidos", "esperando você"],
    ]);
  });

  it("Ajustar leva às Notificações", async () => {
    responder();
    await montar();
    act(() => botao("Ajustar")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "notificacoes" });
  });
});

describe("Sessões de IA quando algo dá errado", () => {
  it("com sessões na tela e a ligação em erro, o Nuno diz o que houve e leva às Conexões", async () => {
    const erro = "O Moductus saiu do settings.json do Claude Code. Ligue de novo em Conexões.";
    responder({ conexoes: [conexao("erro", erro)] });
    await montar();
    expect(linhas()).toHaveLength(2);
    expect(por(".faixa-nuno")?.getAttribute("role")).toBe("alert");
    expect(por(".faixa-nuno-texto")?.textContent).toBe(erro);
    act(() => botao("Abrir Conexões")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "configuracoes", secao: "conexoes" });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("ligada, sem faixa de erro", async () => {
    responder();
    await montar();
    expect(por(".faixa-nuno")).toBeNull();
  });

  it("a leitura recusada diz que falhou e tenta de novo, em vez de esperar para sempre", async () => {
    responder();
    delete falso.servidor["sessoes.listar"];
    await montar();
    expect(por(".estado-vazio-titulo")?.textContent).toBe("O serviço não respondeu");
    expect(por(".estado-vazio-texto")?.textContent).toBe(
      "Não consegui ler as sessões agora. Nada foi perdido: tente de novo.",
    );
    expect(por('[role="status"]')).toBeNull();
    responder();
    await act(async () => botao("Tentar de novo")!.click());
    expect(linhas()).toHaveLength(2);
  });

  it("a ligação avisada enquanto a lista está a caminho vale mais que a da lista", async () => {
    responder();
    let entregar!: (lista: ListaSessoes) => void;
    falso.servidor["sessoes.listar"] = new Promise<ListaSessoes>((r) => (entregar = r));
    await montar();
    emitir("conexoes.mudou", conexao("erro", "A ligação ficou desatualizada."));
    await act(async () => entregar(LISTA));
    expect(por(".faixa-nuno-texto")?.textContent).toBe("A ligação ficou desatualizada.");
  });
});
