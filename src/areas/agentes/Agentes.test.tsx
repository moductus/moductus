// @vitest-environment happy-dom
import type {
  Agente,
  Aprovacao,
  Conversa,
  ExecucaoDetalhada,
  Mensagem,
  SituacaoAgente,
} from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import type { Destino } from "../areas.ts";
import { Agentes, escreverLugar, lerLugar } from "./Agentes.tsx";

/*
 * A área Agentes contra um serviço de mentira: cada pedido fica registrado e a resposta vem de
 * `responder`; os eventos (`conversas.parcial`, `conversas.mensagem`, `aprovacoes.mudou`) são
 * disparados à mão, como o serviço faria durante uma resposta em streaming.
 */
const falso = vi.hoisted(() => ({
  pedidos: [] as { metodo: string; dados: unknown }[],
  responder: (_metodo: string, _dados: unknown): Promise<unknown> =>
    Promise.reject(new Error("sem resposta")),
  ouvintes: new Map<string, Set<(dados: unknown) => void>>(),
}));
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    pedir: (metodo: string, dados?: unknown) => {
      falso.pedidos.push({ metodo, dados });
      return falso.responder(metodo, dados);
    },
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!falso.ouvintes.has(nome)) falso.ouvintes.set(nome, new Set());
      falso.ouvintes.get(nome)!.add(fn);
      return () => falso.ouvintes.get(nome)?.delete(fn);
    },
  },
  useCanal: () => "conectado",
}));
vi.mock("../../nativo/eventos.ts", () => ({
  useServico: () => ({ estado: "pronto", porta: 1, token: "t" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSTANTE = new Date().toISOString();

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
    nome: id.charAt(0).toUpperCase() + id.slice(1),
    funcao: "Cuida do seu dinheiro",
    instrucoes: "Objetiva, acolhedora, precisa nos números.",
    personagem: { silhueta: "pera", traco: "coque", tom: "musgo" },
    ferramentas: ["tarefas.*"],
    provedorId: "p1",
    provedorReservaId: null,
    gatilhos: [],
    escoposMemoria: [],
    tetoDiarioCentavos: null,
    deFabrica: true,
    situacao: { ...ATIVO, ...situacao },
  };
}

const TIME: Conversa = {
  id: "01CT",
  tipo: "time",
  agenteId: null,
  titulo: null,
  arquivada: false,
  criadoEm: INSTANTE,
};
const DA_TULA: Conversa = { ...TIME, id: "01CU", tipo: "agente", agenteId: "tula" };

let sequencia = 0;
function mensagem(parte: Partial<Mensagem>): Mensagem {
  sequencia += 1;
  return {
    id: `01M${String(sequencia).padStart(4, "0")}`,
    conversaId: TIME.id,
    agenteId: null,
    conteudo: "",
    execucaoId: null,
    criadoEm: INSTANTE,
    ...parte,
  };
}

/** Serviço com as conversas vazias, que aceita o que se manda. */
function servicoDeConversas(rotear: string[] = ["tula", "alba"]) {
  falso.responder = (metodo, dados) => {
    switch (metodo) {
      case "conversas.listar":
        return Promise.resolve([TIME, DA_TULA]);
      case "aprovacoes.pendentes":
      case "agentes.listar":
        return Promise.resolve([]);
      case "conversas.mensagens":
        return Promise.resolve({ itens: [], proximo: null });
      case "conversas.abrir":
        return Promise.resolve((dados as { agenteId?: string }).agenteId ? DA_TULA : TIME);
      case "conversas.enviar": {
        const { conversaId, conteudo } = dados as { conversaId: string; conteudo: string };
        return Promise.resolve({ mensagem: mensagem({ conversaId, conteudo }), agentes: rotear });
      }
      case "conversas.apagar":
        return Promise.resolve([DA_TULA]);
      case "aprovacoes.decidir":
        return new Promise(() => undefined);
      default:
        return Promise.reject(new Error(`sem resposta para ${metodo}`));
    }
  };
}

let raiz: Root | null = null;
let recipiente: HTMLElement;
const idas: Destino[] = [];

async function montar(secao?: string) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Agentes secao={secao} ir={(d) => idas.push(d)} />));
}

async function emitir(nome: string, dados: unknown) {
  await act(async () => falso.ouvintes.get(nome)?.forEach((fn) => fn(dados)));
}

