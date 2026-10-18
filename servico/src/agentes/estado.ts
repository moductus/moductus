import type { GastoDeHoje, MotivoSono } from "@moductus/contrato";
import { SO_DOLAR, type ConverterCusto } from "../cambio/cambio.ts";
import { cobrancaDoTipo } from "../provedores/precos.ts";
import type { AgenteGuardado, EstadoGuardado, MotivoSonoGuardado, RepositorioAgentes } from "./agentes.ts";
import type { RepositorioExecucoes } from "./execucoes.ts";

/**
 * Os estados guardados do agente (AGENTS.md §3 "Primeiro uso e falha", §6 "Pausar", §7): `ativo`,
 * `pausado`, `dormindo` e `desligado`. Dormindo ou pausado, o agente não chama o modelo: o pedido
 * que chega na vez dele espera aqui, na frente da fila, e os outros esperam atrás, em ordem. Ao
 * acordar ou retomar, a fila roda. Desligado não roda nada: quem espera é recusado.
 *
 * O agente dorme quando o provedor falha (limite, fora do ar, credencial, CLI ausente) e quando
 * chega ao teto de gasto do dia (na moeda do teto, pela cotação; ADR-0040). Acorda sozinho na hora de volta que o provedor deu; sem ela, depois
 * de uma espera que cresce a cada falha seguida, e antes disso se alguém o acordar (a configuração
 * do provedor mudou). O despertador e a contagem de falhas vivem na memória: na subida, o
 * despertador é refeito pelo que ficou guardado e a contagem recomeça.
 *
 * Com provedor reserva, a falha do principal não põe o agente para dormir: os pedidos vão à
 * reserva até a hora de tentar o principal de novo.
 */

/** Primeira espera de uma falha sem hora de volta; dobra a cada falha seguida. */
export const ESPERA_INICIAL_MS = 60_000;

/** A espera crescente para aqui: o provedor que volta não fica mais que isso sem ser tentado. */
export const ESPERA_MAXIMA_MS = 30 * 60_000;

/** Na reserva, sem hora de volta do principal, ele é tentado de novo depois disso. */
export const PROVA_DO_PRINCIPAL_MS = 15 * 60_000;

/** O maior atraso que o `setTimeout` aceita; mais longe, o despertador confere e programa de novo. */
const ATRASO_MAXIMO_MS = 2 ** 31 - 1;

export const MENSAGEM_DESLIGADO = (nome: string) =>
  `${nome} está desligado. Ligue de novo em Agentes para ele voltar a trabalhar.`;

/** O agente está desligado: o pedido não roda. A mensagem já é a fala para o usuário. */
export class AgenteDesligado extends Error {
  constructor(
    readonly agenteId: string,
    nome: string,
  ) {
    super(MENSAGEM_DESLIGADO(nome));
    this.name = "AgenteDesligado";
  }
}

export const MENSAGEM_PAUSA_PASSADA = "O fim da pausa já passou.";

/**
 * Por que "Tentar agora" não vale (H2): o limite de uso só libera quando o provedor renova, e o
 * teto é uma decisão sua, que se muda em Modelos. Ditos ao usuário, na voz do AGENTS.md §2.
 */
export const MENSAGEM_ACORDAR_NO_LIMITE = (nome: string) =>
  `${nome} espera o limite de uso renovar: tentar antes não adianta.`;
export const MENSAGEM_ACORDAR_NO_TETO = (nome: string) =>
  `${nome} chegou ao teto de hoje e volta amanhã. Para seguir antes, libere mais ou mude o teto em Modelos.`;
/** "Liberar" só vale no cartão de teto: fora dele, não há o que soltar. */
export const MENSAGEM_LIBERAR_FORA_DO_TETO = (nome: string) => `${nome} não está parado no teto de hoje.`;
export const MENSAGEM_ACORDAR_PAUSADO = (nome: string) => `${nome} está em pausa: retome para voltar.`;
/** Dormindo sem motivo guardado não devia acontecer: recusa em vez de acordar no escuro. */
export const MENSAGEM_ACORDAR_SEM_MOTIVO = (nome: string) =>
  `${nome} dorme sem motivo guardado: espere o despertador ou pause e retome.`;

/**
 * O "Liberar" solta um quinto do teto, no mínimo uma unidade da moeda (o "Liberar US$ 2,00" do
 * teto de US$ 10,00 no Estados.dc.html), a partir do que já foi gasto.
 */
