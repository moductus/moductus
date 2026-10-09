import { open } from "node:fs/promises";

/**
 * Leitor do transcript do Claude Code (`transcript_path` dos hooks): um JSONL que a ferramenta
 * vai acrescentando, uma linha por mensagem ou bloco. Do arquivo só sai o que a própria
 * ferramenta registrou de uso (`message.usage` de cada resposta) e as compactações; o conteúdo da
 * conversa nunca é guardado. Tolerante por desenho (spec §7): linha que não é JSON, tipo
 * desconhecido e campo novo são ignorados. Formato conferido no Claude Code 2.1.287 e 2.1.293.
 */

/** Uma resposta do modelo, com o uso que o Claude Code anotou nela. */
export interface UsoNaLinha {
  tipo: "uso";
  /**
   * `message.id`: a mesma resposta vem em várias linhas seguidas (uma por bloco), todas com o
   * mesmo uso, e só pode contar uma vez.
   */
  mensagemId: string | null;
  modelo: string;
  /** `timestamp` da linha; é o dia em que o uso entra. */
  instante: string | null;
  /** De subagente (`isSidechain`): gasta tokens, mas não ocupa o contexto da sessão. */
  lateral: boolean;
  entrada: number;
  saida: number;
  cacheCriado: number;
  cacheLido: number;
}

/** A conversa foi compactada: o contexto recomeça com o resumo. */
export interface CompactacaoNaLinha {
  tipo: "compactacao";
  /** `compactMetadata.postTokens`: o tamanho do contexto logo depois; vazio quando não veio. */
  tokensDepois: number | null;
}

export type LinhaTranscript = UsoNaLinha | CompactacaoNaLinha;

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Objeto) : null;
const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;
const numero = (valor: unknown): number =>
  typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;

/**
 * Só estas linhas interessam, e o filtro vem antes do `JSON.parse`: o transcript guarda saídas
 * inteiras de ferramenta, e analisar cada uma à toa custa caro numa sessão longa. Dentro de um
 * texto as aspas vêm escapadas, então o filtro não confunde conteúdo com o tipo da linha.
 */
const INTERESSA = /"type"\s*:\s*"assistant"|"subtype"\s*:\s*"compact_boundary"/;

/** O que importa de uma linha do transcript; `null` para todo o resto. */
export function lerLinhaTranscript(linha: string): LinhaTranscript | null {
  if (!INTERESSA.test(linha)) return null;
  let corpo: Objeto | null;
  try {
    corpo = objeto(JSON.parse(linha));
  } catch {
    return null;
  }
  if (!corpo) return null;
  if (corpo.type === "system" && corpo.subtype === "compact_boundary") {
    const depois = objeto(corpo.compactMetadata)?.postTokens;
    return {
      tipo: "compactacao",
      tokensDepois: typeof depois === "number" && Number.isFinite(depois) && depois >= 0 ? depois : null,
    };
  }
  if (corpo.type !== "assistant" || corpo.isApiErrorMessage === true) return null;
  const mensagem = objeto(corpo.message);
  const uso = objeto(mensagem?.usage);
  const modelo = texto(mensagem?.model);
  // `<synthetic>` é mensagem que o próprio Claude Code escreveu (erro, interrupção): não foi ao modelo.
  if (!mensagem || !uso || !modelo || modelo.startsWith("<")) return null;
  return {
    tipo: "uso",
    mensagemId: texto(mensagem.id),
    modelo,
    instante: texto(corpo.timestamp),
    lateral: corpo.isSidechain === true,
    entrada: numero(uso.input_tokens),
    saida: numero(uso.output_tokens),
    cacheCriado: numero(uso.cache_creation_input_tokens),
    cacheLido: numero(uso.cache_read_input_tokens),
  };
}

/** Onde a leitura parou: o byte seguinte à última linha inteira. */
export interface FimDaLeitura {
  lidoAte: number;
  /** O arquivo encolheu desde a última leitura (foi trocado): a leitura recomeçou do início. */
  recomecou: boolean;
}

/**
 * Lê as linhas inteiras de `caminho` a partir do byte `desde` e entrega uma por vez; a linha
 * ainda pela metade (o Claude Code escrevendo) fica para a próxima leitura. `null` quando o
 * arquivo não existe ou não abre: a sessão fica sem contexto, e a área diz que não sabe.
 */
export type LerTranscript = (
  caminho: string,
  desde: number,
  aCadaLinha: (linha: string) => void,
) => Promise<FimDaLeitura | null>;

const PEDACO = 1024 * 1024;
const QUEBRA = 0x0a;

/** {@link LerTranscript} no disco, aos pedaços: um transcript longo não entra inteiro na memória. */
export const lerTranscriptDoDisco: LerTranscript = async (caminho, desde, aCadaLinha) => {
  let arquivo;
  try {
    arquivo = await open(caminho, "r");
  } catch {
    return null;
  }
  try {
    const { size: tamanho } = await arquivo.stat();
    const recomecou = tamanho < desde;
    let posicao = recomecou ? 0 : desde;
    let lidoAte = posicao;
    let sobra: Buffer = Buffer.alloc(0);
    const buffer = Buffer.alloc(PEDACO);
    while (posicao < tamanho) {
      const { bytesRead: lidos } = await arquivo.read(
        buffer,
        0,
        Math.min(PEDACO, tamanho - posicao),
        posicao,
      );
      if (lidos === 0) break;
      posicao += lidos;
      let trecho = Buffer.concat([sobra, buffer.subarray(0, lidos)]);
      // Corta em bytes, na quebra de linha: um caractere de vários bytes nunca fica partido.
      for (let quebra = trecho.indexOf(QUEBRA); quebra !== -1; quebra = trecho.indexOf(QUEBRA)) {
        const linha = trecho.subarray(0, quebra).toString("utf8");
        lidoAte += quebra + 1;
        trecho = trecho.subarray(quebra + 1);
        if (linha.trim() !== "") aCadaLinha(linha);
      }
      sobra = Buffer.from(trecho);
    }
    return { lidoAte, recomecou };
  } finally {
    await arquivo.close();
  }
};
