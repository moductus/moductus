import { z } from "zod";
import { CamposOrigem, Id, Instante, InstanteEntrada, Recorrencia } from "./comum.ts";

/**
 * Lembretes (DATA.md §2; migração 013; ADR-0032): o que dispara, ligado a uma tarefa, a um evento
 * ou a nada ("beber água às 15h"). Dispara pelo relógio do dia no serviço, sem modelo e sem rede;
 * a interface só mostra e devolve Adiar e Feito.
 */

/** `perdido` é o que venceu com o serviço parado ou o PC suspenso: aparece como atrasado. */
export const EstadoLembrete = z.enum(["agendado", "disparado", "adiado", "perdido"]);
export type EstadoLembrete = z.infer<typeof EstadoLembrete>;

/** Por onde avisa: só o dock, o aviso do Windows (o padrão) ou o calendário "Moductus". */
export const CanalLembrete = z.enum(["dock", "windows", "calendario"]);
export type CanalLembrete = z.infer<typeof CanalLembrete>;

export const Lembrete = z
  .object({
    id: Id,
    texto: z.string().trim().min(1),
    quando: Instante,
    recorrencia: Recorrencia.nullable(),
    tarefaId: Id.nullable(),
    eventoId: Id.nullable(),
    estado: EstadoLembrete,
    disparadoEm: Instante.nullable(),
    adiadoAte: Instante.nullable(),
    canal: CanalLembrete,
    ...CamposOrigem,
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  .refine((l) => (l.estado === "adiado") === (l.adiadoAte !== null), {
    path: ["adiadoAte"],
    message: "só o lembrete adiado tem até quando",
  })
  .refine((l) => l.estado !== "disparado" || l.disparadoEm !== null, {
    path: ["disparadoEm"],
    message: "lembrete disparado tem a hora do disparo",
  });
export type Lembrete = z.infer<typeof Lembrete>;

const camposLembrete = {
  texto: z.string().trim().min(1).max(500),
  quando: InstanteEntrada,
  recorrencia: Recorrencia.nullable(),
  tarefaId: Id.nullable(),
  eventoId: Id.nullable(),
  canal: CanalLembrete,
};

export const NovoLembrete = z.object(camposLembrete).partial().required({ texto: true, quando: true });
export type NovoLembrete = z.infer<typeof NovoLembrete>;

/** Mudança parcial; mudar `quando` volta o lembrete a agendado. */
export const MudancaLembrete = z
  .object(camposLembrete)
  .omit({ tarefaId: true, eventoId: true })
  .partial()
  .extend({ id: Id });
export type MudancaLembrete = z.infer<typeof MudancaLembrete>;

/** Vários de uma vez: os atrasados da volta da suspensão saem juntos ("Concluir os 2"). */
export const PedidoLembretes = z.object({ ids: z.array(Id).min(1) });
export type PedidoLembretes = z.infer<typeof PedidoLembretes>;

/** "Adiar 10 min" do aviso e do painel, "Adiar os 2 em 30 min" dos atrasados: a partir de agora. */
export const PedidoAdiarLembretes = z.object({
  ids: z.array(Id).min(1),
  minutos: z.number().int().min(1).max(1440),
});
export type PedidoAdiarLembretes = z.infer<typeof PedidoAdiarLembretes>;

/** Os de um intervalo de `quando` (ou de `adiadoAte`), ou só os de um estado. */
export const PedidoListarLembretes = z.object({
  de: InstanteEntrada.optional(),
  ate: InstanteEntrada.optional(),
  estados: z.array(EstadoLembrete).min(1).optional(),
});
export type PedidoListarLembretes = z.infer<typeof PedidoListarLembretes>;

/**
 * O que mudou: os que continuam (o recorrente concluído volta com o próximo `quando`) e os que
 * saíram (concluídos de uma vez ou cancelados, que vão para a lixeira). `anteriores` traz o `quando`
 * de antes dos que mudaram de horário, para o aviso da ocorrência trocada sair da Central de
 * Notificações; a janela pode ignorar.
 */
export const MudancaLembretes = z.object({
  lembretes: z.array(Lembrete),
  removidos: z.array(Id),
  anteriores: z.array(z.object({ id: Id, quando: Instante })).optional(),
});
export type MudancaLembretes = z.infer<typeof MudancaLembretes>;

/** Quanto tempo o PC ficou suspenso (ou o serviço parado) enquanto os atrasados venciam. */
export const Ausencia = z
  .object({ de: Instante, ate: Instante })
  .refine((a) => Date.parse(a.ate) >= Date.parse(a.de), {
    path: ["ate"],
    message: "a ausência termina depois de começar",
  });
export type Ausencia = z.infer<typeof Ausencia>;

/**
 * O lembrete no painel Hoje (LembreteHoje.dc.html): o próximo, a partir de 30 min antes, sem som;
 * os que estão tocando, com Adiar e Feito; e os atrasados juntos num cartão só, com a ausência em
 * que venceram. Quem decide o que entra em cada grupo é o relógio do dia no serviço.
 */
export const LembretesDeHoje = z.object({
  chegando: Lembrete.nullable(),
  tocando: z.array(Lembrete),
  atrasados: z.array(Lembrete),
  ausencia: Ausencia.nullable(),
});
export type LembretesDeHoje = z.infer<typeof LembretesDeHoje>;
