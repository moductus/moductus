// @vitest-environment happy-dom
import type { Agente, SituacaoAgente } from "@moductus/contrato";
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

const canal: { estado: EstadoConexao; lista: () => Promise<Agente[]> } = {
  estado: "conectado",
  lista: async () => [],
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
      throw new Error(`método ${metodo} sem atendente`);
    }),
  },
}));

const { Dock, CONVITE_AGENTES } = await import("./Dock.tsx");
const { juntarSituacoes } = await import("../../servico/time.ts");

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
