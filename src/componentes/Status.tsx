import type { TomStatus } from "./personagem/situacao.ts";
import "./Status.css";

export type { TomStatus };

/** `selo`: pílula das listas do time; `ponto`: ponto e texto, nas linhas de sessão e de PR. */
export type FormaStatus = "selo" | "ponto";

interface PropsStatus {
  tom?: TomStatus;
  forma?: FormaStatus;
  /** O texto é obrigatório: status nunca só por cor (DESIGN.md §5). */
  children: string;
}

/**
 * Selo de status com texto ("esperando você", "CI falhou"). O texto vai na cor do status e a
 * borda fica neutra, como no Agentes.dc.html; na forma de ponto, o ponto colorido vem antes.
 */
export function Status({ tom = "neutro", forma = "selo", children }: PropsStatus) {
  return (
    <span className="status" data-tom={tom} data-forma={forma}>
      {forma === "ponto" && <span className="status-ponto" aria-hidden="true" />}
      {children}
    </span>
  );
}
