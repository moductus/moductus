import { useRef, type KeyboardEvent } from "react";
import "./Seletor.css";

export interface OpcaoSeletor<T extends string> {
  valor: T;
  rotulo: string;
  desativada?: boolean;
}

interface PropsSeletor<T extends string> {
  opcoes: readonly OpcaoSeletor<T>[];
  valor: T;
  aoMudar: (valor: T) => void;
  /** Nome do grupo ("Tema", "Posição do dock"). */
  rotulo: string;
}

const PROXIMA = new Set(["ArrowRight", "ArrowDown"]);
const ANTERIOR = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * Seletor segmentado no padrão radiogroup: um só Tab entra no grupo (na opção marcada), as
 * setas andam e já escolhem, com volta nas pontas; Home e End vão às pontas.
 */
export function Seletor<T extends string>({ opcoes, valor, aoMudar, rotulo }: PropsSeletor<T>) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const habilitadas = opcoes.map((o, i) => (o.desativada ? -1 : i)).filter((i) => i >= 0);
  const atual = opcoes.findIndex((o) => o.valor === valor);
  // Sem opção marcada válida, o Tab entra pela primeira habilitada.
  const focavel = habilitadas.includes(atual) ? atual : habilitadas[0];

  const escolher = (indice: number) => {
    botoes.current[indice]?.focus();
    const escolhida = opcoes[indice];
    if (escolhida && escolhida.valor !== valor) aoMudar(escolhida.valor);
  };

  const aoTeclar = (e: KeyboardEvent, indice: number) => {
    const posicao = habilitadas.indexOf(indice);
    const n = habilitadas.length;
    let alvo: number | undefined;
    if (PROXIMA.has(e.key)) alvo = habilitadas[(posicao + 1) % n];
    else if (ANTERIOR.has(e.key)) alvo = habilitadas[(posicao - 1 + n) % n];
    else if (e.key === "Home") alvo = habilitadas[0];
    else if (e.key === "End") alvo = habilitadas[n - 1];
    if (alvo === undefined) return;
    e.preventDefault();
    escolher(alvo);
  };

  return (
    <div role="radiogroup" aria-label={rotulo} className="seletor">
      {opcoes.map((opcao, i) => {
        const marcada = i === atual;
        return (
          <button
            key={opcao.valor}
            ref={(el) => {
              botoes.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={marcada}
            disabled={opcao.desativada}
            tabIndex={i === focavel ? 0 : -1}
            className="seletor-opcao"
            onClick={() => escolher(i)}
            onKeyDown={(e) => aoTeclar(e, i)}
          >
            {opcao.rotulo}
          </button>
        );
      })}
    </div>
  );
}
