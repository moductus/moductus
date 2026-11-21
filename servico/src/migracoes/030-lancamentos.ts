import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * O movimento do dinheiro da Tula (DATA.md §3, ADR-0042, ADR-0046): lançamentos, faturas do cartão,
 * importações de extrato e as lápides do importado que você apagou de vez. Orçamentos,
 * recorrências, dívidas e planos nascem na migração seguinte.
 *
 * Só `lancamentos` vai para a lixeira; faturas, importações e lápides são histórico. Chaves, como
 * manda o DATA.md §1 (lixeira.test.ts): `lancamentos.conta_id` → `contas` (filha com lixeira de pai
 * com lixeira; conta com lançamento nem vai à lixeira, gatilho abaixo) e, para tabelas sem lixeira,
 * `lancamentos.fatura_id` → `faturas` e `lancamentos.importacao_id` → `importacoes`, todas em NO
 * ACTION. O resto guarda o id como texto: a categoria (que vai à lixeira deixando o lançamento "sem
 * categoria"), a recorrência e a dívida (da migração seguinte), a conta da fatura, da importação e
 * da lápide, o perfil da importação e o lançamento que pagou a fatura.
 *
 * Todas as quatro são dado (outro-pc/tabelas.ts).
 */

const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const marca = (coluna: string, padrao: 0 | 1 = 0) =>
  `${coluna} INTEGER NOT NULL DEFAULT ${padrao} CHECK (${coluna} IN (0, 1))`;
const dia = (coluna: string, obrigatorio = false) =>
  `${coluna} TEXT ${obrigatorio ? "NOT NULL " : ""}CHECK (${coluna} IS NULL OR ${coluna} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;
/** SHA-256 em hexadecimal minúsculo, como o serviço calcula. */
const sha256 = (coluna: string) =>
  `${coluna} TEXT NOT NULL CHECK (length(${coluna}) = 64 AND ${coluna} NOT GLOB '*[^0-9a-f]*')`;

/**
 * O cartão guarda uma fatura por mês (`mes_referencia`, o mês em que ela fecha), criada sob demanda.
 * O total não é coluna (ADR-0046): é a soma dos lançamentos dela, como o saldo da conta. Pagar é uma
 * transferência da conta de pagamento, e `pagamento_lancamento_id` aponta o lado do cartão.
 */
const faturas = criarTabela(
  "faturas",
  [
    "conta_id TEXT NOT NULL",
    "mes_referencia TEXT NOT NULL CHECK (mes_referencia GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]')",
    dia("fecha_em", true),
    dia("vence_em", true),
    marca("paga"),
    // `lancamentos` tem lixeira e a fatura não vai junto com o pagamento: sem chave estrangeira.
    "pagamento_lancamento_id TEXT",
  ],
  {
    lixeira: false,
    restricoes: [
      "UNIQUE (conta_id, mes_referencia)",
      "CHECK (vence_em > fecha_em)",
      "CHECK (pagamento_lancamento_id IS NULL OR paga = 1)",
    ],
  },
);

/**
 * Cada arquivo de extrato que entrou ou tentou entrar (ADR-0041, ADR-0042). `arquivo_hash` é o
 * SHA-256 dos bytes e reconhece o mesmo arquivo de novo ("Este arquivo já entrou em 12/11"); não é
 * único, porque o usuário pode mandar entrar mesmo assim ou depois de desfazer. Do arquivo fica só o
 * nome, nunca o caminho (ADR-0044). Sem conta, só a que falhou antes de saber para onde ia.
 */
const importacoes = criarTabela(
  "importacoes",
  [
    "conta_id TEXT",
    "arquivo_nome TEXT NOT NULL CHECK (length(trim(arquivo_nome)) > 0 AND arquivo_nome NOT GLOB '*[/\\:]*')",
    sha256("arquivo_hash"),
    `formato TEXT NOT NULL ${umaDas("formato", ["ofx", "csv", "xml"])}`,
    "perfil_id TEXT",
    dia("periodo_inicio"),
    dia("periodo_fim"),
    "lancamentos_novos INTEGER NOT NULL DEFAULT 0 CHECK (lancamentos_novos >= 0)",
    "lancamentos_ignorados INTEGER NOT NULL DEFAULT 0 CHECK (lancamentos_ignorados >= 0)",
    `estado TEXT NOT NULL ${umaDas("estado", ["previa", "concluida", "desfeita", "falhou"])}`,
    "erro TEXT",
  ],
  {
    lixeira: false,
    restricoes: [
      "CHECK (conta_id IS NOT NULL OR estado = 'falhou')",
      "CHECK (estado <> 'falhou' OR erro IS NOT NULL)",
      "CHECK (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_inicio <= periodo_fim)",
    ],
  },
);

/**
 * Entrada ou saída de uma conta (valor com sinal, ADR-0046), na moeda da conta. `impressao` é a
 * chave natural do ADR-0042: SHA-256 de conta, data e valor, sem a descrição, que muda entre
 * exportações; não é única, porque duas compras iguais no mesmo dia são legítimas (multiconjunto).
 * `id_externo` é o FITID do OFX, guardado como sinal. Sem categoria é "sem categoria".
 *
 * Compra parcelada: as parcelas têm o mesmo `compra_id`, com número e total (dois ou mais).
 * Transferência entre contas próprias: dois lados com o mesmo `transferencia_id`. Lançamento que a
 * importação trouxe tem a importação; se depois o usuário mexer, a origem muda e ela fica.
 */
const lancamentos = criarTabela(
  "lancamentos",
  [
    "conta_id TEXT NOT NULL REFERENCES contas (id)",
    dia("data", true),
    "descricao TEXT NOT NULL",
    "descricao_original TEXT",
    "valor_centavos INTEGER NOT NULL",
    // Vai à lixeira deixando o lançamento "sem categoria", não levando-o junto: sem chave.
    "categoria_id TEXT",
    "fatura_id TEXT REFERENCES faturas (id)",
    "parcela_numero INTEGER",
    "parcela_total INTEGER",
    "compra_id TEXT",
    "transferencia_id TEXT",
    "recorrencia_id TEXT",
    "divida_id TEXT",
    "importacao_id TEXT REFERENCES importacoes (id)",
    "id_externo TEXT CHECK (id_externo IS NULL OR length(trim(id_externo)) > 0)",
    sha256("impressao"),
    marca("conciliado"),
    "notas TEXT",
  ],
  {
    lixeira: true,
    restricoes: [
      "CHECK ((parcela_numero IS NULL) = (parcela_total IS NULL))",
      "CHECK (parcela_total IS NULL OR (parcela_total >= 2 AND parcela_numero BETWEEN 1 AND parcela_total))",
      "CHECK ((compra_id IS NULL) = (parcela_total IS NULL))",
      "CHECK (origem <> 'importacao' OR importacao_id IS NOT NULL)",
    ],
  },
);

/**
 * O lançamento importado que você apagou e tirou da lixeira de vez (ADR-0042): a importação seguinte
 * conta a lápide como lançamento que a conta já tem e não o traz de volta. O id é o do lançamento
 * que se foi.
 */
const lapides = criarTabela(
  "importacao_lapides",
  ["conta_id TEXT NOT NULL", sha256("impressao"), "id_externo TEXT"],
  { lixeira: false },
);

/**
 * Conta com lançamento só arquiva (`ativa = 0`), não vai à lixeira (DATA.md §1). Lançamento na
 * lixeira também conta: assim conta na lixeira nunca tem lançamento, e restaurar um lançamento não o
 * põe numa conta apagada. Nasce aqui, e não com as contas (029), porque lê `lancamentos`.
 */
const contaSoArquiva = `
  CREATE TRIGGER contas_com_lancamento_so_arquiva BEFORE UPDATE OF apagado_em ON contas
    WHEN NEW.apagado_em IS NOT NULL AND EXISTS (SELECT 1 FROM lancamentos WHERE conta_id = NEW.id)
  BEGIN
    SELECT RAISE(ABORT, 'conta com lançamento só arquiva');
  END;
`;

/**
 * Lançamento que veio de extrato só sai da lixeira quando você esvazia (a limpeza automática pula,
 * banco/lixeira.ts), e sair dela de vez grava a lápide. Lançamento vivo apagado de vez (desfazer a
 * importação) não deixa lápide: a importação desfeita pode entrar de novo.
 */
const lapideAoEsvaziar = `
  CREATE TRIGGER lancamentos_importados_deixam_lapide AFTER DELETE ON lancamentos
    WHEN OLD.apagado_em IS NOT NULL AND (OLD.origem = 'importacao' OR OLD.importacao_id IS NOT NULL)
  BEGIN
    INSERT INTO importacao_lapides (id, conta_id, impressao, id_externo)
    VALUES (OLD.id, OLD.conta_id, OLD.impressao, OLD.id_externo);
  END;
`;

/** Os índices do ADR-0042 e um em toda coluna-filha de chave estrangeira. */
const indices = `
  CREATE INDEX lancamentos_conta_id_data ON lancamentos (conta_id, data);
  CREATE INDEX lancamentos_impressao ON lancamentos (impressao);
  CREATE INDEX lancamentos_conta_id_id_externo ON lancamentos (conta_id, id_externo) WHERE id_externo IS NOT NULL;
  CREATE INDEX lancamentos_categoria_id ON lancamentos (categoria_id) WHERE categoria_id IS NOT NULL;
  CREATE INDEX lancamentos_fatura_id ON lancamentos (fatura_id) WHERE fatura_id IS NOT NULL;
  CREATE INDEX lancamentos_importacao_id ON lancamentos (importacao_id) WHERE importacao_id IS NOT NULL;
  CREATE INDEX lancamentos_compra_id ON lancamentos (compra_id) WHERE compra_id IS NOT NULL;
  CREATE INDEX lancamentos_transferencia_id ON lancamentos (transferencia_id) WHERE transferencia_id IS NOT NULL;
  CREATE INDEX importacoes_arquivo_hash ON importacoes (arquivo_hash);
  CREATE INDEX importacao_lapides_impressao ON importacao_lapides (impressao);
  CREATE INDEX importacao_lapides_conta_id_id_externo ON importacao_lapides (conta_id, id_externo) WHERE id_externo IS NOT NULL;
`;

export const m030: Migracao = {
  versao: 30,
  nome: "lancamentos",
  sql: [faturas, importacoes, lancamentos, lapides, contaSoArquiva, lapideAoEsvaziar, indices].join("\n"),
};
