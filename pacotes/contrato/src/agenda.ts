import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante, Recorrencia } from "./comum.ts";

/**
 * Agenda da Alba (DATA.md §2; migração 014; ADR-0035): calendários, eventos e o dia com os blocos
 * livres. O calendário local e o "Moductus" (o espelho no Google) a Alba escreve sem pedir; os
 * outros que você escolheu ler são só leitura por aqui, e mudar neles é ferramenta `externo`, com
 * cartão. O horário livre e o "dia cheio" são contas do serviço (`areas/agenda`).
 */

/** O calendário que já nasce no banco, com id fixo igual em todo PC (migração 014). */
export const CALENDARIO_LOCAL = "local";

export const FonteCalendario = z.enum(["local", "google", "outlook"]);
export type FonteCalendario = z.infer<typeof FonteCalendario>;

/**
 * `espelho` é o "Moductus" criado no Google; `ler`, se a Alba lê os eventos dele (a escolha em
 * Conexões › Google); `sincronizadoEm`, a última leitura de lá (vazio no local).
 */
export const Calendario = z.object({
  id: Id,
  nome: z.string().trim().min(1),
  fonte: FonteCalendario,
  cor: z.string().min(1).nullable(),
  espelho: z.boolean(),
  podeEscrever: z.boolean(),
  ler: z.boolean(),
  sincronizadoEm: Instante.nullable(),
});
export type Calendario = z.infer<typeof Calendario>;

/** O que você muda num calendário por aqui: se a Alba o lê, e o nome e a cor do local. */
export const MudancaCalendario = z.object({
  id: Id,
  ler: z.boolean().optional(),
  nome: z.string().trim().min(1).max(80).optional(),
  cor: z.string().min(1).nullable().optional(),
});
export type MudancaCalendario = z.infer<typeof MudancaCalendario>;

/** Minutos antes de cada aviso: até 5, de 0 a 4 semanas, como o `popup` do Google (ADR-0035). */
export const Alertas = z.array(z.number().int().min(0).max(40320)).max(5);
export type Alertas = z.infer<typeof Alertas>;

interface Quando {
  diaInteiro?: boolean;
  inicio?: string;
  fim?: string;
}

const ehDia = (valor: string) => Dia.safeParse(valor).success;
const ehInstante = (valor: string) => Instante.safeParse(valor).success;

/**
 * Evento com hora vai em instantes UTC; o de dia inteiro, em dias (`AAAA-MM-DD`), com o `fim` no
 * dia seguinte ao último, como o iCalendar e o Google. Vale para o que tem os três campos.
 */
function quandoCoerente(q: Quando): boolean {
  if (q.diaInteiro === undefined || q.inicio === undefined || q.fim === undefined) return true;
  if (q.diaInteiro) return ehDia(q.inicio) && ehDia(q.fim) && q.fim > q.inicio;
  return ehInstante(q.inicio) && ehInstante(q.fim) && Date.parse(q.fim) >= Date.parse(q.inicio);
}
const MENSAGEM_QUANDO = {
  path: ["fim"],
  message: "evento com hora vai em instantes, o de dia inteiro em dias, e o fim não vem antes do início",
};

/** Início ou fim: instante UTC no evento com hora, dia no de dia inteiro. */
const Ponta = z.union([Instante, Dia]);

/**
 * Um evento. `editavel` diz se dá para mudar por aqui (local e "Moductus"); o de outro calendário
 * abre só leitura, com "Pedir à Alba para mudar".
 */
