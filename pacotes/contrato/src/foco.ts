import { z } from "zod";
import { Dia, Id, Instante } from "./comum.ts";

/**
 * Foco (PRODUCT.md §5; DATA.md §2 sessoes_foco; migração 014; ADR-0032): ciclos de etapas de
 * foco, pausa e pausa longa, ligados a uma tarefa ou livres. O fim de cada etapa é do relógio do
 * dia no serviço; a interface conta o tempo sozinha a partir de `terminaEm`, sem tique pelo canal.
 */

export const TipoEtapa = z.enum(["foco", "pausa", "pausa_longa"]);
export type TipoEtapa = z.infer<typeof TipoEtapa>;

/**
 * Uma etapa. `terminaEm` é o fim planejado, que o "+5 min" estica; em pausa, `pausadaEm` diz desde
 * quando, e o que falta é `terminaEm` menos `pausadaEm`. `interrompida` é a que acabou antes da
 * hora, inclusive a que o serviço fechou ao reiniciar fora do prazo.
 */
export const EtapaFoco = z
  .object({
    id: Id,
    tipo: TipoEtapa,
    tarefaId: Id.nullable(),
    inicio: Instante,
    terminaEm: Instante,
    pausadaEm: Instante.nullable(),
    fim: Instante.nullable(),
    duracaoPlanejadaMin: z.number().int().positive(),
    duracaoRealMin: z.number().int().nonnegative().nullable(),
    interrompida: z.boolean(),
  })
  .refine((e) => (e.fim === null) === (e.duracaoRealMin === null), {
    path: ["duracaoRealMin"],
    message: "só a etapa que terminou tem a duração real",
  })
  .refine((e) => e.fim === null || e.pausadaEm === null, {
    path: ["pausadaEm"],
    message: "etapa que terminou não está em pausa",
  });
export type EtapaFoco = z.infer<typeof EtapaFoco>;

/**
 * O foco agora, para o painel, a área e o ícone do dock: a etapa em andamento (uma só), em que
 * foco do ciclo ela está ("Ciclo 2 de 4"), o que vem depois e o total de hoje. `etapa` vazia é
 * foco parado. `proxima` é a etapa que vem agora: depois do foco (pelo relógio ou pelo "Terminar
 * ciclo"), a pausa, ou a longa no último ciclo, que a Alba propõe e só começa quando o usuário
 * pede; depois da pausa, o foco, que o relógio começa sozinho no fim dela; depois da pausa longa,
 * da pausa encerrada antes da hora ou da etapa que venceu com o PC parado, o foco do ciclo 1.
 */
export const EstadoFoco = z.object({
  etapa: EtapaFoco.nullable(),
  /** Título da tarefa ligada, para o painel não precisar de outro pedido. */
  tarefaTitulo: z.string().nullable(),
  cicloAtual: z.number().int().min(1),
  ciclosAtePausaLonga: z.number().int().min(1),
  proxima: TipoEtapa,
  /**
   * Se o "+5 min" vale agora: com uma etapa em andamento ou com o foco que o relógio fechou
   * completo; o encerrado antes da hora ("Terminar ciclo") não volta a correr.
   */
  podeEstender: z.boolean(),
  focoHojeMin: z.number().int().nonnegative(),
  ciclosHoje: z.number().int().nonnegative(),
});
export type EstadoFoco = z.infer<typeof EstadoFoco>;

/** Começar uma etapa: livre ou ligada a uma tarefa; sem `minutos`, a duração configurada. */
export const PedidoIniciarFoco = z.object({
  tarefaId: Id.nullable().optional(),
  tipo: TipoEtapa.optional(),
  minutos: z.number().int().min(1).max(240).optional(),
});
export type PedidoIniciarFoco = z.infer<typeof PedidoIniciarFoco>;

/** "+5 min": estica a etapa em andamento. */
export const PedidoEstenderFoco = z.object({ minutos: z.number().int().min(1).max(60) });
export type PedidoEstenderFoco = z.infer<typeof PedidoEstenderFoco>;

/** O histórico e o relatório de um intervalo de dias, no fuso do usuário. */
export const PedidoHistoricoFoco = z
  .object({ de: Dia, ate: Dia })
  .refine((p) => p.ate >= p.de, { path: ["ate"], message: "o fim não vem antes do início" });
export type PedidoHistoricoFoco = z.infer<typeof PedidoHistoricoFoco>;

/** Minutos de foco e focos completos de uma tarefa (ou do foco livre, com `tarefaId` vazio). */
export const FocoPorTarefa = z.object({
  tarefaId: Id.nullable(),
  titulo: z.string().nullable(),
  minutos: z.number().int().nonnegative(),
  ciclos: z.number().int().nonnegative(),
});
export type FocoPorTarefa = z.infer<typeof FocoPorTarefa>;

export const FocoPorDia = z.object({
  dia: Dia,
  minutos: z.number().int().nonnegative(),
  ciclos: z.number().int().nonnegative(),
});
export type FocoPorDia = z.infer<typeof FocoPorDia>;

/** As etapas do intervalo, da mais nova para a mais antiga, e as somas por tarefa e por dia. */
export const HistoricoFoco = z.object({
  etapas: z.array(EtapaFoco),
  porTarefa: z.array(FocoPorTarefa),
  porDia: z.array(FocoPorDia),
});
export type HistoricoFoco = z.infer<typeof HistoricoFoco>;
