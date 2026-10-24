// @vitest-environment happy-dom
import {
  DIA_ENCERRADO,
  PERGUNTA_DOS_IGNORADOS,
  type ApresentacaoRotina,
  type LembretesDeHoje,
  type PerguntaDosIgnorados,
  type RotinasDeHoje,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { tarefa } from "../../teste/dia.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * O briefing da manhã e o fechamento do dia no painel Hoje. A casca abre o painel pelo evento
 * `painel:area`; o canal é um serviço de mentira que responde as rotinas de hoje, grava as ações
 * (`rotinas.agir`, `rotinas.responder`) e as das tarefas, e deixa disparar `rotinas.apareceu`. O
 * relógio fica parado em quinta, 8 de outubro de 2026, 14:32 em São Paulo.
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
const ACAO_EM = AGORA.toISOString();

const SEM_LEMBRETE: LembretesDeHoje = { chegando: null, tocando: [], atrasados: [], ausencia: null };

const COMPROVANTES = tarefa("t1", { titulo: "Separar comprovantes do mês", venceEm: "2026-10-08" });
const CONTADOR = tarefa("t2", { titulo: "Ligar para o contador", venceEm: "2026-10-07" });
const RELATORIO = tarefa("t3", { titulo: "PR do relatório mensal", venceEm: "2026-10-07" });

const BRIEFING: ApresentacaoRotina = {
  id: "rb1",
  rotinaId: "briefing",
  tipo: "briefing",
  dia: "2026-10-08",
  abertura: "Bom dia. Hoje: 3 reuniões, 3 tarefas.",
  daExecucaoId: null,
  linhas: [
    {
      agenteId: "alba",
      rotulo: null,
      texto: "3 reuniões, a próxima às 10:00. Prioridades: PR do relatório mensal.",
      tarefaIds: ["t3"],
    },
    { agenteId: "alba", rotulo: "Ontem", texto: "2 ficaram abertas.", tarefaIds: ["t2", "t3"] },
    { agenteId: "nuno", rotulo: null, texto: "2 PRs esperam seu review.", tarefaIds: [] },
  ],
  abertas: [],
  acao: null,
  acaoEm: null,
  criadoEm: "2026-10-08T11:12:00.000Z",
};

const FECHAMENTO: ApresentacaoRotina = {
  id: "rf1",
  rotinaId: "fechamento",
  tipo: "fechamento",
  dia: "2026-10-08",
  abertura: "Hora de parar: 5 feitas, 2h10 de foco. 2 ficaram abertas.",
  daExecucaoId: null,
  linhas: [
    { agenteId: "alba", rotulo: null, texto: "5 feitas · 2h10 de foco", tarefaIds: [] },
    {
      agenteId: "alba",
      rotulo: "Amanhã",
      texto: "Daily às 09:30, e a prioridade é PR do relatório mensal.",
      tarefaIds: ["t3"],
    },
    { agenteId: "nuno", rotulo: null, texto: "1 sessão aberta.", tarefaIds: [] },
  ],
  abertas: [COMPROVANTES, CONTADOR],
  acao: null,
  acaoEm: null,
  criadoEm: "2026-10-08T21:00:00.000Z",
};

const PERGUNTA: PerguntaDosIgnorados = {
  agenteId: "alba",
  dia: "2026-10-08",
  texto: PERGUNTA_DOS_IGNORADOS,
  respostas: ["curto", "desligar", "manter"],
};

const servidor: {
  rotinas: RotinasDeHoje | "recusa";
  hoje: Tarefa[];
  atrasadas: Tarefa[];
  agir: "ok" | "recusa" | "falha";
} = {
  rotinas: { briefing: null, fechamento: null, diaEncerrado: false, pergunta: null },
  hoje: [],
  atrasadas: [],
  agir: "ok",
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
    case "rotinas.hoje":
      if (servidor.rotinas === "recusa") throw new Error("rotinas.hoje ainda não está disponível");
      return servidor.rotinas;
    case "rotinas.agir": {
      if (servidor.agir === "recusa")
        throw new RecusaDoServico("Esse briefing ou fechamento não existe mais.");
      if (servidor.agir === "falha") throw new Error("SQLITE_BUSY: database is locked");
      const { id, acao } = dados as { id: string; acao: ApresentacaoRotina["acao"] };
      const atual = [BRIEFING, FECHAMENTO].find((r) => r.id === id)!;
      return { ...atual, acao, acaoEm: ACAO_EM };
    }
    case "rotinas.responder":
      return {
        id: "briefing",
        tipo: "briefing",
        hora: null,
        diasSemana: [1, 2, 3, 4, 5],
        ativa: true,
        curta: true,
      };
    case "listas.listar":
      return [];
    case "tarefas.listar": {
      const { vista } = dados as { vista: string };
      if (vista === "hoje") return servidor.hoje;
      if (vista === "atrasadas") return servidor.atrasadas;
      return [];
    }
    case "lembretes.hoje":
      return SEM_LEMBRETE;
    case "foco.obter":
      throw new Error("sem foco");
    case "aprovacoes.pendentes":
      return [];
    case "sessoes.listar":
      return { projetos: [], sessoes: [] };
    case "tarefas.adiar":
    case "tarefas.cancelar":
    case "tarefas.reabrir":
    case "tarefas.definir":
      return [];
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
  servidor.rotinas = { briefing: null, fechamento: null, diaEncerrado: false, pergunta: null };
  servidor.hoje = [];
  servidor.atrasadas = [];
  servidor.agir = "ok";
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

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Painel />));
}

