import type { Migracao } from "../banco/migracoes.ts";

/**
 * O briefing mais curto (F3-31, AGENTS.md §2 "Se você ignorar"): depois de 3 briefings ignorados
 * seguidos, a Alba pergunta "Deixo o briefing mais curto ou desligo?", e o "mais curto" fica aqui,
 * ao lado da hora, dos dias e do ligado. Só o briefing tem a versão curta. É configuração, como o
 * resto da tabela. As duas que já existiam ficam como eram, sem a versão curta.
 */
export const m025: Migracao = {
  versao: 25,
  nome: "rotinas-curta",
  sql: `ALTER TABLE rotinas ADD COLUMN curta INTEGER NOT NULL DEFAULT 0
    CHECK (curta IN (0, 1) AND (curta = 0 OR tipo = 'briefing'));`,
};
