// @vitest-environment happy-dom
import {
  CONFIG_PADRAO,
  TipoNotificacao,
  type EstadoConfig,
  type EstadoNotificacoes,
  type MudancaPreferencia,
  type PreferenciaNotificacao,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { SecaoNotificacoes } from "./Notificacoes.tsx";

// O serviço é falso: cada pedido fica registrado e a resposta vem de `responder`.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> => Promise.resolve(undefined),
  ouvintes: new Map<string, (dados: unknown) => void>(),
}));
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      return falso.responder(metodo, dados);
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      falso.ouvintes.set(nome, fn);
      return () => falso.ouvintes.delete(nome);
    },
  },
  useCanal: () => "conectado",
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGENTES = ["alba", "tula", "faina", "nuno"];

/** As preferências como o serviço devolve: uma por agente e tipo. */
function preferencias(
  vale: (agenteId: string, tipo: TipoNotificacao) => Partial<PreferenciaNotificacao> = () => ({}),
): EstadoNotificacoes {
  return {
    preferencias: AGENTES.flatMap((agenteId) =>
      TipoNotificacao.options.map((tipo) => ({
        agenteId,
        tipo,
        nivel: "so_o_que_precisa" as const,
        canal: "ambos" as const,
        definida: false,
        ...vale(agenteId, tipo),
      })),
    ),
  };
}

/** Serviço que aceita tudo: aplica a mudança e devolve o estado novo. */
function servicoQueAceita(inicial = preferencias()) {
  let notificacoes = inicial;
  let config: EstadoConfig = { config: CONFIG_PADRAO, portable: false, falhasAtalhos: {} };
  falso.responder = (metodo, dados) => {
    if (metodo === "notificacoes.obter") return Promise.resolve(notificacoes);
    if (metodo === "notificacoes.definir") {
      const m = dados as MudancaPreferencia;
      notificacoes = preferencias((agenteId, tipo) => {
        const atual = inicial.preferencias.find((p) => p.agenteId === agenteId && p.tipo === tipo)!;
        return agenteId === m.agenteId ? { nivel: m.nivel, canal: m.canal, definida: true } : atual;
      });
      return Promise.resolve(notificacoes);
    }
    if (metodo === "config.obter") return Promise.resolve(config);
    if (metodo === "config.definir") {
      config = { ...config, config: { ...config.config, ...(dados as object) } };
      return Promise.resolve(config);
    }
    return Promise.reject(new Error(`sem resposta para ${metodo}`));
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<SecaoNotificacoes />));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const grupo = (rotulo: string) => por(`[role="radiogroup"][aria-label="${rotulo}"]`)!;
const marcada = (rotulo: string) =>
  grupo(rotulo).querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.textContent ?? null;
const opcao = (rotulo: string, texto: string) =>
  [...grupo(rotulo).querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === texto)!;
const chave = (rotulo: string) => por(`[role="switch"][aria-label="${rotulo}"]`)!;
const lista = (rotulo: string) => por(`select[aria-label="${rotulo}"]`) as HTMLSelectElement;
const onde = (rotulo: string) => lista(rotulo).options[lista(rotulo).selectedIndex]?.textContent ?? null;
const escolher = (rotulo: string, valor: string) =>
  act(async () => {
    lista(rotulo).value = valor;
    lista(rotulo).dispatchEvent(new Event("change", { bubbles: true }));
  });
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);

