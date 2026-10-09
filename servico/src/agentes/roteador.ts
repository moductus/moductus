import { z } from "zod";
import type { AgenteGuardado, RepositorioAgentes } from "./agentes.ts";
import type { Runtime } from "./runtime.ts";

/**
 * O roteamento da conversa com o time (AGENTS.md §1 "Conversas", §2 "Roteamento"), nesta ordem:
 *
 * 1. menção explícita (`@tula`) escolhe o agente;
 * 2. sem menção, regras simples, trecho a trecho: valor em reais vai para a Tula, link de PR para o
 *    Nuno, arquivo ou pasta para a Faina;
 * 3. sobrou trecho que nenhuma regra pegou, o classificador barato (o modelo da Alba, prompt curto)
 *    decide; o que ele não der a ninguém vai à Alba, que é o padrão (a não ser que um agente só
 *    responda a mensagem inteira).
 *
 * Pedido com partes de áreas diferentes é dividido: cada agente recebe a parte que é dele, e todos
 * respondem na mesma conversa.
 */

/** Mensagem sem destinatário claro vai para a Alba (AGENTS.md §2). */
export const AGENTE_PADRAO = "alba";

/** Quem responde e, quando o pedido foi dividido, a parte que cabe a ele. */
export interface Destino {
  agenteId: string;
  /** `null`: a mensagem inteira é dele. */
  parte: string | null;
}

/** O que o roteamento precisa saber de cada agente que pode responder. */
export type AgenteRoteavel = Pick<AgenteGuardado, "id" | "nome" | "funcao" | "instrucoes">;

export interface PedidoClassificar {
  texto: string;
  agentes: readonly AgenteRoteavel[];
  /** Quem respondeu por último na conversa: uma pergunta de seguimento costuma ser dele. */
  ultimoAResponder: string | null;
}

/**
 * Decide quem responde o que as regras não pegaram. Devolve os agentes como o modelo os nomeou;
 * o roteador descarta quem não existe. Lista vazia é "não sei": vai ao padrão.
 */
export type Classificador = (pedido: PedidoClassificar) => Promise<Destino[]>;

/** Sem acento e em minúsculas, para `@Fáina` e `@faina` serem a mesma menção. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Como chamar o agente no chat (AGENTS.md §1): `@` e o nome, sem acento nem espaço. O id também
 * vale, para o agente renomeado continuar atendendo pelo nome de fábrica.
 */
export function apelidoDe(agente: Pick<AgenteRoteavel, "nome">): string {
  return `@${normalizar(agente.nome).replace(/\s+/g, "")}`;
}

/** O agente pelo id ou pelo apelido, sem `@`; `null` se nenhum. */
export function procurar<A extends AgenteRoteavel>(nome: string, agentes: readonly A[]): A | null {
  const chave = normalizar(nome.trim()).replace(/^@/, "").replace(/\s+/g, "");
  return agentes.find((a) => a.id === chave || apelidoDe(a) === `@${chave}`) ?? null;
}

/** `@` depois de letra, número ou ponto é e-mail ou endereço, não menção. */
const MENCAO = /(?<![\p{L}\p{N}_.@])@([\p{L}\p{N}_-]+)/gu;

/** Os agentes mencionados, na ordem em que aparecem, sem repetir. Menção a quem não existe é ignorada. */
export function mencoes(texto: string, agentes: readonly AgenteRoteavel[]): string[] {
  const ids: string[] = [];
  for (const [, nome] of texto.matchAll(MENCAO)) {
    const agente = procurar(nome!, agentes);
    if (agente && !ids.includes(agente.id)) ids.push(agente.id);
  }
  return ids;
}

/** Fronteira de palavra que entende acento (o `\b` do JavaScript não entende). */
const palavra = (alternativas: string) => `(?<![\\p{L}\\p{N}_])(?:${alternativas})(?![\\p{L}\\p{N}_])`;

/** Extensões de arquivo que a Faina reconhece num nome solto (`extrato.ofx`, `setup.exe`). */
const EXTENSOES =
  "pdf|docx?|xlsx?|pptx?|odt|ods|csv|ofx|xml|txt|md|zip|rar|7z|exe|msi|png|jpe?g|gif|webp|heic|mp3|wav|mp4|mov|mkv";

