// @vitest-environment happy-dom
import {
  CONFIG_PADRAO,
  type ApresentacaoRotina,
  type Config,
  type EstadoFoco,
  type ItemGithub,
  type MudancaConfig,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcoesSistemaContexto } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { tarefa } from "../../teste/dia.ts";
import { Inicio } from "./Inicio.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * O Início com o serviço de mentira: a configuração (com os blocos), o briefing, as tarefas, o
 * foco, o GitHub e as sessões. O relógio fica em quinta, 8 de outubro de 2026, 14:32 em São Paulo.
 * "Reiniciar" é montar de novo com o que o serviço guardou.
 */
const AGORA = new Date("2026-10-08T17:32:00.000Z");

const RODANDO: EstadoFoco = {
  etapa: {
    id: "e1",
    tipo: "foco",
    tarefaId: "t1",
    inicio: "2026-10-08T17:25:42.000Z",
    terminaEm: "2026-10-08T17:50:42.000Z",
    pausadaEm: null,
    fim: null,
    duracaoPlanejadaMin: 25,
    duracaoRealMin: null,
    interrompida: false,
  },
  tarefaTitulo: "Revisar PR do relatório mensal",
  cicloAtual: 2,
  ciclosAtePausaLonga: 4,
  proxima: "pausa",
  focoHojeMin: 75,
  ciclosHoje: 1,
  podeEstender: true,
};

const BRIEFING: ApresentacaoRotina = {
  id: "r1",
  rotinaId: "briefing",
  tipo: "briefing",
  dia: "2026-10-08",
  abertura: "Dois PRs esperam seu review desde ontem e a fatura do cartão vence quinta.",
  daExecucaoId: null,
  linhas: [],
  abertas: [],
  acao: null,
  acaoEm: null,
  criadoEm: "2026-10-08T11:00:00.000Z",
};

const PR: ItemGithub = {
  id: "g1",
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
};

const servidor = {
  config: CONFIG_PADRAO as Config,
  recusarConfig: false,
  /** O briefing de hoje, nenhum ainda, ou o pedido recusado (`rotinas.hoje` ainda sem atendente). */
  briefing: BRIEFING as ApresentacaoRotina | null | "recusa",
};
const definicoes: MudancaConfig[] = [];

const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const pedir = vi.fn(async (metodo: string, dados?: unknown): Promise<unknown> => {
  const estado = () => ({
    config: { ...servidor.config, dia: { ...servidor.config.dia, fuso: "America/Sao_Paulo" } },
    portable: false,
    falhasAtalhos: {},
  });
  switch (metodo) {
    case "config.obter":
      return estado();
    case "config.definir":
      definicoes.push(dados as MudancaConfig);
      if (servidor.recusarConfig) throw new Error("recusado");
      servidor.config = { ...servidor.config, ...(dados as MudancaConfig) };
      return estado();
    case "rotinas.hoje":
      if (servidor.briefing === "recusa") throw new Error("rotinas.hoje ainda não está disponível");
      return { briefing: servidor.briefing, fechamento: null, diaEncerrado: false };
    case "listas.listar":
      return [{ id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false }];
    case "tarefas.listar": {
      const { vista } = dados as { vista: string };
      if (vista === "hoje") {
        return [
          tarefa("t1", { titulo: "Ligar para o contador", hora: "15:00" }),
          tarefa("t2", { titulo: "Daily", estado: "feita", concluidaEm: "2026-10-08T12:30:00.000Z" }),
        ];
      }
      return [];
    }
    case "foco.obter":
      return RODANDO;
    case "github.obter":
      return { itens: [PR], atualizadoEm: "2026-10-08T17:30:00.000Z" };
    case "conexoes.listar":
      return [
        { tipo: "github", estado: "ligada", conta: "gustavo", ultimoErro: null, conectadaEm: null },
        { tipo: "hooks-claude-code", estado: "ligada", conta: null, ultimoErro: null, conectadaEm: null },
      ];
    case "sessoes.listar":
      return {
        projetos: [
          { id: "p1", nome: "moductus", caminho: "V:\\moductus", repositorio: null, arquivado: false },
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
    case "sessoes.uso":
      return [];
  }
  throw new Error(`método ${metodo} sem atendente`);
});

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: unknown) => pedir(metodo, dados),
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
      ouvintes.get(nome)!.add(fn);
      return () => ouvintes.get(nome)?.delete(fn);
    },
  },
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

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
        <Inicio />
      </AcoesSistemaContexto.Provider>,
    ),
  );
  // As leituras dos blocos chegam em seguida à da configuração.
  await act(async () => undefined);
}

