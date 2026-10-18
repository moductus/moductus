import type { CampoCaptura, CamposCaptura, TipoCaptura, TrechoReconhecido } from "@moductus/contrato";
import {
  type DiaSemana,
  type Frequencia,
  type Regra,
  escreverRecorrencia,
  proximoDia,
} from "./recorrencia.ts";
import { type TempoDoDia, diaDaSemana, diasNoMes, ehDia, somarDias } from "./tempo.ts";

/**
 * O entendedor de frases da captura rápida (ADR-0034): uma gramática fechada em pt-BR que tira da
 * frase solta o tipo (tarefa, lembrete, evento, nota) e os campos (dia, hora, duração, repetição,
 * lembrete, lista), com o trecho de onde cada um saiu. Valor em reais marca `gasto` e "guarda isso"
 * marca `memoria`, que só chegam com a Tula e a Memória. É código puro: sem banco, sem modelo, o
 * relógio e o fuso vêm do `TempoDoDia`.
 *
 * O que ele não reconhece fica no título, nunca vira chute: a prévia mostra e o campo é editável.
 * Frase sem data vira tarefa sem data.
 *
 * Como lê as datas, no fuso do usuário:
 * - dia da semana é o próximo depois de hoje ("quinta" dita numa quinta é a da semana que vem);
 * - "dia 5" e "12/10" sem ano são a próxima vez que o dia chega, hoje incluído;
 * - hora sem dia é hoje, ou amanhã se a hora já passou;
 * - "de manhã", "à tarde" e "à noite" sozinhos são 9h, 14h e 19h;
 * - repetição sem dia começa na primeira ocorrência a partir de hoje (amanhã em diante se a hora
 *   de hoje já passou);
 * - no gasto, o dia da semana e o "dia 5" contam para trás: é o que já foi pago.
 */

/** Quanto da frase o entendedor lê: o tamanho máximo do `PedidoEntender`. O resto é ignorado. */
export const TAMANHO_DA_FRASE = 1000;

/** O título cabe no `CamposCaptura`. */
const TAMANHO_DO_TITULO = 500;

/** Uma lista que a frase pode citar ("#pessoal", "na lista Viagem de dezembro"). */
export interface ListaConhecida {
  id: string;
  nome: string;
}

export interface OpcoesFrase {
  listas?: readonly ListaConhecida[];
}

/** Posições de caractere na frase, como no `TrechoReconhecido`. */
export interface Marca {
  inicio: number;
  fim: number;
}

export interface FraseEntendida {
  tipo: TipoCaptura;
  campos: CamposCaptura;
  /** O trecho de cada campo que a frase deu, na ordem em que aparecem. */
  trechos: TrechoReconhecido[];
  /** As palavras que deram o tipo ("me lembra de", "reunião", "guarda isso"), quando houve. */
  trechoDoTipo: Marca | null;
  /**
   * Se reconheceu algo além do título. Sem isso, a captura pode perguntar ao modelo da Alba
   * (ADR-0034).
   */
  reconheceu: boolean;
}

/**
 * Entende a frase no dia de hoje do `tempo`. Frase sem nenhuma letra, número ou sinal é erro: o
 * `PedidoEntender` já não deixa chegar.
 */
export function entenderFrase(frase: string, tempo: TempoDoDia, opcoes: OpcoesFrase = {}): FraseEntendida {
  const texto = cortar(frase, TAMANHO_DA_FRASE);
  const p = palavras(texto);
  if (p.length === 0) throw new RangeError("frase vazia");

  const conteudo = marcaDeConteudo(p);
  if (conteudo !== null) {
    const tiradas = new Array<boolean>(p.length).fill(false);
    for (let i = conteudo.inicio; i < conteudo.fim; i++) tiradas[i] = true;
    return {
      tipo: conteudo.tipo,
      campos: camposVazios(titulo(texto, p, tiradas, false)),
      trechos: [],
      trechoDoTipo: marca(p, conteudo.inicio, conteudo.fim),
      reconheceu: true,
    };
  }

  const listas = (opcoes.listas ?? []).map((l) => ({
    id: l.id,
    formas: palavras(l.nome)
      .map((x) => x.forma)
      .filter((f) => ehPalavra(f)),
  }));

  // Primeira passada: os campos, da esquerda para a direita. O primeiro de cada campo vale; um
  // segundo ("amanhã ... sexta") fica no título.
  const achados: Achado[] = [];
  const ocupados = new Set<CampoCaptura>();
  for (let i = 0; i < p.length;) {
    const achado = reconhecer(p, i, listas);
    if (achado !== null && achado.campos.every((c) => !ocupados.has(c))) {
      achados.push(achado);
      for (const c of achado.campos) ocupados.add(c);
      i = achado.fim;
    } else i++;
  }

  const usadas = new Array<boolean>(p.length).fill(false);
  for (const a of achados) for (let i = a.inicio; i < a.fim; i++) usadas[i] = true;

  // Segunda passada: o tipo, nas palavras que sobraram.
  const marcaTipo = marcaDeTipo(p, usadas);
  const valor = achados.find((a) => a.valorCentavos !== undefined);
  const futuro = achados.some(
    (a) => (a.dia?.tipo === "relativo" && a.dia.dias > 0) || a.dia?.tipo === "daqui",
  );
  const ehGasto =
    marcaTipo === null && valor !== undefined && !futuro && !VERBOS_DE_TAREFA.has(p[0]?.forma ?? "");
  const tipo: TipoCaptura = marcaTipo?.tipo ?? (ehGasto ? "gasto" : "tarefa");

  // O valor só vale no gasto: na tarefa ("pagar R$ 150 da internet") ele fica no título.
  const hoje = tempo.hoje();
  const campos = camposVazios("");
  const trechos: TrechoReconhecido[] = [];
  const tiradas = new Array<boolean>(p.length).fill(false);
  for (const a of achados) {
    if (a.valorCentavos !== undefined && !ehGasto) continue;
    const dia = a.dia === undefined ? null : resolverDia(a.dia, hoje, tempo, ehGasto);
    if (a.dia !== undefined && dia === null) continue;
    if (dia !== null) {
      campos.dia = dia.dia;
      if (dia.hora !== null) campos.hora = dia.hora;
    }
    if (a.hora !== undefined) campos.hora = a.hora;
    if (a.duracaoMin !== undefined) campos.duracaoMin = a.duracaoMin;
    if (a.regra !== undefined) campos.recorrencia = escreverRecorrencia(a.regra);
    if (a.lembreteMinutosAntes !== undefined) campos.lembreteMinutosAntes = a.lembreteMinutosAntes;
    if (a.listaId !== undefined) campos.listaId = a.listaId;
    if (a.valorCentavos !== undefined) campos.valorCentavos = a.valorCentavos;
    const { inicio, fim } = marca(p, a.inicio, a.fim);
    for (const campo of a.campos) trechos.push({ campo, inicio, fim });
    for (let i = a.inicio; i < a.fim; i++) tiradas[i] = true;
  }
  if (marcaTipo?.tira) for (let i = marcaTipo.inicio; i < marcaTipo.fim; i++) tiradas[i] = true;

  const regra = achados.find((a) => a.regra !== undefined)?.regra;
  if (campos.dia === null && (campos.hora !== null || regra !== undefined)) {
    campos.dia = diaPadrao(tempo, hoje, campos.hora, regra ?? null, ehGasto);
    // Fora do calendário (ano 9999), a hora não fica sem o dia.
    if (campos.dia === null) campos.hora = null;
  }

  campos.titulo = titulo(texto, p, tiradas);
  const trechoDoTipo = marcaTipo === null ? null : marca(p, marcaTipo.inicio, marcaTipo.fim);
  return {
    tipo,
    campos,
    trechos,
    trechoDoTipo,
    reconheceu: trechos.length > 0 || trechoDoTipo !== null,
  };
}