async function abrirHoje() {
  await act(async () => eventosCasca.get("painel:area")?.({ payload: "hoje" }));
}

async function abrir() {
  await montar();
  await abrirHoje();
}

async function avisar(evento: string, dados: unknown) {
  await act(async () => ouvintes.get(evento)?.forEach((fn) => fn(dados)));
}

const botao = (texto: string, dentro: ParentNode = recipiente) =>
  [...dentro.querySelectorAll("button")].find((b) => b.textContent === texto) ?? null;
const clicar = (texto: string, dentro?: ParentNode) =>
  act(async () => {
    const b = botao(texto, dentro);
    if (!b) throw new Error(`sem o botão ${texto}`);
    b.click();
  });
const titulo = () => recipiente.querySelector("h1")?.textContent;
const chamou = (metodo: string) => pedir.mock.calls.filter(([m]) => m === metodo).map(([, d]) => d);
const casca = (comando: string) => chamadasCasca.filter((c) => c.comando === comando);
const nomes = () => [...recipiente.querySelectorAll(".rotina-nome")].map((n) => n.textContent);
const abertas = () => [...recipiente.querySelectorAll(".rotina-aberta-titulo")].map((t) => t.textContent);
const aberta = (nome: string) =>
  [...recipiente.querySelectorAll<HTMLElement>(".rotina-aberta")].find(
    (li) => li.querySelector(".rotina-aberta-titulo")?.textContent === nome,
  )!;

