// @vitest-environment happy-dom
import type {
  Agente,
  Aprovacao,
  Conexao,
  ItemGithub,
  ListaSessoes,
  Provedor,
  SituacaoAgente,
  SituacaoGithub,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Os painéis Agentes e Dev do dock. A casca abre o painel pelo evento `painel:area`, disparado à
 * mão; o canal é um serviço de mentira que responde o time, os modelos, os pedidos, as sessões e
 * o GitHub, e deixa disparar os avisos como o serviço dispararia.
 */
const eventosCasca = new Map<string, (e: { payload: unknown }) => void>();
const chamadasCasca: { comando: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: unknown) => {
    chamadasCasca.push({ comando, args });
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

const INSTANTE = "2026-10-09T14:31:00.000Z";

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

function agente(
  id: string,
  situacao: Partial<SituacaoAgente> = {},
  provedorId: string | null = "p-cli",
): Agente {
  return {
    id,
    nome: id,
    funcao: "função",
    instrucoes: "",
    personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
    ferramentas: [],
    provedorId,
    provedorReservaId: null,
    gatilhos: [],
    escoposMemoria: [],
    tetoDiarioCentavos: null,
    deFabrica: true,
    situacao: { ...ATIVO, ...situacao },
  };
}

const PROVEDOR: Provedor = {
  id: "p-cli",
  tipo: "claude-cli",
  nome: "Claude Code",
  modelo: null,
  baseUrl: null,
  temChave: false,
  testadoEm: null,
};

const conexao = (tipo: Conexao["tipo"], estado: Conexao["estado"] = "ligada"): Conexao => ({
  tipo,
  estado,
  conta: null,
  ultimoErro: null,
  conectadaEm: INSTANTE,
});

const servidor: {
  agentes: Agente[] | (() => Promise<Agente[]>);
  pendentes: Aprovacao[] | Promise<Aprovacao[]>;
  sessoes: ListaSessoes;
  github: SituacaoGithub;
  conexoes: Conexao[];
} = {
  agentes: [],
  pendentes: [],
  sessoes: { projetos: [], sessoes: [] },
  github: { itens: [], atualizadoEm: null },
  conexoes: [],
};
const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const pedir = vi.fn(async (metodo: string, _dados?: unknown): Promise<unknown> => {
  switch (metodo) {
    case "agentes.listar":
      return typeof servidor.agentes === "function" ? servidor.agentes() : servidor.agentes;
    case "provedores.listar":
      return [PROVEDOR];
    case "execucoes.listar":
      return { itens: [], proximo: null };
    case "aprovacoes.pendentes":
      return servidor.pendentes;
    case "sessoes.listar":
      return servidor.sessoes;
    case "sessoes.uso":
      return [];
    case "conexoes.listar":
      return servidor.conexoes;
    case "github.obter":
      return servidor.github;
    case "agentes.retomar":
      return [];
    case "config.obter":
      return { config: { atalhos: { sistema: "Ctrl+Shift+M" } }, portable: false, falhasAtalhos: {} };
    case "aprovacoes.decidir":
      return new Promise(() => {});
  }
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

const SESSAO = {
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
} as const satisfies ListaSessoes["sessoes"][number];

const SESSOES: ListaSessoes = {
  projetos: [
    { id: "p1", nome: "api-pedidos", caminho: "V:\\api-pedidos", repositorio: null, arquivado: false },
    { id: "p2", nome: "moductus", caminho: "V:\\moductus", repositorio: null, arquivado: false },
  ],
  sessoes: [
    SESSAO,
    {
      ...SESSAO,
      id: "s2",
      projetoId: "p2",
      estado: "trabalhando",
      contexto: { usadoTokens: 168_000, janelaTokens: 200_000 },
      ultimoEvento: {
        id: "e1",
        sessaoId: "s2",
        tipo: "PreToolUse",
        ferramentaUsada: "Edit",
        entradaResumo: "V:\\moductus\\src-tauri\\src\\appbar.rs",
        recebidoEm: INSTANTE,
      },
    },
  ],
};

const pr = (numero: number, extra: Partial<ItemGithub> = {}): ItemGithub => ({
  id: `g${numero}`,
  repositorio: "dono/api-pedidos",
  numero,
  tipo: "pr",
  titulo: `PR ${numero}`,
  autor: "ana",
  estado: "aberto",
  meuPapel: "revisor",
  precisaDeMim: true,
  ciEstado: null,
  atualizadoNoGithub: null,
  url: "https://github.com/dono/api-pedidos/pull/1",
  ...extra,
});

let raiz: Root | null = null;
let recipiente: HTMLElement;

beforeEach(() => {
  servidor.agentes = ["alba", "tula", "faina", "nuno"].map((id) => agente(id));
  servidor.pendentes = [pedido("a1", "npm test -- --watch=false")];
  servidor.sessoes = SESSOES;
  servidor.github = { itens: [], atualizadoEm: null };
  servidor.conexoes = [conexao("hooks-claude-code"), conexao("github")];
  pedir.mockClear();
  chamadasCasca.length = 0;
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

function avisar(evento: string, dados: unknown) {
  act(() => ouvintes.get(evento)?.forEach((fn) => fn(dados)));
}

const cartoes = () => [...recipiente.querySelectorAll<HTMLElement>(".aprovacao")];
const botaoCom = (dentro: ParentNode, texto: string) =>
  [...dentro.querySelectorAll("button")].find((b) => b.textContent === texto)!;
const linhaDo = (id: string) => recipiente.querySelector<HTMLElement>(`.time-linha[data-agente="${id}"]`)!;

describe("painel Agentes: pedidos das sessões do terminal", () => {
  it("o pedido mostra projeto, ferramenta, esperando você e o comando inteiro em linha", async () => {
    await montar();
    await abrir("agentes");
    const [cartao] = cartoes();
    expect(cartao).toBeDefined();
    expect(cartao!.querySelector(".aprovacao-origem")?.textContent).toBe(
      "api-pedidosClaude Codeesperando você",
    );
    expect(cartao!.querySelector(".aprovacao-descricao")?.textContent).toBe("Quer rodar o comando abaixo.");
    expect(cartao!.querySelector(".aprovacao-detalhe code")?.textContent).toBe("npm test -- --watch=false");
    expect([...cartao!.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Negar",
      "Sempre neste projeto",
      "Permitir",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it.each([
    ["Permitir", { decisao: "permitir" }],
    ["Negar", { decisao: "negar" }],
    ["Sempre neste projeto", { decisao: "permitir", sempre: "projeto" }],
  ])("%s manda a decisão ao serviço", async (texto, decisao) => {
    await montar();
    await abrir("agentes");
    await act(async () => botaoCom(cartoes()[0]!, texto).click());
    expect(pedir).toHaveBeenCalledWith("aprovacoes.decidir", { id: "a1", ...decisao });
  });

  it("o cartão diz o que valeu quando o aviso chega, e o alto deixa de contar o pedido", async () => {
    await montar();
    await abrir("agentes");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("1 esperando você");
    await act(async () => botaoCom(cartoes()[0]!, "Sempre neste projeto").click());
    avisar(
      "aprovacoes.mudou",
      pedido("a1", "npm test -- --watch=false", { estado: "aprovada", regraCriadaId: "r1" }),
    );
    const [decidido] = cartoes();
    expect(decidido!.querySelector("[role=status]")?.textContent).toContain("permitido");
    expect(decidido!.querySelector(".aprovacao-origem")?.textContent).not.toContain("esperando você");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("ninguém esperando você");
  });

  it("pedido novo entra pelo aviso; pedido de agente do Moductus não vira cartão do terminal", async () => {
    servidor.pendentes = [];
    await montar();
    await abrir("agentes");
    expect(cartoes()).toHaveLength(0);
    avisar("aprovacoes.mudou", pedido("a2", "pnpm build"));
    avisar(
      "aprovacoes.mudou",
      pedido("a3", "x", {
        fonte: "moductus",
        agenteId: "faina",
        sessaoId: null,
        descricao: "Prévia pronta: organizar 142 arquivos em Downloads",
        acao: {
          ferramenta: "arquivos.mover",
          entrada: {},
          rotulo: "Organizar 142 arquivos",
          rotuloRecusar: null,
          desfazivel: true,
        },
      }),
    );
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]!.querySelector("code")?.textContent).toBe("pnpm build");
  });

  it("abrir de novo relê os pendentes: o já respondido sai", async () => {
    await montar();
    await abrir("agentes");
    avisar("aprovacoes.mudou", pedido("a1", "npm test -- --watch=false", { estado: "expirada" }));
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
    avisar("aprovacoes.mudou", pedido("a2", "pnpm build"));
    avisar("aprovacoes.mudou", pedido("a1", "npm test -- --watch=false", { estado: "aprovada" }));
    await act(async () => entregar([pedido("a1", "npm test -- --watch=false")]));
    expect(cartoes().map((c) => c.dataset.estado)).toEqual(["aprovada", "pendente"]);
    expect(cartoes()[1]!.querySelector("code")?.textContent).toBe("pnpm build");
  });

  it("sessão nova com o painel aberto: o nome do projeto chega pelo sessoes.mudou", async () => {
    servidor.pendentes = [];
    await montar();
    await abrir("agentes");
    avisar("aprovacoes.mudou", pedido("a5", "cargo test", { sessaoId: "s9" }));
    expect(cartoes()[0]!.querySelector(".sessao-projeto")?.textContent).toBe("Sem projeto");
    avisar("sessoes.mudou", {
      sessao: { ...SESSAO, id: "s9", projetoId: "p9" },
      projeto: { id: "p9", nome: "site", caminho: "V:\\site", repositorio: null, arquivado: false },
    });
    expect(cartoes()[0]!.querySelector(".sessao-projeto")?.textContent).toBe("site");
  });

  it.each([
    ["WebSearch", { query: "zod discriminatedUnion" }, "Quer usar WebSearch.", "zod discriminatedUnion"],
    [
      "mcp__docs__abrir",
      { url: "https://exemplo.dev/a" },
      "Quer usar mcp__docs__abrir.",
      "https://exemplo.dev/a",
    ],
    ["mcp__shell__rodar", { command: "make" }, "Quer usar mcp__shell__rodar.", "make"],
  ])(
    "%s: o alvo do pedido aparece inteiro, mesmo sem verbo conhecido",
    async (ferramenta, entrada, descricao, alvo) => {
      servidor.pendentes = [
        pedido("a7", "x", {
          descricao,
          acao: { ferramenta, entrada, rotulo: null, rotuloRecusar: null, desfazivel: false },
        }),
      ];
      await montar();
      await abrir("agentes");
      const [cartao] = cartoes();
      expect(cartao!.querySelector(".aprovacao-descricao")?.textContent).toBe(descricao);
      expect(cartao!.querySelector(".aprovacao-detalhe code")?.textContent).toBe(alvo);
    },
  );

  it("pedido sem regra possível mostra só Negar e Permitir", async () => {
    servidor.pendentes = [pedido("a6", "x", { admiteSempre: false })];
    await montar();
    await abrir("agentes");
    expect([...cartoes()[0]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Negar",
      "Permitir",
    ]);
  });

  it("a sessão sem pedido mostra o que faz agora e quantos projetos há na seção", async () => {
    await montar();
    await abrir("agentes");
    const sessao = recipiente.querySelector<HTMLElement>(".sessao-cartao")!;
    expect(sessao.querySelector(".sessao-projeto")?.textContent).toBe("moductus");
    expect(sessao.querySelector(".sessao-acao")?.textContent).toBe("Editando src-tauri/src/appbar.rs");
    expect(sessao.textContent).toContain("trabalhando");
    expect(recipiente.querySelector(".painel-secao-cabecalho span")?.textContent).toBe("2 projetos");
  });

  it("sem sessão e sem o Claude Code ligado, convida a ligar em Conexões", async () => {
    servidor.pendentes = [];
    servidor.sessoes = { projetos: [], sessoes: [] };
    servidor.conexoes = [];
    await montar();
    await abrir("agentes");
    expect(recipiente.textContent).toContain("Ligue o Claude Code em Conexões");
    await act(async () => botaoCom(recipiente, "Abrir Conexões").click());
    expect(chamadasCasca).toContainEqual({
      comando: "sistema_abrir",
      args: { area: "configuracoes/conexoes" },
    });
  });

  it("outras áreas não mostram os pedidos", async () => {
    await montar();
    await abrir("tarefas");
    expect(cartoes()).toHaveLength(0);
  });
});

describe("painel Agentes: o time", () => {
  it("cada um com status em texto, o que faz e o resumo de quem trabalha e de quem espera", async () => {
    servidor.agentes = [
      agente("alba"),
      agente("tula", { atividade: "trabalhando" }),
      agente("faina", { atividade: "esperando" }),
      agente("nuno"),
    ];
    servidor.github = { itens: [pr(412), pr(388)], atualizadoEm: INSTANTE };
    await montar();
    await abrir("agentes");
    // A Faina e a sessão do terminal esperam você.
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe(
      "1 trabalhando · 2 esperando você",
    );
    expect(linhaDo("alba").querySelector(".selo")?.textContent).toBe("ocioso");
    expect(linhaDo("alba").querySelector(".time-acao")?.textContent).toBe("Cuida do seu dia");
    expect(linhaDo("tula").querySelector(".selo")?.textContent).toBe("trabalhando");
    expect(linhaDo("tula").querySelector(".time-correndo")).not.toBeNull();
    expect(linhaDo("faina").querySelector(".selo")?.textContent).toBe("esperando você");
    // O Nuno diz o que tem para você, em até duas partes: a sessão esperando e o contexto cheio.
    expect(linhaDo("nuno").querySelector(".time-acao")?.textContent).toBe(
      "1 sessão esperando você · moductus usou 84% do contexto",
    );
    expect(recipiente.querySelector(".painel-rodape")?.textContent).toBe(
      "Modelo dos agentes: Claude Code, sua assinaturaTrocar",
    );
    expect(auditar(recipiente)).toEqual([]);
  });

  it("agentes.mudou troca a linha de quem mudou", async () => {
    await montar();
    await abrir("agentes");
    avisar("agentes.mudou", agente("alba", { estado: "pausado" }));
    expect(linhaDo("alba").querySelector(".selo")?.textContent).toBe("pausado");
    expect(linhaDo("alba").querySelector(".time-acao")?.textContent).toBe("Em pausa até você retomar");
  });

  it("sem modelo, o time dorme com o convite e as sessões continuam no painel", async () => {
    servidor.agentes = ["alba", "tula", "faina", "nuno"].map((id) =>
      agente(id, { estado: "dormindo", motivoSono: "sem_modelo" }, null),
    );
    await montar();
    await abrir("agentes");
    expect(recipiente.textContent).toContain("Conecte um modelo para acordar o time");
    expect(recipiente.querySelector(".time-lista")).toBeNull();
    expect(cartoes()).toHaveLength(1);
    await act(async () => botaoCom(recipiente, "Abrir Configurações").click());
    expect(chamadasCasca).toContainEqual({
      comando: "sistema_abrir",
      args: { area: "configuracoes/modelos" },
    });
  });

  it("sem resposta de agentes.listar, diz que não sabe do time e não pede modelo", async () => {
    servidor.agentes = () => Promise.reject(new Error("recusado"));
    await montar();
    await abrir("agentes");
    expect(recipiente.textContent).toContain("Sem notícia do time agora");
    expect(recipiente.textContent).not.toContain("Conecte um modelo");
    // As sessões do terminal continuam aprováveis.
    expect(cartoes()).toHaveLength(1);
  });

  it("o atalho ao lado de Abrir no sistema é o que você configurou", async () => {
    await montar();
    await abrir("agentes");
    expect(recipiente.querySelector(".painel-abrir")?.textContent).toBe("Abrir no sistemaCtrlShiftM");
  });

  it("Abrir no sistema leva à área Agentes e fecha o painel", async () => {
    await montar();
    await abrir("agentes");
    await act(async () => recipiente.querySelector<HTMLButtonElement>(".painel-abrir")!.click());
    expect(chamadasCasca).toContainEqual({ comando: "sistema_abrir", args: { area: "agentes" } });
    expect(chamadasCasca.map((c) => c.comando)).toContain("painel_fechar");
  });
});

describe("painel Agentes: estados que pedem decisão (Estados.dc.html)", () => {
  const estados = () => [...recipiente.querySelectorAll<HTMLElement>(".estado-cartao")];

  it("time pausado pela bandeja: um cartão só, e Retomar agora retoma o time", async () => {
    servidor.agentes = ["alba", "tula", "faina", "nuno"].map((id) => agente(id, { estado: "pausado" }));
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(estados()).toHaveLength(1);
    expect(cartao!.querySelector("h3")?.textContent).toBe("Time pausado até você retomar");
    expect(cartao!.querySelector(".selo")?.textContent).toBe("pausado");
    await act(async () => botaoCom(cartao!, "Retomar agora").click());
    expect(pedir).toHaveBeenCalledWith("agentes.retomar", {});
  });

  it("dois de quatro em pausa: um cartão, e Retomar agora retoma os dois, cada um", async () => {
    servidor.agentes = [
      agente("alba", { estado: "pausado" }),
      agente("tula"),
      agente("faina", { estado: "pausado" }),
      agente("nuno"),
    ];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(estados()).toHaveLength(1);
    expect(cartao!.querySelector("h3")?.textContent).toBe("Alba e Faina em pausa até você retomar");
    expect(cartao!.textContent).not.toContain("bandeja");
    await act(async () => botaoCom(cartao!, "Retomar agora").click());
    const retomadas = pedir.mock.calls.filter(([m]) => m === "agentes.retomar").map(([, d]) => d);
    expect(retomadas).toEqual([{ agenteId: "alba" }, { agenteId: "faina" }]);
  });

  it("um agente em pausa: o cartão retoma só ele", async () => {
    servidor.agentes = [agente("alba", { estado: "pausado" }), agente("tula")];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(cartao!.querySelector("h3")?.textContent).toBe("Alba em pausa até você retomar");
    await act(async () => botaoCom(cartao!, "Retomar agora").click());
    expect(pedir).toHaveBeenCalledWith("agentes.retomar", { agenteId: "alba" });
  });

  it("limite do modelo: o cartão diz de qual, leva aos Modelos e Esperar dispensa", async () => {
    servidor.agentes = [agente("nuno", { estado: "dormindo", motivoSono: "limite" })];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(cartao!.querySelector("h3")?.textContent).toBe("O limite do Claude Code acabou");
    expect(cartao!.textContent).toContain("Volto quando ele renovar.");
    await act(async () => botaoCom(cartao!, "Usar outro modelo").click());
    expect(chamadasCasca).toContainEqual({
      comando: "sistema_abrir",
      args: { area: "configuracoes/modelos" },
    });
    await act(async () => botaoCom(estados()[0]!, "Esperar").click());
    expect(estados()).toHaveLength(0);
  });

  it("erro de provedor: selo de erro, nada alterado e Trocar modelo", async () => {
    servidor.agentes = [agente("tula", { estado: "dormindo", motivoSono: "fora_do_ar" })];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(cartao!.querySelector("h3")?.textContent).toBe("Não consegui falar com o modelo");
    expect(cartao!.querySelector(".selo")?.textContent).toBe("erro");
    expect(cartao!.textContent).toContain(
      "O Claude Code não respondeu. Nada foi alterado; tento de novo em breve.",
    );
    expect([...cartao!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Trocar modelo"]);
    expect(linhaDo("tula").querySelector(".selo")?.textContent).toBe("erro");
  });

  it("CLI sem login: o cartão diz como entrar, com o comando como código, e a linha fala de login", async () => {
    servidor.agentes = [agente("alba", { estado: "dormindo", motivoSono: "credencial" })];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(cartao!.querySelector("p")?.textContent).toBe(
      "O Claude Code está sem login. Entre no terminal com claude e tento de novo em breve.",
    );
    expect(cartao!.querySelector("p code")?.textContent).toBe("claude");
    expect(cartao!.textContent).not.toContain("chave");
    expect(linhaDo("alba").textContent).toContain("Claude Code sem login, tenta de novo em breve");
  });

  it("teto: sem valor inventado, leva aos Modelos para mudar o teto", async () => {
    servidor.agentes = [agente("nuno", { estado: "dormindo", motivoSono: "teto" })];
    await montar();
    await abrir("agentes");
    const [cartao] = estados();
    expect(cartao!.querySelector("h3")?.textContent).toBe("Cheguei ao teto de hoje");
    expect(cartao!.textContent).not.toMatch(/US\$|R\$/);
    expect([...cartao!.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Parar até amanhã",
      "Mudar o teto",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });
});

describe("painel Dev", () => {
  it("sessões com o contexto, aviso a partir de 80%, e os PRs com o selo do que precisa de você", async () => {
    servidor.github = {
      itens: [
        pr(412),
        pr(57, { meuPapel: "autor", precisaDeMim: false, ciEstado: "falhou", repositorio: "dono/site" }),
        pr(12, { meuPapel: "autor", precisaDeMim: false, ciEstado: "passou", repositorio: "dono/moductus" }),
        pr(9, { tipo: "issue", meuPapel: "atribuido" }),
      ],
      atualizadoEm: INSTANTE,
    };
    await montar();
    await abrir("dev");
    expect(recipiente.querySelector("h1")?.textContent).toBe("Dev");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe(
      "Nuno · 2 sessões, 1 PR esperando você",
    );
    const sessoes = [...recipiente.querySelectorAll<HTMLElement>(".sessao-cartao")];
    expect(sessoes.map((s) => s.querySelector(".sessao-projeto")?.textContent)).toEqual([
      "api-pedidos",
      "moductus",
    ]);
    expect(sessoes[0]!.querySelector(".sessao-numero")?.textContent).toBe("não sei do contexto");
    expect(sessoes[1]!.dataset.alto).toBe("true");
    expect(sessoes[1]!.querySelector(".sessao-numero")?.textContent).toBe("84% do contexto");
    expect(sessoes[1]!.querySelector(".sessao-acao")?.textContent).toBe(
      "Contexto quase cheio. Vale compactar no terminal.",
    );
    const prs = [...recipiente.querySelectorAll<HTMLElement>(".pr-linha")];
    expect(
      prs.map((p) => [p.querySelector(".selo")?.textContent, p.querySelector(".pr-meta")?.textContent]),
    ).toEqual([
      ["review", "api-pedidos #412"],
      ["CI falhou", "site #57 · seu"],
      ["CI passou", "moductus #12 · seu"],
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("GitHub em erro: diz o que o serviço disse e mostra o que está no cache", async () => {
    servidor.conexoes = [
      conexao("hooks-claude-code"),
      { ...conexao("github", "erro"), ultimoErro: "Rode gh auth login de novo." },
    ];
    servidor.github = { itens: [pr(412)], atualizadoEm: INSTANTE };
    await montar();
    await abrir("dev");
    expect(recipiente.querySelector("[role=alert]")?.textContent).toBe("Rode gh auth login de novo.");
    expect(recipiente.textContent).not.toContain("Conecte o GitHub");
    expect(recipiente.querySelectorAll(".pr-linha")).toHaveLength(1);
  });

  it("enquanto o GitHub e as sessões não respondem, diz que está lendo, sem convidar a conectar", async () => {
    servidor.github = new Promise(() => {}) as unknown as SituacaoGithub;
    servidor.sessoes = new Promise(() => {}) as unknown as ListaSessoes;
    await montar();
    await abrir("dev");
    expect(recipiente.textContent).toContain("Lendo o GitHub.");
    expect(recipiente.textContent).toContain("Lendo as sessões.");
    expect(recipiente.textContent).not.toContain("Conecte o GitHub");
    expect(recipiente.textContent).not.toContain("Ligue o Claude Code");
  });

  it("sem o GitHub ligado, a seção de PRs convida a conectar", async () => {
    servidor.conexoes = [conexao("hooks-claude-code"), conexao("github", "desligada")];
    await montar();
    await abrir("dev");
    expect(recipiente.textContent).toContain("Conecte o GitHub para ver PRs, CI e issues aqui.");
    expect(recipiente.querySelector(".pr-linha")).toBeNull();
  });
});
