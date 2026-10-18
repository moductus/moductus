import { PedidoAplicarSugestao } from "@moductus/contrato";
import { FERRAMENTA_APLICAR_SUGESTAO, type ServicoAgenda } from "../../areas/agenda/agenda.ts";
import { ferramenta, type Ferramenta } from "../ferramenta.ts";

/** Quem chama a ferramenta do encaixe pelo nome, sem o clique, ouve isto. */
export const MENSAGEM_SO_PELO_CLIQUE = "o encaixe da Alba só se aplica com o clique na agenda";

/**
 * As ferramentas da agenda. Por ora só a do encaixe aplicado (`agenda.aplicarSugestao`), que existe
 * no catálogo para o desfazer do histórico achar a inversa: nenhum agente a vê, porque a Alba
 * sugere e quem aplica é você (AGENTS.md §2, "Lota a agenda sem perguntar" está no "Nunca"). As de
 * leitura e escrita da Alba chegam com a F3-26.
 */
export function ferramentasAgenda(agenda: ServicoAgenda): Ferramenta[] {
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
  ];
}
