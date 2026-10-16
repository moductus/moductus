import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * Notas (DATA.md §4, ADR-0036): Markdown cru num campo próprio, a busca sem acento num índice FTS5
 * e o bloco rápido do v0 como a nota fixa do topo, que já nasce no banco.
 *
 * Notas vão para a lixeira e não têm chave estrangeira; `tarefas.nota_id` (013) guarda o id da
 * nota como texto. Notas são dado (outro-pc/tabelas.ts); o índice é tabela virtual, que não entra
 * na marcação nem no arquivo de outro PC: os gatilhos o refazem a cada nota que chega.
 */

const marca = (coluna: string) => `${coluna} INTEGER NOT NULL DEFAULT 0 CHECK (${coluna} IN (0, 1))`;

/** A nota fixa do topo. Id fixo, igual em todo PC, como as listas padrão. */
const BLOCO_RAPIDO = "bloco_rapido";

/**
 * `conteudo` é o Markdown como foi escrito; `fixada`, a nota presa no topo; `pasta`, texto livre.
 * O bloco rápido não vai à lixeira: esvaziar é apagar o texto, não a nota. A restrição vale para
 * qualquer caminho de escrita, inclusive o `INSERT OR REPLACE`.
 */
const notas = criarTabela(
  "notas",
  ["titulo TEXT NOT NULL DEFAULT ''", "conteudo TEXT NOT NULL DEFAULT ''", marca("fixada"), "pasta TEXT"],
  { lixeira: true, restricoes: [`CHECK (id <> '${BLOCO_RAPIDO}' OR apagado_em IS NULL)`] },
);

/** Apagar de vez também não leva o bloco rápido. */
const blocoFica = `
  CREATE TRIGGER notas_bloco_rapido_nao_se_apaga BEFORE DELETE ON notas
    WHEN OLD.id = '${BLOCO_RAPIDO}'
  BEGIN
    SELECT RAISE(ABORT, 'o bloco rápido não se apaga');
  END;
`;

/**
 * O índice da busca (ADR-0036): título e conteúdo, sem acento e sem caixa ("amanha" acha "amanhã").
 * Guarda o próprio texto, para o trecho do resultado, e só as notas vivas: mandar à lixeira tira do
 * índice e restaurar põe de volta. A ligação com a nota é o `id`, não o `rowid`, que o `VACUUM`
 * pode renumerar numa tabela sem `INTEGER PRIMARY KEY`.
 */
const indiceBusca = `
  CREATE VIRTUAL TABLE notas_fts USING fts5 (
    id UNINDEXED,
    titulo,
    conteudo,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`;

/**
 * Os gatilhos que mantêm o índice. O de INSERT tira antes o que houver do mesmo id: o
 * `INSERT OR REPLACE` apaga a linha antiga sem disparar o gatilho de DELETE. O de UPDATE tira os
 * dois ids pelo mesmo motivo, para o `UPDATE OR REPLACE` que muda o id para o de outra nota.
 */
const manterIndice = `
  CREATE TRIGGER notas_fts_ao_criar AFTER INSERT ON notas
  BEGIN
    DELETE FROM notas_fts WHERE id = NEW.id;
    INSERT INTO notas_fts (id, titulo, conteudo)
      SELECT NEW.id, NEW.titulo, NEW.conteudo WHERE NEW.apagado_em IS NULL;
  END;
  CREATE TRIGGER notas_fts_ao_mudar AFTER UPDATE OF id, titulo, conteudo, apagado_em ON notas
  BEGIN
    DELETE FROM notas_fts WHERE id IN (OLD.id, NEW.id);
    INSERT INTO notas_fts (id, titulo, conteudo)
      SELECT NEW.id, NEW.titulo, NEW.conteudo WHERE NEW.apagado_em IS NULL;
  END;
  CREATE TRIGGER notas_fts_ao_apagar AFTER DELETE ON notas
  BEGIN
    DELETE FROM notas_fts WHERE id = OLD.id;
  END;
`;

/**
 * Os caminhos de consulta: a lista das vivas (as fixadas em cima, a mais mexida primeiro), as de uma
 * pasta e as tarefas criadas a partir de uma nota.
 */
const indices = `
  CREATE INDEX notas_vivas ON notas (fixada DESC, atualizado_em DESC) WHERE apagado_em IS NULL;
  CREATE INDEX notas_pasta ON notas (pasta) WHERE pasta IS NOT NULL AND apagado_em IS NULL;
  CREATE INDEX tarefas_nota_id ON tarefas (nota_id) WHERE nota_id IS NOT NULL;
`;

/** Depois dos gatilhos, para o bloco rápido já entrar no índice. */
const padroes = `
  INSERT INTO notas (id, titulo, fixada) VALUES ('${BLOCO_RAPIDO}', 'Bloco rápido', 1);
`;

export const m015: Migracao = {
  versao: 15,
  nome: "notas",
  sql: [notas, blocoFica, indiceBusca, manterIndice, indices, padroes].join("\n"),
};
