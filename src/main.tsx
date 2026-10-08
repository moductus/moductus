import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Aplicacao } from "./janelas/Aplicacao.tsx";
import { janelaDoRotulo, type Janela } from "./janelas/rotas.ts";
import { useAcessibilidade } from "./nativo/acessibilidade.ts";
import "./tokens/fontes.css";
import "./tokens/temas.css";
import "./tokens/base.css";
// Por último: no alto contraste do Windows, as regras dele ganham das de cada componente.
import "./tokens/alto-contraste.css";
import { aplicarTema, useTema } from "./tokens/tema.ts";

// Antes do primeiro quadro: a janela já nasce com o tema do Windows, sem piscar.
aplicarTema("automatico");
const raiz = createRoot(document.getElementById("raiz")!);
const parametros = new URLSearchParams(window.location.search);

/**
 * Toda janela segue o tema da configuração e a animação do Windows; os componentes só leem
 * os tokens.
 */
function ComTema({ janela }: { janela: Janela }) {
  useTema();
  useAcessibilidade();
  return <Aplicacao janela={janela} />;
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
  raiz.render(
    <StrictMode>
      <ComTema janela={janela} />
    </StrictMode>,
  );
}
