import { createInterface } from "node:readline";

/**
 * Canal com a casca pelo stdio do sidecar, em linhas JSON.
 * - serviço -> casca (stdout): avisos ({ tipo: "pronto", porta }) e pedidos com id;
 * - casca -> serviço (stdin): respostas com o mesmo id.
 * O stdout é só do canal; log vai para o stderr.
 */
export interface Saida {
  write(linha: string): unknown;
}

export class CanalCasca {
  private proximo = 1;
  private pendentes = new Map<number, (resposta: Record<string, unknown>) => void>();

  constructor(private readonly saida: Saida) {}

  avisar(aviso: Record<string, unknown>): void {
    this.saida.write(`${JSON.stringify(aviso)}\n`);
  }

  pedir<T extends Record<string, unknown>>(pedido: Record<string, unknown>, limiteMs = 10_000): Promise<T> {
    const id = this.proximo++;
    return new Promise<T>((resolver, rejeitar) => {
      const prazo = setTimeout(() => {
        this.pendentes.delete(id);
        rejeitar(new Error(`a casca não respondeu ao pedido ${String(pedido.tipo)}`));
      }, limiteMs);
      this.pendentes.set(id, (resposta) => {
        clearTimeout(prazo);
        resolver(resposta as T);
      });
      this.avisar({ ...pedido, id });
    });
  }

  /** Entrega uma linha recebida da casca ao pedido que espera por ela. */
  receber(linha: string): void {
    let mensagem: Record<string, unknown>;
    try {
      mensagem = JSON.parse(linha) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof mensagem.id === "number" ? mensagem.id : -1;
    const resolver = this.pendentes.get(id);
    if (resolver) {
      this.pendentes.delete(id);
      resolver(mensagem);
    }
  }

  ouvir(entrada: NodeJS.ReadableStream): void {
    createInterface({ input: entrada }).on("line", (linha) => this.receber(linha));
  }
}
