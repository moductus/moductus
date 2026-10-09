import { z } from "zod";

/**
 * Levar para outro PC: um arquivo .moductus é um zip com manifesto.json e um JSON por
 * tabela (DATA.md, seção 8). Nesta fase só a modalidade "só configurações", sem senha.
 */
export const FORMATO_ARQUIVO = "moductus";

/** Sobe quando o arquivo muda de forma; arquivo de formato mais novo é recusado. */
export const VERSAO_FORMATO = 1;

export const EXTENSAO_ARQUIVO = ".moductus";

/**
 * O que pode ir num arquivo "só configurações" (DATA.md §8): a config e uma tabela de
 * configuração por arquivo JSON. Cresce com as fases.
 */
export const ConteudoArquivo = z.enum([
  "config",
  "agentes",
  "provedores",
  "regras_permissao",
  "conexoes",
  "notificacoes_preferencias",
]);
export type ConteudoArquivo = z.infer<typeof ConteudoArquivo>;

export const Manifesto = z.object({
  formato: z.literal(FORMATO_ARQUIVO),
  versao_formato: z.number().int().positive(),
  versao_app: z.string().min(1),
  /** Versão do banco (migrações) de onde saiu: a importação migra antes de gravar. */
  versao_esquema: z.number().int().nonnegative(),
  pc_origem: z.string(),
  criado_em: z.iso.datetime(),
  modalidade: z.literal("configuracoes"),
  conteudo: z.array(ConteudoArquivo).min(1),
});
export type Manifesto = z.infer<typeof Manifesto>;

const caminhoArquivo = z
  .string()
  .refine((c) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(c), "o caminho precisa ser absoluto")
  .refine((c) => c.toLowerCase().endsWith(EXTENSAO_ARQUIVO), "o arquivo precisa terminar em .moductus");

export const PedidoExportar = z.object({ caminho: caminhoArquivo });
export type PedidoExportar = z.infer<typeof PedidoExportar>;

export const ResultadoExportar = z.object({
  caminho: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Chaves de configuração que foram no arquivo. */
  chaves: z.array(z.string()),
});
export type ResultadoExportar = z.infer<typeof ResultadoExportar>;

/** Substituir: a configuração do arquivo vale inteira. Juntar: só as chaves que ele traz. */
export const ModoImportar = z.enum(["substituir", "juntar"]);
export type ModoImportar = z.infer<typeof ModoImportar>;

export const PedidoImportar = z.object({ caminho: caminhoArquivo, modo: ModoImportar });
export type PedidoImportar = z.infer<typeof PedidoImportar>;

/** Uma chave que a importação troca: o valor de agora e o que vem do arquivo. */
export const MudancaImportar = z.object({
  chave: z.string(),
  atual: z.unknown(),
  novo: z.unknown(),
});
export type MudancaImportar = z.infer<typeof MudancaImportar>;

/** O que a importação faria, sem gravar nada: a interface mostra e pede confirmação. */
export const PreviaImportar = z.object({
  pc_origem: z.string(),
  criado_em: z.iso.datetime(),
  versao_app: z.string(),
  mudancas: z.array(MudancaImportar),
});
export type PreviaImportar = z.infer<typeof PreviaImportar>;
