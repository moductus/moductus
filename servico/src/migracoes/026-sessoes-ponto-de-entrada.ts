import type { Migracao } from "../banco/migracoes.ts";

/**
 * Onde roda a sessão do Claude Code (F3-54, DATA.md §5 sessoes_ia): o `entrypoint` que ele anota
 * em cada linha do transcript (`cli` no terminal, `claude-desktop` na aba Code do app Desktop),
 * guardado como veio. O serviço traduz na leitura, e valor que ainda não conhece fica sem rótulo,
 * sem migração nova. As sessões que já existiam ficam vazias até a próxima leitura do transcript.
 */
export const m026: Migracao = {
  versao: 26,
  nome: "sessoes-ponto-de-entrada",
  sql: `ALTER TABLE sessoes_ia ADD COLUMN ponto_de_entrada TEXT;`,
};
