// @vitest-environment happy-dom
import type { Aprovacao, PedidoDecidir } from "@moductus/contrato";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditar } from "../teste/acessibilidade.ts";
import { CartaoAprovacao, NEGAR, PERMITIR, SEMPRE_NESTE_PROJETO } from "./CartaoAprovacao.tsx";
import { FalaAgente } from "./FalaAgente.tsx";
import { Status } from "./Status.tsx";

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

  it("cada botão manda o pedido certo ao serviço", async () => {
    const pedidos: PedidoDecidir[] = [];
    const aoDecidir = async (p: PedidoDecidir) => {
      pedidos.push(p);
    };
    montar(<CartaoAprovacao aprovacao={TERMINAL} aoDecidir={aoDecidir} />);
    for (const texto of [NEGAR, SEMPRE_NESTE_PROJETO, PERMITIR]) {
      await act(async () => botao(texto).click());
    }
    expect(pedidos).toEqual([
      { id: "a1", decisao: "negar" },
      { id: "a1", decisao: "permitir", sempre: "projeto" },
      { id: "a1", decisao: "permitir" },
    ]);
  });

  it("enquanto envia, os botões travam; se o serviço recusar, o erro aparece no cartão", async () => {
    let falhar!: (e: Error) => void;
    const aoDecidir = vi.fn(() => new Promise<unknown>((_, rejeitar) => (falhar = rejeitar)));
    montar(<CartaoAprovacao aprovacao={AGENTE} aoDecidir={aoDecidir} />);
    act(() => botao("Mover 38 arquivos").click());
    expect(botoes().every((b) => b.disabled)).toBe(true);
    expect(recipiente.querySelector(".aprovacao")!.getAttribute("aria-busy")).toBe("true");
    await act(async () => falhar(new Error("serviço indisponível")));
    expect(recipiente.querySelector('[role="alert"]')?.textContent).toMatch(/Nada foi decidido/);
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
    expect(recipiente.querySelector('[role="status"] .status')?.textContent).toBe(texto);
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

describe("Status com texto", () => {
  it("o texto vem sempre; o ponto só na forma de ponto, escondido do leitor de tela", () => {
    montar(
      <>
        <Status tom="aviso">esperando você</Status>
        <Status tom="perigo" forma="ponto">
          CI falhou
        </Status>
      </>,
    );
    const [selo, ponto] = [...recipiente.querySelectorAll<HTMLElement>(".status")];
    expect(selo!.dataset.forma).toBe("selo");
    expect(selo!.dataset.tom).toBe("aviso");
    expect(selo!.querySelector(".status-ponto")).toBeNull();
    expect(ponto!.querySelector(".status-ponto")?.getAttribute("aria-hidden")).toBe("true");
    expect(ponto!.textContent).toBe("CI falhou");
  });
});
