import { useState, type KeyboardEvent } from "react";
import { Atalho } from "./Atalho.tsx";
import "./CampoAtalho.css";

const SO_MODIFICADOR = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"]);

/** Nome da tecla no formato do registro de atalhos ("K", "5", "Space", "F5"), pela tecla física. */
function nomeDaTecla(codigo: string): string {
  return /^Key([A-Z])$/.exec(codigo)?.[1] ?? /^Digit([0-9])$/.exec(codigo)?.[1] ?? codigo;
}

/**
 * Combinação de um keydown como a configuração guarda ("Ctrl+Alt+K"); null enquanto só há
 * modificadores apertados. Se a combinação vale, quem diz é a casca.
 */
export function combinacaoDoTeclado(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string | null {
  if (SO_MODIFICADOR.has(e.key) || !e.code) return null;
  const partes = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"];
  return [...partes.filter(Boolean), nomeDaTecla(e.code)].join("+");
}

/** Como a combinação aparece no chip: "Space" vira "Espaço", como no resto da interface. */
export function textoDoAtalho(combinacao: string): string {
  return combinacao.replace(/(^|\+)Space$/, "$1Espaço");
}

interface PropsCampoAtalho {
  /** Nome da ação ("Abrir o Sistema"): vira o nome acessível do campo. */
  rotulo: string;
  valor: string;
  aoCapturar: (combinacao: string) => void;
  desativado?: boolean;
}

/**
 * Campo que grava uma combinação: Enter ou clique começa, a próxima combinação com tecla
 * comum vale, Esc ou sair do campo cancela. Mostra o chip do atalho atual.
 */
export function CampoAtalho({ rotulo, valor, aoCapturar, desativado }: PropsCampoAtalho) {
  const [gravando, setGravando] = useState(false);

  const aoTeclar = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!gravando) return;
    // Enquanto grava, nenhuma tecla vai para a página nem para o Windows (Tab inclusive).
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      setGravando(false);
      return;
    }
    const combinacao = combinacaoDoTeclado(e);
    if (!combinacao) return;
    setGravando(false);
    if (combinacao !== valor) aoCapturar(combinacao);
  };

  return (
    <button
      type="button"
      className="campo-atalho"
      data-gravando={gravando || undefined}
      aria-label={
        gravando
          ? `${rotulo}: pressione a nova combinação, Esc cancela`
          : `${rotulo}: ${textoDoAtalho(valor)}. Enter para trocar`
      }
      disabled={desativado}
      onClick={() => setGravando(true)}
      onKeyDown={aoTeclar}
      onBlur={() => setGravando(false)}
    >
      {gravando ? (
        <span className="campo-atalho-espera">Pressione a combinação…</span>
      ) : (
        <Atalho teclas={textoDoAtalho(valor)} />
      )}
    </button>
  );
}
