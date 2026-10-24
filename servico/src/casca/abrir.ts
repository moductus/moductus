import type { CanalCasca } from "./canal.ts";

/**
 * O que a casca abre fora do Moductus (`src-tauri/src/abrir.rs`, ADR-0038): endereço `https://` no
 * navegador padrão e arquivo ou pasta dentro das raízes autorizadas. Quem decide o que pode abrir é
 * a casca; aqui só se pede. Nenhuma ferramenta do catálogo chega aqui: só o fluxo de autorização e
 * o que o usuário clicou.
 */
export interface AbrirNaCasca {
  endereco(endereco: string): Promise<void>;
  arquivo(caminho: string): Promise<void>;
  /** As pastas de projeto que a casca aceita abrir; substituem as de antes. */
  projetos(pastas: readonly string[]): Promise<void>;
}

/** Pela casca: o pedido vai no canal do sidecar e volta `{ ok }` ou `{ erro }` com o motivo. */
export function abrirPelaCasca(canal: Pick<CanalCasca, "pedir">): AbrirNaCasca {
  const pedir = async (pedido: Record<string, unknown>) => {
    const r = await canal.pedir<{ ok?: boolean; erro?: string }>({ tipo: "abrir", ...pedido });
    if (r.erro) throw new Error(r.erro);
    if (r.ok !== true) throw new Error("a casca não confirmou que abriu");
  };
  return {
    endereco: (endereco) => pedir({ op: "endereco", endereco }),
    arquivo: (caminho) => pedir({ op: "arquivo", caminho }),
    projetos: (pastas) => pedir({ op: "projetos", pastas: [...pastas] }),
  };
}

/**
 * Mantém a casca com as pastas de projeto vivas: manda a lista ao subir e de novo quando chega uma
 * sessão de um projeto que ela ainda não tem. Projeto que vai para a lixeira sai na próxima lista.
 */
export function projetosNaCasca(
  abrir: Pick<AbrirNaCasca, "projetos">,
  projetos: () => readonly { id: string; caminho: string }[],
) {
  let conhecidos = new Set<string>();
  const mandar = () => {
    const vivos = projetos();
    conhecidos = new Set(vivos.map((p) => p.id));
    abrir
      .projetos(vivos.map((p) => p.caminho))
      .catch((erro: unknown) => console.error(`abrir: a casca não recebeu os projetos: ${String(erro)}`));
  };
  return {
    mandar,
    aoMudarSessao(projetoId: string | null) {
      if (projetoId !== null && !conhecidos.has(projetoId)) mandar();
    },
  };
}
