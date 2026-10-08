import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icone, type NomeIcone } from "../componentes/Icone.tsx";
import "./ListaNavegacao.css";

export interface ItemNavegacao<T extends string> {
  id: T;
  nome: string;
  icone?: NomeIcone;
  /** Atalho anunciado (aria-keyshortcuts) e mostrado à direita ao passar o mouse ou focar. */
  atalho?: { aria: string; texto: string };
}

interface PropsListaNavegacao<T extends string> {
  itens: readonly ItemNavegacao<T>[];
  ativo: T;
  aoEscolher: (id: T) => void;
  /** Nome da navegação para o leitor de tela ("Áreas", "Seções"). */
  rotulo: string;
  className?: string;
  /** O que vem antes da lista dentro do mesmo `nav` (a busca, na barra lateral). */
  antes?: ReactNode;
  depois?: ReactNode;
}

const PROXIMO = new Set(["ArrowDown", "ArrowRight"]);
const ANTERIOR = new Set(["ArrowUp", "ArrowLeft"]);

/**
 * Lista vertical de navegação: um Tab entra no item ativo, as setas andam e já abrem (com volta
 * nas pontas), Home e End vão às pontas. O item ativo leva aria-current="page".
 */
export function ListaNavegacao<T extends string>({
  itens,
  ativo,
  aoEscolher,
  rotulo,
  className,
  antes,
  depois,
}: PropsListaNavegacao<T>) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const indiceAtivo = Math.max(
    0,
    itens.findIndex((i) => i.id === ativo),
  );

  const ir = (indice: number) => {
    const item = itens[indice];
    if (!item) return;
    botoes.current[indice]?.focus();
    aoEscolher(item.id);
  };

  const aoTeclar = (e: KeyboardEvent, indice: number) => {
    const n = itens.length;
    let alvo: number | undefined;
    if (PROXIMO.has(e.key)) alvo = (indice + 1) % n;
    else if (ANTERIOR.has(e.key)) alvo = (indice - 1 + n) % n;
    else if (e.key === "Home") alvo = 0;
    else if (e.key === "End") alvo = n - 1;
    if (alvo === undefined) return;
    e.preventDefault();
    ir(alvo);
  };

  return (
    <nav aria-label={rotulo} className={["navegacao", className].filter(Boolean).join(" ")}>
      {antes}
      <ul className="navegacao-lista">
        {itens.map((item, i) => (
          <li key={item.id}>
            <button
              ref={(el) => {
                botoes.current[i] = el;
              }}
              type="button"
              className="navegacao-item"
              data-id={item.id}
              aria-current={item.id === ativo ? "page" : undefined}
              aria-keyshortcuts={item.atalho?.aria}
              tabIndex={i === indiceAtivo ? 0 : -1}
              onClick={() => ir(i)}
              onKeyDown={(e) => aoTeclar(e, i)}
            >
              {item.icone && <Icone nome={item.icone} />}
              <span className="navegacao-nome">{item.nome}</span>
              {item.atalho && (
                <span className="navegacao-atalho" aria-hidden="true">
                  {item.atalho.texto}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {depois}
    </nav>
  );
}
