import {
  HoraDoDia,
  Id,
  MinutosAntes,
  MudancaTarefa,
  Prioridade,
  Recorrencia,
  VistaTarefas,
  type Tarefa,
} from "@moductus/contrato";
import { z } from "zod";
import type { TempoDoDia } from "../../areas/dia/tempo.ts";
import { mudancaDe, type ServicoTarefas } from "../../areas/tarefas/tarefas.ts";
import { DiaDaFerramenta, resolverDia } from "../dia.ts";
import { carimboDe, ferramenta, type Ferramenta } from "../ferramenta.ts";

/**
 * As ferramentas `tarefas.*` e `listas.listar` da Alba (AGENTS.md §2), sobre a mesma área que a
 * tela Tarefas usa: a regra (Entrada sem lista, lembrete da tarefa com hora, a próxima da recorrente)
 * é a da área. Tudo o que escreve é `interno` e se desfaz pelo histórico (ADR-0029): cada uma devolve
 * a tarefa como deixou, e a inversa só desfaz se ela continua assim.
 *
 * O Nuno também tem `tarefas.criar` (a tarefa que nasce de um review), e só ela.
 *
 * Mandar à lixeira, mover e as listas e etiquetas ficam com a tela: são do usuário arrumar, e a
 * lixeira não volta por aqui.
 */

/** Quantas tarefas um adiar da Alba leva: o desfazer guarda o retrato de cada uma. */
export const ADIAR_MAXIMO = 100;

const campos = {
  titulo: z.string().trim().min(1).max(500).describe("O que fazer, curto, como o usuário diria"),
  notas: z.string().max(10_000).nullable().describe("Detalhes, em texto livre"),
  prioridade: Prioridade.describe("0 nenhuma, 1 baixa, 2 média, 3 alta"),
  venceEm: DiaDaFerramenta.nullable().describe("O dia da tarefa: hoje, amanha ou AAAA-MM-DD"),
  hora: HoraDoDia.nullable().describe("A hora, HH:MM; só com o dia"),
  duracaoEstimadaMin: z
    .number()
    .int()
    .positive()
    .max(1440)
    .nullable()
    .describe("Quanto deve levar, em minutos"),
  recorrencia: Recorrencia.nullable().describe("Regra RRULE do iCalendar, como FREQ=WEEKLY;BYDAY=MO"),
  etiquetas: z.array(z.string().trim().min(1).max(60)).max(20).describe("Etiquetas pelo nome"),
  lembreteMinutosAntes: MinutosAntes.nullable().describe(
    "Minutos antes da hora em que o lembrete da tarefa toca; sem o campo, 15 na tarefa nova com hora; null tira",
  ),
};

/** Na tarefa nova, tudo menos o título é opcional, e a lista e a mãe entram. */
const NovaTarefaDaAlba = z
  .object({
    ...campos,
    listaId: Id.describe("A lista, como listas.listar devolve; sem ela, a Entrada"),
    tarefaPaiId: Id.describe("A tarefa mãe, para criar uma subtarefa"),
  })
  .partial()
  .required({ titulo: true });

/** Só o que vem muda; `null` limpa. Lista e mãe ficam com a tela. */
const MudancaDaAlba = z
  .object(campos)
  .partial()
  .extend({ id: Id.describe("A tarefa, como tarefas.listar devolve") });

/** O que a inversa lê do valor gravado: a tarefa e a versão em que a chamada a deixou. */
const TarefaGravada = z.object({ id: z.string(), atualizadoEm: z.string() });
const Retratos = z.array(MudancaTarefa);

const alvoDe = (t: z.infer<typeof TarefaGravada>) => ({ id: t.id, versao: t.atualizadoEm });

