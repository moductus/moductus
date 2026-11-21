import type { Atendentes } from "../../api/servidor.ts";
import { ErroDasRotinas, type ServicoFechamento } from "./fechamento.ts";
import type { ServicoIgnorados } from "./ignorados.ts";

/** O que a janela lê quando algo de dentro (o banco) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO =
  "O briefing e o fechamento não conseguiram atender o pedido agora. Tente de novo.";

type MetodosDasRotinas = "rotinas.hoje" | "rotinas.agir" | "rotinas.responder";

/**
 * `rotinas.hoje`, `rotinas.agir` e `rotinas.responder` do canal sobre o fechamento, que responde
 * pelas duas rotinas, e a pergunta dos ignorados. Erro da regra (rotina que não existe, ação de
 * outra rotina, pergunta que já passou) vai à janela como veio; o resto vira um texto só, sem o
 * detalhe do banco.
 */
export function atendentesDasRotinas(
  fechamento: Pick<ServicoFechamento, "hoje" | "agir">,
  ignorados: Pick<ServicoIgnorados, "pergunta" | "responder">,
): Pick<Atendentes, MetodosDasRotinas> {
  return {
    "rotinas.hoje": protegido(() => ({ ...fechamento.hoje(), pergunta: perguntaOuNada(ignorados) })),
    "rotinas.agir": protegido((pedido) => fechamento.agir(pedido)),
    "rotinas.responder": protegido((pedido) => ignorados.responder(pedido)),
  };
}

/** A pergunta que não se lê não esconde o briefing e o fechamento. */
function perguntaOuNada(ignorados: Pick<ServicoIgnorados, "pergunta">) {
  try {
    return ignorados.pergunta();
  } catch (erro) {
    console.error(
      `rotinas: a pergunta dos ignorados não se leu: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return null;
  }
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
