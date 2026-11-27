import type { CanalCasca } from "./canal.ts";

/**
 * O texto de uma imagem pelo OCR do Windows na casca (`src-tauri/src/ocr.rs`, ADR-0043). O caminho
 * vem só de uma autorização de arquivo (ADR-0044); nenhuma ferramenta de agente chega aqui. A casca
 * lê sempre com o motor pt-BR e, sem ele, responde `sem_idioma` em vez de ler em outro idioma.
 */

/** Ler e reduzir uma imagem grande leva mais que os 10 s padrão do canal. */
export const PRAZO_OCR_MS = 20_000;

export const MENSAGEM_SEM_IDIOMA =
  "O Windows deste PC não tem o reconhecimento de texto em português. Adicione o idioma Português (Brasil) nas Configurações do Windows, em Hora e idioma, e tente de novo.";

/** O Windows não tem o motor pt-BR: a tela explica como instalar. */
export class ErroSemIdioma extends Error {
  readonly codigo = "sem_idioma";
  constructor() {
    super(MENSAGEM_SEM_IDIOMA);
  }
}

/** A casca recusou o caminho ou não conseguiu ler a imagem; o motivo vem na voz do produto. */
export class ErroDoOcr extends Error {
  constructor(
    readonly codigo: "recusado" | "ilegivel",
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface OcrNaCasca {
  /** As linhas de texto da imagem, de cima para baixo. */
  lerTextoImagem(caminho: string): Promise<string[]>;
}

interface RespostaOcr extends Record<string, unknown> {
  linhas?: unknown;
  codigo?: string;
  erro?: string;
}

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function ocrPelaCasca(canal: Pick<CanalCasca, "pedir">): OcrNaCasca {
  return {
    async lerTextoImagem(caminho) {
      const r = await canal.pedir<RespostaOcr>(
        { tipo: "ocr", op: "ler_texto_imagem", caminho },
        PRAZO_OCR_MS,
      );
      if (r.codigo === "sem_idioma") throw new ErroSemIdioma();
      if (r.codigo === "recusado" || r.codigo === "ilegivel") {
        throw new ErroDoOcr(r.codigo, `${primeiraMaiuscula(r.erro ?? "a imagem não foi lida")}.`);
      }
      if (r.erro) throw new Error(r.erro);
      if (!Array.isArray(r.linhas) || !r.linhas.every((l) => typeof l === "string")) {
        throw new Error("a casca não devolveu o texto da imagem");
      }
      return r.linhas as string[];
    },
  };
}
