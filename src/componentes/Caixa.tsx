import { propsAlternavel, type PropsAlternavel } from "./alternavel.ts";
import "./Caixa.css";

interface PropsCaixa extends PropsAlternavel {
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
}

/** Checkbox: Espaço alterna (Enter não, como no checkbox nativo). */
export function Caixa({ marcado, aoMudar, ...props }: PropsCaixa) {
  const atributos = propsAlternavel(marcado, aoMudar, [" "], props);
  return (
    <span role="checkbox" {...atributos} className={["caixa", atributos.className].filter(Boolean).join(" ")}>
      <span className="caixa-quadro" aria-hidden="true">
        <svg className="caixa-visto" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {props.children != null && <span className="caixa-texto">{props.children}</span>}
    </span>
  );
}
