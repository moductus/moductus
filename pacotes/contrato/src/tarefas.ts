import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante, Recorrencia } from "./comum.ts";
import { HoraDoDia } from "./config.ts";

/**
 * Listas, tarefas e etiquetas da Alba (DATA.md §2; migração 013). A regra (o que é "hoje", a
 * próxima de uma recorrente, o lembrete ligado à tarefa com hora) mora em `areas/tarefas` no
 * serviço; aqui só a forma do que vai e volta.
 */

/** As três listas que já nascem no banco, com id fixo igual em todo PC (migração 013). */
export const LISTAS_PADRAO = ["entrada", "trabalho", "pessoal"] as const;

/** Para onde vai a tarefa sem lista, inclusive a da captura. */
export const LISTA_ENTRADA = "entrada";

export const Lista = z.object({
  id: Id,
  nome: z.string().trim().min(1),
  ordem: z.number().int(),
  cor: z.string().min(1).nullable(),
  arquivada: z.boolean(),
});
export type Lista = z.infer<typeof Lista>;

export const NovaLista = z.object({
  nome: z.string().trim().min(1).max(80),
  cor: z.string().min(1).nullable().optional(),
});
export type NovaLista = z.infer<typeof NovaLista>;

export const MudancaLista = z.object({
  id: Id,
  nome: z.string().trim().min(1).max(80).optional(),
  cor: z.string().min(1).nullable().optional(),
  arquivada: z.boolean().optional(),
});
export type MudancaLista = z.infer<typeof MudancaLista>;

export const PedidoLista = z.object({ id: Id });
export type PedidoLista = z.infer<typeof PedidoLista>;

/** A nova ordem: os ids na ordem em que ficam. */
export const PedidoOrdenar = z.object({ ids: z.array(Id).min(1) });
export type PedidoOrdenar = z.infer<typeof PedidoOrdenar>;

/** Etiqueta livre (`trabalho`, `casa`, `pr-123`); o nome não se repete sem diferença de caixa. */
export const Etiqueta = z.object({ id: Id, nome: z.string().trim().min(1) });
export type Etiqueta = z.infer<typeof Etiqueta>;

/** Na entrada, a etiqueta vai pelo nome: a que ainda não existe nasce com a tarefa. */
const NomeEtiqueta = z.string().trim().min(1).max(60);

export const EstadoTarefa = z.enum(["aberta", "feita", "cancelada"]);
export type EstadoTarefa = z.infer<typeof EstadoTarefa>;

/** 0 é nenhuma, 3 é alta. */
export const Prioridade = z.number().int().min(0).max(3);
export type Prioridade = z.infer<typeof Prioridade>;

/** Minutos antes da hora da tarefa em que o lembrete ligado a ela toca (o quadro usa 15). */
export const MinutosAntes = z.number().int().min(0).max(40320);
export type MinutosAntes = z.infer<typeof MinutosAntes>;

/**
 * Uma tarefa. `venceEm` é o dia e `hora` a hora do dia no fuso do usuário, que só existe com o
 * dia. Subtarefa tem `tarefaPaiId` e é de um nível só. `lembreteMinutosAntes` vem quando a tarefa
 * tem um lembrete ligado a ela; `notaId`, quando nasceu de uma nota.
 */
