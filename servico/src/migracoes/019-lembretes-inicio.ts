import type { Migracao } from "../banco/migracoes.ts";
import { FORMATO_DATA_GLOB } from "../banco/tabela.ts";

/**
 * O início da regra do lembrete recorrente (F3-17). O `quando` anda de ocorrência em ocorrência;
 * a regra conta do início, como o DTSTART do RFC 5545: é dele que vem a hora local de toda
 * ocorrência (o pulo do horário de verão vale só no dia do pulo) e é dele que o `COUNT` conta.
 * Vazio vale o `quando` (o lembrete que nunca andou, ou o que outra área gravou sem regra).
 *
 * O índice acha os recorrentes tocando ou perdidos, que o relógio do dia confere a cada minuto
 * (o `lembretes_proximo` da 013 só cobre os que esperam a hora).
 */
export const m019: Migracao = {
  versao: 19,
  nome: "lembretes-inicio",
  sql: `ALTER TABLE lembretes ADD COLUMN inicio_recorrencia TEXT
    CHECK (inicio_recorrencia IS NULL OR inicio_recorrencia GLOB '${FORMATO_DATA_GLOB}');
  CREATE INDEX lembretes_recorrentes_parados ON lembretes (id)
    WHERE estado IN ('disparado', 'perdido') AND recorrencia IS NOT NULL AND apagado_em IS NULL;`,
};
