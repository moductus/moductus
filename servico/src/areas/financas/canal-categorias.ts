import type { Atendentes } from "../../api/servidor.ts";
import { ErroDasCategorias, type ServicoCategorias } from "./categorias.ts";

/** O que a janela lê quando algo de dentro (o banco) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "As Finanças não conseguiram atender o pedido agora. Tente de novo.";

type MetodosDasCategorias =
  | "financas.categorias"
  | "financas.criarCategoria"
  | "financas.definirCategoria"
  | "financas.apagarCategoria"
  | "financas.regras"
  | "financas.criarRegra"
  | "financas.definirRegra"
  | "financas.apagarRegra";

/**
 * Os métodos de categorias e regras do canal sobre a área. Erro da regra (categoria que não existe,
 * regex recusada) vai à janela como veio; o resto vira um texto só, sem o detalhe do banco.
 */
export function atendentesDasCategorias(
  categorias: ServicoCategorias,
): Pick<Atendentes, MetodosDasCategorias> {
  return {
    "financas.categorias": protegido(() => categorias.categorias()),
    "financas.criarCategoria": protegido((nova) => categorias.criarCategoria(nova)),
    "financas.definirCategoria": protegido((mudanca) => categorias.definirCategoria(mudanca)),
    "financas.apagarCategoria": protegido((pedido) => categorias.apagarCategoria(pedido)),
    "financas.regras": protegido(() => categorias.regras()),
    "financas.criarRegra": protegido((nova) => categorias.criarRegra(nova)),
    "financas.definirRegra": protegido((mudanca) => categorias.definirRegra(mudanca)),
    "financas.apagarRegra": protegido((pedido) => categorias.apagarRegra(pedido)),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDasCategorias) throw erro;
      console.error(
        `categorias: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
