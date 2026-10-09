import type { Aprovacao, PedidoDecidir } from "@moductus/contrato";
import { NOME } from "../sessoes/contexto.ts";
import type { BotaoAviso, NovoAviso, ServicoNotificacoes } from "./notificacoes.ts";

/** As sessões de IA do terminal são do Nuno (PRODUCT.md §6): o pedido delas sai em nome dele. */
const NUNO = "nuno";

/** Os textos dos botões genéricos, os mesmos do cartão do terminal (DESIGN.md §5). */
const PERMITIR = "Permitir";
const NEGAR = "Negar";
const SEMPRE_NESTE_PROJETO = "Sempre neste projeto";

/** Cada botão do aviso e o que ele decide. */
const DECISOES: Readonly<Record<string, Omit<PedidoDecidir, "id">>> = {
  negar: { decisao: "negar" },
  sempre: { decisao: "permitir", sempre: "projeto" },
  permitir: { decisao: "permitir" },
};

const referenciaDe = (id: string) => `aprovacao:${id}`;

/**
 * Os botões do cartão (CartaoAprovacao.tsx), na mesma ordem: recusar, "Sempre neste projeto"
 * quando o pedido do terminal admite a regra, e o primário com verbo e objeto.
 */
export function botoesDoCartao(aprovacao: Aprovacao): BotaoAviso[] {
  const { acao } = aprovacao;
  const doTerminal = aprovacao.fonte !== "moductus";
  return [
    { id: "negar", rotulo: acao.rotuloRecusar ?? NEGAR },
    ...(doTerminal && aprovacao.admiteSempre ? [{ id: "sempre", rotulo: SEMPRE_NESTE_PROJETO }] : []),
    { id: "permitir", rotulo: acao.rotulo ?? PERMITIR },
  ];
}

/** O aviso de um cartão pendente: quem pede no título, o que vai acontecer no corpo. */
export function avisoDaAprovacao(
  aprovacao: Aprovacao,
  nomeDoAgente: (id: string) => string | null,
): NovoAviso {
  const doTerminal = aprovacao.fonte !== "moductus";
  const agenteId = doTerminal ? NUNO : (aprovacao.agenteId ?? NUNO);
  const titulo = doTerminal
    ? `${NOME[aprovacao.fonte as Exclude<Aprovacao["fonte"], "moductus">]} pede permissão`
    : `${nomeDoAgente(agenteId) ?? "Um agente"} pede sua aprovação`;
  return {
    agenteId,
    tipo: "aprovacao",
    titulo,
    corpo: aprovacao.descricao,
    referencia: referenciaDe(aprovacao.id),
    botoes: botoesDoCartao(aprovacao),
    origem: doTerminal ? "conexao" : "agente",
    execucaoId: aprovacao.execucaoId,
  };
}

/**
 * Liga as aprovações às notificações: cartão novo pendente vira aviso com os botões do cartão;
 * cartão decidido ou expirado, em qualquer lugar, tira o ponto e o aviso. Clicar num botão do
 * aviso decide pelo mesmo caminho do cartão (`aprovacoes.decidir`). Devolve o que chamar a cada
 * mudança de aprovação.
 */
export function avisarAprovacoes(
  notificacoes: ServicoNotificacoes,
  decidir: (pedido: PedidoDecidir) => Promise<unknown>,
  nomeDoAgente: (id: string) => string | null,
): (aprovacao: Aprovacao) => Promise<void> {
  notificacoes.registrarAcao("aprovacao", async (id, botao) => {
    const decisao = DECISOES[botao];
    if (decisao) await decidir({ id, ...decisao });
  });
  return async (aprovacao) => {
    if (aprovacao.estado === "pendente") await notificacoes.avisar(avisoDaAprovacao(aprovacao, nomeDoAgente));
    else await notificacoes.resolvido(referenciaDe(aprovacao.id));
  };
}
