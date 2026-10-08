import type { Migracao } from "../banco/migracoes.ts";

/**
 * Primeiro uso e tutorial (DATA.md, onboarding): uma linha por passo, missão ou etapa. Banco
 * que já tinha preferências gravadas é de quem já usa o Moductus: a configuração inicial
 * conta como feita, para não aparecer de novo a quem atualiza.
 */
export const m002: Migracao = {
  versao: 2,
  nome: "onboarding",
  sql: `
    CREATE TABLE onboarding (
      passo TEXT PRIMARY KEY,
      estado TEXT NOT NULL CHECK (estado IN ('pendente', 'feito', 'pulado')),
      concluido_em TEXT
    ) STRICT;
    INSERT INTO onboarding (passo, estado, concluido_em)
      SELECT 'configuracao', 'feito', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE EXISTS (SELECT 1 FROM config);
  `,
};
