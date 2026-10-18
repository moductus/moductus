import type { Migracao } from "../banco/migracoes.ts";
import { FORMATO_DATA_GLOB } from "../banco/tabela.ts";

/**
 * O relógio de cada etapa do foco (F3-18, ADR-0032). A 014 guardou só o início e a duração
 * planejada; para pausar, esticar e reiniciar o serviço sem perder a conta, a etapa passa a guardar:
 *
 * - `termina_em`: o fim planejado, absoluto. O "+5 min" o estica; o tempo parado o empurra ao
 *   retomar. É dele que o relógio do dia arma o fim e que a interface conta o tempo sozinha.
 * - `pausada_em`: desde quando a etapa está parada; só a que está em andamento pode estar.
 * - `ciclo`: em que foco da rodada a etapa está (o "Ciclo 2 de 4"); a pausa leva o do foco que a
 *   antecede, e 0 é a pausa livre, sem foco antes.
 *
 * A etapa que já existia ganha o `termina_em` do início mais a duração planejada e o ciclo 1.
 */
export const m020: Migracao = {
  versao: 20,
  nome: "foco-etapas",
  sql: `ALTER TABLE sessoes_foco ADD COLUMN termina_em TEXT
    CHECK (termina_em IS NULL OR (termina_em GLOB '${FORMATO_DATA_GLOB}' AND termina_em > inicio));
  ALTER TABLE sessoes_foco ADD COLUMN pausada_em TEXT
    CHECK (pausada_em IS NULL OR (pausada_em GLOB '${FORMATO_DATA_GLOB}' AND fim IS NULL AND pausada_em >= inicio));
  ALTER TABLE sessoes_foco ADD COLUMN ciclo INTEGER CHECK (ciclo IS NULL OR ciclo >= 0);
  UPDATE sessoes_foco
     SET termina_em = strftime('%Y-%m-%dT%H:%M:%fZ', inicio, '+' || duracao_planejada_min || ' minutes'),
         ciclo = 1;`,
};
