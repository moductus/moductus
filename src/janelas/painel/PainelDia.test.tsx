// @vitest-environment happy-dom
import {
  ADIAR_LEMBRETE_MIN,
  MENSAGEM_LEMBRETE_NAO_TOCA,
  type Aprovacao,
  type EstadoFoco,
  type Lembrete,
  type LembretesDeHoje,
  type Lista,
  type PreviaCaptura,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { lembrete, tarefa } from "../../teste/dia.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Os painéis Hoje e Tarefas do dock. A casca abre o painel pelo evento `painel:area`; o canal é um
 * serviço de mentira que responde o dia (tarefas, lembretes, foco, pedidos do terminal, captura) e
 * deixa disparar os avisos como o serviço dispararia. O relógio fica parado em quinta, 8 de
 * outubro de 2026, 14:32 em São Paulo.
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

const AGORA = new Date("2026-10-08T17:32:00.000Z");

const LISTAS: Lista[] = [
  { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false },
  { id: "pessoal", nome: "Pessoal", ordem: 1, cor: null, arquivada: false },
  { id: "casa", nome: "Casa", ordem: 2, cor: null, arquivada: false },
];

const PARADO: EstadoFoco = {
  etapa: null,
  tarefaTitulo: null,
  cicloAtual: 1,
  ciclosAtePausaLonga: 4,
  proxima: "foco",
  focoHojeMin: 0,
  ciclosHoje: 0,
  podeEstender: false,
};

const RODANDO: EstadoFoco = {
  ...PARADO,
  etapa: {
    id: "e1",
    tipo: "foco",
    tarefaId: "t2",
    inicio: "2026-10-08T17:25:42.000Z",
    // 18:42 a partir das 14:32 de São Paulo.
    terminaEm: "2026-10-08T17:50:42.000Z",
    pausadaEm: null,
    fim: null,
    duracaoPlanejadaMin: 25,
    duracaoRealMin: null,
    interrompida: false,
  },
  tarefaTitulo: "Revisar PR do relatório mensal",
  cicloAtual: 2,
};

const SEM_LEMBRETE: LembretesDeHoje = { chegando: null, tocando: [], atrasados: [], ausencia: null };

const previaDe = (texto: string, campos: Partial<PreviaCaptura["campos"]> = {}): PreviaCaptura => ({
  texto,
  tipo: "tarefa",
  trechos: [],
  alternativas: ["lembrete", "evento", "nota"],
  aviso: null,
  entendidoPor: "codigo",
  campos: {
    titulo: texto,
    dia: null,
    hora: null,
    duracaoMin: null,
    recorrencia: null,
    lembreteMinutosAntes: null,
    listaId: null,
    valorCentavos: null,
    ...campos,
  },
});

const servidor: {
  hoje: Tarefa[] | (() => Promise<Tarefa[]>);
  atrasadas: Tarefa[];
  proximas: Tarefa[];
  lembretesHoje: LembretesDeHoje | (() => Promise<LembretesDeHoje>);
  lembretesDoDia: Lembrete[];
  foco: EstadoFoco;
  pendentes: Aprovacao[];
  entender: (dados: { texto: string; comModelo?: boolean }) => Promise<PreviaCaptura>;
} = {
  hoje: [],
  atrasadas: [],
  proximas: [],
  lembretesHoje: SEM_LEMBRETE,
  lembretesDoDia: [],
  foco: PARADO,
  pendentes: [],
  entender: async ({ texto }) => previaDe(texto),
};
const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const pedir = vi.fn(async (metodo: string, dados?: unknown): Promise<unknown> => {
  switch (metodo) {
    case "config.obter":
      return {
        config: { atalhos: { sistema: "Ctrl+Alt+N" }, dia: { fuso: "America/Sao_Paulo" } },
        portable: false,
        falhasAtalhos: {},
      };
    case "listas.listar":
      return LISTAS;
    case "tarefas.listar": {
      const { vista } = dados as { vista: string };
      if (vista === "hoje") return typeof servidor.hoje === "function" ? servidor.hoje() : servidor.hoje;
      if (vista === "atrasadas") return servidor.atrasadas;
      if (vista === "proximas") return servidor.proximas;
      throw new Error(`vista ${vista}`);
    }
    case "lembretes.hoje":
      return typeof servidor.lembretesHoje === "function" ? servidor.lembretesHoje() : servidor.lembretesHoje;
    case "lembretes.listar":
      return servidor.lembretesDoDia;
    case "foco.obter":
      return servidor.foco;
    case "aprovacoes.pendentes":
      return servidor.pendentes;
    case "sessoes.listar":
      return {
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
            iniciadaEm: AGORA.toISOString(),
            ultimoEventoEm: AGORA.toISOString(),
            encerradaEm: null,
            contexto: null,
            ultimoEvento: null,
          },
        ],
      };
    case "captura.entender":
      return servidor.entender(dados as { texto: string; comModelo?: boolean });
    case "captura.lancar":
      return {
        id: "c1",
        tipo: "tarefa",
        itemId: "t9",
        desfazerAte: new Date(Date.now() + 10_000).toISOString(),
      };
    case "captura.desfazer":
    case "tarefas.concluir":
    case "tarefas.reabrir":
    case "tarefas.adiar":
    case "lembretes.adiar":
    case "lembretes.concluir":
    case "foco.iniciar":
    case "foco.pausar":
    case "foco.retomar":
    case "foco.terminar":
      return {};
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

let raiz: Root | null = null;
let recipiente: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  servidor.hoje = [];
  servidor.atrasadas = [];
  servidor.proximas = [];
  servidor.lembretesHoje = SEM_LEMBRETE;
  servidor.lembretesDoDia = [];
  servidor.foco = PARADO;
  servidor.pendentes = [];
  servidor.entender = async ({ texto }) => previaDe(texto);
  pedir.mockClear();
  chamadasCasca.length = 0;
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  ouvintes.clear();
  vi.useRealTimers();
});

