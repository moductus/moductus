import type { Destaque } from "@moductus/contrato";

/**
 * O trecho de uma nota numa linha só, como a lista e a busca mostram ("código do portão 4471 ·
 * trocar filtro da água"): cada linha do Markdown vira um pedaço, sem as marcas de bloco do começo
 * (título, item, citação, caixa de seleção), separadas por " · ". O que bateu com a busca sai como
 * posições no texto final, nunca como marcação dentro dele.
 */

/** Um pedaço do texto e se ele bateu com a busca. */
export interface Pedaco {
  texto: string;
  marcado: boolean;
}

export interface Trecho {
  texto: string;
  destaques: Destaque[];
}

/** Quantos caracteres o começo do texto tem na lista. */
export const TAMANHO_DO_COMECO = 140;

const SEPARADOR = " · ";
const RETICENCIAS = "…";

/** `# `, `- `, `* `, `1. `, `> ` e `[ ] ` no começo da linha, repetidos ("> - [x] feito"). */
const MARCA_DE_BLOCO = /^\s*(?:(?:#{1,6}|[-*+]|\d{1,3}[.)])\s+|>\s*)*(?:\[[ xX]\]\s+)?/;

/** Linha que é só régua ou sublinhado de título (`---`, `***`, `===`). */
const SO_REGUA = /^\s*[-*_=]{3,}\s*$/;

interface Letra {
  c: string;
  marcada: boolean;
}

/**
 * Junta os pedaços num trecho corrido. Com `maximo`, corta na última palavra que cabe e põe
 * reticências; um destaque cortado no meio fica só com a parte que sobrou.
 */
export function trechoCorrido(pedacos: readonly Pedaco[], maximo?: number): Trecho {
  const linhas: Letra[][] = [[]];
  for (const pedaco of pedacos) {
    for (const c of pedaco.texto) {
      if (c === "\n") linhas.push([]);
      else if (c !== "\r") linhas.at(-1)?.push({ c, marcada: pedaco.marcado });
    }
  }
  const saida: Letra[] = [];
  for (const linha of linhas) {
    const limpa = semMarcaDeBloco(linha);
    if (limpa.length === 0) continue;
    if (saida.length > 0) for (const c of SEPARADOR) saida.push({ c, marcada: false });
    // Um a um: espalhar uma linha de centenas de milhares de letras no `push` estoura a pilha.
    for (const letra of limpa) saida.push(letra);
  }
  return paraTrecho(maximo === undefined ? saida : cortar(saida, maximo));
}

/** O começo do conteúdo, para a lista de notas. */
export function comecoDoTexto(conteudo: string, maximo = TAMANHO_DO_COMECO): string {
  return trechoCorrido([{ texto: conteudo, marcado: false }], maximo).texto;
}

/**
 * Tira a marca de bloco do começo (se nada nela bateu com a busca) e junta os espaços seguidos num
 * só, sem espaço nas pontas. A régua sozinha some.
 */
function semMarcaDeBloco(linha: readonly Letra[]): Letra[] {
  const texto = linha.map((l) => l.c).join("");
  let inicio = 0;
  const marca = MARCA_DE_BLOCO.exec(texto)?.[0] ?? "";
  if (marca.length > 0) {
    // A marca vem em unidades UTF-16; as letras, em caracteres.
    let unidades = 0;
    for (const letra of linha) {
      if (unidades >= marca.length) break;
      unidades += letra.c.length;
      inicio++;
    }
    if (linha.slice(0, inicio).some((l) => l.marcada)) inicio = 0;
  }
  if (inicio === 0 && SO_REGUA.test(texto) && !linha.some((l) => l.marcada)) return [];
  const limpa: Letra[] = [];
  // Os espaços seguidos viram um; ele continua marcado só dentro de uma frase que bateu inteira.
  let espacoMarcado: boolean | null = null;
  for (const letra of linha.slice(inicio)) {
    if (/\s/u.test(letra.c)) {
      espacoMarcado = (espacoMarcado ?? true) && letra.marcada;
      continue;
    }
    const anterior = limpa.at(-1);
    if (espacoMarcado !== null && anterior) {
      limpa.push({ c: " ", marcada: espacoMarcado && anterior.marcada && letra.marcada });
    }
    espacoMarcado = null;
    limpa.push(letra);
  }
  return limpa;
}

function cortar(letras: Letra[], maximo: number): Letra[] {
  const tamanho = (ls: readonly Letra[]) => ls.reduce((n, l) => n + l.c.length, 0);
  if (tamanho(letras) <= maximo) return letras;
  let fim = 0;
  let unidades = 0;
  for (const letra of letras) {
    if (unidades + letra.c.length > maximo - RETICENCIAS.length) break;
    unidades += letra.c.length;
    fim++;
  }
  // Volta até o fim de uma palavra; se a primeira já não cabe, corta nela mesma.
  let palavra = fim;
  while (palavra > 0 && letras[palavra]?.c !== " ") palavra--;
  const cortado = letras.slice(0, palavra > 0 ? palavra : fim);
  while (cortado.length > 0 && [" ", "·"].includes(cortado.at(-1)?.c ?? "")) cortado.pop();
  return [...cortado, { c: RETICENCIAS, marcada: false }];
}

function paraTrecho(letras: readonly Letra[]): Trecho {
  let texto = "";
  const destaques: Destaque[] = [];
  for (const letra of letras) {
    const ultimo = destaques.at(-1);
    if (letra.marcada) {
      if (ultimo && ultimo.fim === texto.length) ultimo.fim += letra.c.length;
      else destaques.push({ inicio: texto.length, fim: texto.length + letra.c.length });
    }
    texto += letra.c;
  }
  return { texto, destaques };
}

/**
 * Lê o `snippet()` do FTS5 feito com as marcas dadas: o texto entre `abre` e `fecha` bateu com a
 * busca. As marcas são sorteadas a cada busca, então não aparecem no texto de nenhuma nota.
 */
export function lerSnippet(snippet: string, abre: string, fecha: string): Pedaco[] {
  const pedacos: Pedaco[] = [];
  let resto = snippet;
  while (resto.length > 0) {
    const i = resto.indexOf(abre);
    if (i < 0) {
      pedacos.push({ texto: resto, marcado: false });
      break;
    }
    if (i > 0) pedacos.push({ texto: resto.slice(0, i), marcado: false });
    resto = resto.slice(i + abre.length);
    const j = resto.indexOf(fecha);
    const marcado = j < 0 ? resto : resto.slice(0, j);
    pedacos.push({ texto: marcado, marcado: true });
    resto = j < 0 ? "" : resto.slice(j + fecha.length);
  }
  return pedacos;
}

/** Quanto de cada pedaço do snippet entra no trecho da busca, em unidades UTF-16. */
export const TAMANHO_DO_PEDACO = 80;

/**
 * Encurta os pedaços longos do snippet antes de montar o trecho: o FTS5 conta palavras, e uma
 * palavra pode ter centenas de milhares de letras (link colado, fileira de traços). Fica sempre o
 * lado que encosta no destaque: o que bateu guarda o começo; o contexto antes do primeiro destaque,
 * o fim; o depois do último (ou o de um trecho sem destaque), o começo; o do meio, as duas pontas.
 */
export function encurtarPedacos(pedacos: readonly Pedaco[], maximo = TAMANHO_DO_PEDACO): Pedaco[] {
  const primeiro = pedacos.findIndex((p) => p.marcado);
  const ultimo = pedacos.findLastIndex((p) => p.marcado);
  const saida: Pedaco[] = [];
  pedacos.forEach((pedaco, i) => {
    const { texto } = pedaco;
    if (texto.length <= maximo) saida.push(pedaco);
    else if (pedaco.marcado) {
      saida.push(
        { texto: pontaInicial(texto, maximo), marcado: true },
        { texto: RETICENCIAS, marcado: false },
      );
    } else if (primeiro < 0 || i > ultimo) {
      saida.push({ texto: pontaInicial(texto, maximo) + RETICENCIAS, marcado: false });
    } else if (i < primeiro) {
      saida.push({ texto: RETICENCIAS + pontaFinal(texto, maximo), marcado: false });
    } else {
      const metade = Math.floor(maximo / 2);
      saida.push({
        texto: pontaInicial(texto, metade) + RETICENCIAS + pontaFinal(texto, metade),
        marcado: false,
      });
    }
  });
  return saida;
}

/** As primeiras `n` unidades, sem partir um par substituto (emoji) ao meio. */
function pontaInicial(texto: string, n: number): string {
  const corte = ehAlto(texto.charCodeAt(n - 1)) ? n - 1 : n;
  return texto.slice(0, corte);
}

/** As últimas `n` unidades, sem partir um par substituto ao meio. */
function pontaFinal(texto: string, n: number): string {
  const inicio = texto.length - n;
  return texto.slice(ehBaixo(texto.charCodeAt(inicio)) ? inicio + 1 : inicio);
}

const ehAlto = (u: number) => u >= 0xd800 && u <= 0xdbff;
const ehBaixo = (u: number) => u >= 0xdc00 && u <= 0xdfff;

/**
 * A busca do usuário na sintaxe do FTS5: cada palavra entre aspas e como prefixo ("amanh" acha
 * "amanhã" enquanto se digita), todas exigidas. A aspa do texto vai dobrada (o escape do FTS5), para
 * nada virar operador (`OR`, `NEAR`, `-`, `*`). Caractere de controle separa palavras como o espaço:
 * o NUL dentro da string corta a consulta no SQLite. Sem nenhuma letra ou número, não há o que
 * buscar: `null`.
 */
export function consultaFts(texto: string): string | null {
  const termos = texto
    .split(/[\s\p{Cc}]+/u)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .map((t) => `"${t.replaceAll('"', '""')}"*`);
  return termos.length > 0 ? termos.join(" ") : null;
}
