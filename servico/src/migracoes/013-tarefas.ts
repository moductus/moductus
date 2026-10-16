import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela, FORMATO_DATA_GLOB } from "../banco/tabela.ts";

/**
 * Tarefas e lembretes da Alba (DATA.md §2): listas, tarefas, etiquetas e lembretes, com as três
 * listas padrão já no banco.
 *
 * Listas, tarefas, etiquetas e lembretes vão para a lixeira. Chaves, como manda o DATA.md §1
 * (lixeira.test.ts): só de filha com lixeira que vai junto com o pai, todas em NO ACTION, para a
 * limpeza não apagar linha viva. São três: `tarefas.lista_id` → `listas`, `tarefas.tarefa_pai_id`
 * → `tarefas` (a subtarefa vai com a tarefa) e `lembretes.tarefa_id` → `tarefas` (o lembrete da
 * tarefa vai com ela). `evento_id` e `nota_id` apontam para tabelas que nascem depois (eventos e
 * notas) e guardam o id como texto.
 *
 * Listas e etiquetas são configuração; tarefas, a ligação com as etiquetas e lembretes são dado
 * (outro-pc/tabelas.ts).
 */

const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const marca = (coluna: string) => `${coluna} INTEGER NOT NULL DEFAULT 0 CHECK (${coluna} IN (0, 1))`;
const instante = (coluna: string) => `${coluna} IS NULL OR ${coluna} GLOB '${FORMATO_DATA_GLOB}'`;

const listas = criarTabela(
  "listas",
  ["nome TEXT NOT NULL", "ordem INTEGER NOT NULL DEFAULT 0", "cor TEXT", marca("arquivada")],
  { lixeira: true },
);

/**
 * `vence_em` é o dia (`AAAA-MM-DD`) e `hora` a hora do dia no fuso do usuário (`HH:MM`), que só
 * existe com o dia. `concluida_em` é de quem foi feita; tarefa aberta não tem. Subtarefa é de um
 * nível só (gatilhos abaixo). `notas` é o texto curto da própria tarefa; `nota_id`, a nota ligada.
 */
const tarefas = criarTabela(
  "tarefas",
  [
    "lista_id TEXT NOT NULL REFERENCES listas (id)",
    "tarefa_pai_id TEXT REFERENCES tarefas (id)",
    "titulo TEXT NOT NULL",
    "notas TEXT",
    // `notas` nasce depois, com lixeira: a referência fica sem chave estrangeira.
    "nota_id TEXT",
    "prioridade INTEGER NOT NULL DEFAULT 0 CHECK (prioridade BETWEEN 0 AND 3)",
    "vence_em TEXT CHECK (vence_em IS NULL OR vence_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')",
    "hora TEXT CHECK (hora IS NULL OR (hora GLOB '[0-2][0-9]:[0-5][0-9]' AND hora < '24:00'))",
    "duracao_estimada_min INTEGER CHECK (duracao_estimada_min IS NULL OR duracao_estimada_min > 0)",
    // RRULE do iCalendar.
    "recorrencia TEXT",
    `estado TEXT NOT NULL DEFAULT 'aberta' ${umaDas("estado", ["aberta", "feita", "cancelada"])}`,
    `concluida_em TEXT CHECK (${instante("concluida_em")})`,
    "ordem INTEGER NOT NULL DEFAULT 0",
    // `eventos` nasce depois: a referência fica sem chave estrangeira.
    "evento_id TEXT",
  ],
  {
    lixeira: true,
    restricoes: [
      "CHECK (hora IS NULL OR vence_em IS NOT NULL)",
      "CHECK (estado <> 'aberta' OR concluida_em IS NULL)",
      "CHECK (estado <> 'feita' OR concluida_em IS NOT NULL)",
      "CHECK (tarefa_pai_id IS NULL OR tarefa_pai_id <> id)",
    ],
  },
);

/**
 * Etiquetas livres (`trabalho`, `casa`, `pr-123`); o nome não se repete entre as vivas, sem
 * diferença de caixa nem de espaço nas pontas. `nome_chave` é o nome normalizado, que o serviço
 * grava (banco/nome-chave.ts): o `COLLATE NOCASE` do SQLite só iguala A-Z e deixaria passar
 * `Ônibus` ao lado de `ônibus`.
 */
const etiquetas = criarTabela("etiquetas", ["nome TEXT NOT NULL", "nome_chave TEXT NOT NULL"], {
  lixeira: true,
});

/**
 * Muitos para muitos, sem lixeira. Tarefas e etiquetas têm lixeira, então a ligação não tem chave
 * (DATA.md §1): enquanto uma das duas está na lixeira, a ligação fica, para voltar junto; quando
 * uma delas some de vez, os gatilhos abaixo levam a ligação.
 */
const tarefaEtiquetas = criarTabela(
  "tarefa_etiquetas",
  ["tarefa_id TEXT NOT NULL", "etiqueta_id TEXT NOT NULL"],
  { lixeira: false, restricoes: ["UNIQUE (tarefa_id, etiqueta_id)"] },
);

/**
 * O que dispara: ligado a uma tarefa, a um evento ou a nada ("beber água às 15h"). `quando` e
 * `adiado_ate` são instantes em UTC no formato das datas, que o relógio compara como texto.
 * `perdido` é o que venceu com o PC desligado ou suspenso.
 */
