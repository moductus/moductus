import { isDeepStrictEqual } from "node:util";
import {
  CampoDeFabrica as CampoDaDefinicao,
  type AgenteDeFabrica,
  type ConfigAgente,
} from "@moductus/contrato";

/**
 * Os quatro agentes de fábrica num lugar só (AGENTS.md §1 e §2, DESIGN.md §6): o que volta ao
 * padrão com `agentes.restaurarPadrao` e o que uma migração lê quando muda um deles. O modelo
 * (principal, reserva e teto) não está aqui: é escolha do usuário e fica como está ao restaurar,
 * assim como o estado (ligado, em pausa, dormindo) e o histórico.
 *
 * A migração 003 semeou os quatro com estes mesmos valores, escritos no SQL dela (migração
 * publicada não muda). Daqui em diante, quem mudar um de fábrica muda aqui e numa migração nova
 * que lê daqui (`sqlDeFabrica`, que só troca o campo que ainda está como veio de fábrica):
 * `de-fabrica.test.ts` confere que um banco novo, com todas as migrações, tem o time exatamente
 * como está aqui.
 */
export type DefinicaoDeFabrica = Pick<ConfigAgente, CampoDaDefinicao>;

/**
 * Os gatilhos ficam vazios: os vigias de cada um são código do serviço (`vigias/`), que não gasta
 * token. Um gatilho aqui faria o agendador acordar o modelo com as ferramentas, e o despertar dos
 * vigias é contido: sem ferramentas e com prazo (ADR-0030, ADR-0039).
 */
export const DE_FABRICA: Readonly<Record<AgenteDeFabrica, DefinicaoDeFabrica>> = {
  alba: {
    nome: "Alba",
    funcao: "Cuida do seu dia",
    instrucoes:
      "Você é a Alba e cuida do dia a dia: agenda, tarefas, lembretes, rotina e foco. Mensagem sem destinatário claro vem para você. Para criar ou mudar algo, use as ferramentas com o dia e a hora que o usuário disse; se faltar, pergunte em vez de supor. Fale em até duas frases, com o número antes do adjetivo e sem emoji. Nunca lote a agenda sem perguntar nem cobre o que ficou por fazer.",
    personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
    ferramentas: ["agenda.*", "tarefas.*", "listas.listar", "lembretes.*", "foco.*", "notas.*", "memoria.*"],
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

/**
 * Os campos em que um agente de fábrica saiu da definição de fábrica, na ordem do contrato: o
 * selo "personalizada" e a lista do que muda ao restaurar. Listas comparam na ordem, como a
 * migração que lê daqui. O criado por você não tem padrão, e a lista fica vazia.
 */
export function camposPersonalizados(
  id: string,
  deFabrica: boolean,
  atual: DefinicaoDeFabrica,
): CampoDaDefinicao[] {
  const definicao = deFabrica ? definicaoDeFabrica(id) : null;
  if (!definicao) return [];
  return CampoDaDefinicao.options.filter((campo) => !isDeepStrictEqual(atual[campo], definicao[campo]));
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

const COLUNA: Readonly<Record<keyof DefinicaoDeFabrica, CampoDeFabrica>> = {
  nome: "nome",
  funcao: "funcao",
  instrucoes: "instrucoes",
  personagem: "personagem",
  ferramentas: "ferramentas",
  gatilhos: "gatilhos",
  escoposMemoria: "escopos_memoria",
};

const literal = (texto: string) => `'${texto.replaceAll("'", "''")}'`;

/** O valor de um campo como fica na coluna: texto como está, listas e personagem em JSON. */
const emColuna = (valor: DefinicaoDeFabrica[keyof DefinicaoDeFabrica]) =>
  typeof valor === "string" ? valor : JSON.stringify(valor);

/**
 * O SQL com que uma migração leva campos de um agente de fábrica ao que está aqui, sem passar
 * por cima da personalização. `antes` diz, campo a campo, o valor de fábrica que a migração
 * troca, e o campo só muda onde ainda é esse (`AND <coluna> = <valor antigo>`): o que o usuário
 * mudou fica como ele deixou, e só "restaurar padrão" leva ao de fábrica de agora. Um `UPDATE`
 * por campo, para quem personalizou o nome ainda receber as ferramentas novas. Listas e
 * personagem comparam por `json()`, que não liga para espaço. Migração é texto SQL numa
 * transação: os valores entram como literais, com a aspa dobrada.
 */
export function sqlDeFabrica(id: AgenteDeFabrica, antes: Partial<DefinicaoDeFabrica>): string {
  const campos = (Object.keys(antes) as (keyof DefinicaoDeFabrica)[]).filter(
    (c) => Object.hasOwn(COLUNA, c) && antes[c] !== undefined,
  );
  if (campos.length === 0) throw new Error("diga quais campos do agente de fábrica mudam");
  return campos
    .map((campo) => {
      const coluna = COLUNA[campo];
      const novo = emColuna(DE_FABRICA[id][campo]);
      const antigo = emColuna(antes[campo]!);
      if (antigo === novo) throw new Error(`${campo} já é esse no de fábrica de agora`);
      const igual =
        typeof antes[campo] === "string"
          ? `${coluna} = ${literal(antigo)}`
          : `json(${coluna}) = json(${literal(antigo)})`;
      return `UPDATE agentes SET ${coluna} = ${literal(novo)} WHERE id = ${literal(id)} AND de_fabrica = 1 AND ${igual};`;
    })
    .join("\n");
}
