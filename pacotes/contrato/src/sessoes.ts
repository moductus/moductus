import { z } from "zod";
import { Dia, Id, Instante } from "./comum.ts";

/**
 * Dev e sessões de IA, a área do Nuno (AGENTS.md §2 Nuno e §5; DATA.md §5 e §7 conexoes):
 * projetos, sessões dos agentes de código que rodam fora do Moductus, uso, GitHub e as conexões
 * que alimentam tudo isso.
 */

/** Agentes de código acompanhados (DATA.md §5 sessoes_ia.ferramenta). */
export const FERRAMENTAS_SESSAO = ["claude-code", "codex", "opencode", "gemini", "antigravity"] as const;
export const FerramentaSessao = z.enum(FERRAMENTAS_SESSAO);
export type FerramentaSessao = z.infer<typeof FerramentaSessao>;

/** `esperando` é "esperando você"; `parada` é sem evento há muito tempo (AGENTS.md §5). */
export const EstadoSessao = z.enum(["trabalhando", "esperando", "terminou", "erro", "parada"]);
export type EstadoSessao = z.infer<typeof EstadoSessao>;

/** Pasta onde rodam sessões, reconhecida pelo `cwd` dos eventos. */
export const Projeto = z.object({
  id: Id,
  nome: z.string().min(1),
  caminho: z.string().min(1),
  /** `dono/nome` no GitHub, quando há. */
  repositorio: z.string().nullable(),
  arquivado: z.boolean(),
});
export type Projeto = z.infer<typeof Projeto>;

/** Um evento de hook, só com o resumo: o conteúdo continua no transcript da ferramenta. */
export const EventoSessao = z.object({
  id: Id,
  sessaoId: Id,
  /** Nome do hook: `PreToolUse`, `Stop`... */
  tipo: z.string().min(1),
  ferramentaUsada: z.string().nullable(),
  entradaResumo: z.string().nullable(),
  recebidoEm: Instante,
});
export type EventoSessao = z.infer<typeof EventoSessao>;

/** Uso da janela de contexto; só existe quando a ferramenta registra os tokens. */
export const ContextoSessao = z.object({
  usadoTokens: z.number().int().nonnegative(),
  janelaTokens: z.number().int().positive(),
});
export type ContextoSessao = z.infer<typeof ContextoSessao>;

export const SessaoIa = z.object({
  id: Id,
  projetoId: Id,
  ferramenta: FerramentaSessao,
  /** Session id da própria ferramenta. */
  idExterno: z.string().min(1),
  modelo: z.string().nullable(),
  estado: EstadoSessao,
  iniciadaEm: Instante,
  ultimoEventoEm: Instante,
  encerradaEm: Instante.nullable(),
  /** `null` quando não há fonte: a área diz que não sabe, sem inventar número. */
  contexto: ContextoSessao.nullable(),
  /** O que está fazendo: o último evento recebido. */
  ultimoEvento: EventoSessao.nullable(),
});
export type SessaoIa = z.infer<typeof SessaoIa>;

/** Sessões abertas e recentes, com os projetos delas. */
export const ListaSessoes = z.object({
  projetos: z.array(Projeto),
  sessoes: z.array(SessaoIa),
});
export type ListaSessoes = z.infer<typeof ListaSessoes>;

/** Uma sessão que mudou, com o projeto dela (que pode ter acabado de ser reconhecido). */
export const MudancaSessao = z.object({ sessao: SessaoIa, projeto: Projeto });
export type MudancaSessao = z.infer<typeof MudancaSessao>;

export const PedidoEventosSessao = z.object({
  sessaoId: Id,
  limite: z.number().int().min(1).max(500).optional(),
});
export type PedidoEventosSessao = z.infer<typeof PedidoEventosSessao>;

/** `ferramenta` quando o número veio dela; `estimativa` quando foi contado aqui. */
export const FonteUso = z.enum(["ferramenta", "estimativa"]);
export type FonteUso = z.infer<typeof FonteUso>;

