import type { FalhaProvedor, MotivoFalhaProvedor } from "@moductus/contrato";
import type { EventoAgente, PedidoDoAgente, Provedor } from "./provedor.ts";

/**
 * Um passo do roteiro: os eventos de um provedor de verdade, mais `pausa` (latência) e `excecao`
 * (adaptador quebrado). `ferramenta` não traz o resultado: o falso chama `executarFerramenta`
 * do pedido, como o adaptador de API faz, e relata o que voltou.
 */
export type PassoRoteiro =
  | { tipo: "texto"; texto: string }
  | { tipo: "ferramenta"; nome: string; entrada: unknown; id?: string }
  | Extract<EventoAgente, { tipo: "uso" }>
  | { tipo: "fim"; continuacao?: string | null }
  | { tipo: "erro"; falha: FalhaProvedor }
  | { tipo: "pausa"; ms: number }
  | { tipo: "excecao"; erro: Error };

/** Os passos de uma execução, fixos ou montados a partir do pedido. */
export type Roteiro = readonly PassoRoteiro[] | ((pedido: PedidoDoAgente) => readonly PassoRoteiro[]);

/**
 * Provedor roteirizado (ADR-0016): cada execução segue o próximo roteiro da fila, sem rede nem
 * modelo. É o único provedor dos testes e do CI. Guarda os pedidos recebidos para o teste
 * conferir o que o runtime mandou. Execução sem roteiro é erro de teste e falha alto.
 */
export class ProvedorFalso implements Provedor {
  readonly pedidos: PedidoDoAgente[] = [];
  private readonly roteiros: Roteiro[];
  private chamadas = 0;

  constructor(
    readonly id: string,
    ...roteiros: Roteiro[]
  ) {
    this.roteiros = roteiros;
  }

  roteirizar(...roteiros: Roteiro[]): this {
    this.roteiros.push(...roteiros);
    return this;
  }

  /** Roteiros ainda não usados. */
  get pendentes(): number {
    return this.roteiros.length;
  }

  async *executar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente> {
    sinal.throwIfAborted();
    const roteiro = this.roteiros.shift();
    if (!roteiro) {
      throw new Error(`provedor falso ${this.id} sem roteiro para a execução ${pedido.execucaoId}`);
    }
    this.pedidos.push(pedido);
    const passos = typeof roteiro === "function" ? roteiro(pedido) : roteiro;
    for (const passo of passos) {
      sinal.throwIfAborted();
      switch (passo.tipo) {
        case "pausa":
          await pausar(passo.ms, sinal);
          break;
        case "excecao":
          throw passo.erro;
        case "ferramenta": {
          const chamada = {
            id: passo.id ?? `chamada-${++this.chamadas}`,
            nome: passo.nome,
            entrada: passo.entrada,
          };
          yield { tipo: "ferramenta", chamada };
          const resultado = await pedido.executarFerramenta(chamada);
          sinal.throwIfAborted();
          yield { tipo: "resultado", chamadaId: chamada.id, resultado };
          break;
        }
        case "fim":
          yield { tipo: "fim", continuacao: passo.continuacao ?? null };
          return;
        case "erro":
          yield passo;
          return;
        default:
          yield passo;
      }
    }
    // Provedor de verdade sempre fecha; roteiro curto também.
    yield { tipo: "fim", continuacao: null };
  }
}

/** Espera cancelável pelo `setTimeout` global, para o relógio falso do vitest valer aqui. */
function pausar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aoAbortar = () => {
      clearTimeout(espera);
      reject(sinal.reason);
    };
    const espera = setTimeout(() => {
      sinal.removeEventListener("abort", aoAbortar);
      resolve();
    }, ms);
    sinal.addEventListener("abort", aoAbortar, { once: true });
  });
}

/** Roteiros que quase todo teste usa. */
export const roteiros = {
  /** Responde o texto, conta tokens e fecha. */
  resposta(texto: string, uso = { tokensEntrada: 100, tokensSaida: 20 }): PassoRoteiro[] {
    return [{ tipo: "texto", texto }, { tipo: "uso", ...uso }, { tipo: "fim" }];
  },
  /** Falha tipada logo de saída, como um limite estourado ou um CLI que sumiu. */
  falha(motivo: MotivoFalhaProvedor, voltaEm: string | null = null): PassoRoteiro[] {
    return [{ tipo: "erro", falha: { motivo, mensagem: `falha roteirizada: ${motivo}`, voltaEm } }];
  },
};
