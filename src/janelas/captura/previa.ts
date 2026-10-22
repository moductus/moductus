import type {
  CampoCaptura,
  CamposCaptura,
  Lista,
  PreviaCaptura,
  TipoCaptura,
  TipoLancavel,
} from "@moductus/contrato";

/**
 * A prévia da captura como a janela mostra (Captura.dc.html): o nome do tipo, quem entendeu, os
 * campos de cada tipo e o texto de cada campo. Quem entende a frase e quem confere o que dá para
 * lançar é o serviço (`captura.entender`, `captura.lancar`); aqui só o que vai na tela e a leitura
 * do que a pessoa digitou num campo depois do Tab, nos formatos que a própria tela mostra.
 */

export const NOME_DO_TIPO: Readonly<Record<TipoCaptura, string>> = {
  tarefa: "Tarefa",
  lembrete: "Lembrete",
  evento: "Evento",
  nota: "Nota",
  gasto: "Gasto",
  memoria: "Memória",
};

/** A área que recebe cada tipo, o sujeito do "entendeu como" ("Finanças entendeu como Gasto"). */
export const AREA_DO_TIPO: Readonly<Record<TipoCaptura, string>> = {
  tarefa: "Tarefas",
  lembrete: "Tarefas",
  evento: "Agenda",
  nota: "Notas",
  gasto: "Finanças",
  memoria: "Memória",
};

const LANCAVEIS: readonly TipoCaptura[] = ["tarefa", "lembrete", "evento", "nota"];

export function ehLancavel(tipo: TipoCaptura): tipo is TipoLancavel {
  return LANCAVEIS.includes(tipo);
}

/** "Tarefas entendeu como", "Alba entendeu como" quando foi o modelo, "Vai como" depois da troca. */
export function quemEntendeu(previa: PreviaCaptura, tipo: TipoCaptura): string {
  if (tipo !== previa.tipo) return "Vai como";
  const quem = previa.entendidoPor === "modelo" ? "Alba" : AREA_DO_TIPO[previa.tipo];
  return `${quem} entendeu como`;
}

/**
 * O "Na verdade é" depois de escolher outro tipo: o que o serviço ofereceu, com o tipo que ele
 * entendeu de volta no lugar do escolhido (se for lançável). Nada fora do que ele ofereceu entra:
 * o lembrete que ele tirou (o aviso cairia em outro dia) continua fora.
 */
export function alternativasPara(previa: PreviaCaptura, tipo: TipoCaptura): TipoLancavel[] {
  if (tipo === previa.tipo) return previa.alternativas;
  const outras = previa.alternativas.filter((t) => t !== tipo);
  return ehLancavel(previa.tipo) ? [previa.tipo, ...outras] : outras;
}

// ---------- Campos ----------

/** Os campos que a pessoa corrige com Tab. */
export type CampoEditavel = Extract<
  CampoCaptura,
  "titulo" | "dia" | "hora" | "duracaoMin" | "lembreteMinutosAntes" | "listaId"
>;

export interface CampoMostrado {
  campo: CampoCaptura;
  rotulo: string;
  /** Repetição e valor do gasto só aparecem: a frase é que muda os dois. */
  editavel: boolean;
}

const EDITAVEIS: readonly CampoCaptura[] = [
  "titulo",
  "dia",
  "hora",
  "duracaoMin",
  "lembreteMinutosAntes",
  "listaId",
];

export function ehEditavel(campo: CampoCaptura): campo is CampoEditavel {
  return EDITAVEIS.includes(campo);
}

const ROTULO: Readonly<Record<CampoCaptura, string>> = {
  titulo: "Título",
  dia: "Dia",
  hora: "Hora",
  duracaoMin: "Duração",
  recorrencia: "Repete",
  lembreteMinutosAntes: "Lembrete",
  listaId: "Lista",
  valorCentavos: "Valor",
};

/**
 * Os campos de cada tipo, na ordem da tela: os que o tipo precisa sempre (o lembrete pede dia e
 * hora, então os dois aparecem vazios para o Tab) e os que a frase deu além deles. Gasto e memória
 * ainda não se lançam: os campos só mostram o que foi entendido.
 */
