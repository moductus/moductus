import type { Atendentes } from "../../api/servidor.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { ErroDasContas } from "./contas.ts";
import { ErroDosLancamentos, type ServicoLancamentos } from "./lancamentos.ts";

type MetodosDosLancamentos =
  | "financas.lancamentos"
  | "financas.obterLancamento"
  | "financas.lancar"
  | "financas.transferir"
  | "financas.definirLancamento"
  | "financas.apagarLancamento"
  | "financas.restaurarLancamento"
  | "financas.resumo";

/**
 * Os métodos de lançamentos e do resumo do mês do canal sobre a área. Erro da regra (lançamento que
 * não existe, conta arquivada, fatura do cartão) vai à janela como veio; o resto vira um texto só,
 * sem o detalhe do banco.
 */
export function atendentesDosLancamentos(
  lancamentos: ServicoLancamentos,
): Pick<Atendentes, MetodosDosLancamentos> {
  return {
    "financas.lancamentos": protegido((pedido) => lancamentos.lancamentos(pedido)),
    "financas.obterLancamento": protegido((pedido) => lancamentos.obterLancamento(pedido)),
    "financas.lancar": protegido((novo) => lancamentos.lancar(novo)),
    "financas.transferir": protegido((nova) => lancamentos.transferir(nova)),
    "financas.definirLancamento": protegido((mudanca) => lancamentos.definirLancamento(mudanca)),
    "financas.apagarLancamento": protegido((pedido) => lancamentos.apagarLancamento(pedido)),
    "financas.restaurarLancamento": protegido((pedido) => lancamentos.restaurarLancamento(pedido)),
    "financas.resumo": protegido((pedido) => lancamentos.resumo(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDosLancamentos || erro instanceof ErroDasContas) throw erro;
      console.error(
        `lancamentos: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
