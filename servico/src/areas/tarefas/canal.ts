import type { Atendentes } from "../../api/servidor.ts";
import { ErroDasTarefas, type ServicoTarefas } from "./tarefas.ts";

/** O que a janela lê quando algo de dentro (o banco, uma conta) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "As Tarefas não conseguiram atender o pedido agora. Tente de novo.";

type MetodosDasTarefas =
  | "listas.listar"
  | "listas.criar"
  | "listas.definir"
  | "listas.ordenar"
  | "listas.apagar"
  | "tarefas.listar"
  | "tarefas.obter"
  | "tarefas.criar"
  | "tarefas.definir"
  | "tarefas.concluir"
  | "tarefas.reabrir"
  | "tarefas.cancelar"
  | "tarefas.adiar"
  | "tarefas.mover"
  | "tarefas.ordenar"
  | "tarefas.apagar"
  | "tarefas.etiquetas";

/**
 * Os métodos `listas.*` e `tarefas.*` do canal sobre a área. Erro da regra (tarefa que não existe,
 * lista padrão) vai à janela como veio; o resto vira um texto só, sem o detalhe do banco.
 */
export function atendentesDasTarefas(tarefas: ServicoTarefas): Pick<Atendentes, MetodosDasTarefas> {
  return {
    "listas.listar": protegido(() => tarefas.listas()),
    "listas.criar": protegido((nova) => tarefas.criarLista(nova)),
    "listas.definir": protegido((mudanca) => tarefas.definirLista(mudanca)),
    "listas.ordenar": protegido((pedido) => tarefas.ordenarListas(pedido)),
    "listas.apagar": protegido((pedido) => tarefas.apagarLista(pedido)),
    "tarefas.listar": protegido((pedido) => tarefas.listar(pedido)),
    "tarefas.obter": protegido((pedido) => tarefas.obter(pedido)),
    "tarefas.criar": protegido((nova) => tarefas.criar(nova)),
    "tarefas.definir": protegido((mudanca) => tarefas.definir(mudanca)),
    "tarefas.concluir": protegido((pedido) => tarefas.concluir(pedido)),
    "tarefas.reabrir": protegido((pedido) => tarefas.reabrir(pedido)),
    "tarefas.cancelar": protegido((pedido) => tarefas.cancelar(pedido)),
    "tarefas.adiar": protegido((pedido) => tarefas.adiar(pedido)),
    "tarefas.mover": protegido((pedido) => tarefas.mover(pedido)),
    "tarefas.ordenar": protegido((pedido) => tarefas.ordenar(pedido)),
    "tarefas.apagar": protegido((pedido) => tarefas.apagar(pedido)),
    "tarefas.etiquetas": protegido(() => tarefas.etiquetas()),
  };
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDasTarefas) throw erro;
      console.error(
        `tarefas: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
