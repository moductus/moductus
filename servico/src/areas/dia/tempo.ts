/**
 * Dia civil e hora no fuso do usuário (ADR-0034): "hoje", "amanhã às 15h" e o expediente são
 * contados no fuso de `config` (`dia.fuso`), não no do processo, e por `Intl.DateTimeFormat`, sem
 * biblioteca de fuso. O dia sem hora é `AAAA-MM-DD` (DATA.md §1) e a hora do dia, `HH:MM`.
 */

const MS_DIA = 86_400_000;

/** O formatador de cada fuso: criar um custa caro e o mesmo fuso é lido o tempo todo. */
const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** O relógio de parede do fuso naquele instante, como se fosse UTC (ms inteiros de segundo). */
function paredeComoUtc(ms: number, fuso: string): number {
  const partes: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const p of formatador(fuso).formatToParts(ms)) {
    if (p.type !== "literal") partes[p.type] = Number(p.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = partes;
  return msUtc(year, month, day, hour, minute, second);
}

/**
 * O `Date.UTC` do ano inteiro: o `Date.UTC` lê os anos 0 a 99 como 1900 a 1999, o
 * `setUTCFullYear` não. O mês vai de 1 a 12 e transborda como no `Date.UTC` (13 é janeiro do ano
 * seguinte).
 */
function msUtc(ano: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0, ms = 0): number {
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia);
  data.setUTCHours(hora, minuto, segundo, ms);
  return data.getTime();
}

/** Quanto o fuso está à frente do UTC naquele instante, em ms (São Paulo hoje: −3 h). */
export function deslocamento(instante: Date, fuso: string): number {
  const ms = instante.getTime();
  const segundoInteiro = Math.floor(ms / 1000) * 1000;
  return paredeComoUtc(segundoInteiro, fuso) - segundoInteiro;
}

/** Um instante lido no fuso: o dia civil, a hora e o dia da semana (0 domingo a 6 sábado). */
export interface NoFuso {
  dia: string;
  /** `HH:MM`. */
  hora: string;
  segundo: number;
  milissegundo: number;
  diaDaSemana: number;
}

export function noFuso(instante: Date, fuso: string): NoFuso {
  const parede = new Date(instante.getTime() + deslocamento(instante, fuso));
  return {
    dia: parede.toISOString().slice(0, 10),
    hora: parede.toISOString().slice(11, 16),
    segundo: parede.getUTCSeconds(),
    milissegundo: parede.getUTCMilliseconds(),
    diaDaSemana: parede.getUTCDay(),
  };
}

/** O dia civil do instante no fuso. */
export function diaNoFuso(instante: Date, fuso: string): string {
  return noFuso(instante, fuso).dia;
}

/** A hora `HH:MM` do instante no fuso. */
export function horaNoFuso(instante: Date, fuso: string): string {
  return noFuso(instante, fuso).hora;
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{3}))?)?$/;

/**
 * O instante em que o relógio do fuso marca `hora` (`HH:MM`, `HH:MM:SS` ou `HH:MM:SS.mmm`) no
 * dia. Na hora que o horário de verão pula, vale a mesma distância depois do pulo (00:30 que não
 * existe vira 01:30), e na hora que se repete, a primeira vez, como o `compatible` do Temporal.
 */
export function instanteNoFuso(dia: string, hora: string, fuso: string): Date {
  const h = HORA.exec(hora);
  if (h === null) throw new RangeError(`hora inválida: ${hora}`);
  const [ano, mes, d] = partesDoDia(dia);
  const alvo = msUtc(ano, mes, d, Number(h[1]), Number(h[2]), Number(h[3] ?? 0), Number(h[4] ?? 0));
  // Uma virada de fuso por dia, no máximo: o deslocamento de antes e o de depois cobrem o caso.
  const antes = deslocamento(new Date(alvo - MS_DIA), fuso);
  const depois = deslocamento(new Date(alvo + MS_DIA), fuso);
  const candidatos = [alvo - antes, alvo - depois].filter(
    (c) => deslocamento(new Date(c), fuso) === alvo - c,
  );
  if (candidatos.length === 0) return new Date(alvo - antes);
  return new Date(Math.min(...candidatos));
}

