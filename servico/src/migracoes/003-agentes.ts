import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * Agentes, provedores, execuções, aprovações e conversas (DATA.md §6), com os quatro agentes de
 * fábrica já no banco.
 *
 * As colunas de origem (`agente_id`, `execucao_id`) dizem quem criou ou mudou a linha por último
 * e mudam quando o usuário mexe nela. Por isso o vínculo de domínio que o DATA.md chama de
 * `agente_id` ou `execucao_id` (de quem é a execução, com quem é a conversa, quem pediu a
 * aprovação) tem coluna própria, `do_agente_id` e `da_execucao_id`, que não some quando o
 * usuário aprova, desfaz ou apaga. Pelo mesmo motivo a `origem` das aprovações virou `fonte`.
 *
 * Toda chave estrangeira fica em NO ACTION: agentes, provedores, conversas e regras têm lixeira,
 * e a limpeza dos 30 dias não pode apagar nem mudar linha viva (lixeira.test.ts).
 */

/** As colunas de origem apontam para quem existe: agente e execução de verdade. */
const ORIGEM_REFERENCIADA = [
  "FOREIGN KEY (agente_id) REFERENCES agentes (id)",
  "FOREIGN KEY (execucao_id) REFERENCES execucoes (id)",
] as const;

const lista = (coluna: string) =>
  `${coluna} TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(${coluna}) AND json_type(${coluna}) = 'array')`;

/** Credencial é o nome no Gerenciador de Credenciais, nunca a chave (DATA.md §1). */
const provedores = criarTabela(
  "provedores",
  [
    `tipo TEXT NOT NULL CHECK (tipo IN ('claude-cli', 'codex-cli', 'gemini-cli', 'opencode-cli', 'anthropic', 'openai', 'openai-compativel', 'gemini'))`,
    "nome TEXT NOT NULL",
    "modelo TEXT",
    "base_url TEXT",
    "credencial TEXT",
    "testado_em TEXT",
  ],
  { lixeira: true, restricoes: ORIGEM_REFERENCIADA },
);

const agentes = criarTabela(
  "agentes",
  [
    "nome TEXT NOT NULL",
    "funcao TEXT NOT NULL",
    "instrucoes TEXT NOT NULL DEFAULT ''",
    "personagem TEXT NOT NULL CHECK (json_valid(personagem) AND json_type(personagem) = 'object')",
    lista("ferramentas"),
    "provedor_id TEXT REFERENCES provedores (id)",
    "provedor_reserva_id TEXT REFERENCES provedores (id)",
    lista("gatilhos"),
    lista("escopos_memoria"),
    "teto_diario_centavos INTEGER CHECK (teto_diario_centavos IS NULL OR teto_diario_centavos >= 0)",
    "estado TEXT NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'pausado', 'dormindo', 'desligado'))",
    "dorme_ate TEXT",
    "de_fabrica INTEGER NOT NULL DEFAULT 0 CHECK (de_fabrica IN (0, 1))",
  ],
  {
    lixeira: true,
    restricoes: [
      ...ORIGEM_REFERENCIADA,
      "CHECK (provedor_reserva_id IS NULL OR provedor_reserva_id <> provedor_id)",
      "CHECK (dorme_ate IS NULL OR estado = 'dormindo')",
      // De fábrica não se apaga: volta ao padrão (AGENTS.md §1).
      "CHECK (de_fabrica = 0 OR apagado_em IS NULL)",
    ],
  },
);

/** Cada vez que um agente trabalha. `rodando` existe para as chamadas e as falas apontarem para ela. */
const execucoes = criarTabela(
  "execucoes",
  [
    "do_agente_id TEXT NOT NULL REFERENCES agentes (id)",
    "gatilho TEXT NOT NULL CHECK (gatilho IN ('mensagem', 'horario', 'intervalo', 'evento'))",
    "provedor_id TEXT REFERENCES provedores (id)",
    "inicio TEXT",
    "fim TEXT",
    "estado TEXT NOT NULL CHECK (estado IN ('rodando', 'ok', 'erro', 'adiada'))",
    "erro TEXT",
    "tokens_entrada INTEGER CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0)",
    "tokens_saida INTEGER CHECK (tokens_saida IS NULL OR tokens_saida >= 0)",
    // Vazio quando não há custo honesto a mostrar (assinatura, modelo sem preço conhecido).
    "custo_estimado_microdolares INTEGER CHECK (custo_estimado_microdolares IS NULL OR custo_estimado_microdolares >= 0)",
    "resumo TEXT",
  ],
  { lixeira: false, restricoes: ORIGEM_REFERENCIADA },
);

