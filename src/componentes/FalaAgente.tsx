import { useId, type ReactNode } from "react";
import type { TamanhoPersonagem } from "../tokens/personagens.ts";
import { DADOS_AGENTES, type Agente, type EstadoPersonagem } from "./personagem/agentes.ts";
import { Personagem } from "./personagem/Personagem.tsx";
import "./FalaAgente.css";

interface PropsFalaAgente {
  agente: Agente;
  /** Expressão da cabeça; o padrão é descansando. */
  estado?: EstadoPersonagem;
  /** Até duas frases, número antes de adjetivo, sem emoji (AGENTS.md §2, "Voz dos agentes"). */
  children: ReactNode;
  /** A ação logo abaixo da fala, nunca num modal: botões ou um cartão de aprovação. */
  acao?: ReactNode;
  /** Cabeça de 20 a 30 px (DESIGN.md §5); o padrão é a da conversa. */
  tamanho?: TamanhoPersonagem | number;
}

/**
 * Fala do agente (DESIGN.md §5, Conversas.dc.html): cabeça do personagem, nome na cor de
 * identidade e o texto. A mesma peça serve à conversa, ao briefing e ao painel do time.
 */
export function FalaAgente({ agente, estado = "ocioso", children, acao, tamanho = "fala" }: PropsFalaAgente) {
  const idNome = useId();
  return (
    <article className="fala" data-agente={agente} aria-labelledby={idNome}>
      <Personagem agente={agente} modo="cabeca" tamanho={tamanho} estado={estado} />
      <div className="fala-corpo">
        <span id={idNome} className="fala-nome">
          {DADOS_AGENTES[agente].nome}
        </span>
        <p className="fala-texto">{children}</p>
        {acao && <div className="fala-acao">{acao}</div>}
      </div>
    </article>
  );
}
