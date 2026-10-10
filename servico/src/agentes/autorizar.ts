import type { Aprovacao } from "@moductus/contrato";
import { MENSAGEM_NEGADO, type ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import type { Autorizacao, PedidoAutorizacao } from "../ferramentas/catalogo.ts";
import type { Ferramenta, TextoCartao } from "../ferramentas/ferramenta.ts";

/**
 * O sim de uma ação `externo` de agente (AGENTS.md §4): passa pelas regras do usuário e, sem
 * regra, vira cartão no dock; a ferramenta só roda com o sim. `aoCartao` avisa quem chamou que um
 * cartão foi criado, para a execução guardar o id e o agente aparecer "esperando você".
 */
export type AutorizarComCartao = (
  pedido: PedidoAutorizacao,
  aoCartao: (aprovacao: Aprovacao) => void,
) => Promise<Autorizacao>;

/** O que volta ao modelo quando o cartão sai sem decisão. */
export const MENSAGEM_EXPIRADA = "O pedido expirou sem decisão do usuário. Nada foi feito.";

/** O que volta ao modelo quando uma regra do usuário nega a ação sem cartão. */
export const MENSAGEM_REGRA_NEGA = "Uma regra do usuário nega esta ação. Nada foi feito.";

export function autorizarPorAprovacao(aprovacoes: ServicoAprovacoes): AutorizarComCartao {
  return async ({ ferramenta, entrada, contexto }, aoCartao) => {
    const texto = textoDoCartao(ferramenta, entrada);
    const pedido = aprovacoes.pedir({
      fonte: "moductus",
      agenteId: contexto.agenteId,
      execucaoId: contexto.execucaoId,
      descricao: texto.descricao,
      acao: {
        ferramenta: ferramenta.nome,
        entrada,
        rotulo: texto.rotulo,
        rotuloRecusar: texto.rotuloRecusar ?? null,
        desfazivel: texto.desfazivel ?? false,
      },
    });
    if (pedido.tipo === "regra") {
      return pedido.decisao === "permitir"
        ? { permitida: true }
        : { permitida: false, motivo: MENSAGEM_REGRA_NEGA };
    }

    aoCartao(pedido.aprovacao);
    let desfecho;
    try {
      desfecho = await aprovacoes.esperar(pedido.aprovacao.id, contexto.sinal);
    } catch (erro) {
      // A execução foi cancelada: o cartão perde o sentido e sai do dock.
      aprovacoes.expirar(pedido.aprovacao.id);
      throw erro;
    }
    switch (desfecho.aprovacao.estado) {
      case "aprovada":
        return { permitida: true };
      case "negada":
        return { permitida: false, motivo: desfecho.mensagem ?? MENSAGEM_NEGADO };
      default:
        return { permitida: false, motivo: MENSAGEM_EXPIRADA };
    }
  };
}

/** O texto que a ferramenta declarou; `ferramenta()` não deixa declarar `externo` sem ele. */
function textoDoCartao(ferramenta: Ferramenta, entrada: unknown): TextoCartao {
  const texto = ferramenta.cartao(entrada);
  if (!texto) throw new Error(`${ferramenta.nome} pede aprovação sem o texto do cartão`);
  return texto;
}