/** Regras de permissão: "sempre neste projeto" e as autorizações dadas uma vez. */
const regrasPermissao = criarTabela(
  "regras_permissao",
  [
    "escopo TEXT NOT NULL CHECK (escopo IN ('projeto', 'agente', 'conexao'))",
    // `projetos` nasce na migração 004: a referência fica sem chave estrangeira.
    "projeto_id TEXT",
    "do_agente_id TEXT REFERENCES agentes (id)",
    "ferramenta TEXT NOT NULL",
    "padrao TEXT NOT NULL",
    "decisao TEXT NOT NULL CHECK (decisao IN ('permitir', 'negar'))",
    "expira_em TEXT",
  ],
  {
    lixeira: true,
    restricoes: [
      ...ORIGEM_REFERENCIADA,
      "CHECK (escopo <> 'projeto' OR projeto_id IS NOT NULL)",
      "CHECK (escopo <> 'agente' OR do_agente_id IS NOT NULL)",
    ],
  },
);

/**
 * Pedidos de aprovação, do Moductus e das sessões externas (`fonte`: `moductus`, `claude-code`,
 * `codex`…). Sem execução nem agente quando o pedido vem de uma sessão do terminal.
 */
const aprovacoes = criarTabela(
  "aprovacoes",
  [
    "da_execucao_id TEXT REFERENCES execucoes (id)",
    "do_agente_id TEXT REFERENCES agentes (id)",
    "fonte TEXT NOT NULL",
    // `sessoes_ia` nasce na migração 004: a referência fica sem chave estrangeira.
    "sessao_id TEXT",
    "descricao TEXT NOT NULL",
    "acao TEXT NOT NULL CHECK (json_valid(acao))",
    "estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aprovada', 'negada', 'expirada'))",
    "decidida_em TEXT",
    "regra_criada_id TEXT REFERENCES regras_permissao (id)",
  ],
  {
    lixeira: false,
    restricoes: [...ORIGEM_REFERENCIADA, "CHECK (estado <> 'pendente' OR decidida_em IS NULL)"],
  },
);

const chamadasFerramenta = criarTabela(
  "chamadas_ferramenta",
  [
    // Vazio só quando quem chama vem de fora do Moductus (MCP aberto, fase 5).
    "da_execucao_id TEXT REFERENCES execucoes (id)",
    "ferramenta TEXT NOT NULL",
    "efeito TEXT NOT NULL CHECK (efeito IN ('leitura', 'interno', 'externo'))",
    "entrada TEXT NOT NULL CHECK (json_valid(entrada))",
    "resultado TEXT CHECK (resultado IS NULL OR json_valid(resultado))",
    "aprovacao_id TEXT REFERENCES aprovacoes (id)",
    "desfeita_em TEXT",
  ],
  { lixeira: false, restricoes: ORIGEM_REFERENCIADA },
);

/** Conversa com o time (uma só) ou com um agente. */
const conversas = criarTabela(
  "conversas",
  [
    "tipo TEXT NOT NULL CHECK (tipo IN ('time', 'agente'))",
    "do_agente_id TEXT REFERENCES agentes (id)",
    "titulo TEXT",
    "arquivada INTEGER NOT NULL DEFAULT 0 CHECK (arquivada IN (0, 1))",
  ],
  {
    lixeira: true,
    restricoes: [...ORIGEM_REFERENCIADA, "CHECK ((tipo = 'agente') = (do_agente_id IS NOT NULL))"],
  },
);

/**
 * O autor é `do_agente_id`; vazio, é o usuário. A data da fala é o `criado_em`. Quem apaga a
 * conversa manda as mensagens junto para a lixeira: mensagem viva segura a conversa na limpeza.
 */
const mensagens = criarTabela(
  "mensagens",
  [
    "conversa_id TEXT NOT NULL REFERENCES conversas (id)",
    "do_agente_id TEXT REFERENCES agentes (id)",
    "conteudo TEXT NOT NULL",
    lista("anexos"),
    "da_execucao_id TEXT REFERENCES execucoes (id)",
  ],
  {
    lixeira: true,
    restricoes: [...ORIGEM_REFERENCIADA, "CHECK (do_agente_id IS NOT NULL OR da_execucao_id IS NULL)"],
  },
);

