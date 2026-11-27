import type { HTMLAttributes } from "react";
import { usePrivacidade } from "./privacidade.ts";
import "./TextoSensivel.css";

interface PropsSensivel extends HTMLAttributes<HTMLSpanElement> {
  mascarado: boolean;
  /** O desenho no lugar do conteúdo ("R$ •••"). */
  mascara: string;
  /** O que o leitor de tela lê no lugar do texto visível; sem isso, lê o próprio texto. */
  lido?: string;
  children: string;
}

/**
 * Conteúdo que o modo privacidade esconde (ADR-0047): mascarado, o texto fica invisível no mesmo
 * lugar e a máscara se desenha por cima, então a linha não muda de tamanho e nada some, só o
 * desenho. O leitor de tela não recebe o valor escondido.
 */
export function Sensivel({ mascarado, mascara, lido, className, children, ...resto }: PropsSensivel) {
  const classes = ["sensivel", className].filter(Boolean).join(" ");
  return (
    <span className={classes} data-mascarado={mascarado || undefined} {...resto}>
      <span className="sensivel-texto" aria-hidden={mascarado || lido !== undefined || undefined}>
        {children}
      </span>
      {mascarado && (
        <span className="sensivel-mascara" aria-hidden="true">
          {mascara}
        </span>
      )}
      {lido !== undefined && <span className="so-leitor">{lido}</span>}
    </span>
  );
}

const MASCARA_TEXTO = "•••••";

interface PropsTextoSensivel {
  /** Descrição de lançamento, nome de conta: o que identifica o dinheiro de alguém. */
  children: string;
  className?: string;
}

/** Texto que some da tela com o modo privacidade ligado; termina em reticências se não couber. */
export function TextoSensivel({ children, className }: PropsTextoSensivel) {
  const mascarado = usePrivacidade();
  return (
    <Sensivel
      mascarado={mascarado}
      mascara={MASCARA_TEXTO}
      lido={mascarado ? "texto escondido" : undefined}
      className={className}
    >
      {children}
    </Sensivel>
  );
}