export function camposDoTipo(tipo: TipoCaptura, campos: CamposCaptura): CampoMostrado[] {
  const lista: CampoCaptura[] = (() => {
    switch (tipo) {
      case "tarefa":
        return ["titulo", "dia", "hora", "listaId", "duracaoMin", "lembreteMinutosAntes", "recorrencia"];
      case "lembrete":
        return ["titulo", "dia", "hora", "lembreteMinutosAntes", "recorrencia"];
      case "evento":
        return ["titulo", "dia", "hora", "duracaoMin", "lembreteMinutosAntes", "recorrencia"];
      case "nota":
      case "memoria":
        return ["titulo"];
      case "gasto":
        return ["valorCentavos", "titulo", "dia"];
    }
  })();
  // Fora do essencial de cada tipo, o campo só aparece quando a frase disse alguma coisa.
  const opcionais: Partial<Record<TipoCaptura, readonly CampoCaptura[]>> = {
    tarefa: ["duracaoMin", "lembreteMinutosAntes", "recorrencia"],
    lembrete: ["lembreteMinutosAntes", "recorrencia"],
    evento: ["lembreteMinutosAntes", "recorrencia"],
  };
  const soComValor = opcionais[tipo] ?? [];
  const lancavel = ehLancavel(tipo);
  return lista
    .filter((c) => !soComValor.includes(c) || campos[c] !== null)
    .map((c) => ({ campo: c, rotulo: ROTULO[c], editavel: lancavel && ehEditavel(c) }));
}

/** O que a tela precisa saber para escrever e ler um campo. */
export interface Contexto {
  /** Hoje no fuso do usuário, `AAAA-MM-DD`. */
  hoje: string;
  listas: readonly Pick<Lista, "id" | "nome">[];
}

/** Hoje no fuso da configuração (o mesmo do serviço); sem fuso conhecido, o do Windows. */
export function hojeNoFuso(agora: Date, fuso: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(agora);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
      agora,
    );
  }
}

const DIA_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function partes(dia: string): { ano: number; mes: number; dia: number } {
  const [a, m, d] = dia.split("-").map(Number);
  return { ano: a!, mes: m!, dia: d! };
}

/** O dia do calendário em UTC, para somar e comparar sem o fuso de quem roda. */
function data(dia: string): Date {
  const p = partes(dia);
  const d = new Date(0);
  d.setUTCFullYear(p.ano, p.mes - 1, p.dia);
  return d;
}

function iso(d: Date): string {
  const ano = String(d.getUTCFullYear()).padStart(4, "0");
  return `${ano}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function somarDias(dia: string, n: number): string {
  const d = data(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** "Hoje", "Amanhã" ou "sex, 9 out" (com o ano quando não é o de hoje), como no PainelTarefas. */
export function formatarDia(dia: string, hoje: string): string {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, 1)) return "Amanhã";
  const d = data(dia);
  const texto = `${DIA_DA_SEMANA[d.getUTCDay()]}, ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === partes(hoje).ano ? texto : `${texto} ${d.getUTCFullYear()}`;
}

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

function formatarAntes(minutos: number): string {
  return minutos === 0 ? "na hora" : `${formatarMinutos(minutos)} antes`;
}

const DIAS_RRULE: Readonly<Record<string, string>> = {
  SU: "dom",
  MO: "seg",
  TU: "ter",
  WE: "qua",
  TH: "qui",
  FR: "sex",
  SA: "sáb",
};

/**
 * A repetição em poucas palavras ("toda seg, qua", "todo dia", "a cada 2 semanas"). Regra que foge
 * disso fica "repete": quem entende a regra inteira é o serviço.
 */
export function formatarRepeticao(regra: string): string {
  const pares = new Map(
    regra
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("=") as [string, string | undefined])
      .map(([k, v]) => [k.trim().toUpperCase(), (v ?? "").trim().toUpperCase()]),
  );
  const intervalo = Number(pares.get("INTERVAL") ?? "1") || 1;
  const cada = (um: string, varios: string) => (intervalo === 1 ? um : `a cada ${intervalo} ${varios}`);
  const dias = (pares.get("BYDAY") ?? "")
    .split(",")
    .map((d) => DIAS_RRULE[d.replace(/^[+-]?\d+/, "")])
    .filter(Boolean);
  switch (pares.get("FREQ")) {
    case "DAILY":
      return cada("todo dia", "dias");
    case "WEEKLY":
      if (dias.length > 0 && intervalo === 1) return `toda ${dias.join(", ")}`;
      return cada("toda semana", "semanas");
    case "MONTHLY": {
      const noDia = pares.get("BYMONTHDAY");
      if (noDia && /^\d+$/.test(noDia) && intervalo === 1) return `todo dia ${noDia}`;
      return cada("todo mês", "meses");
    }
    case "YEARLY":
      return cada("todo ano", "anos");
    default:
      return "repete";
  }
}

const REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** O texto do campo na tela; vazio quando a frase não disse (o espaço mostra o "sem dia"). */
export function formatarCampo(campo: CampoCaptura, campos: CamposCaptura, contexto: Contexto): string {
  switch (campo) {
    case "titulo":
      return campos.titulo;
    case "dia":
      return campos.dia === null ? "" : formatarDia(campos.dia, contexto.hoje);
    case "hora":
      return campos.hora ?? "";
    case "duracaoMin":
      return campos.duracaoMin === null ? "" : formatarMinutos(campos.duracaoMin);
    case "lembreteMinutosAntes":
      return campos.lembreteMinutosAntes === null ? "" : formatarAntes(campos.lembreteMinutosAntes);
    case "recorrencia":
      return campos.recorrencia === null ? "" : formatarRepeticao(campos.recorrencia);
    case "listaId":
      if (campos.listaId === null) return "Entrada";
      return contexto.listas.find((l) => l.id === campos.listaId)?.nome ?? "Outra lista";
    case "valorCentavos":
      return campos.valorCentavos === null ? "" : REAIS.format(campos.valorCentavos / 100);
  }
}

/** O que aparece no campo vazio, dizendo o que ele aceita. */
export function exemploDoCampo(campo: CampoCaptura, tipo: TipoCaptura): string {
  switch (campo) {
    case "dia":
      return "sem dia";
    case "hora":
      return tipo === "evento" ? "dia inteiro" : "sem hora";
    case "duracaoMin":
      return tipo === "evento" ? "1 h" : "sem duração";
    case "lembreteMinutosAntes":
      return "na hora";
    default:
      return "";
  }
}

// ---------- Ler o que a pessoa digitou ----------

export type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const sem = (texto: string) =>
  texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