const lembretes = criarTabela(
  "lembretes",
  [
    "texto TEXT NOT NULL",
    `quando TEXT NOT NULL CHECK (${instante("quando")})`,
    // RRULE do iCalendar.
    "recorrencia TEXT",
    "tarefa_id TEXT REFERENCES tarefas (id)",
    // `eventos` nasce depois: a referência fica sem chave estrangeira.
    "evento_id TEXT",
    `estado TEXT NOT NULL DEFAULT 'agendado' ${umaDas("estado", ["agendado", "disparado", "adiado", "perdido"])}`,
    `disparado_em TEXT CHECK (${instante("disparado_em")})`,
    `adiado_ate TEXT CHECK (${instante("adiado_ate")})`,
    `canal TEXT NOT NULL DEFAULT 'windows' ${umaDas("canal", ["dock", "windows", "calendario"])}`,
  ],
  {
    lixeira: true,
    restricoes: [
      "CHECK ((estado = 'adiado') = (adiado_ate IS NOT NULL))",
      "CHECK (estado <> 'disparado' OR disparado_em IS NOT NULL)",
    ],
  },
);

/**
 * Subtarefa de um nível (DATA.md §2): a mãe não pode ser subtarefa, e tarefa com subtarefas não
 * vira subtarefa. No banco, para nenhum caminho de escrita (importação, outro PC) passar por cima.
 * O de INSERT também olha as filhas: o `INSERT OR REPLACE` reescreve uma mãe que já tem filhas, e a
 * importação com as chaves adiadas pode gravar a neta antes da filha.
 */
const umNivel = `
  CREATE TRIGGER tarefas_subtarefa_de_um_nivel BEFORE INSERT ON tarefas
    WHEN NEW.tarefa_pai_id IS NOT NULL
      AND ((SELECT tarefa_pai_id FROM tarefas WHERE id = NEW.tarefa_pai_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM tarefas WHERE tarefa_pai_id = NEW.id))
  BEGIN
    SELECT RAISE(ABORT, 'subtarefa só tem um nível');
  END;
  CREATE TRIGGER tarefas_subtarefa_de_um_nivel_ao_mudar BEFORE UPDATE OF tarefa_pai_id ON tarefas
    WHEN NEW.tarefa_pai_id IS NOT NULL
      AND ((SELECT tarefa_pai_id FROM tarefas WHERE id = NEW.tarefa_pai_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM tarefas WHERE tarefa_pai_id = NEW.id))
  BEGIN
    SELECT RAISE(ABORT, 'subtarefa só tem um nível');
  END;
`;

/** A ligação some com a tarefa ou a etiqueta que saiu de vez (limpeza da lixeira). */
const ligacaoSaiJunto = `
  CREATE TRIGGER tarefa_etiquetas_sai_com_a_tarefa AFTER DELETE ON tarefas
  BEGIN
    DELETE FROM tarefa_etiquetas WHERE tarefa_id = OLD.id;
  END;
  CREATE TRIGGER tarefa_etiquetas_sai_com_a_etiqueta AFTER DELETE ON etiquetas
  BEGIN
    DELETE FROM tarefa_etiquetas WHERE etiqueta_id = OLD.id;
  END;
`;

/**
 * Índice em toda coluna-filha de chave estrangeira e de ligação, e nos caminhos de consulta do dia:
 * as abertas por dia (hoje e atrasadas), a chave do nome da etiqueta viva (única) e o próximo
 * lembrete a disparar.
 */
const indices = `
  CREATE INDEX tarefas_lista_id ON tarefas (lista_id, ordem);
  CREATE INDEX tarefas_tarefa_pai_id ON tarefas (tarefa_pai_id, ordem) WHERE tarefa_pai_id IS NOT NULL;
  CREATE INDEX tarefas_abertas_vence_em ON tarefas (vence_em) WHERE estado = 'aberta' AND apagado_em IS NULL;
  CREATE UNIQUE INDEX etiquetas_nome_chave ON etiquetas (nome_chave) WHERE apagado_em IS NULL;
  CREATE INDEX tarefa_etiquetas_etiqueta_id ON tarefa_etiquetas (etiqueta_id);
  CREATE INDEX lembretes_tarefa_id ON lembretes (tarefa_id) WHERE tarefa_id IS NOT NULL;
  CREATE INDEX lembretes_proximo ON lembretes (coalesce(adiado_ate, quando))
    WHERE estado IN ('agendado', 'adiado') AND apagado_em IS NULL;
`;

/**
 * As três listas padrão (DATA.md §2). Id fixo, igual em todo PC, como os agentes de fábrica: juntar
 * dados de outro PC não duplica as listas. A Entrada é para onde vai a captura sem lista.
 */
const padroes = `
  INSERT INTO listas (id, nome, ordem) VALUES
  ('entrada', 'Entrada', 0),
  ('trabalho', 'Trabalho', 1),
  ('pessoal', 'Pessoal', 2);
`;

export const m013: Migracao = {
  versao: 13,
  nome: "tarefas",
  sql: [
    listas,
    tarefas,
    etiquetas,
    tarefaEtiquetas,
    lembretes,
    umNivel,
    ligacaoSaiJunto,
    indices,
    padroes,
  ].join("\n"),
};
