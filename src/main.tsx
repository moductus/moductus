import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Aplicacao } from "./janelas/Aplicacao.tsx";
import { janelaDoRotulo } from "./janelas/rotas.ts";

const janela = janelaDoRotulo(getCurrentWindow().label) ?? "sistema";
document.documentElement.dataset.janela = janela;

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <Aplicacao janela={janela} />
  </StrictMode>,
);
