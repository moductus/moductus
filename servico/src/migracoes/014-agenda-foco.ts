import type { Migracao } from "../banco/migracoes.ts";
import { AGORA_SQL, criarTabela, FORMATO_DATA_GLOB } from "../banco/tabela.ts";

/**
 * Agenda, foco e rotinas da Alba (DATA.md §2, ADR-0035, ADR-0039): calendários, eventos, a fila de
 * saída para o Google, sessões de foco, rotinas e o registro de cada vez que uma rotina apareceu.
 * O calendário local e as duas rotinas (briefing e fechamento) já nascem no banco.
 *
 * Calendários, eventos e rotinas vão para a lixeira. A única chave é `eventos.calendario_id` →
 * `calendarios`, de filha com lixeira que vai junto com o pai, em NO ACTION (DATA.md §1,
 * lixeira.test.ts). Sessões de foco e o registro das rotinas são histórico, sem lixeira, e guardam
 * o id da tarefa e da rotina como texto.
 *
 * Calendários e rotinas são configuração; eventos e sessões de foco, dado, e o evento vindo do
 * Google não sai deste PC (é cache, a fonte é o Google); a fila de saída e o registro das rotinas
 * são deste PC (outro-pc/tabelas.ts).
 */

const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const marca = (coluna: string, padrao: 0 | 1 = 0) =>
  `${coluna} INTEGER NOT NULL DEFAULT ${padrao} CHECK (${coluna} IN (0, 1))`;
