import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRACOES } from "../migracoes/index.ts";
import { migrar } from "./migracoes.ts";

/**
 * Pasta dos dados: a casca entrega em MODUCTUS_PASTA (%APPDATA%\Moductus, ou ao lado do
 * executável no modo portable). Sem a casca (testes, desenvolvimento), %APPDATA%.
 */
export function pastaDeDados(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MODUCTUS_PASTA) return env.MODUCTUS_PASTA;
  return join(env.APPDATA ?? ".", "Moductus");
}

export function portable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MODUCTUS_PORTABLE === "1";
}

export function abrirBanco(pasta: string): DatabaseSync {
  mkdirSync(pasta, { recursive: true });
  const db = new DatabaseSync(join(pasta, "moductus.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  const { de, para } = migrar(db, MIGRACOES);
  if (de !== para) console.error(`banco migrado da versão ${de} para ${para}`);
  return db;
}
