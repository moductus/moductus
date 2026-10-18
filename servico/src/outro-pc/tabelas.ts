import type { DatabaseSync } from "node:sqlite";
import { COLUNA_LIXEIRA } from "../banco/tabela.ts";

/**
 * Configuração ou dado (DATA.md §8, ADR-0011): é o que separa "só configurações" de
 * "configurações e dados" no arquivo de levar para outro PC. Toda tabela do banco tem a sua
 * marcação aqui; a guarda em tabelas.test.ts reprova tabela nova sem marcação. `deste_pc` é
 * controle interno que não vai em nenhuma modalidade.
 */
export type Exportacao = "configuracao" | "dado" | "deste_pc";

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
  // 008-uso-respostas-contadas: o que já entrou em `uso_ia` daqui; o PC novo conta o dele.
  uso_ia_mensagens: "deste_pc",
  // agendador-disparos: até onde o agendador daqui contou; o PC novo começa a contar do zero.
  agendador_disparos: "deste_pc",
  // 013-tarefas: listas e etiquetas são como o usuário organiza; o que ele tem a fazer é dado.
  listas: "configuracao",
  etiquetas: "configuracao",
  tarefas: "dado",
  tarefa_etiquetas: "dado",
  lembretes: "dado",
  // 014-agenda-foco: calendários e rotinas são configuração; eventos e foco, dado. A fila de saída
  // para o Google e o registro das rotinas são deste PC: o PC novo espelha e conta do zero.
  calendarios: "configuracao",
  rotinas: "configuracao",
  eventos: "dado",
  sessoes_foco: "dado",
  agenda_saida: "deste_pc",
  rotinas_registro: "deste_pc",
  // 015-notas: o que o usuário escreveu é dado. O índice da busca (`notas_fts`) é tabela virtual,
  // fora desta lista: os gatilhos o refazem com as notas que chegam.
  notas: "dado",
};

/**
 * Colunas que nunca saem deste PC, em nenhuma modalidade: o nome da credencial (a chave não
 * está no banco, e no PC novo a conexão é refeita), o caminho do transcript e até onde ele já foi
 * lido (posição num arquivo daqui).
 */
export const COLUNAS_QUE_NUNCA_VAO: readonly string[] = [
  "credencial",
  "transcript_caminho",
  "transcript_lido_bytes",
];

/**
 * Colunas que descrevem a situação neste PC, não a configuração. A conexão vai sem credencial, então
 * chega desligada no PC novo: estado, último erro, data de conexão e de leitura daqui não valem lá,
 * nem os escopos que o Google concedeu à autorização daqui (o PC novo pede os dele ao conectar).
 * O calendário vai sem o `nextSyncToken` e a última leitura: o PC novo começa com o cache vazio e
 * tem de ler tudo de novo, não só o que mudou desde a leitura daqui. O provedor vai sem o caminho
 * do CLI neste PC: no PC novo, a detecção acha o de lá.
 */
const SITUACAO_DESTE_PC: Readonly<Record<string, readonly string[]>> = {
  provedores: ["caminho"],
  conexoes: ["estado", "ultimo_erro", "conectada_em", "lida_em", "escopos"],
  calendarios: ["sincronizado_em", "token_sincronizacao"],
};

/**
 * Linhas que não viajam: regra que já expirou não autoriza mais nada, aqui nem lá; evento de
 * calendário de fora é cache deste PC, e a fonte da verdade é o Google, que o PC novo lê de novo;
 * evento de calendário local na lixeira iria sem o calendário, que não viaja; a etapa de foco em
 * andamento é o relógio deste PC, e só a terminada é histórico.
 */
const SO_AS_QUE_VALEM: Readonly<Record<string, string>> = {
  regras_permissao: "(expira_em IS NULL OR expira_em > :agora)",
  eventos: `calendario_id IN (SELECT id FROM calendarios WHERE fonte = 'local' AND ${COLUNA_LIXEIRA} IS NULL)`,
  sessoes_foco: "fim IS NOT NULL",
};

/**
 * `config` vai pelo ServicoConfig, validada chave a chave contra o contrato (config.json do
 * arquivo); aqui ficam as demais tabelas de configuração.
 */
const PELO_SERVICO_CONFIG = "config";

export type Linha = Record<string, unknown>;

/**
 * As linhas das tabelas de configuração, prontas para "só configurações", como `linhasQueViajam`
 * as entrega. Tabela sem marcação não sai: na dúvida, é dado.
 */
export function lerConfiguracoes(db: DatabaseSync, agora: Date = new Date()): Map<string, Linha[]> {
  const tabelas = new Map<string, Linha[]>();
  for (const tabela of tabelasDoBanco(db)) {
    if (EXPORTACAO[tabela] !== "configuracao" || tabela === PELO_SERVICO_CONFIG) continue;
    tabelas.set(tabela, linhasQueViajam(db, tabela, agora));
  }
  return tabelas;
}

/**
 * As linhas de uma tabela como saem deste PC, em qualquer modalidade: sem o que está na lixeira,
 * sem as colunas que nunca vão nem as da situação deste PC, e sem as linhas que não viajam (regra
 * vencida, evento do Google). Tabela deste PC ou sem marcação não sai, nem `config`, que vai pelo
 * ServicoConfig. A ordem é a da chave primária, que nem toda tabela tem em `id`.
 */
export function linhasQueViajam(db: DatabaseSync, tabela: string, agora: Date = new Date()): Linha[] {
  const marcacao = EXPORTACAO[tabela];
  if (marcacao !== "configuracao" && marcacao !== "dado") return [];
  if (tabela === PELO_SERVICO_CONFIG) return [];
  const colunas = colunasDe(db, tabela);
  const chave = chavePrimariaDe(db, tabela);
  const ficam = [...COLUNAS_QUE_NUNCA_VAO, ...(SITUACAO_DESTE_PC[tabela] ?? [])];
  const levadas = colunas.filter((c) => !ficam.includes(c));
  const condicoes = [
    ...(colunas.includes(COLUNA_LIXEIRA) ? [`${COLUNA_LIXEIRA} IS NULL`] : []),
    ...(SO_AS_QUE_VALEM[tabela] ? [SO_AS_QUE_VALEM[tabela]] : []),
  ];
  const onde = condicoes.length ? ` WHERE ${condicoes.join(" AND ")}` : "";
  const ordem = chave.length ? chave.map((c) => `"${c}"`).join(", ") : "rowid";
  const sql = `SELECT ${levadas.map((c) => `"${c}"`).join(", ")} FROM "${tabela}"${onde} ORDER BY ${ordem}`;
  const parametros: Record<string, string> = sql.includes(":agora") ? { agora: agora.toISOString() } : {};
  return db.prepare(sql).all(parametros) as Linha[];
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

/** As colunas da chave primária, na ordem da chave; vazia na tabela sem chave declarada. */
function chavePrimariaDe(db: DatabaseSync, tabela: string): string[] {
  return (
    db.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk").all(tabela) as {
      name: string;
    }[]
  ).map((c) => c.name);
}