// ---------------------------------------------------------------------------------------------
// Palavras

interface Palavra {
  /** Em minúsculas e sem acento: "Amanhã" é "amanha", "às" é "as". */
  forma: string;
  inicio: number;
  fim: number;
}

/**
 * Letras e números, com o que os junta por dentro ("15:30", "12/10", "1.285,00", "terça-feira",
 * "14h-16h"), o "R$" e cada sinal solto. Caractere de controle separa como o espaço. Sem
 * quantificador aninhado: o tempo cresce em linha com a frase.
 */
const PALAVRA = /[Rr]\$|[\p{L}\p{M}\p{N}]+(?:['’.,:/-][\p{L}\p{M}\p{N}]+)*|[^\s\p{Cc}]/gu;

function palavras(texto: string): Palavra[] {
  const saida: Palavra[] = [];
  for (const m of texto.matchAll(PALAVRA)) {
    saida.push({ forma: normalizar(m[0]), inicio: m.index, fim: m.index + m[0].length });
  }
  return saida;
}

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("’", "'");
}

const ehPalavra = (forma: string): boolean => /[\p{L}\p{N}]/u.test(forma);

/** O começo do texto até `maximo` unidades, sem partir um par substituto (emoji) ao meio. */
function cortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const alto = texto.charCodeAt(maximo - 1);
  return texto.slice(0, alto >= 0xd800 && alto <= 0xdbff ? maximo - 1 : maximo);
}

const forma = (p: readonly Palavra[], i: number): string | undefined => p[i]?.forma;

/** Onde termina a sequência `seq` começando em `i`, ou `null` se ela não está ali. */
function seguido(p: readonly Palavra[], i: number, seq: readonly string[]): number | null {
  for (let k = 0; k < seq.length; k++) if (forma(p, i + k) !== seq[k]) return null;
  return i + seq.length;
}

function marca(p: readonly Palavra[], inicio: number, fim: number): Marca {
  return { inicio: p[inicio]!.inicio, fim: p[fim - 1]!.fim };
}

// ---------------------------------------------------------------------------------------------
// Vocabulário

/** As palavras de um texto separado por espaço. */
const termos = (texto: string): string[] => texto.split(" ");

const NUMEROS = new Map(
  Object.entries({
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    quinze: 15,
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    noventa: 90,
  }),
);

function numero(f: string | undefined): number | null {
  if (f === undefined) return null;
  if (/^\d{1,5}$/.test(f)) return Number(f);
  return NUMEROS.get(f) ?? null;
}

/** O mês pelo nome e pelas três primeiras letras ("out", "dez"). */
const MESES = new Map(
  termos("janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro").flatMap(
    (nome, i): [string, number][] => [
      [nome, i + 1],
      [nome.slice(0, 3), i + 1],
    ],
  ),
);