export function passoDoLiberar(tetoCentavos: number): number {
  return Math.max(Math.ceil(tetoCentavos / 5), 100);
}

/** O sono que uma execução pede ao terminar. */
export interface SonoDaExecucao {
  motivo: MotivoSono;
  ate: string | null;
}

export interface DependenciasEstados {
  agentes: Pick<RepositorioAgentes, "agente" | "agentes" | "mudarEstado" | "liberarTeto" | "provedor">;
  execucoes: Pick<RepositorioExecucoes, "custoDesde">;
}

export interface OpcoesEstados {
  agora?: () => Date;
  /** Roda `fazer` daqui a `ms` e devolve como cancelar; o teste troca pelo relógio falso. */
  programar?: (fazer: () => void, ms: number) => () => void;
  /** O custo na moeda do teto; sem ele, {@link SO_DOLAR}: fora do dólar, o teto não vale. */
  emCentavos?: ConverterCusto;
  /** O estado, o sono ou a fila de um agente mudou. */
  aoMudar?: (agenteId: string) => void;
}

const ATIVO: EstadoGuardado = { estado: "ativo", dormeAte: null, motivoSono: null, pausadoAte: null };

/** Meia-noite que começa o dia de `agora`, no relógio local: o teto é "por dia" de quem usa. */
export function inicioDoDia(agora: Date): Date {
  const dia = new Date(agora);
  dia.setHours(0, 0, 0, 0);
  return dia;
}

/** Meia-noite do dia seguinte, no relógio local: quando o teto do dia deixa de valer. */
export function inicioDoDiaSeguinte(agora: Date): Date {
  const dia = inicioDoDia(agora);
  dia.setDate(dia.getDate() + 1);
  return dia;
}

/** A espera depois de `n` falhas seguidas sem hora de volta: 1, 2, 4… até {@link ESPERA_MAXIMA_MS}. */
export function esperaCrescente(n: number): number {
  return Math.min(ESPERA_INICIAL_MS * 2 ** Math.max(n - 1, 0), ESPERA_MAXIMA_MS);
}

export class EstadosAgentes {
  private readonly agora: () => Date;
  private readonly programar: (fazer: () => void, ms: number) => () => void;
  private readonly emCentavos: ConverterCusto;
  private readonly aoMudar: (agenteId: string) => void;
  /** Quem espera na porta de cada agente o estado mudar. */
  private readonly portas = new Map<string, Set<() => void>>();
  /** O despertador de cada agente dormindo ou pausado com hora. */
  private readonly despertadores = new Map<string, () => void>();
  /** Falhas seguidas sem hora de volta, para a espera crescer; zera quando uma execução dá certo. */
  private readonly falhasSeguidas = new Map<string, number>();
  /** Até quando cada agente usa a reserva porque o principal falhou, em ms desde a época. */
  private readonly principalForaAte = new Map<string, number>();
  /** Agentes com teto e sem cotação já avisados no log, para não repetir a cada execução. */
  private readonly tetoSemCambioAvisado = new Set<string>();

  constructor(
    private readonly deps: DependenciasEstados,
    opcoes: OpcoesEstados = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.programar =
      opcoes.programar ??
      ((fazer, ms) => {
        const relogio = setTimeout(fazer, ms);
        relogio.unref();
        return () => clearTimeout(relogio);
      });
    this.emCentavos = opcoes.emCentavos ?? SO_DOLAR;
    this.aoMudar = opcoes.aoMudar ?? (() => {});
  }

  /**
   * Na subida: acorda quem dormia sem hora (a contagem de falhas recomeçou, então o provedor é
   * tentado de novo), acorda ou retoma quem passou da hora enquanto o serviço estava parado e
   * programa o despertador dos outros.
   */
  vigiar(): void {
    for (const agente of this.deps.agentes.agentes()) {
      if (agente.estado === "dormindo" && agente.dormeAte === null) this.acordar(agente.id);
      else this.conferir(agente.id);
    }
  }

