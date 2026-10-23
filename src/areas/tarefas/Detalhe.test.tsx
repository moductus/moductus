// @vitest-environment happy-dom
import type { Calendario, Conexao, EventoAgenda, Lista, Ocorrencia, Tarefa } from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcoesSistemaContexto } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { auditar } from "../../teste/acessibilidade.ts";
import { Tarefas } from "./Tarefas.tsx";
import { HOJE, tarefa } from "./exemplos.ts";

// O serviço é falso: responde pelo `servidor` (valor ou função do pedido) e guarda os ouvintes.
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
  servidor: {} as Record<string, unknown>,
}));
vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      if (!(metodo in falso.servidor)) return Promise.reject(new Error(`sem resposta para ${metodo}`));
      const resposta = falso.servidor[metodo];
      try {
        return Promise.resolve(typeof resposta === "function" ? resposta(dados) : resposta);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 11:00 de quinta, 8 de outubro, em São Paulo.
const AGORA = new Date("2026-10-08T14:00:00.000Z");
/** Um instante na hora de São Paulo (UTC−3), no dia 8. */
const as = (hora: string, dia = HOJE) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

const LISTAS: Lista[] = [
  { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false },
  { id: "trabalho", nome: "Trabalho", ordem: 1, cor: null, arquivada: false },
];

const LOCAL: Calendario = {
  id: "local",
  nome: "Local",
  fonte: "local",
  cor: null,
  espelho: false,
  podeEscrever: true,
  ler: true,
  sincronizadoEm: null,
};
const ESPELHO: Calendario = { ...LOCAL, id: "m", nome: "Moductus", fonte: "google", espelho: true };
const TRABALHO: Calendario = { ...LOCAL, id: "g1", nome: "Trabalho", fonte: "google", podeEscrever: false };

const GOOGLE: Conexao = {
  tipo: "google-agenda",
  estado: "ligada",
  conta: "voce@exemplo.com",
  ultimoErro: null,
  conectadaEm: "2026-10-01T12:00:00.000Z",
};

const revisar = tarefa({
  id: "t1",
  titulo: "Revisar PR do relatório mensal",
  listaId: "trabalho",
  hora: "10:00",
  prioridade: 3,
  duracaoEstimadaMin: 50,
  lembreteMinutosAntes: 15,
  notas: "Conferir os totais por categoria.",
  etiquetas: [{ id: "e1", nome: "pr-142" }],
  origem: "agente",
  agenteId: "alba",
  criadoEm: as("18:12", "2026-10-07"),
  atualizadoEm: as("18:12", "2026-10-07"),
});
const ler = tarefa({
  id: "s1",
  titulo: "Ler a descrição",
  tarefaPaiId: "t1",
  estado: "feita",
  concluidaEm: as("09:00"),
});
const conferir = tarefa({ id: "s2", titulo: "Conferir os totais", tarefaPaiId: "t1" });

const evento = (extra: Partial<EventoAgenda> = {}): EventoAgenda => ({
  id: "ev1",
  calendarioId: "m",
  titulo: "Consulta no dentista",
  descricao: "Levar os exames de setembro.",
  inicio: as("14:00"),
  fim: as("15:00"),
  diaInteiro: false,
  local: "Rua das Acácias, 120",
  recorrencia: null,
  alertas: [30, 1440],
  editavel: true,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: as("20:05", "2026-10-07"),
  atualizadoEm: as("20:05", "2026-10-07"),
  ...extra,
});
const ocorrenciaDe = (e: EventoAgenda): Ocorrencia => ({
  eventoId: e.id,
  calendarioId: e.calendarioId,
  titulo: e.titulo,
  inicio: e.inicio,
  fim: e.fim,
  diaInteiro: e.diaInteiro,
  local: e.local,
  recorrente: e.recorrencia !== null,
  editavel: e.editavel,
});

interface Mundo {
  hoje?: Tarefa[];
  eventos?: EventoAgenda[];
  google?: Conexao | null;
}

/** As respostas do serviço; o que muda volta como o serviço devolveria. */
function responder({ hoje = [revisar, ler, conferir], eventos = [], google = GOOGLE }: Mundo = {}) {
  const porId = new Map(hoje.map((t) => [t.id, t]));
  const mudar = (id: string, { etiquetas, ...campos }: { etiquetas?: string[] }) => {
    const nova = {
      ...porId.get(id)!,
      ...campos,
      ...(etiquetas ? { etiquetas: etiquetas.map((nome) => ({ id: `e-${nome}`, nome })) } : {}),
      atualizadoEm: AGORA.toISOString(),
    } as Tarefa;
    porId.set(id, nova);
    return nova;
  };
  const eventosPorId = new Map(eventos.map((e) => [e.id, e]));
  falso.servidor = {
    "config.obter": {
      config: { dia: { fuso: "America/Sao_Paulo", expediente: { inicio: "09:00", fim: "18:00" } } },
      portable: false,
      falhasAtalhos: {},
    },
    "areas.contagens": { tarefasPendentes: 1, lembretesAtrasados: 0, sessoesEsperando: 0, devPrecisando: 0 },
    "listas.listar": LISTAS,
    "tarefas.listar": (p: { vista?: string }) =>
      p.vista === "hoje" ? hoje : p.vista === undefined ? hoje.filter((t) => t.estado === "aberta") : [],
    "lembretes.listar": [],
    "tarefas.definir": ({ id, ...campos }: { id: string }) => mudar(id, campos),
    "tarefas.mover": ({ id, listaId }: { id: string; listaId: string }) => mudar(id, { listaId }),
    "tarefas.concluir": ({ id }: { id: string }) => ({
      tarefa: mudar(id, { estado: "feita" }),
      proxima: null,
    }),
    "tarefas.criar": (n: { titulo: string }) => tarefa({ id: "nova", ...n }),
    "tarefas.apagar": ({ id }: { id: string }) => ({ ids: [id] }),
    "foco.iniciar": {},
    "agenda.consultar": {
      ocorrencias: eventos.map(ocorrenciaDe),
      dias: [{ dia: HOJE, livres: [], livreMin: 0, planejadoMin: 0, cheio: false, sugestoes: [] }],
    },
    "agenda.calendarios": [LOCAL, ESPELHO, TRABALHO],
    "conexoes.listar": google ? [google] : [],
    "agenda.obterEvento": ({ id }: { id: string }) => {
      const e = eventosPorId.get(id);
      if (!e) throw new RecusaDoServico("evento não encontrado");
      return e;
    },
    "agenda.definirEvento": ({ id, ...campos }: { id: string }) => {
      const novo = { ...eventosPorId.get(id)!, ...campos, atualizadoEm: AGORA.toISOString() };
      eventosPorId.set(id, novo);
      return novo;
    },
    "agenda.apagarEvento": ({ id }: { id: string }) => ({ ids: [id] }),
    "conversas.abrir": {
      id: "c-alba",
      tipo: "agente",
      agenteId: "alba",
      titulo: null,
      arquivada: false,
      criadoEm: AGORA.toISOString(),
    },
    "conversas.enviar": { mensagem: {}, agentes: ["alba"] },
  };
}

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
        <Tarefas />
      </AcoesSistemaContexto.Provider>,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(AGORA);
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  ir.mockClear();
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  vi.useRealTimers();
});

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor);
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];
const detalhe = () => por(".tarefas-detalhe");
const botao = (texto: string) => todos("button").find((b) => b.textContent === texto);
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
/** O campo pelo rótulo, dentro do detalhe. */
function campo<T extends HTMLElement = HTMLInputElement>(rotulo: string): T {
  const label = [...detalhe()!.querySelectorAll("label")].find((l) => l.textContent === rotulo);
  if (!label) throw new Error(`sem o campo ${rotulo}`);
  return document.getElementById(label.htmlFor) as unknown as T;
}

