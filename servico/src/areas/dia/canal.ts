import type { Atendentes } from "../../api/servidor.ts";
import { ErroDasRotinas, type ServicoFechamento } from "./fechamento.ts";

/** O que a janela lê quando algo de dentro (o banco) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO =
  "O briefing e o fechamento não conseguiram atender o pedido agora. Tente de novo.";

type MetodosDasRotinas = "rotinas.hoje" | "rotinas.agir";

/**
 * `rotinas.hoje` e `rotinas.agir` do canal sobre o fechamento, que responde pelas duas rotinas.
 * Erro da regra (rotina que não existe, ação de outra rotina) vai à janela como veio; o resto vira
 * um texto só, sem o detalhe do banco.
 */
export function atendentesDasRotinas(
  fechamento: Pick<ServicoFechamento, "hoje" | "agir">,
): Pick<Atendentes, MetodosDasRotinas> {
  return {
    "rotinas.hoje": protegido(() => fechamento.hoje()),
    "rotinas.agir": protegido((pedido) => fechamento.agir(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDasRotinas) throw erro;
      console.error(
        `rotinas: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
