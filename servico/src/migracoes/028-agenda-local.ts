import type { Migracao } from "../banco/migracoes.ts";

/**
 * A agenda fica só local (DATA.md §2). O que era do calendário do Google sai do banco:
 *
 * - os eventos do calendário "Moductus" foram criados aqui e são seus: passam para o local, sem o id
 *   de lá; os dos outros calendários eram cópia do Google e saem, com os calendários;
 * - a fila `agenda_saida` (014) e o mapa `agenda_espelho` (022) saem inteiros;
 * - `eventos.excecoes` e `eventos.fuso` (020) saem: o evento local nunca teve exceção nem outro fuso;
 * - a conexão `google-agenda` e os avisos dela saem; o lembrete do canal `calendario` passa a avisar
 *   no Windows.
 *
 * As outras colunas de calendário de fora (`calendarios.fonte`, `id_externo`, `espelho`,
 * `pode_escrever`, `ler`, `sincronizado_em`, `token_sincronizacao`; `eventos.id_externo` e
 * `etag_externo`) ficam vazias: tirá-las pede recriar as duas tabelas, com as restrições e a chave
 * entre elas, e o banco já aceita sem elas.
 */
export const m028: Migracao = {
  versao: 28,
  nome: "agenda-local",
  sql: `
  UPDATE eventos SET calendario_id = 'local', id_externo = NULL, etag_externo = NULL
    WHERE calendario_id IN (SELECT id FROM calendarios WHERE espelho = 1);
  DELETE FROM eventos WHERE calendario_id IN (SELECT id FROM calendarios WHERE fonte <> 'local');
  DELETE FROM calendarios WHERE fonte <> 'local';
  DROP TABLE agenda_saida;
  DROP TABLE agenda_espelho;
  ALTER TABLE eventos DROP COLUMN excecoes;
  ALTER TABLE eventos DROP COLUMN fuso;
  DELETE FROM conexoes WHERE tipo = 'google-agenda';
  DELETE FROM notificacoes WHERE referencia LIKE 'conexao:google-agenda%';
  UPDATE lembretes SET canal = 'windows' WHERE canal = 'calendario';`,
};