function ehDiaValido(ano: number, mes: number, dia: number): boolean {
  if (ano < 1 || ano > 9999 || mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export const ERRO_DIA = "Dia: use dd/mm, hoje ou amanhã.";
export const ERRO_HORA = "Hora: use HH:MM, como 15:00.";
export const ERRO_DURACAO = "Duração: use minutos ou horas, como 30 min ou 1 h.";
export const ERRO_LEMBRETE = "Lembrete: diga quanto antes, como 15 min ou 1 h.";
export const ERRO_TITULO = "O título não pode ficar vazio.";

/**
 * O dia digitado: vazio, "hoje", "amanhã", "dd/mm[/aaaa]" ou o próprio texto da tela ("sex, 9
 * out", "9 out 2027"). Sem ano, vale o próximo dia com essa data a partir de hoje.
 */
export function lerDia(texto: string, hoje: string): Leitura<string | null> {
  const t = sem(texto);
  if (t === "") return { ok: true, valor: null };
  if (t === "hoje") return { ok: true, valor: hoje };
  if (t === "amanha") return { ok: true, valor: somarDias(hoje, 1) };
  let dia: number;
  let mes: number;
  let ano: number | null = null;
  const numerico = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  const porNome = /^(?:[a-z]{3},? )?(\d{1,2}) (?:de )?([a-z]{3})[a-z]*\.?(?:,? (?:de )?(\d{4}))?$/.exec(t);
  if (numerico) {
    dia = Number(numerico[1]);
    mes = Number(numerico[2]);
    if (numerico[3]) ano = numerico[3].length === 2 ? 2000 + Number(numerico[3]) : Number(numerico[3]);
  } else if (porNome) {
    const indice = MESES.indexOf(porNome[2]!);
    if (indice < 0) return { ok: false, erro: ERRO_DIA };
    dia = Number(porNome[1]);
    mes = indice + 1;
    if (porNome[3]) ano = Number(porNome[3]);
  } else {
    return { ok: false, erro: ERRO_DIA };
  }
  const deHoje = partes(hoje);
  if (ano === null) {
    ano = deHoje.ano;
    // "05/01" em outubro é o de janeiro que vem, não o que já passou.
    if (ehDiaValido(ano, mes, dia) && iso(dataDe(ano, mes, dia)) < hoje) ano += 1;
  }
  if (!ehDiaValido(ano, mes, dia)) return { ok: false, erro: ERRO_DIA };
  return { ok: true, valor: iso(dataDe(ano, mes, dia)) };
}

function dataDe(ano: number, mes: number, dia: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  return d;
}

/** A hora digitada: vazio, "15", "15h", "15:00", "15h30", "9:05". */
export function lerHora(texto: string): Leitura<string | null> {
  const t = sem(texto).replace(/ /g, "");
  if (t === "") return { ok: true, valor: null };
  const m = /^(\d{1,2})(?:(?::|h)(\d{2}))?h?$/.exec(t);
  if (!m) return { ok: false, erro: ERRO_HORA };
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, erro: ERRO_HORA };
  return { ok: true, valor: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

/** Minutos digitados: "30", "30 min", "1 h", "1 h 30", "1h30", "2 dias"; "antes" no fim vale. */
function lerMinutos(texto: string): number | null | undefined {
  const t = sem(texto).replace(/ antes$/, "");
  if (t === "") return null;
  const horasEMin = /^(\d+) ?h(?:oras?)? ?(\d+) ?(?:min)?$/.exec(t);
  if (horasEMin) return Number(horasEMin[1]) * 60 + Number(horasEMin[2]);
  const um = /^(\d+) ?(min|minutos?|m|h|horas?|dias?|d)?$/.exec(t);
  if (!um) return undefined;
  const n = Number(um[1]);
  const unidade = um[2] ?? "min";
  if (unidade.startsWith("d")) return n * 1440;
  if (unidade.startsWith("h")) return n * 60;
  return n;
}

export function lerDuracao(texto: string): Leitura<number | null> {
  const minutos = lerMinutos(texto);
  if (minutos === undefined || (minutos !== null && (minutos < 1 || minutos > 1440))) {
    return { ok: false, erro: ERRO_DURACAO };
  }
  return { ok: true, valor: minutos };
}

/** A antecedência do lembrete; "na hora" é zero. Até 28 dias, como nas Tarefas. */
export function lerAntecedencia(texto: string): Leitura<number | null> {
  if (sem(texto) === "na hora") return { ok: true, valor: 0 };
  const minutos = lerMinutos(texto);
  if (minutos === undefined || (minutos !== null && minutos > 40320)) {
    return { ok: false, erro: ERRO_LEMBRETE };
  }
  return { ok: true, valor: minutos };
}

/** O que a pessoa digitou em cada campo, como digitou (a lista guarda o id; "" é a Entrada). */
export type Edicoes = Partial<Record<CampoEditavel, string>>;

/**
 * Os campos que vão para o `captura.lancar`: os da prévia com o que a pessoa corrigiu por cima, e
 * o erro de cada campo que não deu para ler. Campo com erro fica como a prévia mandou.
 */
export function aplicarEdicoes(
  campos: CamposCaptura,
  edicoes: Edicoes,
  contexto: Contexto,
): { campos: CamposCaptura; erros: Partial<Record<CampoEditavel, string>> } {
  const final: CamposCaptura = { ...campos };
  const erros: Partial<Record<CampoEditavel, string>> = {};
  for (const [campo, texto] of Object.entries(edicoes) as [CampoEditavel, string][]) {
    switch (campo) {
      case "titulo": {
        const titulo = texto.trim();
        if (titulo === "") erros.titulo = ERRO_TITULO;
        else final.titulo = titulo.slice(0, 500);
        break;
      }
      case "listaId":
        final.listaId = texto === "" ? null : texto;
        break;
      case "dia":
        aplicar(campo, lerDia(texto, contexto.hoje), (v) => (final.dia = v));
        break;
      case "hora":
        aplicar(campo, lerHora(texto), (v) => (final.hora = v));
        break;
      case "duracaoMin":
        aplicar(campo, lerDuracao(texto), (v) => (final.duracaoMin = v));
        break;
      case "lembreteMinutosAntes":
        aplicar(campo, lerAntecedencia(texto), (v) => (final.lembreteMinutosAntes = v));
        break;
    }
  }
  return { campos: final, erros };

  function aplicar<T>(campo: CampoEditavel, leitura: Leitura<T>, guardar: (valor: T) => void) {
    if (leitura.ok) guardar(leitura.valor);
    else erros[campo] = leitura.erro;
  }
}

/**
 * Só as correções dos campos que o tipo mostra: trocar de tarefa para nota esconde a hora, e a
 * hora corrigida (ou o erro dela) não pode valer nem bloquear o que não está na tela.
 */
export function edicoesDoTipo(tipo: TipoCaptura, campos: CamposCaptura, edicoes: Edicoes): Edicoes {
  const visiveis = new Set(
    camposDoTipo(tipo, campos)
      .filter((c) => c.editavel)
      .map((c) => c.campo),
  );
  return Object.fromEntries(
    Object.entries(edicoes).filter(([campo]) => visiveis.has(campo as CampoCaptura)),
  ) as Edicoes;
}

/** "Tarefa criada", "Lembrete criado": o que a janela diz depois do Enter. */
export function lancado(tipo: TipoLancavel): string {
  return tipo === "tarefa" || tipo === "nota"
    ? `${NOME_DO_TIPO[tipo]} criada`
    : `${NOME_DO_TIPO[tipo]} criado`;
}

/** "a tarefa saiu", "o evento saiu": o fim do desfazer. */
export function desfeito(tipo: TipoLancavel): string {
  const artigo = tipo === "tarefa" || tipo === "nota" ? "a" : "o";
  return `Desfeito: ${artigo} ${NOME_DO_TIPO[tipo].toLowerCase()} saiu.`;
}
