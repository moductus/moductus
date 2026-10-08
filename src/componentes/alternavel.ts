import type { KeyboardEvent, ReactNode } from "react";

export interface PropsAlternavel {
  /** Texto ao lado; vira o nome acessível. Sem ele, passe `aria-label`. */
  children?: ReactNode;
  "aria-label"?: string;
  desativado?: boolean;
  /** Força o estado visual (só o catálogo usa). */
  "data-estado"?: "hover" | "foco";
  className?: string;
}

/**
 * Comportamento comum de caixa e interruptor (padrão WAI-ARIA): o elemento inteiro, com o
 * texto, é o controle; clique ou as teclas indicadas alternam; desativado sai do Tab.
 */
export function propsAlternavel(
  ligado: boolean,
  aoMudar: (ligado: boolean) => void,
  teclas: readonly string[],
  { desativado, className, children: _, ...resto }: PropsAlternavel,
) {
  const alternar = () => {
    if (!desativado) aoMudar(!ligado);
  };
  return {
    ...resto,
    tabIndex: desativado ? -1 : 0,
    "aria-checked": ligado,
    "aria-disabled": desativado || undefined,
    className,
    onClick: alternar,
    onKeyDown: (e: KeyboardEvent) => {
      if (!teclas.includes(e.key)) return;
      // Espaço rolaria a página.
      e.preventDefault();
      alternar();
    },
  };
}
