import { CanalLembrete, EstadoLembrete, HoraDoDia, Id, Recorrencia } from "@moductus/contrato";
import { z } from "zod";
import { somarDias, type TempoDoDia } from "../../areas/dia/tempo.ts";
import { TOLERANCIA_MS, type ServicoLembretes } from "../../areas/lembretes/lembretes.ts";
import { DiaDaFerramenta, resolverDia } from "../dia.ts";
import { carimboDe, ferramenta, type ContextoDesfazer, type Ferramenta } from "../ferramenta.ts";

/**
 * As ferramentas `lembretes.*` da Alba (AGENTS.md §2): "me lembra de ligar pro banco amanhã 15h"
 * vira um lembrete que dispara pelo relógio do dia, sem modelo. O horário vai em dia e hora no fuso
 * do usuário, e o serviço faz a conta do instante (ADR-0008). Tudo o que escreve é `interno` e se
 * desfaz pelo histórico (ADR-0029): a chamada guarda como cada lembrete estava antes e a versão em
 * que o deixou.
 */

/** Quantos lembretes uma chamada de adiar, concluir ou cancelar leva. */
export const LEMBRETES_POR_CHAMADA = 50;

export const MENSAGEM_HORARIO_PASSOU = "esse horário já passou: confira o dia e a hora";
export const MENSAGEM_DIA_E_HORA = "dia e hora mudam juntos";

const Ids = z
  .array(Id)
  .min(1)
  .max(LEMBRETES_POR_CHAMADA)
  .describe("Os lembretes, como lembretes.listar devolve");

const CamposGravados = z.object({
  texto: z.string(),
  quando: z.string(),
  recorrencia: z.string().nullable(),
  inicio_recorrencia: z.string().nullable(),
  canal: CanalLembrete,
  estado: EstadoLembrete,
  disparado_em: z.string().nullable(),
  adiado_ate: z.string().nullable(),
});
const Retrato = z.object({ id: z.string(), campos: CamposGravados, versao: z.string() });

/** O que a chamada que muda lembretes devolve e guarda: o resultado, o antes e a versão do depois. */
const MudancaGravada = z.object({ antes: z.array(Retrato), depois: z.array(Retrato) });

