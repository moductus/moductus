import type { CSSProperties, HTMLAttributes } from "react";
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
 * lugar e a máscara se desenha por cima; a célula tem ao menos a largura da máscara, então a
 * linha não muda de tamanho e nada some, só o desenho. O leitor de tela não recebe o valor escondido.
 */
export function Sensivel({ mascarado, mascara, lido, className, children, ...resto }: PropsSensivel) {
  const classes = ["sensivel", className].filter(Boolean).join(" ");
  // A largura da máscara fica reservada nos dois modos: ligar o modo não mexe na linha e a
  // máscara cabe inteira mesmo sobre "R$ 0" ou "Pix".
  const largura = { "--largura-mascara": `${mascara.length}ch` } as CSSProperties;
  return (
    <span className={classes} data-mascarado={mascarado || undefined} style={largura} {...resto}>
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
