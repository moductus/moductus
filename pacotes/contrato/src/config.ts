import { z } from "zod";

/** Preferências do Moductus. Cada campo tem padrão: banco vazio é configuração válida. */
export const Tema = z.enum(["automatico", "grafite", "papel", "vidro"]);
export type Tema = z.infer<typeof Tema>;

export const ConfigDock = z.object({
  lado: z.enum(["esquerda", "direita"]),
  modo: z.enum(["fixo", "esconder", "inteligente"]),
  forma: z.enum(["colada", "flutuante"]),
});
export type ConfigDock = z.infer<typeof ConfigDock>;

export const Atalhos = z.object({
  sistema: z.string().min(1),
  dock: z.string().min(1),
  captura: z.string().min(1),
});
export type Atalhos = z.infer<typeof Atalhos>;

/** Hora do dia no relógio do PC, `HH:MM` de 00:00 a 23:59. */
export const HoraDoDia = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora no formato HH:MM");
export type HoraDoDia = z.infer<typeof HoraDoDia>;

/**
 * Quando o aviso do Windows fica quieto (PRODUCT.md §5 "Notificações"). O ponto no dock e o
 * registro continuam; só a interrupção para.
 */
export const Silencio = z.object({
  /** Horário sem aviso; `inicio` depois de `fim` atravessa a meia-noite (22:00 às 07:30). */
  horario: z.object({ ligado: z.boolean(), inicio: HoraDoDia, fim: HoraDoDia }),
  /** Jogo, vídeo ou apresentação em tela cheia. */
  telaCheia: z.boolean(),
  /** Durante uma sessão de foco, menos aprovações e lembretes. */
  foco: z.boolean(),
});
export type Silencio = z.infer<typeof Silencio>;

export const Config = z.object({
  tema: Tema,
  dock: ConfigDock,
  atalhos: Atalhos,
  autostart: z.boolean(),
  silencio: Silencio,
});
export type Config = z.infer<typeof Config>;

export const CONFIG_PADRAO: Config = {
  tema: "automatico",
  dock: { lado: "esquerda", modo: "fixo", forma: "colada" },
  atalhos: { sistema: "Ctrl+Alt+N", dock: "Ctrl+Alt+D", captura: "Ctrl+Alt+Space" },
  autostart: false,
  silencio: { horario: { ligado: false, inicio: "22:00", fim: "07:30" }, telaCheia: true, foco: true },
};

/** Mudança parcial: só as chaves de primeiro nível que mudam. */
export const MudancaConfig = Config.partial();
export type MudancaConfig = z.infer<typeof MudancaConfig>;

/** Estado mostrado no Sistema: a configuração mais o que a casca informa. */
export const EstadoConfig = z.object({
  config: Config,
  portable: z.boolean(),
  /** Atalhos que o Windows recusou, com o motivo (por ação). */
  falhasAtalhos: z.record(z.string(), z.string()),
});
export type EstadoConfig = z.infer<typeof EstadoConfig>;
