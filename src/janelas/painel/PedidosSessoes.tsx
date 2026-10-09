import type { Aprovacao, FerramentaSessao } from "@moductus/contrato";
import { useId } from "react";
import { CartaoAprovacao } from "../../componentes/CartaoAprovacao.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { decidirPedido, detalheDoPedido, type PedidosDoTerminal } from "../../servico/aprovacoes.ts";

/** Nome de cada ferramenta de sessão, como o Agentes.dc.html escreve na linha da sessão. */
export const NOME_FERRAMENTA: Readonly<Record<FerramentaSessao, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
  antigravity: "Antigravity",
};

function Origem({ aprovacao, projeto }: { aprovacao: Aprovacao; projeto: string | undefined }) {
  const ferramenta = aprovacao.fonte === "moductus" ? null : NOME_FERRAMENTA[aprovacao.fonte];
  return (
    <>
      {/* Depois da resposta, quem diz o que valeu é o desfecho do próprio cartão. */}
      {aprovacao.estado === "pendente" && (
        <Selo forma="ponto" tom="aviso">
          esperando você
        </Selo>
      )}
      {projeto && <span className="pedidos-projeto">{projeto}</span>}
      {ferramenta && <span className="pedidos-ferramenta">{ferramenta}</span>}
    </>
  );
}

/**
 * Pedidos de permissão das sessões do terminal no painel do time (Agentes.dc.html, seção
 * "Sessões de IA"): o cartão de cada pedido com Negar, Sempre neste projeto e Permitir. A
 * resposta vai ao serviço, que a devolve ao Claude Code pelo hook. Sem pedido, não aparece.
 */
export function PedidosSessoes({ pedidos }: { pedidos: PedidosDoTerminal }) {
  const idTitulo = useId();
  const { aprovacoes, projetos } = pedidos;
  if (aprovacoes.length === 0) return null;
  const esperando = aprovacoes.filter((a) => a.estado === "pendente").length;
  return (
    <section className="pedidos" aria-labelledby={idTitulo}>
      <header className="pedidos-cabecalho">
        <h2 id={idTitulo} className="pedidos-titulo">
          Sessões de IA
        </h2>
        {esperando > 0 && <span>{`${esperando} esperando você`}</span>}
      </header>
      {aprovacoes.map((aprovacao) => {
        const detalhe = detalheDoPedido(aprovacao.acao);
        return (
          <CartaoAprovacao
            key={aprovacao.id}
            aprovacao={aprovacao}
            origem={
              <Origem
                aprovacao={aprovacao}
                projeto={aprovacao.sessaoId ? projetos[aprovacao.sessaoId] : undefined}
              />
            }
            detalhe={detalhe && <code>{detalhe}</code>}
            aoDecidir={decidirPedido}
          />
        );
      })}
    </section>
  );
}
