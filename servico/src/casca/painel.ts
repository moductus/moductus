import type { CanalCasca } from "./canal.ts";

/**
 * O painel do dock pela casca (`src-tauri/src/janelas.rs`): o serviço só abre o painel Hoje, onde o
 * briefing e o fechamento aparecem, e pergunta se ele está à vista. Mostrar não ativa a janela nem
 * alterna (já aberto, fica); em tela cheia a casca não mostra e responde `ok: false`.
 */
export interface PainelNaCasca {
  /** `true` se o painel apareceu; `false` em tela cheia. */
  mostrar(area: "hoje"): Promise<boolean>;
  aberto(area: "hoje"): Promise<boolean>;
}

export function painelPelaCasca(canal: Pick<CanalCasca, "pedir">): PainelNaCasca {
  const pedir = async <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
    const r = await canal.pedir<T & { erro?: string }>({ tipo: "painel", ...pedido });
    if (r.erro) throw new Error(r.erro);
    return r;
  };
  return {
    async mostrar(area) {
      const r = await pedir<{ ok?: boolean }>({ op: "mostrar", area });
      return r.ok === true;
    },
    async aberto(area) {
      const r = await pedir<{ aberto?: boolean }>({ op: "aberto", area });
      return r.aberto === true;
    },
  };
}
