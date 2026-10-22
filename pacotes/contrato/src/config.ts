import { z } from "zod";
import { Cambio } from "./cambio.ts";

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
  /**
   * Começa ou pausa o foco de qualquer lugar (`foco.alternar`). Vazio é sem atalho: o padrão
   * (Ctrl+Alt+P) colidia com um atalho que o usuário já tinha salvo, e o dele vale; o motivo vem em
   * `falhasAtalhos.foco` até ele escolher outro.
   */
  foco: z.string(),
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

const fusoConhecido = (fuso: string) => {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
};

/** Fuso do IANA (`America/Sao_Paulo`): é nele que "hoje", o expediente e as rotinas são contados. */
export const Fuso = z.string().min(1).refine(fusoConhecido, "fuso desconhecido");
export type Fuso = z.infer<typeof Fuso>;

/** O fuso quando o Windows não informa um que se reconheça. */
export const FUSO_RESERVA = "America/Sao_Paulo";

/** O fuso do sistema, ou o de reserva. */
export function fusoDoSistema(
  lido: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const fuso = lido();
  return fuso !== undefined && Fuso.safeParse(fuso).success ? fuso : FUSO_RESERVA;
}

/** Horário de trabalho do dia, onde a agenda procura os blocos livres; não atravessa a meia-noite. */
export const Expediente = z
  .object({ inicio: HoraDoDia, fim: HoraDoDia })
  .refine((e) => e.fim > e.inicio, { path: ["fim"], message: "o expediente termina depois de começar" });
export type Expediente = z.infer<typeof Expediente>;

/** Os ciclos do foco: minutos de foco, de pausa, de pausa longa e quantos focos até a longa. */
export const CiclosFoco = z.object({
  focoMin: z.number().int().min(1).max(240),
  pausaMin: z.number().int().min(1).max(60),
  pausaLongaMin: z.number().int().min(1).max(120),
  ciclosAtePausaLonga: z.number().int().min(1).max(12),
});
export type CiclosFoco = z.infer<typeof CiclosFoco>;

/** O dia (quadro ConfigDia): fuso, expediente e ciclos do foco. */
export const ConfigDia = z.object({ fuso: Fuso, expediente: Expediente, foco: CiclosFoco });
export type ConfigDia = z.infer<typeof ConfigDia>;

export const Config = z.object({
  tema: Tema,
  dock: ConfigDock,
  atalhos: Atalhos,
  autostart: z.boolean(),
  silencio: Silencio,
  dia: ConfigDia,
  /** As cotações do teto diário (ADR-0040): digitadas ou buscadas e confirmadas; nenhuma de fábrica. */
  cambio: Cambio,
});
export type Config = z.infer<typeof Config>;

/**
 * O padrão de cada chave. O fuso é o do sistema, lido ao carregar: enquanto a chave `dia` não é
 * gravada, ele acompanha o Windows.
 */
export const CONFIG_PADRAO: Config = {
  tema: "automatico",
  dock: { lado: "esquerda", modo: "fixo", forma: "colada" },
  atalhos: { sistema: "Ctrl+Alt+N", dock: "Ctrl+Alt+D", captura: "Ctrl+Alt+Space", foco: "Ctrl+Alt+P" },
  autostart: false,
  silencio: { horario: { ligado: false, inicio: "22:00", fim: "07:30" }, telaCheia: true, foco: true },
  dia: {
    fuso: fusoDoSistema(),
    expediente: { inicio: "09:00", fim: "18:00" },
    foco: { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 },
  },
  cambio: { cotacoes: {} },
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
