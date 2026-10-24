// @vitest-environment happy-dom
import type {
  Agente,
  Cambio,
  MudancaAgente,
  MudancaProvedor,
  Provedor,
  SituacaoAgente,
} from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { SecaoModelos } from "./Modelos.tsx";

// O serviço é falso: cada pedido fica registrado e a resposta vem de `responder`.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> => Promise.resolve(undefined),
  ouvintes: new Map<string, (dados: unknown) => void>(),
  /** O que o teste do provedor diz sobre ferramentas. */
  ferramentas: null as boolean | null,
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
// A casca é falsa: nada abre no navegador.
const casca = vi.hoisted(() => ({ invoke: vi.fn((..._: unknown[]) => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: casca.invoke }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SITUACAO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const agente = (id: string, nome: string, principal: string | null, reserva: string | null): Agente => ({
  id,
  nome,
  funcao: "x",
  instrucoes: "",
  personagem: { silhueta: "a", traco: "b", tom: "c" },
  ferramentas: [],
  provedorId: principal,
  provedorReservaId: reserva,
  gatilhos: [],
  escoposMemoria: [],
  tetoDiarioCentavos: null,
  tetoMoeda: "BRL",
  gastoDeHoje: {
    microdolares: 0,
    centavos: null,
    cotacaoDe: null,
    limiteCentavos: null,
    liberarCentavos: null,
    pedeCotacao: false,
  },
  deFabrica: true,
  camposPersonalizados: [],
  situacao: principal ? SITUACAO : { ...SITUACAO, estado: "dormindo", motivoSono: "sem_modelo" },
});

const PROVEDORES: Provedor[] = [
  {
    id: "p1",
    tipo: "claude-cli",
    nome: "Claude Code",
    modelo: null,
    baseUrl: null,
    temChave: false,
    testadoEm: null,
  },
  {
    id: "p2",
    tipo: "openai-compativel",
    nome: "Ollama neste PC",
    modelo: "llama3.1:8b",
    baseUrl: "http://127.0.0.1:11434/v1",
    temChave: false,
    testadoEm: null,
  },
];

/** O Nuno com teto de R$ 5,00 e o gasto de hoje que o serviço contou pela cotação de 16/10. */
const nunoComTeto = (mudar: Partial<Agente> = {}): Agente => ({
  ...agente("nuno", "Nuno", "p1", null),
  tetoDiarioCentavos: 500,
  tetoMoeda: "BRL",
  gastoDeHoje: {
    microdolares: 206_000,
    centavos: 112,
    cotacaoDe: "2026-10-16",
    limiteCentavos: 500,
    liberarCentavos: 100,
    pedeCotacao: false,
  },
  ...mudar,
});

/** Serviço que aceita a troca como o de verdade: aplica a mudança e devolve o agente. */
function servico(
  inicialProvedores = PROVEDORES,
  inicial?: Agente[],
  cambioInicial: Cambio = { cotacoes: {} },
) {
  let provedores = inicialProvedores;
  let cambio = cambioInicial;
  const estadoConfig = () => ({ config: { cambio }, portable: false, falhasAtalhos: {} });
  let agentes = inicial ?? [
    agente("alba", "Alba", "p1", "p2"),
    agente("tula", "Tula", "p1", null),
    agente("faina", "Faina", "p2", null),
    agente("nuno", "Nuno", "p1", null),
  ];
  falso.responder = (metodo, dados) => {
    switch (metodo) {
      case "provedores.listar":
        return Promise.resolve(provedores);
      case "agentes.listar":
        return Promise.resolve(agentes);
      case "execucoes.listar":
        return Promise.resolve({ itens: [], proximo: null });
      case "provedores.detectar":
        return Promise.resolve([
          {
            tipo: "claude-cli",
            caminho: "C:\\claude.exe",
            versao: "2.4",
            logado: true,
            impedimento: null,
            versaoMinima: null,
          },
        ]);
      case "provedores.criar":
        return Promise.resolve({ ...PROVEDORES[0], id: "novo", ...(dados as object) });
      case "provedores.testar":
        return Promise.resolve({
          ok: true,
          provedorId: (dados as { id: string }).id,
          latenciaMs: 2100,
          testadoEm: new Date().toISOString(),
          ferramentas: falso.ferramentas,
        });
      case "provedores.definir": {
        const { id, chave: _, ...resto } = dados as MudancaProvedor;
        provedores = provedores.map((p) => (p.id === id ? { ...p, ...resto, testadoEm: null } : p));
        return Promise.resolve(provedores.find((p) => p.id === id));
      }
      case "provedores.remover":
        provedores = provedores.filter((p) => p.id !== (dados as { id: string }).id);
        return Promise.resolve(provedores);
      case "provedores.modelos":
        return Promise.resolve({
          ok: true,
          modelos: [
            { id: "gemma3:4b", ferramentas: false },
            { id: "llama3.1:8b", ferramentas: null },
          ],
        });
      case "config.obter":
        return Promise.resolve(estadoConfig());
      case "config.definir":
        cambio = (dados as { cambio: Cambio }).cambio;
        return Promise.resolve(estadoConfig());
      case "cambio.buscar":
        return Promise.resolve({ moeda: "BRL", milionesimos: 5_432_100, data: "2026-10-16" });
      case "agentes.definir": {
        const m = dados as MudancaAgente;
        agentes = agentes.map((a) => (a.id === m.id ? { ...a, ...m } : a));
        return Promise.resolve(agentes.find((a) => a.id === m.id));
      }
      default:
        return Promise.reject(new Error(`sem resposta para ${metodo}`));
    }
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;

async function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<SecaoModelos />));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  falso.ferramentas = null;
  casca.invoke.mockReset();
  casca.invoke.mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) =>
  todos("button").find((b) => b.textContent === texto || b.getAttribute("aria-label") === texto)!;
const lista = (rotulo: string) => por(`select[aria-label="${rotulo}"]`) as HTMLSelectElement;
const escolhido = (rotulo: string) => lista(rotulo).options[lista(rotulo).selectedIndex]?.textContent ?? null;
const escolher = (rotulo: string, valor: string) =>
  act(async () => {
    lista(rotulo).value = valor;
    lista(rotulo).dispatchEvent(new Event("change", { bubbles: true }));
  });
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
async function digitar(rotulo: string, valor: string) {
  const campo = todos("label").find((l): l is HTMLLabelElement => l.textContent === rotulo);
  const entrada = campo && recipiente.querySelector<HTMLInputElement>(`#${CSS.escape(campo.htmlFor)}`);
  expect(entrada, `campo ${rotulo}`).toBeTruthy();
  const definirValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    definirValor.call(entrada, valor);
    entrada!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Modelos", () => {
  it("lista os provedores e o principal e a reserva de cada agente", async () => {
    servico();
    await montar();
    expect(todos("tbody th .config-modelos-nome").map((n) => n.textContent)).toEqual([
      "Claude Code",
      "Ollama neste PC",
      "Alba",
      "Tula",
      "Faina",
      "Nuno",
    ]);
    expect(escolhido("Principal da Alba")).toBe("Claude Code");
    expect(escolhido("Reserva da Alba")).toBe("Ollama neste PC");
    expect(escolhido("Reserva da Tula")).toBe("Nenhuma");
    // A reserva nunca oferece o próprio principal.
    expect([...lista("Reserva da Tula").options].map((o) => o.textContent)).toEqual([
      "Nenhuma",
      "Ollama neste PC",
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("escolher na lista da tabela não grava: abre o painel com a escolha, e o sim grava", async () => {
    servico();
    await montar();
    await escolher("Principal da Tula", "p2");
    expect(pedidosDe("agentes.definir")).toEqual([]);
    const radios = todos('input[name="principal-tula"]') as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    // A lista saiu de cena: o foco vai à escolha marcada no painel.
    expect(document.activeElement).toBe(radios[1]);
    await act(async () => botao("Usar Ollama neste PC na Tula").click());
    expect(pedidosDe("agentes.definir")).toEqual([{ id: "tula", provedorId: "p2", provedorReservaId: null }]);
    expect(escolhido("Principal da Tula")).toBe("Ollama neste PC");

    // A reserva escolhida como principal troca os dois de lugar.
    await escolher("Principal da Alba", "p2");
    expect(escolhido("Reserva da Alba")).toBe("Claude Code");
    await act(async () => botao("Usar Ollama neste PC na Alba").click());
    expect(pedidosDe("agentes.definir").at(-1)).toEqual({
      id: "alba",
      provedorId: "p2",
      provedorReservaId: "p1",
    });

    await escolher("Reserva da Faina", "p1");
    expect(pedidosDe("agentes.definir")).toHaveLength(2);
    await act(async () => botao("Guardar a reserva").click());
    expect(pedidosDe("agentes.definir").at(-1)).toEqual({
      id: "faina",
      provedorId: "p2",
      provedorReservaId: "p1",
    });
  });

  it("o painel de um agente só grava com o sim, e o botão diz o que vai acontecer", async () => {
    servico();
    await montar();
    await act(async () => botao("Modelo do Nuno: abrir as opções").click());
    const radios = todos('input[name="principal-nuno"]') as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    await act(async () => radios[1]!.click());
    expect(por(".config-modelos-painel .fala")!.textContent).toContain(
      "Na próxima execução eu passo a usar o Ollama neste PC. O que estou fazendo agora termina no Claude Code.",
    );
    expect(pedidosDe("agentes.definir")).toEqual([]);
    await act(async () => botao("Usar Ollama neste PC no Nuno").click());
    expect(pedidosDe("agentes.definir")).toEqual([{ id: "nuno", provedorId: "p2", provedorReservaId: null }]);
    expect(por(".config-modelos-painel")).toBeNull();
    expect(escolhido("Principal do Nuno")).toBe("Ollama neste PC");
  });

  it("o painel fecha com Esc sem gravar nada", async () => {
    servico();
    await montar();
    await act(async () => botao("Modelo da Faina: abrir as opções").click());
    await act(async () => (todos('input[name="principal-faina"]')[0] as HTMLInputElement).click());
    await act(async () => {
      por(".config-modelos-painel")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(por(".config-modelos-painel")).toBeNull();
    expect(pedidosDe("agentes.definir")).toEqual([]);
  });

  it("teto por dia: Definir abre o painel, e o teto grava com a moeda escolhida só com o sim", async () => {
    servico();
    await montar();
    const definir = todos("button").filter((b) => b.textContent === "Definir");
    expect(definir).toHaveLength(4);
    expect(definir.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => botao("Definir o teto da Tula").click());
    // Real é o padrão; troca para dólar e escreve o valor.
    const moedas = todos('[role="radiogroup"][aria-label="Moeda do teto da Tula"] [role="radio"]');
    expect(moedas.map((m) => m.textContent)).toEqual(["R$", "US$", "€", "£"]);
    expect(moedas[0]!.getAttribute("aria-checked")).toBe("true");
    await act(async () => moedas[1]!.click());
    await digitar("Teto por dia da Tula, em dólar", "10,5");
    expect(pedidosDe("agentes.definir")).toEqual([]);
    await act(async () => botao("Guardar o teto").click());
    expect(pedidosDe("agentes.definir")).toEqual([
      { id: "tula", tetoDiarioCentavos: 1050, tetoMoeda: "USD" },
    ]);
    expect(por(".config-modelos-painel")).toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("enquanto o teto grava, a moeda trava junto com o resto do painel", async () => {
    servico();
    const responder = falso.responder;
    let soltar: () => void = () => {};
    falso.responder = (metodo, dados) =>
      metodo === "agentes.definir"
        ? new Promise((resolve) => (soltar = () => resolve(responder(metodo, dados))))
        : responder(metodo, dados);
    await montar();
    await act(async () => botao("Definir o teto da Tula").click());
    const moedas = () => todos('[role="radiogroup"][aria-label="Moeda do teto da Tula"] [role="radio"]');
    expect(moedas().every((m) => !(m as HTMLButtonElement).disabled)).toBe(true);
    await digitar("Teto por dia da Tula, em real", "10");
    await act(async () => botao("Guardar o teto").click());
    expect(moedas().every((m) => (m as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => soltar());
    expect(por(".config-modelos-painel")).toBeNull();
  });

  it("teto com valor que não é número não grava e diz como escrever", async () => {
    servico();
    await montar();
    await act(async () => botao("Definir o teto da Faina").click());
    await digitar("Teto por dia da Faina, em real", "dez");
    expect(por('.config-modelos-painel [role="alert"]')!.textContent).toBe("Use um valor como 10,00.");
    expect(botao("Guardar o teto")).toBeUndefined();
  });

  it("Hoje com teto: o gasto na moeda do teto como estimativa, com a data da cotação", async () => {
    servico(PROVEDORES, [nunoComTeto()], {
      cotacoes: { BRL: { milionesimos: 5_430_000, data: "2026-10-16", fonte: "digitada" } },
    });
    await montar();
    const linha = todos("tbody tr").find((l) => l.textContent?.includes("Nuno"))!;
    expect(linha.textContent).toContain("R$ 5,00");
    expect(linha.textContent).toContain("≈ R$ 1,12 de R$ 5,00");
    expect(linha.querySelector('[role="progressbar"]')!.getAttribute("aria-valuetext")).toBe(
      "cerca de R$ 1,12 de R$ 5,00 hoje, estimativa pela cotação de 16/10",
    );
    // A cotação gravada aparece com a data e a origem.
    expect(por('[aria-label="Cotação do teto"]')!.textContent).toContain(
      "US$ 1 = R$ 5,43, de 16/10, digitada",
    );
  });

  it("teto em real sem cotação: a tela pede a cotação, e a digitada grava com a data de hoje", async () => {
    const semCotacao = nunoComTeto({
      gastoDeHoje: { ...nunoComTeto().gastoDeHoje, centavos: null, cotacaoDe: null, pedeCotacao: true },
    });
    servico(PROVEDORES, [semCotacao]);
    await montar();
    expect(todos("tbody tr").find((l) => l.textContent?.includes("Nuno"))!.textContent).toContain(
      "sem cotação",
    );
    const bloco = por('[aria-label="Cotação do teto"]')!;
    expect(bloco.textContent).toContain("Sem cotação, o teto em real não vale. Digite quanto vale US$ 1.");
    await digitar("Quanto vale US$ 1 em real", "5,43");
    await act(async () => botao("Guardar").click());
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    expect(pedidosDe("config.definir")).toEqual([
      { cambio: { cotacoes: { BRL: { milionesimos: 5_430_000, data: dia, fonte: "digitada" } } } },
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("cotação digitada acima do máximo diz o limite e não grava", async () => {
    servico(PROVEDORES, [nunoComTeto()]);
    await montar();
    await digitar("Quanto vale US$ 1 em real", "1.000.000,01");
    expect(por('[aria-label="Cotação do teto"] [role="alert"]')!.textContent).toBe(
      "A cotação vai até 1.000.000,00 por US$ 1. Confira o número.",
    );
    expect((botao("Guardar") as HTMLButtonElement).disabled).toBe(true);
    await digitar("Quanto vale US$ 1 em real", "5,43");
    expect(por('[aria-label="Cotação do teto"] [role="alert"]')).toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Buscar cotação mostra o valor e a data da fonte e só grava com o sim, com a data da fonte", async () => {
    servico(PROVEDORES, [nunoComTeto()]);
    await montar();
    await act(async () => botao("Buscar cotação").click());
    expect(pedidosDe("cambio.buscar")).toEqual([{ moeda: "BRL" }]);
    expect(por(".config-cotacao-buscada")!.textContent).toContain("A fonte dá US$ 1 = R$ 5,4321, de 16/10.");
    expect(pedidosDe("config.definir")).toEqual([]);
    await act(async () => botao("Usar esta cotação").click());
    expect(pedidosDe("config.definir")).toEqual([
      {
        cambio: { cotacoes: { BRL: { milionesimos: 5_432_100, data: "2026-10-16", fonte: "frankfurter" } } },
      },
    ]);
    expect(por(".config-cotacao-buscada")).toBeNull();
  });

  it("sem teto em outra moeda, não há cotação a pedir", async () => {
    servico();
    await montar();
    expect(por('[aria-label="Cotação do teto"]')).toBeNull();
  });

  it("testar chama o teste de verdade do serviço e mostra a latência medida", async () => {
    servico();
    await montar();
    await act(async () => botao("Testar Claude Code").click());
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "p1" }]);
    const linha = todos("tbody tr")[0]!;
    expect(linha.querySelector(".selo")!.textContent).toBe("funcionando");
    expect(linha.querySelector(".config-modelos-numero")!.textContent).toBe("2,1 s");
  });

  it("modelo que passa sem chamar a ferramenta: o selo e o aviso dizem que os agentes só conversam", async () => {
    servico();
    falso.ferramentas = false;
    await montar();
    await act(async () => botao("Testar Ollama neste PC").click());
    const linhas = todos('[aria-label="Provedores"] tbody tr');
    expect(linhas[1]!.querySelector(".selo")!.textContent).toBe("só conversa");
    expect(linhas[2]!.textContent).toContain("Com ele, os agentes só conversam");
  });

  it("editar: o nome grava sem testar; o modelo escolhido da lista do endereço grava e testa", async () => {
    servico();
    await montar();
    await act(async () => botao("Editar Ollama neste PC").click());
    expect(document.activeElement).toBe(por('section[aria-label="Editar Ollama neste PC"] input'));
    await digitar("Nome", "Ollama de casa");
    await act(async () => botao("Guardar").click());
    expect(pedidosDe("provedores.definir")).toEqual([{ id: "p2", nome: "Ollama de casa" }]);
    expect(pedidosDe("provedores.testar")).toEqual([]);
    expect(todos("tbody th .config-modelos-nome")[1]!.textContent).toBe("Ollama de casa");

    await act(async () => botao("Editar Ollama de casa").click());
    await act(async () => botao("Testar o endereço e listar os modelos").click());
    // Provedor gravado: o serviço usa a chave guardada só para o endereço dela.
    expect(pedidosDe("provedores.modelos")).toEqual([
      { id: "p2", tipo: "openai-compativel", baseUrl: "http://127.0.0.1:11434/v1" },
    ]);
    expect([...lista("Modelos do endereço").options].map((o) => o.textContent)).toEqual([
      "gemma3:4b · sem ferramentas",
      "llama3.1:8b",
    ]);
    await escolher("Modelos do endereço", "gemma3:4b");
    expect(por('section[aria-label="Editar Ollama de casa"] [data-tom="aviso"]')!.textContent).toContain(
      "os agentes só conversam",
    );
    await act(async () => botao("Guardar e testar").click());
    expect(pedidosDe("provedores.definir").at(-1)).toEqual({ id: "p2", modelo: "gemma3:4b" });
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "p2" }]);
    expect(por('section[aria-label="Editar Ollama de casa"]')).toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("editar fecha com Esc sem gravar", async () => {
    servico();
    await montar();
    await act(async () => botao("Editar Claude Code").click());
    const formulario = por('section[aria-label="Editar Claude Code"]')!;
    expect(formulario.textContent).toContain("aqui só muda o nome");
    await act(async () =>
      formulario
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(por('section[aria-label="Editar Claude Code"]')).toBeNull();
    expect(pedidosDe("provedores.definir")).toEqual([]);
  });

  it("remover diz quem usa, oferece trocar o modelo antes e só remove com o sim", async () => {
    servico();
    await montar();
    await act(async () => botao("Remover Ollama neste PC").click());
    const confirmar = por('[role="alertdialog"]')!;
    expect(confirmar.textContent).toContain("Alba (reserva) e Faina (principal) usam o Ollama neste PC.");
    expect(document.activeElement).toBe(botao("Agora não"));

    // Trocar antes abre o painel do agente, sem remover nada.
    await act(async () => botao("Trocar o modelo da Faina").click());
    expect(todos('input[name="principal-faina"]')).toHaveLength(2);
    expect(pedidosDe("provedores.remover")).toEqual([]);

    await act(async () => botao("Remover o Ollama neste PC").click());
    expect(pedidosDe("provedores.remover")).toEqual([{ id: "p2" }]);
    expect(
      todos('[aria-label="Provedores"] tbody th .config-modelos-nome').map((n) => n.textContent),
    ).toEqual(["Claude Code"]);
    expect(por('[role="alertdialog"]')).toBeNull();
  });

  it("roteador local: nome amigável, Testar lista os modelos do endereço e a escolha vai no pedido", async () => {
    servico();
    await montar();
    await act(async () => botao("Adicionar provedor").click());
    await act(async () =>
      por<HTMLElement>(
        '[role="radiogroup"][aria-label="Provedor da chave"] [role="radio"]:last-child',
      )!.click(),
    );
    await act(async () => botao("Testar o endereço e listar os modelos").click());
    expect(por('[aria-label="Conectar por chave de API ou endereço"] [role="alert"]')!.textContent).toBe(
      "Informe o endereço antes de testar.",
    );
    expect(pedidosDe("provedores.modelos")).toEqual([]);

    await digitar("Endereço (base_url)", "http://localhost:20128/v1");
    const nome = todos("label").find((l) => l.textContent === "Nome") as HTMLLabelElement;
    expect(por<HTMLInputElement>(`#${CSS.escape(nome.htmlFor)}`)!.placeholder).toBe("Modelo local");
    await act(async () => botao("Testar o endereço e listar os modelos").click());
    expect(pedidosDe("provedores.modelos")).toEqual([
      { tipo: "openai-compativel", baseUrl: "http://localhost:20128/v1" },
    ]);
    expect(por('[role="status"]')!.textContent).toBe("2 modelos no endereço.");
    await escolher("Modelos do endereço", "llama3.1:8b");
    await act(async () => botao("Conectar e testar").click());
    expect(pedidosDe("provedores.criar")).toEqual([
      {
        tipo: "openai-compativel",
        nome: "Modelo local",
        baseUrl: "http://localhost:20128/v1",
        modelo: "llama3.1:8b",
      },
    ]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("nenhum provedor: o time dorme, a tela procura no PC e conecta o que dá para usar", async () => {
    servico([], [agente("alba", "Alba", null, null)]);
    await montar();
    expect(por(".config-modelos-vazio-titulo")!.textContent).toBe("Nenhum modelo conectado");
    expect(pedidosDe("provedores.detectar")).toHaveLength(1);
    await act(async () => botao("Conectar Claude Code e testar").click());
    expect(pedidosDe("provedores.criar")).toEqual([{ tipo: "claude-cli", nome: "Claude Code" }]);
    expect(pedidosDe("provedores.testar")).toEqual([{ id: "novo" }]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("Entrar abre o terminal de login do CLI sem login, e procurar de novo acha o logado", async () => {
    servico();
    const base = falso.responder;
    let logado = false;
    falso.responder = (metodo, dados) =>
      metodo === "provedores.detectar"
        ? Promise.resolve([
            {
              tipo: "claude-cli",
              caminho: "C:\\claude.exe",
              versao: "2.4",
              logado,
              impedimento: null,
              versaoMinima: null,
            },
          ])
        : base(metodo, dados);
    await montar();
    await act(async () => botao("Procurar no PC").click());
    const entrar = botao("Entrar no Claude Code pelo terminal");
    expect(entrar.textContent).toBe("Entrar");
    expect(todos("button").filter((b) => b.textContent === "Entrar")).toHaveLength(1);
    await act(async () => entrar.click());
    // Vai só a chave: o comando de login é da casca, de uma lista fixa.
    expect(casca.invoke).toHaveBeenCalledWith("abrir_terminal", { cli: "claude-cli" });
    casca.invoke.mockImplementationOnce(() => Promise.reject("esse CLI não entra pelo Moductus"));
    await act(async () => botao("Entrar no Claude Code pelo terminal").click());
    expect(por('[aria-label="CLIs no PC"] [role="alert"]')!.textContent).toBe(
      "Não consegui abrir: esse CLI não entra pelo Moductus.",
    );

    logado = true;
    await act(async () => botao("Procurar no PC").click());
    expect(todos("button").filter((b) => b.textContent === "Entrar")).toEqual([]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("CLI que não está no PC leva à página de instalação; o achado não oferece instalar", async () => {
    servico([], [agente("alba", "Alba", null, null)]);
    await montar();
    expect(botao("Como instalar o Claude Code")).toBeUndefined();
    const codex = botao("Como instalar o Codex");
    expect(codex.textContent).toBe("Como instalar");
    await act(async () => codex.click());
    expect(casca.invoke).toHaveBeenCalledWith("abrir_endereco", {
      endereco: "https://github.com/openai/codex",
    });
    casca.invoke.mockImplementationOnce(() => Promise.reject("o Windows não abriu"));
    await act(async () => botao("Como instalar o OpenCode").click());
    expect(por('[aria-label="CLIs no PC"] [role="alert"]')!.textContent).toBe(
      "Não consegui abrir: o Windows não abriu.",
    );
    expect(auditar(recipiente)).toEqual([]);
  });
});
