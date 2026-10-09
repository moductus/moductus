import { randomBytes } from "node:crypto";

/** Base32 de Crockford: sem I, L, O e U, para não confundir na leitura. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DIGITOS_TEMPO = 10;
const DIGITOS_ALEATORIOS = 16;
const TEMPO_MAXIMO = 2 ** 48 - 1;

/** Uma função que devolve um ULID novo a cada chamada. */
export type GeradorUlid = () => string;

/**
 * Gera ULIDs (DATA.md §1): 48 bits de milissegundos e 80 aleatórios, em 26 caracteres que
 * ordenam como texto na ordem de criação. Dentro do mesmo milissegundo (ou com o relógio
 * voltando), a parte aleatória do anterior é incrementada em vez de sorteada de novo, para
 * que a ordem continue estrita. Relógio e sorteio entram por parâmetro para o teste.
 */
export function criarGeradorUlid(
  agora: () => number = Date.now,
  sortear: (bytes: number) => Uint8Array = randomBytes,
): GeradorUlid {
  let ultimoTempo = -1;
  let ultimoAleatorio: number[] = [];

  return () => {
    const tempo = agora();
    if (!Number.isInteger(tempo) || tempo < 0 || tempo > TEMPO_MAXIMO) {
      throw new RangeError(`tempo fora do intervalo do ULID: ${tempo}`);
    }
    if (tempo > ultimoTempo) {
      ultimoTempo = tempo;
      // 256 é múltiplo de 32: cada byte vira um dígito sem viés.
      ultimoAleatorio = Array.from(sortear(DIGITOS_ALEATORIOS), (b) => b % 32);
    } else {
      ultimoAleatorio = incrementado(ultimoAleatorio);
    }
    return codificarTempo(ultimoTempo) + ultimoAleatorio.map((d) => ALFABETO[d]).join("");
  };
}

function codificarTempo(tempo: number): string {
  let texto = "";
  let resto = tempo;
  for (let i = 0; i < DIGITOS_TEMPO; i++) {
    texto = ALFABETO[resto % 32] + texto;
    resto = Math.floor(resto / 32);
  }
  return texto;
}

/** Soma um à parte aleatória; estourar 80 bits no mesmo milissegundo é falha, não volta a zero. */
function incrementado(digitos: readonly number[]): number[] {
  const proximo = [...digitos];
  for (let i = proximo.length - 1; i >= 0; i--) {
    const digito = proximo[i] ?? 0;
    if (digito < 31) {
      proximo[i] = digito + 1;
      return proximo;
    }
    proximo[i] = 0;
  }
  throw new Error("ULIDs esgotados neste milissegundo");
}

/** O milissegundo em que o ULID foi criado. */
export function tempoDoUlid(id: string): number {
  let tempo = 0;
  for (const caractere of id.slice(0, DIGITOS_TEMPO)) {
    const valor = ALFABETO.indexOf(caractere);
    if (valor < 0) throw new Error(`ULID inválido: ${id}`);
    tempo = tempo * 32 + valor;
  }
  return tempo;
}

/** O gerador do serviço: um só, para a ordem valer entre todas as tabelas. */
export const novoId: GeradorUlid = criarGeradorUlid();
