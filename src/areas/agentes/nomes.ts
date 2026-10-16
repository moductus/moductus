import { DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";

/** O artigo de cada um, para os botões falarem como gente: "Pausar a Tula", "Página do Nuno". */
const ARTIGO: Readonly<Record<Agente, "a" | "o">> = { alba: "a", tula: "a", faina: "a", nuno: "o" };

/** "a Tula", "o Nuno". */
export const comArtigo = (agente: Agente) => `${ARTIGO[agente]} ${DADOS_AGENTES[agente].nome}`;

/** "da Tula", "do Nuno". */
export const deAgente = (agente: Agente) => `d${comArtigo(agente)}`;
