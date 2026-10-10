import type {
  Aprovacao,
  EstadoSessao,
  FerramentaSessao,
  ItemGithub,
  ListaSessoes,
  Projeto,
  SessaoIa,
} from "@moductus/contrato";
import { referencia } from "../../areas/dev/dev.ts";
import { haQuanto } from "../../areas/tempo.ts";
import type { TomSelo } from "../../componentes/Selo.tsx";
import type { PedidosDoTerminal } from "../../servico/aprovacoes.ts";

/**
 * As sessões de IA nos painéis do dock (Agentes.dc.html, PainelDev.dc.html): o pedido de
 * permissão de cada sessão primeiro, depois as sessões abertas, da que trabalha à que parou. Os
 * números vêm do serviço; o que ele não sabe, o painel não inventa.
 */

/** Quantas linhas cabem no painel; o resto fica na área Sessões de IA do Sistema. */
export const SESSOES_NO_PAINEL = 5;

/** Cor do ponto de cada estado; o texto vai junto (status nunca só por cor). */
export const TOM_DA_SESSAO: Readonly<Record<EstadoSessao, TomSelo>> = {
  trabalhando: "sucesso",
  esperando: "aviso",
  terminou: "apagado",
  erro: "perigo",
  parada: "apagado",
};

/** Um cartão da seção: um pedido do terminal ou uma sessão sem pedido na tela. */
export type ItemSessao =
  | {
      tipo: "pedido";
      aprovacao: Aprovacao;
      projeto: string | null;
      ferramenta: FerramentaSessao | null;
    }
  | { tipo: "sessao"; sessao: SessaoIa; projeto: Projeto | null };

const ORDEM: Readonly<Record<EstadoSessao, number>> = {
  esperando: 0,
  trabalhando: 1,
  erro: 2,
  terminou: 3,
  parada: 4,
};

const recente = (s: SessaoIa) => (s.ultimoEventoEm ? Date.parse(s.ultimoEventoEm) : 0);

/** As sessões abertas (sem `SessionEnd`), da que espera você à que parou; dentro do estado, a mais recente. */
export function sessoesAbertas(lista: ListaSessoes): SessaoIa[] {
  return lista.sessoes
    .filter((s) => s.encerradaEm === null)
    .sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado] || recente(b) - recente(a));
}

/**
 * Os cartões da seção "Sessões de IA": cada pedido do terminal na tela (o pendente e o que você
 * acabou de responder), depois as sessões abertas que não têm pedido na tela, até o limite.
 */
export function itensDasSessoes(
  lista: ListaSessoes | null,
  pedidos: PedidosDoTerminal,
  limite = SESSOES_NO_PAINEL,
): { itens: ItemSessao[]; fora: number } {
  const projetos = new Map((lista?.projetos ?? []).map((p) => [p.id, p]));
  const comPedido = new Set(pedidos.aprovacoes.map((a) => a.sessaoId).filter((id) => id !== null));
  const doPedido: ItemSessao[] = pedidos.aprovacoes.map((aprovacao) => ({
    tipo: "pedido",
    aprovacao,
    projeto: aprovacao.sessaoId ? (pedidos.projetos[aprovacao.sessaoId] ?? null) : null,
    ferramenta: aprovacao.fonte === "moductus" ? null : aprovacao.fonte,
  }));
  const abertas = lista ? sessoesAbertas(lista).filter((s) => !comPedido.has(s.id)) : [];
  const vagas = Math.max(0, limite - doPedido.length);
  const daSessao: ItemSessao[] = abertas.slice(0, vagas).map((sessao) => ({
    tipo: "sessao",
    sessao,
    projeto: sessao.projetoId ? (projetos.get(sessao.projetoId) ?? null) : null,
  }));
  return { itens: [...doPedido, ...daSessao], fora: abertas.length - daSessao.length };
}

/** Projetos diferentes na seção ("3 projetos"); sessão sem projeto não conta. */
export function projetosNaTela(itens: readonly ItemSessao[]): number {
  const nomes = itens
    .map((i) => (i.tipo === "pedido" ? i.projeto : (i.projeto?.nome ?? null)))
    .filter((n) => n !== null);
  return new Set(nomes).size;
}

/**
 * O tempo à direita da sessão: quanto tempo ela está trabalhando ("12 min"), ou desde quando não
 * há evento ("há 8 min"). Sem instante, nada.
 */
export function tempoDaSessao(sessao: SessaoIa, agora: Date): string | null {
  if (sessao.estado === "trabalhando" && sessao.iniciadaEm) {
    return haQuanto(sessao.iniciadaEm, agora).replace(/^há /, "");
  }
  return sessao.ultimoEventoEm ? haQuanto(sessao.ultimoEventoEm, agora) : null;
}

/** Selo de um PR no painel Dev, curto para caber na coluna (PainelDev.dc.html). */
export function seloDoPr(item: ItemGithub): { texto: string; tom: TomSelo } {
  if (item.ciEstado === "falhou") return { texto: "CI falhou", tom: "perigo" };
  if (item.precisaDeMim) {
    return item.meuPapel === "revisor"
      ? { texto: "review", tom: "aviso" }
      : { texto: "mudanças", tom: "aviso" };
  }
  if (item.ciEstado === "rodando") return { texto: "CI rodando", tom: "neutro" };
  if (item.ciEstado === "passou") return { texto: "CI passou", tom: "sucesso" };
  return { texto: "aberto", tom: "apagado" };
}

/** A linha de baixo do PR: "api-pedidos #412 · há 1 dia", ou "· seu" quando você abriu. */
export function metaDoPr(item: ItemGithub, agora: Date): string {
  if (item.meuPapel === "autor") return `${referencia(item)} · seu`;
  return item.atualizadoNoGithub
    ? `${referencia(item)} · ${haQuanto(item.atualizadoNoGithub, agora)}`
    : referencia(item);
}

/** Quantos PRs o painel mostra; o resto fica na área Dev. */
export const PRS_NO_PAINEL = 5;

/** Os PRs abertos, o que precisa de você primeiro (na ordem do serviço dentro de cada grupo). */
export function prsDoPainel(itens: readonly ItemGithub[]): ItemGithub[] {
  const abertos = itens.filter((i) => i.tipo === "pr" && i.estado === "aberto");
  return [...abertos.filter((i) => i.precisaDeMim), ...abertos.filter((i) => !i.precisaDeMim)].slice(
    0,
    PRS_NO_PAINEL,
  );
}

/** "Nuno · 3 sessões, 2 PRs esperando você", no alto do painel Dev. */
export function resumoDoDev(abertas: number, prsEsperando: number): string {
  const sessoes = `${abertas} ${abertas === 1 ? "sessão" : "sessões"}`;
  const prs =
    prsEsperando === 0
      ? "nenhum PR esperando você"
      : `${prsEsperando} ${prsEsperando === 1 ? "PR esperando você" : "PRs esperando você"}`;
  return `Nuno · ${sessoes}, ${prs}`;
}
