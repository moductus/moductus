import type { Lancamento } from "@moductus/contrato";
import type { HTMLAttributes, ReactNode } from "react";
import { Icone } from "./Icone.tsx";
import type { Agente } from "./personagem/agentes.ts";
import { Personagem } from "./personagem/Personagem.tsx";
import { TextoSensivel } from "./TextoSensivel.tsx";
import { Valor } from "./Valor.tsx";
import "./LinhaLancamento.css";

interface PropsLinhaLancamento extends HTMLAttributes<HTMLLIElement> {
  lancamento: Pick<
    Lancamento,
    | "descricao"
    | "valorCentavos"
    | "moeda"
    | "parcelaNumero"
    | "parcelaTotal"
    | "transferenciaId"
    | "conciliado"
  >;
  /** Nome da categoria ("Casa › Mercado"); `null` é "sem categoria", menos na transferência. */
  categoria: string | null;
  /**
   * Quem lançou e de onde (DESIGN §5, origem): "Tula leu o extrato", "você, pela captura". Nome de
   * conta na origem ("importado do Nubank") vai num `TextoSensivel`, para sumir com o modo ligado.
   */
  origem: ReactNode;
  /** Agente que lançou: a cabeça dele vem antes da origem. */
  agente?: Agente;
  /** A conta, quando a lista mistura contas. */
  conta?: string;
}

/**
 * Um lançamento numa lista (PainelFinancas, AreaLancamentos): descrição com a parcela, categoria e
 * origem embaixo, a conta e o valor à direita. Entrada leva "+", transferência não tem sinal, e a
 * descrição e a conta somem com o modo privacidade, como o valor. Vai dentro de uma `Lista`.
 */
export function LinhaLancamento({
  lancamento,
  categoria,
  origem,
  agente,
  conta,
  className,
  ...resto
}: PropsLinhaLancamento) {
  const transferencia = lancamento.transferenciaId !== null;
  const { parcelaNumero, parcelaTotal } = lancamento;
  return (
    <li className={["linha-lancamento", className].filter(Boolean).join(" ")} {...resto}>
      <span className="linha-lancamento-texto">
        <span className="linha-lancamento-principal">
          {transferencia && <Icone nome="transferencia" tamanho={14} rotulo="Transferência" />}
          <TextoSensivel className="linha-lancamento-descricao">{lancamento.descricao}</TextoSensivel>
          {parcelaNumero !== null && parcelaTotal !== null && (
            <span className="linha-lancamento-parcela">
              <span aria-hidden="true">{`${parcelaNumero}/${parcelaTotal}`}</span>
              <span className="so-leitor">{`parcela ${parcelaNumero} de ${parcelaTotal}`}</span>
            </span>
          )}
        </span>
        <span className="linha-lancamento-detalhe">
          {categoria !== null ? (
            <span className="linha-lancamento-categoria">{categoria}</span>
          ) : (
            !transferencia && <span className="linha-lancamento-sem-categoria">sem categoria</span>
          )}
          {(categoria !== null || !transferencia) && <span aria-hidden="true">·</span>}
          {agente && (
            <span className="linha-lancamento-agente" aria-hidden="true">
              <Personagem agente={agente} modo="cabeca" tamanho="mini" />
            </span>
          )}
          <span className="linha-lancamento-origem">{origem}</span>
          {lancamento.conciliado && (
            <span className="linha-lancamento-conciliado">
              <Icone nome="visto" tamanho={12} />
              conciliado
            </span>
          )}
        </span>
      </span>
      {conta !== undefined && <TextoSensivel className="linha-lancamento-conta">{conta}</TextoSensivel>}
      <Valor
        className="linha-lancamento-valor"
        centavos={lancamento.valorCentavos}
        moeda={lancamento.moeda}
        sinal
        transferencia={transferencia}
      />
    </li>
  );
}
