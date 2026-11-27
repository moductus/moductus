import type { Atendentes } from "../../api/servidor.ts";
import { ErroDoArquivo } from "../../arquivos/autorizacoes.ts";
import { ErroDoOcr } from "../../casca/ocr.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import type { ServicoComprovante } from "./comprovante.ts";

/**
 * `financas.lerComprovante` sobre a área. A autorização vencida ou usada e o caminho recusado pela
 * casca vão à janela como vieram; o resto vira um texto só, sem o caminho nem o detalhe do sistema.
 */
export function atendentesDoComprovante(
  comprovante: Pick<ServicoComprovante, "ler">,
): Pick<Atendentes, "financas.lerComprovante"> {
  return {
    "financas.lerComprovante": async (pedido) => {
      try {
        return await comprovante.ler(pedido);
      } catch (erro) {
        if (erro instanceof ErroDoArquivo || erro instanceof ErroDoOcr) throw erro;
        console.error(
          `comprovante: leitura falhou por dentro: ${erro instanceof Error ? erro.message : String(erro)}`,
        );
        // A causa fica no objeto, para o log; o canal só manda a mensagem.
        throw new Error(MENSAGEM_ERRO_INTERNO, { cause: erro });
      }
    },
  };
}
