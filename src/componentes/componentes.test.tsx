// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Atalho, teclasDoAtalho } from "./Atalho.tsx";
import { Caixa } from "./Caixa.tsx";
import { Campo } from "./Campo.tsx";
import { ehNomeIcone, Icone, NOMES_ICONES, type NomeIcone } from "./Icone.tsx";
import { Interruptor } from "./Interruptor.tsx";
import { Progresso } from "./Progresso.tsx";
import { Seletor } from "./Seletor.tsx";
import { Contagem } from "./Selo.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

function montar(no: ReactNode) {
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

function teclar(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const por = (seletor: string) => recipiente.querySelector<HTMLElement>(seletor)!;
const todos = (seletor: string) => [...recipiente.querySelectorAll<HTMLElement>(seletor)];

describe("Seletor segmentado", () => {
  function Tema() {
    const [valor, setValor] = useState("papel");
    return (
      <Seletor
        rotulo="Tema"
        valor={valor}
        aoMudar={setValor}
        opcoes={[
          { valor: "grafite", rotulo: "Grafite" },
          { valor: "papel", rotulo: "Papel" },
          { valor: "nenhum", rotulo: "Nenhum", desativada: true },
          { valor: "vidro", rotulo: "Vidro" },
        ]}
      />
    );
  }

  const marcada = () => todos('[role="radio"]').find((r) => r.getAttribute("aria-checked") === "true")!;

  it("é um radiogroup com um só ponto de Tab, na opção marcada", () => {
    montar(<Tema />);
    expect(por('[role="radiogroup"]').getAttribute("aria-label")).toBe("Tema");
    const tabs = todos('[role="radio"]').map((r) => r.tabIndex);
    expect(tabs).toEqual([-1, 0, -1, -1]);
    expect(marcada().textContent).toBe("Papel");
  });

  it("setas escolhem e movem o foco, pulando a desativada e dando a volta", () => {
    montar(<Tema />);
    teclar(marcada(), "ArrowRight");
    expect(marcada().textContent).toBe("Vidro");
    expect(document.activeElement).toBe(marcada());
    expect(marcada().tabIndex).toBe(0);

    teclar(marcada(), "ArrowDown");
    expect(marcada().textContent).toBe("Grafite");

    teclar(marcada(), "ArrowLeft");
    expect(marcada().textContent).toBe("Vidro");
    teclar(marcada(), "ArrowUp");
    expect(marcada().textContent).toBe("Papel");

    teclar(marcada(), "End");
    expect(marcada().textContent).toBe("Vidro");
    teclar(marcada(), "Home");
    expect(marcada().textContent).toBe("Grafite");
  });

  it("outra tecla não muda nada", () => {
    montar(<Tema />);
    teclar(marcada(), "a");
    expect(marcada().textContent).toBe("Papel");
  });
});

describe("Caixa e interruptor", () => {
  function Par() {
    const [marcado, setMarcado] = useState(false);
    const [ligado, setLigado] = useState(false);
    return (
      <>
        <Caixa marcado={marcado} aoMudar={setMarcado}>
          Concluída
        </Caixa>
        <Interruptor ligado={ligado} aoMudar={setLigado}>
          Manter acordado
        </Interruptor>
        <Caixa marcado={false} aoMudar={setMarcado} desativado aria-label="Bloqueada" />
      </>
    );
  }

  it("caixa: role checkbox, focável, Espaço alterna e Enter não", () => {
    montar(<Par />);
    const caixa = por('[role="checkbox"]');
    expect(caixa.tabIndex).toBe(0);
    expect(caixa.textContent).toBe("Concluída");
    expect(caixa.getAttribute("aria-checked")).toBe("false");

    teclar(caixa, " ");
    expect(caixa.getAttribute("aria-checked")).toBe("true");
    teclar(caixa, "Enter");
    expect(caixa.getAttribute("aria-checked")).toBe("true");
    teclar(caixa, " ");
    expect(caixa.getAttribute("aria-checked")).toBe("false");

    act(() => caixa.click());
    expect(caixa.getAttribute("aria-checked")).toBe("true");
  });

  it("interruptor: role switch, Espaço e Enter alternam", () => {
    montar(<Par />);
    const chave = por('[role="switch"]');
    expect(chave.getAttribute("aria-checked")).toBe("false");
    teclar(chave, "Enter");
    expect(chave.getAttribute("aria-checked")).toBe("true");
    teclar(chave, " ");
    expect(chave.getAttribute("aria-checked")).toBe("false");
  });

  it("desativada sai do Tab, anuncia aria-disabled e não alterna", () => {
    montar(<Par />);
    const bloqueada = todos('[role="checkbox"]')[1]!;
    expect(bloqueada.getAttribute("aria-label")).toBe("Bloqueada");
    expect(bloqueada.tabIndex).toBe(-1);
    expect(bloqueada.getAttribute("aria-disabled")).toBe("true");
    teclar(bloqueada, " ");
    act(() => bloqueada.click());
    expect(bloqueada.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Progresso", () => {
  it("expõe progressbar com valor, limites e nome", () => {
    montar(<Progresso rotulo="Tarefas" valor={3} maximo={4} textoValor="3 de 4 tarefas" />);
    const barra = por('[role="progressbar"]');
    expect(barra.getAttribute("aria-label")).toBe("Tarefas");
    expect(barra.getAttribute("aria-valuenow")).toBe("3");
    expect(barra.getAttribute("aria-valuemin")).toBe("0");
    expect(barra.getAttribute("aria-valuemax")).toBe("4");
    expect(barra.getAttribute("aria-valuetext")).toBe("3 de 4 tarefas");
    expect(por(".progresso-barra").style.width).toBe("75%");
  });

  it("prende o valor no intervalo", () => {
    montar(
      <>
        <Progresso rotulo="Acima" valor={140} />
        <Progresso rotulo="Abaixo" valor={-5} />
      </>,
    );
    const [acima, abaixo] = todos('[role="progressbar"]') as [HTMLElement, HTMLElement];
    expect(acima.getAttribute("aria-valuenow")).toBe("100");
    expect(abaixo.getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("Atalho", () => {
  it("separa as teclas da combinação", () => {
    expect(teclasDoAtalho("Ctrl+Alt+N")).toEqual(["Ctrl", "Alt", "N"]);
    expect(teclasDoAtalho("Ctrl+Alt+Espaço")).toEqual(["Ctrl", "Alt", "Espaço"]);
    expect(teclasDoAtalho("Enter")).toEqual(["Enter"]);
    expect(teclasDoAtalho("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(teclasDoAtalho("Ctrl + K")).toEqual(["Ctrl", "K"]);
  });

  it("mostra um kbd por tecla dentro do chip", () => {
    montar(<Atalho teclas="Ctrl+Alt+N" />);
    expect(todos("kbd.atalho > kbd").map((k) => k.textContent)).toEqual(["Ctrl", "Alt", "N"]);
  });
});

describe("Ícone", () => {
  it("tem os 24 desenhos, o restaurar da janela e o escudo, com 27 nomes (hoje e início são a casa)", () => {
    expect(NOMES_ICONES).toHaveLength(27);
    montar(
      <>
        <Icone nome="hoje" />
        <Icone nome="inicio" />
      </>,
    );
    const [hoje, inicio] = todos("svg") as [HTMLElement, HTMLElement];
    expect(hoje.innerHTML).toBe(inicio.innerHTML);
  });

  it("nome desconhecido não desenha nada", () => {
    expect(ehNomeIcone("foguete")).toBe(false);
    expect(ehNomeIcone("toString")).toBe(false);
    montar(<Icone nome={"foguete" as NomeIcone} />);
    expect(recipiente.innerHTML).toBe("");
  });

  it("decorativo sem rótulo; com rótulo vira imagem nomeada", () => {
    montar(
      <>
        <Icone nome="busca" />
        <Icone nome="mic-mudo" rotulo="Microfone mudo" />
      </>,
    );
    const [busca, mic] = todos("svg") as [HTMLElement, HTMLElement];
    expect(busca.getAttribute("aria-hidden")).toBe("true");
    expect(busca.getAttribute("class")).toContain("icone-busca");
    expect(mic.getAttribute("role")).toBe("img");
    expect(mic.getAttribute("aria-label")).toBe("Microfone mudo");
  });
});

describe("Campo e contagem", () => {
  it("campo liga rótulo e dica ao input", () => {
    montar(<Campo rotulo="Buscar" rotuloOculto dica="Enter abre" />);
    const entrada = por("input");
    const rotulo = por("label");
    expect(rotulo.getAttribute("for")).toBe(entrada.id);
    expect(rotulo.className).toBe("so-leitor");
    expect(document.getElementById(entrada.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Enter abre",
    );
  });

  it("contagem diz o número e o quê, some no zero e corta em 99+", () => {
    montar(
      <>
        <Contagem valor={4} rotulo="tarefas pendentes" />
        <Contagem valor={0} rotulo="nada" />
        <Contagem valor={120} rotulo="arquivos novos" />
      </>,
    );
    const contagens = todos(".contagem");
    expect(contagens).toHaveLength(2);
    expect(contagens[0]!.querySelector(".so-leitor")!.textContent).toBe("4 tarefas pendentes");
    expect(contagens[1]!.querySelector('[aria-hidden="true"]')!.textContent).toBe("99+");
  });
});
