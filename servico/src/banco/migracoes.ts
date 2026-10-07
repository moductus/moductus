import type { DatabaseSync } from "node:sqlite";

/** Uma migração numerada; a versão do banco fica no `PRAGMA user_version`. */
export interface Migracao {
  versao: number;
  nome: string;
  sql: string;
}

export class MigracaoFalhou extends Error {
  constructor(
    readonly versao: number,
    readonly nome: string,
    causa: unknown,
  ) {
    super(`migração ${versao} (${nome}) falhou: ${causa instanceof Error ? causa.message : String(causa)}`, {
      cause: causa,
    });
  }
}

export function versaoAtual(db: DatabaseSync): number {
  const linha = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return linha.user_version;
}

/** As versões precisam ir de 1 a n, sem buraco nem repetição. */
export function validar(migracoes: readonly Migracao[]): void {
  migracoes.forEach((m, i) => {
    if (m.versao !== i + 1) {
      throw new Error(`migrações fora de ordem: posição ${i + 1} tem a versão ${m.versao}`);
    }
  });
}

/**
 * Aplica as migrações acima da versão atual, cada uma na própria transação: se uma
 * falha, ela é desfeita inteira e o banco fica na última versão boa.
 */
export function migrar(db: DatabaseSync, migracoes: readonly Migracao[]): { de: number; para: number } {
  validar(migracoes);
  const de = versaoAtual(db);
  if (de > migracoes.length) {
    throw new Error(`o banco está na versão ${de}, mais nova que este Moductus (${migracoes.length})`);
  }
  for (const m of migracoes.slice(de)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.versao}`);
      db.exec("COMMIT");
    } catch (erro) {
      db.exec("ROLLBACK");
      throw new MigracaoFalhou(m.versao, m.nome, erro);
    }
  }
  return { de, para: versaoAtual(db) };
}
