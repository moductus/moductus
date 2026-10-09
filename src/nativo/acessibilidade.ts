import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { registrar } from "./eventos.ts";

/** O que a casca lê do Windows (src-tauri/src/acessibilidade.rs). */
export interface EstadoAcessibilidade {
  /** Falso com "Efeitos de animação" desligado: toda animação vai a zero. */
  animacoes: boolean;
}

/**
 * Marca `data-movimento` na raiz; os tokens zeram durações e animações com "reduzido"
 * (src/tokens/temas.css e base.css), além do `prefers-reduced-motion`, que vale sozinho.
 */
export function aplicarMovimento({ animacoes }: EstadoAcessibilidade): void {
  const movimento = animacoes ? "normal" : "reduzido";
  if (document.documentElement.dataset.movimento === movimento) return;
  document.documentElement.dataset.movimento = movimento;
  registrar(`movimento ${movimento}`);
}

/** Segue a configuração de animação do Windows: lida ao abrir e a cada mudança. */
export function useAcessibilidade(): void {
  useEffect(() => {
    invoke<EstadoAcessibilidade>("acessibilidade_estado")
      .then(aplicarMovimento)
      .catch(() => undefined);
    const parar = listen<EstadoAcessibilidade>("acessibilidade", (e) => aplicarMovimento(e.payload)).catch(
      () => () => undefined,
    );
    return () => {
      void parar.then((f) => f());
    };
  }, []);
}
