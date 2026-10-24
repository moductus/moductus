import {
  ULTIMO_NUMERO,
  diaDaSemana,
  diaDoNumero,
  diasNoMes,
  ehDia,
  instanteNoFuso,
  noFuso,
  numeroDaData,
  numeroDoDia,
} from "./tempo.ts";

/**
 * Recorrência (ADR-0034): o subconjunto de RRULE do RFC 5545 que o Moductus expande sozinho,
 * `FREQ` (DAILY, WEEKLY, MONTHLY, YEARLY), `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL` e
 * `WKST`. O que passa disso (vindo do Google) é guardado como texto e mostrado como "repete
 * (definido no Google)": o Moductus não inventa ocorrência que não sabe calcular.
 *
 * O início (o DTSTART do RFC) não mora na regra: é o dia da tarefa ou o início do evento ou do
 * lembrete. Ele conta sempre como a primeira ocorrência, como diz o RFC, e o `COUNT` o inclui.
 * A expansão anda no relógio do fuso: "toda segunda às 10h" é 10h em toda segunda, com ou sem
 * horário de verão no meio.
 */

export type Frequencia = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** Os dias da semana na ordem do `getUTCDay` (0 domingo). */
const SEMANA = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type DiaSemana = (typeof SEMANA)[number];

/** Um dia de `BYDAY`: `MO` é toda segunda; `2TU` a segunda terça e `-1FR` a última sexta do período. */
export interface DiaDaRegra {
  dia: DiaSemana;
  ordem: number | null;
}

/** O `UNTIL`: um dia, ou um dia e hora (`HH:MM:SS`) em UTC (`Z`) ou no relógio do fuso. */
export interface Ate {
  dia: string;
  hora: string | null;
  utc: boolean;
}

export interface Regra {
  frequencia: Frequencia;
  intervalo: number;
  diasDaSemana: DiaDaRegra[];
  /** `BYMONTHDAY`: 1 a 31, ou −1 a −31 contando do fim do mês. */
  diasDoMes: number[];
  contagem: number | null;
  ate: Ate | null;
  inicioDaSemana: DiaSemana;
}

export type LeituraRecorrencia =
  { entendida: true; regra: Regra; texto: string } | { entendida: false; texto: string; motivo: string };

/** Como a regra que o Moductus não expande aparece. */
export const REPETE_DEFINIDO_FORA = "repete (definido no Google)";

