// @vitest-environment happy-dom
import type { Agente, Notificacao, SituacaoAgente } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * O time do dock seguindo o runtime. A casca responde como na fase 1 e o canal é trocado por um
 * serviço de mentira: `agentes.listar` responde o que o teste mandar e `agentes.mudou` é
 * disparado à mão.
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) => {
    if (comando === "servico_estado") return { estado: "pronto", porta: 1, token: "t" };
    if (comando === "dock_configuracao") return { lado: "esquerda", modo: "fixo", forma: "colada" };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const canal: {
  estado: EstadoConexao;
  lista: () => Promise<Agente[]>;
  naoVistas: () => Promise<Notificacao[]>;
} = {
  estado: "conectado",
  lista: async () => [],
  naoVistas: async () => [],
};
const ouvintes = new Map<string, Set<(dados: unknown) => void>>();

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => canal.estado,
  servico: {
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
      ouvintes.get(nome)!.add(fn);
      return () => ouvintes.get(nome)?.delete(fn);
    },
    pedir: vi.fn(async (metodo: string) => {
      if (metodo === "agentes.listar") return canal.lista();
      if (metodo === "notificacoes.naoVistas") return canal.naoVistas();
      if (metodo === "notificacoes.marcarVistas") return [];
      throw new Error(`método ${metodo} sem atendente`);
    }),
  },
}));

const { Dock, CONVITE_AGENTES } = await import("./Dock.tsx");
const { juntarSituacoes } = await import("../../servico/time.ts");
const { servico } = await import("../../servico/conexao.ts");

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

function agente(id: string, situacao: Partial<SituacaoAgente> = {}): Agente {
  return {
    id,
    nome: id,
    funcao: "função",
    instrucoes: "",
    personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
    ferramentas: [],
    provedorId: null,
    provedorReservaId: null,
    gatilhos: [],
    escoposMemoria: [],
    tetoDiarioCentavos: null,
    deFabrica: true,
    situacao: { ...ATIVO, ...situacao },
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Dock />));
}

/** Expressão e rótulo de cada cabeça do dock, na ordem do time. */
const cabecas = () =>
  [...recipiente.querySelectorAll<HTMLButtonElement>(".dock-agente")].map((b) => ({
    expressao: b.querySelector<SVGElement>(".personagem")!.dataset.estado,
    rotulo: b.getAttribute("aria-label"),
  }));

