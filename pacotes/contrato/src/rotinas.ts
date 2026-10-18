import { z } from "zod";
import { Dia, Id, Instante } from "./comum.ts";
import { HoraDoDia } from "./config.ts";
import { Tarefa } from "./tarefas.ts";

/**
 * Briefing da manhã e fechamento do dia (AGENTS.md §2; DATA.md §2 rotinas; migração 014;
 * ADR-0039). As linhas são montadas por código no serviço, a partir das áreas e do resumo de cada
 * agente; o modelo da Alba só redige a abertura, e sem ele sai a frase de molde.
 */

export const TipoRotina = z.enum(["briefing", "fechamento"]);
export type TipoRotina = z.infer<typeof TipoRotina>;

/** As duas rotinas que já nascem no banco, com o id igual ao tipo em todo PC (migração 014). */
export const ROTINAS_PADRAO = TipoRotina.options;

/** De 1 (segunda) a 7 (domingo), como a ISO 8601. */
export const DiaDaSemana = z.number().int().min(1).max(7);
export type DiaDaSemana = z.infer<typeof DiaDaSemana>;

const DiasSemana = z
  .array(DiaDaSemana)
  .min(1)
  .refine((d) => new Set(d).size === d.length, "dia da semana repetido");

/** O briefing sem `hora` sai na primeira atividade do dia; o fechamento sempre tem hora. */
export const Rotina = z
  .object({
    id: Id,
    tipo: TipoRotina,
    hora: HoraDoDia.nullable(),
    diasSemana: DiasSemana,
    ativa: z.boolean(),
  })
  .refine((r) => r.tipo !== "fechamento" || r.hora !== null, {
    path: ["hora"],
    message: "o fechamento tem hora",
  });
export type Rotina = z.infer<typeof Rotina>;

/** Configurações › O dia: a hora (vazia no briefing é a primeira atividade), os dias e desligar. */
export const MudancaRotina = z.object({
  id: Id,
  hora: HoraDoDia.nullable().optional(),
  diasSemana: DiasSemana.optional(),
  ativa: z.boolean().optional(),
});
export type MudancaRotina = z.infer<typeof MudancaRotina>;

/**
 * Uma linha, na ordem do AGENTS.md (Alba, Ontem, Tula, Nuno, Faina, ações). `agenteId` é de quem
 * é a linha; `rotulo`, o nome da seção quando não é um agente ("Ontem"); `tarefaIds`, as tarefas
 * que ela cita, para as ações.
 */
export const LinhaRotina = z.object({
  agenteId: Id.nullable(),
  rotulo: z.string().min(1).nullable(),
  texto: z.string().trim().min(1),
  tarefaIds: z.array(Id),
});
export type LinhaRotina = z.infer<typeof LinhaRotina>;

/**
 * O que se faz com a rotina. Briefing: Começar o dia, Ajustar plano, Fechar. Fechamento: Adiar
 * 30 min, Encerrar o dia, Fechar. `ignorado` é a que fechou sozinha, que só o serviço marca.
 */
export const AcaoRotina = z.enum(["comecar", "ajustar", "adiar", "encerrar", "fechar", "ignorado"]);
export type AcaoRotina = z.infer<typeof AcaoRotina>;

export const AcaoEscolhida = AcaoRotina.exclude(["ignorado"]);
export type AcaoEscolhida = z.infer<typeof AcaoEscolhida>;

/** O briefing cabe em 6 linhas (PRODUCT.md §11). */
export const LINHAS_DO_BRIEFING = 6;

/**
 * Uma vez em que a rotina apareceu (`rotinas_registro`): o dia, a abertura e as linhas, as tarefas
 * que ficaram abertas (o "Ficou aberto" do fechamento, com Amanhã, Outra data e Descartar) e a
 * ação escolhida. `daExecucaoId` é a execução da Alba que redigiu a abertura; vazio quando saiu a
 * frase de molde.
 */
export const ApresentacaoRotina = z
  .object({
    id: Id,
    rotinaId: Id,
    tipo: TipoRotina,
    dia: Dia,
    abertura: z.string().trim().min(1),
    daExecucaoId: Id.nullable(),
    linhas: z.array(LinhaRotina),
    abertas: z.array(Tarefa),
    acao: AcaoRotina.nullable(),
    acaoEm: Instante.nullable(),
    criadoEm: Instante,
  })
  .refine((a) => a.tipo !== "briefing" || a.linhas.length <= LINHAS_DO_BRIEFING, {
    path: ["linhas"],
    message: `o briefing tem até ${LINHAS_DO_BRIEFING} linhas`,
  })
  .refine((a) => (a.acao === null) === (a.acaoEm === null), {
    path: ["acaoEm"],
    message: "só a rotina com ação tem a hora da ação",
  });
export type ApresentacaoRotina = z.infer<typeof ApresentacaoRotina>;

/** O briefing e o fechamento do dia, se já apareceram, e se você encerrou o dia. */
export const RotinasDeHoje = z.object({
  briefing: ApresentacaoRotina.nullable(),
  fechamento: ApresentacaoRotina.nullable(),
  diaEncerrado: z.boolean(),
});
export type RotinasDeHoje = z.infer<typeof RotinasDeHoje>;

export const PedidoAgirRotina = z.object({ id: Id, acao: AcaoEscolhida });
export type PedidoAgirRotina = z.infer<typeof PedidoAgirRotina>;
