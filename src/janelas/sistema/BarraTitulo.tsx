import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Icone } from "../../componentes/Icone.tsx";
import { Marca } from "../../componentes/Marca.tsx";

/**
 * Barra de título própria (a janela é sem decoração). A faixa inteira arrasta, e o duplo clique
 * nela maximiza ou restaura: os dois vêm do `data-tauri-drag-region` da casca. Fechar pede o
 * fechamento normal, que a casca transforma em esconder (lib.rs).
 */
export function BarraTitulo() {
  const maximizada = useMaximizada();
  const janela = () => getCurrentWindow();
  return (
    <header className="barra-titulo" data-tauri-drag-region>
      <span className="barra-titulo-marca">
        <Marca tamanho={16} />
        <span>Moductus</span>
      </span>
      <div className="barra-titulo-botoes">
        <button
          type="button"
          className="botao-janela"
          aria-label="Minimizar"
          onClick={() => void janela().minimize()}
        >
          <Icone nome="minimizar" tamanho={12} />
        </button>
        <button
          type="button"
          className="botao-janela"
          aria-label={maximizada ? "Restaurar" : "Maximizar"}
          onClick={() => void janela().toggleMaximize()}
        >
          <Icone nome={maximizada ? "restaurar" : "maximizar"} tamanho={12} />
        </button>
        <button
          type="button"
          className="botao-janela botao-janela--fechar"
          aria-label="Fechar"
          onClick={() => void janela().close()}
        >
          <Icone nome="fechar" tamanho={12} />
        </button>
      </div>
    </header>
  );
}

/** Se a janela está maximizada, para trocar o ícone do botão do meio. */
function useMaximizada(): boolean {
  const [maximizada, setMaximizada] = useState(false);
  useEffect(() => {
    const janela = getCurrentWindow();
    let ativo = true;
    const conferir = () =>
      void janela
        .isMaximized()
        .then((m) => ativo && setMaximizada(m))
        .catch(() => undefined);
    conferir();
    const parar = janela.onResized(conferir).catch(() => () => undefined);
    return () => {
      ativo = false;
      void parar.then((f) => f());
    };
  }, []);
  return maximizada;
}
