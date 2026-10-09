import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * Notificações (DATA.md §7): o que cada agente pode avisar, por onde, e o que já foi avisado.
 *
 * O agente da preferência e da notificação é `do_agente_id`, como na 003, para não colidir com o
 * carimbo de origem; texto sem chave estrangeira, porque `agentes` tem lixeira (lixeira.test.ts).
 * A data da notificação é o `criado_em`: o `criada_em` do DATA.md não vira coluna.
 */

const TIPOS = ["aprovacao", "lembrete", "erro", "aviso", "rotina"];
const CANAIS = ["windows", "dock", "ambos"];
const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;

/**
 * Configuração, sem lixeira: tirar a preferência é voltar ao padrão. `do_agente_id` vazio vale
 * para todos os agentes; a do agente vence a geral.
 */
const preferencias = criarTabela(
  "notificacoes_preferencias",
  [
    "do_agente_id TEXT",
    `tipo TEXT NOT NULL ${umaDas("tipo", TIPOS)}`,
    `nivel TEXT NOT NULL ${umaDas("nivel", ["tudo", "so_o_que_precisa", "nada"])}`,
    `canal TEXT NOT NULL ${umaDas("canal", CANAIS)}`,
  ],
  { lixeira: false },
);

/** Histórico do que foi avisado; `referencia` diz o que gerou o aviso, para não repetir. */
const notificacoes = criarTabela(
  "notificacoes",
  [
    "do_agente_id TEXT",
    `tipo TEXT NOT NULL ${umaDas("tipo", TIPOS)}`,
    "titulo TEXT NOT NULL",
    "corpo TEXT",
    "referencia TEXT",
    "vista_em TEXT",
    `canal TEXT NOT NULL ${umaDas("canal", CANAIS)}`,
  ],
  { lixeira: false },
);

/**
 * Uma preferência por agente e tipo, com o vazio (todos) contando como valor; e os caminhos de
 * consulta: o que ainda não foi visto e o aviso já dado para a mesma referência.
 */
const indices = `
  CREATE UNIQUE INDEX notificacoes_preferencias_chave ON notificacoes_preferencias (coalesce(do_agente_id, ''), tipo);
  CREATE INDEX notificacoes_nao_vistas ON notificacoes (criado_em) WHERE vista_em IS NULL;
  CREATE INDEX notificacoes_referencia ON notificacoes (referencia) WHERE referencia IS NOT NULL;
`;

export const m005: Migracao = {
  versao: 5,
  nome: "notificacoes",
  sql: [preferencias, notificacoes, indices].join("\n"),
};