export function ferramentasTarefas(tarefas: ServicoTarefas, tempo: TempoDoDia): Ferramenta[] {
  const dia = (valor: DiaDaFerramenta | null | undefined) =>
    valor === undefined || valor === null ? valor : resolverDia(tempo, valor);

  /** Só fecha a aberta: a inversa a devolve aberta, e fechar a fechada não teria volta certa. */
  const exigirAberta = (id: string): Tarefa => {
    const tarefa = tarefas.obter({ id });
    if (tarefa.estado !== "aberta") {
      throw new Error(`a tarefa já está ${tarefa.estado === "feita" ? "feita" : "descartada"}`);
    }
    return tarefa;
  };

  return [
    ferramenta({
      nome: "listas.listar",
      descricao:
        "As listas de tarefas do usuário (Entrada, Trabalho, Pessoal e as que ele criou), com id, nome e se estão arquivadas.",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => tarefas.listas(),
    }),
    ferramenta({
      nome: "tarefas.listar",
      descricao:
        "As tarefas do usuário e a data de hoje no fuso dele. Vista hoje: as de hoje, abertas e feitas hoje; atrasadas: abertas de antes de hoje; semData; proximas: de amanhã em diante; sem vista, todas as abertas. As subtarefas vêm junto.",
      entrada: z.object({
        vista: VistaTarefas.optional().describe("hoje, atrasadas, semData ou proximas"),
        listaId: Id.optional().describe("Só desta lista"),
        etiquetaId: Id.optional().describe("Só com esta etiqueta"),
        todas: z.boolean().optional().describe("Inclui feitas e descartadas"),
      }),
      efeito: "leitura",
      executar: (pedido) => ({ hoje: tempo.hoje(), tarefas: tarefas.listar(pedido) }),
    }),
    ferramenta({
      nome: "tarefas.obter",
      descricao: "Uma tarefa pelo id, com as etiquetas e o lembrete.",
      entrada: z.object({ id: Id.describe("A tarefa, como tarefas.listar devolve") }),
      efeito: "leitura",
      executar: ({ id }) => tarefas.obter({ id }),
    }),
    ferramenta({
      nome: "tarefas.criar",
      descricao:
        "Cria uma tarefa (sem lista, vai para a Entrada). Com dia e hora, ganha um lembrete 15 minutos antes. Use para o que o usuário pediu para fazer; para só avisar numa hora, use lembretes.criar. O usuário pode desfazer pelo histórico.",
      entrada: NovaTarefaDaAlba,
      efeito: "interno",
      executar: (nova, ctx) => tarefas.criar({ ...nova, venceEm: dia(nova.venceEm) }, carimboDe(ctx)),
      desfazer: (resultado, ctx) =>
        tarefas.desfazerCriacao(alvoDe(TarefaGravada.parse(resultado)), ctx.carimbo),
    }),
    ferramenta({
      nome: "tarefas.definir",
      descricao:
        "Muda uma tarefa: só os campos que vierem mudam, e null limpa. Sem o dia, a hora sai junto. Devolve a tarefa e como ela estava.",
      entrada: MudancaDaAlba,
      efeito: "interno",
      executar: (mudanca, ctx) => {
        const antes = tarefas.obter({ id: mudanca.id });
        const tarefa = tarefas.definir({ ...mudanca, venceEm: dia(mudanca.venceEm) }, carimboDe(ctx));
        return { tarefa, anterior: mudancaDe(antes) };
      },
      desfazer: (resultado, ctx) => {
        const { tarefa, anterior } = z
          .object({ tarefa: TarefaGravada, anterior: MudancaTarefa })
          .parse(resultado);
        tarefas.desfazerMudancas([{ antes: anterior, versao: tarefa.atualizadoEm }], ctx.carimbo);
      },
    }),
    ferramenta({
      nome: "tarefas.concluir",
      descricao:
        "Marca uma tarefa aberta como feita, com as subtarefas abertas dela. A recorrente gera a próxima, que volta junto.",
      entrada: z.object({ id: Id.describe("A tarefa") }),
      efeito: "interno",
      executar: ({ id }, ctx) => {
        exigirAberta(id);
        return tarefas.concluir({ id }, carimboDe(ctx));
      },
      desfazer: (resultado, ctx) => {
        const { tarefa } = z.object({ tarefa: TarefaGravada }).parse(resultado);
        tarefas.desfazerFechamento(alvoDe(tarefa), ctx.carimbo);
      },
    }),
    ferramenta({
      nome: "tarefas.cancelar",
      descricao:
        "Descarta uma tarefa aberta: sai das abertas sem contar como feita, com as subtarefas abertas. Na recorrente, descarta só esta vez.",
      entrada: z.object({ id: Id.describe("A tarefa") }),
      efeito: "interno",
      executar: ({ id }, ctx) => {
        exigirAberta(id);
        return tarefas.cancelar({ id }, carimboDe(ctx));
      },
      desfazer: (resultado, ctx) =>
        tarefas.desfazerFechamento(alvoDe(TarefaGravada.parse(resultado)), ctx.carimbo),
    }),
    ferramenta({
      nome: "tarefas.adiar",
      descricao:
        "Muda o dia (e a hora, se vier) de uma ou mais tarefas; o lembrete de cada uma acompanha. Para trazer as atrasadas para hoje, use para: hoje.",
      entrada: z.object({
        ids: z.array(Id).min(1).max(ADIAR_MAXIMO).describe("As tarefas"),
        para: DiaDaFerramenta.describe("O dia novo: hoje, amanha ou AAAA-MM-DD"),
        hora: HoraDoDia.nullable().optional().describe("A hora nova, HH:MM; sem o campo, fica a que era"),
      }),
      efeito: "interno",
      executar: ({ ids, para, hora }, ctx) => {
        const antes = ids.map((id) => tarefas.obter({ id }));
        const depois = tarefas.adiar({ ids, para: resolverDia(tempo, para), hora }, carimboDe(ctx));
        // Só o que adiar mexe volta: o dia, a hora e o lembrete que acompanha a hora.
        const anteriores = antes.map((t) => ({
          id: t.id,
          venceEm: t.venceEm,
          hora: t.hora,
          lembreteMinutosAntes: t.lembreteMinutosAntes,
        }));
        return { tarefas: depois, anteriores };
      },
      desfazer: (resultado, ctx) => {
        const { tarefas: depois, anteriores } = z
          .object({ tarefas: z.array(TarefaGravada), anteriores: Retratos })
          .parse(resultado);
        const versoes = new Map(depois.map((t) => [t.id, t.atualizadoEm]));
        tarefas.desfazerMudancas(
          anteriores.map((antes) => ({ antes, versao: versoes.get(antes.id) ?? "" })),
          ctx.carimbo,
        );
      },
    }),
  ];
}
