import type { Atendentes } from "../../api/servidor.ts";
import { ErroDaCaptura, type ServicoCaptura } from "./captura.ts";

/** O que a janela lê quando algo de dentro (o banco, uma área) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "A captura não conseguiu atender o pedido agora. Tente de novo.";

type MetodosDaCaptura = "captura.entender" | "captura.lancar" | "captura.desfazer";

/**
 * Os métodos `captura.*` do canal sobre a área. Erro da regra (falta a hora do lembrete, o prazo do
 * desfazer passou) vai à janela como veio; o resto vira um texto só, sem o detalhe de dentro.
 */
export function atendentesDaCaptura(captura: ServicoCaptura): Pick<Atendentes, MetodosDaCaptura> {
  return {
    "captura.entender": protegido((pedido) => captura.entender(pedido)),
    "captura.lancar": protegido((pedido) => captura.lancar(pedido)),
    "captura.desfazer": protegido((pedido) => captura.desfazer(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => Promise<S>): (entrada: E) => Promise<S> {
  return async (entrada) => {
    try {
      return await atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDaCaptura) throw erro;
      console.error(
        `captura: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
