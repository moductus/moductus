/**
 * Quem é cada agente do time (docs/AGENTS.md e Time.dc.html). Fonte única para o dock, o
 * Sistema e a galeria: nome, como chamar no chat, a função numa frase e o traço do personagem.
 */
export const AGENTES = ["alba", "tula", "faina", "nuno"] as const;
export type Agente = (typeof AGENTES)[number];

export interface DadosAgente {
  id: Agente;
  nome: string;
  apelido: `@${Agente}`;
  funcao: string;
  /** Silhueta e traço próprio, como DESIGN.md §6 descreve. */
  silhueta: string;
  traco: string;
}

export const DADOS_AGENTES: Readonly<Record<Agente, DadosAgente>> = {
  alba: {
    id: "alba",
    nome: "Alba",
    apelido: "@alba",
    funcao: "Cuida do seu dia",
    silhueta: "ovo",
    traco: "raios",
  },
  tula: {
    id: "tula",
    nome: "Tula",
    apelido: "@tula",
    funcao: "Cuida do seu dinheiro",
    silhueta: "pera",
    traco: "coque",
  },
  faina: {
    id: "faina",
    nome: "Faina",
    apelido: "@faina",
    funcao: "Faz o serviço pesado",
    silhueta: "bloco",
    traco: "bandana",
  },
  nuno: {
    id: "nuno",
    nome: "Nuno",
    apelido: "@nuno",
    funcao: "Fica de olho nas suas IAs e no seu código",
    silhueta: "capsula",
    traco: "fones",
  },
};

export function eAgente(valor: unknown): valor is Agente {
  return (AGENTES as readonly unknown[]).includes(valor);
}

/** Estados do personagem; cada um tem a sua expressão (DESIGN.md §6). */
export const ESTADOS_PERSONAGEM = ["dormindo", "ocioso", "trabalhando", "esperando", "erro"] as const;
export type EstadoPersonagem = (typeof ESTADOS_PERSONAGEM)[number];

/** Como o estado é dito no rótulo acessível ("Alba, esperando você"). */
export const ROTULO_ESTADO: Readonly<Record<EstadoPersonagem, string>> = {
  dormindo: "dormindo",
  ocioso: "descansando",
  trabalhando: "trabalhando",
  esperando: "esperando você",
  erro: "com erro",
};

export function eEstadoPersonagem(valor: unknown): valor is EstadoPersonagem {
  return (ESTADOS_PERSONAGEM as readonly unknown[]).includes(valor);
}