/** As regras simples do AGENTS.md §2, na ordem do time. Valem por trecho, não pela mensagem inteira. */
export const REGRAS: readonly { agenteId: string; padrao: RegExp }[] = [
  // Valor em reais: "R$ 45", "R$45,90", "45 reais", "1.200,00 reais".
  {
    agenteId: "tula",
    padrao: new RegExp(`R\\$\\s*\\d|${palavra("\\d+(?:[.,]\\d+)*\\s*(?:reais|real)")}`, "iu"),
  },
  // Arquivo ou pasta: caminho do Windows, `~/`, nome com extensão, Downloads e Área de Trabalho, ou
  // as próprias palavras.
  {
    agenteId: "faina",
    padrao: new RegExp(
      [
        "(?<![\\p{L}\\p{N}_])[a-z]:\\\\",
        "(?<!\\S)~[\\\\/]",
        `[\\p{L}\\p{N}_-]+\\.(?:${EXTENSOES})(?![\\p{L}\\p{N}_])`,
        palavra("downloads|area de trabalho|arquivos?|pastas?"),
      ].join("|"),
      "iu",
    ),
  },
  // Link de PR do GitHub.
  { agenteId: "nuno", padrao: /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i },
];

/** Os agentes que as regras escolhem para um trecho, só entre os que podem responder. */
export function porRegra(trecho: string, agentes: readonly AgenteRoteavel[]): string[] {
  // Sem acento: rea de trabalho e Área de Trabalho são a mesma pasta.
  const normal = normalizar(trecho);
  return REGRAS.filter((r) => r.padrao.test(normal) && agentes.some((a) => a.id === r.agenteId)).map(
    (r) => r.agenteId,
  );
}