const ehInstante = (coluna: string) => `${coluna} GLOB '${FORMATO_DATA_GLOB}'`;
const instante = (coluna: string) => `${coluna} IS NULL OR ${ehInstante(coluna)}`;
const ehDia = (coluna: string) => `${coluna} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;
const lista = (coluna: string, padrao: string) =>
  `${coluna} TEXT NOT NULL DEFAULT '${padrao}' CHECK (json_valid(${coluna}) AND json_type(${coluna}) = 'array')`;

/**
 * As fontes de evento: o local, o "Moductus" criado no Google Agenda (`espelho`, onde a Alba
 * escreve sem pedir) e os calendários que o usuário escolheu ler (`ler`). `fonte` é o `origem` do
 * DATA.md §2, que aqui colidiria com o carimbo. Só calendário de fora tem `id_externo`, e só ele
 * guarda o `nextSyncToken` (`token_sincronizacao`) e a última leitura (`sincronizado_em`), que são
 * situação deste PC.
 */
const calendarios = criarTabela(
  "calendarios",
  [
    "nome TEXT NOT NULL",
    `fonte TEXT NOT NULL ${umaDas("fonte", ["local", "google", "outlook"])}`,
    "id_externo TEXT",
    "cor TEXT",
    marca("espelho"),
    marca("pode_escrever"),
    marca("ler", 1),
    `sincronizado_em TEXT CHECK (${instante("sincronizado_em")})`,
    "token_sincronizacao TEXT",
  ],
  {
    lixeira: true,
    restricoes: [
      "CHECK ((fonte = 'local') = (id_externo IS NULL))",
      "CHECK (fonte <> 'local' OR (espelho = 0 AND token_sincronizacao IS NULL AND sincronizado_em IS NULL))",
    ],
  },
);

/**
 * Evento com hora guarda `inicio` e `fim` como instantes em UTC no formato das datas; o de dia
 * inteiro, como dia (`AAAA-MM-DD`), com o `fim` no dia seguinte ao último, como o iCalendar e o
 * Google. `alertas` são os minutos antes de cada aviso. O evento do Google fica aqui em cache,
 * com `id_externo` e `etag_externo`, para o briefing e o horário livre.
 */
const eventos = criarTabela(
  "eventos",
  [
    "calendario_id TEXT NOT NULL REFERENCES calendarios (id)",
    "titulo TEXT NOT NULL",
    "descricao TEXT",
    "inicio TEXT NOT NULL",
    "fim TEXT NOT NULL",
    marca("dia_inteiro"),
    "local TEXT",
    // RRULE do iCalendar.
    "recorrencia TEXT",
    "id_externo TEXT",
    "etag_externo TEXT",
    lista("alertas", "[]"),
  ],
  {
    lixeira: true,
    restricoes: [
      `CHECK (dia_inteiro = 1 OR (${ehInstante("inicio")} AND ${ehInstante("fim")}))`,
      `CHECK (dia_inteiro = 0 OR (${ehDia("inicio")} AND ${ehDia("fim")} AND fim > inicio))`,
      "CHECK (fim >= inicio)",
      "CHECK (etag_externo IS NULL OR id_externo IS NOT NULL)",
    ],
  },
);

/**
 * Toda escrita no Google passa por aqui (ADR-0035): uma linha por item, que a nova substitui
 * enquanto está pendente e que sai quando o envio dá certo. `item_tipo` e `item_id` dizem o que
 * vai (a tarefa com hora, o lembrete ou o evento); sem chave estrangeira, porque os três têm
 * lixeira e apagar no Google é justamente o que fica na fila.
 */
const agendaSaida = criarTabela(
  "agenda_saida",
  [
    `item_tipo TEXT NOT NULL ${umaDas("item_tipo", ["tarefa", "lembrete", "evento"])}`,
    "item_id TEXT NOT NULL",
    `operacao TEXT NOT NULL ${umaDas("operacao", ["criar", "mudar", "apagar"])}`,
    "tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0)",
    `proxima_tentativa_em TEXT NOT NULL DEFAULT (${AGORA_SQL}) CHECK (${ehInstante("proxima_tentativa_em")})`,
    "ultimo_erro TEXT",
  ],
  { lixeira: false, restricoes: ["UNIQUE (item_tipo, item_id)"] },
);

/**
 * Uma etapa do ciclo: foco, pausa ou pausa longa. `fim` vazio é a etapa em andamento, e só pode
 * haver uma (índice abaixo); a duração real é anotada ao terminar. `interrompida` é a que acabou
 * antes da hora, inclusive a que o serviço fechou ao reiniciar fora do prazo. A tarefa tem lixeira:
 * o histórico guarda o id dela como texto.
 */
const sessoesFoco = criarTabela(
  "sessoes_foco",
  [
    "tarefa_id TEXT",
    `tipo TEXT NOT NULL ${umaDas("tipo", ["foco", "pausa", "pausa_longa"])}`,
    `inicio TEXT NOT NULL CHECK (${ehInstante("inicio")})`,
    `fim TEXT CHECK (${instante("fim")})`,
    "duracao_planejada_min INTEGER NOT NULL CHECK (duracao_planejada_min > 0)",
    "duracao_real_min INTEGER CHECK (duracao_real_min IS NULL OR duracao_real_min >= 0)",
    marca("interrompida"),
  ],
  {
    lixeira: false,
    restricoes: [
      "CHECK (fim IS NULL OR fim >= inicio)",
      "CHECK ((fim IS NULL) = (duracao_real_min IS NULL))",
      "CHECK (interrompida = 0 OR fim IS NOT NULL)",
    ],
  },
);

/**
 * Briefing e fechamento do dia (ADR-0039). `hora` é a hora do dia no fuso do usuário (`HH:MM`);
 * o briefing sem hora sai na primeira atividade do dia, e o fechamento sempre tem hora.
 * `dias_semana` é a lista dos dias em que a rotina vale, de 1 (segunda) a 7 (domingo), como a ISO
 * 8601. O que foi mostrado de cada vez fica em `rotinas_registro`, não aqui.
 */
const rotinas = criarTabela(
  "rotinas",
  [
    `tipo TEXT NOT NULL ${umaDas("tipo", ["briefing", "fechamento"])}`,
    "hora TEXT CHECK (hora IS NULL OR (hora GLOB '[0-2][0-9]:[0-5][0-9]' AND hora < '24:00'))",
    lista("dias_semana", "[1,2,3,4,5,6,7]"),
    marca("ativa", 1),
  ],
  { lixeira: true, restricoes: ["CHECK (tipo <> 'fechamento' OR hora IS NOT NULL)"] },
);

/**
 * Cada vez que uma rotina apareceu (ADR-0039): o dia a que se refere, o que foi mostrado (as
 * linhas e a abertura, em JSON) e a ação escolhida, ou `ignorado` quando fechou sozinha. A data em
 * que apareceu é o `criado_em`. Uma por rotina e dia: a segunda atividade do dia não repete o
 * briefing. Alimenta o "Ontem" e a regra dos 3 dias ignorados. `da_execucao_id` é a execução da
 * Alba que redigiu a abertura; vazio quando saiu a frase de molde.
 */
const rotinasRegistro = criarTabela(
  "rotinas_registro",
  [
    "rotina_id TEXT NOT NULL",
    `dia TEXT NOT NULL CHECK (${ehDia("dia")})`,
    "conteudo TEXT NOT NULL CHECK (json_valid(conteudo) AND json_type(conteudo) = 'object')",
    "acao TEXT",
    `acao_em TEXT CHECK (${instante("acao_em")})`,
    "da_execucao_id TEXT",
  ],
  {
    lixeira: false,
    restricoes: ["UNIQUE (rotina_id, dia)", "CHECK ((acao IS NULL) = (acao_em IS NULL))"],
  },
);

/**
 * Índice na coluna-filha da chave e nos caminhos de consulta: os eventos de um intervalo, o
 * evento do Google pelo id de lá (a leitura incremental), o calendário de fora pelo id de lá e o
 * espelho de cada fonte, o próximo envio da fila, o foco em andamento (um só) e o histórico do dia.
 */
const indices = `
  CREATE INDEX eventos_calendario_id ON eventos (calendario_id, inicio);
  CREATE INDEX eventos_inicio ON eventos (inicio) WHERE apagado_em IS NULL;
  CREATE UNIQUE INDEX eventos_id_externo ON eventos (calendario_id, id_externo) WHERE id_externo IS NOT NULL;
  CREATE UNIQUE INDEX calendarios_id_externo ON calendarios (fonte, id_externo)
    WHERE id_externo IS NOT NULL AND apagado_em IS NULL;
  CREATE UNIQUE INDEX calendarios_espelho ON calendarios (fonte) WHERE espelho = 1 AND apagado_em IS NULL;
  CREATE INDEX agenda_saida_proxima ON agenda_saida (proxima_tentativa_em);
  CREATE UNIQUE INDEX sessoes_foco_em_andamento ON sessoes_foco ((fim IS NULL)) WHERE fim IS NULL;
  CREATE INDEX sessoes_foco_inicio ON sessoes_foco (inicio);
  CREATE INDEX sessoes_foco_tarefa_id ON sessoes_foco (tarefa_id) WHERE tarefa_id IS NOT NULL;
`;

/**
 * O calendário local e as duas rotinas, com id fixo, igual em todo PC, como as listas padrão:
 * juntar dados de outro PC não os duplica. O fechamento sai às 18:00 (AGENTS.md §2) e o briefing,
 * na primeira atividade do dia.
 */
const padroes = `
  INSERT INTO calendarios (id, nome, fonte, pode_escrever) VALUES ('local', 'Local', 'local', 1);
  INSERT INTO rotinas (id, tipo, hora) VALUES
  ('briefing', 'briefing', NULL),
  ('fechamento', 'fechamento', '18:00');
`;

export const m014: Migracao = {
  versao: 14,
  nome: "agenda-foco",
  sql: [calendarios, eventos, agendaSaida, sessoesFoco, rotinas, rotinasRegistro, indices, padroes].join(
    "\n",
  ),
};
