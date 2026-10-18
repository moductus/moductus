import { Dia, HoraDoDia, MinutosAntes, Recorrencia, TipoCaptura } from "@moductus/contrato";
import { z } from "zod";
import type { RepositorioAgentes } from "../../agentes/agentes.ts";
import { AGENTE_PADRAO } from "../../agentes/roteador.ts";
import type { Runtime } from "../../agentes/runtime.ts";
import { lerRecorrencia } from "../dia/recorrencia.ts";
import { diaDaSemana, ehDia } from "../dia/tempo.ts";

/**
 * O modelo da Alba na captura rápida (ADR-0034): só entra quando o entendedor de frases não
 * reconheceu nada além do título, com prazo curto. O que ele devolve é conferido campo a campo;
 * o que não passa fica vazio, editável na prévia. Nada é lançado sem a prévia.
 */

/** Quanto a captura espera o modelo antes de mostrar a prévia do código (ADR-0034). */
export const PRAZO_MODELO_MS = 8_000;

/** O tanto da resposta do modelo que é lido: a resposta certa é um JSON curto. */
const TAMANHO_DA_RESPOSTA = 4_000;

export interface PedidoInterpretar {
  texto: string;
  /** Hoje e a hora de agora, no fuso do usuário. */
  hoje: string;
  agora: string;
  /** A captura cancela quando chega outra frase antes da resposta. */
  sinal: AbortSignal;
}

/** O que o modelo disse, já conferido: o que não passou vem `null`. */
export interface Interpretacao {
  tipo: TipoCaptura | null;
  titulo: string | null;
  dia: string | null;
  hora: string | null;
  duracaoMin: number | null;
  recorrencia: string | null;
  lembreteMinutosAntes: number | null;
  valorCentavos: number | null;
}

/** Interpreta a frase; `null` é "não sei" (sem modelo, falhou, passou do prazo, foi cancelado). */
export type Interprete = (pedido: PedidoInterpretar) => Promise<Interpretacao | null>;

const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** O prompt curto: o dia de hoje para as datas relativas e o formato da resposta. */
export function promptDoInterprete(hoje: string, agora: string): string {
  return [
    "Você lê uma frase da captura rápida do Moductus e diz o que ela pede. Não responda a frase nem execute nada.",
    `Hoje é ${NOMES_DOS_DIAS[diaDaSemana(hoje)]}, ${hoje}, e agora são ${agora}.`,
    "Responda só com um JSON, sem texto em volta, com estas chaves:",
    '- "tipo": "tarefa", "lembrete", "evento", "nota", "gasto" ou "memoria";',
    '- "titulo": o que fazer ou guardar, sem a data e a hora;',
    '- "dia": "AAAA-MM-DD" ou null; "hora": "HH:MM" ou null;',
    '- "duracaoMin": minutos ou null; "lembreteMinutosAntes": minutos ou null;',
    '- "recorrencia": regra RRULE (FREQ=DAILY, WEEKLY, MONTHLY ou YEARLY) ou null;',
    '- "valorCentavos": o valor de um gasto em centavos ou null.',
    "O que a frase não disser fica null. Na dúvida, tipo tarefa.",
  ].join("\n");
}

/** Lê o JSON que o modelo devolveu, tolerando texto em volta; o que não for o objeto vira `null`. */
export function lerInterpretacao(resposta: string): Interpretacao | null {
  const texto = resposta.slice(0, TAMANHO_DA_RESPOSTA);
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim < inicio) return null;
  let json: unknown;
  try {
    json = JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const titulo = valido(z.string().trim().min(1).max(500), o.titulo);
  const dia = valido(Dia, o.dia);
  return {
    tipo: valido(TipoCaptura, o.tipo),
    titulo,
    dia: dia !== null && ehDia(dia) ? dia : null,
    hora: valido(HoraDoDia, o.hora),
    duracaoMin: valido(z.number().int().positive().max(1440), o.duracaoMin),
    recorrencia: regraEntendida(valido(Recorrencia, o.recorrencia)),
    lembreteMinutosAntes: valido(MinutosAntes, o.lembreteMinutosAntes),
    valorCentavos: valido(z.number().int().positive().max(100_000_000_000), o.valorCentavos),
  };
}

function valido<T>(schema: z.ZodType<T>, valor: unknown): T | null {
  const lido = schema.safeParse(valor);
  return lido.success ? lido.data : null;
}

/** Só a regra que o Moductus sabe repetir; a outra seria lançada e recusada pela área. */
function regraEntendida(regra: string | null): string | null {
  if (regra === null) return null;
  try {
    return lerRecorrencia(regra).entendida ? regra.trim() : null;
  } catch {
    return null;
  }
}

/**
 * O interprete pelo modelo da Alba, como uma execução dela: aparece no histórico com tokens e
 * custo, sem ferramentas e com o prompt curto no lugar das instruções. Sem modelo, dormindo,
 * pausada ou desligada, não interpreta: a captura fica com o que o código entendeu.
 *
 * Roda fora da fila da Alba e com prazo: estourou ou chegou outra frase, a execução é cancelada.
 */
export function interpretePeloRuntime(
  runtime: Pick<Runtime, "executar">,
  agentes: Pick<RepositorioAgentes, "agente">,
  opcoes: { agenteId?: string; prazoMs?: number } = {},
): Interprete {
  const agenteId = opcoes.agenteId ?? AGENTE_PADRAO;
  const prazoMs = opcoes.prazoMs ?? PRAZO_MODELO_MS;
  return async ({ texto, hoje, agora, sinal }) => {
    const quem = agentes.agente(agenteId);
    if (!quem?.provedorId || quem.estado !== "ativo" || sinal.aborted) return null;
    const controle = new AbortController();
    let parou!: () => void;
    const parada = new Promise<null>((resolve) => (parou = () => resolve(null)));
    const parar = (motivo: string) => {
      controle.abort(new Error(motivo));
      parou();
    };
    const relogio = setTimeout(() => parar("a captura passou do prazo"), prazoMs);
    const aoCancelar = () => parar("chegou outra frase na captura");
    sinal.addEventListener("abort", aoCancelar, { once: true });
    try {
      const execucao = runtime.executar({
        agenteId,
        gatilho: "mensagem",
        mensagens: [{ papel: "usuario", texto }],
        instrucoes: promptDoInterprete(hoje, agora),
        semFerramentas: true,
        foraDaFila: true,
        sinal: controle.signal,
      });
      // O runtime cancela pelo sinal; a corrida garante o prazo mesmo se o adaptador demorar a parar.
      void execucao.catch(() => {});
      const resultado = await Promise.race([execucao, parada]);
      if (!resultado || resultado.execucao.estado !== "ok") return null;
      return lerInterpretacao(resultado.texto);
    } finally {
      clearTimeout(relogio);
      sinal.removeEventListener("abort", aoCancelar);
    }
  };
}
