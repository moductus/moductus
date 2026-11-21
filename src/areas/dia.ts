import type { PreviaCaptura, TipoCaptura, TipoLancavel } from "@moductus/contrato";

/**
 * O dia como as telas escrevem (captura, Tarefas, painel): o dia e a hora no fuso do usuário, os
 * dias curtos e por extenso, minutos, antecedência, repetição, o "criada" depois do Enter e a regra
 * do Enter sobre a prévia. Quem decide recorte, regra e repetição é o serviço; aqui só o texto. Dia
 * é `AAAA-MM-DD`, como no contrato, no calendário 0001–9999 do serviço.
 */

// ---------- Fuso ----------

const CAMPOS_RELOGIO: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/**
 * O dia e a hora (`HH:MM`) de um instante no fuso; sem fuso, ou com um que o navegador não
 * conhece, o relógio do Windows.
 */
export function relogioNoFuso(instante: Date, fuso: string | null): { dia: string; hora: string } {
  let campos: Intl.DateTimeFormatPart[];
  try {
    campos = new Intl.DateTimeFormat("en-CA", {
      ...CAMPOS_RELOGIO,
      timeZone: fuso ?? undefined,
    }).formatToParts(instante);
  } catch {
    campos = new Intl.DateTimeFormat("en-CA", CAMPOS_RELOGIO).formatToParts(instante);
  }
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => campos.find((c) => c.type === tipo)?.value ?? "00";
  return {
    dia: `${valor("year").padStart(4, "0")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

/** Hoje no fuso da configuração (o mesmo do serviço). */
export const hojeNoFuso = (agora: Date, fuso: string | null): string => relogioNoFuso(agora, fuso).dia;

/** O dia e a hora do relógio como milissegundos UTC, sem fuso nenhum. */
function msDoRelogio(dia: string, hora: string): number {
  const p = partesDoDia(dia);
  const [h = 0, m = 0] = hora.split(":").map(Number);
  const d = new Date(0);
  d.setUTCFullYear(p.ano, p.mes - 1, p.dia);
  d.setUTCHours(h, m, 0, 0);
  return d.getTime();
}

/**
 * O instante (no formato do banco) em que o relógio do fuso marca `dia` e `hora`: a inversa de
 * {@link relogioNoFuso}. Na hora que não existe (o pulo do horário de verão), a mais próxima depois.
 */
export function instanteNoFuso(dia: string, hora: string, fuso: string | null): string {
  const alvo = msDoRelogio(dia, hora);
  let ms = alvo;
  // Duas voltas acertam a diferença do fuso; a terceira cobre a virada do horário de verão.
  for (let i = 0; i < 3; i++) {
    const visto = relogioNoFuso(new Date(ms), fuso);
    const erro = alvo - msDoRelogio(visto.dia, visto.hora);
    if (erro === 0) break;
    ms += erro;
  }
  return new Date(ms).toISOString();
}

// ---------- Contas de dia ----------

const DIA_MS = 86_400_000;
const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export const MESES = [
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

/** Ano, mês e dia de um `AAAA-MM-DD`. */
export function partesDoDia(dia: string): { ano: number; mes: number; dia: number } {
  const [a, m, d] = dia.split("-").map(Number);
  return { ano: a ?? 1, mes: m ?? 1, dia: d ?? 1 };
}

/** O dia do calendário em UTC; `setUTCFullYear` não leva o ano 0050 para 1950. */
function data(dia: string): Date {
  const p = partesDoDia(dia);
  const d = new Date(0);
  d.setUTCFullYear(p.ano, p.mes - 1, p.dia);
  return d;
}

function iso(d: Date): string {
  const ano = String(d.getUTCFullYear()).padStart(4, "0");
  return `${ano}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Se ano, mês e dia formam um dia que existe no calendário 0001–9999. */
export function ehDiaDoCalendario(ano: number, mes: number, dia: number): boolean {
  if (ano < 1 || ano > 9999 || mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** O `AAAA-MM-DD` de ano, mês e dia. */
export function diaDoCalendario(ano: number, mes: number, dia: number): string {
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  return iso(d);
}

export function somarDias(dia: string, dias: number): string {
  const d = data(dia);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/** Quantos dias de `de` até `ate` (negativo quando `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((data(ate).getTime() - data(de).getTime()) / DIA_MS);
}

/** O dia no relógio local, ao meio-dia, para o cabeçalho das páginas ("Quinta, 8 de outubro"). */
export function dataDoDia(dia: string): Date {
  const p = partesDoDia(dia);
  const d = new Date(2000, p.mes - 1, p.dia, 12);
  d.setFullYear(p.ano);
  return d;
}

/** "9 out", com o ano quando não é o de `hoje`. */
function diaEMes(dia: string, hoje: string): string {
  const d = data(dia);
  const texto = `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === partesDoDia(hoje).ano ? texto : `${texto} ${d.getUTCFullYear()}`;
}

/** "Hoje", "Amanhã" ou "sex, 9 out" (com o ano quando não é o de hoje), como no PainelTarefas. */
export function formatarDia(dia: string, hoje: string): string {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, 1)) return "Amanhã";
  return `${SEMANA_CURTA[data(dia).getUTCDay()]}, ${diaEMes(dia, hoje)}`;
}

/** O dia como o "Entendi:" das Tarefas mostra: "sexta, 9 out", o dia certo, não "amanhã". */
export function diaPorExtenso(dia: string, hoje: string): string {
  return `${SEMANA[data(dia).getUTCDay()]}, ${diaEMes(dia, hoje)}`;
}

/** A coluna estreita da linha: "ter" na semana em volta de hoje, "9 out" fora dela. */
export function diaCurto(dia: string, hoje: string): string {
  return Math.abs(diasEntre(hoje, dia)) < 7 ? SEMANA_CURTA[data(dia).getUTCDay()]! : diaEMes(dia, hoje);
}

/** A marca da atrasada (AreaTarefas): "veio de ontem", "veio de terça", "veio de 2 out". */
export function veioDe(dia: string, hoje: string): string {
  const atras = diasEntre(dia, hoje);
  if (atras === 1) return "veio de ontem";
  if (atras > 1 && atras < 7) return `veio de ${SEMANA[data(dia).getUTCDay()]}`;
  return `veio de ${diaEMes(dia, hoje)}`;
}

// ---------- Minutos e repetição ----------

/** "15 min", "1 h", "1 h 30", "2 dias". */
export function formatarMinutos(minutos: number): string {
  if (minutos >= 1440 && minutos % 1440 === 0) {
    const dias = minutos / 1440;
    return dias === 1 ? "1 dia" : `${dias} dias`;
  }
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** A antecedência: "15 min antes", "1 dia antes"; zero é "na hora". */
export function formatarAntes(minutos: number): string {
  return minutos === 0 ? "na hora" : `${formatarMinutos(minutos)} antes`;
}

const DIAS_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** O que a forma curta sabe dizer; com qualquer outra parte, a regra fica só "repete". */
const PARTES_CONHECIDAS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "WKST", "COUNT", "UNTIL"]);

/**
 * A repetição em poucas palavras ("todo dia", "toda seg, qua", "todo dia 5", "a cada 2 semanas").
 * Regra que foge disso fica "repete": quem entende a regra inteira é o serviço.
 */
export function formatarRepeticao(regra: string): string {
  const pares = new Map(
    regra
      .replace(/^RRULE:/i, "")
      .split(";")
      .filter((p) => p.trim() !== "")
      .map((p) => p.split("=") as [string, string | undefined])
      .map(([k, v]) => [k.trim().toUpperCase(), (v ?? "").trim().toUpperCase()]),
  );
  if ([...pares.keys()].some((k) => !PARTES_CONHECIDAS.has(k))) return "repete";
  const intervalo = Number(pares.get("INTERVAL") ?? "1") || 1;
  const cada = (um: string, varios: string) => (intervalo === 1 ? um : `a cada ${intervalo} ${varios}`);
  const codigos = (pares.get("BYDAY") ?? "").split(",").filter(Boolean);
  // "2TU" (a segunda terça) não cabe na forma curta.
  const dias = [...new Set(codigos.map((d) => DIAS_RRULE.indexOf(d)))];
  switch (pares.get("FREQ")) {
    case "DAILY":
      return cada("todo dia", "dias");
    case "WEEKLY":
      if (codigos.length > 0 && intervalo === 1) {
        if (dias.some((d) => d < 0)) return "repete";
        // Sábado e domingo são "todo"; os outros, "toda".
        const [unico] = dias;
        if (dias.length === 1 && (unico === 0 || unico === 6)) return `todo ${SEMANA_CURTA[unico]}`;
        return `toda ${dias.map((d) => SEMANA_CURTA[d]).join(", ")}`;
      }
      return cada("toda semana", "semanas");
    case "MONTHLY": {
      if (codigos.length > 0) return "repete";
      const noDia = pares.get("BYMONTHDAY");
      if (noDia && /^\d+(,\d+)*$/.test(noDia) && intervalo === 1)
        return `todo dia ${noDia.split(",").join(", ")}`;
      return noDia ? "repete" : cada("todo mês", "meses");
    }
    case "YEARLY":
      return cada("todo ano", "anos");
    default:
      return "repete";
  }
}

/** A repetição numa linha de tarefa: "repete todo mês", "repete toda seg". */
export function repeticaoNaLinha(regra: string): string {
  const curta = formatarRepeticao(regra);
  return curta === "repete" ? curta : `repete ${curta}`;
}

// ---------- A prévia da captura ----------

export const NOME_DO_TIPO: Readonly<Record<TipoCaptura, string>> = {
  tarefa: "Tarefa",
  lembrete: "Lembrete",
  evento: "Evento",
  nota: "Nota",
  gasto: "Gasto",
  memoria: "Memória",
};

/** "Tarefa criada", "Lembrete criado": o que a tela diz depois do Enter. */
export function lancado(tipo: TipoLancavel): string {
  return tipo === "tarefa" || tipo === "nota"
    ? `${NOME_DO_TIPO[tipo]} criada`
    : `${NOME_DO_TIPO[tipo]} criado`;
}

/** "Desfeito: a tarefa saiu.", o fim do desfazer. */
export function desfeito(tipo: TipoLancavel): string {
  const artigo = tipo === "tarefa" || tipo === "nota" ? "a" : "o";
  return `Desfeito: ${artigo} ${NOME_DO_TIPO[tipo].toLowerCase()} saiu.`;
}

/** O que a pessoa viu: o tipo e os campos. Duas prévias iguais nisso lançam o mesmo. */
export function mesmaPrevia(a: PreviaCaptura, b: PreviaCaptura): boolean {
  return a.tipo === b.tipo && JSON.stringify(a.campos) === JSON.stringify(b.campos);
}

/**
 * A regra do Enter: só lança o que está na tela. A prévia mostrada da própria frase vale; com ela
 * atrasada (de outra frase) ou ausente, pede a nova (quem pede também a mostra) e lança só se ela
 * disser o mesmo que a pessoa viu. `null` é "mostrou a nova, espere outro Enter".
 */
export async function previaDoEnter(
  frase: string,
  mostrada: PreviaCaptura | null,
  pedirNova: () => Promise<PreviaCaptura | null>,
): Promise<PreviaCaptura | null> {
  if (mostrada !== null && mostrada.texto === frase) return mostrada;
  const nova = await pedirNova();
  if (nova === null || mostrada === null || !mesmaPrevia(mostrada, nova)) return null;
  return nova;
}
