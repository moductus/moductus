/** Cada janela nativa carrega o mesmo bundle; o rótulo da janela escolhe a rota. */
export const JANELAS = ["dock", "painel", "sistema", "captura"] as const;
export type Janela = (typeof JANELAS)[number];

export function janelaDoRotulo(rotulo: string): Janela | null {
  return (JANELAS as readonly string[]).includes(rotulo) ? (rotulo as Janela) : null;
}