const FREQUENCIAS: readonly string[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const DIA_DA_REGRA = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;
const INTEIRO = /^[+-]?\d{1,3}$/;
const POSITIVO = /^\d{1,6}$/;
const UNTIL = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/;
/**
 * Mil anos depois do início, a busca desiste: regra que nunca acerta ("toda segunda" de 7 em 7
 * dias começando numa terça) não trava o serviço.
 */
const HORIZONTE_DIAS = 1000 * 366;

class ForaDoSubconjunto extends Error {}

const fora = (motivo: string): never => {
  throw new ForaDoSubconjunto(motivo);
};

/**
 * Lê o texto de uma RRULE (com ou sem o `RRULE:` na frente). O texto volta sempre como veio, para
 * ser guardado sem perda; `entendida` diz se o Moductus sabe expandir.
 */
export function lerRecorrencia(texto: string): LeituraRecorrencia {
  try {
    return { entendida: true, regra: interpretar(texto), texto };
  } catch (erro) {
    if (erro instanceof ForaDoSubconjunto) return { entendida: false, texto, motivo: erro.message };
    throw erro;
  }
}

function interpretar(texto: string): Regra {
  const limpo = texto.trim();
  if (/[\r\n]/.test(limpo)) fora("mais de uma linha (EXDATE, RDATE ou outra regra)");
  const corpo = /^RRULE:/i.test(limpo) ? limpo.slice(6) : limpo;
  if (corpo === "") fora("regra vazia");

  const partes = new Map<string, string>();
  for (const parte of corpo.split(";")) {
    const igual = parte.indexOf("=");
    if (igual <= 0) fora(`parte sem valor: ${parte}`);
    const chave = parte.slice(0, igual).toUpperCase();
    if (partes.has(chave)) fora(`${chave} repetido`);
    partes.set(chave, parte.slice(igual + 1).toUpperCase());
  }
  for (const chave of partes.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "COUNT", "UNTIL", "WKST"].includes(chave)) {
      fora(`${chave} fora do subconjunto`);
    }
  }

  const frequencia = partes.get("FREQ");
  if (frequencia === undefined || !FREQUENCIAS.includes(frequencia)) fora(`FREQ ${frequencia ?? "ausente"}`);
  const freq = frequencia as Frequencia;

  const intervaloTexto = partes.get("INTERVAL") ?? "1";
  const intervalo = Number(intervaloTexto);
  if (!POSITIVO.test(intervaloTexto) || intervalo < 1) fora(`INTERVAL ${intervaloTexto}`);

  const diasDaSemana = lista(partes.get("BYDAY")).map((item): DiaDaRegra => {
    const m = DIA_DA_REGRA.exec(item);
    if (m === null) return fora(`BYDAY ${item}`);
    if (m[1] === undefined) return { dia: m[2] as DiaSemana, ordem: null };
    const ordem = Number(m[1]);
    // O RFC só dá ordem ao BYDAY no mensal e no anual.
    const maximo = freq === "MONTHLY" ? 5 : freq === "YEARLY" ? 53 : 0;
    if (ordem === 0 || Math.abs(ordem) > maximo) fora(`BYDAY ${item} com FREQ=${freq}`);
    return { dia: m[2] as DiaSemana, ordem };
  });

  const diasDoMes = lista(partes.get("BYMONTHDAY")).map((item) => {
    const n = Number(item);
    if (!INTEIRO.test(item) || n === 0 || Math.abs(n) > 31) fora(`BYMONTHDAY ${item}`);
    return n;
  });
  // No RFC, BYMONTHDAY não se aplica à semanal.
  if (freq === "WEEKLY" && diasDoMes.length > 0) fora("BYMONTHDAY com FREQ=WEEKLY");

  const contagemTexto = partes.get("COUNT");
  const contagem = contagemTexto === undefined ? null : Number(contagemTexto);
  if (contagemTexto !== undefined && (!POSITIVO.test(contagemTexto) || contagem! < 1))
    fora(`COUNT ${contagemTexto}`);

  const ateTexto = partes.get("UNTIL");
  let ate: Ate | null = null;
  if (ateTexto !== undefined) {
    const m = UNTIL.exec(ateTexto);
    const dia = m === null ? "" : `${m[1]}-${m[2]}-${m[3]}`;
    if (m === null || !ehDia(dia)) return fora(`UNTIL ${ateTexto}`);
    if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59))
      fora(`UNTIL ${ateTexto}`);
    ate = { dia, hora: m[4] === undefined ? null : `${m[4]}:${m[5]}:${m[6]}`, utc: m[7] === "Z" };
  }
  // O RFC proíbe os dois juntos.
  if (contagem !== null && ate !== null) fora("COUNT e UNTIL juntos");

  const inicioDaSemana = partes.get("WKST") ?? "MO";
  if (!(SEMANA as readonly string[]).includes(inicioDaSemana)) fora(`WKST ${inicioDaSemana}`);

  return {
    frequencia: freq,
    intervalo,
    diasDaSemana,
    diasDoMes,
    contagem,
    ate,
    inicioDaSemana: inicioDaSemana as DiaSemana,
  };
}

function lista(valor: string | undefined): string[] {
  if (valor === undefined) return [];
  const itens = valor.split(",");
  if (itens.some((i) => i === "")) fora(`lista vazia: ${valor}`);
  return itens;
}

