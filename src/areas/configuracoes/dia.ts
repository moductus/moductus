import type { CiclosFoco, DiaDaSemana } from "@moductus/contrato";
import { duracaoCurta } from "../../servico/foco.ts";

/**
 * As contas de Configurações › O dia (ConfigDia.dc.html): os dias de trabalho, o nome do fuso, as
 * opções dos ciclos e a rodada que eles dão. Funções puras; quem grava é o serviço.
 */

/** De segunda a domingo, como a ISO 8601 e `rotinas.dias_semana`. */
export const DIAS_DA_SEMANA: readonly { numero: DiaDaSemana; curto: string; nome: string }[] = [
  { numero: 1, curto: "seg", nome: "segunda" },
  { numero: 2, curto: "ter", nome: "terça" },
  { numero: 3, curto: "qua", nome: "quarta" },
  { numero: 4, curto: "qui", nome: "quinta" },
  { numero: 5, curto: "sex", nome: "sexta" },
  { numero: 6, curto: "sáb", nome: "sábado" },
  { numero: 7, curto: "dom", nome: "domingo" },
];

/**
 * Liga ou desliga um dia. Sem nenhum dia não há briefing, fechamento nem expediente: o último
 * não desliga (`null`).
 */
export function alternarDia(dias: readonly number[], numero: number): number[] | null {
  const tem = dias.includes(numero);
  if (tem && dias.length === 1) return null;
  const novos = tem ? dias.filter((d) => d !== numero) : [...dias, numero];
  return novos.sort((a, b) => a - b);
}

/** O dia da semana de hoje no fuso, de 1 (segunda) a 7 (domingo). */
export function diaDaSemanaNoFuso(agora: Date, fuso: string): number {
  const curto = new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short" }).format(agora);
  const indice = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(curto);
  return indice + 1;
}

/** O que a troca da hora de parar faz, na linha logo abaixo dela. */
export function avisoDaHoraDeParar(de: string, para: string, valeHoje: boolean): string {
  return valeHoje
    ? `Vale já hoje: o fechamento passa de ${de} para ${para}.`
    : `Vale no próximo dia de trabalho: o fechamento passa de ${de} para ${para}.`;
}

// ---------- fuso ----------

/** A cidade do fuso com o nome em português, quando muda; as outras ficam como o IANA as escreve. */
const CIDADES: Readonly<Record<string, string>> = {
  "America/Sao_Paulo": "São Paulo",
  "America/Belem": "Belém",
  "America/Maceio": "Maceió",
  "America/Cuiaba": "Cuiabá",
  "America/Araguaina": "Araguaína",
  "America/Eirunepe": "Eirunepé",
  "America/Santarem": "Santarém",
  "America/Bahia": "Salvador",
  "America/Noronha": "Fernando de Noronha",
  "America/New_York": "Nova York",
  "America/Mexico_City": "Cidade do México",
  "Europe/Lisbon": "Lisboa",
  "Europe/London": "Londres",
  "Atlantic/Azores": "Açores",
};

/** "UTC−03:00", com o sinal de menos tipográfico; o próprio UTC é "UTC+00:00". */
export function deslocamentoDoFuso(fuso: string, agora: Date): string {
  const parte = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "longOffset" })
    .formatToParts(agora)
    .find((p) => p.type === "timeZoneName")?.value;
  const desvio = parte?.replace(/^GMT/, "") || "+00:00";
  return `UTC${desvio.replace("-", "−")}`;
}

/** "São Paulo (UTC−03:00)". */
export function nomeDoFuso(fuso: string, agora: Date): string {
  const cidade = CIDADES[fuso] ?? (fuso.split("/").at(-1) ?? fuso).replaceAll("_", " ");
  return `${cidade} (${deslocamentoDoFuso(fuso, agora)})`;
}

export interface OpcaoFuso {
  valor: string;
  rotulo: string;
}

/** Os fusos que este Windows conhece; sem a lista, só os que já se sabe. */
function fusosConhecidos(): string[] {
  const intl = Intl as { supportedValuesOf?: (chave: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/**
 * A lista do fuso: o do Windows primeiro ("· o do Windows"), depois os outros pelo nome. O atual
 * entra mesmo que o Windows não o liste (um nome antigo do IANA salvo na configuração).
 */
export function opcoesDeFuso(atual: string, doWindows: string, agora: Date): OpcaoFuso[] {
  const resto = new Set(fusosConhecidos().filter((f) => f.includes("/")));
  resto.add(atual);
  resto.delete(doWindows);
  const outros = [...resto]
    .map((valor) => ({ valor, rotulo: nomeDoFuso(valor, agora) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  return [{ valor: doWindows, rotulo: `${nomeDoFuso(doWindows, agora)} · o do Windows` }, ...outros];
}

// ---------- ciclos do foco ----------

export type CampoCiclo = keyof CiclosFoco;

/** As escolhas de cada campo; o valor salvo fora delas (pela Alba, por exemplo) entra na lista. */
const ESCOLHAS: Readonly<Record<CampoCiclo, readonly number[]>> = {
  focoMin: [15, 20, 25, 30, 40, 45, 50, 60, 90],
  pausaMin: [3, 5, 10, 15],
  pausaLongaMin: [10, 15, 20, 30],
  ciclosAtePausaLonga: [2, 3, 4, 5, 6],
};

const rotuloDoCiclo = (campo: CampoCiclo, n: number) =>
  campo === "ciclosAtePausaLonga" ? `${n} ${n === 1 ? "foco" : "focos"}` : `${n} min`;

export function opcoesDoCiclo(campo: CampoCiclo, atual: number): { valor: number; rotulo: string }[] {
  const valores = [...new Set([...ESCOLHAS[campo], atual])].sort((a, b) => a - b);
  return valores.map((valor) => ({ valor, rotulo: rotuloDoCiclo(campo, valor) }));
}

export interface EtapaPlanejada {
  tipo: "foco" | "pausa" | "pausa_longa";
  minutos: number;
}

/** Uma rodada inteira: foco e pausa curta, e a longa no lugar da última pausa. */
export function etapasDaRodada(c: CiclosFoco): EtapaPlanejada[] {
  return Array.from({ length: c.ciclosAtePausaLonga }, (_, i): EtapaPlanejada[] => [
    { tipo: "foco", minutos: c.focoMin },
    i === c.ciclosAtePausaLonga - 1
      ? { tipo: "pausa_longa", minutos: c.pausaLongaMin }
      : { tipo: "pausa", minutos: c.pausaMin },
  ]).flat();
}

/** "Uma rodada: 2h10, com 1h40 de foco." */
export function resumoDaRodada(c: CiclosFoco): string {
  const etapas = etapasDaRodada(c);
  const total = etapas.reduce((soma, e) => soma + e.minutos, 0);
  const foco = etapas.filter((e) => e.tipo === "foco").reduce((soma, e) => soma + e.minutos, 0);
  return `Uma rodada: ${duracaoCurta(total)}, com ${duracaoCurta(foco)} de foco.`;
}