export function ferramentasLembretes(lembretes: ServicoLembretes, tempo: TempoDoDia): Ferramenta[] {
  /** O instante de um dia e hora no fuso de `config`; no passado, o modelo fica sabendo. */
  const instante = (dia: DiaDaFerramenta, hora: string): string => {
    const quando = tempo.instante(resolverDia(tempo, dia), hora);
    if (quando.getTime() < tempo.instanteDeAgora().getTime() - TOLERANCIA_MS) {
      throw new Error(MENSAGEM_HORARIO_PASSOU);
    }
    return quando.toISOString();
  };

  /** Roda uma escrita em vários e guarda como cada um estava antes e como ficou. */
  const comRetratos = async <T>(ids: readonly string[], fazer: () => Promise<T>) => {
    const unicos = [...new Set(ids)];
    const antes = lembretes.retratos(unicos);
    const resultado = await fazer();
    return { resultado, antes, depois: lembretes.retratos(unicos) };
  };

  const desfazerMudanca = (resultado: unknown, ctx: ContextoDesfazer): void => {
    const { antes, depois } = MudancaGravada.parse(resultado);
    const versoes = new Map(depois.map((r) => [r.id, r.versao]));
    lembretes.desfazerMudancas(
      antes.map((r) => ({ id: r.id, antes: r.campos, versao: versoes.get(r.id) ?? "" })),
      ctx.carimbo,
    );
  };

  return [
    ferramenta({
      nome: "lembretes.listar",
      descricao:
        "Os lembretes do usuário que tocam de um dia a outro (no fuso dele), ou só os de um estado: agendado, disparado (tocando), adiado ou perdido (atrasado). Traz também a data de hoje.",
      entrada: z.object({
        de: DiaDaFerramenta.optional().describe("Do começo deste dia: hoje, amanha ou AAAA-MM-DD"),
        ate: DiaDaFerramenta.optional().describe("Até o fim deste dia"),
        estados: z.array(EstadoLembrete).min(1).optional().describe("Só nestes estados"),
      }),
      efeito: "leitura",
      executar: ({ de, ate, estados }) => {
        const inicio = de === undefined ? undefined : tempo.inicioDoDia(resolverDia(tempo, de));
        const fim =
          ate === undefined
            ? undefined
            : new Date(tempo.inicioDoDia(somarDias(resolverDia(tempo, ate), 1)).getTime() - 1);
        return {
          hoje: tempo.hoje(),
          lembretes: lembretes.listar({ de: inicio?.toISOString(), ate: fim?.toISOString(), estados }),
        };
      },
    }),
    ferramenta({
      nome: "lembretes.criar",
      descricao:
        'Cria um lembrete que avisa o usuário no dia e hora pedidos ("me lembra de ligar pro banco amanhã 15h": texto "Ligar pro banco", dia amanha, hora 15:00). Toca mesmo sem modelo. O usuário pode desfazer pelo histórico.',
      entrada: z.object({
        texto: z.string().trim().min(1).max(500).describe("O que lembrar, curto"),
        dia: DiaDaFerramenta,
        hora: HoraDoDia.describe("A hora, HH:MM"),
        recorrencia: Recorrencia.optional().describe(
          "Regra RRULE do iCalendar, como FREQ=DAILY, para repetir",
        ),
        canal: CanalLembrete.optional().describe(
          "windows (aviso do Windows, o padrão), dock (só no painel) ou calendario",
        ),
      }),
      efeito: "interno",
      executar: ({ texto, dia, hora, recorrencia, canal }, ctx) =>
        lembretes.criar({ texto, quando: instante(dia, hora), recorrencia, canal }, carimboDe(ctx)),
      desfazer: (resultado, ctx) =>
        lembretes.desfazerCriacao(z.object({ id: z.string() }).parse(resultado), ctx),
    }),
    ferramenta({
      nome: "lembretes.definir",
      descricao:
        "Muda o texto, o horário (dia e hora juntos), a repetição ou o canal de um lembrete. Mudar o horário o volta a agendado.",
      entrada: z.object({
        id: Id.describe("O lembrete"),
        texto: z.string().trim().min(1).max(500).optional(),
        dia: DiaDaFerramenta.optional(),
        hora: HoraDoDia.optional().describe("A hora, HH:MM; vem junto com o dia"),
        recorrencia: Recorrencia.nullable().optional().describe("Regra RRULE; null para de repetir"),
        canal: CanalLembrete.optional(),
      }),
      efeito: "interno",
      executar: async ({ id, texto, dia, hora, recorrencia, canal }, ctx) => {
        if ((dia === undefined) !== (hora === undefined)) throw new Error(MENSAGEM_DIA_E_HORA);
        const quando = dia === undefined || hora === undefined ? undefined : instante(dia, hora);
        return comRetratos([id], () =>
          lembretes.definir({ id, texto, quando, recorrencia, canal }, carimboDe(ctx)),
        );
      },
      desfazer: desfazerMudanca,
    }),
    ferramenta({
      nome: "lembretes.adiar",
      descricao: "Adia lembretes por alguns minutos a partir de agora, como o Adiar do aviso.",
      entrada: z.object({
        ids: Ids,
        minutos: z.number().int().min(1).max(1440).describe("Quantos minutos a partir de agora"),
      }),
      efeito: "interno",
      executar: ({ ids, minutos }, ctx) =>
        comRetratos(ids, () => lembretes.adiar({ ids, minutos }, carimboDe(ctx))),
      desfazer: desfazerMudanca,
    }),
    ferramenta({
      nome: "lembretes.concluir",
      descricao:
        "Marca lembretes como feitos, como o Feito do aviso: o de uma vez sai; o que repete volta a esperar a próxima vez.",
      entrada: z.object({ ids: Ids }),
      efeito: "interno",
      executar: ({ ids }, ctx) => comRetratos(ids, () => lembretes.concluir({ ids }, carimboDe(ctx))),
      desfazer: desfazerMudanca,
    }),
    ferramenta({
      nome: "lembretes.cancelar",
      descricao: "Tira lembretes, mesmo os que repetem: não tocam mais.",
      entrada: z.object({ ids: Ids }),
      efeito: "interno",
      executar: ({ ids }, ctx) => comRetratos(ids, () => lembretes.cancelar({ ids }, carimboDe(ctx))),
      desfazer: desfazerMudanca,
    }),
  ];
}
