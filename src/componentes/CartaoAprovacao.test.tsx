// @vitest-environment happy-dom
import type { Aprovacao, PedidoDecidir } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../teste/acessibilidade.ts";
import {
  CartaoAprovacao,
  ERRO_SEM_CONFIRMACAO,
  ERRO_SEM_SERVICO,
  NEGAR,
  PERMITIR,
  SEMPRE_NESTE_PROJETO,
} from "./CartaoAprovacao.tsx";
import { FalaAgente } from "./FalaAgente.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

function montar(no: ReactNode) {
  if (raiz) {
    act(() => raiz!.unmount());
    recipiente.remove();
  }
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  act(() => raiz!.render(no));
  return recipiente;
}

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

const botoes = () => [...recipiente.querySelectorAll<HTMLButtonElement>("button")];
const botao = (texto: string) => botoes().find((b) => b.textContent === texto)!;

const TERMINAL: Aprovacao = {
  id: "a1",
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId: "s1",
  descricao: "Quer rodar o comando abaixo.",
  acao: { ferramenta: "Bash", entrada: null, rotulo: null, rotuloRecusar: null, desfazivel: false },
  estado: "pendente",
  criadoEm: "2026-10-09T14:31:00.000Z",
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
};

const AGENTE: Aprovacao = {
  ...TERMINAL,
  id: "a2",
  fonte: "moductus",
  agenteId: "faina",
  execucaoId: "e1",
  sessaoId: null,
  descricao: "Vou mover 38 arquivos (1,4 GB) para a Lixeira.",
  acao: {
    ferramenta: "arquivos.mover",
    entrada: null,
    rotulo: "Mover 38 arquivos",
    rotuloRecusar: "Não mover",
    desfazivel: true,
  },
};

