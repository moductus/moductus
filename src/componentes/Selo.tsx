import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone.tsx";
import "./Selo.css";

/** Apagado (terminou, desligado): o ponto apaga; o texto fica legível no texto.3. */
export type TomSelo = "neutro" | "apagado" | "sucesso" | "aviso" | "perigo";

/** `selo`: pílula das listas (Agentes.dc.html); `ponto`: ponto e texto, nas linhas de sessão e de PR. */
export type FormaSelo = "selo" | "ponto";

interface PropsSelo {
  tom?: TomSelo;
  forma?: FormaSelo;
  /** O texto é obrigatório: o estado nunca é dito só pela cor (DESIGN.md §5). */
  children: ReactNode;
  icone?: NomeIcone;
}

/**
 * Selo de status com texto ("pronto", "esperando você", "CI falhou"). O texto vai na cor do
 * status e a borda fica neutra, como o pill() do Agentes.dc.html; na forma de ponto, o ponto
 * colorido vem antes do texto e some para o leitor de tela.
 */
export function Selo({ tom = "neutro", forma = "selo", children, icone }: PropsSelo) {
  return (
    <span className={`selo selo--${tom}`} data-forma={forma}>
      {forma === "ponto" && <span className="selo-ponto" aria-hidden="true" />}
      {icone && <Icone nome={icone} tamanho={12} />}
      {children}
    </span>
  );
}

const LIMITE_CONTAGEM = 99;

/** Do que é a contagem; com singular, "1 tarefa pendente" em vez de "1 tarefas pendentes". */
export type RotuloContagem = string | { um: string; varios: string };

/** O número como aparece: acima de 99, "99+". */
export const numeroDaContagem = (valor: number) =>
  valor > LIMITE_CONTAGEM ? `${LIMITE_CONTAGEM}+` : String(valor);

/** O que o leitor de tela lê: "4 tarefas pendentes", sempre o número inteiro. */
export function textoDaContagem(valor: number, rotulo: RotuloContagem): string {
  const nome = typeof rotulo === "string" ? rotulo : valor === 1 ? rotulo.um : rotulo.varios;
  return `${valor} ${nome}`;
}

interface PropsContagem {
  valor: number;
  /** Do que é a contagem, para o leitor de tela: "4 tarefas pendentes". */
  rotulo: RotuloContagem;
}

/** Badge numérico (o do dock). Zero não aparece; acima de 99 mostra "99+". */
export function Contagem({ valor, rotulo }: PropsContagem) {
  if (valor <= 0) return null;
  return (
    <span className="contagem">
      <span aria-hidden="true">{numeroDaContagem(valor)}</span>
      <span className="so-leitor">{textoDaContagem(valor, rotulo)}</span>
    </span>
  );
}
