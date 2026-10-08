import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Aplicacao } from "./janelas/Aplicacao.tsx";
import { janelaDoRotulo, type Janela } from "./janelas/rotas.ts";
import "./tokens/fontes.css";
import "./tokens/temas.css";
import "./tokens/base.css";
import { aplicarTema, useTema } from "./tokens/tema.ts";

/** Toda janela segue o tema da configuração; os componentes só leem os tokens. */
function ComTema({ janela }: { janela: Janela }) {
  useTema();
  return <Aplicacao janela={janela} />;
}

const raiz = createRoot(document.getElementById("raiz")!);

// Revisão de design no navegador (`pnpm exec vite`, depois /?personagens): fora da casca,
// sem janela nativa nem serviço, e carregada à parte para não pesar nas janelas.
if (new URLSearchParams(window.location.search).has("personagens")) {
  void import("./componentes/personagem/Galeria.tsx").then(({ Galeria }) =>
    raiz.render(
      <StrictMode>
        <Galeria />
      </StrictMode>,
    ),
  );
} else {
  const janela = janelaDoRotulo(getCurrentWindow().label) ?? "sistema";
  document.documentElement.dataset.janela = janela;
  // Antes do primeiro quadro: a janela já nasce com o tema do Windows, sem piscar.
  aplicarTema("automatico");

  raiz.render(
    <StrictMode>
      <ComTema janela={janela} />
    </StrictMode>,
  );
}
