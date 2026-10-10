import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * Dev e sessões de IA (DATA.md §5) e as conexões (DATA.md §7): o que o Nuno acompanha.
 *
 * Mesmas regras de chave da 003 (lixeira.test.ts): o carimbo de origem não tem chave, e nenhuma
 * chave aponta para tabela com lixeira. `projetos` e `conexoes` vão para a lixeira; sessões, uso
 * e o cache do GitHub são histórico e guardam o id do projeto como texto. A única chave é
 * `eventos_sessao` → `sessoes_ia`, que não tem lixeira.
 *
 * A data do evento é o `criado_em`, como a das mensagens da 003: o `recebido_em` do DATA.md não
 * vira coluna.
 */

const FERRAMENTAS = ["claude-code", "codex", "opencode", "gemini", "antigravity"];
const umaDas = (coluna: string, valores: readonly string[]) =>
  `CHECK (${coluna} IN (${valores.map((v) => `'${v}'`).join(", ")}))`;
const naoNegativo = (coluna: string) => `${coluna} INTEGER CHECK (${coluna} IS NULL OR ${coluna} >= 0)`;

/** Pastas onde rodam sessões, reconhecidas pelo `cwd` dos eventos. */
const projetos = criarTabela(
  "projetos",
  [
    "nome TEXT NOT NULL",
    "caminho TEXT NOT NULL",
    // `dono/nome` no GitHub, quando há.
    "repositorio TEXT",
    "arquivado INTEGER NOT NULL DEFAULT 0 CHECK (arquivado IN (0, 1))",
  ],
  { lixeira: true },
);

/** Uma sessão de agente de código, achada pelo session id da ferramenta (`id_externo`). */
const sessoesIa = criarTabela(
  "sessoes_ia",
  [
    // `projetos` tem lixeira: a referência fica sem chave estrangeira.
    "projeto_id TEXT",
    `ferramenta TEXT NOT NULL ${umaDas("ferramenta", FERRAMENTAS)}`,
    "id_externo TEXT NOT NULL",
    "modelo TEXT",
    `estado TEXT NOT NULL ${umaDas("estado", ["trabalhando", "esperando", "terminou", "erro", "parada"])}`,
    "iniciada_em TEXT",
    "ultimo_evento_em TEXT",
    "encerrada_em TEXT",
    naoNegativo("contexto_usado_tokens"),
    naoNegativo("contexto_janela_tokens"),
    // Caminho deste PC: nunca vai para outro (DATA.md §8).
    "transcript_caminho TEXT",
  ],
  { lixeira: false, restricoes: ["UNIQUE (ferramenta, id_externo)"] },
);

/** O resumo de cada hook recebido; o conteúdo inteiro continua no transcript da ferramenta. */
const eventosSessao = criarTabela(
  "eventos_sessao",
  [
    "sessao_id TEXT NOT NULL REFERENCES sessoes_ia (id)",
    // Nome do hook (`PreToolUse`, `Stop`…).
    "tipo TEXT NOT NULL",
    "ferramenta_usada TEXT",
    "entrada_resumo TEXT",
  ],
  { lixeira: false },
);

/**
 * Gasto e limites por dia, ferramenta, modelo e projeto. Custo vazio quando não há número
 * honesto; `fonte` diz se o número veio da ferramenta ou é estimativa do Moductus.
 */
const usoIa = criarTabela(
  "uso_ia",
  [
    "dia TEXT NOT NULL CHECK (dia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')",
    `ferramenta TEXT NOT NULL ${umaDas("ferramenta", FERRAMENTAS)}`,
    "modelo TEXT",
    "projeto_id TEXT",
    "tokens_entrada INTEGER NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0)",
    "tokens_saida INTEGER NOT NULL DEFAULT 0 CHECK (tokens_saida >= 0)",
    "tokens_cache INTEGER NOT NULL DEFAULT 0 CHECK (tokens_cache >= 0)",
    naoNegativo("custo_estimado_microdolares"),
    `fonte TEXT NOT NULL ${umaDas("fonte", ["ferramenta", "estimativa"])}`,
  ],
  { lixeira: false },
);

/** Cache do que o Nuno acompanha no GitHub. PR e issue dividem a numeração do repositório. */
const githubItens = criarTabela(
  "github_itens",
  [
    "repositorio TEXT NOT NULL",
    "numero INTEGER NOT NULL CHECK (numero > 0)",
    `tipo TEXT NOT NULL ${umaDas("tipo", ["pr", "issue"])}`,
    "titulo TEXT NOT NULL",
    "autor TEXT",
    "estado TEXT NOT NULL",
    `meu_papel TEXT NOT NULL ${umaDas("meu_papel", ["autor", "revisor", "atribuido"])}`,
    "precisa_de_mim INTEGER NOT NULL DEFAULT 0 CHECK (precisa_de_mim IN (0, 1))",
    "ci_estado TEXT",
    "atualizado_no_github TEXT",
    "etag TEXT",
    "url TEXT NOT NULL",
  ],
  { lixeira: false, restricoes: ["UNIQUE (repositorio, numero)"] },
);

/**
 * Contas e ligações (Google Agenda, GitHub, hooks do Claude Code…). Credencial é o nome no
 * Gerenciador de Credenciais, nunca a chave, e não vai para outro PC (DATA.md §1, §8). Os
 * estados possíveis chegam com a tela de conexões: por ora, texto sem lista fechada.
 */
const conexoes = criarTabela(
  "conexoes",
  [
    "tipo TEXT NOT NULL",
    "conta TEXT",
    "escopos TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(escopos) AND json_type(escopos) = 'array')",
    "credencial TEXT",
    "estado TEXT NOT NULL",
    "ultimo_erro TEXT",
    "conectada_em TEXT",
  ],
  { lixeira: true },
);

/**
 * Índice na coluna-filha da chave estrangeira e nos caminhos de consulta: o projeto pelo `cwd`
 * (uma pasta, um projeto vivo; o Windows não diferencia maiúsculas), as sessões do projeto, o
 * uso agregado (uma linha por dia, ferramenta, modelo e projeto, com vazio contando como valor)
 * e o que precisa do usuário no GitHub.
 */
const indices = `
  CREATE UNIQUE INDEX projetos_caminho ON projetos (caminho COLLATE NOCASE) WHERE apagado_em IS NULL;
  CREATE INDEX sessoes_ia_projeto_id ON sessoes_ia (projeto_id, ultimo_evento_em);
  CREATE INDEX eventos_sessao_sessao_id ON eventos_sessao (sessao_id, criado_em);
  CREATE UNIQUE INDEX uso_ia_chave ON uso_ia (dia, ferramenta, coalesce(modelo, ''), coalesce(projeto_id, ''));
  CREATE INDEX github_itens_precisa_de_mim ON github_itens (atualizado_no_github) WHERE precisa_de_mim = 1;
`;

export const m004: Migracao = {
  versao: 4,
  nome: "sessoes-dev",
  sql: [projetos, sessoesIa, eventosSessao, usoIa, githubItens, conexoes, indices].join("\n"),
};
