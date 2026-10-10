import type { NomeIcone } from "../componentes/Icone.tsx";

/**
 * Áreas que o dock abre no painel lateral (Dock.dc.html), na ordem do dock, e o estado vazio
 * de cada uma na fase 1 (design-fase1 §D.4, encurtado para caber no painel). "agentes" é a
 * seção do time: as quatro cabeças abrem o mesmo painel.
 */
export const AREAS_DOCK = ["hoje", "tarefas", "foco", "financas", "dev", "notas", "arquivos"] as const;
export type AreaDock = (typeof AREAS_DOCK)[number];
export type AreaPainel = AreaDock | "agentes";

export interface DadosArea {
  nome: string;
  icone: NomeIcone;
  /** Do que é a contagem do badge, para o leitor de tela; sem ela a área não tem badge. */
  contagem?: string;
  vazio: { titulo: string; texto: string };
}

export const DADOS_AREAS: Readonly<Record<AreaPainel, DadosArea>> = {
  hoje: {
    nome: "Hoje",
    icone: "hoje",
    vazio: {
      titulo: "Nenhum resumo hoje",
      texto: "O dia numa tela, com tarefas, foco, finanças e dev, aparece aqui quando o time acordar.",
    },
  },
  tarefas: {
    nome: "Tarefas",
    icone: "tarefas",
    contagem: "tarefas pendentes",
    vazio: { titulo: "0 tarefas pendentes", texto: "Anote pela captura rápida o que precisa fazer." },
  },
  foco: {
    nome: "Foco",
    icone: "foco",
    vazio: { titulo: "Nenhum bloco de foco", texto: "Os ciclos de foco e o tempo restante aparecem aqui." },
  },
  financas: {
    nome: "Finanças",
    icone: "financas",
    vazio: { titulo: "0 lançamentos", texto: "Importe um extrato para a Tula conferir os gastos com você." },
  },
  dev: {
    nome: "Dev",
    icone: "dev",
    contagem: "avisos de dev",
    vazio: { titulo: "Nenhum repositório", texto: "Conecte o GitHub para ver PRs, CI e issues aqui." },
  },
  notas: {
    nome: "Notas",
    icone: "notas",
    vazio: { titulo: "0 notas", texto: "Escreva uma nota rápida ou aponte a pasta de notas em Markdown." },
  },
  arquivos: {
    nome: "Arquivos",
    icone: "arquivos",
    vazio: { titulo: "Nenhuma pasta indexada", texto: "Escolha as pastas que a Faina pode organizar." },
  },
  agentes: {
    nome: "Agentes",
    icone: "agentes",
    vazio: {
      titulo: "Conecte um modelo para acordar o time",
      texto: "Alba, Tula, Faina e Nuno trabalham com um modelo de IA: um CLI que você já usa ou uma API.",
    },
  },
};

export function eAreaPainel(valor: unknown): valor is AreaPainel {
  return typeof valor === "string" && Object.hasOwn(DADOS_AREAS, valor);
}
