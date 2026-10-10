import type { Migracao } from "../banco/migracoes.ts";

/**
 * `conexoes.lida_em` (DATA.md §7): quando a conexão trouxe dados pela última vez, com sucesso. É
 * a idade do cache que ela alimenta (o GitHub, na fase 2): uma leitura sem nenhum item continua
 * sendo uma leitura, então a data não pode sair das linhas do cache. Situação deste PC, não vai
 * para outro (outro-pc/tabelas.ts).
 */
export const m006: Migracao = {
  versao: 6,
  nome: "conexoes-lida-em",
  sql: "ALTER TABLE conexoes ADD COLUMN lida_em TEXT;",
};
