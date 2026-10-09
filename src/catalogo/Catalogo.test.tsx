// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { NOMES_ICONES } from "../componentes/Icone.tsx";
import { Catalogo } from "./Catalogo.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("monta cada componente nos três temas, uma coluna por tema", () => {
  const recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  const raiz = createRoot(recipiente);
  act(() => raiz.render(<Catalogo />));

  const colunas = [...recipiente.querySelectorAll<HTMLElement>(".catalogo-tema")];
  expect(colunas.map((c) => c.dataset.tema)).toEqual(["grafite", "papel", "vidro"]);
  for (const coluna of colunas) {
    for (const classe of [
      "botao--primario",
      "botao--secundario",
      "botao--fantasma",
      "botao--pequeno",
      "campo",
      "atalho",
      "cartao",
      "cartao--elevado",
      "item-lista",
      "caixa",
      "interruptor",
      "progresso",
      "selo",
      "contagem",
      "seletor",
      "marca",
      "status",
      "status-ponto",
      "personagem-moldura",
      "fala",
      "aprovacao",
    ]) {
      expect(coluna.querySelector(`.${classe}`), `${coluna.dataset.tema}: ${classe}`).not.toBeNull();
    }
    expect(coluna.querySelectorAll(".catalogo-icone")).toHaveLength(NOMES_ICONES.length);
  }

  act(() => raiz.unmount());
  recipiente.remove();
});
