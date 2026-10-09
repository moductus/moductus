import type {
  AcaoAprovacao,
  Aprovacao,
  ListaSessoes,
  MudancaSessao,
  PedidoDecidir,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { servico } from "./conexao.ts";

/** Campos de `tool_input` que dizem o que o pedido faz, na ordem em que valem. */
const CAMPOS_DETALHE = ["command", "file_path", "notebook_path", "url", "query"] as const;

/**
 * O comando, o arquivo ou o endereço de um pedido do terminal, inteiro, para o detalhe do cartão
 * ("Quer rodar `npm test -- --watch=false`"); `null` quando a entrada não traz nenhum.
 */
export function detalheDoPedido(acao: AcaoAprovacao): string | null {
  const entrada = acao.entrada;
  if (!entrada || typeof entrada !== "object") return null;
  const campos = entrada as Record<string, unknown>;
  for (const campo of CAMPOS_DETALHE) {
    const valor = campos[campo];
    if (typeof valor === "string" && valor.trim() !== "") return valor;
  }
  return null;
}

/**
 * Junta um aviso de `aprovacoes.mudou` à lista: o cartão que já estava na tela troca de estado
 * (e diz o que valeu); pendente novo entra no fim; decidido que não estava na tela fica de fora.
 */
export function juntarAprovacao(lista: readonly Aprovacao[], aprovacao: Aprovacao): Aprovacao[] {
  if (lista.some((a) => a.id === aprovacao.id))
    return lista.map((a) => (a.id === aprovacao.id ? aprovacao : a));
  return aprovacao.estado === "pendente" ? [...lista, aprovacao] : [...lista];
}

/** Nome do projeto de cada sessão, para a origem do cartão. */
export type ProjetosDasSessoes = Readonly<Record<string, string>>;

export function projetosDasSessoes(lista: ListaSessoes): Record<string, string> {
  const nomes = new Map(lista.projetos.map((p) => [p.id, p.nome]));
  const projetos: Record<string, string> = {};
  for (const s of lista.sessoes) {
    const nome = s.projetoId ? nomes.get(s.projetoId) : undefined;
    if (nome) projetos[s.id] = nome;
  }
  return projetos;
}

export interface PedidosDoTerminal {
  aprovacoes: Aprovacao[];
  projetos: ProjetosDasSessoes;
}

const NADA: PedidosDoTerminal = { aprovacoes: [], projetos: {} };

/**
 * Os pedidos de permissão das sessões do terminal, pelo canal: a lista ao conectar e a cada
 * `recarregar` (o painel abriu de novo), e cada mudança depois (`aprovacoes.mudou`,
 * `sessoes.mudou`). Quem decide é o serviço; aqui só se mostra. Sem conexão, nada aparece.
 */
export function usePedidosDoTerminal(canal: EstadoConexao, recarregar: unknown): PedidosDoTerminal {
  const [pedidos, setPedidos] = useState<PedidosDoTerminal>(NADA);

  useEffect(() => {
    const paradas = [
      servico.ouvir("aprovacoes.mudou", (a) => {
        if (a.fonte === "moductus") return;
        setPedidos((p) => ({ ...p, aprovacoes: juntarAprovacao(p.aprovacoes, a) }));
      }),
      servico.ouvir("sessoes.mudou", ({ sessao, projeto }: MudancaSessao) => {
        if (!projeto) return;
        setPedidos((p) => ({ ...p, projetos: { ...p.projetos, [sessao.id]: projeto.nome } }));
      }),
    ];
    return () => paradas.forEach((parar) => parar());
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    Promise.all([servico.pedir("aprovacoes.pendentes"), servico.pedir("sessoes.listar")])
      .then(([aprovacoes, sessoes]) => {
        if (!vivo) return;
        setPedidos({
          aprovacoes: aprovacoes.filter((a) => a.fonte !== "moductus"),
          projetos: projetosDasSessoes(sessoes),
        });
      })
      .catch(() => {
        if (vivo) setPedidos(NADA);
      });
    return () => {
      vivo = false;
    };
  }, [canal, recarregar]);

  return canal === "conectado" ? pedidos : NADA;
}

/** Decide pelo serviço; o cartão trava até o aviso do pedido decidido chegar. */
export const decidirPedido = (pedido: PedidoDecidir) => servico.pedir("aprovacoes.decidir", pedido);
