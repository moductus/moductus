import type { HTMLAttributes, ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone.tsx";
import "./ItemLista.css";

/** Lista sem marcadores; os itens se separam por borda. */
export function Lista({ className, ...resto }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={["lista", className].filter(Boolean).join(" ")} {...resto} />;
}

interface PropsItemLista extends HTMLAttributes<HTMLLIElement> {
  icone?: NomeIcone;
  /** O que fica à direita: hora, valor, atalho, selo. */
  meta?: ReactNode;
  /** Texto secundário abaixo do principal. */
  detalhe?: ReactNode;
}

export function ItemLista({ icone, meta, detalhe, className, children, ...resto }: PropsItemLista) {
  return (
    <li className={["item-lista", className].filter(Boolean).join(" ")} {...resto}>
      {icone && <Icone nome={icone} />}
      <span className="item-lista-texto">
        <span className="item-lista-principal">{children}</span>
        {detalhe && <span className="item-lista-detalhe">{detalhe}</span>}
      </span>
      {meta && <span className="item-lista-meta">{meta}</span>}
    </li>
  );
}
