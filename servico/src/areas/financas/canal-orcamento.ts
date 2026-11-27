import type { Atendentes } from "../../api/servidor.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { ErroDoOrcamento, type ServicoOrcamento } from "./orcamento.ts";

type MetodosDoOrcamento =
  | "financas.orcamento"
  | "financas.definirOrcamento"
  | "financas.removerOrcamento"
  | "financas.remanejar"
  | "financas.desfazerRemanejar";

/**
 * Os métodos do orçamento do canal sobre a área. Erro da regra (categoria que não é de gasto,
 * remanejar além do limite, desfazer fora do prazo) vai à janela como veio; o resto vira um texto
 * só, sem o detalhe do banco.
 */
export function atendentesDoOrcamento(orcamento: ServicoOrcamento): Pick<Atendentes, MetodosDoOrcamento> {
  return {
    "financas.orcamento": protegido((pedido) => orcamento.orcamento(pedido)),
    "financas.definirOrcamento": protegido((definicao) => orcamento.definirOrcamento(definicao)),
    "financas.removerOrcamento": protegido((pedido) => orcamento.removerOrcamento(pedido)),
    "financas.remanejar": protegido((pedido) => orcamento.remanejar(pedido)),
    "financas.desfazerRemanejar": protegido((pedido) => orcamento.desfazerRemanejar(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDoOrcamento) throw erro;
      console.error(
        `orcamento: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
