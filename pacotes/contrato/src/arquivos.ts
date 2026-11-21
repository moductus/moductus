import { z } from "zod";
import { Id, Instante } from "./comum.ts";

/**
 * Arquivo do usuário (ADR-0044): chega ao serviço só pela escolha dele, no diálogo ou arrastando.
 * A janela manda o caminho uma vez a `arquivos.autorizar`; o serviço confere e devolve uma
 * autorização de uso único, que a importação e o comprovante recebem no lugar do caminho. Nenhuma
 * ferramenta de agente recebe caminho nem autorização.
 */

/** Para que o arquivo vai: extrato a importar ou imagem de comprovante a ler. */
export const FinalidadeArquivo = z.enum(["extrato", "comprovante"]);
export type FinalidadeArquivo = z.infer<typeof FinalidadeArquivo>;

/** As extensões de cada um, sem o ponto: os filtros do diálogo e o que o serviço aceita. */
export const EXTENSOES_ARQUIVO: Readonly<Record<FinalidadeArquivo, readonly string[]>> = {
  extrato: ["ofx", "csv", "xml", "txt"],
  comprovante: ["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff"],
};

/** O nome de cada filtro no diálogo de abrir. */
export const NOME_DO_FILTRO: Readonly<Record<FinalidadeArquivo, string>> = {
  extrato: "Extrato",
  comprovante: "Comprovante",
};

/** O maior arquivo aceito de cada um, em bytes: extrato até 10 MB, imagem até 15 MB. */
export const TAMANHO_MAXIMO_ARQUIVO: Readonly<Record<FinalidadeArquivo, number>> = {
  extrato: 10 * 1024 * 1024,
  comprovante: 15 * 1024 * 1024,
};

/** Por quanto tempo a autorização vale, se não for usada antes. */
export const VALIDADE_AUTORIZACAO_MS = 10 * 60_000;

const caminhoAbsoluto = z
  .string()
  .min(1)
  .max(32_767)
  .refine((c) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(c), "o caminho precisa ser absoluto");

export const PedidoAutorizarArquivo = z.object({ caminho: caminhoAbsoluto, finalidade: FinalidadeArquivo });
export type PedidoAutorizarArquivo = z.infer<typeof PedidoAutorizarArquivo>;

/** A autorização: o id de uso único, o nome do arquivo (sem a pasta), o tamanho e até quando vale. */
export const AutorizacaoArquivo = z.object({
  id: Id,
  finalidade: FinalidadeArquivo,
  nome: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  valeAte: Instante,
});
export type AutorizacaoArquivo = z.infer<typeof AutorizacaoArquivo>;