beforeEach(() => {
  ouvintes.clear();
  canal.estado = "conectado";
  canal.lista = async () => [];
  canal.naoVistas = async () => [];
  vi.mocked(servico.pedir).mockClear();
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

describe("time do dock ligado ao estado do serviço", () => {
  it("a lista do serviço desenha cada um no seu estado, com o status no rótulo", async () => {
    canal.lista = async () => [
      agente("alba"),
      agente("tula", { atividade: "trabalhando" }),
      agente("faina", { atividade: "esperando" }),
      agente("nuno", { estado: "dormindo", motivoSono: "teto" }),
    ];
    await montar();
    expect(cabecas()).toEqual([
      { expressao: "ocioso", rotulo: "Alba, ocioso" },
      { expressao: "trabalhando", rotulo: "Tula, trabalhando" },
      { expressao: "esperando", rotulo: "Faina, esperando você" },
      { expressao: "erro", rotulo: "Nuno, parado. Chegou ao teto de hoje" },
    ]);
    // O anel segue o tom do status: teto tem cara preocupada, mas anel de aviso, não o vermelho.
    const molduras = [...recipiente.querySelectorAll<HTMLElement>(".personagem-moldura")];
    expect(molduras.map((m) => m.dataset.tom)).toEqual(["nenhuma", "sucesso", "aviso", "aviso"]);
  });

  it("erro de provedor é o único anel vermelho", async () => {
    canal.lista = async () => [agente("tula", { atividade: "erro" })];
    await montar();
    const tula = recipiente.querySelector<HTMLElement>('[data-agente="tula"] .personagem-moldura')!;
    expect(tula.dataset.tom).toBe("perigo");
  });

  it("agentes.mudou troca só a cabeça de quem mudou", async () => {
    canal.lista = async () => ["alba", "tula", "faina", "nuno"].map((id) => agente(id));
    await montar();
    await act(async () => {
      ouvintes.get("agentes.mudou")?.forEach((fn) => fn(agente("nuno", { atividade: "trabalhando" })));
    });
    expect(cabecas().map((c) => c.expressao)).toEqual(["ocioso", "ocioso", "ocioso", "trabalhando"]);
    await act(async () => {
      ouvintes.get("agentes.mudou")?.forEach((fn) => fn(agente("nuno", { estado: "pausado" })));
    });
    expect(cabecas()[3]).toEqual({ expressao: "dormindo", rotulo: "Nuno, pausado" });
  });

  it("sem modelo, dormem com o convite de sempre", async () => {
    canal.lista = async () =>
      ["alba", "tula", "faina", "nuno"].map((id) =>
        agente(id, { estado: "dormindo", motivoSono: "sem_modelo" }),
      );
    await montar();
    for (const c of cabecas()) {
      expect(c.expressao).toBe("dormindo");
      expect(c.rotulo).toMatch(new RegExp(`, dormindo\\. ${CONVITE_AGENTES}$`));
    }
  });

  it("serviço sem atendente para agentes.listar: o time segue dormindo, como na fase 1", async () => {
    canal.lista = async () => {
      throw new Error("método agentes.listar sem atendente");
    };
    await montar();
    expect(cabecas()).toEqual(
      ["Alba", "Tula", "Faina", "Nuno"].map((nome) => ({
        expressao: "dormindo",
        rotulo: `${nome}, dormindo. ${CONVITE_AGENTES}`,
      })),
    );
  });

  it("canal caído: ninguém aparece trabalhando", async () => {
    canal.lista = async () => [agente("tula", { atividade: "trabalhando" })];
    await montar();
    expect(cabecas()[1]!.expressao).toBe("trabalhando");
    canal.estado = "desconectado";
    await act(async () => raiz!.render(<Dock />));
    expect(cabecas().every((c) => c.expressao === "dormindo")).toBe(true);
  });

  it("ao reconectar sem resposta da lista, não volta a situação da conexão anterior", async () => {
    canal.lista = async () => [agente("tula", { atividade: "trabalhando" })];
    await montar();
    expect(cabecas()[1]!.expressao).toBe("trabalhando");
    canal.estado = "desconectado";
    await act(async () => raiz!.render(<Dock />));
    canal.lista = async () => {
      throw new Error("conexão caiu");
    };
    canal.estado = "conectado";
    await act(async () => raiz!.render(<Dock />));
    expect(cabecas().every((c) => c.expressao === "dormindo")).toBe(true);
  });

  it("a lista falhando depois de uma mudança já recebida limpa o que se sabia", async () => {
    let falhar!: (e: Error) => void;
    canal.lista = () => new Promise<Agente[]>((_, rejeitar) => (falhar = rejeitar));
    await montar();
    await act(async () => {
      ouvintes.get("agentes.mudou")?.forEach((fn) => fn(agente("nuno", { atividade: "trabalhando" })));
    });
    expect(cabecas()[3]!.expressao).toBe("trabalhando");
    await act(async () => falhar(new Error("resposta fora do contrato em agentes.listar")));
    expect(cabecas()[3]!.expressao).toBe("dormindo");
  });
});

describe("juntarSituacoes", () => {
  it("guarda só os quatro de fábrica e substitui o que já se sabia de cada um", () => {
    const antes = juntarSituacoes({}, [agente("alba"), agente("agente-meu-01J")]);
    expect(Object.keys(antes)).toEqual(["alba"]);
    const depois = juntarSituacoes(antes, [agente("alba", { atividade: "erro" })]);
    expect(depois.alba?.atividade).toBe("erro");
    expect(antes.alba?.atividade).toBe("ocioso");
  });
});

function aviso(id: string, agenteId: string | null): Notificacao {
  return {
    id,
    agenteId,
    tipo: "aprovacao",
    titulo: "Claude Code pede permissão",
    corpo: null,
    referencia: `aprovacao:${id}`,
    canal: "ambos",
    criadoEm: "2026-10-09T12:00:00.000Z",
    vistaEm: null,
  };
}

/** Os agentes com ponto de aviso, na ordem do time. */
const comPonto = () =>
  [...recipiente.querySelectorAll<HTMLElement>(".dock-agente")]
    .filter((b) => b.querySelector("[data-ponto]"))
    .map((b) => b.dataset.agente);

describe("ponto de aviso no dock", () => {
  it("quem tem aviso não visto ganha o ponto e o número no rótulo", async () => {
    canal.lista = async () => ["alba", "tula", "faina", "nuno"].map((id) => agente(id));
    canal.naoVistas = async () => [
      aviso("a", "nuno"),
      aviso("b", "nuno"),
      aviso("c", "alba"),
      aviso("d", null),
    ];
    await montar();
    expect(comPonto()).toEqual(["alba", "nuno"]);
    expect(cabecas()[3]!.rotulo).toBe("Nuno, ocioso. 2 avisos novos");
    expect(cabecas()[0]!.rotulo).toBe("Alba, ocioso. 1 aviso novo");
    expect(cabecas()[1]!.rotulo).toBe("Tula, ocioso");
  });

  it("a lista nova do serviço troca os pontos; abrir o agente marca os dele como vistos", async () => {
    await montar();
    expect(comPonto()).toEqual([]);
    await act(async () => {
      ouvintes.get("notificacoes.naoVistas")?.forEach((fn) => fn([aviso("a", "faina")]));
    });
    expect(comPonto()).toEqual(["faina"]);
    await act(async () => recipiente.querySelector<HTMLButtonElement>('[data-agente="faina"]')!.click());
    expect(servico.pedir).toHaveBeenCalledWith("notificacoes.marcarVistas", { agenteId: "faina" });
    await act(async () => {
      ouvintes.get("notificacoes.naoVistas")?.forEach((fn) => fn([]));
    });
    expect(comPonto()).toEqual([]);
  });

  it("canal caído: nenhum ponto", async () => {
    canal.naoVistas = async () => [aviso("a", "nuno")];
    await montar();
    expect(comPonto()).toEqual(["nuno"]);
    canal.estado = "desconectado";
    await act(async () => raiz!.render(<Dock />));
    expect(comPonto()).toEqual([]);
  });
});
