import {
  MensagemDoServico,
  PARAMETRO_PROTOCOLO,
  PARAMETRO_TOKEN,
  VERSAO_PROTOCOLO,
  type Pedido,
} from "./canal.ts";
import {
  EVENTOS,
  METODOS,
  type DadosDe,
  type EntradaDe,
  type NomeEvento,
  type NomeMetodo,
  type SaidaDe,
} from "./metodos.ts";

export interface Endereco {
  porta: number;
  token: string;
}

export type EstadoConexao = "desconectado" | "conectando" | "conectado";

/** Espera antes de reconectar: 250 ms dobrando até 5 s. */
export function esperaReconexao(tentativa: number): number {
  return Math.min(250 * 2 ** Math.max(0, tentativa - 1), 5000);
}

/**
 * O pedido nem saiu: sem conexão aberta com o serviço. Diferente de uma falha depois do envio
 * (conexão caiu, resposta de erro), em que o serviço pode já ter agido.
 */
export class ServicoIndisponivel extends Error {
  constructor() {
    super("serviço indisponível");
    this.name = "ServicoIndisponivel";
  }
}

interface Pendente {
  metodo: NomeMetodo;
  resolver: (dados: unknown) => void;
  rejeitar: (erro: Error) => void;
}

/**
 * Cliente do canal com o serviço, para as janelas (e para os testes, no Node). Reconecta
 * sozinho quando a conexão cai, e troca de endereço quando a casca sobe outro serviço.
 */
export class ClienteServico {
  private ws: WebSocket | null = null;
  private endereco: Endereco | null = null;
  private proximoId = 1;
  private tentativa = 0;
  private relogio: ReturnType<typeof setTimeout> | null = null;
  private encerrado = false;
  private readonly pendentes = new Map<number, Pendente>();
  private readonly ouvintes = new Map<string, Set<(dados: unknown) => void>>();
  private readonly ouvintesEstado = new Set<(estado: EstadoConexao) => void>();
  estado: EstadoConexao = "desconectado";

  /** Aponta para um serviço; o mesmo endereço não reabre a conexão. */
  conectar(endereco: Endereco): void {
    if (this.endereco?.porta === endereco.porta && this.endereco.token === endereco.token && this.ws) return;
    this.endereco = endereco;
    this.encerrado = false;
    this.tentativa = 0;
    this.trocarConexao();
  }

  fechar(): void {
    this.encerrado = true;
    this.limparRelogio();
    this.ws?.close();
    this.ws = null;
  }

  aoMudarEstado(fn: (estado: EstadoConexao) => void): () => void {
    this.ouvintesEstado.add(fn);
    return () => this.ouvintesEstado.delete(fn);
  }

  ouvir<N extends NomeEvento>(nome: N, fn: (dados: DadosDe<N>) => void): () => void {
    const lista = this.ouvintes.get(nome) ?? new Set();
    lista.add(fn as (dados: unknown) => void);
    this.ouvintes.set(nome, lista);
    return () => lista.delete(fn as (dados: unknown) => void);
  }

  pedir<M extends NomeMetodo>(
    metodo: M,
    ...dados: EntradaDe<M> extends undefined ? [] : [EntradaDe<M>]
  ): Promise<SaidaDe<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new ServicoIndisponivel());
    }
    const id = this.proximoId++;
    const pedido: Pedido = { tipo: "pedido", id, metodo, dados: dados[0] };
    return new Promise<SaidaDe<M>>((resolver, rejeitar) => {
      this.pendentes.set(id, { metodo, resolver: resolver as (d: unknown) => void, rejeitar });
      ws.send(JSON.stringify(pedido));
    });
  }

  private definirEstado(estado: EstadoConexao): void {
    if (this.estado === estado) return;
    this.estado = estado;
    for (const fn of this.ouvintesEstado) fn(estado);
  }

  private limparRelogio(): void {
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
  }

  private trocarConexao(): void {
    this.limparRelogio();
    const antigo = this.ws;
    this.ws = null;
    if (antigo) {
      antigo.onclose = null;
      antigo.close();
      this.falharPendentes("conexão trocada");
    }
    this.abrir();
  }

  private abrir(): void {
    if (!this.endereco || this.encerrado) return;
    const { porta, token } = this.endereco;
    this.definirEstado("conectando");
    const consulta = `${PARAMETRO_TOKEN}=${encodeURIComponent(token)}&${PARAMETRO_PROTOCOLO}=${VERSAO_PROTOCOLO}`;
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/?${consulta}`);
    this.ws = ws;
    ws.onopen = () => {
      this.tentativa = 0;
      this.definirEstado("conectado");
    };
    ws.onmessage = (e) => this.receber(String(e.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.falharPendentes("conexão caiu");
      this.definirEstado("desconectado");
      if (!this.encerrado) {
        this.tentativa++;
        this.relogio = setTimeout(() => this.abrir(), esperaReconexao(this.tentativa));
      }
    };
  }

  private falharPendentes(motivo: string): void {
    for (const p of this.pendentes.values()) p.rejeitar(new Error(motivo));
    this.pendentes.clear();
  }

  private receber(texto: string): void {
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      return;
    }
    const lida = MensagemDoServico.safeParse(bruto);
    if (!lida.success) return;
    const m = lida.data;
    if (m.tipo === "evento") {
      const schema = EVENTOS[m.nome as NomeEvento];
      const dados = schema ? schema.safeParse(m.dados) : null;
      if (dados?.success) for (const fn of this.ouvintes.get(m.nome) ?? []) fn(dados.data);
      return;
    }
    const pendente = this.pendentes.get(m.id);
    if (!pendente) return;
    this.pendentes.delete(m.id);
    if (!m.ok) {
      pendente.rejeitar(new Error(m.erro));
      return;
    }
    const saida = METODOS[pendente.metodo].saida.safeParse(m.dados);
    if (saida.success) pendente.resolver(saida.data);
    else pendente.rejeitar(new Error(`resposta fora do contrato em ${pendente.metodo}`));
  }
}
