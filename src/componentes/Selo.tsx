import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone.tsx";
import "./Selo.css";

export type TomSelo = "neutro" | "sucesso" | "aviso" | "perigo";

interface PropsSelo {
  tom?: TomSelo;
  /** O texto é obrigatório: o estado nunca é dito só pela cor. */
  children: ReactNode;
  icone?: NomeIcone;
}

/** Selo de status ("pronto", "falhou", "3 dias"). */
export function Selo({ tom = "neutro", children, icone }: PropsSelo) {
  return (
    <span className={`selo selo--${tom}`}>
      {icone && <Icone nome={icone} tamanho={12} />}
      {children}
    </span>
  );
}

const LIMITE_CONTAGEM = 99;

interface PropsContagem {
  valor: number;
  /** Do que é a contagem, para o leitor de tela: "4 tarefas pendentes". */
  rotulo: string;
}

/** Badge numérico (o do dock). Zero não aparece; acima de 99 mostra "99+". */
export function Contagem({ valor, rotulo }: PropsContagem) {
  if (valor <= 0) return null;
  const visivel = valor > LIMITE_CONTAGEM ? `${LIMITE_CONTAGEM}+` : String(valor);
  return (
    <span className="contagem">
      <span aria-hidden="true">{visivel}</span>
      <span className="so-leitor">{`${valor} ${rotulo}`}</span>
    </span>
  );
}
