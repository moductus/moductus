/**
 * Quando o limite de uso do Claude Code volta, lido da mensagem que ele escreve ao estourar.
 * As versões mudaram o texto ("Claude AI usage limit reached|1760000000", "5-hour limit reached ∙
 * resets 3am", "You've hit your limit · resets 5:40pm (America/Sao_Paulo)"), então a leitura
 * procura só as duas formas de hora: segundos Unix depois de `|`, ou "resets <hora>" com fuso
 * opcional. Sem hora reconhecível, `null`: o agente dorme até o provedor voltar, sem hora inventada.
 */

const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "resets 5pm", "resets 5:40pm", "resets 17:40", "resets Oct 10, 3pm", com "(Fuso/Nome)" opcional. */
const RESETA =
  /\breset(?:s|ting)?\s+(?:at\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i;

/** "5-hour limit reached", "Claude AI usage limit reached", "You've hit your limit". */
export function pareceLimite(texto: string): boolean {
  return /\blimit\b[^.\n]*\b(reached|exceeded)\b|\bhit your\b[^.\n]*\blimit\b/i.test(texto);
}

export function horaDeVolta(texto: string, agora: Date): string | null {
  const unix = /\|\s*(\d{10})\b/.exec(texto);
  if (unix) return new Date(Number(unix[1]) * 1000).toISOString();

  const achado = RESETA.exec(texto);
  if (!achado) return null;
  const [, mesNome, diaTexto, horaTexto, minutoTexto, periodo, fusoInformado] = achado;
  let hora = Number(horaTexto);
  const minuto = minutoTexto ? Number(minutoTexto) : 0;
  if (periodo) {
    if (hora < 1 || hora > 12) return null;
    hora = (hora % 12) + (periodo.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hora > 23 || minuto > 59) return null;
  const fuso = fusoValido(fusoInformado?.trim()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const hoje = partesNoFuso(agora.getTime(), fuso);
  if (mesNome) {
    const mes = MESES.indexOf(mesNome.toLowerCase());
    if (mes < 0) return null;
    let volta = instanteNoFuso(hoje.ano, mes, Number(diaTexto), hora, minuto, fuso);
    // "resets Jan 2" lido em dezembro é do ano que vem.
    if (volta.getTime() < agora.getTime() - 24 * 3600_000) {
      volta = instanteNoFuso(hoje.ano + 1, mes, Number(diaTexto), hora, minuto, fuso);
    }
    return volta.toISOString();
  }
  let volta = instanteNoFuso(hoje.ano, hoje.mes, hoje.dia, hora, minuto, fuso);
  // Só a hora: é a próxima vez que o relógio daquele fuso marca essa hora.
  if (volta.getTime() <= agora.getTime()) {
    volta = instanteNoFuso(hoje.ano, hoje.mes, hoje.dia + 1, hora, minuto, fuso);
  }
  return volta.toISOString();
}

function fusoValido(fuso: string | undefined): string | null {
  if (!fuso) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return null;
  }
}

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesNoFuso(instante: number, fuso: string): Partes {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instante));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  return {
    ano: valor("year"),
    mes: valor("month") - 1,
    dia: valor("day"),
    hora: valor("hour"),
    minuto: valor("minute"),
    segundo: valor("second"),
  };
}

/** Quanto o relógio do fuso está à frente do UTC naquele instante, em ms. */
function deslocamento(instante: number, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  return Date.UTC(p.ano, p.mes, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(instante / 1000) * 1000;
}

/** O instante em que o relógio do fuso marca a data e hora pedidas (mês de 0 a 11). */
function instanteNoFuso(ano: number, mes: number, dia: number, hora: number, minuto: number, fuso: string) {
  const comoUtc = Date.UTC(ano, mes, dia, hora, minuto);
  // Duas voltas acertam a hora perto de troca de horário de verão.
  let instante = comoUtc - deslocamento(comoUtc, fuso);
  instante = comoUtc - deslocamento(instante, fuso);
  return new Date(instante);
}
