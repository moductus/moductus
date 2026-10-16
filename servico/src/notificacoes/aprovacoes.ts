import type { Aprovacao, PedidoDecidir } from "@moductus/contrato";
import { NOME_DA_FERRAMENTA } from "../sessoes/contexto.ts";
import type { BotaoAviso, NovoAviso, ServicoNotificacoes } from "./notificacoes.ts";

/** As sessões de IA do terminal são do Nuno (PRODUCT.md §6): o pedido delas sai em nome dele. */
const NUNO = "nuno";

/** Os textos dos botões genéricos, os mesmos do cartão do terminal (DESIGN.md §5). */
const PERMITIR = "Permitir";
const NEGAR = "Negar";
/**
 * O "Sempre neste projeto" do cartão, encurtado: com três botões, o aviso do Windows corta o
 * rótulo longo. O projeto já está no corpo do aviso ("… em moductus").
 */
const SEMPRE_AQUI = "Sempre aqui";

/** Cada botão do aviso e o que ele decide. */
const DECISOES: Readonly<Record<string, Omit<PedidoDecidir, "id">>> = {
  negar: { decisao: "negar" },
  sempre: { decisao: "permitir", sempre: "projeto" },
  permitir: { decisao: "permitir" },
};

const referenciaDe = (id: string) => `aprovacao:${id}`;

/**
 * Os botões do cartão (CartaoAprovacao.tsx), na mesma ordem: recusar, "Sempre aqui" (o "Sempre
 * neste projeto" do cartão) quando o pedido do terminal admite a regra, e o primário com verbo e
 * objeto.
 */
export function botoesDoCartao(aprovacao: Aprovacao): BotaoAviso[] {
  const { acao } = aprovacao;
  const doTerminal = aprovacao.fonte !== "moductus";
  return [
    { id: "negar", rotulo: acao.rotuloRecusar ?? NEGAR },
    ...(doTerminal && aprovacao.admiteSempre ? [{ id: "sempre", rotulo: SEMPRE_AQUI }] : []),
    { id: "permitir", rotulo: acao.rotulo ?? PERMITIR },
  ];
}

/** O que o pedido do terminal quer fazer, sem o conteúdo: o comando e o arquivo ficam no cartão. */
export function resumoDaAcao(ferramenta: string): string {
  if (/^(Bash|PowerShell)$/.test(ferramenta)) return "rodar um comando";
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(ferramenta)) return "mudar um arquivo";
  if (/^(Read|Glob|Grep|LS)$/.test(ferramenta)) return "ler arquivos";
  if (/^(WebFetch|WebSearch)$/.test(ferramenta)) return "acessar a internet";
  if (ferramenta.startsWith("mcp__")) return "usar uma ferramenta MCP";
  return "usar uma ferramenta";
}

export interface FontesAprovacao {
  nomeDoAgente: (id: string) => string | null;
  /** Nome do projeto da sessão do terminal, para o resumo do aviso. */
  projetoDaSessao: (sessaoId: string) => string | null;
}

/**
 * O aviso de um cartão pendente: quem pede no título e, no corpo, o que vai acontecer. O aviso do
 * Windows aparece na tela de bloqueio e fica na Central de Notificações, então o pedido do
 * terminal leva só um resumo ("Claude Code quer rodar um comando em moductus."); o comando, o
 * arquivo e o endereço ficam no cartão. O pedido de agente leva a descrição do cartão, que o
 * próprio agente escreveu para mostrar.
 */
export function avisoDaAprovacao(aprovacao: Aprovacao, fontes: FontesAprovacao): NovoAviso {
  const doTerminal = aprovacao.fonte !== "moductus";
  const agenteId = doTerminal ? NUNO : (aprovacao.agenteId ?? NUNO);
  let titulo: string;
  let corpo: string;
  if (doTerminal) {
    const ferramenta = NOME_DA_FERRAMENTA[aprovacao.fonte as Exclude<Aprovacao["fonte"], "moductus">];
    const projeto = aprovacao.sessaoId ? fontes.projetoDaSessao(aprovacao.sessaoId) : null;
    titulo = `${ferramenta} pede permissão`;
    corpo = `${ferramenta} quer ${resumoDaAcao(aprovacao.acao.ferramenta)}${projeto ? ` em ${projeto}` : ""}.`;
  } else {
    titulo = `${fontes.nomeDoAgente(agenteId) ?? "Um agente"} pede sua aprovação`;
    corpo = aprovacao.descricao;
  }
  return {
    agenteId,
    tipo: "aprovacao",
    titulo,
    corpo,
    referencia: referenciaDe(aprovacao.id),
    botoes: botoesDoCartao(aprovacao),
    origem: doTerminal ? "conexao" : "agente",
    execucaoId: aprovacao.execucaoId,
  };
}

/**
 * Liga as aprovações às notificações: cartão novo pendente vira aviso com os botões do cartão;
 * cartão decidido ou expirado, em qualquer lugar, tira o ponto e o aviso. Clicar num botão do
 * aviso decide pelo mesmo caminho do cartão (`aprovacoes.decidir`), só se o cartão ainda estiver
 * pendente e o botão for um dos que o cartão oferece agora. Devolve o que chamar a cada mudança
 * de aprovação.
 */
export function avisarAprovacoes(
  notificacoes: ServicoNotificacoes,
  aprovacoes: {
    obter: (id: string) => Aprovacao | null;
    decidir: (pedido: PedidoDecidir) => Promise<unknown>;
  },
  fontes: FontesAprovacao,
): (aprovacao: Aprovacao) => Promise<void> {
  notificacoes.registrarAcao("aprovacao", async (id, botao) => {
    const aprovacao = aprovacoes.obter(id);
    const decisao = DECISOES[botao];
    if (!aprovacao || aprovacao.estado !== "pendente" || !decisao) return false;
    if (!botoesDoCartao(aprovacao).some((b) => b.id === botao)) return false;
    await aprovacoes.decidir({ id, ...decisao });
    return true;
  });
  return async (aprovacao) => {
    if (aprovacao.estado === "pendente") await notificacoes.avisar(avisoDaAprovacao(aprovacao, fontes));
    else await notificacoes.resolvido(referenciaDe(aprovacao.id));
  };
}
