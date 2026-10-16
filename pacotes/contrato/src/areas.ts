import { z } from "zod";

/**
 * As contagens das áreas (PRODUCT.md §4): o número na barra lateral do Sistema e no badge do dock.
 * Uma conta só, no serviço, para as duas janelas mostrarem o mesmo; zero não mostra número.
 */
const Contagem = z.number().int().nonnegative();

export const ContagensAreas = z.object({
  /** As abertas de hoje, no fuso do usuário. */
  tarefasPendentes: Contagem,
  lembretesAtrasados: Contagem,
  /** Sessões de IA esperando você (aprovação ou pergunta). */
  sessoesEsperando: Contagem,
  /** PRs, issues e CI do Dev que pedem você. */
  devPrecisando: Contagem,
});
export type ContagensAreas = z.infer<typeof ContagensAreas>;
