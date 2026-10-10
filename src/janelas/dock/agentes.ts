import type { LeituraSituacao } from "../../componentes/personagem/situacao.ts";

/**
 * O rótulo de cada cabeça do dock, que também é a dica ao passar o mouse: o status, o que fazer
 * ("Volta seg 9h", "Chegou ao teto de hoje"), as sessões do terminal esperando você (só o Nuno) e
 * os avisos não vistos. "Nuno, ocioso. 1 sessão esperando você. 2 avisos novos".
 */
export function rotuloDoAgente(
  nome: string,
  leitura: LeituraSituacao,
  avisos: number,
  sessoesEsperando: number,
): string {
  const partes = [`${nome}, ${leitura.texto}`];
  if (leitura.dica) partes.push(leitura.dica);
  if (sessoesEsperando > 0) {
    partes.push(
      `${sessoesEsperando} ${sessoesEsperando === 1 ? "sessão esperando você" : "sessões esperando você"}`,
    );
  }
  if (avisos > 0) partes.push(`${avisos} ${avisos === 1 ? "aviso novo" : "avisos novos"}`);
  return partes.join(". ");
}

/**
 * O ponto no canto da cabeça (Dock.dc.html e Estados.dc.html, "No dock"): vermelho enquanto o
 * modelo não responde; amarelo no teto, com sessão do terminal esperando você ou aviso não visto.
 * O vermelho ganha: é o que mais pede você.
 */
export function pontoDoAgente(
  leitura: LeituraSituacao,
  avisos: number,
  sessoesEsperando: number,
): "perigo" | "aviso" | null {
  if (leitura.ponto === "perigo") return "perigo";
  if (leitura.ponto === "aviso" || avisos > 0 || sessoesEsperando > 0) return "aviso";
  return null;
}
