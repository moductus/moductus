import type { HTMLAttributes } from "react";
import "./Cartao.css";

interface PropsCartao extends HTMLAttributes<HTMLElement> {
  /** Elevado se destaca do fundo (borda forte, fundo elevado), sem sombra. */
  variante?: "normal" | "elevado";
  /** `section` quando o cartão tem título próprio; `div` quando é só moldura. */
  como?: "div" | "section" | "article";
}

export function Cartao({ variante = "normal", como: Elemento = "div", className, ...resto }: PropsCartao) {
  const classes = ["cartao", variante === "elevado" && "cartao--elevado", className]
    .filter(Boolean)
    .join(" ");
  return <Elemento className={classes} {...resto} />;
}
