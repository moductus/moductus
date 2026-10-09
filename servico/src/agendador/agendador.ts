import type { DatabaseSync } from "node:sqlite";
import type { Gatilho } from "@moductus/contrato";
import type { RepositorioAgentes } from "../agentes/agentes.ts";
import type { ResultadoExecucao, Runtime } from "../agentes/runtime.ts";
import { novoId } from "../banco/ulid.ts";

/**
 * O agendador (AGENTS.md §6 "Agendador e execuções"): faz o agente trabalhar sozinho, num horário
 * (`08:30`), a cada intervalo (15 min) ou quando um evento interno acontece (`arquivo.chegou`).
 * Cada disparo é um pedido ao runtime, que registra a execução com o tipo do gatilho.
 *
 * O relógio é conferido a cada {@link INTERVALO_AGENDADOR_MS}. Cada conferência dispara o que
 * venceu desde a anterior **uma vez só**, por mais que tenha passado: o PC que dormiu a noite
 * inteira acorda com um disparo do 08:30 de hoje, não com um por dia nem com dezenas do intervalo.
 * O que já está esperando a vez ou rodando não dispara de novo por cima; dispara quando terminar.
 *
 * Até onde cada gatilho foi contado fica no banco (`agendador_disparos`), gravado antes de chamar o
 * runtime: o serviço que reinicia não repete um disparo e dispara, uma vez, o que venceu com ele
 * parado. Só o gatilho que o agendador nunca viu começa a contar de agora.
 *
 * Na volta da suspensão (a casca avisa, ou a conferência percebe que ficou sem rodar), o agendador
 * espera {@link PRAZO_RETOMADA_MS} para a rede voltar antes de disparar o que venceu.
 */

/** De quanto em quanto o relógio é conferido. Um horário dispara com no máximo isso de atraso. */
export const INTERVALO_AGENDADOR_MS = 30_000;

/**
 * Sem conferir por mais que isso, o agendador ficou parado (PC suspenso, serviço fora): o que
 * venceu nesse meio dispara marcado como atrasado.
 */
export const TOLERANCIA_ATRASO_MS = 2 * 60_000;

/** Espera depois da suspensão, para a rede e o provedor voltarem antes dos disparos atrasados. */
export const PRAZO_RETOMADA_MS = 20_000;

/** Até onde um gatilho de horário ou intervalo foi contado (migração 009). */
export interface ReferenciaGuardada {
  /** Horário: a ocorrência que disparou, ou quando o gatilho apareceu. Intervalo: de onde conta. */
  referencia: string;
  disparadoEm: string | null;
}

interface LinhaDisparo {
  do_agente_id: string;
  gatilho: string;
  referencia: string;
  disparado_em: string | null;
}

/** Uma chave por agente e gatilho: mudar o gatilho na configuração começa uma contagem nova. */
const chaveDe = (agenteId: string, gatilho: string) => `${agenteId}|${gatilho}`;

export class RepositorioDisparos {
  constructor(private readonly db: DatabaseSync) {}

  /** Todas as referências guardadas, pela chave de agente e gatilho. */
  todas(): Map<string, ReferenciaGuardada> {
    const linhas = this.db
      .prepare("SELECT do_agente_id, gatilho, referencia, disparado_em FROM agendador_disparos")
      .all() as unknown as LinhaDisparo[];
    return new Map(
      linhas.map((l) => [
        chaveDe(l.do_agente_id, l.gatilho),
        { referencia: l.referencia, disparadoEm: l.disparado_em },
      ]),
    );
  }

  gravar(agenteId: string, gatilho: string, guardada: ReferenciaGuardada, agora: string): void {
    this.db
      .prepare(
        `INSERT INTO agendador_disparos
           (id, do_agente_id, gatilho, referencia, disparado_em, criado_em, atualizado_em, origem, agente_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'agente', ?)
         ON CONFLICT (do_agente_id, gatilho) DO UPDATE SET
           referencia = excluded.referencia,
           disparado_em = excluded.disparado_em,
           atualizado_em = excluded.atualizado_em`,
      )
      .run(novoId(), agenteId, gatilho, guardada.referencia, guardada.disparadoEm, agora, agora, agenteId);
  }

  /** Esquece as referências que não estão na lista (gatilho que saiu, agente desligado). */
  manterSo(chaves: ReadonlySet<string>): void {
    const linhas = this.db
      .prepare("SELECT id, do_agente_id, gatilho FROM agendador_disparos")
      .all() as unknown as Array<{ id: string; do_agente_id: string; gatilho: string }>;
    const apagar = this.db.prepare("DELETE FROM agendador_disparos WHERE id = ?");
    for (const l of linhas) if (!chaves.has(chaveDe(l.do_agente_id, l.gatilho))) apagar.run(l.id);
  }
}

