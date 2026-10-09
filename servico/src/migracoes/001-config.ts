import type { Migracao } from "../banco/migracoes.ts";

/** Preferências (substitui o config.json do v0): uma chave, um valor em JSON. */
export const m001: Migracao = {
  versao: 1,
  nome: "config",
  sql: `
    CREATE TABLE config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL CHECK (json_valid(valor)),
      atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `,
};