export const Tarefa = z
  .object({
    id: Id,
    listaId: Id,
    tarefaPaiId: Id.nullable(),
    titulo: z.string().trim().min(1),
    notas: z.string().nullable(),
    notaId: Id.nullable(),
    prioridade: Prioridade,
    venceEm: Dia.nullable(),
    hora: HoraDoDia.nullable(),
    duracaoEstimadaMin: z.number().int().positive().nullable(),
    recorrencia: Recorrencia.nullable(),
    estado: EstadoTarefa,
    concluidaEm: Instante.nullable(),
    ordem: z.number().int(),
    etiquetas: z.array(Etiqueta),
    lembreteMinutosAntes: MinutosAntes.nullable(),
    ...CamposOrigem,
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  .refine((t) => t.hora === null || t.venceEm !== null, { path: ["hora"], message: "hora só com o dia" })
  // Como o banco (013): a aberta não tem data de conclusão, a feita tem e a cancelada fica livre.
  .refine((t) => t.estado !== "aberta" || t.concluidaEm === null, {
    path: ["concluidaEm"],
    message: "tarefa aberta não tem data de conclusão",
  })
  .refine((t) => t.estado !== "feita" || t.concluidaEm !== null, {
    path: ["concluidaEm"],
    message: "tarefa feita tem a data de conclusão",
  });
export type Tarefa = z.infer<typeof Tarefa>;

const camposTarefa = {
  titulo: z.string().trim().min(1).max(500),
  listaId: Id,
  tarefaPaiId: Id.nullable(),
  notas: z.string().max(10_000).nullable(),
  notaId: Id.nullable(),
  prioridade: Prioridade,
  venceEm: Dia.nullable(),
  hora: HoraDoDia.nullable(),
  duracaoEstimadaMin: z.number().int().positive().max(1440).nullable(),
  recorrencia: Recorrencia.nullable(),
  etiquetas: z.array(NomeEtiqueta).max(20),
  /**
   * `null` tira o lembrete. Sem o campo, a tarefa nova com hora ganha o lembrete padrão e a que
   * muda fica com o que tinha.
   */
  lembreteMinutosAntes: MinutosAntes.nullable(),
};

const horaComDia = (t: { hora?: string | null; venceEm?: string | null }) =>
  !(typeof t.hora === "string" && t.venceEm === null);
const MENSAGEM_HORA_SEM_DIA = { path: ["hora"], message: "hora só com o dia" };

/** Sem `listaId`, vai para a Entrada. */
export const NovaTarefa = z
  .object(camposTarefa)
  .partial()
  .required({ titulo: true })
  .refine((t) => !(typeof t.hora === "string" && !t.venceEm), MENSAGEM_HORA_SEM_DIA);
export type NovaTarefa = z.infer<typeof NovaTarefa>;

/** Mudança parcial: só o que vem muda; `null` limpa o campo. Lista e mãe mudam por `tarefas.mover`. */
export const MudancaTarefa = z
  .object(camposTarefa)
  .omit({ listaId: true, tarefaPaiId: true })
  .partial()
  .extend({ id: Id })
  .refine(horaComDia, MENSAGEM_HORA_SEM_DIA);
export type MudancaTarefa = z.infer<typeof MudancaTarefa>;

export const PedidoTarefa = z.object({ id: Id });
export type PedidoTarefa = z.infer<typeof PedidoTarefa>;

/**
 * O recorte da área Tarefas e do painel. `hoje` traz as do dia, abertas e feitas hoje; `atrasadas`,
 * as abertas de antes de hoje; `semData`, as abertas sem dia; `proximas`, as abertas de amanhã em
 * diante. "Hoje" é o dia no fuso do usuário, que o serviço calcula. Sem `vista`, todas as abertas.
 */
export const VistaTarefas = z.enum(["hoje", "atrasadas", "semData", "proximas"]);
export type VistaTarefas = z.infer<typeof VistaTarefas>;

export const PedidoTarefas = z.object({
  vista: VistaTarefas.optional(),
  listaId: Id.optional(),
  etiquetaId: Id.optional(),
  /** As criadas a partir de uma nota ("Ligado a esta nota"). */
  notaId: Id.optional(),
  /** Inclui as feitas e as canceladas; sem o campo, só as abertas (menos em `hoje`). */
  todas: z.boolean().optional(),
});
export type PedidoTarefas = z.infer<typeof PedidoTarefas>;

/** Concluir uma recorrente gera a próxima, que volta junto. */
export const ConclusaoTarefa = z.object({ tarefa: Tarefa, proxima: Tarefa.nullable() });
export type ConclusaoTarefa = z.infer<typeof ConclusaoTarefa>;

/**
 * Adiar para um dia: `hoje` e `amanha` são o dia no fuso do usuário, que o serviço resolve
 * ("Trazer para hoje" do briefing, "Amanhã" do fechamento). Sem `hora`, a hora fica como estava.
 */
export const PedidoAdiarTarefas = z.object({
  ids: z.array(Id).min(1),
  para: z.union([Dia, z.enum(["hoje", "amanha"])]),
  hora: HoraDoDia.nullable().optional(),
});
export type PedidoAdiarTarefas = z.infer<typeof PedidoAdiarTarefas>;

/** Mover para outra lista ou para debaixo de outra tarefa (`tarefaPaiId`; `null` volta a ser tarefa). */
export const PedidoMoverTarefa = z.object({
  id: Id,
  listaId: Id.optional(),
  tarefaPaiId: Id.nullable().optional(),
});
export type PedidoMoverTarefa = z.infer<typeof PedidoMoverTarefa>;

/** O que mudou nas tarefas, de qualquer caminho (tela, captura, ferramenta, virada do dia). */
export const MudancaTarefas = z.object({ tarefas: z.array(Tarefa), apagadas: z.array(Id) });
export type MudancaTarefas = z.infer<typeof MudancaTarefas>;