function desmontar() {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  servidor.config = CONFIG_PADRAO;
  servidor.recusarConfig = false;
  servidor.briefing = BRIEFING;
  definicoes.length = 0;
  ouvintes.clear();
  ir.mockClear();
});
afterEach(() => {
  desmontar();
  vi.useRealTimers();
});

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (nome: string) =>
  todos("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent) === nome) ?? null;
const blocos = () => todos("[data-bloco]").map((b) => b.dataset.bloco);
const editaveis = () => todos(".inicio-editar-bloco").map((b) => b.getAttribute("aria-label"));
const escondidosNaTela = () => todos(".inicio-escondido .inicio-editar-nome").map((n) => n.textContent);
const clicar = async (nome: string) => {
  const b = botao(nome);
  expect(b, `botão ${nome}`).not.toBeNull();
  await act(async () => b!.click());
};

describe("Início", () => {
  it("mostra os blocos do quadro com o que o serviço disse, na ordem do Sistema.dc.html", async () => {
    await montar();
    expect(blocos()).toEqual(["briefing", "tarefas", "foco", "financas", "dev", "sessoes"]);
    // O briefing, as tarefas com a contagem, o foco rodando, o vazio honesto e as listas.
    expect(por('[data-bloco="briefing"]')!.textContent).toContain(BRIEFING.abertura);
    const tarefas = por('[data-bloco="tarefas"]')!;
    expect(tarefas.textContent).toContain("1 de 2");
    expect(tarefas.textContent).toContain("Ligar para o contador");
    const foco = por('[data-bloco="foco"]')!;
    expect(foco.querySelector('[role="timer"]')!.textContent).toBe("18:42");
    expect(foco.textContent).toContain("1h15 hoje");
    expect(foco.textContent).toContain("Revisar PR do relatório mensal");
    expect(por('[data-bloco="financas"]')!.textContent).toContain("chega com Finanças");
    expect(por('[data-bloco="dev"]')!.textContent).toContain("api-pedidos #412");
    expect(por('[data-bloco="sessoes"]')!.textContent).toContain("Claude Code · moductus");
    expect(por('[data-bloco="sessoes"]')!.textContent).toContain("esperando você");
    // Tarefas na primeira coluna; Foco e Finanças na segunda; Dev e Sessões na terceira.
    expect(
      todos(".inicio-coluna").map((c) => [...c.children].map((b) => (b as HTMLElement).dataset.bloco)),
    ).toEqual([["tarefas"], ["foco", "financas"], ["dev", "sessoes"]]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("blocos escondidos ficam escondidos depois de reiniciar", async () => {
    await montar();
    await clicar("Editar blocos");
    await clicar("Esconder Finanças");
    await clicar("Esconder Dev");
    await clicar("Concluir");
    expect(blocos()).toEqual(["briefing", "tarefas", "foco", "sessoes"]);
    // Cada mudança foi ao serviço na hora, como configuração.
    expect(definicoes.at(-1)).toEqual({
      inicio: { ordem: CONFIG_PADRAO.inicio.ordem, escondidos: ["financas", "dev"] },
    });

    desmontar();
    await montar();
    expect(blocos()).toEqual(["briefing", "tarefas", "foco", "sessoes"]);
    await clicar("Editar blocos");
    expect(escondidosNaTela()).toEqual(["Finanças", "Dev"]);
  });

  it("editar: cartões com a posição, Escondidos com Mostrar, e a linha de status diz o que mudou", async () => {
    servidor.config = { ...CONFIG_PADRAO, inicio: { ...CONFIG_PADRAO.inicio, escondidos: ["financas"] } };
    await montar();
    await clicar("Editar blocos");
    expect(por(".pagina-cabecalho")!.textContent).toContain("editando os blocos");
    expect(editaveis()).toEqual([
      "Bloco Briefing da Alba",
      "Bloco Tarefas de hoje",
      "Bloco Foco",
      "Bloco Dev",
      "Bloco Sessões de IA",
    ]);
    expect(por('[aria-label="Bloco Foco"]')!.textContent).toContain("3 de 5");
    expect(botao("Mover Briefing da Alba para cima")!.disabled).toBe(true);
    expect(botao("Mover Sessões de IA para baixo")!.disabled).toBe(true);
    expect(por('[aria-label="Blocos escondidos"]')!.textContent).toContain("Escondidos · 1");
    expect(por('[aria-label="Blocos escondidos"]')!.dataset.colunas).toBe("2");
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Mover Foco para baixo");
    expect(editaveis()[3]).toBe("Bloco Foco");
    expect(por(".inicio-status")!.textContent).toBe(
      "Foco agora é o 4º de 5 blocos. Cada mudança vale na hora.",
    );

    await clicar("Mostrar Finanças");
    expect(escondidosNaTela()).toEqual([]);
    expect(por(".inicio-status")!.textContent).toContain("Finanças voltou como o");
    expect(definicoes.at(-1)!.inicio!.escondidos).toEqual([]);
  });

  it("Alt ↑ e Alt ↓ movem o bloco selecionado, que continua com o foco", async () => {
    await montar();
    await clicar("Editar blocos");
    const foco = por('[aria-label="Bloco Foco"]')!;
    act(() => foco.focus());
    expect(foco.dataset.selecionado).toBe("true");
    await act(async () => {
      foco.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
    });
    expect(editaveis().indexOf("Bloco Foco")).toBe(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Bloco Foco");
    expect(definicoes.at(-1)!.inicio!.ordem.slice(0, 3)).toEqual(["briefing", "foco", "tarefas"]);
    // Sem o Alt, a seta não mexe em nada.
    await act(async () => {
      foco.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(editaveis().indexOf("Bloco Foco")).toBe(1);
  });

  it("Voltar ao padrão desfaz tudo; Esc conclui e devolve o foco ao Editar blocos", async () => {
    servidor.config = {
      ...CONFIG_PADRAO,
      inicio: { ordem: ["sessoes", "dev", "briefing", "tarefas", "foco", "financas"], escondidos: ["foco"] },
    };
    await montar();
    expect(blocos()).toEqual(["sessoes", "dev", "briefing", "tarefas", "financas"]);
    await clicar("Editar blocos");
    await clicar("Voltar ao padrão");
    expect(definicoes.at(-1)).toEqual({ inicio: CONFIG_PADRAO.inicio });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(por(".inicio-grade")).toBeNull();
    expect(blocos()).toEqual(["briefing", "tarefas", "foco", "financas", "dev", "sessoes"]);
    expect(document.activeElement).toBe(botao("Editar blocos"));
  });

  it("o serviço recusa a mudança: a tela volta ao que está gravado e diz que não guardou", async () => {
    await montar();
    await clicar("Editar blocos");
    servidor.recusarConfig = true;
    await clicar("Esconder Foco");
    expect(editaveis()).toContain("Bloco Foco");
    expect(por('[role="alert"]')!.textContent).toContain("Não consegui guardar a mudança");
  });

  it("Nova tarefa vai à frase do bloco; com o bloco escondido, abre Tarefas", async () => {
    await montar();
    await clicar("Nova tarefa");
    expect(document.activeElement).toBe(por('[data-bloco="tarefas"] input'));
    expect(ir).not.toHaveBeenCalled();

    servidor.config = { ...CONFIG_PADRAO, inicio: { ...CONFIG_PADRAO.inicio, escondidos: ["tarefas"] } };
    desmontar();
    await montar();
    await clicar("Nova tarefa");
    expect(ir).toHaveBeenCalledWith({ area: "tarefas" });
  });

  it("sem briefing hoje, o bloco diz quando ele chega, e o aviso do serviço o traz", async () => {
    servidor.briefing = null;
    await montar();
    const briefing = por('[data-bloco="briefing"]')!;
    expect(briefing.textContent).toContain("O briefing da manhã aparece aqui quando a Alba abrir o dia.");
    expect(briefing.querySelector('[role="alert"], button')).toBeNull();
    await act(async () => ouvintes.get("rotinas.apareceu")!.forEach((fn) => fn(BRIEFING)));
    expect(briefing.textContent).toContain(BRIEFING.abertura);
  });

  it("briefing que o serviço não leu diz isso, separado do vazio, e Tentar de novo lê outra vez", async () => {
    servidor.briefing = "recusa";
    await montar();
    const briefing = por('[data-bloco="briefing"]')!;
    expect(briefing.textContent).toContain("Não consegui ler o briefing agora.");
    expect(briefing.textContent).not.toContain("aparece aqui quando a Alba abrir o dia");
    servidor.briefing = BRIEFING;
    await act(async () => briefing.querySelector("button")!.click());
    expect(briefing.textContent).toContain(BRIEFING.abertura);
    expect(briefing.querySelector("button")).toBeNull();
  });

  it("Mover devolve o foco ao botão clicado; se ele desabilitou na ponta, ao cartão", async () => {
    await montar();
    await clicar("Editar blocos");
    await clicar("Mover Dev para baixo");
    expect(editaveis().indexOf("Bloco Dev")).toBe(5);
    // Dev ficou por último: o "para baixo" desabilitou e o foco ficou no cartão.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Bloco Dev");
    await clicar("Mover Dev para cima");
    expect(editaveis().indexOf("Bloco Dev")).toBe(4);
    expect(document.activeElement).toBe(botao("Mover Dev para cima"));
  });

  it("esconder o último bloco que aparece leva o foco ao Mostrar dele", async () => {
    servidor.config = {
      ...CONFIG_PADRAO,
      inicio: { ...CONFIG_PADRAO.inicio, escondidos: ["briefing", "tarefas", "foco", "financas", "dev"] },
    };
    await montar();
    await clicar("Editar blocos");
    expect(editaveis()).toEqual(["Bloco Sessões de IA"]);
    await clicar("Esconder Sessões de IA");
    expect(editaveis()).toEqual([]);
    expect(document.activeElement).toBe(botao("Mostrar Sessões de IA"));
  });

  it("a recusa de uma edição não fica para a próxima: Editar blocos começa sem o erro", async () => {
    await montar();
    await clicar("Editar blocos");
    servidor.recusarConfig = true;
    await clicar("Esconder Foco");
    expect(por(".inicio-status")!.textContent).toContain("Não consegui guardar a mudança");
    await clicar("Concluir");
    servidor.recusarConfig = false;
    await clicar("Editar blocos");
    expect(por('[role="alert"]')).toBeNull();
    expect(por(".inicio-status")!.textContent).toBe("Cada mudança vale na hora.");
  });
});
