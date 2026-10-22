/**
 * O dia como os painéis Hoje e Tarefas escrevem (LembreteHoje.dc.html, PainelTarefas.dc.html):
 * a data por extenso no alto, o dia curto das atrasadas e da prévia, a hora de um instante e
 * quanto falta. "Hoje" é o dia no fuso do usuário (Configurações › O dia), o mesmo que o serviço
 * usa para a vista `hoje`; o fuso do Windows só vale enquanto a configuração não chegou.
 */

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;
const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

const MINUTO = 60_000;
const DIA_MS = 86_400_000;

/** O fuso do Windows, para o painel não ficar sem data enquanto a configuração não chega. */
export function fusoLocal(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const formatos = new Map<string, Intl.DateTimeFormat>();

/** Um formatador por fuso: criar um a cada linha pesa, e o painel pinta muitas. */
function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatos.set(fuso, f);
  }
  return f;
}

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partes(instante: Date, fuso: string): Partes {
  const valores: Record<string, number> = {};
  for (const p of formato(fuso).formatToParts(instante)) {
    if (p.type !== "literal") valores[p.type] = Number(p.value);
  }
  return {
    ano: valores.year!,
    mes: valores.month!,
    dia: valores.day!,
    hora: valores.hour! % 24,
    minuto: valores.minute!,
    segundo: valores.second!,
  };
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** O dia `AAAA-MM-DD` de um instante no fuso. */
export function diaNoFuso(instante: Date, fuso: string): string {
  const p = partes(instante, fuso);
  return `${String(p.ano).padStart(4, "0")}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)}`;
}

/** A hora `HH:MM` de um instante no fuso, sempre com dois dígitos (DESIGN.md §5). */
export function horaNoFuso(instante: Date | string, fuso: string): string {
  const p = partes(new Date(instante), fuso);
  return `${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`;
}

function lerDia(dia: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, d] = dia.split("-").map(Number) as [number, number, number];
  return { ano, mes, dia: d };
}

/** O dia como um instante UTC à meia-noite, só para contar dias e achar o da semana. */
const meiaNoiteUtc = (dia: string) => {
  const d = lerDia(dia);
  return Date.UTC(d.ano, d.mes - 1, d.dia);
};

const diaDaSemana = (dia: string) => new Date(meiaNoiteUtc(dia)).getUTCDay();

/** "quinta, 8 de outubro", no alto do Hoje e do Tarefas. */
export function dataPorExtenso(dia: string): string {
  const d = lerDia(dia);
  return `${DIAS[diaDaSemana(dia)]}, ${d.dia} de ${MESES[d.mes - 1]}`;
}

/** "sex, 9 out", na prévia da frase. */
export function diaCurto(dia: string): string {
  const d = lerDia(dia);
  return `${DIAS_CURTOS[diaDaSemana(dia)]}, ${d.dia} ${MESES_CURTOS[d.mes - 1]}`;
}

/** O dia `n` dias depois (ou antes, com `n` negativo). */
export function somarDias(dia: string, n: number): string {
  const data = new Date(meiaNoiteUtc(dia) + n * DIA_MS);
  return `${String(data.getUTCFullYear()).padStart(4, "0")}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`;
}

/** Quantos dias de `de` até `ate`. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((meiaNoiteUtc(ate) - meiaNoiteUtc(de)) / DIA_MS);
}

/**
 * O dia de uma atrasada, curto para caber na coluna da hora (PainelTarefas.dc.html): "ontem", o
 * dia da semana até seis dias atrás ("ter") e, mais longe, o dia e o mês ("12 out").
 */
export function diaPassado(dia: string, hoje: string): string {
  const atras = diasEntre(dia, hoje);
  if (atras === 1) return "ontem";
  if (atras > 1 && atras < 7) return DIAS_CURTOS[diaDaSemana(dia)]!;
  const d = lerDia(dia);
  return `${d.dia} ${MESES_CURTOS[d.mes - 1]}`;
}

/** Quanto o fuso está à frente do UTC num instante, em ms. */
function deslocamento(instante: Date, fuso: string): number {
  const p = partes(instante, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * O instante em que o dia começa no fuso. Duas voltas acertam a meia-noite que cai perto de uma
 * mudança de horário de verão.
 */
export function inicioDoDia(dia: string, fuso: string): Date {
  const base = meiaNoiteUtc(dia);
  let t = base - deslocamento(new Date(base), fuso);
  t = base - deslocamento(new Date(t), fuso);
  return new Date(t);
}

/** "em 13 min" até um instante; já chegou, "agora". */
export function emQuanto(ate: Date | string, agora: Date): string {
  const falta = Math.ceil((new Date(ate).getTime() - agora.getTime()) / MINUTO);
  if (!(falta >= 1)) return "agora";
  if (falta < 60) return `em ${falta} min`;
  const horas = Math.floor(falta / 60);
  const minutos = falta % 60;
  return minutos === 0 ? `em ${horas} h` : `em ${horas}h${doisDigitos(minutos)}`;
}

/** Uma duração escrita como no LembreteHoje.dc.html: "45 min", "1h45", "2 h". */
export function duracao(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTO));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const minutos = total % 60;
  return minutos === 0 ? `${horas} h` : `${horas}h${doisDigitos(minutos)}`;
}

/** O tempo que falta no foco, como um cronômetro: "18:42", "1:05:00". */
export function cronometro(ms: number): string {
  const segundos = Math.max(0, Math.ceil(ms / 1000));
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const resto = segundos % 60;
  return horas > 0
    ? `${horas}:${doisDigitos(minutos)}:${doisDigitos(resto)}`
    : `${doisDigitos(minutos)}:${doisDigitos(resto)}`;
}

/** Minutos da hora `HH:MM`. */
export const minutosDaHora = (hora: string) => {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** A hora `HH:MM` de um total de minutos no dia. */
export const horaDosMinutos = (minutos: number) =>
  `${doisDigitos(Math.floor(minutos / 60))}:${doisDigitos(minutos % 60)}`;