  /**
   * Espera o agente poder chamar o modelo e devolve como ele está nessa hora. Dormindo ou pausado,
   * fica na porta até acordar ou retomar; no teto do dia, dorme antes. Lança se o agente sumiu ou
   * está desligado, e com o motivo do cancelamento se `sinal` cair enquanto espera.
   */
  async esperarVez(agenteId: string, sinal?: AbortSignal): Promise<AgenteGuardado> {
    for (;;) {
      sinal?.throwIfAborted();
      const agente = this.deps.agentes.agente(agenteId);
      if (!agente) throw new Error("agente não encontrado");
      if (agente.estado === "desligado") throw new AgenteDesligado(agente.id, agente.nome);
      if (agente.estado === "ativo") {
        if (!this.chegouAoTeto(agente)) return agente;
        this.dormirNoTeto(agente.id);
        continue;
      }
      if (this.passouDaHora(agente)) {
        this.conferir(agente.id);
        continue;
      }
      await this.esperarNaPorta(agente.id, sinal);
    }
  }

  /** Quantos pedidos esperam na porta do agente o sono ou a pausa acabar. */
  naPorta(agenteId: string): number {
    return this.portas.get(agenteId)?.size ?? 0;
  }

  /** O principal deste agente falhou há pouco: o pedido vai direto à reserva. */
  naReserva(agenteId: string): boolean {
    const ate = this.principalForaAte.get(agenteId);
    if (ate === undefined) return false;
    if (ate > this.agora().getTime()) return true;
    this.principalForaAte.delete(agenteId);
    return false;
  }

  /** O principal falhou: até a hora de volta dele, a reserva atende. */
  principalFalhou(agenteId: string, sono: SonoDaExecucao): void {
    const volta = sono.ate !== null ? Date.parse(sono.ate) : Number.NaN;
    this.principalForaAte.set(
      agenteId,
      Number.isFinite(volta) ? volta : this.agora().getTime() + PROVA_DO_PRINCIPAL_MS,
    );
  }

  /**
   * Depois de cada execução: a falha do provedor põe o agente para dormir, até a hora que o provedor
   * deu ou, sem ela, por uma espera que cresce a cada falha seguida. Sem modelo não dorme guardado
   * (a configuração já diz). Execução que deu certo zera a espera e confere o teto.
   */
  depoisDaExecucao(agenteId: string, sono: SonoDaExecucao | null, deuCerto: boolean): void {
    if (sono && sono.motivo !== "sem_modelo") {
      this.dormir(agenteId, sono.motivo, this.horaDeVolta(agenteId, sono));
      return;
    }
    if (deuCerto) this.falhasSeguidas.delete(agenteId);
    const agente = this.deps.agentes.agente(agenteId);
    if (agente?.estado === "ativo" && this.chegouAoTeto(agente)) this.dormirNoTeto(agenteId);
  }

  /** Acorda o agente que dorme: a configuração do provedor mudou, ou alguém pediu para tentar já. */
  acordar(agenteId: string): void {
    this.falhasSeguidas.delete(agenteId);
    this.principalForaAte.delete(agenteId);
    this.mudar(agenteId, ATIVO, ["dormindo"], "agente");
  }

