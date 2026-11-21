import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * O cadastro do dinheiro da Tula (DATA.md §3, ADR-0011): contas e cartões, categorias com o
 * conjunto padrão em pt-BR, regras de categoria e perfis de importação. Lançamentos, faturas e o
 * planejamento nascem nas migrações seguintes.
 *
 * As quatro tabelas vão para a lixeira. Chaves, como manda o DATA.md §1 (lixeira.test.ts): só de
 * filha com lixeira que vai junto com o pai, em NO ACTION. São duas: `categorias.categoria_pai_id`
 * → `categorias` (a subcategoria vai com a categoria) e `regras_categoria.categoria_id` →
 * `categorias` (a regra não vale sem a categoria). O cartão guarda a conta de pagamento como texto:
 * ele não vai junto com ela.
 *
 * Categorias, regras e perfis são configuração; contas, dado (outro-pc/tabelas.ts).
 */

const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const marca = (coluna: string, padrao: 0 | 1 = 0) =>
  `${coluna} INTEGER NOT NULL DEFAULT ${padrao} CHECK (${coluna} IN (0, 1))`;
const diaDoMes = (coluna: string) =>
  `${coluna} INTEGER CHECK (${coluna} IS NULL OR ${coluna} BETWEEN 1 AND 31)`;

/**
 * Conta, carteira, investimento ou cartão. O saldo não é coluna (ADR-0046): é o inicial mais os
 * lançamentos desde `saldo_inicial_em` (dia `AAAA-MM-DD`; vazio conta todos). A moeda é a forma do
 * código ISO 4217, como o teto dos agentes (017). `banco` é o código do perfil de importação.
 * Conta com lançamento não vai à lixeira, só arquiva (`ativa = 0`): o gatilho nasce com os
 * lançamentos, porque lê a tabela deles.
 *
 * Só o cartão tem os campos de cartão, e precisa dos dias de fechamento e de vencimento para achar
 * a fatura; o mês curto usa o último dia, então qualquer dia de 1 a 31 vale.
 */
const contas = criarTabela(
  "contas",
  [
    "nome TEXT NOT NULL",
    `tipo TEXT NOT NULL ${umaDas("tipo", ["corrente", "poupanca", "carteira", "investimento", "cartao"])}`,
    "banco TEXT",
    "moeda TEXT NOT NULL DEFAULT 'BRL' CHECK (moeda GLOB '[A-Z][A-Z][A-Z]')",
    "saldo_inicial_centavos INTEGER NOT NULL DEFAULT 0",
    "saldo_inicial_em TEXT CHECK (saldo_inicial_em IS NULL OR saldo_inicial_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')",
    marca("ativa", 1),
    diaDoMes("dia_fechamento"),
    diaDoMes("dia_vencimento"),
    "limite_centavos INTEGER CHECK (limite_centavos IS NULL OR limite_centavos > 0)",
    // `contas` tem lixeira e o cartão não vai junto com a conta que o paga: sem chave estrangeira.
    "conta_pagamento_id TEXT",
  ],
  {
    lixeira: true,
    restricoes: [
      "CHECK (tipo <> 'cartao' OR (dia_fechamento IS NOT NULL AND dia_vencimento IS NOT NULL))",
      `CHECK (tipo = 'cartao' OR (dia_fechamento IS NULL AND dia_vencimento IS NULL
        AND limite_centavos IS NULL AND conta_pagamento_id IS NULL))`,
      "CHECK (conta_pagamento_id IS NULL OR conta_pagamento_id <> id)",
    ],
  },
);

/**
 * Categoria de gasto, de receita ou de transferência (que fica fora dos dois, ADR-0046), com um
 * nível de subcategoria ("Casa › Mercado"). `cor` segue as listas: vazia usa a da interface.
 */
const categorias = criarTabela(
  "categorias",
  [
    "nome TEXT NOT NULL",
    "categoria_pai_id TEXT REFERENCES categorias (id)",
    `tipo TEXT NOT NULL ${umaDas("tipo", ["gasto", "receita", "transferencia"])}`,
    "cor TEXT",
    marca("arquivada"),
  ],
  { lixeira: true, restricoes: ["CHECK (categoria_pai_id IS NULL OR categoria_pai_id <> id)"] },
);

/**
 * O que a Tula e o usuário ensinaram ("descrição contém IFOOD → Restaurantes", ADR-0045).
 * `criada_por` decide a ordem (a do usuário vence a do agente) e não muda quando a regra é editada,
 * ao contrário do carimbo de origem. Limite de tamanho e de tempo da regex fica no serviço.
 */
