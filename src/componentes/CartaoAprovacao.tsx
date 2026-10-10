import type { Aprovacao, EstadoAprovacao, PedidoDecidir } from "@moductus/contrato";
import { useId, useState, type ReactNode } from "react";
import { Botao, type TamanhoBotao } from "./Botao.tsx";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { Selo, type TomSelo } from "./Selo.tsx";
import "./CartaoAprovacao.css";

/** Botões genéricos, só para o pedido de uma sessão do terminal (DESIGN.md §5). */
export const PERMITIR = "Permitir";
export const NEGAR = "Negar";
export const SEMPRE_NESTE_PROJETO = "Sempre neste projeto";

/** O pedido nem saiu: aí, e só aí, dá para afirmar que nada foi decidido. */
export const ERRO_SEM_SERVICO = "O serviço não está respondendo. Nada foi enviado; tente de novo.";
/** Saiu e falhou no caminho: o serviço pode ter decidido. */
export const ERRO_SEM_CONFIRMACAO = "Não consegui confirmar sua resposta. Confira o pedido de novo.";

/**
 * O que dizer quando a resposta não valeu: sem serviço, nada saiu; recusado, o serviço explica
 * ("o arquivo fica fora do projeto"); a conexão caiu no meio, não dá para saber.
 */
function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ServicoIndisponivel) return ERRO_SEM_SERVICO;
  if (erro instanceof RecusaDoServico) return erro.message;
  return ERRO_SEM_CONFIRMACAO;
}

/** Depois da resposta, o cartão diz o que valeu em vez de mostrar os botões. */
const DESFECHO: Record<Exclude<EstadoAprovacao, "pendente">, { texto: string; tom: TomSelo }> = {
  aprovada: { texto: "permitido", tom: "sucesso" },
  negada: { texto: "negado", tom: "neutro" },
  expirada: { texto: "expirou", tom: "apagado" },
};

interface PropsCartaoAprovacao {
  aprovacao: Aprovacao;
  /** Quem pede, no alto: projeto e ferramenta da sessão, ou o agente. */
  origem?: ReactNode;
  /** O que vai acontecer em detalhe: o comando, a lista de arquivos. */
  detalhe?: ReactNode;
  /**
   * O pedido numa linha, no lugar da descrição ("Quer rodar `npm test`", Agentes.dc.html): o
   * leitor de tela ouve esta linha como a descrição do cartão.
   */
  resumo?: ReactNode;
  /** A descrição já está na fala do agente logo acima (Conversas.dc.html): não repete. */
  semDescricao?: boolean;
  /** Ação a mais entre recusar e permitir ("Ver lista"). */
  extra?: ReactNode;
  tamanho?: TamanhoBotao;
  /**
   * Quem decide é o serviço (`aprovacoes.decidir`); o cartão só manda o pedido e trava até a
   * `aprovacao` chegar decidida (pela resposta ou pelo `aprovacoes.mudou`).
   */
  aoDecidir: (pedido: PedidoDecidir) => Promise<unknown>;
}

/**
 * Cartão de aprovação (DESIGN.md §5, Agentes.dc.html e Conversas.dc.html): cartão elevado com o
 * que vai acontecer, o tamanho e se dá para desfazer. O primário é verbo com objeto; o
 * secundário recusa sem culpa. Pedido de sessão do terminal ganha "Sempre neste projeto", que
 * vira regra de permissão daquele projeto, quando o serviço diz que a regra é possível
 * (`admiteSempre`).
 */
export function CartaoAprovacao({
  aprovacao,
  origem,
  detalhe,
  resumo,
  semDescricao = false,
  extra,
  tamanho = "normal",
  aoDecidir,
}: PropsCartaoAprovacao) {
  const idDescricao = useId();
  // Id do pedido já respondido: os botões ficam travados até o serviço mandar o pedido decidido,
  // para um segundo clique não sair antes de a primeira resposta valer.
  const [respondida, setRespondida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { acao, fonte, estado } = aprovacao;
  const doTerminal = fonte !== "moductus";
  const enviando = respondida === aprovacao.id && estado === "pendente";

  const decidir = (pedido: Omit<PedidoDecidir, "id">) => {
    setErro(null);
    setRespondida(aprovacao.id);
    aoDecidir({ id: aprovacao.id, ...pedido }).catch((e: unknown) => {
      setRespondida(null);
      setErro(mensagemDeErro(e));
    });
  };

  const desfecho = estado === "pendente" ? null : DESFECHO[estado];

  return (
    <div
      className="aprovacao"
      role="group"
      aria-label="Pedido de aprovação"
      aria-describedby={idDescricao}
      aria-busy={enviando}
      data-estado={estado}
    >
      {origem && <div className="aprovacao-origem">{origem}</div>}
      {resumo ? (
        <p id={idDescricao} className="aprovacao-descricao aprovacao-resumo">
          {resumo}
        </p>
      ) : (
        <p id={idDescricao} className={semDescricao ? "so-leitor" : "aprovacao-descricao"}>
          {aprovacao.descricao}
        </p>
      )}
      {detalhe && <div className="aprovacao-detalhe">{detalhe}</div>}
      {!doTerminal && (
        <span className="aprovacao-desfazer">
          {acao.desfazivel ? "Dá para desfazer pelo histórico." : "Não dá para desfazer."}
        </span>
      )}
      {erro && (
        <p className="aprovacao-erro" role="alert">
          {erro}
        </p>
      )}
      {desfecho ? (
        <div className="aprovacao-desfecho" role="status">
          <Selo tom={desfecho.tom}>{desfecho.texto}</Selo>
          {aprovacao.regraCriadaId && <span className="aprovacao-desfazer">vale para os próximos</span>}
        </div>
      ) : (
        <div className="aprovacao-acoes">
          <Botao tamanho={tamanho} disabled={enviando} onClick={() => decidir({ decisao: "negar" })}>
            {acao.rotuloRecusar ?? NEGAR}
          </Botao>
          {extra}
          {doTerminal && aprovacao.admiteSempre && (
            <Botao
              tamanho={tamanho}
              disabled={enviando}
              onClick={() => decidir({ decisao: "permitir", sempre: "projeto" })}
            >
              {SEMPRE_NESTE_PROJETO}
            </Botao>
          )}
          <Botao
            variante="primario"
            tamanho={tamanho}
            disabled={enviando}
            onClick={() => decidir({ decisao: "permitir" })}
          >
            {acao.rotulo ?? PERMITIR}
          </Botao>
        </div>
      )}
    </div>
  );
}
