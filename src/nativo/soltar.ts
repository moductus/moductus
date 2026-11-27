import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

/**
 * Arrastar e soltar arquivo do Explorer nesta janela (`onDragDropEvent`, ADR-0044). Enquanto o
 * componente vive, um arquivo solto em qualquer ponto da janela chega a `aoSoltar` com o caminho;
 * com vários, só o primeiro. Devolve se há um arquivo sendo arrastado por cima, para a tela
 * mostrar o alvo. O caminho só vai ao `arquivos.autorizar`.
 */
export function useSoltarArquivo(aoSoltar: (caminho: string) => void): boolean {
  const [sobre, setSobre] = useState(false);
  // O último `aoSoltar` sem refazer a inscrição a cada render.
  const atual = useRef(aoSoltar);
  useEffect(() => {
    atual.current = aoSoltar;
  }, [aoSoltar]);

  useEffect(() => {
    let vivo = true;
    const parar = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (!vivo) return;
      if (payload.type === "enter") setSobre(payload.paths.length > 0);
      else if (payload.type === "leave") setSobre(false);
      else if (payload.type === "drop") {
        setSobre(false);
        const [primeiro] = payload.paths;
        if (primeiro) atual.current(primeiro);
      }
    });
    return () => {
      vivo = false;
      void parar.then((f) => f()).catch(() => undefined);
    };
  }, []);

  return sobre;
}
