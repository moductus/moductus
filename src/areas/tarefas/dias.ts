/**
 * Os dias da área Tarefas, no fuso do usuário (Configurações › Dia). Quem decide o que é "hoje"
 * para cada recorte é o serviço (`tarefas.listar` com `vista`); aqui só se escreve o dia de cada
 * linha ("ter", "veio de ontem", "sexta, 9 out") a partir do mesmo fuso, para a tela dizer o que o
 * serviço contou. Dia é `AAAA-MM-DD`, como no contrato.
 */

const DIA_MS = 86_400_000;

const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const MES_CURTO = [
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

function partes(dia: string): [number, number, number] {
  const [a, m, d] = dia.split("-").map(Number);
  return [a ?? 0, m ?? 1, d ?? 1];
}

const emUtc = (dia: string) => {
  const [a, m, d] = partes(dia);
  return Date.UTC(a, m - 1, d);
};

/** O dia de um instante num fuso; fuso que o navegador não conhece cai no relógio da máquina. */
export function diaNoFuso(instante: Date, fuso: string): string {
  return relogioNoFuso(instante, fuso).dia;
}

/** O dia e a hora (`HH:MM`) de um instante no fuso. */
export function relogioNoFuso(instante: Date, fuso: string): { dia: string; hora: string } {
  let campos: Intl.DateTimeFormatPart[];
  try {
    campos = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instante);
  } catch {
    campos = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instante);
  }
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => campos.find((c) => c.type === tipo)?.value ?? "00";
  return {
    dia: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

export function somarDias(dia: string, dias: number): string {
  return new Date(emUtc(dia) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Quantos dias de `de` até `ate` (negativo quando `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((emUtc(ate) - emUtc(de)) / DIA_MS);
}

const diaDaSemana = (dia: string) => new Date(emUtc(dia)).getUTCDay();

/** "9 out". */
function diaEMes(dia: string): string {
  const [, m, d] = partes(dia);
  return `${d} ${MES_CURTO[m - 1]}`;
}

/** O dia como o "Entendi:" mostra: "sexta, 9 out" (o dia certo, não "amanhã", para conferir). */
export function diaPorExtenso(dia: string): string {
  return `${SEMANA[diaDaSemana(dia)]}, ${diaEMes(dia)}`;
}

/** A data do cabeçalho da página ("Quinta, 8 de outubro"), como o `dataCurta` das áreas. */
export function dataDoDia(dia: string): Date {
  const [a, m, d] = partes(dia);
  return new Date(a, m - 1, d, 12);
}

/**
 * O dia na coluna estreita da linha: "ter" na semana em volta de hoje, "9 out" fora dela. A hora
 * fica para o recorte de um dia só, que já diz o dia no grupo.
 */
export function diaCurto(dia: string, hoje: string): string {
  const distancia = Math.abs(diasEntre(hoje, dia));
  return distancia < 7 ? SEMANA_CURTA[diaDaSemana(dia)]! : diaEMes(dia);
}

/** A marca da atrasada (AreaTarefas): "veio de ontem", "veio de terça", "veio de 2 out". */
export function veioDe(dia: string, hoje: string): string {
  const atras = diasEntre(dia, hoje);
  if (atras === 1) return "veio de ontem";
  if (atras > 1 && atras < 7) return `veio de ${SEMANA[diaDaSemana(dia)]}`;
  return `veio de ${diaEMes(dia)}`;
}

/** Os dias do `BYDAY`, na ordem do `getUTCDay`. */
const DIAS_REGRA = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * A repetição em texto curto, a partir da RRULE: "repete todo mês", "repete toda segunda",
 * "repete a cada 2 semanas". O que não cabe nessas formas fica só "repete": o serviço é quem
 * expande a regra, a tela só a anuncia.
 */
export function descreverRecorrencia(regra: string): string {
  const campos = new Map<string, string>();
  for (const parte of regra.replace(/^RRULE:/i, "").split(";")) {
    const [chave, valor] = parte.split("=");
    if (chave && valor) campos.set(chave.trim().toUpperCase(), valor.trim().toUpperCase());
  }
  const intervalo = Number(campos.get("INTERVAL") ?? "1");
  const cada = Number.isInteger(intervalo) && intervalo > 1 ? intervalo : 1;
  // Só o dia simples ("MO"); "2TU" (a segunda terça) não tem índice e cai na forma geral.
  const dias = (campos.get("BYDAY") ?? "")
    .split(",")
    .filter(Boolean)
    .map((d) => DIAS_REGRA.indexOf(d));
  switch (campos.get("FREQ")) {
    case "DAILY":
      return cada === 1 ? "repete todo dia" : `repete a cada ${cada} dias`;
    case "WEEKLY": {
      if (cada === 1 && dias.length > 0 && dias.every((d) => d >= 0)) {
        const [unico] = dias;
        if (dias.length === 1 && unico !== undefined) {
          // Sábado e domingo são "todo"; os outros, "toda".
          return `repete ${unico === 0 || unico === 6 ? "todo" : "toda"} ${SEMANA[unico]}`;
        }
        const curtos = dias.map((d) => SEMANA_CURTA[d]);
        return `repete ${curtos.slice(0, -1).join(", ")} e ${curtos.at(-1)}`;
      }
      return cada === 1 ? "repete toda semana" : `repete a cada ${cada} semanas`;
    }
    case "MONTHLY":
      return cada === 1 ? "repete todo mês" : `repete a cada ${cada} meses`;
    case "YEARLY":
      return cada === 1 ? "repete todo ano" : `repete a cada ${cada} anos`;
    default:
      return "repete";
  }
}

/** "30 min", "1 h", "1 h 30". */
export function descreverDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** "15 min antes", "1 h antes", "1 dia antes"; zero é "na hora". */
export function descreverAntecedencia(minutos: number): string {
  if (minutos === 0) return "na hora";
  if (minutos % 1440 === 0) {
    const d = minutos / 1440;
    return `${d} ${d === 1 ? "dia" : "dias"} antes`;
  }
  if (minutos >= 60) return `${descreverDuracao(minutos)} antes`;
  return `${minutos} min antes`;
}