beforeEach(() => {
  falso.pedidos.length = 0;
  falso.ouvintes.clear();
  idas.length = 0;
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor);
const botao = (texto: string) =>
  [...recipiente.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === texto || b.getAttribute("aria-label") === texto,
  )!;
const pedidosDe = (metodo: string) => falso.pedidos.filter((p) => p.metodo === metodo).map((p) => p.dados);
/** As falas na conversa: quem e o que disse, na ordem da tela. */
const falas = () =>
  [...recipiente.querySelectorAll(".conversa-mensagens .fala, .conversa-eu")].map((el) =>
    el.classList.contains("conversa-eu")
      ? `Você: ${el.textContent!.replace("Você: ", "")}`
      : `${el.querySelector(".fala-nome")!.textContent}: ${el.querySelector(".fala-texto")!.textContent}`,
  );

async function escrever(texto: string) {
  const campo = por<HTMLTextAreaElement>("textarea")!;
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function teclarEnter() {
  await act(async () => {
    por("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("onde a área está", () => {
  it("lê e escreve a seção: time, conversa com um e a página dele", () => {
    expect(lerLugar(undefined)).toEqual({ tipo: "conversa", com: null });
    expect(lerLugar("tula")).toEqual({ tipo: "conversa", com: "tula" });
    expect(lerLugar("tula/pagina")).toEqual({ tipo: "pagina", agente: "tula" });
    expect(lerLugar("ninguem/pagina")).toEqual({ tipo: "conversa", com: null });
    expect([lerLugar("tula"), lerLugar("nuno/pagina")].map(escreverLugar)).toEqual(["tula", "nuno/pagina"]);
    expect(escreverLugar({ tipo: "conversa", com: null })).toBeUndefined();
  });
});

describe("conversa com o time", () => {
  it("pergunta com duas áreas: as duas respostas chegam em pedaços, assinadas, na mesma conversa", async () => {
    servicoDeConversas();
    await montar();
    expect(pedidosDe("conversas.abrir")).toEqual([{}]);

    await escrever("Quanto já foi de mercado? E tenho algo amanhã cedo?");
    await teclarEnter();
    expect(pedidosDe("conversas.enviar")).toEqual([
      { conversaId: TIME.id, conteudo: "Quanto já foi de mercado? E tenho algo amanhã cedo?" },
    ]);
    // O texto sai do campo quando o serviço aceitou; os dois escolhidos aparecem pensando.
    expect(por<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(falas()).toEqual([
      "Você: Quanto já foi de mercado? E tenho algo amanhã cedo?",
      "Tula: pensando…",
      "Alba: pensando…",
    ]);

    const tula = { conversaId: TIME.id, agenteId: "tula", execucaoId: "01E1" };
    await emitir("conversas.parcial", { ...tula, texto: "R$ 512 de R$ 600" });
    await emitir("conversas.parcial", { ...tula, texto: "R$ 512 de R$ 600 em mercado em outubro." });
    expect(falas()).toEqual([
      "Você: Quanto já foi de mercado? E tenho algo amanhã cedo?",
      "Tula: R$ 512 de R$ 600 em mercado em outubro.",
      "Alba: pensando…",
    ]);
    expect(por('.conversa-mensagens [aria-busy="true"]')).not.toBeNull();

    // Pronta, a resposta da Tula vira mensagem gravada e a fala em andamento sai.
    await emitir(
      "conversas.mensagem",
      mensagem({ agenteId: "tula", execucaoId: "01E1", conteudo: "R$ 512 de R$ 600 em mercado em outubro." }),
    );
    await emitir("conversas.parcial", { ...tula, texto: "pedaço atrasado" });
    await emitir(
      "conversas.mensagem",
      mensagem({
        agenteId: "alba",
        execucaoId: "01E2",
        conteudo: "Amanhã a primeira coisa é a Daily, às 9h30.",
      }),
    );
    expect(falas()).toEqual([
      "Você: Quanto já foi de mercado? E tenho algo amanhã cedo?",
      "Tula: R$ 512 de R$ 600 em mercado em outubro.",
      "Alba: Amanhã a primeira coisa é a Daily, às 9h30.",
    ]);
    expect(por('.conversa-mensagens [aria-busy="true"]')).toBeNull();
    // A lista mostra a última fala do time, com quem disse.
    expect(por('[aria-current="page"] .conversas-item-ultima')!.textContent).toBe(
      "Alba: Amanhã a primeira coisa é a Daily, às 9h30.",
    );
    expect(auditar(recipiente)).toEqual([]);
  });

  it("pedido de aprovação aparece dentro da fala de quem pediu, com o verbo e o objeto", async () => {
    servicoDeConversas(["faina"]);
    await montar();
    await escrever("@faina tira os instaladores velhos de Downloads");
    await act(async () => botao("Enviar").click());
    await emitir("conversas.parcial", {
      conversaId: TIME.id,
      agenteId: "faina",
      execucaoId: "01E3",
      texto: "",
    });
    const aprovacao: Aprovacao = {
      id: "01AP",
      fonte: "moductus",
      agenteId: "faina",
      execucaoId: "01E3",
      sessaoId: null,
      descricao: "Achei 38 instaladores (1,4 GB) com mais de 60 dias. Vou mover para a Lixeira.",
      acao: {
        ferramenta: "arquivos.mover",
        entrada: {},
        rotulo: "Mover 38 arquivos",
        rotuloRecusar: "Não mover",
        desfazivel: true,
      },
      estado: "pendente",
      criadoEm: INSTANTE,
      decididaEm: null,
      regraCriadaId: null,
      admiteSempre: false,
    };
    await emitir("aprovacoes.mudou", aprovacao);
    expect(falas().at(-1)).toBe(`Faina: ${aprovacao.descricao}`);
    await act(async () => botao("Mover 38 arquivos").click());
    expect(pedidosDe("aprovacoes.decidir")).toEqual([{ id: "01AP", decisao: "permitir" }]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("as menções entram com um clique, e a fala vazia não sai", async () => {
    servicoDeConversas();
    await montar();
    expect(botao("Enviar").disabled).toBe(true);
    await act(async () => botao("Mencionar Tula").click());
    expect(por<HTMLTextAreaElement>("textarea")!.value).toBe("@tula ");
    await escrever("   ");
    await teclarEnter();
    expect(pedidosDe("conversas.enviar")).toEqual([]);
  });

  it("recusa do serviço aparece embaixo, e o texto fica no campo para tentar de novo", async () => {
    servicoDeConversas();
    const aceita = falso.responder;
    falso.responder = (metodo, dados) => {
      if (metodo !== "conversas.enviar") return aceita(metodo, dados);
      return Promise.reject(new RecusaDoServico("o agente está desligado"));
    };
    await montar();
    await escrever("oi");
    await teclarEnter();
    expect(por('[role="alert"]')!.textContent).toBe("O agente está desligado");
    expect(por<HTMLTextAreaElement>("textarea")!.value).toBe("oi");
  });
});

describe("conversa com um agente", () => {
  it("a lista leva a cada um, e o cabeçalho leva à página dele", async () => {
    servicoDeConversas();
    await montar("tula");
    expect(pedidosDe("conversas.abrir")).toEqual([{ agenteId: "tula" }]);
    expect(por(".conversa-nome")!.textContent).toBe("Tula");
    await act(async () => botao("Página da Tula").click());
    expect(idas).toEqual([{ area: "agentes", secao: "tula/pagina" }]);

    const nuno = [...recipiente.querySelectorAll<HTMLButtonElement>(".conversas-item")].find((b) =>
      b.textContent!.startsWith("Nuno"),
    )!;
    await act(async () => nuno.click());
    expect(idas.at(-1)).toEqual({ area: "agentes", secao: "nuno" });
  });

  it("apagar pede confirmação, manda para a lixeira e abre uma conversa vazia", async () => {
    servicoDeConversas();
    await montar("tula");
    await act(async () => botao("Apagar").click());
    expect(pedidosDe("conversas.apagar")).toEqual([]);
    await act(async () => botao("Apagar conversa").click());
    expect(pedidosDe("conversas.apagar")).toEqual([{ id: DA_TULA.id }]);
    expect(pedidosDe("conversas.abrir")).toEqual([{ agenteId: "tula" }, { agenteId: "tula" }]);
    expect(botao("Apagar conversa")).toBeUndefined();
  });
});

describe("confirmação de apagar", () => {
  it("o foco vai para Manter, Esc desiste e devolve o foco, e trocar de conversa fecha", async () => {
    servicoDeConversas();
    await montar("tula");
    await act(async () => botao("Apagar").click());
    expect(document.activeElement).toBe(botao("Manter"));

    await act(async () => {
      botao("Manter").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(botao("Apagar conversa")).toBeUndefined();
    expect(document.activeElement).toBe(botao("Apagar"));

    await act(async () => botao("Apagar").click());
    await act(async () => raiz!.render(<Agentes secao="nuno" ir={(d) => idas.push(d)} />));
    expect(por(".conversa-nome")!.textContent).toBe("Nuno");
    expect(botao("Apagar conversa")).toBeUndefined();
    expect(document.activeElement).not.toBe(botao("Apagar"));
    expect(pedidosDe("conversas.apagar")).toEqual([]);
  });
});

describe("página do agente", () => {
  const hoje = new Date();
  const as = (h: number, m = 0) =>
    new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), h, m).toISOString();
  const detalhe: ExecucaoDetalhada = {
    id: "01E9",
    agenteId: "tula",
    gatilho: "mensagem",
    provedorId: "p1",
    inicio: as(0, 1),
    fim: as(0, 2),
    estado: "ok",
    erro: null,
    tokensEntrada: null,
    tokensSaida: null,
    custoEstimadoMicrodolares: null,
    cobranca: "assinatura",
    resumo: "Criou lembrete da fatura para sexta",
    chamadas: [
      {
        id: "01CH",
        execucaoId: "01E9",
        ferramenta: "tarefas.criar",
        efeito: "interno",
        entrada: {},
        resultado: {},
        aprovacaoId: null,
        criadoEm: as(0, 1),
        desfeitaEm: null,
        desfazerAte: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
  };

  function servicoDaTula(situacao: Partial<SituacaoAgente> = { atividade: "trabalhando" }) {
    let tula = agente("tula", situacao);
    falso.responder = (metodo) => {
      switch (metodo) {
        case "agentes.obter":
          return Promise.resolve(tula);
        case "agentes.capacidades":
          return Promise.resolve([
            { nome: "tarefas.criar", descricao: "Cria uma tarefa", efeito: "interno" },
            { nome: "github.comentar", descricao: "Comenta num PR", efeito: "externo" },
          ]);
        case "conexoes.listar":
          return Promise.resolve([]);
        case "execucoes.listar": {
          const { chamadas: _, ...execucao } = detalhe;
          return Promise.resolve({ itens: [execucao], proximo: null });
        }
        case "execucoes.obter":
          return Promise.resolve(detalhe);
        case "execucoes.desfazer":
          return Promise.resolve({ ...detalhe.chamadas[0], desfeitaEm: INSTANTE, desfazerAte: null });
        case "agentes.pausar":
          tula = agente("tula", { estado: "pausado" });
          return Promise.resolve([tula]);
        default:
          return Promise.reject(new Error(`sem resposta para ${metodo}`));
      }
    };
  }

  it("mostra quem é, o que está fazendo, as permissões e o dia com desfazer", async () => {
    servicoDaTula();
    await montar("tula/pagina");
    expect(por("h1")!.textContent).toBe("Tula");
    expect(por(".pagina-agente-nome .selo")!.textContent).toBe("trabalhando");
    expect(recipiente.textContent).toContain("Agora: trabalhando");
    expect(por(".pagina-agente-permissao[data-tom='aviso']")!.textContent).toBe(
      "Pergunta antesgithub.comentar",
    );
    expect(recipiente.textContent).toContain("Hoje: 1 execução, pela assinatura.");
    expect(recipiente.textContent).toContain("Modelo escolhido · sua assinatura");
    expect(recipiente.textContent).toContain("Nenhum vigia ligado ainda.");

    await act(async () => botao("Desfazer: Criou lembrete da fatura para sexta").click());
    expect(pedidosDe("execucoes.desfazer")).toEqual([{ chamadaId: "01CH" }]);
    expect(auditar(recipiente)).toEqual([]);
  });

  it("desfaz da última chamada para a primeira e para na primeira recusa", async () => {
    servicoDaTula();
    const base = falso.responder;
    const [primeira] = detalhe.chamadas;
    const segunda = { ...primeira!, id: "01CI", criadoEm: as(0, 2) };
    falso.responder = (metodo, dados) => {
      if (metodo === "execucoes.obter") return Promise.resolve({ ...detalhe, chamadas: [primeira, segunda] });
      if (metodo === "execucoes.desfazer") {
        return Promise.reject(new RecusaDoServico("o lembrete já foi apagado à mão"));
      }
      return base(metodo, dados);
    };
    await montar("tula/pagina");
    await act(async () => botao("Desfazer: Criou lembrete da fatura para sexta").click());
    // A segunda (a mais nova) vai primeiro; recusada, a primeira nem é pedida.
    expect(pedidosDe("execucoes.desfazer")).toEqual([{ chamadaId: "01CI" }]);
    expect(por('[role="alert"]')!.textContent).toBe("O lembrete já foi apagado à mão");
  });

  it("pausar vale na hora, e o botão vira retomar", async () => {
    servicoDaTula();
    await montar("tula/pagina");
    await act(async () => botao("Pausar a Tula").click());
    expect(pedidosDe("agentes.pausar")).toEqual([{ agenteId: "tula", ate: null }]);
    expect(botao("Retomar a Tula")).toBeDefined();
    expect(recipiente.textContent).toContain("Em pausa até você retomar");

    await act(async () => botao("Conversar").click());
    expect(idas).toEqual([{ area: "agentes", secao: "tula" }]);
  });

  it("as abas andam pelas setas e o histórico diz o custo com a fonte", async () => {
    servicoDaTula();
    await montar("tula/pagina");
    const abas = [...recipiente.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(abas.map((a) => a.textContent)).toEqual([
      "Visão geral",
      "Histórico",
      "Instruções",
      "Ferramentas",
      "Memória",
    ]);
    await act(async () => {
      abas[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(abas[1]!.getAttribute("aria-selected")).toBe("true");
    expect(por(".pagina-agente-custo")!.textContent).toBe("assinatura");
    await act(async () => abas[2]!.click());
    expect(por(".pagina-agente-instrucoes")!.textContent).toBe("Objetiva, acolhedora, precisa nos números.");
    expect(auditar(recipiente)).toEqual([]);
  });
});
