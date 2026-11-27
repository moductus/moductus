import type { Atendentes } from "../api/servidor.ts";
import { ErroDoArquivo, type AutorizacoesDeArquivo } from "./autorizacoes.ts";

/** O que a janela lê quando algo de dentro falhou: o detalhe vai para o log. */
export const MENSAGEM_ERRO_INTERNO = "O Moductus não conseguiu conferir o arquivo agora. Tente de novo.";

/**
 * `arquivos.autorizar` sobre as autorizações (ADR-0044). A recusa (pasta, grande demais, extensão)
 * vai à janela como veio; o resto vira um texto só, sem o caminho nem o detalhe do sistema.
 */
export function atendentesDosArquivos(
  autorizacoes: Pick<AutorizacoesDeArquivo, "autorizar">,
): Pick<Atendentes, "arquivos.autorizar"> {
  return {
    "arquivos.autorizar": (pedido) => {
      try {
        return autorizacoes.autorizar(pedido);
      } catch (erro) {
        if (erro instanceof ErroDoArquivo) throw erro;
        console.error(
          `arquivos: autorizar falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
        );
        throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
      }
    },
  };
}