async function abrir(area: string) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Painel />));
  await act(async () => eventosCasca.get("painel:area")?.({ payload: area }));
}

function avisar(evento: string, dados: unknown) {
  act(() => ouvintes.get(evento)?.forEach((fn) => fn(dados)));
}

const botaoCom = (dentro: ParentNode, texto: string) =>
  [...dentro.querySelectorAll("button")].find((b) => b.textContent === texto)!;
const secao = (rotulo: string) =>
  [...recipiente.querySelectorAll<HTMLElement>("section:not(.painel-cartao)")].find(
    (s) => s.querySelector("h2")?.textContent?.startsWith(rotulo) ?? false,
  )!;
const titulos = () => [...recipiente.querySelectorAll(".painel-tarefa-titulo")].map((t) => t.textContent);
const chamou = (metodo: string) => pedir.mock.calls.filter(([m]) => m === metodo).map(([, d]) => d);

async function digitar(campo: HTMLInputElement, texto: string) {
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const enter = (campo: HTMLInputElement) =>
  act(async () => {
    campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

const CONTADOR = tarefa("t1", {
  titulo: "Ligar para o contador",
  listaId: "pessoal",
  hora: "15:00",
  lembreteMinutosAntes: 15,
});

describe("painel Hoje: o lembrete", () => {
  it("tocando sobe ao topo com hora, origem e [Adiar 10 min] [Feito], os pedidos do aviso do Windows", async () => {
    servidor.hoje = [CONTADOR];
    servidor.lembretesHoje = {
      ...SEM_LEMBRETE,
      tocando: [
        lembrete("l1", {
          texto: "Ligar para o contador",
          tarefaId: "t1",
          estado: "disparado",
          disparadoEm: "2026-10-08T17:30:00.000Z",
        }),
      ],
    };
    await abrir("hoje");
    const corpo = recipiente.querySelector(".painel-corpo")!;
    const tocando = corpo.firstElementChild as HTMLElement;
    expect(tocando.querySelector("h2")?.textContent).toBe("Ligar para o contador");
    expect(tocando.querySelector(".lembrete-topo")?.textContent).toBe("Lembrete · 14:45há 2 min");
    expect(tocando.querySelector(".lembrete-rotulo")?.textContent).toBe("Tarefa de hoje às 15:00 · você");

    await act(async () => botaoCom(tocando, "Adiar 10 min").click());
    // A ocorrência que estava tocando vai junto: a mesma trava do botão do aviso.
    const quando = "2026-10-08T17:45:00.000Z";
    expect(chamou("lembretes.adiar")).toEqual([{ ids: ["l1"], minutos: ADIAR_LEMBRETE_MIN, quando }]);
    expect(ADIAR_LEMBRETE_MIN).toBe(10);
    await act(async () => botaoCom(tocando, "Feito").click());
    expect(chamou("lembretes.concluir")).toEqual([{ ids: ["l1"], quando }]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("chegando aparece numa linha, sem botões, com quanto falta", async () => {
    servidor.hoje = [CONTADOR];
    servidor.lembretesHoje = {
      ...SEM_LEMBRETE,
      chegando: lembrete("l1", { texto: "Ligar para o contador", tarefaId: "t1" }),
    };
    await abrir("hoje");
    const chegando = recipiente.querySelector<HTMLElement>(".lembrete--chegando")!;
    expect(chegando.querySelector(".lembrete-rotulo")?.textContent).toBe(
      "lembrete às 14:45 · tarefa às 15:00",
    );
    expect(chegando.querySelector(".lembrete-numero")?.textContent).toBe("em 13 min");
    expect(chegando.querySelectorAll("button")).toHaveLength(0);
  });

  it("os atrasados chegam juntos, com a fala da Alba, Feito por item e as ações em grupo", async () => {
    servidor.lembretesHoje = {
      ...SEM_LEMBRETE,
      atrasados: [
        lembrete("l1", { texto: "Ligar para o contador", estado: "perdido" }),
        lembrete("l2", {
          texto: "Tirar a roupa da máquina",
          quando: "2026-10-08T18:30:00.000Z",
          estado: "perdido",
        }),
      ],
      ausencia: { de: "2026-10-08T17:20:00.000Z", ate: "2026-10-08T19:05:00.000Z" },
    };
    await abrir("hoje");
    const cartao = secao("Atrasados");
    expect(cartao.querySelector("h2")?.textContent).toBe("Atrasados · 2");
    expect(cartao.querySelector(".lembrete-meta")?.textContent).toBe("PC suspenso 14:20–16:05");
    expect(cartao.querySelector(".fala-texto")?.textContent).toBe(
      "O PC ficou suspenso por 1h45 e 2 lembretes passaram nesse tempo. Seguem aqui até você decidir.",
    );
    expect([...cartao.querySelectorAll(".lembrete-perdido-hora")].map((h) => h.textContent)).toEqual([
      "14:45",
      "15:30",
    ]);

    await act(async () =>
      cartao.querySelector<HTMLButtonElement>('[aria-label="Feito: Tirar a roupa da máquina"]')!.click(),
    );
    expect(chamou("lembretes.concluir")).toEqual([{ ids: ["l2"] }]);
    await act(async () => botaoCom(cartao, "Adiar os 2 em 30 min").click());
    expect(chamou("lembretes.adiar")).toEqual([{ ids: ["l1", "l2"], minutos: 30 }]);
    await act(async () => botaoCom(cartao, "Concluir os 2").click());
    expect(chamou("lembretes.concluir")).toContainEqual({ ids: ["l1", "l2"] });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("o aviso `lembretes.hoje` troca o que está na tela sem pedir de novo", async () => {
    await abrir("hoje");
    expect(recipiente.querySelector(".lembrete")).toBeNull();
    avisar("lembretes.hoje", {
      ...SEM_LEMBRETE,
      tocando: [
        lembrete("l9", { texto: "Beber água", estado: "disparado", disparadoEm: AGORA.toISOString() }),
      ],
    });
    expect(recipiente.querySelector(".lembrete--tocando h2")?.textContent).toBe("Beber água");
    avisar("lembretes.hoje", SEM_LEMBRETE);
    expect(recipiente.querySelector(".lembrete")).toBeNull();
  });

  it("a ação que falha diz isso no cartão, sem o texto do serviço", async () => {
    servidor.lembretesHoje = {
      ...SEM_LEMBRETE,
      tocando: [lembrete("l1", { estado: "disparado", disparadoEm: AGORA.toISOString() })],
    };
    await abrir("hoje");
    pedir.mockImplementationOnce(async () => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    await act(async () => botaoCom(recipiente, "Feito").click());
    expect(recipiente.querySelector(".lembrete [role=alert]")?.textContent).toBe(
      "Não consegui concluir agora. Tente de novo.",
    );
  });
});

describe("painel Hoje: o lembrete que já não toca e a leitura que falha", () => {
  it("Feito de um cartão cuja ocorrência já não toca diz isso, sem a falha genérica", async () => {
    servidor.lembretesHoje = {
      ...SEM_LEMBRETE,
      tocando: [lembrete("l1", { estado: "disparado", disparadoEm: AGORA.toISOString() })],
    };
    await abrir("hoje");
    pedir.mockImplementationOnce(async () => {
      throw new RecusaDoServico(MENSAGEM_LEMBRETE_NAO_TOCA);
    });
    await act(async () => botaoCom(recipiente, "Feito").click());
    expect(recipiente.querySelector(".lembrete [role=alert]")?.textContent).toBe(
      "Este lembrete já não está tocando.",
    );
  });

  it("os lembretes que não deu para ler dizem isso e tentam de novo", async () => {
    let falhar = true;
    servidor.lembretesHoje = async () => {
      if (falhar) throw new Error("caiu");
      return {
        ...SEM_LEMBRETE,
        tocando: [
          lembrete("l1", { texto: "Beber água", estado: "disparado", disparadoEm: AGORA.toISOString() }),
        ],
      };
    };
    await abrir("hoje");
    const vazio = recipiente.querySelector<HTMLElement>(".painel-corpo > .painel-secao-vazia")!;
    expect(vazio.querySelector("p")?.textContent).toBe("Não consegui ler os lembretes agora.");
    falhar = false;
    await act(async () => botaoCom(vazio, "Tentar de novo").click());
    expect(recipiente.querySelector(".lembrete--tocando h2")?.textContent).toBe("Beber água");
    expect(recipiente.querySelector(".painel-corpo > .painel-secao-vazia")).toBeNull();
  });
});

describe("painel Hoje: foco, tarefas, finanças e sessões", () => {
  it("o alto diz o dia no fuso do usuário e abre o Sistema pelo atalho", async () => {
    await abrir("hoje");
    expect(recipiente.querySelector(".painel-titulo")?.textContent).toBe("Hoje");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("quinta, 8 de outubro · 14:32");
    await act(async () => botaoCom(recipiente, "Abrir no sistemaCtrlAltN").click());
    expect(chamadasCasca).toContainEqual({ comando: "sistema_abrir", args: { area: "inicio" } });
  });

  it("o foco rodando: etapa, ciclo, o tempo que falta, a tarefa e [Pausar] [Encerrar]", async () => {
    servidor.foco = RODANDO;
    await abrir("hoje");
    const foco = secao("Foco");
    expect(foco.querySelector(".dia-bloco-topo")?.textContent).toBe("Foco2 de 4");
    expect(foco.querySelector(".dia-cronometro")?.textContent).toBe("18:42");
    expect(foco.querySelector(".dia-bloco-tarefa")?.textContent).toBe("Revisar PR do relatório mensal");
    await act(async () => botaoCom(foco, "Pausar").click());
    await act(async () => botaoCom(foco, "Encerrar").click());
    expect(chamou("foco.pausar")).toHaveLength(1);
    expect(chamou("foco.terminar")).toHaveLength(1);

    avisar("foco.mudou", { ...RODANDO, etapa: { ...RODANDO.etapa!, pausadaEm: "2026-10-08T17:30:00.000Z" } });
    expect(secao("Foco").querySelector(".dia-cronometro")?.textContent).toBe("20:42");
    await act(async () => botaoCom(secao("Foco"), "Retomar").click());
    expect(chamou("foco.retomar")).toHaveLength(1);
  });

  it("o foco parado diz isso e começa o que vem agora", async () => {
    servidor.foco = { ...PARADO, proxima: "pausa", focoHojeMin: 75 };
    await abrir("hoje");
    const foco = secao("Foco");
    expect(foco.querySelector(".dia-bloco-topo")?.textContent).toBe("Foco1h15 hoje");
    expect(foco.querySelector(".dia-bloco-texto")?.textContent).toBe("Nenhum foco agora.");
    await act(async () => botaoCom(foco, "Começar a pausa").click());
    expect(chamou("foco.iniciar")).toEqual([{ tipo: "pausa" }]);
  });

  it("as tarefas: atrasadas primeiro, hoje pela hora, a contagem do dia e a hora que passou em aviso", async () => {
    servidor.atrasadas = [tarefa("a1", { titulo: "Enviar documentos do aluguel", venceEm: "2026-10-06" })];
    servidor.hoje = [
      tarefa("t3", { titulo: "Comprar ração", listaId: "casa" }),
      CONTADOR,
      tarefa("t2", {
        titulo: "Revisar PR",
        hora: "10:00",
        estado: "feita",
        concluidaEm: AGORA.toISOString(),
      }),
      tarefa("t4", { titulo: "Separar comprovantes", hora: "14:00", prioridade: 2 }),
    ];
    await abrir("hoje");
    const tarefas = secao("Tarefas");
    expect(tarefas.querySelector(".painel-secao-cabecalho span")?.textContent).toBe("1 de 4");
    // Cinco para quatro linhas: sai a feita mais cedo, que continua na área Tarefas.
    expect(titulos()).toEqual([
      "Enviar documentos do aluguel",
      "Separar comprovantes",
      "Ligar para o contador",
      "Comprar ração",
    ]);
    const quando = [...tarefas.querySelectorAll<HTMLElement>(".painel-tarefa-quando")];
    expect(quando.map((q) => [q.firstChild?.textContent ?? "", q.dataset.aviso ?? null])).toEqual([
      ["ter", "true"],
      ["14:00", "true"],
      ["15:00", null],
      ["", null],
    ]);
    expect(botaoCom(tarefas, "Mais 1 em Tarefas")).toBeDefined();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("marcar conclui pelo serviço e oferece desfazer, que reabre", async () => {
    servidor.hoje = [CONTADOR];
    await abrir("hoje");
    await act(async () => recipiente.querySelector<HTMLElement>('[role="checkbox"]')!.click());
    expect(chamou("tarefas.concluir")).toEqual([{ id: "t1" }]);
    const desfazer = recipiente.querySelector<HTMLElement>(".dia-desfazer")!;
    expect(desfazer.querySelector(".dia-desfazer-texto")?.textContent).toBe("Ligar para o contador: feita.");
    await act(async () => botaoCom(desfazer, "Desfazer").click());
    expect(chamou("tarefas.reabrir")).toEqual([{ id: "t1" }]);
    expect(recipiente.querySelector(".dia-desfazer")).toBeNull();
  });

  it("um aviso `tarefas.mudou` relê as vistas: quem diz o que é de hoje é o serviço", async () => {
    servidor.hoje = [CONTADOR];
    await abrir("hoje");
    expect(titulos()).toEqual(["Ligar para o contador"]);
    servidor.hoje = [];
    avisar("tarefas.mudou", { tarefas: [{ ...CONTADOR, venceEm: "2026-10-09" }], apagadas: [] });
    await act(async () => {});
    expect(titulos()).toEqual([]);
    expect(secao("Tarefas").querySelector(".dia-vazio")?.textContent).toBe(
      "Nada para hoje. Escreva abaixo o que precisa fazer.",
    );
  });

  it("leitura que falhou diz isso e tenta de novo", async () => {
    let falhar = true;
    servidor.hoje = async () => {
      if (falhar) throw new Error("caiu");
      return [CONTADOR];
    };
    await abrir("hoje");
    expect(secao("Tarefas").querySelector(".painel-secao-vazia p")?.textContent).toBe(
      "Não consegui ler as tarefas agora.",
    );
    falhar = false;
    await act(async () => botaoCom(secao("Tarefas"), "Tentar de novo").click());
    expect(titulos()).toEqual(["Ligar para o contador"]);
  });

  it("finanças é vazio honesto: nenhum número até a Tula", async () => {
    await abrir("hoje");
    const financas = secao("Finanças");
    expect(financas.textContent).toBe(
      "Finançaschega com FinançasO orçamento do mês aparece aqui quando a Tula chegar.",
    );
    expect(financas.textContent).not.toMatch(/R\$|%/);
  });

  it("a sessão de IA esperando você vem com o cartão de aprovação", async () => {
    servidor.pendentes = [
      {
        id: "a1",
        fonte: "claude-code",
        agenteId: null,
        execucaoId: null,
        sessaoId: "s1",
        descricao: "Quer rodar o comando abaixo.",
        acao: {
          ferramenta: "Bash",
          entrada: { command: "npm test" },
          rotulo: null,
          rotuloRecusar: null,
          desfazivel: false,
        },
        estado: "pendente",
        criadoEm: AGORA.toISOString(),
        decididaEm: null,
        regraCriadaId: null,
        admiteSempre: true,
      },
    ];
    await abrir("hoje");
    const sessoes = secao("Sessões de IA");
    expect(sessoes.querySelector(".aprovacao-detalhe code")?.textContent).toBe("npm test");
    expect([...sessoes.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Negar",
      "Sempre neste projeto",
      "Permitir",
    ]);
  });

  it("sem pedido do terminal, a seção das sessões não aparece", async () => {
    await abrir("hoje");
    expect(secao("Sessões de IA")).toBeUndefined();
  });
});

describe("painel Tarefas", () => {
  it("as atrasadas com 'Trazer as 2 para hoje', as de hoje com a contagem e o pé", async () => {
    servidor.atrasadas = [
      tarefa("a1", { titulo: "Enviar documentos do aluguel", venceEm: "2026-10-06", listaId: "casa" }),
      tarefa("a2", { titulo: "Devolver o livro", venceEm: "2026-10-07" }),
    ];
    servidor.hoje = [
      CONTADOR,
      tarefa("t2", { titulo: "Regar as plantas", estado: "feita", concluidaEm: AGORA.toISOString() }),
    ];
    servidor.proximas = [
      tarefa("p1", { venceEm: "2026-10-09" }),
      tarefa("p2", { venceEm: "2026-10-15" }),
      tarefa("p3", { venceEm: "2026-10-16" }),
    ];
    servidor.lembretesDoDia = [lembrete("l1"), lembrete("l2"), lembrete("l3")];
    await abrir("tarefas");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("Alba · quinta, 8 de outubro");

    const atrasadas = secao("Atrasadas");
    expect(atrasadas.querySelector("h2")?.textContent).toBe("Atrasadas · 2");
    expect(
      [...atrasadas.querySelectorAll(".painel-tarefa-quando")].map((q) => q.firstChild?.textContent),
    ).toEqual(["ter", "ontem"]);
    expect(atrasadas.querySelector(".painel-tarefa-nota")?.textContent).toBe("Casa");
    await act(async () => botaoCom(atrasadas, "Trazer as 2 para hoje").click());
    expect(chamou("tarefas.adiar")).toEqual([{ ids: ["a1", "a2"], para: "hoje" }]);

    const hoje = secao("Hoje");
    expect(hoje.querySelector(".painel-secao-cabecalho span")?.textContent).toBe("1 de 2 feitas");
    expect(hoje.querySelector(".painel-tarefa-nota")?.textContent).toBe("Pessoal · lembrete 14:45");
    expect(hoje.querySelector('[aria-label="com lembrete"]')).not.toBeNull();

    // As próximas contam só até 7 dias; os lembretes, os do dia no fuso.
    expect([...recipiente.querySelectorAll(".dia-pe button")].map((b) => b.textContent)).toEqual([
      "Próximos 7 dias · 2",
      "Lembretes · 3",
    ]);
    expect(chamou("lembretes.listar")).toEqual([
      { de: "2026-10-08T03:00:00.000Z", ate: "2026-10-09T03:00:00.000Z" },
    ]);
    await act(async () => botaoCom(recipiente, "Lembretes · 3").click());
    expect(chamadasCasca).toContainEqual({ comando: "sistema_abrir", args: { area: "tarefas" } });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("vazio explica como começar", async () => {
    await abrir("tarefas");
    expect(secao("Hoje").querySelector(".dia-vazio")?.textContent).toContain("Nada para hoje. Escreva acima");
    expect(secao("Atrasadas")).toBeUndefined();
  });

  it("depois de lançar, a mesma frase escrita de novo espera a prévia nova antes do Enter", async () => {
    const pendentes: ((p: PreviaCaptura) => void)[] = [];
    let primeira = true;
    servidor.entender = ({ texto }) => {
      if (primeira) {
        primeira = false;
        return Promise.resolve(previaDe(texto));
      }
      return new Promise((resolver) => pendentes.push(resolver));
    };
    await abrir("tarefas");
    const campo = recipiente.querySelector<HTMLInputElement>(".frase input")!;
    await digitar(campo, "comprar pão");
    await enter(campo);
    expect(chamou("captura.lancar")).toHaveLength(1);
    expect(recipiente.querySelector(".frase-previa")).toBeNull();

    await digitar(campo, "comprar pão");
    await enter(campo);
    expect(chamou("captura.lancar")).toHaveLength(1);
    await act(async () => pendentes[0]!(previaDe("comprar pão")));
    await enter(campo);
    expect(chamou("captura.lancar")).toHaveLength(2);
  });

  it("adicionar por frase: o 'Entendi:' antes do Enter, e o Enter lança o que a prévia mostrou", async () => {
    servidor.entender = async ({ texto }) =>
      previaDe(texto, {
        titulo: "Ligar pro banco",
        dia: "2026-10-09",
        hora: "15:00",
        lembreteMinutosAntes: 15,
      });
    await abrir("tarefas");
    const campo = recipiente.querySelector<HTMLInputElement>(
      "#" + CSS.escape(recipiente.querySelector("label")!.htmlFor),
    )!;
    expect(recipiente.querySelector("label")?.textContent).toBe("Adicionar por frase");

    await act(async () => campo.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(chamadasCasca).toContainEqual({ comando: "painel_foco", args: { quer: true } });

    await digitar(campo, "ligar pro banco amanhã 15h");
    expect(chamou("captura.entender")).toEqual([{ texto: "ligar pro banco amanhã 15h" }]);
    expect(recipiente.querySelector(".frase-previa")?.textContent).toBe(
      "Entendi:tarefasex, 9 out15:00lembrete 14:45",
    );

    await enter(campo);
    expect(chamou("captura.lancar")).toEqual([
      {
        texto: "ligar pro banco amanhã 15h",
        tipo: "tarefa",
        campos: expect.objectContaining({ titulo: "Ligar pro banco", dia: "2026-10-09", hora: "15:00" }),
      },
    ]);
    expect(campo.value).toBe("");
    const desfazer = recipiente.querySelector<HTMLElement>(".dia-desfazer")!;
    expect(desfazer.querySelector(".dia-desfazer-texto")?.textContent).toBe("Ligar pro banco: criada.");
    await act(async () => botaoCom(desfazer, "Desfazer").click());
    expect(chamou("captura.desfazer")).toEqual([{ id: "c1" }]);
  });

  it("a resposta de uma frase que já mudou é descartada, e o Enter não lança antes da prévia", async () => {
    const pendentes: { texto: string; resolver: (p: PreviaCaptura) => void }[] = [];
    servidor.entender = ({ texto }) => new Promise((resolver) => pendentes.push({ texto, resolver }));
    await abrir("tarefas");
    const campo = recipiente.querySelector<HTMLInputElement>(".frase input")!;
    await digitar(campo, "comprar pã");
    await digitar(campo, "comprar pão");
    await enter(campo);
    expect(chamou("captura.lancar")).toHaveLength(0);

    await act(async () => pendentes[1]!.resolver(previaDe("comprar pão", { titulo: "Comprar pão" })));
    await act(async () =>
      pendentes[0]!.resolver(previaDe("comprar pã", { titulo: "Comprar pã", hora: "09:00" })),
    );
    expect(recipiente.querySelector(".frase-previa")?.textContent).toBe("Entendi:tarefa");
    await enter(campo);
    expect(chamou("captura.lancar")).toEqual([
      { texto: "comprar pão", tipo: "tarefa", campos: expect.objectContaining({ titulo: "Comprar pão" }) },
    ]);
  });

  it("só depois de uma pausa na digitação a prévia pode chamar o modelo da Alba", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(AGORA);
    await abrir("tarefas");
    const campo = recipiente.querySelector<HTMLInputElement>(".frase input")!;
    await digitar(campo, "vacina");
    await act(async () => vi.advanceTimersByTime(800));
    await digitar(campo, "vacina do gato");
    await act(async () => vi.advanceTimersByTime(1499));
    expect(chamou("captura.entender")).toEqual([{ texto: "vacina" }, { texto: "vacina do gato" }]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(chamou("captura.entender")).toContainEqual({ texto: "vacina do gato", comModelo: true });
    expect(chamou("captura.entender")).not.toContainEqual({ texto: "vacina", comModelo: true });
  });

  it("gasto ainda não chega: a prévia diz isso e oferece lançar como outro tipo", async () => {
    servidor.entender = async ({ texto }) => ({
      ...previaDe(texto, { titulo: "Mercado", valorCentavos: 4500 }),
      tipo: "gasto",
      alternativas: ["tarefa", "nota"],
      aviso: "Gastos chegam com a Tula. Quer guardar como tarefa ou nota?",
    });
    await abrir("tarefas");
    const campo = recipiente.querySelector<HTMLInputElement>(".frase input")!;
    await digitar(campo, "45 de mercado");
    await enter(campo);
    expect(chamou("captura.lancar")).toHaveLength(0);
    expect(recipiente.querySelector(".frase-aviso p")?.textContent).toBe(
      "Gastos chegam com a Tula. Quer guardar como tarefa ou nota?",
    );
    await act(async () => botaoCom(recipiente, "Lançar como nota").click());
    expect(chamou("captura.lancar")).toEqual([
      { texto: "45 de mercado", tipo: "nota", campos: expect.objectContaining({ titulo: "Mercado" }) },
    ]);
  });
});

describe("tour: a parada 2 sobre o painel Hoje (TutorialTour.dc.html)", () => {
  it("o anel vai do alto do cartão ao fim do primeiro bloco do corpo, com a bolha logo abaixo", async () => {
    servidor.foco = RODANDO;
    // Sem layout no happy-dom: o cartão ocupa a janela, e o primeiro bloco do corpo acaba em 200.
    const caixa = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
    const medida = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains("painel-cartao")) return caixa(12, 12, 400, 888);
      const pai = this.parentElement;
      if (pai?.classList.contains("painel-corpo") && pai.firstElementChild === this)
        return caixa(30, 80, 364, 120);
      if (this.classList.contains("painel-corpo")) return caixa(30, 80, 364, 820);
      return caixa(0, 0, 0, 0);
    });
    try {
      await abrir("hoje");
      expect(recipiente.querySelector(".painel-corpo")!.firstElementChild).toBeTruthy();
      await act(async () => eventosCasca.get("tour:parada")?.({ payload: 2 }));
      await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      const anel = recipiente.querySelector<HTMLElement>(".tour-anel")!;
      expect([anel.style.left, anel.style.top, anel.style.width, anel.style.height]).toEqual([
        "12px",
        "12px",
        "400px",
        "188px",
      ]);
      const bolha = recipiente.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(bolha.getAttribute("aria-label")).toBe("Tour, 2 de 4");
      expect(bolha.style.top).toBe("200px");
      // O Hoje de verdade fica sob o véu, fora do clique.
      expect(recipiente.querySelector<HTMLElement>(".painel-cartao")!.inert).toBe(true);
    } finally {
      medida.mockRestore();
    }
  });
});
