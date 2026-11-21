import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * O planejamento do dinheiro da Tula (DATA.md §3, ADR-0046): orçamento por categoria, contas fixas
 * e assinaturas, dívidas, planos de economia e o que entrou e saiu de cada plano. Os lançamentos já
 * guardam a recorrência e a dívida (030).
 *
 * Recorrências, dívidas e planos vão para a lixeira; orçamentos e movimentos de plano, não (tirar o
 * orçamento é voltar a não ter limite; o movimento é histórico do plano). Nenhuma chave
 * estrangeira, como manda o DATA.md §1 (lixeira.test.ts): todas as referências apontam para tabela
 * com lixeira (categorias, contas, planos, lançamentos) e a linha não vai junto com a outra ponta.
 * O que não vale sem a outra ponta some por gatilho quando ela sai de vez: o orçamento com a
 * categoria e o movimento com o plano.
 *
 * Todas as cinco são dado (outro-pc/tabelas.ts).
 */

const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const marca = (coluna: string, padrao: 0 | 1 = 0) =>
  `${coluna} INTEGER NOT NULL DEFAULT ${padrao} CHECK (${coluna} IN (0, 1))`;
const dia = (coluna: string, obrigatorio = false) =>
  `${coluna} TEXT ${obrigatorio ? "NOT NULL " : ""}CHECK (${coluna} IS NULL OR ${coluna} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;
const diaDoMes = (coluna: string) =>
  `${coluna} INTEGER CHECK (${coluna} IS NULL OR ${coluna} BETWEEN 1 AND 31)`;
const comTexto = (coluna: string) => `${coluna} TEXT NOT NULL CHECK (length(trim(${coluna})) > 0)`;

/**
 * Limite de gasto de uma categoria num mês (`AAAA-MM`) ou, com o mês vazio, em todo mês; a linha do
 * mês vence a de todo mês (remanejar cria a do mês, ADR-0046). Um por categoria e mês, contando o
 * vazio como valor (índice abaixo). Limite zero é "não gastar nada nesta categoria". `alerta_percentual`
 * é quanto do limite já avisa.
 */
const orcamentos = criarTabela(
  "orcamentos",
  [
    "categoria_id TEXT NOT NULL",
    `mes TEXT CHECK (mes IS NULL OR (mes GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(mes, 6, 2) BETWEEN '01' AND '12'))`,
    "limite_centavos INTEGER NOT NULL CHECK (limite_centavos >= 0)",
    "alerta_percentual INTEGER NOT NULL DEFAULT 80 CHECK (alerta_percentual BETWEEN 1 AND 100)",
  ],
  { lixeira: false },
);

/**
 * Conta fixa ou assinatura (aluguel, internet, streaming): o valor estimado com sinal, na moeda da
 * conta, e a regra como RRULE do relógio do dia (ADR-0034), da qual sai a próxima data. A detectada
 * por código chega como sugestão e só vira recorrência com o seu sim (ADR-0046); a marca diz de onde
 * ela veio.
 */
const recorrencias = criarTabela(
  "recorrencias",
  [
    comTexto("descricao"),
    "valor_centavos INTEGER NOT NULL",
    "categoria_id TEXT",
    "conta_id TEXT",
    "regra TEXT NOT NULL CHECK (regra GLOB 'FREQ=*')",
    dia("proxima_em"),
    marca("ativa", 1),
    marca("detectada_automaticamente"),
  ],
  { lixeira: true },
);

/**
 * Dívida com o saldo devedor (positivo) numa data, juros ao mês em pontos-base (1,99% = 199) e a
 * parcela. O custo total e a simulação de quitação são calculados na hora, não guardados (ADR-0046).
 * `quitada_em` é o dia em que acabou.
 */
const dividas = criarTabela(
  "dividas",
  [
    comTexto("nome"),
    "credor TEXT",
    `tipo TEXT NOT NULL ${umaDas("tipo", [
      "cartao",
      "emprestimo",
      "financiamento",
      "cheque_especial",
      "pessoal",
      "outro",
    ])}`,
    "saldo_centavos INTEGER NOT NULL CHECK (saldo_centavos >= 0)",
    dia("saldo_em", true),
    "juros_mensal_bp INTEGER NOT NULL DEFAULT 0 CHECK (juros_mensal_bp >= 0)",
    "parcela_centavos INTEGER CHECK (parcela_centavos IS NULL OR parcela_centavos > 0)",
    "parcelas_restantes INTEGER CHECK (parcelas_restantes IS NULL OR parcelas_restantes >= 0)",
    diaDoMes("dia_vencimento"),
    dia("quitada_em"),
  ],
  { lixeira: true },
);

/**
 * Meta de economia com alvo, prazo (dia) e a conta onde o dinheiro fica, opcional. O guardado é a
 * soma dos movimentos; o aporte sugerido sai do alvo, do guardado e dos meses até o prazo (ADR-0046).
 */
const planos = criarTabela(
  "planos",
  [
    comTexto("nome"),
    "valor_alvo_centavos INTEGER NOT NULL CHECK (valor_alvo_centavos > 0)",
    dia("prazo"),
    "conta_id TEXT",
    "aporte_mensal_sugerido_centavos INTEGER CHECK (aporte_mensal_sugerido_centavos IS NULL OR aporte_mensal_sugerido_centavos >= 0)",
    `estado TEXT NOT NULL DEFAULT 'ativo' ${umaDas("estado", ["ativo", "concluido", "pausado"])}`,
  ],
  { lixeira: true },
);

/** O que entrou (positivo) ou saiu (negativo) de um plano, e o lançamento que o moveu, quando há. */
const planoMovimentos = criarTabela(
  "plano_movimentos",
  [
    "plano_id TEXT NOT NULL",
    dia("data", true),
    "valor_centavos INTEGER NOT NULL CHECK (valor_centavos <> 0)",
    "lancamento_id TEXT",
  ],
  { lixeira: false },
);

/**
 * Sem chave, quem não vale sem a outra ponta sai com ela, como as etiquetas da tarefa (013): o
 * orçamento quando a categoria sai de vez da lixeira, os movimentos quando o plano sai.
 */
const saemJunto = `
  CREATE TRIGGER orcamentos_saem_com_a_categoria AFTER DELETE ON categorias
  BEGIN
    DELETE FROM orcamentos WHERE categoria_id = OLD.id;
  END;
  CREATE TRIGGER plano_movimentos_saem_com_o_plano AFTER DELETE ON planos
  BEGIN
    DELETE FROM plano_movimentos WHERE plano_id = OLD.id;
  END;
