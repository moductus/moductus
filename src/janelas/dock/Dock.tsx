import { invoke } from "@tauri-apps/api/core";
import { useAwake, useMic, useMidia, useTelaCheia } from "../../nativo/eventos.ts";

// Estrutura provisória: o dock desenhado (marca, áreas, agentes, mídia, controles)
// entra na F1-20, sobre os tokens e componentes das F1-18 e F1-19.
export function Dock() {
  const telaCheia = useTelaCheia();
  const midia = useMidia();
  const mic = useMic();
  const awake = useAwake();
  return (
    <main aria-label="Dock" data-tela-cheia={telaCheia}>
      <button type="button" onClick={() => void invoke("painel_abrir", { area: "hoje" })}>
        Hoje
      </button>
      <button
        type="button"
        aria-label="Microfone mudo"
        aria-pressed={mic === true}
        disabled={mic === null}
        onClick={() => void invoke("mic_alternar")}
      >
        Mic
      </button>
      <button
        type="button"
        aria-label="Manter acordado"
        aria-pressed={awake}
        onClick={() => void invoke("awake_definir", { ligar: !awake })}
      >
        Awake
      </button>
      {midia && (
        <button
          type="button"
          aria-label={midia.tocando ? `Pausar ${midia.titulo}` : `Tocar ${midia.titulo}`}
          onClick={() => void invoke("midia_alternar")}
        >
          {midia.tocando ? "❚❚" : "▶"}
        </button>
      )}
    </main>
  );
}
