/**
 * Tamanhos dos personagens (DESIGN.md §6): cabeça a 16, 24 e 32 nas listas e no dock, 36 nos
 * painéis; corpo inteiro a 168 nos cartões e na página do agente. Fica em src/tokens porque é
 * valor visual; o componente aceita também um número livre, preso a esta faixa.
 */
export const TAMANHO_PERSONAGEM = {
  mini: 16,
  lista: 24,
  dock: 32,
  painel: 36,
  /** Corpo inteiro nos estados vazios (Estados.dc.html). */
  vazio: 96,
  cartao: 168,
} as const;

export type TamanhoPersonagem = keyof typeof TAMANHO_PERSONAGEM;

export const TAMANHO_PERSONAGEM_MIN = TAMANHO_PERSONAGEM.mini;
export const TAMANHO_PERSONAGEM_MAX = TAMANHO_PERSONAGEM.cartao;
