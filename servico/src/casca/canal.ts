import { createInterface } from "node:readline";

/**
 * Canal com a casca pelo stdio do sidecar, em linhas JSON.
 * - serviço -> casca (stdout): avisos ({ tipo: "pronto", porta }) e pedidos com id;
 * - casca -> serviço (stdin): respostas com o mesmo id e avisos sem pedido, pelo `tipo`
 *   (o clique num aviso do Windows).
 * O stdout é só do canal; log vai para o stderr.
 */
export interface Saida {
  write(linha: string): unknown;
}

export class CanalCasca {
  private proximo = 1;
  private pendentes = new Map<number, (resposta: Record<string, unknown>) => void>();
  private ouvintes = new Map<string, (aviso: Record<string, unknown>) => void>();

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

  /** Recebe os avisos da casca que não respondem a pedido, pelo `tipo`; devolve como parar. */
  aoReceber(tipo: string, ouvinte: (aviso: Record<string, unknown>) => void): () => void {
    this.ouvintes.set(tipo, ouvinte);
    return () => this.ouvintes.delete(tipo);
  }

  /** Entrega uma linha recebida da casca ao pedido que espera por ela, ou a quem ouve o tipo. */
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
      return;
    }
    if (typeof mensagem.tipo === "string" && mensagem.id === undefined) {
      this.ouvintes.get(mensagem.tipo)?.(mensagem);
    }
  }

  ouvir(entrada: NodeJS.ReadableStream): void {
    createInterface({ input: entrada }).on("line", (linha) => this.receber(linha));
  }
}
