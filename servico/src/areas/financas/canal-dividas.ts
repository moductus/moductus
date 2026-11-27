import type { Atendentes } from "../../api/servidor.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { ErroDasContas } from "./contas.ts";
import { ErroDasDividas, type ServicoDividas } from "./dividas.ts";
import { ErroDosLancamentos } from "./lancamentos.ts";

type MetodosDasDividas =
  | "dividas.listar"
  | "dividas.obter"
  | "dividas.criar"
  | "dividas.definir"
  | "dividas.apagar"
  | "dividas.registrarPagamento"
  | "dividas.quitar"
  | "dividas.simular";

/**
 * Os métodos de dívidas do canal sobre a área. Erro da regra (dívida que não existe, parcela que não
 * passa dos juros, conta arquivada no pagamento lançado) vai à janela como veio; o resto vira um
 * texto só, sem o detalhe do banco.
 */
export function atendentesDasDividas(dividas: ServicoDividas): Pick<Atendentes, MetodosDasDividas> {
  return {
    "dividas.listar": protegido((pedido) => dividas.listar(pedido)),
    "dividas.obter": protegido((pedido) => dividas.obter(pedido)),
    "dividas.criar": protegido((nova) => dividas.criar(nova)),
    "dividas.definir": protegido((mudanca) => dividas.definir(mudanca)),
    "dividas.apagar": protegido((pedido) => dividas.apagar(pedido)),
    "dividas.registrarPagamento": protegido((pedido) => dividas.registrarPagamento(pedido)),
    "dividas.quitar": protegido((pedido) => dividas.quitar(pedido)),
    "dividas.simular": protegido((pedido) => dividas.simular(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (
        erro instanceof ErroDasDividas ||
        erro instanceof ErroDosLancamentos ||
        erro instanceof ErroDasContas
      ) {
        throw erro;
      }
      console.error(
        `dividas: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
