import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { carregarJanela } from "./janelas/Aplicacao.tsx";
import { janelaDoRotulo } from "./janelas/rotas.ts";
import { useAcessibilidade } from "./nativo/acessibilidade.ts";
import { registrar } from "./nativo/eventos.ts";
import altoContraste from "./tokens/alto-contraste.css?inline";
import base from "./tokens/base.css?inline";
import fontes from "./tokens/fontes.css?inline";
import temas from "./tokens/temas.css?inline";
import { aplicarTema, useTema } from "./tokens/tema.ts";

// Os tokens vêm depois do CSS de cada tela, que chega com o chunk dela no <head>: no <body>, ficam
// sempre por último, e a base e o alto contraste do Windows ganham das regras de cada componente.
const tokens = document.createElement("style");
tokens.textContent = [fontes, temas, base, altoContraste].join("\n");
document.body.append(tokens);

// Antes do primeiro quadro: a janela já nasce com o tema do Windows, sem piscar.
aplicarTema("automatico");
const raiz = createRoot(document.getElementById("raiz")!);
const parametros = new URLSearchParams(window.location.search);

/**
 * Toda janela segue o tema da configuração e a animação do Windows; os componentes só leem
 * os tokens.
 */
function ComTema({ Tela }: { Tela: ComponentType }) {
  useTema();
  useAcessibilidade();
  return <Tela />;
}

if (parametros.has("personagens")) {
  // Revisão de design no navegador (`pnpm exec vite`, depois /?personagens): fora da casca,
  // sem janela nativa nem serviço, e carregada à parte para não pesar nas janelas.
  void import("./componentes/personagem/Galeria.tsx").then(({ Galeria }) =>
    raiz.render(
      <StrictMode>
        <Galeria />
      </StrictMode>,
    ),
  );
} else if (import.meta.env.DEV && parametros.has("catalogo")) {
  // Catálogo de componentes só em desenvolvimento (`?catalogo`, no navegador ou na janela do
  // Sistema): o import dinâmico atrás de DEV some do bundle de produção.
  void import("./catalogo/Catalogo.tsx").then(({ Catalogo }) =>
    raiz.render(
      <StrictMode>
        <Catalogo />
      </StrictMode>,
    ),
  );
} else {
  const janela = janelaDoRotulo(getCurrentWindow().label) ?? "sistema";
  document.documentElement.dataset.janela = janela;
  void carregarJanela(janela)
    .then((Tela) =>
      raiz.render(
        <StrictMode>
          <ComTema Tela={Tela} />
        </StrictMode>,
      ),
    )
    .catch((erro: unknown) => registrar(`janela ${janela} não carregou: ${String(erro)}`));
}
