// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENTES, DADOS_AGENTES, ESTADOS_PERSONAGEM, type EstadoPersonagem } from "./agentes.ts";
import { Personagem, type PersonagemProps } from "./Personagem.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let palco: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  palco = document.createElement("div");
  document.body.append(palco);
  raiz = createRoot(palco);
});

afterEach(() => {
  act(() => raiz.unmount());
  palco.remove();
});

function desenhar(props: PersonagemProps): SVGSVGElement {
  act(() => raiz.render(<Personagem {...props} />));
  const svg = palco.querySelector("svg");
  if (!svg) throw new Error("personagem não desenhado");
  return svg;
}

describe("Personagem", () => {
  it.each(AGENTES)("%s na cabeça do dock, dormindo: olhos fechados, z e rótulo certo", (agente) => {
    const svg = desenhar({ agente, modo: "cabeca", tamanho: "dock", estado: "dormindo" });
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(`${DADOS_AGENTES[agente].nome}, dormindo`);
    expect(svg.getAttribute("viewBox")).toMatch(/^16 \d+ 68 68$/);
    expect(svg.style.getPropertyValue("--personagem-altura")).toBe("32px");
    expect(svg.querySelector('[data-olhos="fechados"]')).not.toBeNull();
    expect(svg.querySelector("[data-zz]")).not.toBeNull();
    expect(svg.querySelectorAll(".personagem-olho")).toHaveLength(0);
  });

  it.each(AGENTES)("%s tem o próprio traço", (agente) => {
    const svg = desenhar({ agente, modo: "inteiro" });
    const tracos = [...svg.querySelectorAll("[data-traco]")].map((el) => el.getAttribute("data-traco"));
    expect(tracos).toContain(DADOS_AGENTES[agente].traco);
    // Cada traço só aparece no dono: nenhum agente veste o traço de outro.
    for (const outro of AGENTES.filter((a) => a !== agente)) {
      expect(tracos).not.toContain(DADOS_AGENTES[outro].traco);
    }
  });

  it("os óculos são só da Tula", () => {
    expect(desenhar({ agente: "tula" }).querySelector('[data-traco="oculos"]')).not.toBeNull();
    expect(desenhar({ agente: "nuno" }).querySelector('[data-traco="oculos"]')).toBeNull();
  });

  it("cada estado tem uma expressão diferente", () => {
    const rostos = ESTADOS_PERSONAGEM.map((estado) => desenhar({ agente: "alba", estado }).innerHTML);
    expect(new Set(rostos).size).toBe(ESTADOS_PERSONAGEM.length);
  });

  it("estado desconhecido cai em ocioso sem quebrar", () => {
    const svg = desenhar({ agente: "faina", estado: "explodindo" as EstadoPersonagem });
    expect(svg.dataset.estado).toBe("ocioso");
    expect(svg.getAttribute("aria-label")).toBe("Faina, descansando");
    expect(svg.querySelectorAll(".personagem-olho")).toHaveLength(2);
    expect(svg.querySelector("[data-zz]")).toBeNull();
  });

  it("agente desconhecido cai na Alba sem quebrar", () => {
    const svg = desenhar({ agente: "zé" as PersonagemProps["agente"] });
    expect(svg.dataset.agente).toBe("alba");
  });

  it("corpo inteiro usa a grade 100 × 120 e prende o tamanho à faixa de 16 a 168", () => {
    const grande = desenhar({ agente: "nuno", modo: "inteiro", tamanho: 999 });
    expect(grande.getAttribute("viewBox")).toBe("0 0 100 120");
    expect(grande.style.getPropertyValue("--personagem-altura")).toBe("168px");
    expect(grande.style.getPropertyValue("--personagem-largura")).toBe("140px");
    const pequeno = desenhar({ agente: "nuno", tamanho: 4 });
    expect(pequeno.style.getPropertyValue("--personagem-altura")).toBe("16px");
  });

  it("rótulo próprio substitui o padrão", () => {
    expect(desenhar({ agente: "tula", rotulo: "Tula, conecte um modelo" }).getAttribute("aria-label")).toBe(
      "Tula, conecte um modelo",
    );
  });

  it("moldura marca o estado em volta da cabeça", () => {
    act(() => raiz.render(<Personagem agente="nuno" estado="erro" moldura />));
    const moldura = palco.querySelector(".personagem-moldura") as HTMLElement;
    expect(moldura.dataset.estado).toBe("erro");
    expect(moldura.dataset.tom).toBe("perigo");
    expect(moldura.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it("o anel pode seguir o status em vez da expressão: teto é cara preocupada com anel de aviso", () => {
    act(() => raiz.render(<Personagem agente="nuno" estado="erro" moldura="aviso" />));
    const moldura = palco.querySelector(".personagem-moldura") as HTMLElement;
    expect(moldura.dataset.estado).toBe("erro");
    expect(moldura.dataset.tom).toBe("aviso");
  });
});