const regrasCategoria = criarTabela(
  "regras_categoria",
  [
    "padrao TEXT NOT NULL CHECK (length(trim(padrao)) > 0)",
    `tipo_padrao TEXT NOT NULL ${umaDas("tipo_padrao", ["contem", "comeca_com", "regex"])}`,
    "categoria_id TEXT NOT NULL REFERENCES categorias (id)",
    "vezes_aplicada INTEGER NOT NULL DEFAULT 0 CHECK (vezes_aplicada >= 0)",
    `criada_por TEXT NOT NULL DEFAULT 'usuario' ${umaDas("criada_por", ["usuario", "agente"])}`,
  ],
  { lixeira: true },
);

/**
 * Como ler o extrato de cada banco (ADR-0041): os de fábrica chegam por migração própria, com
 * arquivo real conferido; os que o usuário mapear são linha comum. `mapeamento` é o JSON das
 * colunas (ou caminhos do XML) de data, descrição, valor, sinal e identificador. Separador, formato
 * de data, decimal e codificação ficam vazios quando o leitor detecta pela amostra.
 */
const perfisImportacao = criarTabela(
  "perfis_importacao",
  [
    "banco TEXT NOT NULL",
    `tipo_conta TEXT NOT NULL ${umaDas("tipo_conta", ["conta", "cartao"])}`,
    `formato TEXT NOT NULL ${umaDas("formato", ["ofx", "csv", "xml"])}`,
    "mapeamento TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mapeamento) AND json_type(mapeamento) = 'object')",
    "separador TEXT CHECK (separador IS NULL OR length(separador) = 1)",
    "formato_data TEXT",
    "formato_decimal TEXT CHECK (formato_decimal IS NULL OR formato_decimal IN (',', '.'))",
    "codificacao TEXT",
    marca("de_fabrica"),
  ],
  { lixeira: true },
);

/**
 * Subcategoria de um nível (DATA.md §3), no banco como a subtarefa (013): a mãe não pode ser
 * subcategoria, e categoria com subcategorias não vira subcategoria.
 */
const umNivel = `
  CREATE TRIGGER categorias_subcategoria_de_um_nivel BEFORE INSERT ON categorias
    WHEN NEW.categoria_pai_id IS NOT NULL
      AND ((SELECT categoria_pai_id FROM categorias WHERE id = NEW.categoria_pai_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM categorias WHERE categoria_pai_id = NEW.id))
  BEGIN
    SELECT RAISE(ABORT, 'subcategoria só tem um nível');
  END;
  CREATE TRIGGER categorias_subcategoria_de_um_nivel_ao_mudar BEFORE UPDATE OF categoria_pai_id ON categorias
    WHEN NEW.categoria_pai_id IS NOT NULL
      AND ((SELECT categoria_pai_id FROM categorias WHERE id = NEW.categoria_pai_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM categorias WHERE categoria_pai_id = NEW.id))
  BEGIN
    SELECT RAISE(ABORT, 'subcategoria só tem um nível');
  END;
`;

/** Índice em toda coluna-filha de chave estrangeira. */
const indices = `
  CREATE INDEX categorias_categoria_pai_id ON categorias (categoria_pai_id) WHERE categoria_pai_id IS NOT NULL;
  CREATE INDEX regras_categoria_categoria_id ON regras_categoria (categoria_id);
`;

/**
 * O conjunto padrão em pt-BR, de um nível. Id fixo, igual em todo PC, como as listas padrão: juntar
 * dados de outro PC não duplica as categorias, e as regras e os lançamentos de lá acham as daqui.
 */
const padroes = `
  INSERT INTO categorias (id, nome, tipo) VALUES
  ('mercado', 'Mercado', 'gasto'),
  ('restaurantes', 'Restaurantes', 'gasto'),
  ('transporte', 'Transporte', 'gasto'),
  ('casa', 'Casa', 'gasto'),
  ('contas', 'Contas', 'gasto'),
  ('saude', 'Saúde', 'gasto'),
  ('educacao', 'Educação', 'gasto'),
  ('lazer', 'Lazer', 'gasto'),
  ('compras', 'Compras', 'gasto'),
  ('assinaturas', 'Assinaturas', 'gasto'),
  ('cuidados_pessoais', 'Cuidados pessoais', 'gasto'),
  ('pets', 'Pets', 'gasto'),
  ('viagens', 'Viagens', 'gasto'),
  ('impostos_e_taxas', 'Impostos e taxas', 'gasto'),
  ('presentes_e_doacoes', 'Presentes e doações', 'gasto'),
  ('outros_gastos', 'Outros gastos', 'gasto'),
  ('salario', 'Salário', 'receita'),
  ('renda_extra', 'Renda extra', 'receita'),
  ('rendimentos', 'Rendimentos', 'receita'),
  ('reembolsos', 'Reembolsos', 'receita'),
  ('outras_receitas', 'Outras receitas', 'receita'),
  ('transferencia', 'Transferência', 'transferencia');
`;

export const m029: Migracao = {
  versao: 29,
  nome: "financas-cadastro",
  sql: [contas, categorias, regrasCategoria, perfisImportacao, umNivel, indices, padroes].join("\n"),
};
