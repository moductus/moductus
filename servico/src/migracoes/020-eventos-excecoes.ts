import type { Migracao } from "../banco/migracoes.ts";

/**
 * As exceções do evento recorrente lido do Google (F3-23, ADR-0035): o Google guarda a ocorrência
 * que você cancelou ou mudou de lugar fora da regra (um evento à parte com `originalStartTime`, ou
 * um `EXDATE`). `excecoes` é a lista dos inícios que a regra não gera mais, no formato do `inicio`
 * do próprio evento (instante UTC com hora, dia no de dia inteiro); a ocorrência mudada de lugar é
 * outro evento no cache. Sem isso, a reunião cancelada ou adiada apareceria do mesmo jeito. O
 * evento do local nunca tem exceção: a lista fica vazia.
 */
export const m020: Migracao = {
  versao: 20,
  nome: "eventos-excecoes",
  sql: `ALTER TABLE eventos ADD COLUMN excecoes TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(excecoes) AND json_type(excecoes) = 'array');`,
};
