// @vitest-environment happy-dom
import type { ContagensAreas } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar, nomeAcessivel } from "../../teste/acessibilidade.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * As contagens da barra lateral do Sistema. O canal é um serviço de mentira: `areas.contagens`
 * responde o que o teste mandar e o aviso do mesmo nome é disparado à mão.
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string) =>
    comando === "servico_estado" ? { estado: "pronto", porta: 1, token: "t" } : undefined,
  ),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const ZERO: ContagensAreas = {
  tarefasPendentes: 0,
  lembretesAtrasados: 0,
  sessoesEsperando: 0,
  devPrecisando: 0,
};
const canal: { estado: EstadoConexao; contagens: () => Promise<ContagensAreas> } = {
  estado: "conectado",
  contagens: async () => ZERO,
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
      if (metodo === "areas.contagens") return canal.contagens();
      if (metodo === "config.obter") throw new Error("sem configuração no teste");
      throw new Error(`método ${metodo} sem atendente`);
    }),
  },
}));

const { BarraLateral } = await import("./BarraLateral.tsx");

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () =>
    raiz!.render(<BarraLateral ativa="tarefas" aoEscolher={() => {}} refBusca={createRef()} />),
  );
}

const item = (id: string) => recipiente.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const numero = (id: string) => item(id).querySelector(".navegacao-contagem")?.textContent ?? null;
const avisar = (contagens: ContagensAreas) =>
  act(async () => ouvintes.get("areas.contagens")?.forEach((fn) => fn(contagens)));

beforeEach(() => {
  ouvintes.clear();
  canal.estado = "conectado";
  canal.contagens = async () => ZERO;
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

describe("contagens na barra lateral do Sistema (Sistema.dc.html)", () => {
  it("Sessões de IA, Tarefas e Dev mostram o número do serviço; o leitor de tela ouve com o nome", async () => {
    canal.contagens = async () => ({
      tarefasPendentes: 7,
      lembretesAtrasados: 2,
      sessoesEsperando: 3,
      devPrecisando: 1,
    });
    await montar();
    expect([numero("sessoes"), numero("tarefas"), numero("dev"), numero("inicio")]).toEqual([
      "3",
      "7",
      "1",
      null,
    ]);
    expect(nomeAcessivel(item("tarefas"))).toBe("Tarefas, 7 tarefas pendentes");
    expect(nomeAcessivel(item("sessoes"))).toBe("Sessões de IA, 3 sessões esperando você");
    expect(nomeAcessivel(item("dev"))).toBe("Dev, 1 aviso de dev");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("concluir uma tarefa: o aviso troca o número; zero não mostra número", async () => {
    canal.contagens = async () => ({ ...ZERO, tarefasPendentes: 1 });
    await montar();
    expect(nomeAcessivel(item("tarefas"))).toBe("Tarefas, 1 tarefa pendente");
    await avisar(ZERO);
    expect(numero("tarefas")).toBeNull();
    expect(nomeAcessivel(item("tarefas"))).toBe("Tarefas");
    // O atalho continua no canto, para aparecer com a atenção.
    expect(item("tarefas").querySelector(".navegacao-atalho")?.textContent).toBe("Ctrl 4");
  });

  it("acima de 99 mostra 99+, e o leitor de tela ouve o número inteiro", async () => {
    canal.contagens = async () => ({ ...ZERO, devPrecisando: 120 });
    await montar();
    expect(numero("dev")).toBe("99+");
    expect(nomeAcessivel(item("dev"))).toBe("Dev, 120 avisos de dev");
  });

  it("sem conexão, nenhum número", async () => {
    canal.contagens = async () => ({ ...ZERO, tarefasPendentes: 5 });
    canal.estado = "desconectado";
    await montar();
    expect(recipiente.querySelector(".navegacao-contagem")).toBeNull();
  });
});