describe("Notificações", () => {
  it("mostra o nível e o canal de cada agente e muda os tipos dele de uma vez", async () => {
    servicoQueAceita(preferencias((agenteId) => (agenteId === "nuno" ? { nivel: "tudo" } : {})));
    await montar();
    expect(marcada("Avisar de Alba")).toBe("Só o que precisa de mim");
    expect(marcada("Avisar de Nuno")).toBe("Tudo");
    expect(onde("Onde avisar de Tula")).toBe("Windows e dock");

    await act(async () => opcao("Avisar de Tula", "Nada").click());
    expect(pedidosDe("notificacoes.definir")).toEqual([{ agenteId: "tula", nivel: "nada", canal: "ambos" }]);
    expect(marcada("Avisar de Tula")).toBe("Nada");
    // Com "nada", onde avisar não faz diferença: a lista fica travada.
    expect(lista("Onde avisar de Tula").disabled).toBe(true);
    expect(lista("Onde avisar de Faina").disabled).toBe(false);

    await escolher("Onde avisar de Faina", "dock");
    expect(pedidosDe("notificacoes.definir").at(-1)).toEqual({
      agenteId: "faina",
      nivel: "so_o_que_precisa",
      canal: "dock",
    });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("preferência mudada só para um tipo: nada marcado e a linha diz que varia", async () => {
    servicoQueAceita(
      preferencias((agenteId, tipo) => (agenteId === "alba" && tipo === "rotina" ? { nivel: "nada" } : {})),
    );
    await montar();
    expect(marcada("Avisar de Alba")).toBeNull();
    expect(recipiente.textContent).toContain("lembretes, briefing · varia por tipo");
    expect(onde("Onde avisar de Alba")).toBe("Windows e dock");

    // Mudar só onde: cada tipo vai com o próprio nível, e a rotina continua em "nada".
    await escolher("Onde avisar de Alba", "dock");
    expect(pedidosDe("notificacoes.definir")).toEqual(
      TipoNotificacao.options.map((tipo) => ({
        agenteId: "alba",
        tipo,
        nivel: tipo === "rotina" ? "nada" : "so_o_que_precisa",
        canal: "dock",
      })),
    );
  });

  it("silêncio vai à configuração; o horário ligado mostra as horas e muda uma por vez", async () => {
    servicoQueAceita();
    await montar();
    expect(recipiente.textContent).toContain("das 22:00 às 07:30");
    expect(por('input[type="time"]')).toBeNull();
    expect(chave("Silêncio em tela cheia e apresentação").getAttribute("aria-checked")).toBe("true");

    await act(async () => chave("Horário de silêncio").click());
    expect(pedidosDe("config.definir")).toEqual([
      { silencio: { ...CONFIG_PADRAO.silencio, horario: { ligado: true, inicio: "22:00", fim: "07:30" } } },
    ]);
    const [inicio] = [...recipiente.querySelectorAll<HTMLInputElement>('input[type="time"]')];
    expect(inicio!.value).toBe("22:00");

    await act(async () => chave("Silêncio durante o foco").click());
    expect(pedidosDe("config.definir").at(-1)).toEqual({
      silencio: { horario: { ligado: true, inicio: "22:00", fim: "07:30" }, telaCheia: true, foco: false },
    });
    expect(auditar(recipiente)).toEqual([]);
  });

  it("acompanha a mudança feita em outra janela", async () => {
    servicoQueAceita();
    await montar();
    await act(async () => falso.ouvintes.get("notificacoes.mudou")!(preferencias(() => ({ canal: "dock" }))));
    expect(onde("Onde avisar de Nuno")).toBe("Só o ponto no dock");
  });

  it("canal mudado só para um tipo: a lista diz que varia, sem marcar um canal", async () => {
    servicoQueAceita(
      preferencias((agenteId, tipo) => (agenteId === "tula" && tipo === "rotina" ? { canal: "dock" } : {})),
    );
    await montar();
    expect(onde("Onde avisar de Tula")).toBe("Varia por tipo");
    expect(onde("Onde avisar de Alba")).toBe("Windows e dock");
  });

  it("segue o quadro: tabela por agente com a cabeça de cada um, silêncio num cartão ao lado da prévia", async () => {
    servicoQueAceita();
    await montar();
    const tabela = por("table")!;
    expect([...tabela.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Agente",
      "Avisar",
      "Onde",
    ]);
    const linhas = [...tabela.querySelectorAll("tbody tr")];
    expect(linhas.map((l) => l.querySelector("th")!.textContent)).toEqual([
      "Albalembretes, briefing",
      "Tulavencimentos, orçamento",
      "Fainaprévias para aprovar",
      "Nunosessões, CI, limites",
    ]);
    // Cabeça do personagem em cada linha; "Avisar" segmentado e "Onde" em lista suspensa.
    for (const linha of linhas) {
      expect(linha.querySelector('.personagem[data-modo="cabeca"]')).not.toBeNull();
      expect(linha.querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(linha.querySelector("select")).not.toBeNull();
    }
    const [silencio, previa] = [...por(".config-notificacoes-baixo")!.children] as HTMLElement[];
    expect(silencio!.classList.contains("cartao")).toBe(true);
    expect(silencio!.getAttribute("aria-label")).toBe("Silêncio");
    expect(previa!.getAttribute("aria-label")).toBe("Prévia de um aviso do Windows");
    expect(auditar(recipiente)).toEqual([]);
  });
});