describe("Cartão de aprovação", () => {
  it("sessão do terminal: Negar, Sempre neste projeto e Permitir, nessa ordem", () => {
    montar(<CartaoAprovacao aprovacao={TERMINAL} aoDecidir={vi.fn(async () => undefined)} />);
    expect(botoes().map((b) => b.textContent)).toEqual([NEGAR, SEMPRE_NESTE_PROJETO, PERMITIR]);
    expect(botao(PERMITIR).className).toContain("botao--primario");
    // O terminal não diz se dá para desfazer: o Moductus não sabe.
    expect(recipiente.textContent).not.toContain("desfazer");
    expect(auditar(recipiente)).toEqual([]);
  });

  it("agente: o botão é verbo com objeto, recusa sem culpa, sem 'sempre', e diz se dá para desfazer", () => {
    montar(<CartaoAprovacao aprovacao={AGENTE} aoDecidir={vi.fn(async () => undefined)} />);
    expect(botoes().map((b) => b.textContent)).toEqual(["Não mover", "Mover 38 arquivos"]);
    expect(recipiente.textContent).toContain("Dá para desfazer pelo histórico.");
    montar(
      <CartaoAprovacao
        aprovacao={{ ...AGENTE, acao: { ...AGENTE.acao, desfazivel: false } }}
        aoDecidir={vi.fn(async () => undefined)}
      />,
    );
    expect(recipiente.textContent).toContain("Não dá para desfazer.");
  });

  it.each([
    [NEGAR, { id: "a1", decisao: "negar" }],
    [SEMPRE_NESTE_PROJETO, { id: "a1", decisao: "permitir", sempre: "projeto" }],
    [PERMITIR, { id: "a1", decisao: "permitir" }],
  ] as const)("%s manda o pedido certo ao serviço", async (texto, pedido) => {
    const pedidos: PedidoDecidir[] = [];
    montar(
      <CartaoAprovacao
        aprovacao={TERMINAL}
        aoDecidir={async (p) => {
          pedidos.push(p);
        }}
      />,
    );
    await act(async () => botao(texto).click());
    expect(pedidos).toEqual([pedido]);
  });

  it("respondido, trava até o pedido chegar decidido: um segundo clique não sai", async () => {
    const aoDecidir = vi.fn(async () => undefined);
    montar(<CartaoAprovacao aprovacao={TERMINAL} aoDecidir={aoDecidir} />);
    await act(async () => botao(PERMITIR).click());
    // O serviço respondeu, mas a aprovação ainda não voltou decidida.
    expect(botoes().every((b) => b.disabled)).toBe(true);
    expect(recipiente.querySelector(".aprovacao")!.getAttribute("aria-busy")).toBe("true");
    await act(async () => botao(NEGAR).click());
    expect(aoDecidir).toHaveBeenCalledTimes(1);
    act(() =>
      raiz!.render(<CartaoAprovacao aprovacao={{ ...TERMINAL, estado: "aprovada" }} aoDecidir={aoDecidir} />),
    );
    expect(botoes()).toHaveLength(0);
    expect(recipiente.querySelector('[role="status"] .selo')?.textContent).toBe("permitido");
    // Outro pedido pendente no mesmo cartão volta a ter os botões livres.
    act(() => raiz!.render(<CartaoAprovacao aprovacao={{ ...TERMINAL, id: "a9" }} aoDecidir={aoDecidir} />));
    expect(botoes().every((b) => !b.disabled)).toBe(true);
  });

  it("serviço indisponível antes do envio: nada saiu, e o cartão diz isso", async () => {
    const aoDecidir = vi.fn(async () => {
      throw new ServicoIndisponivel();
    });
    montar(<CartaoAprovacao aprovacao={AGENTE} aoDecidir={aoDecidir} />);
    await act(async () => botao("Mover 38 arquivos").click());
    expect(recipiente.querySelector('[role="alert"]')?.textContent).toBe(ERRO_SEM_SERVICO);
    expect(botoes().every((b) => !b.disabled)).toBe(true);
  });

  it("pedido sem regra possível não oferece Sempre neste projeto", () => {
    montar(
      <CartaoAprovacao
        aprovacao={{ ...TERMINAL, admiteSempre: false }}
        aoDecidir={vi.fn(async () => undefined)}
      />,
    );
    expect(botoes().map((b) => b.textContent)).toEqual([NEGAR, PERMITIR]);
  });

  it("o serviço recusou: o cartão mostra a explicação dele", async () => {
    const aoDecidir = vi.fn(async () => {
      throw new RecusaDoServico("o arquivo fica fora do projeto: não dá para criar a regra do projeto");
    });
    montar(<CartaoAprovacao aprovacao={TERMINAL} aoDecidir={aoDecidir} />);
    await act(async () => botao(SEMPRE_NESTE_PROJETO).click());
    expect(recipiente.querySelector('[role="alert"]')?.textContent).toBe(
      "o arquivo fica fora do projeto: não dá para criar a regra do projeto",
    );
    expect(botoes().every((b) => !b.disabled)).toBe(true);
  });

  it("falha depois do envio: não afirma que nada foi decidido, pede para conferir", async () => {
    let falhar!: (e: Error) => void;
    const aoDecidir = vi.fn(() => new Promise<unknown>((_, rejeitar) => (falhar = rejeitar)));
    montar(<CartaoAprovacao aprovacao={AGENTE} aoDecidir={aoDecidir} />);
    act(() => botao("Mover 38 arquivos").click());
    expect(botoes().every((b) => b.disabled)).toBe(true);
    await act(async () => falhar(new Error("conexão caiu")));
    const alerta = recipiente.querySelector('[role="alert"]')?.textContent;
    expect(alerta).toBe(ERRO_SEM_CONFIRMACAO);
    expect(alerta).not.toMatch(/nada/i);
    expect(botoes().every((b) => !b.disabled)).toBe(true);
    expect(aoDecidir).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["aprovada", "permitido"],
    ["negada", "negado"],
    ["expirada", "expirou"],
  ] as const)("%s: sem botões, o cartão diz o que valeu (%s)", (estado, texto) => {
    montar(<CartaoAprovacao aprovacao={{ ...TERMINAL, estado }} aoDecidir={vi.fn(async () => undefined)} />);
    expect(botoes()).toHaveLength(0);
    expect(recipiente.querySelector('[role="status"] .selo')?.textContent).toBe(texto);
  });

  it("dentro da fala, a descrição não se repete na tela mas segue para o leitor de tela", () => {
    montar(<CartaoAprovacao aprovacao={AGENTE} semDescricao aoDecidir={vi.fn(async () => undefined)} />);
    const cartao = recipiente.querySelector(".aprovacao")!;
    const descricao = recipiente.querySelector(`#${CSS.escape(cartao.getAttribute("aria-describedby")!)}`)!;
    expect(descricao.textContent).toBe(AGENTE.descricao);
    expect(descricao.className).toBe("so-leitor");
  });
});

describe("Fala do agente", () => {
  it("cabeça com a expressão, nome na cor de identidade e a ação logo abaixo", () => {
    montar(
      <FalaAgente agente="nuno" estado="esperando" acao={<button type="button">Compactar</button>}>
        A sessão do Codex chegou a 85% do contexto. Compacto agora?
      </FalaAgente>,
    );
    const fala = recipiente.querySelector<HTMLElement>(".fala")!;
    expect(fala.tagName).toBe("ARTICLE");
    expect(fala.dataset.agente).toBe("nuno");
    expect(fala.querySelector('.personagem[data-modo="cabeca"][data-estado="esperando"]')).not.toBeNull();
    expect(fala.querySelector<SVGElement>(".personagem")!.style.getPropertyValue("--personagem-altura")).toBe(
      "30px",
    );
    const nome = fala.querySelector(".fala-nome")!;
    expect(nome.textContent).toBe("Nuno");
    expect(document.getElementById(fala.getAttribute("aria-labelledby")!)).toBe(nome);
    expect(fala.querySelector(".fala-acao button")?.textContent).toBe("Compactar");
    expect(auditar(recipiente)).toEqual([]);
  });
});
