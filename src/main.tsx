import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Aplicacao } from "./janelas/Aplicacao.tsx";
import { janelaDoRotulo, type Janela } from "./janelas/rotas.ts";
import "./tokens/fontes.css";
import "./tokens/temas.css";
import "./tokens/base.css";
import { aplicarTema, useTema } from "./tokens/tema.ts";

// Antes do primeiro quadro: a janela já nasce com o tema do Windows, sem piscar.
aplicarTema("automatico");
const raiz = createRoot(document.getElementById("raiz")!);

/** Toda janela segue o tema da configuração; os componentes só leem os tokens. */
function ComTema({ janela }: { janela: Janela }) {
  useTema();
  return <Aplicacao janela={janela} />;
}

// Catálogo de componentes só em desenvolvimento (`?catalogo`, no navegador ou na janela do
// Sistema): o import dinâmico atrás de DEV some do bundle de produção.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("catalogo")) {
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