/** Índices das consultas do dia a dia e das chaves que a limpeza confere ao apagar o pai. */
const indices = `
  CREATE INDEX agentes_provedor_id ON agentes (provedor_id);
  CREATE INDEX agentes_provedor_reserva_id ON agentes (provedor_reserva_id);
  CREATE INDEX execucoes_do_agente_id ON execucoes (do_agente_id, inicio);
  CREATE INDEX execucoes_provedor_id ON execucoes (provedor_id);
  CREATE INDEX regras_permissao_do_agente_id ON regras_permissao (do_agente_id);
  CREATE INDEX aprovacoes_pendentes ON aprovacoes (criado_em) WHERE estado = 'pendente';
  CREATE INDEX aprovacoes_da_execucao_id ON aprovacoes (da_execucao_id);
  CREATE INDEX aprovacoes_regra_criada_id ON aprovacoes (regra_criada_id);
  CREATE INDEX chamadas_ferramenta_da_execucao_id ON chamadas_ferramenta (da_execucao_id);
  CREATE INDEX chamadas_ferramenta_aprovacao_id ON chamadas_ferramenta (aprovacao_id);
  CREATE INDEX conversas_do_agente_id ON conversas (do_agente_id);
  CREATE INDEX mensagens_conversa_id ON mensagens (conversa_id, criado_em);
  CREATE INDEX mensagens_da_execucao_id ON mensagens (da_execucao_id);
`;

/**
 * Os quatro de fábrica (AGENTS.md §2, DESIGN.md §6). O id é o mesmo nome curto que a interface já
 * usa (`alba`, `tula`, `faina`, `nuno`) e é igual em todo PC, para juntar dados de outro PC sem
 * duplicar o time. Sem provedor: o primeiro uso conecta um modelo e o atribui aos quatro. Os
 * gatilhos ficam vazios até o agendador definir o formato deles.
 */
const deFabrica = `
  INSERT INTO agentes (id, nome, funcao, instrucoes, personagem, ferramentas, escopos_memoria, de_fabrica) VALUES
  ('alba', 'Alba', 'Cuida do seu dia',
   'Você é a Alba e cuida do dia a dia: agenda, tarefas, lembretes, rotina e foco. Mensagem sem destinatário claro vem para você.',
   '{"silhueta":"ovo","traco":"raios","tom":"ambar"}',
   '["agenda.*","tarefas.*","lembretes.*","foco.*","notas.*","memoria.*"]',
   '["dia","geral"]', 1),
  ('tula', 'Tula', 'Cuida do seu dinheiro',
   'Você é a Tula e cuida do dinheiro: gastos, dívidas, planos e orçamento. Organiza e calcula; nunca paga, transfere, acessa banco ou recomenda investimento. A decisão é do usuário.',
   '{"silhueta":"pera","traco":"coque","tom":"musgo"}',
   '["financas.*","dividas.*","planos.*","arquivos.ler_texto","memoria.*"]',
   '["financas"]', 1),
  ('faina', 'Faina', 'Faz o serviço pesado',
   'Você é a Faina e cuida dos arquivos e das tarefas trabalhosas no PC, sempre em plano, prévia, aprovação, execução e registro. Só mexe nas pastas autorizadas, nunca toca em nada do sistema e nunca apaga de vez: tudo vai para a Lixeira.',
   '{"silhueta":"bloco","traco":"bandana","tom":"terracota"}',
   '["arquivos.*","documentos.*","ocr.ler","memoria.*"]',
   '["arquivos","geral"]', 1),
  ('nuno', 'Nuno', 'Fica de olho nas suas IAs e no seu código',
   'Você é o Nuno e acompanha as sessões de agentes de código e o trabalho no GitHub. Comentar, aprovar PR ou responder pedido de permissão só com cartão de aprovação ou regra criada pelo usuário.',
   '{"silhueta":"capsula","traco":"fones","tom":"ardosia"}',
   '["sessoes.*","uso.*","github.*","tarefas.criar"]',
   '["dev","geral"]', 1);
`;

export const m003: Migracao = {
  versao: 3,
  nome: "agentes",
  sql: [
    provedores,
    agentes,
    execucoes,
    regrasPermissao,
    aprovacoes,
    chamadasFerramenta,
    conversas,
    mensagens,
    indices,
    deFabrica,
  ].join("\n"),
};
