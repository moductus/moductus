import type { Atendentes } from "../../api/servidor.ts";
import { ErroDasContas, type ServicoContas } from "./contas.ts";

/** O que a janela lê quando algo de dentro (o banco, uma conta) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "As Finanças não conseguiram atender o pedido agora. Tente de novo.";

type MetodosDasContas =
  | "financas.contas"
  | "financas.obterConta"
  | "financas.criarConta"
  | "financas.definirConta"
  | "financas.apagarConta"
  | "financas.faturas"
  | "financas.pagarFatura"
  | "financas.desfazerPagamento";

/**
 * Os métodos de contas, cartões e faturas do canal sobre a área. Erro da regra (conta que não
 * existe, conta com lançamento) vai à janela como veio; o resto vira um texto só, sem o detalhe do
 * banco.
 */
export function atendentesDasContas(contas: ServicoContas): Pick<Atendentes, MetodosDasContas> {
  return {
    "financas.contas": protegido((pedido) => contas.contas(pedido)),
    "financas.obterConta": protegido((pedido) => contas.obterConta(pedido)),
    "financas.criarConta": protegido((nova) => contas.criarConta(nova)),
    "financas.definirConta": protegido((mudanca) => contas.definirConta(mudanca)),
    "financas.apagarConta": protegido((pedido) => contas.apagarConta(pedido)),
    "financas.faturas": protegido((pedido) => contas.faturas(pedido)),
    "financas.pagarFatura": protegido((pedido) => contas.pagarFatura(pedido)),
    "financas.desfazerPagamento": protegido((pedido) => contas.desfazerPagamento(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDasContas) throw erro;
      console.error(
        `financas: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
