import type { CanalCasca } from "./canal.ts";

/**
 * Variáveis de ambiente do usuário do Windows, que só a casca grava (`src-tauri/src/ambiente.rs`).
 * Valem para os processos abertos depois da mudança: um terminal já aberto não as vê.
 */
export interface AmbienteDoUsuario {
  definir(nome: string, valor: string): Promise<void>;
  apagar(nome: string): Promise<void>;
}

/**
 * O ambiente pela casca: o serviço pede pelo canal do sidecar e a casca responde `{ ok }` ou
 * `{ erro }`. A casca só aceita nomes que começam com `MODUCTUS_`; o valor não vai para o log.
 */
export function ambientePelaCasca(canal: Pick<CanalCasca, "pedir">): AmbienteDoUsuario {
  const pedir = async (pedido: Record<string, unknown>) => {
    const r = await canal.pedir<{ ok?: boolean; erro?: string }>({ tipo: "ambiente", ...pedido });
    if (r.erro) throw new Error(r.erro);
    if (r.ok !== true) throw new Error(`a casca não confirmou a variável ${String(pedido.nome)}`);
  };
  return {
    definir: (nome, valor) => pedir({ op: "definir", nome, valor }),
    apagar: (nome) => pedir({ op: "apagar", nome }),
  };
}