/** Digita no campo e sai dele, como a pessoa faria. */
async function escreverESair(alvo: HTMLInputElement | HTMLTextAreaElement, texto: string) {
  await act(async () => {
    alvo.focus();
    alvo.value = texto;
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
    alvo.blur();
  });
}

async function escolher(alvo: HTMLSelectElement, valor: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    set.call(alvo, valor);
    alvo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const tecla = (alvo: HTMLElement, key: string) =>
  act(async () => {
    alvo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

const avisar = (evento: string, dados: unknown) =>
  act(async () => {
    falso.ouvintes.get(evento)?.forEach((fn) => fn(dados));
    vi.advanceTimersByTime(0);
  });

const abrirTarefa = (id: string) => act(async () => por(`[data-tarefa="${id}"] .tarefa-abrir`)!.click());

describe("o detalhe da tarefa", () => {
  it("abre no lugar da Agenda com os campos do quadro, a origem e as subtarefas", async () => {
    responder();
    await montar();
    expect(por(".tarefas-agenda")).not.toBeNull();
    await abrirTarefa("t1");

    expect(detalhe()?.getAttribute("aria-label")).toBe("Detalhe da tarefa");
    expect(por(".tarefas-agenda")).toBeNull();
    expect(por('[data-tarefa="t1"]')?.hasAttribute("data-aberta")).toBe(true);
    expect(por(".tarefas-detalhe-rotulo")?.textContent).toBe("Trabalho · tarefa");
    expect(campo("Título").value).toBe("Revisar PR do relatório mensal");
    expect(document.activeElement).toBe(campo("Título"));
    expect(por(".tarefas-detalhe-origem")?.textContent).toBe("Criada pela Alba· ontem, 18:12");
    expect(campo<HTMLTextAreaElement>("Notas").value).toBe("Conferir os totais por categoria.");
    expect(por('[role="radiogroup"][aria-label="Prioridade"] [aria-checked="true"]')?.textContent).toBe(
      "Alta",
    );
    expect(campo<HTMLSelectElement>("Lista").value).toBe("trabalho");
    expect(campo("Data").value).toBe(HOJE);
    expect(campo("Hora").value).toBe("10:00");
    expect(campo<HTMLSelectElement>("Duração").selectedOptions[0]?.textContent).toBe("50 min");
    expect(campo<HTMLSelectElement>("Repetir").selectedOptions[0]?.textContent).toBe("Não repete");
    expect(campo<HTMLSelectElement>("Lembrete").selectedOptions[0]?.textContent).toBe("15 min antes · 09:45");
    expect(por(".tarefas-detalhe-faixa")?.textContent).toBe(
      "Com hora, vira evento no calendário “Moductus”: o celular avisa às 09:45.vai ao Google",
    );
    expect(por(".tarefas-detalhe-subtarefas-cabeca")?.textContent).toBe("Subtarefas1 de 2");
    expect(todos(".tarefas-detalhe-subtarefa-titulo").map((s) => s.textContent)).toEqual([
      "Ler a descrição",
      "Conferir os totais",
    ]);
    expect(todos(".tarefas-detalhe-chip").map((c) => c.textContent)).toEqual(["pr-142"]);
    expect(por(".tarefas-detalhe-salvo")?.textContent).toBe("salvo há 16 h");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("cada campo grava sozinho: título no Enter, hora ao sair, lembrete e prioridade na escolha", async () => {
    responder();
    await montar();
    await abrirTarefa("t1");

    const titulo = campo("Título");
    await act(async () => {
      titulo.value = "Revisar o PR";
    });
    await tecla(titulo, "Enter");
    expect(pedidosDe("tarefas.definir")).toEqual([{ id: "t1", titulo: "Revisar o PR" }]);

    // Mudar a hora: só a hora vai; o lembrete e o Google ficam com o serviço.
    await escreverESair(campo("Hora"), "11:30");
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", hora: "11:30" });
    expect(campo<HTMLSelectElement>("Lembrete").selectedOptions[0]?.textContent).toBe("15 min antes · 11:15");

    await escolher(campo<HTMLSelectElement>("Lembrete"), "1440");
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", lembreteMinutosAntes: 1440 });
    expect(por(".tarefas-detalhe-faixa-texto")?.textContent).toBe(
      "Com hora, vira evento no calendário “Moductus”: o celular avisa 1 dia antes.",
    );

    await act(async () =>
      todos('[role="radio"]')
        .find((r) => r.textContent === "Baixa")!
        .click(),
    );
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", prioridade: 1 });

    await escolher(campo<HTMLSelectElement>("Repetir"), "FREQ=WEEKLY");
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", recorrencia: "FREQ=WEEKLY" });

    await escolher(campo<HTMLSelectElement>("Lista"), "entrada");
    expect(pedidosDe("tarefas.mover")).toEqual([{ id: "t1", listaId: "entrada" }]);

    // Tirar o dia leva a hora junto (o serviço faz) e o lembrete fica sem escolha.
    await escreverESair(campo("Data"), "");
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", venceEm: null });
    expect(por(".tarefas-detalhe-salvo")?.textContent).toBe("salvo agora");
  });

  it("o título gravado ao passar para as notas não puxa o foco de volta", async () => {
    responder();
    await montar();
    await abrirTarefa("t1");
    const notas = campo<HTMLTextAreaElement>("Notas");
    await act(async () => {
      campo("Título").value = "Revisar o PR";
      notas.focus();
    });
    expect(pedidosDe("tarefas.definir")).toEqual([{ id: "t1", titulo: "Revisar o PR" }]);
    expect(campo("Título").value).toBe("Revisar o PR");
    expect(document.activeElement).toBe(notas);
  });

  it("título vazio volta ao que era, sem pedido; a recusa aparece no detalhe", async () => {
    responder();
    await montar();
    await abrirTarefa("t1");
    await escreverESair(campo("Título"), "   ");
    expect(campo("Título").value).toBe("Revisar PR do relatório mensal");
    expect(pedidosDe("tarefas.definir")).toEqual([]);

    falso.servidor["tarefas.definir"] = () => {
      throw new RecusaDoServico("lembrete só em tarefa com hora");
    };
    await escolher(campo<HTMLSelectElement>("Duração"), "90");
    expect(detalhe()?.querySelector('[role="alert"]')?.textContent).toBe("Lembrete só em tarefa com hora");
  });

  it("subtarefa nova, etiqueta posta e tirada, e marcar feita", async () => {
    responder();
    await montar();
    await abrirTarefa("t1");

    const nova = campo("Nova subtarefa");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(nova, "Aprovar ou pedir mudanças");
      nova.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tecla(nova, "Enter");
    expect(pedidosDe("tarefas.criar")).toEqual([
      { titulo: "Aprovar ou pedir mudanças", tarefaPaiId: "t1", listaId: "trabalho" },
    ]);

    await act(async () => botao("+ Etiqueta")!.click());
    const etiqueta = campo("Nova etiqueta");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(etiqueta, "relatorio");
      etiqueta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tecla(etiqueta, "Enter");
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", etiquetas: ["pr-142", "relatorio"] });
    expect(todos(".tarefas-detalhe-chip").map((c) => c.textContent)).toEqual(["pr-142", "relatorio"]);
    await act(async () => por('[aria-label="Tirar a etiqueta pr-142"]')!.click());
    expect(pedidosDe("tarefas.definir").at(-1)).toEqual({ id: "t1", etiquetas: ["relatorio"] });

    await act(async () =>
      detalhe()!.querySelector<HTMLElement>('[role="checkbox"][aria-label="Feita"]')!.click(),
    );
    expect(pedidosDe("tarefas.concluir")).toEqual([{ id: "t1" }]);
  });

  it("Esc fecha, a Agenda volta e o foco volta ao título que abriu", async () => {
    responder();
    await montar();
    const abriu = por('[data-tarefa="t1"] .tarefa-abrir')!;
    await act(async () => {
      abriu.focus();
      abriu.click();
    });
    await tecla(campo("Título"), "Escape");
    expect(detalhe()).toBeNull();
    expect(por(".tarefas-agenda")).not.toBeNull();
    expect(document.activeElement).toBe(por('[data-tarefa="t1"] .tarefa-abrir'));
  });

  it("Começar foco começa ligado à tarefa e vai ao Foco; apagar fecha", async () => {
    responder();
    await montar();
    await abrirTarefa("t1");
    await act(async () => botao("Começar foco")!.click());
    expect(pedidosDe("foco.iniciar")).toEqual([{ tipo: "foco", tarefaId: "t1" }]);
    expect(ir).toHaveBeenCalledWith({ area: "foco" });
    await act(async () => botao("Apagar tarefa")!.click());
    expect(pedidosDe("tarefas.apagar")).toEqual([{ id: "t1" }]);
    expect(detalhe()).toBeNull();
  });

  it("a tarefa que vai para a Lixeira por outro caminho fecha o detalhe; sem Google, sem a faixa", async () => {
    responder({ google: null });
    await montar();
    await abrirTarefa("t1");
    expect(por(".tarefas-detalhe-faixa")).toBeNull();
    await avisar("tarefas.mudou", { tarefas: [], apagadas: ["t1"] });
    expect(detalhe()).toBeNull();
  });
});

describe("o detalhe do evento", () => {
  const abrirEvento = (nome: string) =>
    act(async () => por(`.tarefas-agenda-bloco-abrir[aria-label^="${nome}"]`)!.click());

  it("o do Moductus abre para editar, com calendário, quando, alertas e a linha do Google", async () => {
    responder({ eventos: [evento()] });
    await montar();
    await abrirEvento("Consulta no dentista");

    expect(detalhe()?.getAttribute("aria-label")).toBe("Detalhe do evento");
    expect(pedidosDe("agenda.obterEvento")).toEqual([{ id: "ev1" }]);
    expect(por(".tarefas-agenda-bloco")?.hasAttribute("data-aberto")).toBe(true);
    expect(campo("Título").value).toBe("Consulta no dentista");
    expect(por(".tarefas-detalhe-origem")?.textContent).toBe("Criado por você· ontem, 20:05");
    expect(
      todos(".tarefas-detalhe-calendario").map((c) => [
        c.querySelector(".tarefas-detalhe-calendario-nome")?.textContent,
        c.querySelector("input")!.checked,
        c.querySelector("input")!.disabled,
      ]),
    ).toEqual([
      ["Local", false, false],
      ["Moductus", true, false],
      ["Trabalho", false, true],
    ]);
    expect(campo("Data de início").value).toBe(HOJE);
    expect(campo("Hora de início").value).toBe("14:00");
    expect(campo("Hora do fim").value).toBe("15:00");
    expect(todos(".tarefas-detalhe-chip").map((c) => c.textContent)).toEqual(["1 dia antes", "30 min antes"]);
    expect(por(".tarefas-detalhe-google")?.textContent).toBe(
      "vai ao Google· o celular avisa 1 dia e 30 min antes",
    );
    expect(por(".tarefas-detalhe-rodape")?.textContent).toContain("sai também do Google");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("mudar o começo leva o fim junto; o calendário passa ao local; alerta sai e entra", async () => {
    responder({ eventos: [evento()] });
    await montar();
    await abrirEvento("Consulta no dentista");

    await escreverESair(campo("Hora de início"), "16:00");
    expect(pedidosDe("agenda.definirEvento")).toEqual([
      { id: "ev1", diaInteiro: false, inicio: as("16:00"), fim: as("17:00") },
    ]);
    expect(campo("Hora do fim").value).toBe("17:00");

    await escreverESair(campo("Hora do fim"), "15:30");
    expect(detalhe()?.querySelector('[role="alert"]')?.textContent).toBe("O fim vem depois do começo.");
    expect(pedidosDe("agenda.definirEvento")).toHaveLength(1);

    await act(async () => {
      const local = todos(".tarefas-detalhe-calendario input")[0] as HTMLInputElement;
      local.click();
    });
    expect(pedidosDe("agenda.definirEvento").at(-1)).toEqual({ id: "ev1", calendarioId: "local" });
    expect(por(".tarefas-detalhe-google")?.textContent).toBe("Fica só neste PC, sem aviso no celular.");

    await act(async () => por('[aria-label="Tirar o alerta 30 min antes"]')!.click());
    expect(pedidosDe("agenda.definirEvento").at(-1)).toEqual({ id: "ev1", alertas: [1440] });
    await act(async () => botao("+ Alerta")!.click());
    await escolher(campo<HTMLSelectElement>("Novo alerta"), "10");
    expect(pedidosDe("agenda.definirEvento").at(-1)).toEqual({ id: "ev1", alertas: [1440, 10] });

    await act(async () => por('[role="switch"]')!.click());
    expect(pedidosDe("agenda.definirEvento").at(-1)).toEqual({
      id: "ev1",
      diaInteiro: true,
      inicio: HOJE,
      fim: "2026-10-09",
    });
  });

  it("o de outro calendário abre só leitura, e o pedido vai para a conversa com a Alba", async () => {
    const planejamento = evento({
      id: "p",
      calendarioId: "g1",
      titulo: "Planejamento",
      inicio: as("11:00"),
      fim: as("12:00"),
      editavel: false,
      alertas: [10],
      local: "Sala 3",
      descricao: null,
      recorrencia: "FREQ=WEEKLY;BYDAY=TH",
      origem: "conexao",
    });
    responder({ eventos: [planejamento] });
    await montar();
    await abrirEvento("Planejamento");

    expect(detalhe()?.getAttribute("aria-label")).toBe("Detalhe do evento, só leitura");
    expect(detalhe()?.querySelector("input:not([type=radio]), select, textarea")).toBeNull();
    expect(por(".tarefas-detalhe-rotulo")?.textContent).toBe("Evento · Trabalhosó leitura");
    expect(todos(".tarefas-detalhe-campo-leitura").map((c) => c.textContent)).toEqual([
      "CalendárioTrabalho · Google",
      "Quandoquinta, 8 de outubro, 11:00–12:00",
      "RepetirToda qui",
      "Alertas10 min antes, do Google",
      "LocalSala 3",
    ]);
    expect(auditar(recipiente)).toEqual([]);

    await act(async () => botao("Pedir à Alba para mudar")!.click());
    const pedido = campo("O que mudar?");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(pedido, "passar para as 14h, só esta semana");
      pedido.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tecla(pedido, "Enter");
    expect(pedidosDe("conversas.abrir")).toEqual([{ agenteId: "alba" }]);
    expect(pedidosDe("conversas.enviar")).toEqual([
      {
        conversaId: "c-alba",
        conteudo:
          "Quero mudar o evento “Planejamento” (Trabalho · Google, quinta, 8 de outubro, 11:00–12:00): passar para as 14h, só esta semana",
      },
    ]);
    expect(pedidosDe("agenda.definirEvento")).toEqual([]);
    expect(por(".tarefas-detalhe-enviado")?.textContent).toContain("pede a sua aprovação");
    await act(async () => botao("Abrir a conversa")!.click());
    expect(ir).toHaveBeenCalledWith({ area: "agentes", secao: "alba" });
  });

  it("o evento apagado por outro caminho diz que saiu", async () => {
    responder({ eventos: [evento()] });
    await montar();
    await abrirEvento("Consulta no dentista");
    await avisar("agenda.mudou", { eventos: [], apagados: ["ev1"] });
    expect(detalhe()?.textContent).toContain("Este evento saiu da agenda.");
  });
});