async function digitar(campo: HTMLInputElement, texto: string) {
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tecla = (campo: HTMLElement, key: string) =>
  act(async () => {
    campo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

describe("briefing da manhã", () => {
  beforeEach(() => {
    servidor.rotinas = { briefing: BRIEFING, fechamento: null, diaEncerrado: false, pergunta: null };
    servidor.atrasadas = [CONTADOR, RELATORIO];
  });

  it("sem ação, ocupa o painel Hoje com as linhas, cada uma com quem fala, e as ações", async () => {
    await abrir();
    expect(titulo()).toBe("Bom dia");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("Quinta, 8 de outubro · 14:32");
    expect(nomes()).toEqual(["Alba · o dia", "Alba · ontem", "Nuno"]);
    expect([...recipiente.querySelectorAll(".rotina-texto")].map((t) => t.textContent)).toEqual(
      BRIEFING.linhas.map((l) => l.texto),
    );
    // Só o Ontem tem [Trazer para hoje] [Revisar]; embaixo, [Ajustar plano] [Começar o dia].
    expect(recipiente.querySelectorAll(".rotina-linha")[1]!.querySelectorAll("button")).toHaveLength(2);
    expect(recipiente.querySelectorAll(".rotina-linha")[0]!.querySelectorAll("button")).toHaveLength(0);
    expect([...recipiente.querySelectorAll(".rotina-acoes button")].map((b) => b.textContent)).toEqual([
      "Ajustar plano",
      "Começar o dia",
    ]);
    expect(botao("Fechar")?.getAttribute("aria-label")).toBe("Fechar o briefing");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Trazer para hoje leva para hoje só as que continuam atrasadas", async () => {
    servidor.atrasadas = [CONTADOR, { ...RELATORIO, estado: "feita" }];
    await abrir();
    await clicar("Trazer para hoje");
    expect(chamou("tarefas.adiar")).toEqual([{ ids: ["t2"], para: "hoje" }]);
    expect(recipiente.querySelector('[role="status"].rotina-feito')?.textContent).toBe("Vieram para hoje.");
    expect(botao("Trazer para hoje")).toBeNull();
    // O briefing segue esperando resposta: trazer não é responder.
    expect(chamou("rotinas.agir")).toEqual([]);
    expect(titulo()).toBe("Bom dia");
  });

  it("sem nenhuma ainda atrasada, o Ontem fica sem ações", async () => {
    servidor.atrasadas = [];
    await abrir();
    expect(botao("Trazer para hoje")).toBeNull();
    expect(botao("Revisar")).toBeNull();
  });

  it("Começar o dia grava a ação e o painel volta ao Hoje", async () => {
    await abrir();
    await clicar("Começar o dia");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rb1", acao: "comecar" }]);
    expect(titulo()).toBe("Hoje");
    expect(casca("painel_fechar")).toEqual([]);
  });

  it("Fechar grava o fechar e fecha o painel; Ajustar plano e Revisar abrem as Tarefas", async () => {
    await abrir();
    await clicar("Fechar");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rb1", acao: "fechar" }]);
    expect(casca("painel_fechar")).toHaveLength(1);

    // De novo do zero: o servidor ainda diz que o briefing espera resposta.
    act(() => raiz?.unmount());
    pedir.mockClear();
    chamadasCasca.length = 0;
    await abrir();
    await clicar("Ajustar plano");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rb1", acao: "ajustar" }]);
    expect(casca("sistema_abrir")).toEqual([{ comando: "sistema_abrir", args: { area: "tarefas" } }]);

    act(() => raiz?.unmount());
    pedir.mockClear();
    chamadasCasca.length = 0;
    await abrir();
    await clicar("Revisar");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rb1", acao: "ajustar" }]);
    expect(casca("sistema_abrir")).toHaveLength(1);
  });

  it("a ação recusada aparece como o serviço escreveu; a falha interna, sem o texto cru", async () => {
    servidor.agir = "recusa";
    await abrir();
    await clicar("Começar o dia");
    expect(recipiente.querySelector('[role="alert"]')?.textContent).toBe(
      "Esse briefing ou fechamento não existe mais.",
    );
    expect(titulo()).toBe("Bom dia");
    servidor.agir = "falha";
    await clicar("Começar o dia");
    const erro = recipiente.querySelector('[role="alert"]')?.textContent ?? "";
    expect(erro).toBe("Não consegui registrar agora. Tente de novo.");
    expect(erro).not.toContain("SQLITE");
  });

  it("a pergunta dos 3 ignorados é a fala da Alba com três respostas", async () => {
    servidor.rotinas = { briefing: BRIEFING, fechamento: null, diaEncerrado: false, pergunta: PERGUNTA };
    await abrir();
    const fala = [...recipiente.querySelectorAll<HTMLElement>(".fala")].find(
      (f) => f.querySelector(".fala-texto")?.textContent === PERGUNTA_DOS_IGNORADOS,
    )!;
    expect(fala.querySelector(".fala-nome")?.textContent).toBe("Alba");
    expect([...fala.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Mais curto",
      "Desligar",
      "Deixar como está",
    ]);
    expect(auditar(recipiente)).toEqual([]);
    await clicar("Mais curto", fala);
    expect(chamou("rotinas.responder")).toEqual([{ resposta: "curto" }]);
    expect(recipiente.textContent).not.toContain(PERGUNTA_DOS_IGNORADOS);
    // Responder não é começar o dia: o briefing continua no painel.
    expect(titulo()).toBe("Bom dia");
  });

  it("rotinas.mudou relê as rotinas de hoje, e a pergunta que já não vale some", async () => {
    servidor.rotinas = { briefing: BRIEFING, fechamento: null, diaEncerrado: false, pergunta: PERGUNTA };
    await abrir();
    expect(recipiente.textContent).toContain(PERGUNTA_DOS_IGNORADOS);
    const lidas = chamou("rotinas.hoje").length;
    servidor.rotinas = { briefing: BRIEFING, fechamento: null, diaEncerrado: false, pergunta: null };
    await avisar("rotinas.mudou", []);
    expect(chamou("rotinas.hoje")).toHaveLength(lidas + 1);
    expect(recipiente.textContent).not.toContain(PERGUNTA_DOS_IGNORADOS);
    expect(titulo()).toBe("Bom dia");
  });

  it("o briefing que aparece com o Hoje aberto toma o painel", async () => {
    servidor.rotinas = { briefing: null, fechamento: null, diaEncerrado: false, pergunta: null };
    await abrir();
    expect(titulo()).toBe("Hoje");
    await avisar("rotinas.apareceu", BRIEFING);
    expect(titulo()).toBe("Bom dia");
  });

  it("sem linha nenhuma, a abertura da Alba é o briefing", async () => {
    servidor.rotinas = {
      briefing: { ...BRIEFING, linhas: [], abertura: "Bom dia. Nada marcado para hoje." },
      fechamento: null,
      diaEncerrado: false,
      pergunta: null,
    };
    await abrir();
    expect(recipiente.querySelector(".fala-texto")?.textContent).toBe("Bom dia. Nada marcado para hoje.");
  });

  it("respondido, ignorado ou sem as rotinas lidas, o painel é o Hoje", async () => {
    for (const rotinas of [
      {
        briefing: { ...BRIEFING, acao: "comecar", acaoEm: ACAO_EM },
        fechamento: null,
        diaEncerrado: false,
        pergunta: null,
      },
      {
        briefing: { ...BRIEFING, acao: "ignorado", acaoEm: ACAO_EM },
        fechamento: null,
        diaEncerrado: false,
        pergunta: null,
      },
      "recusa",
    ] as const) {
      servidor.rotinas = rotinas as RotinasDeHoje | "recusa";
      await abrir();
      expect(titulo()).toBe("Hoje");
      act(() => raiz?.unmount());
      raiz = null;
    }
  });
});

describe("fechamento do dia", () => {
  beforeEach(() => {
    servidor.rotinas = { briefing: BRIEFING, fechamento: FECHAMENTO, diaEncerrado: false, pergunta: null };
    servidor.hoje = [COMPROVANTES];
    servidor.atrasadas = [CONTADOR];
  });

  it("vem antes do briefing sem ação, com o feito, o Ficou aberto, amanhã e os outros", async () => {
    await abrir();
    expect(titulo()).toBe("Fechamento do dia");
    expect(recipiente.querySelector(".painel-subtitulo")?.textContent).toBe("Quinta · 14:32 · uns 2 minutos");
    expect(recipiente.querySelector(".rotina-meta")?.textContent).toBe("5 feitas · 2h10 de foco");
    expect(abertas()).toEqual(["Separar comprovantes do mês", "Ligar para o contador"]);
    expect([...aberta("Ligar para o contador").querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      ["Amanhã", "Outra data", "Descartar"],
    );
    expect(recipiente.textContent).toContain(
      "Amanhã: Daily às 09:30, e a prioridade é PR do relatório mensal.",
    );
    expect(nomes()).toEqual(["Alba", "Nuno"]);
    expect(botao("Encerrar o dia")).not.toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Amanhã adia a tarefa, ela sai do Ficou aberto e o Desfazer devolve o dia que ela tinha", async () => {
    await abrir();
    await clicar("Amanhã", aberta("Ligar para o contador"));
    expect(chamou("tarefas.adiar")).toEqual([{ ids: ["t2"], para: "amanha" }]);
    expect(abertas()).toEqual(["Separar comprovantes do mês"]);
    expect(recipiente.querySelector(".dia-desfazer-texto")?.textContent).toBe(
      "Ligar para o contador: vai para amanhã.",
    );
    await clicar("Desfazer");
    expect(chamou("tarefas.adiar")[1]).toEqual({ ids: ["t2"], para: "2026-10-07" });
    expect(abertas()).toEqual(["Separar comprovantes do mês", "Ligar para o contador"]);
  });

  it("Outra data abre o campo do dia; Enter move para o dia escolhido e Esc volta aos botões", async () => {
    await abrir();
    const item = aberta("Separar comprovantes do mês");
    await clicar("Outra data", item);
    const campo = item.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(campo.min).toBe("2026-10-09");
    await tecla(campo, "Escape");
    expect(item.querySelector('input[type="date"]')).toBeNull();
    // Esc do campo não fecha o painel.
    expect(casca("painel_fechar")).toEqual([]);

    await clicar("Outra data", item);
    const deNovo = item.querySelector<HTMLInputElement>('input[type="date"]')!;
    await digitar(deNovo, "2026-10-12");
    await tecla(deNovo, "Enter");
    expect(chamou("tarefas.adiar")).toEqual([{ ids: ["t1"], para: "2026-10-12" }]);
    expect(recipiente.querySelector(".dia-desfazer-texto")?.textContent).toBe(
      "Separar comprovantes do mês: vai para seg, 12 out.",
    );
    expect(abertas()).toEqual(["Ligar para o contador"]);
  });

  it("pelo teclado: fechar o Outra data devolve o foco ao botão que o abriu", async () => {
    await abrir();
    const item = aberta("Separar comprovantes do mês");
    await clicar("Outra data", item);
    expect(document.activeElement).toBe(item.querySelector('input[type="date"]'));
    await tecla(item.querySelector<HTMLInputElement>('input[type="date"]')!, "Escape");
    expect(document.activeElement).toBe(botao("Outra data", item));
    await clicar("Outra data", item);
    await clicar("Cancelar", item);
    expect(document.activeElement).toBe(botao("Outra data", item));
  });

  it("pelo teclado: a tarefa resolvida leva o foco ao Desfazer, e desfeita, de volta à tarefa", async () => {
    await abrir();
    botao("Amanhã", aberta("Ligar para o contador"))!.focus();
    await clicar("Amanhã", aberta("Ligar para o contador"));
    expect(document.activeElement).toBe(botao("Desfazer"));
    await clicar("Desfazer");
    expect(document.activeElement).toBe(botao("Amanhã", aberta("Ligar para o contador")));

    await clicar("Descartar", aberta("Separar comprovantes do mês"));
    expect(document.activeElement).toBe(botao("Desfazer"));
  });

  it("Descartar cancela a tarefa, e o Desfazer reabre", async () => {
    await abrir();
    await clicar("Descartar", aberta("Separar comprovantes do mês"));
    expect(chamou("tarefas.cancelar")).toEqual([{ id: "t1" }]);
    expect(recipiente.querySelector(".dia-desfazer-texto")?.textContent).toBe(
      "Separar comprovantes do mês: descartada.",
    );
    await clicar("Desfazer");
    expect(chamou("tarefas.reabrir")).toEqual([{ id: "t1" }]);
  });

  it("a tarefa resolvida por outro caminho some do Ficou aberto na próxima leitura", async () => {
    servidor.atrasadas = [];
    await abrir();
    expect(abertas()).toEqual(["Separar comprovantes do mês"]);
  });

  it("Adiar 30 min grava o adiar e fecha o painel", async () => {
    await abrir();
    await clicar("Adiar 30 min");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rf1", acao: "adiar" }]);
    expect(casca("painel_fechar")).toHaveLength(1);
  });

  it("Encerrar o dia grava, a Alba responde Dia encerrado. e o painel aberto de novo é o Hoje", async () => {
    servidor.rotinas = { briefing: null, fechamento: FECHAMENTO, diaEncerrado: false, pergunta: null };
    await abrir();
    await clicar("Encerrar o dia");
    expect(chamou("rotinas.agir")).toEqual([{ id: "rf1", acao: "encerrar" }]);
    const fala = recipiente.querySelector(".fala")!;
    expect(fala.querySelector(".fala-nome")?.textContent).toBe("Alba");
    expect(fala.querySelector(".fala-texto")?.textContent).toBe(DIA_ENCERRADO);
    expect(auditar(recipiente)).toEqual([]);

    servidor.rotinas = {
      briefing: null,
      fechamento: { ...FECHAMENTO, acao: "encerrar", acaoEm: ACAO_EM },
      diaEncerrado: true,
      pergunta: null,
    };
    await abrirHoje();
    expect(titulo()).toBe("Hoje");
  });

  it("Encerrar o dia com o briefing ainda sem resposta: o briefing não volta ao painel", async () => {
    await abrir();
    await clicar("Encerrar o dia");
    expect(recipiente.querySelector(".fala-texto")?.textContent).toBe(DIA_ENCERRADO);
    servidor.rotinas = {
      briefing: BRIEFING,
      fechamento: { ...FECHAMENTO, acao: "encerrar", acaoEm: ACAO_EM },
      diaEncerrado: true,
      pergunta: null,
    };
    await abrirHoje();
    expect(titulo()).toBe("Hoje");
    // Também só com o dia encerrado, sem o fechamento na leitura.
    servidor.rotinas = { briefing: BRIEFING, fechamento: null, diaEncerrado: true, pergunta: null };
    await abrirHoje();
    expect(titulo()).toBe("Hoje");
  });

  it("o fechamento que volta do adiar toma o painel de novo", async () => {
    await abrir();
    await clicar("Adiar 30 min");
    // Adiado, o painel é o Hoje: o briefing sem resposta da manhã já passou.
    expect(titulo()).toBe("Hoje");
    await avisar("rotinas.apareceu", FECHAMENTO);
    expect(titulo()).toBe("Fechamento do dia");
  });
});