export const EventoAgenda = z
  .object({
    id: Id,
    calendarioId: Id,
    titulo: z.string().trim().min(1),
    descricao: z.string().nullable(),
    inicio: Ponta,
    fim: Ponta,
    diaInteiro: z.boolean(),
    local: z.string().nullable(),
    recorrencia: Recorrencia.nullable(),
    alertas: Alertas,
    editavel: z.boolean(),
    ...CamposOrigem,
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  .refine(quandoCoerente, MENSAGEM_QUANDO);
export type EventoAgenda = z.infer<typeof EventoAgenda>;

const camposEvento = {
  calendarioId: Id,
  titulo: z.string().trim().min(1).max(500),
  descricao: z.string().max(10_000).nullable(),
  inicio: Ponta,
  fim: Ponta,
  diaInteiro: z.boolean(),
  local: z.string().max(500).nullable(),
  recorrencia: Recorrencia.nullable(),
  alertas: Alertas,
};

/** Sem `calendarioId`, vai para o local. */
export const NovoEvento = z
  .object(camposEvento)
  .partial()
  .required({ titulo: true, inicio: true, fim: true, diaInteiro: true })
  .refine(quandoCoerente, MENSAGEM_QUANDO);
export type NovoEvento = z.infer<typeof NovoEvento>;

/** Mudança parcial. Início, fim e dia inteiro andam juntos: quem muda um manda os três. */
export const MudancaEvento = z
  .object(camposEvento)
  .omit({ calendarioId: true })
  .partial()
  .extend({ id: Id })
  .refine(
    (m) =>
      [m.inicio, m.fim, m.diaInteiro].every((c) => c === undefined) ||
      [m.inicio, m.fim, m.diaInteiro].every((c) => c !== undefined),
    { path: ["inicio"], message: "início, fim e dia inteiro mudam juntos" },
  )
  .refine(quandoCoerente, MENSAGEM_QUANDO);
export type MudancaEvento = z.infer<typeof MudancaEvento>;

export const PedidoEvento = z.object({ id: Id });
export type PedidoEvento = z.infer<typeof PedidoEvento>;

/** Os dias de `de` a `ate`, inclusive, no fuso do usuário; até 62 dias, a janela do cache. */
export const PedidoAgenda = z
  .object({ de: Dia, ate: Dia })
  .refine((p) => p.ate >= p.de, { path: ["ate"], message: "o fim não vem antes do início" })
  .refine((p) => Date.parse(p.ate) - Date.parse(p.de) <= 61 * 86_400_000, {
    path: ["ate"],
    message: "no máximo 62 dias de uma vez",
  });
export type PedidoAgenda = z.infer<typeof PedidoAgenda>;

/**
 * Uma vez em que um evento acontece no intervalo: o recorrente aparece uma vez por ocorrência,
 * com `eventoId` apontando para o evento que abre no detalhe.
 */
export const Ocorrencia = z
  .object({
    eventoId: Id,
    calendarioId: Id,
    titulo: z.string().trim().min(1),
    inicio: Ponta,
    fim: Ponta,
    diaInteiro: z.boolean(),
    local: z.string().nullable(),
    recorrente: z.boolean(),
    editavel: z.boolean(),
  })
  .refine(quandoCoerente, MENSAGEM_QUANDO);
export type Ocorrencia = z.infer<typeof Ocorrencia>;

export const BlocoLivre = z.object({
  inicio: Instante,
  fim: Instante,
  minutos: z.number().int().positive(),
});
export type BlocoLivre = z.infer<typeof BlocoLivre>;

/**
 * Um dia da agenda: os blocos livres dentro do expediente, quanto há de livre e quanto as tarefas
 * do dia estimam. `cheio` é o planejado passando do livre ("7h planejadas para 5h livres").
 */
export const DiaDaAgenda = z.object({
  dia: Dia,
  livres: z.array(BlocoLivre),
  livreMin: z.number().int().nonnegative(),
  planejadoMin: z.number().int().nonnegative(),
  cheio: z.boolean(),
});
export type DiaDaAgenda = z.infer<typeof DiaDaAgenda>;

export const Agenda = z.object({ ocorrencias: z.array(Ocorrencia), dias: z.array(DiaDaAgenda) });
export type Agenda = z.infer<typeof Agenda>;

/** O que mudou nos eventos, pela tela, por uma ferramenta ou pela leitura do Google. */
export const MudancaAgenda = z.object({ eventos: z.array(EventoAgenda), apagados: z.array(Id) });
export type MudancaAgenda = z.infer<typeof MudancaAgenda>;
