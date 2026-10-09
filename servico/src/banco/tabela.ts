/**
 * O que toda tabela nova leva (DATA.md §1, ADR-0011): `id` em ULID, datas, origem e, quando a
 * linha pode ir para a lixeira, `apagado_em`. As migrações declaram tabelas por `criarTabela`
 * para não esquecer nenhum desses campos.
 *
 * O SQL gerado vira parte de migração publicada, que não muda: mudar o que este arquivo gera
 * pede uma função nova, nunca editar esta.
 */

/** Quem criou ou mudou a linha por último. */
export const ORIGENS = ["usuario", "agente", "importacao", "conexao"] as const;
export type Origem = (typeof ORIGENS)[number];

/** A coluna da lixeira; a limpeza da subida acha as tabelas por ela. */
export const COLUNA_LIXEIRA = "apagado_em";

/** Agora em ISO 8601 UTC com milissegundos, igual ao `toISOString()` do JavaScript. */
export const AGORA_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const COLUNAS_ORIGEM = [
  `origem TEXT NOT NULL DEFAULT 'usuario' CHECK (origem IN (${ORIGENS.map((o) => `'${o}'`).join(", ")}))`,
  "agente_id TEXT",
  "execucao_id TEXT",
] as const;

/** Linha de agente sempre diz qual agente; `execucao_id` fica vazio quando não houve execução. */
export const RESTRICAO_ORIGEM = "CHECK (origem <> 'agente' OR agente_id IS NOT NULL)";

export interface OpcoesTabela {
  /** A linha vai para a lixeira ao ser apagada (some de vez depois de 30 dias). */
  lixeira: boolean;
  /** Restrições de tabela (`UNIQUE (a, b)`), que o SQLite exige depois de todas as colunas. */
  restricoes?: readonly string[];
}

/**
 * `CREATE TABLE` com as colunas próprias da tabela e as de DATA.md §1. Com lixeira, cria também
 * o índice parcial que a limpeza usa.
 */
export function criarTabela(nome: string, colunas: readonly string[], opcoes: OpcoesTabela): string {
  const definicoes = [
    "id TEXT PRIMARY KEY",
    ...colunas,
    `criado_em TEXT NOT NULL DEFAULT (${AGORA_SQL})`,
    `atualizado_em TEXT NOT NULL DEFAULT (${AGORA_SQL})`,
    ...COLUNAS_ORIGEM,
    ...(opcoes.lixeira ? [`${COLUNA_LIXEIRA} TEXT`] : []),
    RESTRICAO_ORIGEM,
    ...(opcoes.restricoes ?? []),
  ];
  const tabela = `CREATE TABLE ${nome} (\n  ${definicoes.join(",\n  ")}\n) STRICT;`;
  if (!opcoes.lixeira) return tabela;
  return `${tabela}\nCREATE INDEX ${nome}_${COLUNA_LIXEIRA} ON ${nome} (${COLUNA_LIXEIRA}) WHERE ${COLUNA_LIXEIRA} IS NOT NULL;`;
}

/** O carimbo que o código passa ao gravar: agente exige o agente; a execução é opcional. */
export type Carimbo =
  { origem: Exclude<Origem, "agente"> } | { origem: "agente"; agenteId: string; execucaoId: string | null };

export const DO_USUARIO: Carimbo = { origem: "usuario" };

/** Os valores das colunas de origem, prontos para o `INSERT` ou o `UPDATE`. */
export function colunasDeOrigem(carimbo: Carimbo): {
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
} {
  if (carimbo.origem === "agente") {
    return { origem: "agente", agente_id: carimbo.agenteId, execucao_id: carimbo.execucaoId };
  }
  return { origem: carimbo.origem, agente_id: null, execucao_id: null };
}
