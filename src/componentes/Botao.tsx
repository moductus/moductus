import type { ButtonHTMLAttributes } from "react";
import { Icone, type NomeIcone } from "./Icone.tsx";
import "./Botao.css";

export type VarianteBotao = "primario" | "secundario" | "fantasma";
export type TamanhoBotao = "normal" | "pequeno";

interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  /** Ícone à esquerda do texto. Sem texto, o botão precisa de `aria-label`. */
  icone?: NomeIcone;
}

export function Botao({
  variante = "secundario",
  tamanho = "normal",
  icone,
  className,
  type = "button",
  children,
  ...resto
}: PropsBotao) {
  const classes = [
    "botao",
    `botao--${variante}`,
    tamanho === "pequeno" && "botao--pequeno",
    icone && children == null && "botao--so-icone",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...resto}>
      {icone && <Icone nome={icone} tamanho={tamanho === "pequeno" ? 14 : 16} />}
      {children}
    </button>
  );
}