/** Uso por dia, ferramenta, modelo e projeto (DATA.md §5 uso_ia). */
export const UsoIa = z.object({
  dia: Dia,
  ferramenta: FerramentaSessao,
  modelo: z.string().nullable(),
  projetoId: Id.nullable(),
  tokensEntrada: z.number().int().nonnegative(),
  tokensSaida: z.number().int().nonnegative(),
  tokensCache: z.number().int().nonnegative(),
  custoEstimadoMicrodolares: z.number().int().nonnegative().nullable(),
  fonte: FonteUso,
});
export type UsoIa = z.infer<typeof UsoIa>;

export const PedidoUso = z
  .object({ de: Dia, ate: Dia })
  .refine((p) => p.de <= p.ate, "o primeiro dia precisa vir antes do último");
export type PedidoUso = z.infer<typeof PedidoUso>;

/** O que o Nuno acompanha no GitHub (DATA.md §5 github_itens). */
export const TipoItemGithub = z.enum(["pr", "issue"]);
export type TipoItemGithub = z.infer<typeof TipoItemGithub>;

export const EstadoItemGithub = z.enum(["aberto", "fechado", "mesclado"]);
export type EstadoItemGithub = z.infer<typeof EstadoItemGithub>;

export const PapelGithub = z.enum(["autor", "revisor", "atribuido"]);
export type PapelGithub = z.infer<typeof PapelGithub>;

/** Resultado do CI no último commit; `null` quando o item não tem CI. */
export const EstadoCi = z.enum(["passou", "falhou", "rodando"]);
export type EstadoCi = z.infer<typeof EstadoCi>;

export const ItemGithub = z.object({
  id: Id,
  repositorio: z.string().min(1),
  numero: z.number().int().positive(),
  tipo: TipoItemGithub,
  titulo: z.string(),
  autor: z.string(),
  estado: EstadoItemGithub,
  meuPapel: PapelGithub,
  precisaDeMim: z.boolean(),
  ciEstado: EstadoCi.nullable(),
  atualizadoNoGithub: Instante,
  url: z.url(),
});
export type ItemGithub = z.infer<typeof ItemGithub>;

/** O cache do GitHub e quando foi consultado pela última vez (`null`: nunca). */
export const SituacaoGithub = z.object({
  itens: z.array(ItemGithub),
  atualizadoEm: Instante.nullable(),
});
export type SituacaoGithub = z.infer<typeof SituacaoGithub>;

/** Conexões desta fase (DATA.md §7 conexoes); as das outras áreas entram com elas. */
export const TipoConexao = z.enum(["github", "hooks-claude-code"]);
export type TipoConexao = z.infer<typeof TipoConexao>;

export const EstadoLigacao = z.enum(["ligada", "desligada", "erro"]);
export type EstadoLigacao = z.infer<typeof EstadoLigacao>;

export const Conexao = z.object({
  tipo: TipoConexao,
  estado: EstadoLigacao,
  /** Usuário do GitHub, quando há. */
  conta: z.string().nullable(),
  /** O que impede de ligar, dito para o usuário ("Instale o gh", "Rode gh auth login"). */
  ultimoErro: z.string().nullable(),
  conectadaEm: Instante.nullable(),
});
export type Conexao = z.infer<typeof Conexao>;

export const PedidoConexao = z.object({ tipo: TipoConexao });
export type PedidoConexao = z.infer<typeof PedidoConexao>;

/** Arquivo do usuário que ligar muda: o texto de antes (`null` se ainda não existe) e o de depois. */
export const MudancaArquivo = z.object({
  caminho: z.string().min(1),
  antes: z.string().nullable(),
  depois: z.string(),
});
export type MudancaArquivo = z.infer<typeof MudancaArquivo>;

/** O que ligar vai mudar, mostrado antes do consentimento; nada é gravado na prévia. */
export const PreviaConexao = z.object({
  tipo: TipoConexao,
  arquivos: z.array(MudancaArquivo),
});
export type PreviaConexao = z.infer<typeof PreviaConexao>;
