import type { Gatilho } from "@moductus/contrato";
import type { RepositorioAgentes } from "../agentes/agentes.ts";
import type { ResultadoExecucao, Runtime } from "../agentes/runtime.ts";

/**
 * O agendador (AGENTS.md §6 "Agendador e execuções"): faz o agente trabalhar sozinho, num horário
 * (`08:30`), a cada intervalo (15 min) ou quando um evento interno acontece (`arquivo.chegou`).
 * Cada disparo é um pedido ao runtime, que registra a execução com o tipo do gatilho.
 *
 * O relógio é conferido de tempos em tempos e na retomada da suspensão, que a casca avisa
 * (`WM_POWERBROADCAST`). Cada conferência dispara o que venceu desde a anterior **uma vez só**, por
 * mais que tenha passado: o PC que dormiu a noite inteira acorda com um disparo do 08:30, não com
 * um por dia nem com 40 do intervalo de 15 min. O que já está esperando a vez ou rodando não
 * dispara de novo por cima; dispara quando terminar, se ainda for a hora.
 *
 * A referência de cada gatilho fica na memória: o serviço que sobe começa a contar dali e não
 * dispara de novo o que já passou antes dele.
 */

/** De quanto em quanto o relógio é conferido. Um horário dispara com no máximo isso de atraso. */
export const INTERVALO_AGENDADOR_MS = 30_000;

/** Atraso a partir do qual o disparo avisa o agente que saiu fora da hora (suspensão, serviço parado). */
export const TOLERANCIA_ATRASO_MS = 2 * 60_000;

export interface DependenciasAgendador {
  agentes: Pick<RepositorioAgentes, "agentes">;
  runtime: Pick<Runtime, "executar">;
}

export interface OpcoesAgendador {
  agora?: () => Date;
}

export interface Disparo {
  agenteId: string;
  gatilho: Gatilho;
  /** Quando o gatilho venceu; num evento, quando ele aconteceu. */
  previsto: string;
  /** Venceu há mais que a tolerância: o PC estava suspenso ou o serviço parado. */
  atrasado: boolean;
  /** Termina com a execução registrada; `null` se o runtime recusou o pedido (agente sumiu). */
  resultado: Promise<ResultadoExecucao | null>;
}

/** Como o gatilho aparece para o agente e no log: `horário 08:30`, `a cada 15 min`, `evento x.y`. */
export function descreverGatilho(gatilho: Gatilho): string {
  switch (gatilho.tipo) {
    case "horario":
      return `horário ${gatilho.hora}`;
    case "intervalo":
      return `a cada ${gatilho.minutos} min`;
    case "evento":
      return `evento ${gatilho.nome}`;
  }
}

