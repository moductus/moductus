import { Id, InstanteEntrada } from "@moductus/contrato";
import { z } from "zod";
import type { ServicoNotas } from "../../areas/notas/notas.ts";
import { carimboDe, ferramenta, RecusaDesfazer, type Ferramenta } from "../ferramenta.ts";

export const MENSAGEM_NADA_GRAVADO = "o texto não chegou a mudar: não há o que desfazer";

/**
 * As ferramentas `notas.*` da Alba (AGENTS.md §2): listar, ler, buscar, criar e reescrever o texto
 * de uma nota, pela mesma área que a tela Notas usa. Salvar manda a versão que leu, como a janela:
 * se você mexeu na nota no meio, nada é gravado e a Alba recebe as duas. Criar e salvar são
 * `interno` e se desfazem pelo histórico (ADR-0029). Lixeira, fixar e pasta ficam com a tela.
 */

const Titulo = z.string().max(500).describe("O título");
const Conteudo = z.string().max(1_000_000).describe("O texto, em Markdown");
const Pasta = z.string().trim().min(1).max(200).describe('A pasta, texto livre ("Pessoal · Viagem")');

/** O que a inversa lê do valor gravado. */
const NotaGravada = z.object({ id: z.string(), atualizadoEm: z.string() });
const SalvarGravado = z.object({
  salvou: z.boolean(),
  nota: NotaGravada.optional(),
  anterior: z.object({ titulo: z.string(), conteudo: z.string() }).nullable(),
});

export function ferramentasNotas(notas: ServicoNotas): Ferramenta[] {
  return [
    ferramenta({
      nome: "notas.listar",
      descricao:
        "As notas do usuário, com o começo do texto, o bloco rápido e as fixadas primeiro; com pasta, só as dela.",
      entrada: z.object({ pasta: Pasta.optional() }),
      efeito: "leitura",
      executar: (pedido) => notas.listar(pedido),
    }),
    ferramenta({
      nome: "notas.obter",
      descricao: "Uma nota inteira pelo id, com a versão (atualizadoEm) que notas.salvar pede.",
      entrada: z.object({ id: Id.describe("A nota") }),
      efeito: "leitura",
      executar: ({ id }) => notas.obter({ id }),
    }),
    ferramenta({
      nome: "notas.buscar",
      descricao:
        'Busca nas notas, sem acento e sem caixa ("amanha" acha "amanhã"), no título e no texto, com o trecho que bateu.',
      entrada: z.object({
        texto: z.string().trim().min(1).max(200).describe("O que procurar"),
        limite: z.number().int().min(1).max(100).optional().describe("Quantas no máximo; padrão 20"),
      }),
      efeito: "leitura",
      executar: (pedido) => notas.buscar(pedido),
    }),
    ferramenta({
      nome: "notas.criar",
      descricao: "Cria uma nota com título e texto. O usuário pode desfazer pelo histórico.",
      entrada: z.object({
        titulo: Titulo.optional(),
        conteudo: Conteudo.optional(),
        pasta: Pasta.optional(),
      }),
      efeito: "interno",
      executar: (nova, ctx) => notas.criar(nova, carimboDe(ctx)),
      desfazer: (resultado, ctx) => {
        const nota = NotaGravada.parse(resultado);
        notas.desfazerCriacao({ id: nota.id, versao: nota.atualizadoEm }, ctx);
      },
    }),
    ferramenta({
      nome: "notas.salvar",
      descricao:
        "Troca o título ou o texto de uma nota. Mande a versão (atualizadoEm) que leu em notas.obter: se a nota mudou depois, nada é gravado e voltam as duas, para você contar ao usuário em vez de escolher por ele.",
      entrada: z.object({
        id: Id.describe("A nota"),
        versao: InstanteEntrada.describe("O atualizadoEm da nota, como notas.obter devolveu"),
        titulo: Titulo.optional(),
        conteudo: Conteudo.optional(),
      }),
      efeito: "interno",
      executar: (pedido, ctx) => {
        if (pedido.titulo === undefined && pedido.conteudo === undefined) {
          throw new Error("diga o que salvar: o título, o texto ou os dois");
        }
        const antes = notas.obter({ id: pedido.id });
        const resultado = notas.salvar(pedido, carimboDe(ctx));
        // Recusado, ou o texto já era esse: não gravou nada, e o desfazer não tem o que voltar.
        const gravou =
          resultado.salvou &&
          resultado.nota.atualizadoEm !== antes.atualizadoEm &&
          antes.atualizadoEm === pedido.versao;
        return {
          ...resultado,
          anterior: gravou ? { titulo: antes.titulo, conteudo: antes.conteudo } : null,
        };
      },
      desfazer: (resultado, ctx) => {
        const { nota, anterior } = SalvarGravado.parse(resultado);
        if (nota === undefined || anterior === null) throw new RecusaDesfazer(MENSAGEM_NADA_GRAVADO);
        notas.desfazerTexto({ id: nota.id, versao: nota.atualizadoEm, antes: anterior }, ctx);
      },
    }),
  ];
}