/** A regra em texto, na forma que o banco guarda (sem `RRULE:`): "FREQ=WEEKLY;BYDAY=MO". */
export function escreverRecorrencia(regra: Regra): string {
  const partes = [`FREQ=${regra.frequencia}`];
  if (regra.intervalo !== 1) partes.push(`INTERVAL=${regra.intervalo}`);
  if (regra.diasDaSemana.length > 0) {
    partes.push(`BYDAY=${regra.diasDaSemana.map((d) => `${d.ordem ?? ""}${d.dia}`).join(",")}`);
  }
  if (regra.diasDoMes.length > 0) partes.push(`BYMONTHDAY=${regra.diasDoMes.join(",")}`);
  if (regra.contagem !== null) partes.push(`COUNT=${regra.contagem}`);
  if (regra.ate !== null) {
    const { dia, hora, utc } = regra.ate;
    const data = dia.replaceAll("-", "");
    partes.push(`UNTIL=${hora === null ? data : `${data}T${hora.replaceAll(":", "")}${utc ? "Z" : ""}`}`);
  }
  if (regra.inicioDaSemana !== "MO") partes.push(`WKST=${regra.inicioDaSemana}`);
  return partes.join(";");
}

const NOMES_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ORDINAIS = ["primeira", "segunda", "terceira", "quarta", "quinta"];