/** Os dias da semana na ordem do `getUTCDay` (0 domingo). */
const SEMANA_PT = new Map(
  termos("domingo segunda terca quarta quinta sexta sabado").map((dia, i): [string, number] => [dia, i]),
);
const SIGLAS: readonly DiaSemana[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * Depois de "segunda", "quarta" ou "quinta" sem preposição, estas palavras dizem que é o ordinal
 * ("segunda via", "quinta série"), não o dia.
 */
const ORDINAIS = new Set(
  termos(
    "via vez vezes opcao chamada parte etapa mao fase edicao temporada versao pagina serie dose parcela prova rodada lugar classe geracao turma",
  ),
);

/** Verbos que, abrindo a frase, dizem que é coisa a fazer: tiram o gasto e o evento. */
const VERBOS_DE_TAREFA = new Set(
  termos(
    "pagar comprar transferir depositar cobrar devolver enviar mandar sacar receber marcar agendar remarcar desmarcar cancelar confirmar preparar organizar renovar",
  ),
);

/** Palavras da frase que dizem evento; ficam no título ("reunião com o contador"). */
const EVENTOS = new Set(
  termos("reuniao reunioes consulta call entrevista encontro compromisso audiencia evento webinar palestra"),
);
const EVENTOS_COM = new Set(["almoco", "jantar", "cafe"]);

/**
 * Conector que sobra na ponta do título quando o trecho do lado saiu: no começo, só o que não abre
 * frase ("45 de mercado"; "com o contador" fica); no fim, também a preposição que levava ao trecho.
 */
const CONECTORES_NO_COMECO = new Set(["e", "de", "do", "da", "dos", "das", "que"]);
const CONECTORES_NO_FIM = new Set([
  ...CONECTORES_NO_COMECO,
  ...termos("no na nos nas em as a ao aos para pra pro ate com por pelo pela"),
]);

/** Sinal que sai junto com o trecho que encosta nele ("quinta, 10h, com o contador"). */
const PONTUACAO_SOLTA = new Set([",", ";", ":", "-", "–", "—"]);

// ---------------------------------------------------------------------------------------------
// Reconhecedores

/** Um dia ainda não contado: só depois do tipo dá para saber se ele vai para frente ou para trás. */
type DiaPedido =
  | { tipo: "relativo"; dias: number }
  | { tipo: "semana"; semana: number }
  | { tipo: "data"; dia: number; mes: number | null; ano: number | null }
  | { tipo: "daqui"; minutos: number; dias: number };

/** O que um reconhecedor achou, nas posições das palavras (`fim` é a primeira depois do trecho). */
interface Achado {
  inicio: number;
  fim: number;
  campos: CampoCaptura[];
  dia?: DiaPedido;
  hora?: string;
  duracaoMin?: number;
  regra?: Regra;
  lembreteMinutosAntes?: number;
  listaId?: string;
  valorCentavos?: number;
}

interface ListaPreparada {
  id: string;
  formas: string[];
}

function reconhecer(p: readonly Palavra[], i: number, listas: readonly ListaPreparada[]): Achado | null {
  return (
    reconhecerRecorrencia(p, i) ??
    reconhecerIntervaloDeHoras(p, i) ??
    reconhecerDaqui(p, i) ??
    reconhecerDuracao(p, i) ??
    reconhecerAntecedencia(p, i) ??
    reconhecerDia(p, i) ??
    reconhecerHora(p, i) ??
    reconhecerPeriodo(p, i) ??
    reconhecerLista(p, i, listas) ??
    reconhecerValor(p, i)
  );
}

// Durações: "20 min", "20min", "1h30", "uma hora e meia", "meia hora", "2 dias".

interface Duracao {
  minutos: number;
  dias: number;
  fim: number;
}

const UNIDADE_MINUTO = new Set(["min", "mins", "minuto", "minutos"]);
const UNIDADE_HORA = new Set(["h", "hs", "hr", "hrs", "hora", "horas"]);
const UNIDADE_DIA = new Map([
  ["dia", 1],
  ["dias", 1],
  ["semana", 7],
  ["semanas", 7],
]);
const DURACAO_JUNTA = /^(\d{1,4})(?:(min|mins|minutos?)|(?:h|hs|hrs?)(?:(\d{1,2})(?:min)?)?)$/;

function duracao(p: readonly Palavra[], j: number, comDias: boolean): Duracao | null {
  const f = forma(p, j);
  if (f === undefined) return null;
  if (f === "meia-hora") return { minutos: 30, dias: 0, fim: j + 1 };
  if (f === "meia" && forma(p, j + 1) === "hora") return { minutos: 30, dias: 0, fim: j + 2 };
  const junta = DURACAO_JUNTA.exec(f);
  if (junta !== null) {
    if (junta[2] !== undefined) return { minutos: Number(junta[1]), dias: 0, fim: j + 1 };
    if (Number(junta[3] ?? 0) > 59) return null;
    return depoisDasHoras(p, j + 1, Number(junta[1]) * 60 + Number(junta[3] ?? 0), junta[3] === undefined);
  }
  const n = numero(f);
  const unidade = forma(p, j + 1);
  if (n === null || unidade === undefined) return null;
  if (UNIDADE_MINUTO.has(unidade)) return { minutos: n, dias: 0, fim: j + 2 };
  if (UNIDADE_HORA.has(unidade)) return depoisDasHoras(p, j + 2, n * 60, true);
  const dias = UNIDADE_DIA.get(unidade);
  if (comDias && dias !== undefined) return { minutos: 0, dias: n * dias, fim: j + 2 };
  return null;
}

/** "uma hora e meia", "1 hora e 15 min". */
function depoisDasHoras(p: readonly Palavra[], k: number, minutos: number, podeMais: boolean): Duracao {
  if (podeMais && forma(p, k) === "e") {
    if (forma(p, k + 1) === "meia") return { minutos: minutos + 30, dias: 0, fim: k + 2 };
    const n = numero(forma(p, k + 1));
    const unidade = forma(p, k + 2);
    if (n !== null && n < 60 && unidade !== undefined && UNIDADE_MINUTO.has(unidade)) {
      return { minutos: minutos + n, dias: 0, fim: k + 3 };
    }
  }
  return { minutos, dias: 0, fim: k };
}

// Horas: "15h", "15h30", "15:30", "às 3 da tarde", "às 15 horas", "meio-dia".

type Periodo = "manha" | "tarde" | "noite" | "madrugada";
const PERIODOS = new Map<string, Periodo>([
  ["manha", "manha"],
  ["tarde", "tarde"],
  ["noite", "noite"],
  ["madrugada", "madrugada"],
]);

interface Hora {
  h: number;
  m: number;
  fim: number;
  /** Número sem "h" ("às 3"): só vale depois de "às" e não sozinho num intervalo. */
  nua: boolean;
  periodo: Periodo | null;
}

const HORA_DOIS_PONTOS = /^(\d{1,2}):(\d{2})(?:h|hs|hrs)?$/;
const HORA_COM_H = /^(\d{1,2})(?:h|hs|hr|hrs)(?:(\d{2})(?:min)?)?$/;

/**
 * Depois de um número sem "h" ("às 3"), o que pode vir para ele ainda ser hora: o fim, um sinal ou
 * o começo de outro pedaço da frase. "terminar as 3 tarefas" não é às 3.
 */
const DEPOIS_DA_HORA_NUA = new Set(
  termos(
    "e da de em hoje amanha depois todo toda todos todas na no dia para pra ate com lembrete por durante proxima proximo",
  ),
);

function continuaDepoisDaHora(p: readonly Palavra[], k: number): boolean {
  const f = forma(p, k);
  return f === undefined || !ehPalavra(f) || DEPOIS_DA_HORA_NUA.has(f) || diaDaSemanaPt(f) !== null;
}

/**
 * A hora que começa em `j`. `nuaPermitida` aceita o número sem "h" ("às 3"); `conferir` pede que
 * ele seja seguido do que pode vir depois de uma hora, menos quando um período já disse que é hora
 * ("à noite às 8").
 */
function horaCore(p: readonly Palavra[], j: number, nuaPermitida: boolean, conferir = true): Hora | null {
  const f = forma(p, j);
  if (f === undefined) return null;
  let h: number;
  let m = 0;
  let fim = j + 1;
  let nua = false;
  const comMarca = HORA_DOIS_PONTOS.exec(f) ?? HORA_COM_H.exec(f);
  if (comMarca !== null) {
    h = Number(comMarca[1]);
    m = Number(comMarca[2] ?? 0);
  } else if (f === "meio-dia" || (f === "meio" && forma(p, j + 1) === "dia")) {
    h = 12;
    fim = f === "meio" ? j + 2 : j + 1;
  } else if (f === "meia-noite" || (f === "meia" && forma(p, j + 1) === "noite")) {
    h = 0;
    fim = f === "meia" ? j + 2 : j + 1;
  } else if (nuaPermitida && /^\d{1,2}$/.test(f)) {
    h = Number(f);
    const unidade = forma(p, j + 1);
    if (unidade !== undefined && UNIDADE_HORA.has(unidade)) fim = j + 2;
    else nua = true;
  } else return null;

  if (m === 0 && forma(p, fim) === "e" && forma(p, fim + 1) === "meia") {
    m = 30;
    fim += 2;
  }
  let periodo: Periodo | null = null;
  const depois = forma(p, fim);
  const qual = PERIODOS.get(forma(p, fim + 1) ?? "");
  if ((depois === "da" || depois === "de") && qual !== undefined) {
    periodo = qual;
    fim += 2;
  }
  if (nua && periodo === null && conferir && !continuaDepoisDaHora(p, fim)) return null;
  if (h > 23 || m > 59) return null;
  return { h: periodo === null ? h : noPeriodo(h, periodo), m, fim, nua, periodo };
}

/** "3 da tarde" é 15h, "8 da noite" é 20h, "12 da noite" é meia-noite. */
function noPeriodo(h: number, periodo: Periodo): number {
  if (periodo === "tarde") return h >= 1 && h <= 11 ? h + 12 : h;
  if (periodo === "noite") return h === 12 ? 0 : h >= 5 && h <= 11 ? h + 12 : h;
  if (periodo === "madrugada") return h === 12 ? 0 : h;
  return h;
}

const doisDigitos = (n: number): string => String(n).padStart(2, "0");
const horaTexto = (h: number, m: number): string => `${doisDigitos(h)}:${doisDigitos(m)}`;

/** O que vem antes da hora; o `true` deixa o número sem "h" ("às 3"). */
const PREFIXOS_HORA: readonly [readonly string[], boolean][] = [
  [["por", "volta", "das"], true],
  [["por", "volta", "de"], true],
  [["ate", "as"], true],
  [["pelas"], true],
  [["as"], true],
  [["a"], false],
];

function horaComPrefixo(p: readonly Palavra[], i: number, conferir = true): Hora | null {
  for (const [prefixo, nua] of PREFIXOS_HORA) {
    const k = seguido(p, i, prefixo);
    if (k === null) continue;
    const hora = horaCore(p, k, nua, conferir);
    if (hora !== null) return hora;
  }
  return horaCore(p, i, false);
}

function reconhecerHora(p: readonly Palavra[], i: number): Achado | null {
  const hora = horaComPrefixo(p, i);
  if (hora === null) return null;
  return { inicio: i, fim: hora.fim, campos: ["hora"], hora: horaTexto(hora.h, hora.m) };
}

/** "das 14h às 16h", "de 14h a 15h30", "14h-16h": a hora e a duração. */
const INTERVALO_JUNTO = /^(\d{1,2})(?:h(\d{2})?)?-(\d{1,2})h(\d{2})?$/;

function reconhecerIntervaloDeHoras(p: readonly Palavra[], i: number): Achado | null {
  const junto = INTERVALO_JUNTO.exec(forma(p, i) ?? "");
  if (junto !== null) {
    const n = (k: number) => Number(junto[k] ?? 0);
    if (n(1) > 23 || n(3) > 23 || n(2) > 59 || n(4) > 59) return null;
    return intervalo(i, i + 1, n(1) * 60 + n(2), n(3) * 60 + n(4));
  }
  const prefixo = forma(p, i) === "das" || forma(p, i) === "de";
  const primeira = horaCore(p, prefixo ? i + 1 : i, prefixo);
  if (primeira === null) return null;
  for (const separador of [["ate", "as"], ["as"], ["a"], ["ate"], ["-"]]) {
    const k = seguido(p, primeira.fim, separador);
    if (k === null) continue;
    const segunda = horaCore(p, k, true);
    if (segunda === null) continue;
    // Um dos dois tem de ter cara de hora: "de 2 a 3 kg" não é intervalo.
    if (primeira.nua && segunda.nua) return null;
    let h = primeira.h;
    // "das 2 às 4 da tarde": o período vale para as duas.
    if (primeira.periodo === null && segunda.periodo !== null) h = noPeriodo(h, segunda.periodo);
    return intervalo(i, segunda.fim, h * 60 + primeira.m, segunda.h * 60 + segunda.m);
  }
  return null;
}

/** O fim antes do começo vira a meia-noite ("das 23h à 1h" são 2 horas). */
function intervalo(inicio: number, fim: number, de: number, ate: number): Achado | null {
  if (ate === de) return null;
  return {
    inicio,
    fim,
    campos: ["hora", "duracaoMin"],
    hora: horaTexto(Math.floor(de / 60), de % 60),
    duracaoMin: ate > de ? ate - de : ate + 1440 - de,
  };
}

// Períodos: "de manhã", "à tarde", "à noite", e "à noite às 8".

const PERIODO_SOZINHO: readonly [readonly string[], Periodo][] = [
  [["de", "manha"], "manha"],
  [["pela", "manha"], "manha"],
  [["a", "tarde"], "tarde"],
  [["de", "tarde"], "tarde"],
  [["pela", "tarde"], "tarde"],
  [["a", "noite"], "noite"],
  [["de", "noite"], "noite"],
  [["pela", "noite"], "noite"],
  [["de", "madrugada"], "madrugada"],
];

/** A hora de um período dito sem hora. A madrugada não tem: fica no título. */
const HORA_DO_PERIODO: Partial<Record<Periodo, number>> = { manha: 9, tarde: 14, noite: 19 };

function reconhecerPeriodo(p: readonly Palavra[], i: number): Achado | null {
  for (const [seq, periodo] of PERIODO_SOZINHO) {
    const k = seguido(p, i, seq);
    if (k === null) continue;
    const hora = horaComPrefixo(p, k, false);
    if (hora !== null) {
      const h = hora.periodo === null ? noPeriodo(hora.h, periodo) : hora.h;
      return { inicio: i, fim: hora.fim, campos: ["hora"], hora: horaTexto(h, hora.m) };
    }
    const padrao = HORA_DO_PERIODO[periodo];
    if (padrao === undefined) return null;
    return { inicio: i, fim: k, campos: ["hora"], hora: horaTexto(padrao, 0) };
  }
  return null;
}

// "em 20 min", "daqui a 2 horas", "dentro de 3 dias".

const PREFIXOS_DAQUI = [["daqui", "a"], ["daqui"], ["dentro", "de"], ["em"]];

function reconhecerDaqui(p: readonly Palavra[], i: number): Achado | null {
  for (const prefixo of PREFIXOS_DAQUI) {
    const k = seguido(p, i, prefixo);
    if (k === null) continue;
    const d = duracao(p, k, true);
    if (d === null || (d.minutos <= 0 && d.dias <= 0)) continue;
    return {
      inicio: i,
      fim: d.fim,
      campos: d.minutos > 0 ? ["dia", "hora"] : ["dia"],
      dia: { tipo: "daqui", minutos: d.minutos, dias: d.dias },
    };
  }
  return null;
}

// "por 30 min", "durante 2 horas", "1h30 de duração".

function reconhecerDuracao(p: readonly Palavra[], i: number): Achado | null {
  let d: Duracao | null = null;
  const f = forma(p, i);
  if (f === "por" || f === "durante") d = duracao(p, i + 1, false);
  else if (f === "duracao") d = duracao(p, forma(p, i + 1) === "de" ? i + 2 : i + 1, false);
  else {
    const antes = duracao(p, i, false);
    const k = antes === null ? null : seguido(p, antes.fim, ["de", "duracao"]);
    if (antes !== null && k !== null) d = { ...antes, fim: k };
  }
  if (d === null || d.minutos < 1 || d.minutos > 1440) return null;
  return { inicio: i, fim: d.fim, campos: ["duracaoMin"], duracaoMin: d.minutos };
}

// "lembrete 30 min antes", "me avisa 1 dia antes", "com 2 horas de antecedência".

const ANTES_DO_AVISO = new Set(
  termos("lembrete lembrar lembra lembre me avisar avisa avise aviso alerta alarme com"),
);
/** O maior `MinutosAntes`: 28 dias. */
const ANTECEDENCIA_MAXIMA = 40320;

function reconhecerAntecedencia(p: readonly Palavra[], i: number): Achado | null {
  let k = i;
  while (k < i + 3 && ANTES_DO_AVISO.has(forma(p, k) ?? "")) k++;
  const d = duracao(p, k, true);
  if (d === null) return null;
  const fim = seguido(p, d.fim, ["antes"]) ?? seguido(p, d.fim, ["de", "antecedencia"]);
  const minutos = d.minutos + d.dias * 1440;
  if (fim === null || minutos < 1 || minutos > ANTECEDENCIA_MAXIMA) return null;
  return { inicio: i, fim, campos: ["lembreteMinutosAntes"], lembreteMinutosAntes: minutos };
}

// Dias: "hoje", "amanhã", "depois de amanhã", "quinta", "dia 12", "12/10", "25 de dezembro".

const PREFIXOS_DIA = [
  ["a", "partir", "de"],
  ["a", "partir", "do"],
  ["para", "o"],
  ["ate", "o"],
  ["para"],
  ["pra"],
  ["pro"],
  ["ate"],
  ["no"],
  ["na"],
  ["em"],
  ["nesta"],
  ["neste"],
  ["nessa"],
  ["nesse"],
  ["esta"],
  ["este"],
  ["essa"],
  ["esse"],
  ["de"],
  ["do"],
];

function reconhecerDia(p: readonly Palavra[], i: number): Achado | null {
  for (const prefixo of PREFIXOS_DIA) {
    const k = seguido(p, i, prefixo);
    if (k === null) continue;
    const dia = diaCore(p, k, true);
    if (dia !== null) return { inicio: i, fim: dia.fim, campos: ["dia"], dia: dia.dia };
  }
  const dia = diaCore(p, i, false);
  return dia === null ? null : { inicio: i, fim: dia.fim, campos: ["dia"], dia: dia.dia };
}

const DATA_COM_BARRA = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;
/** Depois de "1/2", estas dizem que é fração ("1/2 kg de carne"), não data. */
const UNIDADES_DE_MEDIDA = new Set(termos("kg g l ml litro litros xicara xicaras copo duzia"));

function diaCore(
  p: readonly Palavra[],
  j: number,
  comPrefixo: boolean,
): { dia: DiaPedido; fim: number } | null {
  const f = forma(p, j);
  if (f === undefined) return null;
  if (f === "hoje" || f === "hj") return { dia: { tipo: "relativo", dias: 0 }, fim: j + 1 };
  if (f === "amanha") return { dia: { tipo: "relativo", dias: 1 }, fim: j + 1 };
  if (f === "ontem") return { dia: { tipo: "relativo", dias: -1 }, fim: j + 1 };
  if (f === "anteontem") return { dia: { tipo: "relativo", dias: -2 }, fim: j + 1 };
  const depois = seguido(p, j, ["depois", "de", "amanha"]);
  if (depois !== null) return { dia: { tipo: "relativo", dias: 2 }, fim: depois };

  // "quinta", "na sexta-feira", "próxima terça", "quinta que vem".
  const proxima = f === "proxima" || f === "proximo";
  const k = proxima ? j + 1 : j;
  const semana = diaDaSemanaPt(forma(p, k) ?? "");
  if (semana !== null && !semana.plural) {
    let fim = k + 1;
    let feira = semana.feira;
    if (forma(p, fim) === "feira") {
      feira = true;
      fim++;
    }
    if (!comPrefixo && !proxima && !feira && ORDINAIS.has(forma(p, fim) ?? "")) return null;
    fim = seguido(p, fim, ["que", "vem"]) ?? fim;
    return { dia: { tipo: "semana", semana: semana.semana }, fim };
  }

  // "dia 12", "dia 12 de outubro", "dia 12/10", "12/10", "25 de dezembro de 2026".
  const comDia = f === "dia";
  const n = comDia ? j + 1 : j;
  const barra = DATA_COM_BARRA.exec(forma(p, n) ?? "");
  if (barra !== null) {
    if (UNIDADES_DE_MEDIDA.has(forma(p, n + 1) ?? "")) return null;
    const ano = barra[3] === undefined ? null : Number(barra[3].length === 2 ? `20${barra[3]}` : barra[3]);
    const dia = data(Number(barra[1]), Number(barra[2]), ano);
    return dia === null ? null : { dia, fim: n + 1 };
  }
  const numeroDoDia =
    forma(p, n) === "primeiro" ? 1 : /^\d{1,2}$/.test(forma(p, n) ?? "") ? Number(forma(p, n)) : null;
  if (numeroDoDia === null) return null;
  const mes = forma(p, n + 1) === "de" ? MESES.get(forma(p, n + 2) ?? "") : undefined;
  if (mes === undefined) {
    if (!comDia) return null;
    const dia = data(numeroDoDia, null, null);
    return dia === null ? null : { dia, fim: n + 1 };
  }
  const anoTexto = forma(p, n + 3) === "de" ? forma(p, n + 4) : undefined;
  const ano = anoTexto !== undefined && /^\d{4}$/.test(anoTexto) ? Number(anoTexto) : null;
  const dia = data(numeroDoDia, mes, ano);
  return dia === null ? null : { dia, fim: ano === null ? n + 3 : n + 5 };
}

/** O dia pedido, se ele pode existir (31/02 não pode; 29/02 sem ano espera o bissexto). */
function data(dia: number, mes: number | null, ano: number | null): DiaPedido | null {
  if (dia < 1 || dia > 31) return null;
  if (mes !== null) {
    const anoDeTeste = ano ?? 2000;
    if (!ehDia(`${String(anoDeTeste).padStart(4, "0")}-${doisDigitos(mes)}-${doisDigitos(dia)}`)) return null;
  }
  return { tipo: "data", dia, mes, ano };
}

/** "terça", "terça-feira", "terças", "sábados", "segundas-feiras". */
function diaDaSemanaPt(f: string): { semana: number; plural: boolean; feira: boolean } | null {
  let raiz = f;
  let feira = false;
  const comFeira = /^(.+)-feiras?$/.exec(raiz);
  if (comFeira !== null) {
    raiz = comFeira[1]!;
    feira = true;
  }
  const semana = SEMANA_PT.get(raiz);
  if (semana !== undefined) return { semana, plural: false, feira };
  const singular = raiz.endsWith("s") ? SEMANA_PT.get(raiz.slice(0, -1)) : undefined;
  return singular === undefined ? null : { semana: singular, plural: true, feira };
}

// Repetição: "todo dia", "toda segunda e quarta", "aos sábados", "dias úteis", "todo dia 10",
// "a cada 2 semanas", "de segunda a sexta".

const regraNova = (frequencia: Frequencia, intervalo = 1): Regra => ({
  frequencia,
  intervalo,
  diasDaSemana: [],
  diasDoMes: [],
  contagem: null,
  ate: null,
  inicioDaSemana: "MO",
});

/** Semanal nos dias dados, na ordem da semana começando na segunda. */
function nosDias(dias: readonly number[]): Regra {
  const ordem = [...new Set(dias)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return { ...regraNova("WEEKLY"), diasDaSemana: ordem.map((d) => ({ dia: SIGLAS[d]!, ordem: null })) };
}

const UTEIS = [1, 2, 3, 4, 5];
const FIM_DE_SEMANA = [6, 0];

const ADVERBIOS = new Map<string, Frequencia>([
  ["diariamente", "DAILY"],
  ["semanalmente", "WEEKLY"],
  ["mensalmente", "MONTHLY"],
  ["anualmente", "YEARLY"],
]);
const FREQUENCIA_DA_UNIDADE = new Map<string, Frequencia>([
  ["dia", "DAILY"],
  ["dias", "DAILY"],
  ["semana", "WEEKLY"],
  ["semanas", "WEEKLY"],
  ["mes", "MONTHLY"],
  ["meses", "MONTHLY"],
  ["ano", "YEARLY"],
  ["anos", "YEARLY"],
]);
const QUANTIFICADORES = [["todos", "os"], ["todas", "as"], ["todo"], ["toda"]];
const ORDENS = new Map(
  Object.entries({
    primeira: 1,
    primeiro: 1,
    segunda: 2,
    segundo: 2,
    terceira: 3,
    terceiro: 3,
    quarta: 4,
    quarto: 4,
    ultima: -1,
    ultimo: -1,
  }),
);
/** "todo fim de semana"; sem o "todo", só o plural repete ("no fim de semana" é um só). */
const FINS_DE_SEMANA = [
  ["fim", "de", "semana"],
  ["final", "de", "semana"],
  ["fins", "de", "semana"],
  ["finais", "de", "semana"],
];
const FINS_DE_SEMANA_PLURAL = FINS_DE_SEMANA.slice(2);
const DIAS_UTEIS = [
  ["dias", "uteis"],
  ["dia", "util"],
];

function reconhecerRecorrencia(p: readonly Palavra[], i: number): Achado | null {
  const achou = (fim: number, regra: Regra): Achado => ({ inicio: i, fim, campos: ["recorrencia"], regra });
  const f = forma(p, i) ?? "";

  const adverbio = ADVERBIOS.get(f);
  if (adverbio !== undefined) return achou(i + 1, regraNova(adverbio));
  const diaSim = seguido(p, i, ["dia", "sim", "dia", "nao"]);
  if (diaSim !== null) return achou(diaSim, regraNova("DAILY", 2));

  const aCada = seguido(p, i, ["a", "cada"]);
  if (aCada !== null) {
    const n = numero(forma(p, aCada));
    const u = n === null ? aCada : aCada + 1;
    const frequencia = FREQUENCIA_DA_UNIDADE.get(forma(p, u) ?? "");
    if (frequencia === undefined || (n !== null && (n < 1 || n > 999))) return null;
    return achou(u + 1, regraNova(frequencia, n ?? 1));
  }

  if (f === "de") {
    // "de 15 em 15 dias"
    const n = numero(forma(p, i + 1));
    if (n !== null && n >= 1 && n <= 999 && forma(p, i + 2) === "em" && numero(forma(p, i + 3)) === n) {
      const frequencia = FREQUENCIA_DA_UNIDADE.get(forma(p, i + 4) ?? "");
      if (frequencia !== undefined) return achou(i + 5, regraNova(frequencia, n));
    }
    // "de segunda a sexta"
    const de = diaDaSemanaPt(forma(p, i + 1) ?? "");
    const sep = forma(p, i + 2);
    const ate = diaDaSemanaPt(forma(p, i + 3) ?? "");
    if (de !== null && ate !== null && (sep === "a" || sep === "ate") && de.semana !== ate.semana) {
      const dias: number[] = [];
      for (let d = de.semana; d !== ate.semana; d = (d + 1) % 7) dias.push(d);
      dias.push(ate.semana);
      return achou(i + 4, nosDias(dias));
    }
    return null;
  }

  for (const q of QUANTIFICADORES) {
    const k = seguido(p, i, q);
    if (k === null) continue;
    const depois = depoisDeTodo(p, k);
    if (depois !== null) return achou(depois.fim, depois.regra);
  }

  // "às segundas", "aos sábados", "nas quartas e sextas", "nos fins de semana", "em dias úteis".
  const k = ["as", "aos", "nas", "nos", "em"].includes(f) ? i + 1 : i;
  for (const seq of FINS_DE_SEMANA_PLURAL) {
    const fim = seguido(p, k, seq);
    if (fim !== null) return achou(fim, nosDias(FIM_DE_SEMANA));
  }
  const uteis = seguido(p, k, ["dias", "uteis"]);
  if (uteis !== null) return achou(uteis, nosDias(UTEIS));
  if (k > i) {
    const lista = listaDeDias(p, k, true);
    if (lista !== null) return achou(lista.fim, nosDias(lista.dias));
  }
  return null;
}

/** O que vem depois de "todo", "toda", "todos os", "todas as". */
function depoisDeTodo(p: readonly Palavra[], k: number): { regra: Regra; fim: number } | null {
  const f = forma(p, k);
  for (const seq of DIAS_UTEIS) {
    const fim = seguido(p, k, seq);
    if (fim !== null) return { regra: nosDias(UTEIS), fim };
  }
  for (const seq of FINS_DE_SEMANA) {
    const fim = seguido(p, k, seq);
    if (fim !== null) return { regra: nosDias(FIM_DE_SEMANA), fim };
  }
  if (f === "dia") {
    // "todo dia 10", "todo dia 10 do mês"; "todo dia 10h" é todo dia às 10h.
    const n = forma(p, k + 1) ?? "";
    if (/^\d{1,2}$/.test(n) && Number(n) >= 1 && Number(n) <= 31) {
      const fim = seguido(p, k + 2, ["do", "mes"]) ?? k + 2;
      return { regra: { ...regraNova("MONTHLY"), diasDoMes: [Number(n)] }, fim };
    }
    return { regra: regraNova("DAILY"), fim: k + 1 };
  }
  const santo = seguido(p, k, ["santo", "dia"]);
  if (santo !== null) return { regra: regraNova("DAILY"), fim: santo };
  if (f === "mes" || f === "meses") {
    // "todo mês no dia 5"
    const dia = seguido(p, k + 1, ["no", "dia"]);
    const n = dia === null ? "" : (forma(p, dia) ?? "");
    if (dia !== null && /^\d{1,2}$/.test(n) && Number(n) >= 1 && Number(n) <= 31) {
      return { regra: { ...regraNova("MONTHLY"), diasDoMes: [Number(n)] }, fim: dia + 1 };
    }
  }
  const frequencia = FREQUENCIA_DA_UNIDADE.get(f ?? "");
  if (frequencia !== undefined) return { regra: regraNova(frequencia), fim: k + 1 };
  // "toda primeira segunda do mês", "toda última sexta": "toda segunda sexta" é a 2ª sexta.
  const ordem = ORDENS.get(f ?? "");
  const diaDaOrdem = diaDaSemanaPt(forma(p, k + 1) ?? "");
  if (ordem !== undefined && diaDaOrdem !== null && !diaDaOrdem.plural) {
    const fim = seguido(p, k + 2, ["do", "mes"]) ?? k + 2;
    const regra: Regra = {
      ...regraNova("MONTHLY"),
      diasDaSemana: [{ dia: SIGLAS[diaDaOrdem.semana]!, ordem }],
    };
    return { regra, fim };
  }
  const lista = listaDeDias(p, k, false);
  return lista === null ? null : { regra: nosDias(lista.dias), fim: lista.fim };
}

/** "segunda", "segunda e quarta", "terças, quintas e sábados". */
function listaDeDias(
  p: readonly Palavra[],
  k: number,
  plural: boolean,
): { dias: number[]; fim: number } | null {
  const dias: number[] = [];
  let fim = k;
  for (;;) {
    const dia = diaDaSemanaPt(forma(p, fim) ?? "");
    if (dia === null || (plural && dias.length === 0 && !dia.plural)) break;
    dias.push(dia.semana);
    fim++;
    if (forma(p, fim) === "feira" || forma(p, fim) === "feiras") fim++;
    const sep = forma(p, fim);
    if ((sep === "," || sep === "e") && diaDaSemanaPt(forma(p, fim + 1) ?? "") !== null) fim++;
    else break;
  }
  return dias.length === 0 ? null : { dias, fim };
}

// Lista: "#pessoal", "na lista Viagem de dezembro".

const PREFIXOS_LISTA = [
  ["na", "lista"],
  ["para", "a", "lista"],
  ["pra", "a", "lista"],
  ["pra", "lista"],
  ["para", "lista"],
  ["lista"],
  ["#"],
];

function reconhecerLista(p: readonly Palavra[], i: number, listas: readonly ListaPreparada[]): Achado | null {
  if (listas.length === 0) return null;
  for (const prefixo of PREFIXOS_LISTA) {
    const k = seguido(p, i, prefixo);
    if (k === null) continue;
    let melhor: ListaPreparada | null = null;
    for (const lista of listas) {
      if (lista.formas.length === 0 || (melhor !== null && lista.formas.length <= melhor.formas.length))
        continue;
      if (seguido(p, k, lista.formas) !== null) melhor = lista;
    }
    if (melhor !== null) {
      return { inicio: i, fim: k + melhor.formas.length, campos: ["listaId"], listaId: melhor.id };
    }
  }
  return null;
}

// Valor em reais: "R$ 45", "R$32,90", "28 reais", "gastei 120", "45 de mercado".

/** "45", "45,90", "1.285,00", "45.90". */
const VALOR = /^(?:(\d{1,3}(?:\.\d{3})+|\d{1,9})(?:,(\d{1,2}))?|(\d{1,9})\.(\d{1,2}))$/;
const VERBOS_DE_GASTO = new Set(["gastei", "paguei", "gastou", "pagou", "gasto", "custou"]);
const DEPOIS_DO_VALOR_SOLTO = new Set(termos("de do da no na em com pro pra pelo pela"));

function centavos(f: string | undefined): number | null {
  const m = VALOR.exec(f ?? "");
  if (m === null) return null;
  const reais = Number((m[1] ?? m[3] ?? "").replaceAll(".", ""));
  const fracao = m[2] ?? m[4] ?? "0";
  const valor = reais * 100 + Number(fracao.padEnd(2, "0"));
  return valor > 0 ? valor : null;
}

function reconhecerValor(p: readonly Palavra[], i: number): Achado | null {
  const achou = (inicio: number, fim: number, valor: number): Achado => {
    const reais = forma(p, fim) === "reais" || forma(p, fim) === "real" ? fim + 1 : fim;
    return { inicio, fim: reais, campos: ["valorCentavos"], valorCentavos: valor };
  };
  const f = forma(p, i);
  if (f === "r$") {
    const v = centavos(forma(p, i + 1));
    return v === null ? null : achou(i, i + 2, v);
  }
  if (VERBOS_DE_GASTO.has(f ?? "")) {
    const k = forma(p, i + 1) === "de" || forma(p, i + 1) === "uns" ? i + 2 : i + 1;
    const comCifrao = forma(p, k) === "r$";
    const v = centavos(forma(p, comCifrao ? k + 1 : k));
    return v === null ? null : achou(k, comCifrao ? k + 2 : k + 1, v);
  }
  const v = centavos(f);
  if (v === null) return null;
  if (forma(p, i + 1) === "reais" || forma(p, i + 1) === "real") return achou(i, i + 1, v);
  // Número solto abrindo a frase ("45 de mercado no débito"), menos "15 de outubro".
  const depois = forma(p, i + 1) ?? "";
  if (i === 0 && DEPOIS_DO_VALOR_SOLTO.has(depois) && !(depois === "de" && MESES.has(forma(p, 2) ?? ""))) {
    return achou(0, 1, v);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tipo

interface MarcaDeTipo {
  tipo: TipoCaptura;
  inicio: number;
  fim: number;
  /** A marca sai do título ("me lembra de") ou fica nele ("reunião com o contador"). */
  tira: boolean;
}

/**
 * Nota e memória: o resto da frase é o conteúdo, sem campo nenhum. "guarda isso" vale em qualquer
 * lugar; "nota:", "ideia:" e "anota" só no começo, para "pedir nota fiscal" continuar tarefa.
 */
function marcaDeConteudo(p: readonly Palavra[]): MarcaDeTipo | null {
  for (let i = 0; i < p.length; i++) {
    const f = forma(p, i);
    if ((f === "guarda" || f === "guarde" || f === "guardar") && forma(p, i + 1) === "isso") {
      return { tipo: "memoria", inicio: i, fim: comSinal(p, i + 2), tira: true };
    }
  }
  const f = forma(p, 0);
  const sinal = forma(p, 1);
  if ((f === "nota" || f === "ideia" || f === "anotacao") && (sinal === ":" || sinal === "-")) {
    return { tipo: "nota", inicio: 0, fim: 2, tira: true };
  }
  if (f === "anota" || f === "anotar" || f === "anote") {
    let fim = forma(p, 1) === "ai" ? 2 : 1;
    if (forma(p, fim) === "que" || forma(p, fim) === ":") fim++;
    return { tipo: "nota", inicio: 0, fim, tira: true };
  }
  return null;
}

/** Um ":" ou "-" logo depois da marca sai com ela. */
const comSinal = (p: readonly Palavra[], k: number): number =>
  forma(p, k) === ":" || forma(p, k) === "-" || forma(p, k) === "," ? k + 1 : k;

const VERBOS_DE_LEMBRETE = new Set(["lembra", "lembre", "lembrar", "avisa", "avise", "avisar"]);
const VERBOS_DE_LEMBRETE_ME = new Set(["lembra-me", "lembre-me", "lembrar-me", "avisa-me", "avise-me"]);
const DEPOIS_DO_LEMBRETE = new Set(["de", "que", "do", "da", ":", "-"]);

/**
 * O tipo pelas palavras que os campos não usaram. Vale, nesta ordem: "tarefa:" no começo; o
 * pedido de lembrete ("me lembra de", "lembrar de"); a palavra de evento ("reunião", "consulta",
 * "almoço com"), menos quando a frase abre com verbo de tarefa ("marcar consulta"); e "lembrete"
 * solto. Sem nenhuma, quem decide é o valor em reais (gasto) ou nada (tarefa).
 */
function marcaDeTipo(p: readonly Palavra[], usadas: readonly boolean[]): MarcaDeTipo | null {
  const livre = (i: number, fim: number): boolean => {
    for (let k = i; k < fim; k++) if (usadas[k] !== false) return false;
    return true;
  };

  if (forma(p, 0) === "tarefa" && (forma(p, 1) === ":" || forma(p, 1) === "-") && livre(0, 2)) {
    return { tipo: "tarefa", inicio: 0, fim: 2, tira: true };
  }

  for (let i = 0; i < p.length; i++) {
    if (!livre(i, i + 1)) continue;
    const f = forma(p, i) ?? "";
    const me = f === "me";
    const verbo = me ? (forma(p, i + 1) ?? "") : f;
    const k = me ? i + 1 : i;
    const comMe = me && VERBOS_DE_LEMBRETE.has(verbo);
    const pronominal = !me && VERBOS_DE_LEMBRETE_ME.has(verbo);
    const lembrar = !me && ["lembra", "lembre", "lembrar"].includes(verbo);
    const depois = forma(p, k + 1) ?? "";
    if (!comMe && !pronominal && !(lembrar && DEPOIS_DO_LEMBRETE.has(depois))) continue;
    const fim = DEPOIS_DO_LEMBRETE.has(depois) && livre(k + 1, k + 2) ? k + 2 : k + 1;
    if (!livre(i, fim)) continue;
    return { tipo: "lembrete", inicio: i, fim, tira: true };
  }

  if (!VERBOS_DE_TAREFA.has(forma(p, 0) ?? "")) {
    for (let i = 0; i < p.length; i++) {
      if (!livre(i, i + 1)) continue;
      const f = forma(p, i) ?? "";
      if (EVENTOS.has(f)) return { tipo: "evento", inicio: i, fim: i + 1, tira: false };
      if (EVENTOS_COM.has(f) && forma(p, i + 1) === "com" && livre(i + 1, i + 2)) {
        return { tipo: "evento", inicio: i, fim: i + 2, tira: false };
      }
    }
  }

  for (let i = 0; i < p.length; i++) {
    if (!livre(i, i + 1) || forma(p, i) !== "lembrete") continue;
    // No começo ("lembrete: tomar remédio") sai do título; no meio, fica.
    if (i === 0) return { tipo: "lembrete", inicio: 0, fim: comSinal(p, 1), tira: true };
    return { tipo: "lembrete", inicio: i, fim: i + 1, tira: false };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Dia contado, título

/**
 * O dia do pedido a partir de hoje. No gasto, o dia da semana e a data sem ano contam para trás.
 * Fora do calendário (depois de 9999-12-31), `null`: o trecho volta para o título.
 */
function resolverDia(
  pedido: DiaPedido,
  hoje: string,
  tempo: TempoDoDia,
  passado: boolean,
): { dia: string; hora: string | null } | null {
  try {
    switch (pedido.tipo) {
      case "relativo":
        return { dia: somarDias(hoje, pedido.dias), hora: null };
      case "semana": {
        const atual = diaDaSemana(hoje);
        const salto = passado
          ? -((atual - pedido.semana + 7) % 7 || 7)
          : (pedido.semana - atual + 7) % 7 || 7;
        return { dia: somarDias(hoje, salto), hora: null };
      }
      case "data": {
        const dia = diaDaData(pedido, hoje, passado);
        return dia === null ? null : { dia, hora: null };
      }
      case "daqui": {
        if (pedido.minutos === 0) return { dia: somarDias(hoje, pedido.dias), hora: null };
        const instante = new Date(tempo.instanteDeAgora().getTime() + pedido.minutos * 60_000);
        const dia = tempo.diaDe(instante);
        return ehDia(dia) ? { dia, hora: tempo.horaDe(instante) } : null;
      }
    }
  } catch (erro) {
    if (erro instanceof RangeError) return null;
    throw erro;
  }
}

function diaDaData(
  pedido: { dia: number; mes: number | null; ano: number | null },
  hoje: string,
  passado: boolean,
): string | null {
  const texto = (ano: number, mes: number) =>
    `${String(ano).padStart(4, "0")}-${doisDigitos(mes)}-${doisDigitos(pedido.dia)}`;
  const serve = (t: string) => ehDia(t) && (passado ? t <= hoje : t >= hoje);
  if (pedido.mes !== null && pedido.ano !== null) {
    const t = texto(pedido.ano, pedido.mes);
    return ehDia(t) ? t : null;
  }
  const anoDeHoje = Number(hoje.slice(0, 4));
  const mesDeHoje = Number(hoje.slice(5, 7));
  const passo = passado ? -1 : 1;
  if (pedido.mes !== null) {
    // 29/02 espera o próximo bissexto: no máximo oito anos.
    for (let k = 0; k <= 8; k++) {
      const t = texto(anoDeHoje + k * passo, pedido.mes);
      if (serve(t)) return t;
    }
    return null;
  }
  // Só o dia: este mês, ou o próximo que tiver o dia (31 pula os meses de 30).
  for (let k = 0; k <= 12; k++) {
    const meses = anoDeHoje * 12 + mesDeHoje - 1 + k * passo;
    const t = texto(Math.floor(meses / 12), (meses % 12) + 1);
    if (serve(t)) return t;
  }
  return null;
}

/**
 * O dia de quem deu hora ou repetição sem dia. Com repetição, a primeira ocorrência a partir de
 * hoje; sem ela, hoje. Se a hora de hoje já passou, a próxima. No gasto, a hora é de hoje.
 */
function diaPadrao(
  tempo: TempoDoDia,
  hoje: string,
  hora: string | null,
  regra: Regra | null,
  gasto: boolean,
): string | null {
  const passou = hora !== null && !gasto && hora <= tempo.momento().hora;
  try {
    if (regra === null) return passou ? somarDias(hoje, 1) : hoje;
    if (acertaODia(regra, hoje) && !passou) return hoje;
    return proximoDia(escreverRecorrencia(regra), hoje, hoje) ?? hoje;
  } catch (erro) {
    if (erro instanceof RangeError) return null;
    throw erro;
  }
}

/**
 * Se a regra que a frase deu cai no dia: as que não dizem o dia da semana ou do mês caem sempre.
 * A ordem ("primeira segunda") é a vez daquele dia da semana no mês.
 */
function acertaODia(regra: Regra, dia: string): boolean {
  const doMes = Number(dia.slice(8, 10));
  const total = diasNoMes(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)));
  if (regra.diasDaSemana.length > 0) {
    const sigla = SIGLAS[diaDaSemana(dia)];
    const vez = Math.ceil(doMes / 7);
    const ultima = doMes + 7 > total;
    const acerta = regra.diasDaSemana.some(
      (d) => d.dia === sigla && (d.ordem === null || d.ordem === vez || (d.ordem === -1 && ultima)),
    );
    if (!acerta) return false;
  }
  return regra.diasDoMes.length === 0 || regra.diasDoMes.includes(doMes);
}

/**
 * O título é a frase sem os trechos que viraram campo: os pedaços que sobram, com um espaço onde
 * saiu algo. O sinal colado num trecho tirado sai junto, e o conector que ficou na ponta ("45 de
 * mercado") também, menos no conteúdo da nota e da memória, que fica como foi escrito. Se não
 * sobra nada, o título é a frase inteira.
 */
function titulo(texto: string, p: readonly Palavra[], tiradas: boolean[], conectores = true): string {
  const sai = [...tiradas];
  const solta = (i: number) => PONTUACAO_SOLTA.has(p[i]!.forma);
  for (let i = 1; i < p.length; i++) if (!sai[i] && sai[i - 1] && solta(i)) sai[i] = true;
  for (let i = p.length - 2; i >= 0; i--) if (!sai[i] && sai[i + 1] && solta(i)) sai[i] = true;

  let primeira = sai.indexOf(false);
  let ultima = sai.lastIndexOf(false);
  const ponta = (i: number, encostou: boolean, lista: ReadonlySet<string>) =>
    solta(i) || (conectores && encostou && lista.has(p[i]!.forma));
  while (primeira >= 0 && primeira <= ultima && ponta(primeira, primeira > 0, CONECTORES_NO_COMECO)) {
    primeira++;
  }
  while (primeira >= 0 && ultima >= primeira && ponta(ultima, ultima < p.length - 1, CONECTORES_NO_FIM)) {
    ultima--;
  }

  let saida = "";
  let anterior = -1;
  for (let i = Math.max(primeira, 0); i <= ultima; i++) {
    if (sai[i]) continue;
    const palavra = p[i]!;
    if (anterior >= 0) {
      const tirouNoMeio = i - anterior > 1;
      saida += tirouNoMeio
        ? " "
        : texto.slice(p[anterior]!.fim, palavra.inicio).replace(/[\s\p{Cc}]+/gu, " ");
    }
    saida += texto.slice(palavra.inicio, palavra.fim);
    anterior = i;
  }
  if (primeira < 0 || saida === "") saida = texto.replace(/[\s\p{Cc}]+/gu, " ").trim();
  return cortar(saida, TAMANHO_DO_TITULO).trim();
}

function camposVazios(titulo: string): CamposCaptura {
  return {
    titulo,
    dia: null,
    hora: null,
    duracaoMin: null,
    recorrencia: null,
    lembreteMinutosAntes: null,
    listaId: null,
    valorCentavos: null,
  };
}
