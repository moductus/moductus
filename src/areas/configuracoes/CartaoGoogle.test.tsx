// @vitest-environment happy-dom
import type { Calendario, Conexao, SituacaoGoogle, TipoConexao } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { SecaoConexoes } from "./Conexoes.tsx";

// O serviço é falso: cada pedido fica registrado; nenhum Google de verdade.
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
// A casca é falsa: nenhum navegador abre de verdade.
const casca = vi.hoisted(() => ({ invoke: vi.fn((..._: unknown[]) => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: casca.invoke }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conexao = (tipo: TipoConexao, mudar: Partial<Conexao> = {}): Conexao => ({
  tipo,
  estado: "desligada",
  conta: null,
  ultimoErro: null,
  conectadaEm: null,
  ...mudar,
});

const calendario = (id: string, nome: string, mudar: Partial<Calendario> = {}): Calendario => ({
  id,
  nome,
  fonte: "google",
  cor: null,
  espelho: false,
  podeEscrever: true,
  ler: false,
  sincronizadoEm: null,
  ...mudar,
});

const PESSOAL = "01K7PESSOAL00000000000000B";
const CALENDARIOS = [
  calendario("01K7LOCAL000000000000000AA", "Neste PC", { fonte: "local", ler: true }),
  calendario(PESSOAL, "Pessoal", { ler: true }),
  calendario("01K7MODUCTUS0000000000000A", "Moductus", { espelho: true, ler: true }),
  calendario("01K7FERIADOS0000000000000C", "Feriados no Brasil", { podeEscrever: false }),
];
const CONECTADA = conexao("google-agenda", {
  estado: "ligada",
  conta: "voce@gmail.com",
  conectadaEm: "2026-10-18T14:31:00.000Z",
});
const ENDERECO = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y";

const situacao = (mudar: Partial<SituacaoGoogle> = {}): SituacaoGoogle => ({
  autorizacao: null,
  lidaEm: null,
  fila: 0,
  clienteProprio: false,
  problema: null,
  ...mudar,
});

/** O serviço com o Google no estado pedido; ligar e desligar mudam como o de verdade. */
function servico(inicial: Conexao = conexao("google-agenda"), inicio: SituacaoGoogle = situacao()) {
  let google = inicial;
  let calendarios = CALENDARIOS;
  let atual = inicio;
  falso.responder = (metodo, dados) => {
    switch (metodo) {
      case "conexoes.listar":
        return Promise.resolve([conexao("hooks-claude-code"), conexao("github"), google]);
      case "conexoes.ligar":
        google = CONECTADA;
        return Promise.resolve(google);
      case "conexoes.desligar":
        google = conexao("google-agenda");
        return Promise.resolve(google);
      case "google.obter":
        return Promise.resolve(atual);
      case "google.atualizar":
        atual = { ...atual, lidaEm: "2026-10-18T14:40:00.000Z" };
        return Promise.resolve(atual);
      case "google.definirCliente": {
        const { cliente } = dados as { cliente: unknown };
        atual = { ...atual, clienteProprio: cliente !== null };
        return Promise.resolve(atual);
      }
      case "agenda.calendarios":
        return Promise.resolve(calendarios);
      case "agenda.definirCalendario": {
        const { id, ler } = dados as { id: string; ler: boolean };
        calendarios = calendarios.map((c) => (c.id === id ? { ...c, ler } : c));
        return Promise.resolve(calendarios.find((c) => c.id === id));
      }
      case "github.obter":
        return Promise.resolve({ itens: [], atualizadoEm: null });
      case "sessoes.listar":
        return Promise.resolve({ projetos: [], sessoes: [] });
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
  await act(async () => raiz!.render(<SecaoConexoes />));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  casca.invoke.mockReset();
  casca.invoke.mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  vi.useRealTimers();
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const google = () =>
  [...recipiente.querySelectorAll<HTMLElement>(".config-conexao")].find(
    (c) => c.querySelector("h3")?.textContent === "Google Agenda",
  )!;
const em = (seletor: string) => [...google().querySelectorAll<HTMLElement>(seletor)];
const botao = (texto: string) => em("button").find((b) => b.textContent === texto) as HTMLButtonElement;
const clicar = (alvo: string | HTMLElement) =>
  act(async () => (typeof alvo === "string" ? botao(alvo) : alvo).click());
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
const selo = () => google().querySelector(".config-conexao-linha .selo")!.textContent;
const emitir = (nome: string, dados: unknown) => act(async () => falso.ouvintes.get(nome)?.(dados));
function escrever(campo: HTMLInputElement, valor: string) {
  const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  definir.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Configurações › Conexões › Google Agenda", () => {
  it("vem primeiro; antes do navegador, o que a Alba pode fazer e o que sai do PC, e só o clique conecta", async () => {
    servico();
    await montar();
    expect(recipiente.querySelector(".config-conexao h3")!.textContent).toBe("Google Agenda");
    expect(selo()).toBe("desconectado");
    await clicar("Conectar");
    expect(pedidosDe("conexoes.ligar")).toEqual([]);
    expect(google().textContent).toContain("O que a Alba pode fazer");
    expect(google().textContent).toContain("Apagar evento seu, ler e-mail, contatos ou arquivos do Drive.");
    expect(google().textContent).toContain("Avançado");
    expect(auditar(recipiente)).toEqual([]);

    // "Agora não" e o Esc fecham sem pedir nada.
    await clicar("Agora não");
    expect(google().querySelector(".config-google-autorizar")).toBeNull();
    await clicar("Conectar");
    await act(async () =>
      google()
        .querySelector(".config-google-autorizar")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(google().querySelector(".config-google-autorizar")).toBeNull();
    expect(pedidosDe("conexoes.ligar")).toEqual([]);

    await clicar("Conectar");
    await clicar("Conectar com o Google");
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "google-agenda" }]);
    expect(selo()).toBe("conectado");
  });

  it("esperando o navegador: o prazo corre, abrir de novo vai pela casca e cancelar desconecta", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date"],
      now: new Date("2026-10-18T14:00:00.000Z"),
    });
    servico(
      conexao("google-agenda"),
      situacao({ autorizacao: { endereco: ENDERECO, venceEm: "2026-10-18T14:04:12.000Z" } }),
    );
    await montar();
    expect(selo()).toBe("esperando você no navegador");
    expect(google().querySelector(".config-google-prazo")!.textContent).toBe(
      "esperando · o prazo acaba em 4:12",
    );
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(google().querySelector(".config-google-prazo")!.textContent).toBe(
      "esperando · o prazo acaba em 4:10",
    );

    await clicar("Abrir de novo");
    expect(casca.invoke).toHaveBeenCalledWith("abrir_endereco", { endereco: ENDERECO });
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Cancelar");
    expect(pedidosDe("conexoes.desligar")).toEqual([{ tipo: "google-agenda" }]);
    // O serviço fecha a autorização e avisa: o cartão volta a oferecer a conexão.
    await emitir("google.mudou", situacao());
    expect(selo()).toBe("desconectado");
  });

  it("conectado: os calendários para marcar, o Moductus fixo, o resumo e Ler agora", async () => {
    servico(CONECTADA, situacao({ fila: 2, lidaEm: "2026-10-18T14:31:00.000Z" }));
    await montar();
    expect(selo()).toBe("conectado");
    expect(google().querySelector(".config-conexao-descricao")!.textContent).toBe(
      'voce@gmail.com · lê 1 calendário e escreve no "Moductus".',
    );
    expect(google().querySelector(".fala")!.textContent).toContain(
      'Conectei como voce@gmail.com e criei o calendário "Moductus".',
    );
    // O local fica fora; o Moductus vem primeiro, marcado e fixo.
    const caixas = em('[role="checkbox"]');
    expect(
      caixas.map((c) => [c.textContent, c.getAttribute("aria-checked"), c.getAttribute("aria-disabled")]),
    ).toEqual([
      ["Moductus", "true", "true"],
      ["Pessoal", "true", null],
      ["Feriados no Brasil", "false", null],
    ]);
    expect(em(".config-google-papel").map((p) => p.textContent)).toEqual(["escreve", "lê"]);
    expect(google().textContent).toContain(
      "Criar ou mudar evento em Pessoal sempre pede sua aprovação antes.",
    );
    const dados = em(".config-conexao-dado").map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ]);
    expect(dados.map(([rotulo]) => rotulo)).toEqual(["Conta", "Leitura", "Fila para o Google", "Autorizado"]);
    expect(dados[0]![1]).toBe("voce@gmail.com");
    expect(dados[2]![1]).toBe("2 itens");
    expect(auditar(recipiente)).toEqual([]);

    // O Moductus não desmarca; o Pessoal sim.
    await clicar(caixas[0]!);
    expect(pedidosDe("agenda.definirCalendario")).toEqual([]);
    await clicar(caixas[1]!);
    expect(pedidosDe("agenda.definirCalendario")).toEqual([{ id: PESSOAL, ler: false }]);
    expect(em('[role="checkbox"]')[1]!.getAttribute("aria-checked")).toBe("false");

    await clicar("Ler agora");
    expect(pedidosDe("google.atualizar")).toEqual([undefined]);
  });

  it("desconectar pede confirmação no lugar; manter fecha, e só o segundo clique desconecta", async () => {
    servico(CONECTADA);
    await montar();
    await clicar("Desconectar");
    expect(botao("Desconectar").getAttribute("aria-expanded")).toBe("true");
    const confirmar = google().querySelector('[aria-label="Desconectar o Google Agenda"]')!;
    expect(confirmar.textContent).toContain('Paro de ler seus calendários e de escrever no "Moductus".');
    expect(em('[role="checkbox"]')).toEqual([]);
    expect(auditar(recipiente)).toEqual([]);

    await clicar("Manter conectado");
    expect(google().querySelector('[aria-label="Desconectar o Google Agenda"]')).toBeNull();
    expect(pedidosDe("conexoes.desligar")).toEqual([]);

    await clicar("Desconectar");
    await clicar("Desconectar o Google");
    expect(pedidosDe("conexoes.desligar")).toEqual([{ tipo: "google-agenda" }]);
    expect(selo()).toBe("desconectado");
  });

  it("o Google não aceita mais a autorização: reconectar, com o que espera na fila", async () => {
    servico(
      { ...CONECTADA, estado: "erro", ultimoErro: "O Google não aceita mais a autorização do Moductus." },
      situacao({ problema: "reconectar", fila: 3 }),
    );
    await montar();
    expect(selo()).toBe("precisa reconectar");
    expect(google().textContent).toContain("O Google não aceita mais a autorização do Moductus.");
    expect(google().textContent).toContain('3 itens esperam na fila para o "Moductus".');
    await clicar("Reconectar");
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "google-agenda" }]);
  });

  it("a leitura falhou: Tentar agora lê de novo", async () => {
    servico(
      { ...CONECTADA, estado: "erro", ultimoErro: "Não consegui ler o Google Agenda." },
      situacao({ problema: "leitura" }),
    );
    await montar();
    expect(selo()).toBe("leitura falhou");
    await clicar("Tentar agora");
    expect(pedidosDe("google.atualizar")).toEqual([undefined]);
  });

  it("não conectou: o motivo do serviço, tentar de novo e o cliente próprio", async () => {
    servico(
      conexao("google-agenda", { estado: "erro", ultimoErro: "A autorização foi negada no Google." }),
      situacao({ problema: "conectar" }),
    );
    await montar();
    expect(selo()).toBe("não conectou");
    expect(google().textContent).toContain("A autorização foi negada no Google.");
    expect(botao("Usar meu próprio cliente")).toBeTruthy();
    await clicar("Tentar de novo");
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "google-agenda" }]);
  });

  it("cliente próprio: client ID e secret vão ao serviço, o secret some da tela e conecta em seguida", async () => {
    servico();
    await montar();
    await clicar("Conectar");
    await clicar("Usar meu próprio cliente");
    expect(google().textContent).toContain('Crie um cliente OAuth do tipo "App para computador"');
    expect(botao("Salvar e conectar").disabled).toBe(true);
    const [id, segredo] = em("input") as HTMLInputElement[];
    expect(segredo!.type).toBe("password");
    await act(async () => {
      escrever(id!, " meu.apps.googleusercontent.com ");
      escrever(segredo!, "segredo-meu");
    });
    expect(auditar(recipiente)).toEqual([]);
    await clicar("Salvar e conectar");
    expect(pedidosDe("google.definirCliente")).toEqual([
      { cliente: { id: "meu.apps.googleusercontent.com", segredo: "segredo-meu" } },
    ]);
    expect(pedidosDe("conexoes.ligar")).toEqual([{ tipo: "google-agenda" }]);
    expect(recipiente.innerHTML).not.toContain("segredo-meu");
    expect(selo()).toBe("conectado");
  });

  it("cliente próprio: Passo a passo abre o guia pela casca; Usar o do Moductus volta sem gravar", async () => {
    servico();
    await montar();
    await clicar("Conectar");
    await clicar("Usar meu próprio cliente");
    await clicar("Passo a passo");
    expect(casca.invoke).toHaveBeenCalledWith("abrir_endereco", {
      endereco: "https://developers.google.com/workspace/guides/create-credentials#desktop-app",
    });
    await clicar("Usar o cliente do Moductus");
    expect(pedidosDe("google.definirCliente")).toEqual([]);
    expect(botao("Conectar com o Google")).toBeTruthy();
  });
});
