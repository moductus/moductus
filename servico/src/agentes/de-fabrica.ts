import type { AgenteDeFabrica, ConfigAgente } from "@moductus/contrato";

/**
 * Os quatro agentes de fábrica num lugar só (AGENTS.md §1 e §2, DESIGN.md §6): o que volta ao
 * padrão com `agentes.restaurarPadrao` e o que uma migração lê quando muda um deles. O modelo
 * (principal, reserva e teto) não está aqui: é escolha do usuário e fica como está ao restaurar,
 * assim como o estado (ligado, em pausa, dormindo) e o histórico.
 *
 * A migração 003 semeou os quatro com estes mesmos valores, escritos no SQL dela (migração
 * publicada não muda). Daqui em diante, quem mudar um de fábrica muda aqui e numa migração nova
 * que lê daqui (`sqlDeFabrica`): `de-fabrica.test.ts` confere que um banco novo, com todas as
 * migrações, tem o time exatamente como está aqui.
 */
export type DefinicaoDeFabrica = Pick<
  ConfigAgente,
  "nome" | "funcao" | "instrucoes" | "personagem" | "ferramentas" | "gatilhos" | "escoposMemoria"
>;

/** Os gatilhos ficam vazios até cada área ligar os vigias do seu agente. */
export const DE_FABRICA: Readonly<Record<AgenteDeFabrica, DefinicaoDeFabrica>> = {
  alba: {
    nome: "Alba",
    funcao: "Cuida do seu dia",
    instrucoes:
      "Você é a Alba e cuida do dia a dia: agenda, tarefas, lembretes, rotina e foco. Mensagem sem destinatário claro vem para você.",
    personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
    ferramentas: ["agenda.*", "tarefas.*", "lembretes.*", "foco.*", "notas.*", "memoria.*"],
    gatilhos: [],
    escoposMemoria: ["dia", "geral"],
  },
  tula: {
    nome: "Tula",
    funcao: "Cuida do seu dinheiro",
    instrucoes:
      "Você é a Tula e cuida do dinheiro: gastos, dívidas, planos e orçamento. Organiza e calcula; nunca paga, transfere, acessa banco ou recomenda investimento. A decisão é do usuário.",
    personagem: { silhueta: "pera", traco: "coque", tom: "musgo" },
    ferramentas: ["financas.*", "dividas.*", "planos.*", "arquivos.ler_texto", "memoria.*"],
    gatilhos: [],
    escoposMemoria: ["financas"],
  },
  faina: {
    nome: "Faina",
    funcao: "Faz o serviço pesado",
    instrucoes:
      "Você é a Faina e cuida dos arquivos e das tarefas trabalhosas no PC, sempre em plano, prévia, aprovação, execução e registro. Só mexe nas pastas autorizadas, nunca toca em nada do sistema e nunca apaga de vez: tudo vai para a Lixeira.",
    personagem: { silhueta: "bloco", traco: "bandana", tom: "terracota" },
    ferramentas: ["arquivos.*", "documentos.*", "ocr.ler", "memoria.*"],
    gatilhos: [],
    escoposMemoria: ["arquivos", "geral"],
  },
  nuno: {
    nome: "Nuno",
    funcao: "Fica de olho nas suas IAs e no seu código",
    instrucoes:
      "Você é o Nuno e acompanha as sessões de agentes de código e o trabalho no GitHub. Comentar, aprovar PR ou responder pedido de permissão só com cartão de aprovação ou regra criada pelo usuário.",
    personagem: { silhueta: "capsula", traco: "fones", tom: "ardosia" },
    ferramentas: ["sessoes.*", "uso.*", "github.*", "tarefas.criar"],
    gatilhos: [],
    escoposMemoria: ["dev", "geral"],
  },
};

/** A definição de fábrica de um id; `null` se o id não é de um dos quatro. */
export function definicaoDeFabrica(id: string): DefinicaoDeFabrica | null {
  return Object.hasOwn(DE_FABRICA, id) ? DE_FABRICA[id as AgenteDeFabrica] : null;
}

/** As colunas de `agentes` que a definição de fábrica cobre. */
export type CampoDeFabrica =
  "nome" | "funcao" | "instrucoes" | "personagem" | "ferramentas" | "gatilhos" | "escopos_memoria";

/** A definição como fica nas colunas de `agentes`: listas e personagem em JSON. */
export function colunasDeFabrica(d: DefinicaoDeFabrica): Record<CampoDeFabrica, string> {
  return {
    nome: d.nome,
    funcao: d.funcao,
    instrucoes: d.instrucoes,
    personagem: JSON.stringify(d.personagem),
    ferramentas: JSON.stringify(d.ferramentas),
    gatilhos: JSON.stringify(d.gatilhos),
    escopos_memoria: JSON.stringify(d.escoposMemoria),
  };
}

const literal = (texto: string) => `'${texto.replaceAll("'", "''")}'`;

/**
 * O `UPDATE` com que uma migração leva campos de um agente de fábrica ao que está aqui. Migração
 * é texto SQL numa transação: os valores entram como literais, com a aspa dobrada.
 */
export function sqlDeFabrica(id: AgenteDeFabrica, campos: readonly CampoDeFabrica[]): string {
  if (campos.length === 0) throw new Error("diga quais campos do agente de fábrica mudam");
  const colunas = colunasDeFabrica(DE_FABRICA[id]);
  const valores = campos.map((c) => `${c} = ${literal(colunas[c])}`).join(", ");
  return `UPDATE agentes SET ${valores} WHERE id = ${literal(id)} AND de_fabrica = 1;`;
}
