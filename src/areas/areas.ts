import type { NomeIcone } from "../componentes/Icone.tsx";

/**
 * As 12 áreas do Sistema, na ordem da barra lateral (mudancas-main, "Lista final e ordem das
 * áreas"). As 9 primeiras têm Ctrl+1…9; Memória, Ferramentas e Configurações não têm número.
 * O id é o mesmo que o dock manda no evento `sistema:ir`.
 */
export const IDS_AREAS = [
  "inicio",
  "agentes",
  "sessoes",
  "tarefas",
  "foco",
  "financas",
  "dev",
  "notas",
  "arquivos",
  "memoria",
  "ferramentas",
  "configuracoes",
] as const;
export type IdArea = (typeof IDS_AREAS)[number];

export interface DadosArea {
  id: IdArea;
  nome: string;
  icone: NomeIcone;
  /** Número do Ctrl+N, só nas 9 primeiras. */
  atalho?: number;
}

const NOMES: Record<IdArea, string> = {
  inicio: "Início",
  agentes: "Agentes",
  sessoes: "Sessões de IA",
  tarefas: "Tarefas",
  foco: "Foco",
  financas: "Finanças",
  dev: "Dev",
  notas: "Notas",
  arquivos: "Arquivos",
  memoria: "Memória",
  ferramentas: "Ferramentas",
  configuracoes: "Configurações",
};

const COM_ATALHO = 9;

export const AREAS: readonly DadosArea[] = IDS_AREAS.map((id, i) => ({
  id,
  nome: NOMES[id],
  icone: id,
  ...(i < COM_ATALHO ? { atalho: i + 1 } : {}),
}));

export const AREA_INICIAL: IdArea = "inicio";

export function eIdArea(valor: unknown): valor is IdArea {
  return (IDS_AREAS as readonly unknown[]).includes(valor);
}

/** A área do Ctrl+N (1 a 9), ou `null` fora da faixa. */
export function areaDoAtalho(numero: number): IdArea | null {
  return AREAS.find((a) => a.atalho === numero)?.id ?? null;
}

/** Onde o Sistema está: a área e, nas Configurações, a seção. */
export interface Destino {
  area: IdArea;
  secao?: string;
}

/**
 * Lê um destino escrito como "dev" ou "configuracoes/modelos" (evento do dock, memória da
 * última área). Texto que não é área devolve `null`; a seção é validada por quem a mostra.
 */
export function lerDestino(valor: unknown): Destino | null {
  if (typeof valor !== "string") return null;
  const [area, secao] = valor.trim().split("/");
  if (!eIdArea(area)) return null;
  return secao ? { area, secao } : { area };
}

export function escreverDestino({ area, secao }: Destino): string {
  return secao ? `${area}/${secao}` : area;
}
