import { Alertas, HoraDoDia, Id, PedidoAgenda, PedidoAplicarSugestao, Recorrencia } from "@moductus/contrato";
import { z } from "zod";
import {
  FERRAMENTA_APLICAR_SUGESTAO,
  type CamposEvento,
  type ServicoAgenda,
} from "../../areas/agenda/agenda.ts";
import { somarDias, type TempoDoDia } from "../../areas/dia/tempo.ts";
import { DiaDaFerramenta, resolverDia } from "../dia.ts";
import { carimboDe, ferramenta, type Ferramenta } from "../ferramenta.ts";

/** Quem chama a ferramenta do encaixe pelo nome, sem o clique, ouve isto. */
export const MENSAGEM_SO_PELO_CLIQUE = "o encaixe da Alba só se aplica com o clique na agenda";

export const MENSAGEM_SO_LOCAL_E_MODUCTUS =
  'por aqui só se escreve no calendário local e no "Moductus"; os outros calendários são só leitura';

/** Uma hora de evento quando o modelo não diz quanto dura. */
export const DURACAO_PADRAO_MIN = 60;

/**
 * Quando um evento acontece, como o modelo manda: o dia e, no evento com hora, a hora e quanto dura,
 * no fuso do usuário. Sem hora, é de dia inteiro. A conta do instante é do serviço (ADR-0008).
 */
const Quando = z.object({
  dia: DiaDaFerramenta,
  hora: HoraDoDia.optional().describe("A hora de começo, HH:MM; sem ela, o evento é de dia inteiro"),
  duracaoMin: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe(`Quanto dura, em minutos; padrão ${DURACAO_PADRAO_MIN}`),
});

const campos = {
  titulo: z.string().trim().min(1).max(500).describe("O nome do compromisso"),
  descricao: z.string().max(10_000).nullable().describe("Detalhes"),
  local: z.string().max(500).nullable().describe("Onde"),
  alertas: Alertas.describe("Minutos antes de cada aviso, até 5"),
};

/** O que a inversa lê do valor gravado: o evento como a chamada o deixou e, ao mudar, como era. */
const EventoGravado = z.object({ id: z.string(), atualizadoEm: z.string() });
const CamposGravados = z.object({
  titulo: z.string(),
  descricao: z.string().nullable(),
  inicio: z.string(),
  fim: z.string(),
  diaInteiro: z.boolean(),
  local: z.string().nullable(),
  recorrencia: z.string().nullable(),
  alertas: z.array(z.number()),
});

/**
 * As ferramentas `agenda.*` da Alba (AGENTS.md §2): ler os calendários, o dia com os blocos livres e
 * um evento; criar e mudar evento no calendário local e no "Moductus", como `interno` com desfazer
 * (ADR-0029). Mudar nos outros calendários é `externo`, com cartão (F3-25). O encaixe aplicado
 * (`agenda.aplicar_sugestao`) existe só para o desfazer do histórico achar a inversa: nenhum agente o
 * vê, porque a Alba sugere e quem aplica é você ("Lota a agenda sem perguntar" está no "Nunca").
 */