  /**
   * "Tentar agora" (H2): o usuário acorda o agente que dorme por falha do provedor (fora do ar,
   * credencial, CLI ausente) e a fila roda já. Diferente de {@link acordar}, a contagem de falhas
   * fica: se o provedor falhar de novo, a espera cresce de onde estava, em vez de voltar a 1
   * minuto, e insistir não vira uma chamada por minuto. Limite de uso, teto e pausa recusam com o
   * motivo; quem já está ativo (o despertador chegou antes) fica como está.
   */
  tentarAgora(agenteId: string): void {
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) throw new Error("agente não encontrado");
    if (agente.estado === "desligado") throw new AgenteDesligado(agente.id, agente.nome);
    if (agente.estado === "pausado") throw new Error(MENSAGEM_ACORDAR_PAUSADO(agente.nome));
    if (agente.estado !== "dormindo") return;
    switch (agente.motivoSono) {
      case "limite":
        throw new Error(MENSAGEM_ACORDAR_NO_LIMITE(agente.nome));
      case "teto":
        throw new Error(MENSAGEM_ACORDAR_NO_TETO(agente.nome));
      // A falha do provedor pode já ter passado: o usuário instalou o CLI, entrou de novo, a rede voltou.
      case "fora_do_ar":
      case "credencial":
      case "ausente":
        this.mudar(agenteId, ATIVO, ["dormindo"], "usuario");
        return;
      default:
        throw new Error(MENSAGEM_ACORDAR_SEM_MOTIVO(agente.nome));
    }
  }

  /**
   * "Liberar" no cartão de teto (ADR-0040): solta mais um passo a partir do que já foi gasto, até a
   * meia-noite, e o agente que dormia pelo teto acorda e roda a fila. O que foi liberado fica
   * guardado, para valer depois de reiniciar; trocar o teto ou a moeda esquece.
   */
  liberarTeto(agenteId: string): void {
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) throw new Error("agente não encontrado");
    if (agente.estado === "desligado") throw new AgenteDesligado(agente.id, agente.nome);
    const teto = agente.tetoDiarioCentavos;
    if (agente.estado !== "dormindo" || agente.motivoSono !== "teto" || teto === null) {
      throw new Error(MENSAGEM_LIBERAR_FORA_DO_TETO(agente.nome));
    }
    const hoje = this.gastoDeHoje(agente);
    // A execução que passou do teto rodou até o fim: o passo conta do gasto, não do teto.
    const base = Math.max(hoje.limiteCentavos ?? teto, hoje.centavos ?? 0);
    const agora = this.agora();
    this.deps.agentes.liberarTeto(
      agenteId,
      base + passoDoLiberar(teto) - teto,
      inicioDoDiaSeguinte(agora).toISOString(),
      agora.toISOString(),
    );
    this.mudar(agenteId, ATIVO, ["dormindo"], "usuario");
  }

  /**
   * O teto, a moeda dele ou a cotação mudou: quem dormia pelo teto e já não está nele acorda, e a
   * fila roda; quem estava ativo e já passou do teto novo dorme já, sem esperar a próxima vez.
   */
  tetoMudou(agenteId: string): void {
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) return;
    if (agente.estado === "dormindo" && agente.motivoSono === "teto" && !this.chegouAoTeto(agente)) {
      this.mudar(agenteId, ATIVO, ["dormindo"], "usuario");
    } else if (agente.estado === "ativo" && this.chegouAoTeto(agente)) {
      this.dormirNoTeto(agenteId);
    }
  }

  /**
   * O gasto de hoje contra o teto, para a tela: o custo estimado em dólar, o mesmo na moeda do teto
   * (pela cotação, com a data dela), o limite com o que foi liberado e quanto o "Liberar" solta.
   */
  gastoDeHoje(agente: AgenteGuardado): GastoDeHoje {
    const agora = this.agora();
    const microdolares = this.deps.execucoes.custoDesde(agente.id, inicioDoDia(agora).toISOString());
    const conversao = this.emCentavos(microdolares, agente.tetoMoeda);
    const teto = agente.tetoDiarioCentavos;
    const liberado =
      teto !== null && agente.tetoLiberadoAte !== null && Date.parse(agente.tetoLiberadoAte) > agora.getTime()
        ? (agente.tetoLiberadoCentavos ?? 0)
        : 0;
    const limite = teto === null ? null : teto + liberado;
    return {
      microdolares,
      centavos: conversao?.centavos ?? null,
      cotacaoDe: conversao?.cotacaoDe ?? null,
      limiteCentavos: limite,
      liberarCentavos: teto === null ? null : passoDoLiberar(teto),
      // Limite zero vale sem cotação: zero é zero em qualquer moeda.
      pedeCotacao: limite !== null && limite > 0 && conversao === null,
    };
  }

  /**
   * O usuário trocou o modelo do agente (principal ou reserva). A espera e a ida à reserva vinham
   * da falha do provedor de antes e não valem para o novo; quem dormia por causa de um provedor
   * tenta de novo já. Quem dorme pelo teto do dia continua dormindo: trocar o modelo não muda o
   * teto. A execução que está rodando não é tocada e termina no modelo de antes.
   */
  modeloMudou(agenteId: string): void {
    this.falhasSeguidas.delete(agenteId);
    this.principalForaAte.delete(agenteId);
    const agente = this.deps.agentes.agente(agenteId);
    if (agente?.estado === "dormindo" && agente.motivoSono !== "teto") {
      this.mudar(agenteId, ATIVO, ["dormindo"], "usuario");
    }
  }

  /**
   * Pausa um agente ou, sem `agenteId`, o time todo (os ligados), até `ate` ou até retomar. A pausa
   * vale por cima do sono: ao retomar, o agente que ainda está sem modelo dorme de novo na próxima
   * tentativa. Devolve quem ficou pausado.
   */
  pausar(agenteId: string | undefined, ate: string | null): string[] {
    if (ate !== null && Date.parse(ate) <= this.agora().getTime()) throw new Error(MENSAGEM_PAUSA_PASSADA);
    const pausa: EstadoGuardado = { estado: "pausado", dormeAte: null, motivoSono: null, pausadoAte: ate };
    return this.alvos(agenteId).filter((id) =>
      this.mudar(id, pausa, ["ativo", "dormindo", "pausado"], "usuario"),
    );
  }

  /** Retoma um agente pausado ou, sem `agenteId`, todos os pausados. Devolve quem retomou. */
  retomar(agenteId: string | undefined): string[] {
    return this.alvos(agenteId).filter((id) => this.mudar(id, ATIVO, ["pausado"], "usuario"));
  }

  /** Liga ou desliga. Desligar recusa os pedidos que esperavam a vez dele. */
  ligar(agenteId: string, ligado: boolean): void {
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) throw new Error("agente não encontrado");
    if (ligado) {
      this.mudar(agenteId, ATIVO, ["desligado"], "usuario");
      return;
    }
    this.falhasSeguidas.delete(agenteId);
    this.principalForaAte.delete(agenteId);
    this.mudar(
      agenteId,
      { estado: "desligado", dormeAte: null, motivoSono: null, pausadoAte: null },
      ["ativo", "dormindo", "pausado"],
      "usuario",
    );
  }

  /** Um agente pelo id (que precisa existir e estar ligado) ou, sem id, todos os ligados. */
  private alvos(agenteId: string | undefined): string[] {
    if (agenteId === undefined) {
      return this.deps.agentes
        .agentes()
        .filter((a) => a.estado !== "desligado")
        .map((a) => a.id);
    }
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) throw new Error("agente não encontrado");
    if (agente.estado === "desligado") throw new AgenteDesligado(agente.id, agente.nome);
    return [agente.id];
  }

  /**
   * A hora de acordar: a que o provedor deu; sem ela, a espera crescente. Credencial recusada e CLI
   * ausente também esperam: o usuário pode consertar fora do Moductus (instalar o CLI, entrar de
   * novo), e ninguém avisaria. Se o principal já estava fora e foi a reserva que falhou, vale a
   * primeira das duas voltas.
   */
  private horaDeVolta(agenteId: string, sono: SonoDaExecucao): string {
    const voltas: number[] = [];
    const dada = sono.ate !== null ? Date.parse(sono.ate) : Number.NaN;
    if (Number.isFinite(dada)) voltas.push(dada);
    else {
      const n = (this.falhasSeguidas.get(agenteId) ?? 0) + 1;
      this.falhasSeguidas.set(agenteId, n);
      voltas.push(this.agora().getTime() + esperaCrescente(n));
    }
    const principal = this.principalForaAte.get(agenteId);
    // Ao acordar, o principal é tentado primeiro de novo.
    this.principalForaAte.delete(agenteId);
    if (principal !== undefined) voltas.push(principal);
    return new Date(Math.min(...voltas)).toISOString();
  }

  private dormir(agenteId: string, motivo: MotivoSonoGuardado, ate: string | null): void {
    this.mudar(
      agenteId,
      { estado: "dormindo", dormeAte: ate, motivoSono: motivo, pausadoAte: null },
      ["ativo", "dormindo"],
      "agente",
    );
  }

  private dormirNoTeto(agenteId: string): void {
    this.dormir(agenteId, "teto", inicioDoDiaSeguinte(this.agora()).toISOString());
  }

  /**
   * O gasto de hoje chegou ao limite do agente (o teto mais o que foi liberado). Só o que custou
   * conta (assinatura não gasta). Em dólar não há conversão; em outra moeda, sem cotação gravada o
   * teto não vale: nada de número inventado. Limite zero é "não gastar nada": a primeira execução
   * paga do dia já não roda, em qualquer moeda (zero não precisa de cotação).
   */
  private chegouAoTeto(agente: AgenteGuardado): boolean {
    if (agente.tetoDiarioCentavos === null) return false;
    const hoje = this.gastoDeHoje(agente);
    if (hoje.limiteCentavos === 0) return this.vaiCobrar(agente);
    if (hoje.microdolares <= 0) return false;
    if (hoje.centavos === null || hoje.limiteCentavos === null) {
      if (!this.tetoSemCambioAvisado.has(agente.id)) {
        this.tetoSemCambioAvisado.add(agente.id);
        console.error(`teto diário de ${agente.id} não vale: sem cotação do dólar para ${agente.tetoMoeda}`);
      }
      return false;
    }
    this.tetoSemCambioAvisado.delete(agente.id);
    return hoje.centavos >= hoje.limiteCentavos;
  }

  /**
   * A próxima execução do agente cobra por uso: o provedor que vai atendê-la (a reserva, enquanto
   * o principal está fora) é de API. Assinatura (CLI) não gasta dinheiro.
   */
  private vaiCobrar(agente: AgenteGuardado, provedorId?: string | null): boolean {
    const id =
      provedorId !== undefined
        ? provedorId
        : agente.provedorId && agente.provedorReservaId && this.naReserva(agente.id)
          ? agente.provedorReservaId
          : agente.provedorId;
    const provedor = id ? this.deps.agentes.provedor(id) : null;
    return provedor !== null && cobrancaDoTipo(provedor.tipo) === "por_token";
  }

  /**
   * Antes de repetir na reserva o pedido que o principal não atendeu: com limite zero e reserva de
   * API, a repetição já seria gasto, e não roda (o agente dorme pela falha do principal).
   */
  barradoNoTetoZero(agente: AgenteGuardado, provedorId: string): boolean {
    if (agente.tetoDiarioCentavos === null) return false;
    return this.gastoDeHoje(agente).limiteCentavos === 0 && this.vaiCobrar(agente, provedorId);
  }

  /** Dormindo ou pausado com hora, e a hora já passou. */
  private passouDaHora(agente: AgenteGuardado): boolean {
    const ate =
      agente.estado === "dormindo" ? agente.dormeAte : agente.estado === "pausado" ? agente.pausadoAte : null;
    return ate !== null && Date.parse(ate) <= this.agora().getTime();
  }

  /** Acorda ou retoma quem passou da hora; senão, programa o despertador para ela. */
  private conferir(agenteId: string): void {
    const agente = this.deps.agentes.agente(agenteId);
    if (!agente) return;
    if (this.passouDaHora(agente)) {
      this.mudar(agenteId, ATIVO, [agente.estado], "agente");
      return;
    }
    this.programarDespertador(agente);
  }

  private programarDespertador(agente: AgenteGuardado): void {
    this.despertadores.get(agente.id)?.();
    this.despertadores.delete(agente.id);
    const ate =
      agente.estado === "dormindo" ? agente.dormeAte : agente.estado === "pausado" ? agente.pausadoAte : null;
    if (ate === null) return;
    const ms = Math.min(Math.max(Date.parse(ate) - this.agora().getTime(), 0), ATRASO_MAXIMO_MS);
    const cancelar = this.programar(() => {
      if (this.despertadores.get(agente.id) !== cancelar) return;
      this.despertadores.delete(agente.id);
      this.conferir(agente.id);
    }, ms);
    this.despertadores.set(agente.id, cancelar);
  }

  /** Grava o estado e, se mudou, refaz o despertador, abre a porta e avisa. */
  private mudar(
    agenteId: string,
    para: EstadoGuardado,
    de: readonly AgenteGuardado["estado"][],
    pelo: "usuario" | "agente",
  ): boolean {
    if (!this.deps.agentes.mudarEstado(agenteId, para, de, pelo, this.agora().toISOString())) return false;
    const agente = this.deps.agentes.agente(agenteId);
    if (agente) this.programarDespertador(agente);
    this.abrirPorta(agenteId);
    this.aoMudar(agenteId);
    return true;
  }

  private esperarNaPorta(agenteId: string, sinal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const porta = this.portas.get(agenteId) ?? new Set<() => void>();
      this.portas.set(agenteId, porta);
      const aoCancelar = () => {
        porta.delete(soltar);
        if (porta.size === 0) this.portas.delete(agenteId);
        this.aoMudar(agenteId);
        reject(sinal?.reason);
      };
      const soltar = () => {
        sinal?.removeEventListener("abort", aoCancelar);
        resolve();
      };
      porta.add(soltar);
      sinal?.addEventListener("abort", aoCancelar, { once: true });
      this.aoMudar(agenteId);
    });
  }

  /** Solta quem esperava na porta; cada um confere o estado de novo e volta a esperar se precisar. */
  private abrirPorta(agenteId: string): void {
    const porta = this.portas.get(agenteId);
    if (!porta) return;
    this.portas.delete(agenteId);
    for (const soltar of porta) soltar();
  }
}
