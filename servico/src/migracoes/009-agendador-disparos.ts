import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * Até onde o agendador já contou cada gatilho de horário e de intervalo (AGENTS.md §6, F2-17), para
 * o serviço que reinicia não repetir um disparo nem perder o que venceu com ele parado. Uma linha
 * por agente e gatilho (o JSON do gatilho como está na configuração):
 * - `referencia`: no horário, a ocorrência que disparou (ou quando o gatilho apareceu); no
 *   intervalo, de onde conta o próximo;
 * - `disparado_em`: quando disparou pela última vez; vazio se ainda não disparou.
 * A referência é gravada antes de o runtime ser chamado. Sem chave estrangeira para `agentes`, que
 * tem lixeira (lixeira.test.ts): a linha de agente que saiu é apagada pelo próprio agendador. É
 * controle deste PC: não vai para outro (outro-pc/tabelas.ts).
 */
const disparos = criarTabela(
  "agendador_disparos",
  ["do_agente_id TEXT NOT NULL", "gatilho TEXT NOT NULL", "referencia TEXT NOT NULL", "disparado_em TEXT"],
  { lixeira: false, restricoes: ["UNIQUE (do_agente_id, gatilho)"] },
);

export const m009: Migracao = {
  versao: 9,
  nome: "agendador-disparos",
  sql: disparos,
};