/** O primeiro instante do dia no fuso (meia-noite, ou a primeira hora que existe). */
export function inicioDoDia(dia: string, fuso: string): Date {
  return instanteNoFuso(dia, "00:00", fuso);
}

// Aritmética do dia civil, sem fuso: o dia é um número de dias desde 1970-01-01.

/**
 * O calendário vai de 0001-01-01 a 9999-12-31: quatro dígitos no `AAAA-MM-DD`, e o ano 0000 fica
 * fora porque o `Intl` o escreve como ano 1 (antes de Cristo, sem a era) e o dia sairia trocado.
 */
const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesDoDia(dia: string): [number, number, number] {
  const m = DIA.exec(dia);
  const ano = Number(m?.[1]);
  const mes = Number(m?.[2]);
  const d = Number(m?.[3]);
  if (m === null || ano < 1 || mes < 1 || mes > 12 || d < 1 || d > diasNoMes(ano, mes)) {
    throw new RangeError(`dia inválido: ${dia}`);
  }
  return [ano, mes, d];
}

/** O número de dias desde 1970-01-01 do dia (ano, mês de 1 a 12, dia), transbordando o mês. */
export function numeroDaData(ano: number, mes: number, dia: number): number {
  return msUtc(ano, mes, dia) / MS_DIA;
}

/** O primeiro e o último dia do calendário, como número de dias desde 1970-01-01. */
export const PRIMEIRO_NUMERO = numeroDaData(1, 1, 1);
export const ULTIMO_NUMERO = numeroDaData(9999, 12, 31);

/** Se o texto é um dia que existe no calendário (`2027-02-29` não é). */
export function ehDia(texto: string): boolean {
  try {
    partesDoDia(texto);
    return true;
  } catch {
    return false;
  }
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Quantos dias tem o mês (1 a 12) do ano. */
export function diasNoMes(ano: number, mes: number): number {
  return [31, ehBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1] ?? 0;
}

/** O dia como número de dias desde 1970-01-01. */
export function numeroDoDia(dia: string): number {
  const [ano, mes, d] = partesDoDia(dia);
  return numeroDaData(ano, mes, d);
}

/** O dia de um número de dias desde 1970-01-01; fora do calendário (ano 10000), erro. */
export function diaDoNumero(numero: number): string {
  if (!Number.isInteger(numero) || numero < PRIMEIRO_NUMERO || numero > ULTIMO_NUMERO) {
    throw new RangeError(`dia fora do calendário: ${numero}`);
  }
  return new Date(numero * MS_DIA).toISOString().slice(0, 10);
}

export function somarDias(dia: string, dias: number): string {
  return diaDoNumero(numeroDoDia(dia) + dias);
}

/** Quantos dias de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return numeroDoDia(ate) - numeroDoDia(de);
}

/** O dia da semana do dia civil: 0 domingo a 6 sábado. */
export function diaDaSemana(dia: string): number {
  return new Date(numeroDoDia(dia) * MS_DIA).getUTCDay();
}

/**
 * O tempo do dia de quem usa: o fuso vem de `config` a cada pergunta (mudou no Sistema, vale na
 * hora) e o relógio entra por parâmetro para o teste.
 */
export class TempoDoDia {
  constructor(
    private readonly lerFuso: () => string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get fuso(): string {
    return this.lerFuso();
  }

  hoje(): string {
    return diaNoFuso(this.agora(), this.fuso);
  }

  amanha(): string {
    return somarDias(this.hoje(), 1);
  }

  /** Agora lido no fuso. */
  momento(): NoFuso {
    return noFuso(this.agora(), this.fuso);
  }

  diaDe(instante: Date): string {
    return diaNoFuso(instante, this.fuso);
  }

  horaDe(instante: Date): string {
    return horaNoFuso(instante, this.fuso);
  }

  /** O instante de `hora` no dia, no fuso. */
  instante(dia: string, hora: string): Date {
    return instanteNoFuso(dia, hora, this.fuso);
  }

  inicioDoDia(dia: string): Date {
    return inicioDoDia(dia, this.fuso);
  }
}
