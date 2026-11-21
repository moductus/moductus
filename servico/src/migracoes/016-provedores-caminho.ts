import type { Migracao } from "../banco/migracoes.ts";

/**
 * `provedores.caminho` (F3-03, ADR-0037): onde a detecção achou o CLI neste PC, e o que o
 * adaptador roda em vez de procurar o comando no PATH. É o `.cmd` do npm, quando foi instalado
 * assim: o serviço lê o shim e roda o programa que ele chama, sem shell. Só provedor de CLI tem; é
 * situação deste PC e não vai no arquivo de levar para outro PC. Provedor anterior a esta migração
 * fica vazio até a próxima detecção.
 */
export const m016: Migracao = {
  versao: 16,
  nome: "provedores-caminho",
  sql: `ALTER TABLE provedores ADD COLUMN caminho TEXT
    CHECK (caminho IS NULL OR (caminho <> '' AND tipo IN ('claude-cli', 'codex-cli', 'gemini-cli', 'opencode-cli')));`,
};
