import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * O espelho no calendário "Moductus" (F3-24, ADR-0035): para cada tarefa com hora, lembrete com
 * horário e evento do "Moductus" que já foi (ou está indo) ao Google, o id do evento de lá e o que
 * foi mandado por último. A fila `agenda_saida` (014) diz o que falta mandar; esta tabela, o que
 * já chegou, e é por ela que o espelho não duplica nem confunde o eco da própria escrita com uma
 * mudança feita no Google.
 *
 * - `id_externo` é escolhido aqui antes do primeiro envio: repetir o `events.insert` depois de uma
 *   resposta perdida dá 409 no Google, nunca dois eventos.
 * - `etag_externo` vazio é o evento que ainda não chegou lá; com valor, o etag da última escrita
 *   daqui ou da última mudança de lá que foi adotada.
 * - `enviado` é o evento que foi ao Google (título, horário, alertas, regra), para saber se o item
 *   mudou desde então; vazio quando o evento foi achado no Google sem ter saído daqui.
 * - `desligado` é o item cujo evento você apagou no Google: o espelho dele para (a tarefa fica).
 *
 * Sem chave estrangeira: tarefas, lembretes e eventos têm lixeira, e o que saiu daqui é justamente
 * o que precisa ser apagado lá. Situação deste PC, como a fila (outro-pc/tabelas.ts).
 */
const agendaEspelho = criarTabela(
  "agenda_espelho",
  [
    "item_tipo TEXT NOT NULL CHECK (item_tipo IN ('tarefa', 'lembrete', 'evento'))",
    "item_id TEXT NOT NULL",
    // O id de evento do Google: de 5 a 1024 letras de base32hex (a-v e 0-9).
    "id_externo TEXT NOT NULL CHECK (length(id_externo) BETWEEN 5 AND 1024)",
    "etag_externo TEXT",
    "enviado TEXT CHECK (enviado IS NULL OR (json_valid(enviado) AND json_type(enviado) = 'object'))",
    "desligado INTEGER NOT NULL DEFAULT 0 CHECK (desligado IN (0, 1))",
  ],
  { lixeira: false, restricoes: ["UNIQUE (item_tipo, item_id)"] },
);

/** A leitura de volta do "Moductus" acha o item pelo id do evento de lá. */
const indices = `
  CREATE UNIQUE INDEX agenda_espelho_id_externo ON agenda_espelho (id_externo);
`;

export const m022: Migracao = {
  versao: 22,
  nome: "agenda-espelho",
  sql: [agendaEspelho, indices].join("\n"),
};
