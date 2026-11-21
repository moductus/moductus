import { DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";

/** O artigo de cada um, para os botões falarem como gente: "Pausar a Tula", "Página do Nuno". */
const ARTIGO: Readonly<Record<Agente, "a" | "o">> = { alba: "a", tula: "a", faina: "a", nuno: "o" };

/** "a Tula", "o Nuno". */
export const comArtigo = (agente: Agente) => `${ARTIGO[agente]} ${DADOS_AGENTES[agente].nome}`;

/** A palavra no gênero do agente: `noGenero("tula", "ligada", "ligado")` é "ligada". */
export const noGenero = (agente: Agente, feminina: string, masculina: string) =>
  ARTIGO[agente] === "a" ? feminina : masculina;

/** "da Tula", "do Nuno". */
export const deAgente = (agente: Agente) => `d${comArtigo(agente)}`;