/** "a", "a e b", "a, b e c". */
function juntar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)!}`;
}

/**
 * A regra em frase, para quem aprova ("toda segunda e quarta", "a cada 2 semanas", "todo dia 5,
 * até 30/11/2026", "toda última sexta, 10 vezes"). É a mesma leitura da forma curta da interface,
 * por extenso; o fuso não entra, porque a frase não diz hora.
 */
export function descreverRegra(regra: Regra): string {
  const n = regra.intervalo;
  const cada = (um: string, varios: string) => (n === 1 ? um : `a cada ${n} ${varios}`);
  const nome = (d: DiaDaRegra) => NOMES_DA_SEMANA[SEMANA.indexOf(d.dia)]!;
  const comOrdem = (d: DiaDaRegra) =>
    d.ordem === null
      ? nome(d)
      : `${d.ordem === -1 ? "última" : d.ordem > 0 && d.ordem <= ORDINAIS.length ? ORDINAIS[d.ordem - 1] : `${d.ordem}ª`} ${nome(d)}`;
  const dias = regra.diasDaSemana;
  // Sábado e domingo são "todo"; os outros, "toda".
  const artigo = dias.every((d) => d.ordem === null && (d.dia === "SA" || d.dia === "SU")) ? "todo" : "toda";
  let frase: string;
  switch (regra.frequencia) {
    case "DAILY":
      frase = cada("todo dia", "dias");
      break;
    case "WEEKLY":
      frase =
        dias.length === 0
          ? cada("toda semana", "semanas")
          : n === 1
            ? `${artigo} ${juntar(dias.map(nome))}`
            : `a cada ${n} semanas, ${juntar(dias.map(nome))}`;
      break;
    case "MONTHLY": {
      const positivos = regra.diasDoMes.filter((d) => d > 0);
      const contados = regra.diasDoMes
        .filter((d) => d < 0)
        .map((d) => (d === -1 ? "último dia" : `${-d}º dia antes do fim`));
      const doMes = [...(positivos.length > 0 ? [`dia ${juntar(positivos.map(String))}`] : []), ...contados];
      // "dia 5" se basta; o contado do fim e o dia da semana com ordem pedem "do mês".
      const noMes =
        doMes.length > 0
          ? `${juntar(doMes)}${contados.length > 0 ? " do mês" : ""}`
          : dias.length > 0
            ? `${juntar(dias.map(comOrdem))} do mês`
            : null;
      const artigoDoMes = doMes.length > 0 ? "todo" : artigo;
      if (noMes === null) frase = cada("todo mês", "meses");
      else frase = n === 1 ? `${artigoDoMes} ${noMes}` : `a cada ${n} meses, ${noMes}`;
      break;
    }
    case "YEARLY":
      frase = cada("todo ano", "anos");
      break;
  }
  if (regra.contagem !== null) frase += `, ${regra.contagem} ${regra.contagem === 1 ? "vez" : "vezes"}`;
  if (regra.ate !== null) {
    const [ano, mes, dia] = regra.ate.dia.split("-");
    frase += `, até ${dia}/${mes}/${ano}`;
  }
  return frase;
}

// A expansão: os dias (números desde 1970-01-01) em que a regra acontece, em ordem, a partir do
// início. O `UNTIL` fica com quem chama, que sabe se o início tem hora.

/** O dia da semana do número do dia (0 domingo): 1970-01-01 foi quinta. */
const semanaDe = (dia: number): number => (((dia + 4) % 7) + 7) % 7;

/** Ano e mês (1 a 12) do número do dia. */
function anoEMes(dia: number): [number, number] {
  const data = new Date(dia * 86_400_000);
  return [data.getUTCFullYear(), data.getUTCMonth() + 1];
}

/** O período (dia, semana, mês ou ano) em que o dia cai, contado de 1970. */
function periodoDe(regra: Regra, dia: number): number {
  switch (regra.frequencia) {
    case "DAILY":
      return dia;
    case "WEEKLY":
      // Desloca para a semana começar no WKST.
      return Math.floor((dia + 4 - SEMANA.indexOf(regra.inicioDaSemana)) / 7);
    case "MONTHLY": {
      const [ano, mes] = anoEMes(dia);
      return ano * 12 + mes - 1;
    }
    case "YEARLY":
      return anoEMes(dia)[0];
  }
}

/** O primeiro dia do período. */
function primeiroDoPeriodo(regra: Regra, periodo: number): number {
  switch (regra.frequencia) {
    case "DAILY":
      return periodo;
    case "WEEKLY":
      return periodo * 7 - 4 + SEMANA.indexOf(regra.inicioDaSemana);
    case "MONTHLY":
      return numeroDaData(Math.floor(periodo / 12), (periodo % 12) + 1, 1);
    case "YEARLY":
      return numeroDaData(periodo, 1, 1);
  }
}

/**
 * A regra pronta para expandir: o `BYDAY` agrupado por dia da semana (toda segunda, ou só as
 * ordens pedidas) e o `BYMONTHDAY` sem repetição. Item repetido não multiplica o trabalho.
 */
interface Plano {
  regra: Regra;
  /** Por dia da semana (0 domingo): `true` é todo; um conjunto, só aquelas ordens. */
  semana: Map<number, true | Set<number>>;
  diasDoMes: number[];
}

function planejar(regra: Regra): Plano {
  const semana = new Map<number, true | Set<number>>();
  for (const { dia, ordem } of regra.diasDaSemana) {
    const n = SEMANA.indexOf(dia);
    const atual = semana.get(n);
    if (ordem === null) semana.set(n, true);
    else if (atual === undefined) semana.set(n, new Set([ordem]));
    else if (atual !== true) atual.add(ordem);
  }
  return { regra, semana, diasDoMes: [...new Set(regra.diasDoMes)] };
}

/**
 * Os dias de `primeiro` a `ultimo` (um período) em que a regra acontece, em ordem. Cada dia da
 * semana é achado por conta (o primeiro dele no período e de 7 em 7), e a ordem é o índice nessa
 * lista: nada de varrer o período dia a dia.
 */
function candidatos(plano: Plano, primeiro: number, ultimo: number, inicio: number): number[] {
  const { regra } = plano;
  if (plano.semana.size === 0 && plano.diasDoMes.length === 0) return padrao(regra, primeiro, ultimo, inicio);
  // No diário o período é um dia só (e o RFC não dá ordem ao BYDAY): basta conferir o dia.
  if (regra.frequencia === "DAILY") return acertaODia(plano, primeiro) ? [primeiro] : [];

  let porSemana: Set<number> | null = null;
  if (plano.semana.size > 0) {
    porSemana = new Set();
    for (const [semana, ordens] of plano.semana) {
      const primeiraVez = primeiro + ((semana - semanaDe(primeiro) + 7) % 7);
      const vezes = primeiraVez > ultimo ? 0 : Math.floor((ultimo - primeiraVez) / 7) + 1;
      if (ordens === true) {
        for (let i = 0; i < vezes; i++) porSemana.add(primeiraVez + 7 * i);
        continue;
      }
      for (const ordem of ordens) {
        const i = ordem > 0 ? ordem - 1 : vezes + ordem;
        if (i >= 0 && i < vezes) porSemana.add(primeiraVez + 7 * i);
      }
    }
  }
  if (plano.diasDoMes.length === 0) return [...porSemana!].sort((a, b) => a - b);

  const achados: number[] = [];
  // Os meses que o período toca: um no diário e no mensal, doze no anual.
  const [anoInicial, mesInicial] = anoEMes(primeiro);
  for (let meses = anoInicial * 12 + mesInicial - 1; ; meses++) {
    const ano = Math.floor(meses / 12);
    const mes = (meses % 12) + 1;
    const inicioDoMes = numeroDaData(ano, mes, 1);
    if (inicioDoMes > ultimo) break;
    const total = diasNoMes(ano, mes);
    for (const n of plano.diasDoMes) {
      const doMes = n > 0 ? n : total + n + 1;
      if (doMes < 1 || doMes > total) continue;
      const d = inicioDoMes + doMes - 1;
      if (d >= primeiro && d <= ultimo && (porSemana === null || porSemana.has(d))) achados.push(d);
    }
  }
  return [...new Set(achados)].sort((a, b) => a - b);
}

function acertaODia(plano: Plano, dia: number): boolean {
  if (plano.semana.size > 0 && !plano.semana.has(semanaDe(dia))) return false;
  if (plano.diasDoMes.length === 0) return true;
  const data = new Date(dia * 86_400_000);
  const doMes = data.getUTCDate();
  const total = diasNoMes(data.getUTCFullYear(), data.getUTCMonth() + 1);
  return plano.diasDoMes.some((n) => (n > 0 ? n : total + n + 1) === doMes);
}

/**
 * Sem BYDAY nem BYMONTHDAY, o padrão vem do início: o mesmo dia da semana, do mês ou do ano. Mês
 * sem o dia (31 em abril, 29/02 fora do bissexto) fica sem ocorrência, como no RFC.
 */
function padrao(regra: Regra, primeiro: number, ultimo: number, inicio: number): number[] {
  if (regra.frequencia === "DAILY") return [primeiro];
  if (regra.frequencia === "WEEKLY") return [primeiro + ((semanaDe(inicio) - semanaDe(primeiro) + 7) % 7)];
  const dataInicio = new Date(inicio * 86_400_000);
  const ano = anoEMes(primeiro)[0];
  // No mensal, o mês do período; no anual, o mês do início.
  const mes = regra.frequencia === "MONTHLY" ? anoEMes(primeiro)[1] : dataInicio.getUTCMonth() + 1;
  const doMes = dataInicio.getUTCDate();
  if (doMes > diasNoMes(ano, mes)) return [];
  const d = numeroDaData(ano, mes, doMes);
  return d <= ultimo ? [d] : [];
}

/**
 * Teto de trabalho da expansão, além dos mil anos: cada período custa 1 mais os itens que a
 * regra pede nele (as ordens do BYDAY e os BYMONTHDAY de cada mês). É a rede de segurança: regra
 * que pede muito e acerta pouco para aqui em vez de travar o serviço, que é uma linha só.
 */
const TETO_DE_TRABALHO = 2_000_000;

/**
 * Os dias da regra a partir do início, em ordem, sem passar de `limite`. O início vem primeiro
 * e conta no `COUNT`; o `UNTIL` fica com quem chama, que sabe se o início tem hora. Sem `COUNT`,
 * nada antes de `desde` precisa ser contado, e a expansão já começa no período dele. O
 * calendário acaba em 9999-12-31.
 */
function* dias(regra: Regra, inicio: number, limite: number, desde: number): Generator<number> {
  if (inicio > limite) return;
  yield inicio;
  let restantes = (regra.contagem ?? Number.POSITIVE_INFINITY) - 1;
  const fim = Math.min(limite, inicio + HORIZONTE_DIAS, ULTIMO_NUMERO);
  const plano = planejar(regra);
  let itensDaSemana = 0;
  for (const ordens of plano.semana.values()) itensDaSemana += ordens === true ? 1 : ordens.size;
  const custo =
    regra.frequencia === "DAILY"
      ? 1 + Math.sign(itensDaSemana) + Math.sign(plano.diasDoMes.length)
      : 1 + itensDaSemana + plano.diasDoMes.length * (regra.frequencia === "YEARLY" ? 12 : 1);
  let periodo = periodoDe(regra, inicio);
  if (regra.contagem === null && desde > inicio) {
    const alvo = periodoDe(regra, Math.min(desde, fim));
    if (alvo > periodo) periodo += Math.floor((alvo - periodo) / regra.intervalo) * regra.intervalo;
  }
  for (let trabalho = 0; restantes > 0; periodo += regra.intervalo) {
    const primeiro = primeiroDoPeriodo(regra, periodo);
    if (primeiro > fim) return;
    trabalho += custo;
    if (trabalho > TETO_DE_TRABALHO) return;
    for (const d of candidatos(plano, primeiro, primeiroDoPeriodo(regra, periodo + 1) - 1, inicio)) {
      if (d <= inicio) continue;
      if (d > fim || restantes <= 0) return;
      yield d;
      restantes--;
    }
  }
}

/** O último dia que o `UNTIL` deixa passar, para o início sem hora (só o dia dele conta). */
function limiteDoAte(ate: Ate | null): number {
  return ate === null ? Number.POSITIVE_INFINITY : numeroDoDia(ate.dia);
}

/** O que a expansão devolve: `entendida` falso quer dizer que a regra foi guardada e não expandida. */
export interface Expansao<T> {
  ocorrencias: T[];
  entendida: boolean;
  /** Passou do `maximo` pedido: as ocorrências depois dele ficaram de fora. */
  cortada?: true;
}

/**
 * Os dias de `de` a `ate` (inclusive) em que algo que começa em `inicio` (dia sem hora: tarefa,
 * evento de dia inteiro) acontece. Sem regra, só o início; com regra fora do subconjunto, também
 * só o início, e `entendida` falso. Com `maximo`, a expansão para nele e marca `cortada`.
 */
export function diasNoIntervalo(
  recorrencia: string | null,
  inicio: string,
  de: string,
  ate: string,
  maximo = Number.POSITIVE_INFINITY,
): Expansao<string> {
  const leitura = recorrencia === null ? null : lerRecorrencia(recorrencia);
  const sozinho = (entendida: boolean): Expansao<string> => ({
    ocorrencias: inicio >= de && inicio <= ate ? [inicio] : [],
    entendida,
  });
  if (leitura === null) return sozinho(true);
  if (!leitura.entendida) return sozinho(false);
  const primeiro = numeroDoDia(inicio);
  // O início sempre conta, mesmo com um UNTIL antes dele: o item não some da agenda.
  const limite = Math.min(numeroDoDia(ate), Math.max(primeiro, limiteDoAte(leitura.regra.ate)));
  const desde = numeroDoDia(de);
  const ocorrencias: string[] = [];
  for (const d of dias(leitura.regra, primeiro, limite, desde)) {
    if (d < desde) continue;
    if (ocorrencias.length >= maximo) return { ocorrencias, entendida: true, cortada: true };
    ocorrencias.push(diaDoNumero(d));
  }
  return { ocorrencias, entendida: true };
}

/**
 * O próximo dia depois de `depoisDe` (a recorrente concluída gera a próxima). `null` quando a
 * regra acabou, quando não há regra ou quando ela está fora do subconjunto.
 */
export function proximoDia(recorrencia: string | null, inicio: string, depoisDe: string): string | null {
  const leitura = recorrencia === null ? null : lerRecorrencia(recorrencia);
  if (leitura === null || !leitura.entendida) return null;
  const primeiro = numeroDoDia(inicio);
  const limite = Math.max(primeiro, limiteDoAte(leitura.regra.ate));
  const depois = numeroDoDia(depoisDe);
  for (const d of dias(leitura.regra, primeiro, limite, depois)) {
    if (d > depois) return diaDoNumero(d);
  }
  return null;
}

/** Os instantes da regra a partir do início com hora, no relógio do fuso, até o `UNTIL`. */
function* instantes(
  regra: Regra,
  inicio: Date,
  fuso: string,
  desdeDia: number,
  ateDia: number,
): Generator<{ instante: Date; dia: string }> {
  const local = noFuso(inicio, fuso);
  const segundos = String(local.segundo).padStart(2, "0");
  const ms = String(local.milissegundo).padStart(3, "0");
  const hora = `${local.hora}:${segundos}.${ms}`;
  const primeiro = numeroDoDia(local.dia);
  const ate = regra.ate;
  // O UNTIL em UTC pode cair no dia seguinte do relógio do fuso; a conta exata vem em `passou`.
  const limiteDoUntil = ate === null ? Number.POSITIVE_INFINITY : numeroDoDia(ate.dia) + (ate.utc ? 1 : 0);
  for (const d of dias(regra, primeiro, Math.min(ateDia, Math.max(primeiro, limiteDoUntil)), desdeDia)) {
    // O início é o instante que veio e sempre conta, mesmo com um UNTIL antes dele.
    if (d === primeiro) {
      yield { instante: inicio, dia: local.dia };
      continue;
    }
    // Antes do intervalo pedido não se calcula o instante: o COUNT já andou em `dias`.
    if (d < desdeDia) continue;
    const dia = diaDoNumero(d);
    const instante = instanteNoFuso(dia, hora, fuso);
    if (ate !== null && passou(instante, dia, hora, ate)) return;
    yield { instante, dia };
  }
}

/** O instante passou do `UNTIL`: em UTC, comparando instantes; sem `Z`, no relógio do fuso. */
function passou(instante: Date, dia: string, hora: string, ate: Ate): boolean {
  if (ate.hora === null) return dia > ate.dia;
  if (ate.utc) return instante.getTime() > Date.parse(`${ate.dia}T${ate.hora}Z`);
  return `${dia}T${hora}` > `${ate.dia}T${ate.hora}.999`;
}

/**
 * Os instantes cujo dia no fuso cai de `de` a `ate` (inclusive), para o que começa com hora
 * (evento, lembrete). Sem regra, só o início; fora do subconjunto, também, com `entendida` falso.
 * Com `maximo`, a expansão para nele e marca `cortada`.
 */
export function instantesNoIntervalo(
  recorrencia: string | null,
  inicio: Date,
  fuso: string,
  de: string,
  ate: string,
  maximo = Number.POSITIVE_INFINITY,
): Expansao<Date> {
  const leitura = recorrencia === null ? null : lerRecorrencia(recorrencia);
  const diaDoInicio = noFuso(inicio, fuso).dia;
  const sozinho = (entendida: boolean): Expansao<Date> => ({
    ocorrencias: diaDoInicio >= de && diaDoInicio <= ate ? [inicio] : [],
    entendida,
  });
  if (leitura === null) return sozinho(true);
  if (!leitura.entendida) return sozinho(false);
  const ocorrencias: Date[] = [];
  for (const o of instantes(leitura.regra, inicio, fuso, numeroDoDia(de), numeroDoDia(ate))) {
    if (o.dia < de || o.dia > ate) continue;
    if (ocorrencias.length >= maximo) return { ocorrencias, entendida: true, cortada: true };
    ocorrencias.push(o.instante);
  }
  return { ocorrencias, entendida: true };
}

/**
 * O próximo instante depois de `depoisDe` (o lembrete recorrente que disparou). `null` quando a
 * regra acabou, quando não há regra ou quando ela está fora do subconjunto.
 */
export function proximoInstante(
  recorrencia: string | null,
  inicio: Date,
  fuso: string,
  depoisDe: Date,
): Date | null {
  const leitura = recorrencia === null ? null : lerRecorrencia(recorrencia);
  if (leitura === null || !leitura.entendida) return null;
  // Um dia de folga antes do dia de `depoisDe`: a hora que o horário de verão empurra muda de dia.
  const desde = numeroDoDia(noFuso(depoisDe, fuso).dia) - 1;
  for (const { instante } of instantes(leitura.regra, inicio, fuso, desde, Number.POSITIVE_INFINITY)) {
    if (instante.getTime() > depoisDe.getTime()) return instante;
  }
  return null;
}

/** O dia da semana da regra para um dia civil ("toda segunda" a partir de um dia). */
export function diaSemanaDe(dia: string): DiaSemana {
  return SEMANA[diaDaSemana(dia)]!;
}
