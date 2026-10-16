import type { DatabaseSync } from "node:sqlite";
import { COLUNA_LIXEIRA } from "./tabela.ts";

/** Quanto tempo o que foi apagado fica na lixeira antes de sumir de vez (DATA.md §1). */
export const DIAS_NA_LIXEIRA = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/** As tabelas com a coluna da lixeira, achadas no próprio banco: nenhuma lista para manter. */
export function tabelasComLixeira(db: DatabaseSync): string[] {
  const linhas = db
    .prepare(
      `SELECT t.name AS nome FROM pragma_table_list AS t
       WHERE t.schema = 'main' AND t.type = 'table' AND t.name NOT LIKE 'sqlite_%'
         AND EXISTS (SELECT 1 FROM pragma_table_info(t.name) AS c WHERE c.name = ?)
       ORDER BY t.name`,
    )
    .all(COLUNA_LIXEIRA) as { nome: string }[];
  return linhas.map((l) => l.nome);
}

/**
 * Apaga de vez o que está na lixeira há mais de 30 dias, em todas as tabelas com lixeira. Roda
 * na subida do serviço. Uma linha referenciada por outra não sai, desde que a chave estrangeira
 * seja NO ACTION ou RESTRICT: com CASCADE ou SET NULL o SQLite apagaria ou mexeria em linhas
 * vivas, e por isso nenhuma chave para tabela com lixeira pode ter essas ações (a guarda está em
 * lixeira.test.ts). As tabelas são repassadas enquanto alguma coisa sair, para que filhos
 * vencidos liberem os pais vencidos na mesma limpeza, qualquer que seja a ordem das tabelas.
 */
export function limparLixeira(db: DatabaseSync, agora: Date = new Date()): Map<string, number> {
  const limite = new Date(agora.getTime() - DIAS_NA_LIXEIRA * DIA_MS).toISOString();
  const removidas = new Map<string, number>();
  const tabelas = tabelasComLixeira(db);
  let saiuAlguma = true;
  while (saiuAlguma) {
    saiuAlguma = false;
    for (const tabela of tabelas) {
      const n = apagarVencidas(db, tabela, limite);
      if (n > 0) {
        removidas.set(tabela, (removidas.get(tabela) ?? 0) + n);
        saiuAlguma = true;
      }
    }
  }
  return removidas;
}

/**
 * Tenta tudo de uma vez; se alguma linha estiver presa por chave estrangeira, o comando inteiro
 * volta e a tabela é refeita linha a linha, para que a presa não segure as outras.
 */
function apagarVencidas(db: DatabaseSync, tabela: string, limite: string): number {
  const vencidas = `${COLUNA_LIXEIRA} IS NOT NULL AND ${COLUNA_LIXEIRA} < ?`;
  try {
    return Number(db.prepare(`DELETE FROM "${tabela}" WHERE ${vencidas}`).run(limite).changes);
  } catch (erro) {
    if (!ehChaveEstrangeira(erro)) throw erro;
  }
  const ids = db.prepare(`SELECT id FROM "${tabela}" WHERE ${vencidas}`).all(limite) as { id: string }[];
  const apagar = db.prepare(`DELETE FROM "${tabela}" WHERE id = ?`);
  let n = 0;
  for (const { id } of ids) {
    try {
      n += Number(apagar.run(id).changes);
    } catch (erro) {
      if (!ehChaveEstrangeira(erro)) throw erro;
    }
  }
  return n;
}

/** SQLITE_CONSTRAINT_FOREIGNKEY, o código estendido que o node:sqlite põe em `errcode`. */
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

function ehChaveEstrangeira(erro: unknown): boolean {
  return (
    erro instanceof Error &&
    "errcode" in erro &&
    (erro as { errcode: unknown }).errcode === SQLITE_CONSTRAINT_FOREIGNKEY
  );
}
