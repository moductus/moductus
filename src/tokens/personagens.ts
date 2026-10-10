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
  /** Cabeça nas missões dos Primeiros passos (Tutorial.dc.html). */
  missao: 26,
  /** Cabeça na linha de avisos de uma área (AreaSessoes.dc.html). */
  aviso: 22,
  /** Cabeça na fala do agente no alto de uma área (AreaDev.dc.html). */
  faixa: 26,
  /** Cabeça na fala do agente (Conversas.dc.html). */
  fala: 30,
  /** Cabeça na lista por agente de Notificações (AreaNotificacoes.dc.html). */
  notificacoes: 28,
  /** Corpo inteiro no time das boas-vindas (Uso1Boas.dc.html). */
  boasVindas: 116,
  /** Corpo inteiro na apresentação do time (Uso4Time.dc.html). */
  apresentacao: 132,
  /** Corpo inteiro no alto da página do agente (AreaAgente.dc.html). */
  paginaAgente: 120,
  cartao: 168,
} as const;

export type TamanhoPersonagem = keyof typeof TAMANHO_PERSONAGEM;

export const TAMANHO_PERSONAGEM_MIN = TAMANHO_PERSONAGEM.mini;
export const TAMANHO_PERSONAGEM_MAX = TAMANHO_PERSONAGEM.cartao;
