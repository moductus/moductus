import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import "./Captura.css";

/** Captura rápida, ainda vazia: transformar a frase em tarefa, gasto ou nota é da fase 3. */
export function Captura() {
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const aoFocar = () => campo.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("captura_fechar");
    };
    window.addEventListener("focus", aoFocar);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("focus", aoFocar);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  return (
    <main className="captura" aria-label="Captura">
      <input
        ref={campo}
        className="captura-campo"
        aria-label="Capturar"
        placeholder="Capture uma tarefa, gasto ou nota"
      />
    </main>
  );
}
