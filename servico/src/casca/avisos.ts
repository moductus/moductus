import type { CanalCasca } from "./canal.ts";
import type { AvisosDoWindows } from "../notificacoes/notificacoes.ts";

/** Tipo do aviso que a casca manda, sem pedido, quando o usuário clica num aviso do Windows. */
export const CLIQUE_NO_AVISO = "notificacao-clique";

/**
 * O aviso do Windows pela casca (`src-tauri/src/notificacao.rs`): o serviço pede pelo canal do
 * sidecar e a casca responde `{ ok }`, `{ tela_cheia }` ou `{ erro }`. O id da notificação vai
 * como `notificacao`, porque `id` é o do pedido no canal.
 */
export function avisosPelaCasca(canal: Pick<CanalCasca, "pedir">): AvisosDoWindows {
  const pedir = async <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
    const r = await canal.pedir<T & { erro?: string }>({ tipo: "notificacao", ...pedido });
    if (r.erro) throw new Error(r.erro);
    return r;
  };
  const confirmar = async (pedido: Record<string, unknown>) => {
    const r = await pedir<{ ok?: boolean }>(pedido);
    if (r.ok !== true) throw new Error(`a casca não confirmou o aviso (${String(pedido.op)})`);
  };
  return {
    mostrar: (aviso) =>
      confirmar({
        op: "mostrar",
        notificacao: aviso.id,
        agente: aviso.agente,
        titulo: aviso.titulo,
        corpo: aviso.corpo,
        botoes: aviso.botoes,
      }),
    retirar: (id) => confirmar({ op: "retirar", notificacao: id }),
    async telaCheia() {
      const r = await pedir<{ tela_cheia?: boolean }>({ op: "tela-cheia" });
      return r.tela_cheia === true;
    },
  };
}

/** O clique que a casca relata: o id da notificação e o botão, ou `null` no corpo do aviso. */
export function lerClique(aviso: Record<string, unknown>): { id: string; botao: string | null } | null {
  if (typeof aviso.notificacao !== "string" || aviso.notificacao === "") return null;
  return {
    id: aviso.notificacao,
    botao: typeof aviso.botao === "string" && aviso.botao !== "" ? aviso.botao : null,
  };
}
