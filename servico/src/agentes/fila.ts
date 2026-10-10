/**
 * A fila de cada agente (AGENTS.md §6): execuções do mesmo agente saem uma de cada vez, na ordem
 * em que chegaram; agentes diferentes não esperam um pelo outro. Vale para qualquer provedor, de
 * CLI ou de API, e é ela que diz quantos pedidos estão esperando a vez.
 */
export class FilaPorAgente {
  /** A cauda da fila de cada agente: resolve quando o último que entrou termina. */
  private readonly caudas = new Map<string, Promise<void>>();
  private readonly esperando = new Map<string, number>();

  /** `aoMudar` avisa quando a quantidade de quem espera a vez de um agente muda. */
  constructor(private readonly aoMudar: (agenteId: string) => void = () => {}) {}

  /**
   * Roda `trabalho` na vez do agente e devolve o que ele devolver. Cancelar enquanto espera tira o
   * pedido da fila sem rodar; quem chegou depois continua esperando quem estava antes.
   */
  async rodar<T>(agenteId: string, trabalho: () => Promise<T>, sinal?: AbortSignal): Promise<T> {
    sinal?.throwIfAborted();
    const anterior = this.caudas.get(agenteId);
    let soltar!: () => void;
    const minha = new Promise<void>((resolve) => (soltar = resolve));
    const cauda = (anterior ?? Promise.resolve()).then(() => minha);
    this.caudas.set(agenteId, cauda);
    void cauda.then(() => {
      if (this.caudas.get(agenteId) === cauda) this.caudas.delete(agenteId);
    });
    try {
      // Fila vazia: roda já, sem passar pela contagem de quem espera.
      if (anterior) {
        this.contar(agenteId, 1);
        try {
          await esperarOuCancelar(anterior, sinal);
        } finally {
          this.contar(agenteId, -1);
        }
      }
      return await trabalho();
    } finally {
      soltar();
    }
  }

  /** Quantos pedidos esperam a vez do agente, sem contar o que está rodando. */
  esperandoDe(agenteId: string): number {
    return this.esperando.get(agenteId) ?? 0;
  }

  private contar(agenteId: string, delta: number): void {
    const n = this.esperandoDe(agenteId) + delta;
    if (n > 0) this.esperando.set(agenteId, n);
    else this.esperando.delete(agenteId);
    this.aoMudar(agenteId);
  }
}

function esperarOuCancelar(promessa: Promise<void>, sinal?: AbortSignal): Promise<void> {
  if (!sinal) return promessa;
  sinal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aoAbortar = () => reject(sinal.reason);
    sinal.addEventListener("abort", aoAbortar, { once: true });
    void promessa.then(() => {
      sinal.removeEventListener("abort", aoAbortar);
      resolve();
    });
  });
}