`;

/**
 * Um orçamento por categoria e mês, com o "todo mês" contando como valor (o UNIQUE comum deixaria
 * passar dois vazios). E os índices das buscas: a próxima recorrência ativa, os movimentos do plano
 * e os lançamentos de uma recorrência ou de uma dívida.
 */
const indices = `
  CREATE UNIQUE INDEX orcamentos_categoria_id_mes ON orcamentos (categoria_id, ifnull(mes, ''));
  CREATE INDEX recorrencias_proxima_em ON recorrencias (proxima_em) WHERE ativa = 1;
  CREATE INDEX plano_movimentos_plano_id_data ON plano_movimentos (plano_id, data);
  CREATE INDEX plano_movimentos_lancamento_id ON plano_movimentos (lancamento_id) WHERE lancamento_id IS NOT NULL;
  CREATE INDEX lancamentos_recorrencia_id ON lancamentos (recorrencia_id) WHERE recorrencia_id IS NOT NULL;
  CREATE INDEX lancamentos_divida_id ON lancamentos (divida_id) WHERE divida_id IS NOT NULL;
`;

export const m031: Migracao = {
  versao: 31,
  nome: "planejamento",
  sql: [orcamentos, recorrencias, dividas, planos, planoMovimentos, saemJunto, indices].join("\n"),
};
