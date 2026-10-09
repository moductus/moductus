import type { DatabaseSync } from "node:sqlite";
import { COLUNA_LIXEIRA } from "../banco/tabela.ts";

/**
 * Configuração ou dado (DATA.md §8, ADR-0011): é o que separa "só configurações" de
 * "configurações e dados" no arquivo de levar para outro PC. Toda tabela do banco tem a sua
 * marcação aqui; a guarda em tabelas.test.ts reprova tabela nova sem marcação.
 */
export type Exportacao = "configuracao" | "dado";

export const EXPORTACAO: Readonly<Record<string, Exportacao>> = {
  // 001 e 002
  config: "configuracao",
  onboarding: "dado",
  // 003-agentes
  provedores: "configuracao",
  agentes: "configuracao",
  regras_permissao: "configuracao",
  execucoes: "dado",
  aprovacoes: "dado",
  chamadas_ferramenta: "dado",
  conversas: "dado",
  mensagens: "dado",
  // 004-sessoes-dev
  projetos: "dado",
  sessoes_ia: "dado",
  eventos_sessao: "dado",
  uso_ia: "dado",
  github_itens: "dado",
  conexoes: "configuracao",
  // 005-notificacoes
  notificacoes_preferencias: "configuracao",
  notificacoes: "dado",
};

/**
 * Colunas que nunca saem deste PC, em nenhuma modalidade: o nome da credencial (a chave não
 * está no banco, e no PC novo a conexão é refeita) e o caminho do transcript.
 */
export const COLUNAS_QUE_NUNCA_VAO: readonly string[] = ["credencial", "transcript_caminho"];

/**
 * Colunas que descrevem a situação neste PC, não a configuração. A conexão vai sem credencial, então
 * chega desligada no PC novo: estado, último erro e data de conexão daqui não valem lá.
 */
const SITUACAO_DESTE_PC: Readonly<Record<string, readonly string[]>> = {
  conexoes: ["estado", "ultimo_erro", "conectada_em"],
};

/** Linhas que não viajam: regra que já expirou não autoriza mais nada, aqui nem lá. */
const SO_AS_QUE_VALEM: Readonly<Record<string, string>> = {
  regras_permissao: "(expira_em IS NULL OR expira_em > :agora)",
};

/**
 * `config` vai pelo ServicoConfig, validada chave a chave contra o contrato (config.json do
 * arquivo); aqui ficam as demais tabelas de configuração.
 */
const PELO_SERVICO_CONFIG = "config";

export type Linha = Record<string, unknown>;

/**
 * As linhas das tabelas de configuração, prontas para "só configurações": sem o que está na
 * lixeira, sem as colunas que nunca vão nem as da situação deste PC, e sem as regras vencidas.
 * Tabela sem marcação não sai: na dúvida, é dado.
 */
export function lerConfiguracoes(db: DatabaseSync, agora: Date = new Date()): Map<string, Linha[]> {
  const tabelas = new Map<string, Linha[]>();
  for (const tabela of tabelasDoBanco(db)) {
    if (EXPORTACAO[tabela] !== "configuracao" || tabela === PELO_SERVICO_CONFIG) continue;
    const colunas = colunasDe(db, tabela);
    const ficam = [...COLUNAS_QUE_NUNCA_VAO, ...(SITUACAO_DESTE_PC[tabela] ?? [])];
    const levadas = colunas.filter((c) => !ficam.includes(c));
    const condicoes = [
      ...(colunas.includes(COLUNA_LIXEIRA) ? [`${COLUNA_LIXEIRA} IS NULL`] : []),
      ...(SO_AS_QUE_VALEM[tabela] ? [SO_AS_QUE_VALEM[tabela]] : []),
    ];
    const onde = condicoes.length ? ` WHERE ${condicoes.join(" AND ")}` : "";
    const sql = `SELECT ${levadas.map((c) => `"${c}"`).join(", ")} FROM "${tabela}"${onde} ORDER BY id`;
    const parametros: Record<string, string> = sql.includes(":agora") ? { agora: agora.toISOString() } : {};
    tabelas.set(tabela, db.prepare(sql).all(parametros) as Linha[]);
  }
  return tabelas;
}

/** As tabelas comuns do banco, sem as internas do SQLite. */
export function tabelasDoBanco(db: DatabaseSync): string[] {
  const linhas = db
    .prepare(
      `SELECT name AS nome FROM pragma_table_list
       WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as { nome: string }[];
  return linhas.map((l) => l.nome);
}

function colunasDe(db: DatabaseSync, tabela: string): string[] {
  return (
    db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").all(tabela) as { name: string }[]
  ).map((c) => c.name);
}