export interface DependenciasAgendador {
  agentes: Pick<RepositorioAgentes, "agentes">;
  disparos: RepositorioDisparos;
  runtime: Pick<Runtime, "executar">;
}

export interface OpcoesAgendador {
  agora?: () => Date;
  /** Roda `fazer` daqui a `ms`; o teste troca pelo relógio falso. */
  programar?: (fazer: () => void, ms: number) => void;
}

/** O que as áreas recebem para avisar um evento interno (`arquivo.chegou`, `sessao.pediu_aprovacao`). */
export type EmitirEvento = (nome: string, detalhe?: string) => void;

export interface Disparo {
  agenteId: string;
  gatilho: Gatilho;
  /** Quando o gatilho venceu; num evento, quando o (primeiro) evento aconteceu. */
  previsto: string;
  /** Venceu enquanto o agendador estava sem conferir: o PC estava suspenso ou o serviço parado. */
  atrasado: boolean;
  /** Venceu na hora, mas esperou o disparo anterior do mesmo gatilho terminar. */
  esperou: boolean;
  /** Evento que entrou num disparo que já esperava a vez, em vez de virar outro. */
  juntado: boolean;
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

/** Quando o relógio local marca `HH:MM` no dia de `agora` (pode ser depois de `agora`). */
export function ocorrenciaDeHoje(hora: string, agora: Date): Date {
  const [h, m] = hora.split(":").map(Number) as [number, number];
  const ocorrencia = new Date(agora);
  ocorrencia.setHours(h, m, 0, 0);
  return ocorrencia;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** `09/10 08:30`, no relógio local, para o agente saber de quando era o disparo. */
function dataHora(instante: Date): string {
  return `${dois(instante.getDate())}/${dois(instante.getMonth() + 1)} ${dois(instante.getHours())}:${dois(instante.getMinutes())}`;
}

export interface Momento {
  previsto: Date;
  agora: Date;
  atrasado: boolean;
  esperou: boolean;
  /** Quantos eventos entraram neste disparo. */
  vezes?: number;
  detalhes?: readonly string[];
}

/** O pedido que chega ao agente: qual gatilho, de quando, e os detalhes dos eventos se houver. */
export function mensagemDoDisparo(gatilho: Gatilho, m: Momento): string {
  const vezes = m.vezes ?? 1;
  const qual =
    vezes > 1
      ? `${descreverGatilho(gatilho)}, ${vezes} vezes desde ${dataHora(m.previsto)}`
      : descreverGatilho(gatilho);
  const quando = m.atrasado
    ? `Venceu em ${dataHora(m.previsto)} e só disparou agora, ${dataHora(m.agora)}, porque o PC estava suspenso ou o Moductus parado.`
    : m.esperou && vezes === 1
      ? `Venceu em ${dataHora(m.previsto)} e disparou agora, ${dataHora(m.agora)}, quando o trabalho anterior deste gatilho terminou.`
      : `Disparado em ${dataHora(m.agora)}.`;
  return [`Gatilho: ${qual}. ${quando}`, ...(m.detalhes ?? [])].join("\n\n");
}

/** Eventos de um agente e nome que esperam o disparo anterior terminar: viram um disparo só. */
interface EventosEsperando {
  gatilho: Gatilho;
  desde: Date;
  vezes: number;
  detalhes: string[];
  resultado: Promise<ResultadoExecucao | null>;
  entregar: (resultado: Promise<ResultadoExecucao | null>) => void;
}

export class Agendador {
  private readonly agora: () => Date;
  private readonly programar: (fazer: () => void, ms: number) => void;
  /** A última conferência que rodou; `null` antes da primeira (o serviço acabou de subir). */
  private ultimaConferencia: number | null = null;
  /** Depois da suspensão, nenhuma conferência roda antes disto. */
  private adiadaAte: number | null = null;
  private retomada: Promise<Disparo[]> | null = null;
  /** Disparos de horário ou intervalo esperando a vez ou rodando, pela chave. */
  private readonly pendentes = new Set<string>();
  /** Por agente e evento: há disparo em curso, e os eventos que chegaram depois esperam juntos. */
  private readonly eventos = new Map<string, { esperando: EventosEsperando | null }>();

  constructor(
    private readonly deps: DependenciasAgendador,
    opcoes: OpcoesAgendador = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.programar =
      opcoes.programar ??
      ((fazer, ms) => {
        setTimeout(fazer, ms).unref();
      });
  }

  /**
   * Confere o relógio e dispara cada gatilho de horário ou intervalo que venceu desde a última
   * conferência, uma vez só. Se percebe que ficou sem conferir (o PC dormiu), adia a conferência
   * por {@link PRAZO_RETOMADA_MS}, como na retomada avisada pela casca.
   */
  verificar(): Disparo[] {
    const agora = this.agora().getTime();
    if (this.adiadaAte !== null) {
      if (agora < this.adiadaAte) return [];
    } else if (this.ultimaConferencia !== null && agora - this.ultimaConferencia > TOLERANCIA_ATRASO_MS) {
      this.adiadaAte = agora + PRAZO_RETOMADA_MS;
      return [];
    }
    return this.conferir();
  }

  /**
   * O PC voltou da suspensão (a casca avisa): espera {@link PRAZO_RETOMADA_MS} para a rede voltar
   * e confere. O que venceu enquanto o PC dormia dispara uma vez só, marcado como atrasado. Aviso
   * repetido no prazo não confere de novo.
   */
  retomar(): Promise<Disparo[]> {
    if (this.retomada) return this.retomada;
    this.adiadaAte = this.agora().getTime() + PRAZO_RETOMADA_MS;
    this.retomada = new Promise((resolve) =>
      this.programar(() => {
        this.retomada = null;
        let disparos: Disparo[] = [];
        try {
          disparos = this.conferir();
          console.error(`agendador: voltou da suspensão, ${disparos.length} gatilho(s) disparado(s)`);
        } catch (erro) {
          console.error(`agendador: conferência da retomada falhou: ${String(erro)}`);
        }
        resolve(disparos);
      }, PRAZO_RETOMADA_MS),
    );
    return this.retomada;
  }

  /**
   * Um evento interno aconteceu: dispara cada agente que tem esse gatilho. Se um disparo do mesmo
   * agente e evento ainda está em curso, este espera a vez, e os que chegarem enquanto isso entram
   * juntos, com os detalhes um depois do outro.
   */
  emitir(nome: string, detalhe?: string): Disparo[] {
    const agora = this.agora();
    const disparos: Disparo[] = [];
    for (const agente of this.agentesQueTrabalham()) {
      for (const gatilho of agente.gatilhos) {
        if (gatilho.tipo !== "evento" || gatilho.nome !== nome) continue;
        disparos.push(this.evento(agente.id, gatilho, agora, detalhe));
      }
    }
    return disparos;
  }

  /** Confere a cada {@link INTERVALO_AGENDADOR_MS}. Não segura o processo aberto; devolve como parar. */
  vigiar(intervaloMs = INTERVALO_AGENDADOR_MS): () => void {
    const relogio = setInterval(() => {
      try {
        this.verificar();
      } catch (erro) {
        console.error(`agendador: conferência falhou: ${String(erro)}`);
      }
    }, intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  private conferir(): Disparo[] {
    const agora = this.agora();
    const anterior = this.ultimaConferencia;
    this.adiadaAte = null;
    const guardadas = this.deps.disparos.todas();
    const vistas = new Set<string>();
    const disparos: Disparo[] = [];
    for (const agente of this.agentesQueTrabalham()) {
      for (const gatilho of agente.gatilhos) {
        if (gatilho.tipo === "evento") continue;
        const texto = JSON.stringify(gatilho);
        const chave = chaveDe(agente.id, texto);
        vistas.add(chave);
        const guardada = guardadas.get(chave);
        if (!guardada) {
          // Primeira vez que aparece: começa a contar de agora.
          this.guardar(agente.id, texto, { referencia: agora.toISOString(), disparadoEm: null }, agora);
          continue;
        }
        const previsto = this.vencido(agente.id, texto, gatilho, guardada, agora);
        if (!previsto || this.pendentes.has(chave)) continue;
        disparos.push(this.disparar(agente.id, gatilho, texto, chave, previsto, agora, anterior));
      }
    }
    // Gatilho que saiu da configuração (ou agente desligado) recomeça do zero se voltar.
    this.deps.disparos.manterSo(vistas);
    this.ultimaConferencia = agora.getTime();
    return disparos;
  }

  /** Desligado não trabalha sozinho. Pausado e dormindo pedem ao runtime, que decide a vez. */
  private agentesQueTrabalham() {
    return this.deps.agentes.agentes().filter((agente) => agente.estado !== "desligado");
  }

  /** Quando o gatilho venceu, se venceu desde a referência; `null` se ainda não é a hora. */
  private vencido(
    agenteId: string,
    texto: string,
    gatilho: Gatilho,
    guardada: ReferenciaGuardada,
    agora: Date,
  ): Date | null {
    const referencia = Date.parse(guardada.referencia);
    if (gatilho.tipo === "horario") {
      // Só a ocorrência de hoje: a de ontem que passou com o PC desligado não dispara mais. Como a
      // referência é a ocorrência disparada, o relógio que volta não dispara a mesma de novo.
      const hoje = ocorrenciaDeHoje(gatilho.hora, agora);
      return hoje.getTime() <= agora.getTime() && hoje.getTime() > referencia ? hoje : null;
    }
    if (gatilho.tipo === "intervalo") {
      if (referencia > agora.getTime()) {
        // O relógio do PC voltou para trás: começa a contar de agora.
        this.guardar(agenteId, texto, { ...guardada, referencia: agora.toISOString() }, agora);
        return null;
      }
      const proxima = referencia + gatilho.minutos * 60_000;
      return agora.getTime() >= proxima ? new Date(proxima) : null;
    }
    return null;
  }

  private disparar(
    agenteId: string,
    gatilho: Gatilho,
    texto: string,
    chave: string,
    previsto: Date,
    agora: Date,
    anterior: number | null,
  ): Disparo {
    // Venceu numa conferência que já passou: só não disparou porque o anterior estava em curso.
    const esperou = anterior !== null && previsto.getTime() <= anterior;
    const atrasado = !esperou && agora.getTime() - previsto.getTime() > TOLERANCIA_ATRASO_MS;
    // O horário guarda a ocorrência; o intervalo conta do previsto quando saiu na hora, sem deriva.
    const referencia = gatilho.tipo === "horario" || (!atrasado && !esperou) ? previsto : agora;
    // Antes do runtime: se o serviço cair no meio, o disparo não se repete ao subir.
    this.guardar(
      agenteId,
      texto,
      { referencia: referencia.toISOString(), disparadoEm: agora.toISOString() },
      agora,
    );
    this.pendentes.add(chave);
    const resultado = this.pedir(
      agenteId,
      gatilho,
      mensagemDoDisparo(gatilho, { previsto, agora, atrasado, esperou }),
    ).finally(() => this.pendentes.delete(chave));
    return {
      agenteId,
      gatilho,
      previsto: previsto.toISOString(),
      atrasado,
      esperou,
      juntado: false,
      resultado,
    };
  }

  private evento(
    agenteId: string,
    gatilho: Gatilho & { tipo: "evento" },
    agora: Date,
    detalhe?: string,
  ): Disparo {
    const chave = `${agenteId}|${gatilho.nome}`;
    const detalhes = detalhe ? [detalhe] : [];
    const base = { agenteId, gatilho, atrasado: false };
    const emCurso = this.eventos.get(chave);
    if (!emCurso) {
      const estado = { esperando: null as EventosEsperando | null };
      this.eventos.set(chave, estado);
      const resultado = this.rodarEvento(chave, estado, gatilho, agenteId, agora, 1, detalhes);
      return { ...base, previsto: agora.toISOString(), esperou: false, juntado: false, resultado };
    }
    if (emCurso.esperando) {
      emCurso.esperando.vezes++;
      emCurso.esperando.detalhes.push(...detalhes);
      const { desde, resultado } = emCurso.esperando;
      return { ...base, previsto: desde.toISOString(), esperou: true, juntado: true, resultado };
    }
    let entregar!: (resultado: Promise<ResultadoExecucao | null>) => void;
    const resultado = new Promise<ResultadoExecucao | null>((resolve) => (entregar = resolve));
    emCurso.esperando = { gatilho, desde: agora, vezes: 1, detalhes, resultado, entregar };
    return { ...base, previsto: agora.toISOString(), esperou: true, juntado: false, resultado };
  }

  private rodarEvento(
    chave: string,
    estado: { esperando: EventosEsperando | null },
    gatilho: Gatilho,
    agenteId: string,
    desde: Date,
    vezes: number,
    detalhes: readonly string[],
  ): Promise<ResultadoExecucao | null> {
    const agora = this.agora();
    const texto = mensagemDoDisparo(gatilho, {
      previsto: desde,
      agora,
      atrasado: false,
      esperou: false,
      vezes,
      detalhes,
    });
    return this.pedir(agenteId, gatilho, texto).finally(() => {
      const proximos = estado.esperando;
      if (!proximos) {
        this.eventos.delete(chave);
        return;
      }
      estado.esperando = null;
      proximos.entregar(
        this.rodarEvento(chave, estado, gatilho, agenteId, proximos.desde, proximos.vezes, proximos.detalhes),
      );
    });
  }

  private pedir(agenteId: string, gatilho: Gatilho, texto: string): Promise<ResultadoExecucao | null> {
    return this.deps.runtime
      .executar({ agenteId, gatilho: gatilho.tipo, mensagens: [{ papel: "usuario", texto }] })
      .catch((erro: unknown) => {
        console.error(`agendador: ${descreverGatilho(gatilho)} de ${agenteId} não rodou: ${String(erro)}`);
        return null;
      });
  }

  private guardar(agenteId: string, texto: string, guardada: ReferenciaGuardada, agora: Date): void {
    this.deps.disparos.gravar(agenteId, texto, guardada, agora.toISOString());
  }
}
