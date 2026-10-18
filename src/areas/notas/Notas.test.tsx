// @vitest-environment happy-dom
import type { Nota, Tarefa } from "@moductus/contrato";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../../teste/acessibilidade.ts";
import { esquecerRascunhos } from "./notas.ts";
import { Notas } from "./Notas.tsx";

/*
 * Sistema · Notas contra um serviço de mentira que guarda as notas na memória e se comporta como o
 * da F3-19 no que a tela depende: a versão (`atualizadoEm`) que recusa o salvar atrasado, o aviso
 * `notas.mudou` antes da resposta, o bloco rápido que esvazia e a busca que ignora acento.
 */
const falso = vi.hoisted(() => {
  const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
  return {
    notas: new Map<string, Nota>(),
    tarefas: [] as Tarefa[],
    pedidos: [] as { metodo: string; dados: unknown }[],
    relogio: 0,
    ouvintes,
    emitir(nome: string, dados: unknown) {
      for (const fn of ouvintes.get(nome) ?? []) fn(dados);
    },
  };
});

// Sempre depois da anterior, como a versão do serviço.
const versao = () => new Date(Date.now() + ++falso.relogio).toISOString();
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const resumo = (n: Nota) => {
  const { conteudo, ...resto } = n;
  return { ...resto, trecho: conteudo.split("\n").filter(Boolean).join(" · ").slice(0, 140) };
};

function responder(metodo: string, dados: Record<string, unknown> = {}): unknown {
  const n = typeof dados.id === "string" ? falso.notas.get(dados.id) : undefined;
  switch (metodo) {
    case "notas.listar":
      return [...falso.notas.values()]
        .sort(
          (a, b) =>
            Number(b.id === "bloco_rapido") - Number(a.id === "bloco_rapido") ||
            b.atualizadoEm.localeCompare(a.atualizadoEm),
        )
        .map(resumo);
    case "notas.obter":
      if (!n) throw new Error("nota não encontrada");
      return n;
    case "notas.criar": {
      const agora = versao();
      const nova: Nota = {
        ...NOTA,
        id: `01NOVA${falso.relogio}`,
        titulo: String(dados.titulo ?? ""),
        conteudo: String(dados.conteudo ?? ""),
        criadoEm: agora,
        atualizadoEm: agora,
      };
      falso.notas.set(nova.id, nova);
      falso.emitir("notas.mudou", { notas: [nova], apagadas: [] });
      return nova;
    }
    case "notas.salvar": {
      if (!n) throw new Error("nota não encontrada");
      const texto = {
        titulo: String(dados.titulo ?? n.titulo),
        conteudo: String(dados.conteudo ?? n.conteudo),
      };
      if (dados.versao !== n.atualizadoEm) return { salvou: false, atual: n, recusada: texto };
      const salva = { ...n, ...texto, atualizadoEm: versao() };
      falso.notas.set(salva.id, salva);
      falso.emitir("notas.mudou", { notas: [salva], apagadas: [] });
      return { salvou: true, nota: salva };
    }
    case "notas.apagar": {
      if (!n) throw new Error("nota não encontrada");
      if (n.id === "bloco_rapido") {
        const vazio = { ...n, conteudo: "", atualizadoEm: versao() };
        falso.notas.set(n.id, vazio);
        falso.emitir("notas.mudou", { notas: [vazio], apagadas: [] });
        return { ids: [] };
      }
      falso.notas.delete(n.id);
      falso.emitir("notas.mudou", { notas: [], apagadas: [n.id] });
      return { ids: [n.id] };
    }
    case "notas.buscar": {
      const busca = semAcento(String(dados.texto));
      return [...falso.notas.values()]
        .filter((x) => semAcento(`${x.titulo} ${x.conteudo}`).includes(busca))
        .map((x) => {
          const inicio = semAcento(x.conteudo).indexOf(busca);
          return {
            ...resumo(x),
            trecho: x.conteudo,
            destaques: inicio < 0 ? [] : [{ inicio, fim: inicio + busca.length }],
          };
        });
    }
    case "tarefas.listar":
      return falso.tarefas.filter((t) => t.notaId === dados.notaId);
  }
  throw new Error(`sem resposta para ${metodo}`);
}

