import type { Migracao } from "../banco/migracoes.ts";
import { FORMATO_DATA_GLOB } from "../banco/tabela.ts";

/**
 * O fechamento das tarefas (F3-15). Duas marcas que só a área Tarefas escreve:
 *
 * - `fechada_em`: o instante em que a tarefa foi concluída ou descartada. O lembrete dela vai para
 *   a lixeira com esse mesmo instante, e reabrir traz de volta o que tem a marca. Não dá para usar o
 *   `atualizado_em`, que outras áreas também gravam (a agenda, ao ligar o encaixe). Formato exato do
 *   serviço, porque é comparado como texto com o `apagado_em` do lembrete.
 * - `gerada_por`: a tarefa recorrente de onde esta nasceu. Fechar não gera uma segunda próxima
 *   enquanto a primeira está viva, e reabrir leva a próxima que ninguém tocou. Guarda o id como
 *   texto, sem chave: `tarefas` tem lixeira (DATA.md §1).
 *
 * As que já estavam fechadas ganham o `atualizado_em` como marca, que era a regra de antes.
 */
export const m018: Migracao = {
  versao: 18,
  nome: "tarefas-fechamento",
  sql: `ALTER TABLE tarefas ADD COLUMN fechada_em TEXT
    CHECK (fechada_em IS NULL OR fechada_em GLOB '${FORMATO_DATA_GLOB}');
  ALTER TABLE tarefas ADD COLUMN gerada_por TEXT;
  UPDATE tarefas SET fechada_em = atualizado_em
    WHERE estado <> 'aberta' AND atualizado_em GLOB '${FORMATO_DATA_GLOB}';
  CREATE INDEX tarefas_gerada_por ON tarefas (gerada_por) WHERE gerada_por IS NOT NULL;`,
};