/** A última vez, até `agora` inclusive, em que o relógio local marcou `HH:MM`. */
export function ultimaOcorrencia(hora: string, agora: Date): Date {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  const ocorrencia = new Date(agora);
  ocorrencia.setHours(h, m, 0, 0);
  if (ocorrencia.getTime() > agora.getTime()) ocorrencia.setDate(ocorrencia.getDate() - 1);
  return ocorrencia;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** `09/10 08:30`, no relógio local, para o agente saber de quando era o disparo. */
function dataHora(instante: Date): string {
  return `${dois(instante.getDate())}/${dois(instante.getMonth() + 1)} ${dois(instante.getHours())}:${dois(instante.getMinutes())}`;
}

/** O pedido que chega ao agente: qual gatilho, de quando, e o detalhe do evento se houver. */
export function mensagemDoDisparo(
  gatilho: Gatilho,
  previsto: Date,
  agora: Date,
  atrasado: boolean,
  detalhe?: string,
): string {
  const quando = atrasado
    ? `Venceu em ${dataHora(previsto)} e só disparou agora, ${dataHora(agora)}, porque o PC estava suspenso ou o Moductus parado.`
    : `Disparado em ${dataHora(agora)}.`;
  const texto = `Gatilho: ${descreverGatilho(gatilho)}. ${quando}`;
  return detalhe ? `${texto}\n\n${detalhe}` : texto;
}

/** Uma chave por agente e gatilho: mudar o gatilho na configuração começa uma contagem nova. */
const chaveDe = (agenteId: string, gatilho: Gatilho) => `${agenteId}|${JSON.stringify(gatilho)}`;

export class Agendador {
  private readonly agora: () => Date;
  /**
   * Por gatilho de horário ou intervalo, o instante de referência: a última conferência em que
   * ele disparou ou em que apareceu pela primeira vez.
   */
  private readonly referencias = new Map<string, number>();
  /** Disparos de horário ou intervalo esperando a vez ou rodando. */
  private readonly pendentes = new Set<string>();

  constructor(
    private readonly deps: DependenciasAgendador,
    opcoes: OpcoesAgendador = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /**
   * Confere o relógio e dispara cada gatilho de horário ou intervalo que venceu desde a última
   * conferência, uma vez só. Conferir de novo sem o relógio andar não dispara nada.
   */
  verificar(): Disparo[] {
    const agora = this.agora();
    const vistos = new Set<string>();
    const disparos: Disparo[] = [];
    for (const agente of this.agentesQueTrabalham()) {
      for (const gatilho of agente.gatilhos) {
        if (gatilho.tipo === "evento") continue;
        const chave = chaveDe(agente.id, gatilho);
        vistos.add(chave);
        const previsto = this.vencido(chave, gatilho, agora);
        if (!previsto || this.pendentes.has(chave)) continue;
        this.referencias.set(chave, agora.getTime());
        disparos.push(this.disparar(agente.id, gatilho, previsto, agora, chave));
      }
    }
    // Gatilho que saiu da configuração (ou agente desligado) recomeça do zero se voltar.
    for (const chave of this.referencias.keys()) if (!vistos.has(chave)) this.referencias.delete(chave);
    return disparos;
  }

  /**
   * O PC voltou da suspensão (a casca avisa): confere na hora, sem esperar a próxima volta do
   * relógio. O que venceu enquanto o PC dormia dispara uma vez só, marcado como atrasado.
   */
  retomar(): Disparo[] {
    const disparos = this.verificar();
    console.error(`agendador: voltou da suspensão, ${disparos.length} gatilho(s) disparado(s)`);
    return disparos;
  }

  /**
   * Um evento interno aconteceu: dispara cada agente que tem esse gatilho. Eventos não se juntam,
   * porque cada um traz o seu detalhe; a fila do agente os roda em ordem.
   */
  emitir(nome: string, detalhe?: string): Disparo[] {
    const agora = this.agora();
    const disparos: Disparo[] = [];
    for (const agente of this.agentesQueTrabalham()) {
      for (const gatilho of agente.gatilhos) {
        if (gatilho.tipo !== "evento" || gatilho.nome !== nome) continue;
        disparos.push(this.disparar(agente.id, gatilho, agora, agora, null, detalhe));
      }
    }
    return disparos;
  }

  /**
   * Confere agora e a cada {@link INTERVALO_AGENDADOR_MS}. Não segura o processo aberto; devolve
   * como parar.
   */
  vigiar(intervaloMs = INTERVALO_AGENDADOR_MS): () => void {
    this.verificar();
    const relogio = setInterval(() => this.verificar(), intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  /** Desligado não trabalha sozinho. Pausado e dormindo pedem ao runtime, que decide a vez. */
  private agentesQueTrabalham() {
    return this.deps.agentes.agentes().filter((agente) => agente.estado !== "desligado");
  }

  /** Quando o gatilho venceu, se venceu desde a referência; `null` se ainda não é a hora. */
  private vencido(chave: string, gatilho: Gatilho, agora: Date): Date | null {
    const referencia = this.referencias.get(chave);
    // Primeira vez que aparece, ou o relógio do PC voltou para trás: começa a contar de agora.
    if (referencia === undefined || referencia > agora.getTime()) {
      this.referencias.set(chave, agora.getTime());
      return null;
    }
    if (gatilho.tipo === "horario") {
      const ocorrencia = ultimaOcorrencia(gatilho.hora, agora);
      return ocorrencia.getTime() > referencia ? ocorrencia : null;
    }
    if (gatilho.tipo === "intervalo") {
      const proxima = referencia + gatilho.minutos * 60_000;
      return agora.getTime() >= proxima ? new Date(proxima) : null;
    }
    return null;
  }

  private disparar(
    agenteId: string,
    gatilho: Gatilho,
    previsto: Date,
    agora: Date,
    chave: string | null,
    detalhe?: string,
  ): Disparo {
    const atrasado = agora.getTime() - previsto.getTime() > TOLERANCIA_ATRASO_MS;
    if (chave) this.pendentes.add(chave);
    const resultado = this.deps.runtime
      .executar({
        agenteId,
        gatilho: gatilho.tipo,
        mensagens: [
          { papel: "usuario", texto: mensagemDoDisparo(gatilho, previsto, agora, atrasado, detalhe) },
        ],
      })
      .catch((erro: unknown) => {
        console.error(`agendador: ${descreverGatilho(gatilho)} de ${agenteId} não rodou: ${String(erro)}`);
        return null;
      })
      .finally(() => {
        if (chave) this.pendentes.delete(chave);
      });
    return { agenteId, gatilho, previsto: previsto.toISOString(), atrasado, resultado };
  }
}