vi.mock("../../servico/conexao.ts", () => ({
  useCanal: () => "conectado",
  servico: {
    pedir: (metodo: string, dados?: Record<string, unknown>) => {
      falso.pedidos.push({ metodo, dados });
      try {
        return Promise.resolve(responder(metodo, dados));
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
const casca = vi.hoisted(() => ({ invoke: vi.fn((..._: unknown[]) => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: casca.invoke }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTA: Nota = {
  id: "01VIAGEM",
  titulo: "Ideias para a viagem de dezembro",
  conteudo: "Três dias na serra.\n\n## Antes de ir\n\n- [x] Reservar a pousada\n- [ ] Revisar o carro",
  fixada: false,
  pasta: "Pessoal · Viagem de dezembro",
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-18T11:00:00.000Z",
  atualizadoEm: "2026-10-18T11:00:00.000Z",
};

const BLOCO: Nota = {
  ...NOTA,
  id: "bloco_rapido",
  titulo: "Bloco rápido",
  conteudo: "código do portão 4471\ntrocar filtro da água",
  fixada: true,
  pasta: null,
  atualizadoEm: "2026-10-18T10:00:00.000Z",
};

const RECEITA: Nota = {
  ...NOTA,
  id: "01RECEITA",
  titulo: "Receita do pão",
  conteudo: "500 g de farinha, amanhã cedo",
  pasta: null,
  atualizadoEm: "2026-10-17T09:00:00.000Z",
};

const tarefa = (extra: Partial<Tarefa>): Tarefa => ({
  id: "t1",
  listaId: "entrada",
  tarefaPaiId: null,
  titulo: "Revisar o carro",
  notas: null,
  notaId: NOTA.id,
  prioridade: 0,
  venceEm: "2026-11-20",
  hora: null,
  duracaoEstimadaMin: null,
  recorrencia: null,
  estado: "aberta",
  concluidaEm: null,
  ordem: 0,
  etiquetas: [],
  lembreteMinutosAntes: null,
  origem: "agente",
  agenteId: "alba",
  execucaoId: null,
  criadoEm: "2026-10-18T11:00:00.000Z",
  atualizadoEm: "2026-10-18T11:00:00.000Z",
  ...extra,
});

const ir = vi.fn();
let raiz: Root | null = null;
let recipiente: HTMLElement;

async function andar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(secao?: string) {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  await act(async () => raiz!.render(<Notas secao={secao} ir={ir} />));
  // A carga, a nota aberta e o markdown-it, que vem à parte (o import dinâmico leva tempo de verdade).
  await andar();
  await act(async () => {
    await import("./markdown.ts");
  });
  await andar();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00.000Z"));
  falso.notas = new Map([BLOCO, NOTA, RECEITA].map((n) => [n.id, n]));
  falso.tarefas = [];
  falso.pedidos.length = 0;
  falso.relogio = 0;
  ir.mockReset();
  casca.invoke.mockReset();
  casca.invoke.mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
  esquecerRascunhos();
  vi.useRealTimers();
});

const por = <T extends HTMLElement = HTMLElement>(seletor: string) => recipiente.querySelector<T>(seletor);
const botao = (texto: string) =>
  [...recipiente.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto);
const salvos = () => falso.pedidos.filter((p) => p.metodo === "notas.salvar").map((p) => p.dados);

/** Escreve num campo controlado do React como o teclado escreveria. */
function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Clica no texto renderizado e devolve o campo do Markdown cru. */
function editarTexto(): HTMLTextAreaElement {
  act(() => por(".nota-leitura")!.click());
  return por<HTMLTextAreaElement>(".nota-campo")!;
}

describe("Notas: lista e nota aberta", () => {
  it("abre a mais recente, com o bloco rápido fixo no topo e o texto renderizado", async () => {
    await montar();
    expect(por(".notas-bloco")?.textContent).toBe(
      "Bloco rápido · fixocódigo do portão 4471 · trocar filtro da água",
    );
    const itens = [...recipiente.querySelectorAll(".notas-item")].map((b) => [
      b.querySelector(".notas-item-titulo")?.textContent,
      b.getAttribute("aria-current"),
    ]);
    expect(itens).toEqual([
      ["Ideias para a viagem de dezembro", "page"],
      ["Receita do pão", null],
    ]);
    expect(por(".notas-item .notas-item-linha")?.textContent).toMatch(/^hoje · Três dias na serra\./);
    expect(por<HTMLInputElement>(".nota-titulo-campo")?.value).toBe("Ideias para a viagem de dezembro");
    expect(por(".nota-topo")?.textContent).toBe("Pessoal · Viagem de dezembrosalvo há 4 h");
    expect(por(".nota-leitura h2")?.textContent).toBe("Antes de ir");
    expect(por('.nota-leitura [aria-label="feito"]')).not.toBeNull();
    expect(auditar(recipiente)).toEqual([]);
  });

  it("escolher outra nota leva o Sistema a ela (o destino lembra a nota aberta)", async () => {
    await montar();
    act(() => [...recipiente.querySelectorAll<HTMLButtonElement>(".notas-item")][1]!.click());
    expect(ir).toHaveBeenCalledWith({ area: "notas", secao: RECEITA.id });
  });

  it("nota pedida que não existe mais abre a mais recente", async () => {
    await montar("01SUMIU");
    expect(por<HTMLInputElement>(".nota-titulo-campo")?.value).toBe(NOTA.titulo);
  });

  it("de 'Ligado a esta nota' entram as tarefas que nasceram dela, por quem as criou", async () => {
    falso.tarefas = [
      tarefa({}),
      tarefa({ id: "t2", titulo: "Comprar capa de chuva", venceEm: "2026-12-01" }),
      tarefa({ id: "t3", titulo: "Baixar mapas", origem: "usuario", agenteId: null, venceEm: null }),
    ];
    await montar();
    const lado = por(".nota-lado")!;
    expect([...lado.querySelectorAll(".nota-ligado-linha")].map((l) => l.textContent)).toEqual([
      "A Alba criou 2 tarefas a partir desta nota.",
      "Você criou 1 tarefa a partir desta nota.",
    ]);
    expect([...lado.querySelectorAll(".nota-ligado-tarefa")].map((l) => l.textContent)).toEqual([
      "Revisar o carro20 nov",
      "Comprar capa de chuva1 dez",
      "Baixar mapas",
    ]);
    expect(falso.pedidos).toContainEqual({
      metodo: "tarefas.listar",
      dados: { notaId: NOTA.id, todas: true },
    });
  });

  it("sem tarefas ligadas, o vazio explica", async () => {
    await montar();
    expect(por(".nota-lado")?.textContent).toContain("Nenhuma tarefa criada a partir desta nota.");
  });
});

describe("Notas: salva sozinha", () => {
  it("o título salva 800 ms depois da última tecla, com a versão que a janela conhece", async () => {
    await montar();
    digitar(por<HTMLInputElement>(".nota-titulo-campo")!, "Viagem de dezembro");
    await andar(799);
    expect(salvos()).toEqual([]);
    expect(por(".nota-salvo")?.textContent).toBe("salvando");
    await andar(1);
    expect(salvos()).toEqual([
      { id: NOTA.id, versao: NOTA.atualizadoEm, titulo: "Viagem de dezembro", conteudo: NOTA.conteudo },
    ]);
    await andar();
    expect(por(".nota-salvo")?.textContent).toBe("salvo agora");
    expect(falso.notas.get(NOTA.id)?.titulo).toBe("Viagem de dezembro");
  });

  it("fechar a janela no meio da digitação não perde texto: salva na hora, sem esperar a pausa", async () => {
    await montar();
    const campo = editarTexto();
    expect(document.activeElement).toBe(campo);
    digitar(campo, `${NOTA.conteudo}\n- [ ] Baixar mapas off`);
    // O Sistema esconde ao fechar: a janela perde o foco antes de sumir.
    act(() => window.dispatchEvent(new Event("blur")));
    expect(salvos().map((p) => (p as { conteudo: string }).conteudo)).toEqual([
      `${NOTA.conteudo}\n- [ ] Baixar mapas off`,
    ]);
    await andar();
    expect(falso.notas.get(NOTA.id)?.conteudo).toBe(`${NOTA.conteudo}\n- [ ] Baixar mapas off`);
  });

  it("a janela que some ou descarrega também salva na hora", async () => {
    await montar();
    digitar(editarTexto(), "a");
    act(() => window.dispatchEvent(new Event("pagehide")));
    await andar();
    digitar(por<HTMLTextAreaElement>(".nota-campo")!, "ab");
    act(() => window.dispatchEvent(new Event("beforeunload")));
    expect(salvos().map((p) => (p as { conteudo: string }).conteudo)).toEqual(["a", "ab"]);
  });

  it("trocar de área no meio da digitação salva na hora", async () => {
    await montar();
    digitar(editarTexto(), "texto pela metade");
    act(() => raiz!.unmount());
    raiz = null;
    expect(salvos().map((p) => (p as { conteudo: string }).conteudo)).toEqual(["texto pela metade"]);
  });

  it("sair do campo mostra o texto renderizado e salva", async () => {
    await montar();
    const campo = editarTexto();
    digitar(campo, "**forte**");
    act(() => campo.blur());
    expect(salvos()).toHaveLength(1);
    await andar();
    expect(por(".nota-leitura strong")?.textContent).toBe("forte");
    expect(por(".nota-campo")).toBeNull();
  });

  it("link do texto abre no navegador pela casca, sem entrar na edição", async () => {
    falso.notas.set(NOTA.id, { ...NOTA, conteudo: "[banco](https://banco.exemplo)" });
    await montar();
    act(() => por<HTMLAnchorElement>(".nota-leitura a")!.click());
    expect(casca.invoke).toHaveBeenCalledWith("abrir_endereco", { endereco: "https://banco.exemplo" });
    expect(por(".nota-campo")).toBeNull();
  });

  it("a nota mudou em outra janela enquanto você escrevia: as duas ficam e você escolhe", async () => {
    await montar();
    digitar(editarTexto(), "o meu texto");
    // O painel salvou a mesma nota antes.
    const outra = { ...NOTA, conteudo: "o texto do painel", atualizadoEm: versao() };
    falso.notas.set(NOTA.id, outra);
    act(() => falso.emitir("notas.mudou", { notas: [outra], apagadas: [] }));
    expect(por('[role="alert"]')?.textContent).toContain("Esta nota mudou em outra janela.");
    expect(por<HTMLTextAreaElement>(".nota-campo")?.value).toBe("o meu texto");
    await andar(2000);
    expect(salvos()).toEqual([]);

    act(() => botao("Salvar o meu texto")!.click());
    expect(salvos()).toEqual([
      { id: NOTA.id, versao: outra.atualizadoEm, titulo: NOTA.titulo, conteudo: "o meu texto" },
    ]);
    await andar();
    expect(por('[role="alert"]')).toBeNull();
    expect(falso.notas.get(NOTA.id)?.conteudo).toBe("o meu texto");
  });

  it("nova nota abre em branco com o título em foco", async () => {
    await montar();
    await act(async () => botao("Nova nota")!.click());
    const criada = [...falso.notas.values()].find((n) => n.id.startsWith("01NOVA"))!;
    expect(ir).toHaveBeenCalledWith({ area: "notas", secao: criada.id });
  });
});

describe("Notas: busca", () => {
  it("sem acento acha com acento, com o trecho e o que bateu marcado", async () => {
    await montar();
    digitar(por<HTMLInputElement>('input[type="search"]')!, "amanha");
    await andar(150);
    await andar();
    const itens = [...recipiente.querySelectorAll(".notas-item")];
    expect(itens.map((i) => i.querySelector(".notas-item-titulo")?.textContent)).toEqual(["Receita do pão"]);
    expect(itens[0]?.querySelector("mark")?.textContent).toBe("amanhã");
    expect(falso.pedidos).toContainEqual({ metodo: "notas.buscar", dados: { texto: "amanha" } });
  });

  it("nada achado explica, e Esc limpa a busca e volta a lista", async () => {
    await montar();
    const campo = por<HTMLInputElement>('input[type="search"]')!;
    digitar(campo, "xyz");
    await andar(150);
    await andar();
    expect(por(".notas-lista-vazia")?.textContent).toBe(
      "Nenhuma nota com “xyz”. A busca ignora acento e caixa.",
    );
    act(() => campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(campo.value).toBe("");
    expect(recipiente.querySelectorAll(".notas-item")).toHaveLength(2);
  });
});

describe("Notas: bloco rápido", () => {
  it("abre pelo cartão do topo, sem título editável", async () => {
    await montar("bloco_rapido");
    expect(por(".notas-bloco")?.getAttribute("aria-current")).toBe("page");
    expect(por("h2.nota-titulo")?.textContent).toBe("Bloco rápido");
    expect(por(".nota-titulo-campo")).toBeNull();
  });

  it("esvaziar pede confirmação no lugar; manter não muda nada, e esvaziar só tira o texto", async () => {
    await montar("bloco_rapido");
    act(() => botao("Esvaziar o bloco")!.click());
    const cartao = por('[aria-label="Esvaziar o bloco rápido"]')!;
    expect(cartao.textContent).toContain("Não dá para desfazer.");
    expect(document.activeElement?.textContent).toBe("Manter como está");
    act(() => botao("Manter como está")!.click());
    expect(por('[aria-label="Esvaziar o bloco rápido"]')).toBeNull();
    expect(falso.pedidos.some((p) => p.metodo === "notas.apagar")).toBe(false);

    act(() => botao("Esvaziar o bloco")!.click());
    const confirmar = [...por('[aria-label="Esvaziar o bloco rápido"]')!.querySelectorAll("button")].find(
      (b) => b.textContent === "Esvaziar o bloco",
    )!;
    await act(async () => confirmar.click());
    await andar();
    expect(falso.pedidos).toContainEqual({ metodo: "notas.apagar", dados: { id: "bloco_rapido" } });
    expect(falso.notas.get("bloco_rapido")?.conteudo).toBe("");
    expect(por<HTMLTextAreaElement>(".nota-campo")?.value).toBe("");
    expect(por('[role="alert"]')).toBeNull();
  });

  it("apagar uma nota comum vai direto, diz para onde vai, e volta à mais recente", async () => {
    await montar();
    expect(por(".nota-lado-rodape")?.textContent).toContain("fica 30 dias na Lixeira");
    await act(async () => botao("Apagar nota")!.click());
    expect(falso.pedidos).toContainEqual({ metodo: "notas.apagar", dados: { id: NOTA.id } });
    expect(ir).toHaveBeenCalledWith({ area: "notas" });
  });
});