/** Frases e linhas: a unidade que as regras olham. Ponto dentro de número ou link não corta. */
export function dividirEmTrechos(texto: string): string[] {
  return texto
    .split(/(?<=[.?!;])\s+|\n+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

export class Roteador {
  constructor(private readonly classificar: Classificador | null = null) {}

  /**
   * Quem responde a mensagem, na ordem em que as partes aparecem. Com um destino só, a mensagem
   * inteira é dele (`parte` vazia). Lança só sem nenhum agente para responder.
   */
  async rotear(
    texto: string,
    agentes: readonly AgenteRoteavel[],
    ultimoAResponder: string | null = null,
  ): Promise<Destino[]> {
    if (agentes.length === 0) throw new Error("nenhum agente ligado para responder");

    const mencionados = mencoes(texto, agentes);
    if (mencionados.length > 0) return mencionados.map((agenteId) => ({ agenteId, parte: null }));

    const partes = new Map<string, string[]>();
    const juntar = (agenteId: string, trecho: string) => {
      const dele = partes.get(agenteId) ?? [];
      if (!dele.includes(trecho)) dele.push(trecho);
      partes.set(agenteId, dele);
    };
    const resto: string[] = [];
    for (const trecho of dividirEmTrechos(texto)) {
      const ids = porRegra(trecho, agentes);
      if (ids.length === 0) resto.push(trecho);
      for (const id of ids) juntar(id, trecho);
    }
    if (resto.length > 0) {
      // O classificador vê a mensagem inteira, para entender o trecho solto pelo contexto ("Foi no
      // débito" depois de um valor é da Tula). O que a regra já deu a alguém fica como a regra deu.
      const sobra = resto.join(" ");
      const classificados = await this.classificados(texto, agentes, ultimoAResponder);
      const novos = classificados.filter((d) => !partes.has(d.agenteId));
      const daRegra = classificados.filter((d) => partes.has(d.agenteId));
      if (novos.length > 0) for (const d of novos) juntar(d.agenteId, d.parte ?? sobra);
      else if (daRegra.length > 0) for (const d of daRegra) juntar(d.agenteId, sobra);
      // Ninguém ficou com a sobra. Sem destino nenhum, ou com a mensagem dividida entre dois ou mais,
      // ela vai à Alba, que é o padrão: ninguém ouve "o resto fica com" quem não vai responder. Com
      // um destino só, ele recebe a mensagem inteira e basta.
      else if (partes.size !== 1) {
        const padrao = agentes.find((a) => a.id === AGENTE_PADRAO) ?? agentes[0]!;
        juntar(padrao.id, partes.size === 0 ? texto : sobra);
      }
    }

    const destinos = [...partes].map(([agenteId, trechos]) => ({ agenteId, parte: trechos.join(" ") }));
    return destinos.length === 1 ? [{ agenteId: destinos[0]!.agenteId, parte: null }] : destinos;
  }

  /** O que o classificador decidiu, só com quem existe; sem classificador, falhando ou sem saber, nada. */
  private async classificados(
    texto: string,
    agentes: readonly AgenteRoteavel[],
    ultimoAResponder: string | null,
  ): Promise<Destino[]> {
    if (!this.classificar) return [];
    const destinos: Destino[] = [];
    try {
      for (const destino of await this.classificar({ texto, agentes, ultimoAResponder })) {
        const agente = procurar(destino.agenteId, agentes);
        if (agente && !destinos.some((d) => d.agenteId === agente.id)) {
          destinos.push({ agenteId: agente.id, parte: destino.parte?.trim() || null });
        }
      }
    } catch (erro) {
      console.error(`classificador do roteamento falhou: ${String(erro)}`);
      return [];
    }
    return destinos;
  }
}

/** Primeira frase das instruções, curta: o bastante para o classificador saber do que o agente cuida. */
function primeiraFrase(texto: string): string {
  const frase = texto.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return frase.length > 200 ? `${frase.slice(0, 199).trimEnd()}…` : frase;
}

/** O prompt curto do classificador: quem é cada agente e o formato da resposta. */
export function promptDoClassificador(
  agentes: readonly AgenteRoteavel[],
  ultimoAResponder: string | null,
): string {
  const linhas = [
    "Você distribui as mensagens do usuário entre os agentes do Moductus. Não responda a mensagem.",
    "Agentes:",
    ...agentes.map((a) => `- ${a.id}: ${a.nome}, ${a.funcao.toLowerCase()}. ${primeiraFrase(a.instrucoes)}`),
  ];
  if (ultimoAResponder) linhas.push(`A última resposta da conversa foi de ${ultimoAResponder}.`);
  linhas.push(
    'Responda só com um JSON, sem texto em volta: uma lista de {"agente": id, "parte": o trecho da mensagem que cabe a ele}, na ordem da mensagem.',
    `Divida só quando a mensagem tiver pedidos de áreas diferentes. Na dúvida, "${AGENTE_PADRAO}".`,
  );
  return linhas.join("\n");
}

const Classificacao = z.array(z.object({ agente: z.string(), parte: z.string().nullish() }));

/** Lê a lista que o modelo devolveu, tolerando texto em volta; o que não for a lista vira "não sei". */
export function lerClassificacao(texto: string): Destino[] {
  const inicio = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (inicio < 0 || fim < inicio) return [];
  let json: unknown;
  try {
    json = JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return [];
  }
  const lida = Classificacao.safeParse(json);
  if (!lida.success) return [];
  return lida.data.map((d) => ({ agenteId: d.agente, parte: d.parte ?? null }));
}

/** Quanto o roteamento espera o classificador antes de mandar a mensagem à Alba. */
export const PRAZO_CLASSIFICADOR_MS = 20_000;

/**
 * O classificador pelo modelo do agente padrão, como uma execução dele: aparece no histórico com
 * tokens e custo, sem ferramentas e com o prompt curto no lugar das instruções. Agente sem modelo
 * ou desligado não classifica: a mensagem vai ao padrão sem uma execução a mais.
 *
 * Roda fora da fila da Alba, para não esperar uma resposta longa dela nem atrasar a próxima, e com
 * prazo curto: estourou, a execução é cancelada e a mensagem vai ao padrão.
 */
export function classificadorPeloRuntime(
  runtime: Pick<Runtime, "executar">,
  agentes: Pick<RepositorioAgentes, "agente">,
  opcoes: { agenteId?: string; prazoMs?: number } = {},
): Classificador {
  const agenteId = opcoes.agenteId ?? AGENTE_PADRAO;
  const prazoMs = opcoes.prazoMs ?? PRAZO_CLASSIFICADOR_MS;
  return async ({ texto, agentes: roteaveis, ultimoAResponder }) => {
    const quem = agentes.agente(agenteId);
    if (!quem?.provedorId || quem.estado === "desligado") return [];
    const controle = new AbortController();
    let estourou!: () => void;
    const prazo = new Promise<null>((resolve) => (estourou = () => resolve(null)));
    const relogio = setTimeout(() => {
      controle.abort(new Error("o classificador passou do prazo"));
      estourou();
    }, prazoMs);
    try {
      const execucao = runtime.executar({
        agenteId,
        gatilho: "mensagem",
        mensagens: [{ papel: "usuario", texto }],
        instrucoes: promptDoClassificador(roteaveis, ultimoAResponder),
        semFerramentas: true,
        foraDaFila: true,
        sinal: controle.signal,
      });
      // O runtime cancela pelo sinal; a corrida garante o prazo mesmo se o adaptador demorar a parar.
      void execucao.catch(() => {});
      const resultado = await Promise.race([execucao, prazo]);
      if (!resultado || resultado.execucao.estado !== "ok") return [];
      return lerClassificacao(resultado.texto);
    } finally {
      clearTimeout(relogio);
    }
  };
}
