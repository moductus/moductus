import { invoke } from "@tauri-apps/api/core";
import { useTelaCheia } from "../../nativo/eventos.ts";

// Estrutura provisória: o dock desenhado (marca, áreas, agentes, mídia, controles)
// entra na F1-20, sobre os tokens e componentes das F1-18 e F1-19.
export function Dock() {
  const telaCheia = useTelaCheia();
  return (
    <main aria-label="Dock" data-tela-cheia={telaCheia}>
      <button type="button" onClick={() => void invoke("painel_abrir", { area: "hoje" })}>
        Hoje
      </button>
    </main>
  );
}
