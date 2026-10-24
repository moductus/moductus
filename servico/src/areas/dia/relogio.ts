/**
 * O relógio do dia (ADR-0032): lembretes, fim do ciclo do foco e rotinas disparam por um timer
 * próprio do serviço, sem modelo e sem rede. Cada área registra uma fonte, que diz quando tem algo
 * a fazer e faz o que venceu; o relógio arma **um** `setTimeout` até o mais próximo, nunca mais
 * longe que a guarda de 60 s (o relógio do sistema pode mudar, e o PC pode dormir no meio), e se
 * rearma a cada mudança das tabelas dessas fontes.
 *
 * Ausência é o tempo em que o relógio não pôde olhar: o serviço parado (na subida) ou o PC suspenso
 * (a casca avisa `retomou`, ou o próprio timer acorda bem depois da hora). O que venceu nela é da
 * fonte decidir: o lembrete vira `perdido` e sai num aviso só.
 */

/** A guarda: o timer nunca dorme mais que isto. */
export const GUARDA_MS = 60_000;

/**
 * Quanto o timer pode acordar depois da hora sem contar como ausência. Um `setTimeout` atrasa
 * alguns milissegundos com o serviço ocupado; dezenas de segundos, só com o processo parado.
 */
export const FOLGA_DO_TIMER_MS = 30_000;

/** Depois de uma conferência com falha, o timer espera isto antes de tentar de novo. */
export const ESPERA_DEPOIS_DA_FALHA_MS = 5_000;

/** O tempo em que o relógio não olhou: `de` é nulo quando não se sabe (o serviço estava parado). */
export interface Ausencia {
  de: Date | null;
  ate: Date;
}

/** Uma conferência do relógio: o agora de todas as fontes e a ausência, se houve. */
export interface Conferencia {
  agora: Date;
  ausencia: Ausencia | null;
}

export interface FonteDoRelogio {
  /** Para o log. */
  readonly nome: string;
  /** O próximo instante em que a fonte tem algo a fazer, ou `null`; no passado, confere já. */
  proximo(agora: Date): Date | null;
  /** Faz o que venceu até `agora`. */
  conferir(conferencia: Conferencia): void | Promise<void>;
}

export interface OpcoesRelogio {
  agora?: () => Date;
  /**
   * O quanto o timer pode dormir; o serviço usa a `GUARDA_MS`. Teste que atravessa dias passa uma
   * guarda longa: o relógio acorda só quando as fontes pedem, e um dia não custa 1.440 conferências.
   */
  guardaMs?: number;
}

export class RelogioDoDia {
  private readonly agora: () => Date;
  private readonly guardaMs: number;
  private readonly fontes: FonteDoRelogio[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Quando o timer armado deve acordar; `null` com o relógio parado. */
  private alvo: number | null = null;
  /** A última conferência: o último momento em que o relógio sabe que o PC estava acordado. */
  private ultima: Date | null = null;
  /** As conferências não se sobrepõem: cada uma espera a anterior acabar. */
  private fila: Promise<void> = Promise.resolve();
  private ligado = false;

  constructor(opcoes: OpcoesRelogio = {}) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.guardaMs = opcoes.guardaMs ?? GUARDA_MS;
  }

  registrar(fonte: FonteDoRelogio): void {
    this.fontes.push(fonte);
    if (this.ligado) this.mudou();
  }

  /**
   * A primeira conferência, na subida: o que venceu com o serviço parado é ausência de começo
   * desconhecido. Depois o timer fica armado.
   */
  ligar(): Promise<void> {
    this.ligado = true;
    return this.conferir(() => ({ de: null, ate: this.agora() }));
  }

  /** A casca avisou que o PC voltou da suspensão: o tempo desde a última conferência foi ausência. */
  retomar(): Promise<void> {
    if (!this.ligado) return this.fila;
    return this.conferir(() => ({ de: this.ultima, ate: this.agora() }));
  }

  /**
   * Uma fonte mudou (lembrete criado, adiado, foco iniciado): rearma. Se algo já venceu, a
   * conferência sai no próximo giro do laço, não dentro de quem escreveu.
   */
  mudou(): void {
    if (this.ligado) this.armar();
  }

  parar(): void {
    this.ligado = false;
    this.desarmar();
  }

  private tique(): void {
    this.timer = null;
    const alvo = this.alvo;
    this.conferir(() => {
      // Acordou muito depois da hora: o processo ficou parado (PC suspenso antes de a casca avisar).
      const agora = this.agora();
      return alvo !== null && agora.getTime() - alvo > FOLGA_DO_TIMER_MS
        ? { de: this.ultima, ate: agora }
        : null;
    }).catch(() => {});
  }

  /**
   * Uma conferência na fila. Nada que falhe dentro dela quebra a fila nem desarma o relógio: a
   * falha vai ao log e o timer volta, alguns segundos depois, para não girar em falso sobre uma
   * fonte que falha de novo a cada tentativa.
   */
  private conferir(ausencia: () => Ausencia | null): Promise<void> {
    this.fila = this.fila.then(async () => {
      if (!this.ligado) return;
      let falhou = false;
      try {
        this.desarmar();
        const conferencia: Conferencia = { agora: this.agora(), ausencia: ausencia() };
        for (const fonte of this.fontes) {
          try {
            await fonte.conferir(conferencia);
          } catch (erro) {
            falhou = true;
            console.error(`relógio do dia: ${fonte.nome} falhou: ${String(erro)}`);
          }
        }
        this.ultima = conferencia.agora;
      } catch (erro) {
        falhou = true;
        console.error(`relógio do dia: conferência falhou: ${String(erro)}`);
      }
      try {
        this.armar(falhou ? ESPERA_DEPOIS_DA_FALHA_MS : 0);
      } catch (erro) {
        console.error(`relógio do dia: não armou: ${String(erro)}`);
      }
    });
    return this.fila;
  }

  /** Arma o timer até o próximo das fontes, não antes de `minimoMs` nem depois da guarda. */
  private armar(minimoMs = 0): void {
    if (!this.ligado) return;
    this.desarmar();
    const agora = this.agora().getTime();
    let alvo = agora + this.guardaMs;
    for (const fonte of this.fontes) {
      try {
        const proximo = fonte.proximo(new Date(agora));
        if (proximo !== null) alvo = Math.min(alvo, proximo.getTime());
      } catch (erro) {
        console.error(`relógio do dia: ${fonte.nome} não disse o próximo: ${String(erro)}`);
      }
    }
    this.alvo = Math.max(alvo, agora + minimoMs);
    const timer = setTimeout(() => this.tique(), this.alvo - agora);
    timer.unref();
    this.timer = timer;
  }

  private desarmar(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
