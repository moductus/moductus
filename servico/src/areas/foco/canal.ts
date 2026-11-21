import type { Atendentes } from "../../api/servidor.ts";
import type { CanalCasca } from "../../casca/canal.ts";
import { ErroDoFoco, type ServicoFoco } from "./foco.ts";

/** O que a janela lê quando algo de dentro (o banco, uma conta) falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "O Foco não conseguiu atender o pedido agora. Tente de novo.";

/**
 * Tipo do aviso que a casca manda, sem pedido, quando o atalho do foco (Ctrl+Alt+P, configurável)
 * é apertado em qualquer lugar (`src-tauri/src/atalhos.rs`, ação `Foco`).
 */
export const ATALHO_DO_FOCO = "foco-alternar";

type MetodosDoFoco =
  | "foco.obter"
  | "foco.iniciar"
  | "foco.alternar"
  | "foco.pausar"
  | "foco.retomar"
  | "foco.estender"
  | "foco.terminar"
  | "foco.pularPausa"
  | "foco.historico";

/**
 * Os métodos `foco.*` do canal sobre a área. Erro da regra (nada em andamento, tarefa que não
 * existe) vai à janela como veio; o resto vira um texto só, sem o detalhe do banco.
 */
export function atendentesDoFoco(foco: ServicoFoco): Pick<Atendentes, MetodosDoFoco> {
  return {
    "foco.obter": protegido(() => foco.obter()),
    "foco.iniciar": protegido((pedido) => foco.iniciar(pedido)),
    "foco.alternar": protegido(() => foco.alternar()),
    "foco.pausar": protegido(() => foco.pausar()),
    "foco.retomar": protegido(() => foco.retomar()),
    "foco.estender": protegido((pedido) => foco.estender(pedido)),
    "foco.terminar": protegido(() => foco.terminar()),
    "foco.pularPausa": protegido(() => foco.pularPausa()),
    "foco.historico": protegido((pedido) => foco.historico(pedido)),
  };
}

/**
 * O atalho do foco vindo da casca: inicia, pausa ou retoma, como o `foco.alternar`. A janela fica
 * sabendo pelo `foco.mudou`; uma falha vai ao log e não derruba o canal.
 */
export function ouvirAtalhoDoFoco(
  canal: Pick<CanalCasca, "aoAvisar">,
  foco: Pick<ServicoFoco, "alternar">,
): void {
  canal.aoAvisar(ATALHO_DO_FOCO, () => {
    try {
      foco.alternar();
    } catch (erro) {
      console.error(`foco: atalho falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  });
}

function protegido<E, S>(atender: (entrada: E) => S): (entrada: E) => S {
  return (entrada) => {
    try {
      return atender(entrada);
    } catch (erro) {
      if (erro instanceof ErroDoFoco) throw erro;
      console.error(`foco: pedido falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`);
      // A causa fica no objeto, para o log; o canal só manda a mensagem.
      throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
    }
  };
}
