import type { Migracao } from "../banco/migracoes.ts";

/**
 * `provedores.ferramentas` (F3-52): se o modelo chamou a ferramenta do último teste que passou,
 * como o `testado_em` ao lado dele. `0` é "só conversa" (os agentes não consultam nem fazem nada
 * com ele); vazio é não testado ou CLI, que usa as ferramentas pelo MCP do Moductus. Provedor
 * anterior a esta migração fica vazio até o próximo teste.
 */
export const m027: Migracao = {
  versao: 27,
  nome: "provedores-ferramentas",
  sql: `ALTER TABLE provedores ADD COLUMN ferramentas INTEGER
    CHECK (ferramentas IS NULL OR (ferramentas IN (0, 1) AND tipo NOT IN ('claude-cli', 'codex-cli', 'gemini-cli', 'opencode-cli')));`,
};