export function ferramentasAgenda(agenda: ServicoAgenda, tempo: TempoDoDia): Ferramenta[] {
  /** Início e fim do evento: instantes no evento com hora, dias no de dia inteiro. */
  const pontas = (q: z.infer<typeof Quando>) => {
    const dia = resolverDia(tempo, q.dia);
    if (q.hora === undefined) return { inicio: dia, fim: somarDias(dia, 1), diaInteiro: true };
    const inicio = tempo.instante(dia, q.hora);
    const fim = new Date(inicio.getTime() + (q.duracaoMin ?? DURACAO_PADRAO_MIN) * 60_000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString(), diaInteiro: false };
  };

  const exigirEditavel = (calendarioId: string) => {
    const calendario = agenda.calendarios().find((c) => c.id === calendarioId);
    if (calendario && calendario.fonte !== "local" && !calendario.espelho) {
      throw new Error(MENSAGEM_SO_LOCAL_E_MODUCTUS);
    }
  };

  return [
    ferramenta({
      nome: FERRAMENTA_APLICAR_SUGESTAO,
      descricao: "Aplica o encaixe de uma tarefa num bloco livre da agenda, como evento do calendário local.",
      entrada: PedidoAplicarSugestao,
      efeito: "interno",
      soPelaInterface: true,
      executar: () => {
        throw new Error(MENSAGEM_SO_PELO_CLIQUE);
      },
      desfazer: (resultado, ctx) => agenda.desfazerSugestao(resultado, ctx),
    }),
    ferramenta({
      nome: "agenda.calendarios",
      descricao:
        'Os calendários que o Moductus conhece: o local, o "Moductus" (o espelho no Google, que avisa no celular) e os outros do Google, com quais a Alba lê e em quais escreve.',
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => agenda.calendarios(),
    }),
    ferramenta({
      nome: "agenda.consultar",
      descricao:
        "A agenda de um intervalo de dias (até 62), no fuso do usuário: os compromissos de todos os calendários lidos e, em cada dia, os blocos livres no expediente, quanto as tarefas do dia estimam e se o dia está cheio. Traz também a data de hoje.",
      entrada: z.object({
        de: DiaDaFerramenta.describe("O primeiro dia: hoje, amanha ou AAAA-MM-DD"),
        ate: DiaDaFerramenta.describe("O último dia, inclusive"),
      }),
      efeito: "leitura",
      executar: ({ de, ate }) => {
        const pedido = PedidoAgenda.parse({ de: resolverDia(tempo, de), ate: resolverDia(tempo, ate) });
        return { hoje: tempo.hoje(), ...agenda.consultar(pedido) };
      },
    }),
    ferramenta({
      nome: "agenda.obter_evento",
      descricao:
        "Um evento pelo id, como agenda.consultar devolve (eventoId), com descrição, local e alertas.",
      entrada: z.object({ id: Id.describe("O evento") }),
      efeito: "leitura",
      executar: ({ id }) => agenda.obterEvento({ id }),
    }),
    ferramenta({
      nome: "agenda.criar_evento",
      descricao:
        'Cria um compromisso no calendário local ou no "Moductus" (que leva ao Google e avisa no celular). Sem hora, é de dia inteiro. O usuário pode desfazer pelo histórico.',
      entrada: z.object({
        titulo: campos.titulo,
        quando: Quando,
        calendarioId: Id.optional().describe('O calendário; sem ele, o local. Só o local e o "Moductus"'),
        descricao: campos.descricao.optional(),
        local: campos.local.optional(),
        recorrencia: Recorrencia.optional().describe("Regra RRULE do iCalendar, como FREQ=WEEKLY;BYDAY=MO"),
        alertas: campos.alertas.optional(),
      }),
      efeito: "interno",
      executar: ({ quando, calendarioId, ...resto }, ctx) => {
        if (calendarioId !== undefined) exigirEditavel(calendarioId);
        return agenda.criarEvento({ ...resto, ...pontas(quando), calendarioId }, carimboDe(ctx));
      },
      desfazer: (resultado, ctx) => {
        const evento = EventoGravado.parse(resultado);
        agenda.desfazerEvento({ eventoId: evento.id, versao: evento.atualizadoEm, antes: null }, ctx);
      },
    }),
    ferramenta({
      nome: "agenda.mudar_evento",
      descricao:
        'Muda um compromisso do calendário local ou do "Moductus": só o que vier muda; para mudar o horário, mande o quando inteiro. Devolve o evento e como ele estava.',
      entrada: z.object({
        id: Id.describe("O evento"),
        titulo: campos.titulo.optional(),
        quando: Quando.optional(),
        descricao: campos.descricao.optional(),
        local: campos.local.optional(),
        recorrencia: Recorrencia.nullable().optional().describe("Regra RRULE; null para de repetir"),
        alertas: campos.alertas.optional(),
      }),
      efeito: "interno",
      executar: ({ id, quando, ...resto }, ctx) => {
        const antes = agenda.obterEvento({ id });
        exigirEditavel(antes.calendarioId);
        const evento = agenda.definirEvento(
          { id, ...resto, ...(quando === undefined ? {} : pontas(quando)) },
          carimboDe(ctx),
        );
        const anterior: CamposEvento = {
          titulo: antes.titulo,
          descricao: antes.descricao,
          inicio: antes.inicio,
          fim: antes.fim,
          diaInteiro: antes.diaInteiro,
          local: antes.local,
          recorrencia: antes.recorrencia,
          alertas: antes.alertas,
        };
        return { evento, anterior };
      },
      desfazer: (resultado, ctx) => {
        const { evento, anterior } = z
          .object({ evento: EventoGravado, anterior: CamposGravados })
          .parse(resultado);
        agenda.desfazerEvento({ eventoId: evento.id, versao: evento.atualizadoEm, antes: anterior }, ctx);
      },
    }),
  ];
}
