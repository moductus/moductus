import type { CanalCasca } from "./canal.ts";

/** O cofre de segredos, que só a casca abre. */
export interface Credenciais {
  ler(nome: string): Promise<string | null>;
  guardar(nome: string, valor: string): Promise<void>;
}

/**
 * O Gerenciador de Credenciais pela casca (`src-tauri/src/credenciais.rs`): o serviço pede pelo
 * canal do sidecar e a casca responde `{ valor }`, `{ ok }` ou `{ erro }`. O valor só passa
 * por aqui, na memória; o registro da casca leva só o nome.
 */
export function credenciaisPelaCasca(canal: Pick<CanalCasca, "pedir">): Credenciais {
  return {
    async ler(nome) {
      const r = await canal.pedir<{ valor?: string | null; erro?: string }>({
        tipo: "credencial",
        op: "ler",
        nome,
      });
      if (r.erro) throw new Error(r.erro);
      return typeof r.valor === "string" ? r.valor : null;
    },
    async guardar(nome, valor) {
      const r = await canal.pedir<{ ok?: boolean; erro?: string }>({
        tipo: "credencial",
        op: "guardar",
        nome,
        valor,
      });
      if (r.erro) throw new Error(r.erro);
      if (r.ok !== true) throw new Error(`a casca não confirmou a credencial ${nome}`);
    },
  };
}
