// @vitest-environment happy-dom
import {
  CONFIG_PADRAO,
  type EstadoConfig,
  type MudancaConfig,
  type MudancaRotina,
  type Rotina,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { MENSAGEM_EXPEDIENTE_AO_CONTRARIO, SecaoDia } from "./Dia.tsx";

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

const TODOS = [1, 2, 3, 4, 5, 6, 7];

function rotinasPadrao(dias: number[] = TODOS): Rotina[] {
  return [
    { id: "briefing", tipo: "briefing", hora: null, diasSemana: dias, ativa: true, curta: false },
    { id: "fechamento", tipo: "fechamento", hora: "18:00", diasSemana: dias, ativa: true, curta: false },
  ];
}

/** Serviço que aceita tudo: aplica a mudança e devolve o estado novo, como o de verdade. */
function servicoQueAceita(inicial = rotinasPadrao()) {
  let rotinas = inicial;
  let config: EstadoConfig = {
    config: { ...CONFIG_PADRAO, dia: { ...CONFIG_PADRAO.dia, fuso: "America/Sao_Paulo" } },
    portable: false,
    falhasAtalhos: {},
  };
  falso.responder = (metodo, dados) => {
    if (metodo === "rotinas.listar") return Promise.resolve(rotinas);
    if (metodo === "rotinas.definir") {
      const m = dados as MudancaRotina;
      rotinas = rotinas.map((r) => ({
        ...r,
        ...(r.id === m.id && m.hora !== undefined ? { hora: m.hora } : {}),
        ...(r.id === m.id && m.ativa !== undefined ? { ativa: m.ativa } : {}),
        ...(m.diasSemana ? { diasSemana: m.diasSemana } : {}),
      }));
      return Promise.resolve(rotinas.find((r) => r.id === m.id));
    }
    if (metodo === "config.obter") return Promise.resolve(config);
    if (metodo === "config.definir") {
      config = { ...config, config: { ...config.config, ...(dados as MudancaConfig) } };
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
  await act(async () => raiz!.render(<SecaoDia />));
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
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const texto = () => recipiente.textContent ?? "";
const dia = (nome: string) => por(`button[aria-label="${nome}"]`) as HTMLButtonElement;
const chave = (rotulo: string) => por(`[role="switch"][aria-label="${rotulo}"]`)!;
const radio = (nome: string) =>
  todos("label")
    .find((l) => l.textContent?.startsWith(nome))!
    .querySelector("input") as HTMLInputElement;
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);

/** O controle ligado a um rótulo (`<label for>`), visível ou só para o leitor de tela. */
function controle<T extends HTMLElement>(rotulo: string): T {
  const label = todos("label").find((l): l is HTMLLabelElement => l.textContent === rotulo);
  const alvo = label && recipiente.querySelector<T>(`#${CSS.escape(label.htmlFor)}`);
  expect(alvo, `controle ${rotulo}`).toBeTruthy();
  return alvo!;
}

async function digitar(rotulo: string, valor: string) {
  const entrada = controle<HTMLInputElement>(rotulo);
  const definirValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    definirValor.call(entrada, valor);
    entrada.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function escolher(rotulo: string, valor: string) {
  const lista = controle<HTMLSelectElement>(rotulo);
  await act(async () => {
    lista.value = valor;
    lista.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const escolhida = (rotulo: string) => {
  const lista = controle<HTMLSelectElement>(rotulo);
  return lista.options[lista.selectedIndex]?.textContent ?? null;
};

describe("Configurações › O dia", () => {
  it("mostra o quadro: os dias, o fuso, as duas rotinas, o expediente e a rodada do foco", async () => {
    servicoQueAceita(rotinasPadrao([1, 2, 3, 4, 5]));
    await montar();
    expect(por(".config-secao h2")!.textContent).toBe("O dia");
    expect(texto()).toContain("Quando a Alba abre e fecha o seu dia");
    expect(
      todos(".config-dia-semana-dia").map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`),
    ).toEqual(["seg:true", "ter:true", "qua:true", "qui:true", "sex:true", "sáb:false", "dom:false"]);
    expect(texto()).toContain("Valem para o briefing, o fechamento e o expediente.");
    expect(escolhida("Fuso horário")).toMatch(/^São Paulo \(UTC−03:00\)/);
    expect(todos(".config-dia-titulo").map((h) => h.textContent)).toEqual([
      "Dias de trabalho",
      "Briefing da manhã",
      "Fechamento do dia",
      "Expediente",
      "Ciclos do foco",
    ]);
    expect(radio("Na primeira atividade do dia").checked).toBe(true);
    expect(controle<HTMLInputElement>("Horário fixo do briefing").value).toBe("08:30");
    expect(controle<HTMLInputElement>("Hora de parar").value).toBe("18:00");
    expect(controle<HTMLInputElement>("Começo do expediente").value).toBe("09:00");
    expect(controle<HTMLInputElement>("Fim do expediente").value).toBe("18:00");
    expect(texto()).toContain("Só sugiro encaixe dentro do expediente");
    expect(["Foco", "Pausa", "Pausa longa", "A cada"].map(escolhida)).toEqual([
      "25 min",
      "5 min",
      "15 min",
      "4 focos",
    ]);
    expect(todos(".config-dia-segmento")).toHaveLength(8);
    expect(texto()).toContain("Uma rodada: 2h10, com 1h40 de foco. Mudar vale a partir do próximo ciclo.");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("os dias de trabalho vão ao serviço juntos; o último dia ligado não desliga", async () => {
    servicoQueAceita(rotinasPadrao([1, 2, 3, 4, 5]));
    await montar();
    await act(async () => dia("sábado").click());
    expect(pedidosDe("rotinas.definir")).toEqual([{ id: "briefing", diasSemana: [1, 2, 3, 4, 5, 6] }]);
    expect(dia("sábado").getAttribute("aria-pressed")).toBe("true");

    servicoQueAceita(rotinasPadrao([3]));
    act(() => raiz?.unmount());
    await montar();
    expect(dia("quarta").disabled).toBe(true);
    expect(dia("quinta").disabled).toBe(false);
  });

  it("o briefing passa ao horário fixo, troca a hora e volta à primeira atividade; e desliga", async () => {
    servicoQueAceita();
    await montar();
    await act(async () => radio("Num horário fixo").click());
    expect(pedidosDe("rotinas.definir").at(-1)).toEqual({ id: "briefing", hora: "08:30" });
    expect(radio("Num horário fixo").checked).toBe(true);

    await digitar("Horário fixo do briefing", "07:45");
    expect(pedidosDe("rotinas.definir").at(-1)).toEqual({ id: "briefing", hora: "07:45" });

    await act(async () => radio("Na primeira atividade do dia").click());
    expect(pedidosDe("rotinas.definir").at(-1)).toEqual({ id: "briefing", hora: null });
    // A hora escolhida fica no campo para a próxima vez.
    expect(controle<HTMLInputElement>("Horário fixo do briefing").value).toBe("07:45");

    await act(async () => chave("Briefing da manhã").click());
    expect(pedidosDe("rotinas.definir").at(-1)).toEqual({ id: "briefing", ativa: false });
    expect(radio("Num horário fixo").disabled).toBe(true);
  });

  it("a hora de parar nova diz que vale já hoje, e o Desfazer volta à de antes", async () => {
    servicoQueAceita();
    await montar();
    await digitar("Hora de parar", "18:30");
    expect(pedidosDe("rotinas.definir")).toEqual([{ id: "fechamento", hora: "18:30" }]);
    expect(por('[role="status"]')!.textContent).toContain(
      "Vale já hoje: o fechamento passa de 18:00 para 18:30.",
    );

    // Outra troca mantém a hora de antes no aviso.
    await digitar("Hora de parar", "19:00");
    expect(por('[role="status"]')!.textContent).toContain("passa de 18:00 para 19:00.");

    const desfazer = todos("button").find((b) => b.textContent === "Desfazer")!;
    await act(async () => desfazer.click());
    expect(pedidosDe("rotinas.definir").at(-1)).toEqual({ id: "fechamento", hora: "18:00" });
    expect(por('[role="status"]')!.textContent).toBe("");
    expect(controle<HTMLInputElement>("Hora de parar").value).toBe("18:00");
  });

  it("fora dos dias do fechamento, a hora nova vale no próximo dia de trabalho", async () => {
    // Nenhum dia é hoje: o fechamento só vale num dia que ainda não chegou.
    const hoje = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(
      new Date(),
    );
    const numeroHoje = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(hoje) + 1;
    servicoQueAceita(rotinasPadrao(TODOS.filter((d) => d !== numeroHoje)));
    await montar();
    await digitar("Hora de parar", "17:00");
    expect(por('[role="status"]')!.textContent).toContain(
      "Vale no próximo dia de trabalho: o fechamento passa de 18:00 para 17:00.",
    );
  });

  it("o expediente ao contrário não vai ao serviço; o certo vai com o resto do dia", async () => {
    servicoQueAceita();
    await montar();
    await digitar("Fim do expediente", "08:00");
    expect(pedidosDe("config.definir")).toEqual([]);
    expect(por('[role="alert"]')!.textContent).toBe(MENSAGEM_EXPEDIENTE_AO_CONTRARIO);
    // A hora recusada não fica na tela: o campo volta ao gravado.
    expect(controle<HTMLInputElement>("Fim do expediente").value).toBe("18:00");

    await digitar("Fim do expediente", "17:30");
    expect(pedidosDe("config.definir")).toEqual([
      {
        dia: {
          ...CONFIG_PADRAO.dia,
          fuso: "America/Sao_Paulo",
          expediente: { inicio: "09:00", fim: "17:30" },
        },
      },
    ]);
    expect(por('[role="alert"]')).toBeNull();
  });

  it("começo recusado e fim aceito em seguida: a tela termina igual ao que o serviço gravou", async () => {
    servicoQueAceita();
    await montar();
    await digitar("Começo do expediente", "19:00");
    expect(pedidosDe("config.definir")).toEqual([]);
    expect(controle<HTMLInputElement>("Começo do expediente").value).toBe("09:00");

    await digitar("Fim do expediente", "20:00");
    expect(pedidosDe("config.definir")).toEqual([
      {
        dia: {
          ...CONFIG_PADRAO.dia,
          fuso: "America/Sao_Paulo",
          expediente: { inicio: "09:00", fim: "20:00" },
        },
      },
    ]);
    expect(controle<HTMLInputElement>("Começo do expediente").value).toBe("09:00");
    expect(controle<HTMLInputElement>("Fim do expediente").value).toBe("20:00");
    expect(por('[role="alert"]')).toBeNull();
  });

  it("a hora que o serviço recusa volta ao campo com a gravada, no briefing, no fechamento e no expediente", async () => {
    servicoQueAceita();
    await montar();
    const responder = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "rotinas.definir" || metodo === "config.definir"
        ? Promise.reject(new Error("recusado"))
        : responder(metodo, dados);
    await digitar("Hora de parar", "18:30");
    expect(controle<HTMLInputElement>("Hora de parar").value).toBe("18:00");
    expect(por('[role="status"]')!.textContent).toBe("");
    await digitar("Horário fixo do briefing", "07:15");
    expect(controle<HTMLInputElement>("Horário fixo do briefing").value).toBe("08:30");
    expect(radio("Na primeira atividade do dia").checked).toBe(true);
    await digitar("Fim do expediente", "17:00");
    expect(controle<HTMLInputElement>("Fim do expediente").value).toBe("18:00");
    expect(por('[role="alert"]')!.textContent).toBe("recusado");
  });

  it("os ciclos e o fuso mudam a chave do dia, e a rodada acompanha", async () => {
    servicoQueAceita();
    await montar();
    await escolher("Foco", "50");
    expect(pedidosDe("config.definir").at(-1)).toEqual({
      dia: {
        ...CONFIG_PADRAO.dia,
        fuso: "America/Sao_Paulo",
        foco: { ...CONFIG_PADRAO.dia.foco, focoMin: 50 },
      },
    });
    expect(texto()).toContain("Uma rodada: 3h50, com 3h20 de foco.");

    await escolher("Fuso horário", "America/Manaus");
    expect((pedidosDe("config.definir").at(-1) as MudancaConfig).dia?.fuso).toBe("America/Manaus");
    expect(escolhida("Fuso horário")).toMatch(/^Manaus \(UTC−04:00\)/);
  });

  it("a recusa do serviço aparece com o motivo, e as rotinas de outra janela chegam pelo aviso", async () => {
    servicoQueAceita();
    await montar();
    const responder = falso.responder;
    falso.responder = (metodo, dados) =>
      metodo === "rotinas.definir"
        ? Promise.reject(new Error("O fechamento precisa de uma hora de parar."))
        : responder(metodo, dados);
    await digitar("Hora de parar", "18:30");
    expect(por('[role="alert"]')!.textContent).toBe("O fechamento precisa de uma hora de parar.");
    expect(por('[role="status"]')!.textContent).toBe("");

    await act(async () =>
      falso.ouvintes.get("rotinas.mudou")!([
        { id: "briefing", tipo: "briefing", hora: "09:15", diasSemana: TODOS, ativa: true },
        { id: "fechamento", tipo: "fechamento", hora: "17:00", diasSemana: TODOS, ativa: false },
      ]),
    );
    expect(radio("Num horário fixo").checked).toBe(true);
    expect(controle<HTMLInputElement>("Horário fixo do briefing").value).toBe("09:15");
    expect(chave("Fechamento do dia").getAttribute("aria-checked")).toBe("false");
    expect(controle<HTMLInputElement>("Hora de parar").value).toBe("17:00");
  });
});
