import type { OcrNaCasca } from "../casca/ocr.ts";
import type { AutorizacoesDeArquivo } from "./autorizacoes.ts";

/** O que o comprovante recebe: as linhas lidas e o nome que a pessoa reconhece, nunca o caminho. */
export interface TextoDaImagem {
  nome: string;
  linhas: string[];
  texto: string;
}

/**
 * Lê o texto da imagem de um comprovante pela autorização de uso único (ADR-0044): o id é consumido
 * aqui, o caminho conferido de novo vai à casca e não sai do serviço. Erros:
 * - `ErroDoArquivo` (de `autorizacoes.ts`): id vencido, usado, de outra finalidade ou arquivo mudado;
 * - `ErroSemIdioma` (de `casca/ocr.ts`): o Windows não tem o reconhecimento de texto em português;
 * - `ErroDoOcr`: a casca recusou o caminho ou não leu a imagem.
 */
export function lerTextoDaImagem(
  autorizacoes: Pick<AutorizacoesDeArquivo, "usar">,
  ocr: OcrNaCasca,
): (id: string) => Promise<TextoDaImagem> {
  return async (id) => {
    const arquivo = autorizacoes.usar(id, "comprovante");
    const linhas = await ocr.lerTextoImagem(arquivo.caminho);
    return { nome: arquivo.nome, linhas, texto: linhas.join("\n") };
  };
}
