import type { ServidorMcp } from "../mcp/servidor.ts";
import type { AberturaMcp } from "../provedores/claude-cli/claude-cli.ts";
import type { ResultadoDeFerramenta } from "../provedores/provedor.ts";
import type { ExecutorDeFerramentas } from "./runtime.ts";

/** O que volta ao CLI quando a chamada chega depois de a execução terminar. */
export const MENSAGEM_EXECUCAO_ENCERRADA = "Esta execução já terminou. Nada foi feito.";

/**
 * Liga o servidor MCP do Moductus às execuções do runtime: cada execução de agente em CLI abre o
 * próprio acesso, e as chamadas que chegam por ele rodam pelo executor da execução no runtime, com
 * o escopo do agente, o cartão para `externo` e o registro em `chamadas_ferramenta`. Chamada que
 * chega depois do fim da execução não roda.
 */
export function aberturaMcpDoRuntime(
  servidor: Pick<ServidorMcp, "abrir">,
  executorDa: (execucaoId: string) => ExecutorDeFerramentas | null,
): AberturaMcp {
  return {
    abrir: (pedido) =>
      servidor.abrir({
        ferramentas: pedido.ferramentas,
        executarFerramenta: (chamada): Promise<ResultadoDeFerramenta> => {
          const executar = executorDa(pedido.execucaoId);
          if (!executar) return Promise.resolve({ ok: false, erro: MENSAGEM_EXECUCAO_ENCERRADA });
          return executar(chamada);
        },
      }),
  };
}
