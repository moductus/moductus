import type {
  AtividadeAgente,
  Execucao,
  FalhaProvedor,
  MotivoSono,
  SituacaoAgente,
  TipoGatilho,
} from "@moductus/contrato";
import { novoId } from "../banco/ulid.ts";
import type { Autorizar, Catalogo, EscopoAgente } from "../ferramentas/catalogo.ts";
import type {
  ChamadaDeFerramenta,
  ConfigProvedor,
  EventoAgente,
  MensagemModelo,
  ResultadoDeFerramenta,
} from "../provedores/provedor.ts";
import { sonoDaFalha } from "../provedores/provedor.ts";
import type { RegistroProvedores } from "../provedores/registro.ts";
import type { AgenteGuardado, RepositorioAgentes } from "./agentes.ts";
import type { AutorizarComCartao } from "./autorizar.ts";
import type { FimExecucao, RepositorioExecucoes } from "./execucoes.ts";
import { FilaPorAgente } from "./fila.ts";
import { historicoCurto, montarInstrucoes, resumir } from "./pedido.ts";

/**
 * O runtime dos agentes (AGENTS.md §1 e §6): um só para todos, porque agente é configuração. Para
 * cada pedido, monta o que vai ao modelo (instruções com a voz da família, as ferramentas do
 * escopo do agente e o histórico curto), espera a vez na fila do agente, roda pelo provedor
 * escolhido e registra a execução e cada ferramenta chamada. Agentes diferentes rodam em paralelo.
 *
 * Dormir, pausar e o provedor reserva são da F2-16: aqui a falha do provedor é registrada e volta
 * no resultado com o sono que ela pede.
 */

export interface PedidoExecucao {
  agenteId: string;
  gatilho: TipoGatilho;
  /** A conversa até aqui, a última fala por último; o runtime manda só o histórico curto. */
  mensagens: readonly MensagemModelo[];
  /** Sessão do provedor a continuar (`--resume`); devolvida no resultado da execução anterior. */
  continuarDe?: string | null;
  /** Cada evento do provedor, na hora, para a conversa mostrar a resposta em streaming. */
  aoEvento?: (evento: EventoAgente, execucaoId: string) => void;
  /** Cancela a execução, ou tira o pedido da fila se ainda não chegou a vez. */
  sinal?: AbortSignal;
}

/** Por que o agente deve dormir depois desta execução, e até quando (`null`: até o provedor voltar). */
export interface SonoPedido {
  motivo: MotivoSono;
  ate: string | null;
}

export interface ResultadoExecucao {
  execucao: Execucao;
  /** A resposta inteira, para quem não acompanhou o streaming. */
  texto: string;
  /** O que passar em `continuarDe` para seguir a mesma sessão do provedor. */
  continuacao: string | null;
  falha: FalhaProvedor | null;
  sono: SonoPedido | null;
}

export interface AvisosRuntime {
  /** A execução começou ou terminou. */
  execucao: (execucao: Execucao) => void;
  /** Mudou o que o agente está fazendo: fila, trabalhando, esperando você, erro. */
  agente: (agenteId: string) => void;
}

/** Custo estimado em microdólares; `null` quando não há número honesto (assinatura, sem preço). */
export type EstimarCusto = (
  provedor: ConfigProvedor,
  uso: { tokensEntrada: number; tokensSaida: number },
) => number | null;

export interface DependenciasRuntime {
  agentes: RepositorioAgentes;
  execucoes: RepositorioExecucoes;
  provedores: RegistroProvedores;
  catalogo: Catalogo;
  /** Quem dá o sim das ações `externo`; sem ele, toda ação `externo` é recusada. */
  autorizar?: AutorizarComCartao;
}

export interface OpcoesRuntime {
  agora?: () => Date;
  gerarId?: () => string;
  /** A tabela de preços entra pela F2-09; até lá, nenhum custo é inventado. */
  estimarCusto?: EstimarCusto;
}

export const MENSAGEM_SEM_MODELO = (nome: string) =>
  `Nenhum modelo escolhido para ${nome}. Escolha um em Configurações › Modelos.`;

export const MENSAGEM_CANCELADA = "Execução cancelada.";

/** O executor de ferramentas de uma execução em andamento. */
export type ExecutorDeFerramentas = (chamada: ChamadaDeFerramenta) => Promise<ResultadoDeFerramenta>;

interface Ativa {
  agenteId: string;
  executar: ExecutorDeFerramentas;
}

export class Runtime {
  private readonly fila: FilaPorAgente;
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly estimarCusto: EstimarCusto;
  /** Execuções rodando agora, pelo id: o MCP do Moductus executa as ferramentas do CLI por aqui. */
  private readonly ativas = new Map<string, Ativa>();
  /** Cartões de cada agente esperando o usuário. */
  private readonly cartoes = new Map<string, number>();
  /** Agentes cuja última execução falhou; sai na próxima que der certo. */
  private readonly comErro = new Set<string>();

  constructor(
    private readonly deps: DependenciasRuntime,
    private readonly avisos: AvisosRuntime,
    opcoes: OpcoesRuntime = {},
  ) {
    this.fila = new FilaPorAgente((agenteId) => this.avisos.agente(agenteId));
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.estimarCusto = opcoes.estimarCusto ?? (() => null);
  }

  /**
   * Põe o pedido na fila do agente e devolve a execução registrada quando ela termina. Falha do
   * provedor, exceção e cancelamento durante a execução terminam registrados, sem lançar; só o
   * agente que não existe e o cancelamento antes da vez lançam (não chegou a haver execução).
   */
  async executar(pedido: PedidoExecucao): Promise<ResultadoExecucao> {
    if (!this.deps.agentes.agente(pedido.agenteId)) throw new Error("agente não encontrado");
    return this.fila.rodar(pedido.agenteId, () => this.rodar(pedido), pedido.sinal);
  }

  /** O que o agente está fazendo agora, com o estado guardado no banco. */
  situacao(agente: AgenteGuardado): SituacaoAgente {
    return {
      estado: agente.estado,
      atividade: this.atividade(agente.id),
      motivoSono: null,
      dormeAte: agente.dormeAte,
      pausadoAte: null,
      fila: this.fila.esperandoDe(agente.id),
    };
  }

  /**
   * O executor de ferramentas de uma execução que está rodando, com escopo, aprovação e registro;
   * `null` se ela já terminou. É por aqui que o MCP do Moductus atende as chamadas do CLI.
   */
  executorDaExecucao(execucaoId: string): ExecutorDeFerramentas | null {
    return this.ativas.get(execucaoId)?.executar ?? null;
  }

  private atividade(agenteId: string): AtividadeAgente {
    if ((this.cartoes.get(agenteId) ?? 0) > 0) return "esperando";
    for (const ativa of this.ativas.values()) if (ativa.agenteId === agenteId) return "trabalhando";
    return this.comErro.has(agenteId) ? "erro" : "ocioso";
  }

  private async rodar(pedido: PedidoExecucao): Promise<ResultadoExecucao> {
    // Lido de novo na vez: configuração mudada enquanto esperava vale nesta execução.
    const agente = this.deps.agentes.agente(pedido.agenteId);
    if (!agente) throw new Error("agente não encontrado");
    const sinal = pedido.sinal ?? new AbortController().signal;
    const config = agente.provedorId ? this.deps.agentes.provedor(agente.provedorId) : null;
    const id = this.gerarId();
    this.deps.execucoes.iniciar({
      id,
      agenteId: agente.id,
      gatilho: pedido.gatilho,
      provedorId: config?.id ?? null,
      inicio: this.agora().toISOString(),
    });

    const escopo = this.deps.catalogo.doAgente(agente.ferramentas);
    const executar = this.executorRegistrando(agente.id, id, escopo, sinal);
    this.ativas.set(id, { agenteId: agente.id, executar });
    this.avisar(id, agente.id);

    let texto = "";
    let tokens: { entrada: number; saida: number } | null = null;
    let continuacao: string | null = null;
    let falha: FalhaProvedor | null = null;
    let sono: SonoPedido | null = null;
    let fim: Omit<FimExecucao, "fim" | "tokensEntrada" | "tokensSaida" | "custoEstimadoMicrodolares">;
    try {
      if (!config) {
        sono = { motivo: "sem_modelo", ate: null };
        fim = { estado: "erro", erro: MENSAGEM_SEM_MODELO(agente.nome), resumo: null };
      } else {
        const provedor = this.deps.provedores.obter(config);
        const eventos = provedor.executar(
          {
            agenteId: agente.id,
            execucaoId: id,
            instrucoes: montarInstrucoes(agente),
            mensagens: historicoCurto(pedido.mensagens),
            ferramentas: escopo.oferecidas(),
            executarFerramenta: executar,
            continuarDe: pedido.continuarDe ?? null,
          },
          sinal,
        );
        for await (const evento of eventos) {
          if (evento.tipo === "texto") texto += evento.texto;
          else if (evento.tipo === "uso") {
            tokens ??= { entrada: 0, saida: 0 };
            tokens.entrada += evento.tokensEntrada;
            tokens.saida += evento.tokensSaida;
          } else if (evento.tipo === "fim") continuacao = evento.continuacao;
          else if (evento.tipo === "erro") falha = evento.falha;
          repassar(pedido, evento, id);
        }
        if (falha) {
          sono = sonoDaFalha(falha);
          fim = { estado: "erro", erro: falha.mensagem, resumo: null };
        } else {
          fim = { estado: "ok", erro: null, resumo: resumir(texto) };
        }
      }
    } catch (erro) {
      const mensagem = sinal.aborted
        ? MENSAGEM_CANCELADA
        : erro instanceof Error
          ? erro.message
          : String(erro);
      fim = { estado: "erro", erro: mensagem, resumo: resumir(texto) };
    } finally {
      this.ativas.delete(id);
    }

    const custo =
      config && tokens
        ? this.estimarCusto(config, { tokensEntrada: tokens.entrada, tokensSaida: tokens.saida })
        : null;
    this.deps.execucoes.terminar(id, {
      ...fim,
      fim: this.agora().toISOString(),
      tokensEntrada: tokens?.entrada ?? null,
      tokensSaida: tokens?.saida ?? null,
      custoEstimadoMicrodolares: custo,
    });
    // Cancelado pelo usuário não é erro do agente.
    if (fim.estado === "ok" || sinal.aborted) this.comErro.delete(agente.id);
    else this.comErro.add(agente.id);
    const execucao = this.avisar(id, agente.id);
    return { execucao, texto, continuacao, falha, sono };
  }

  /**
   * O `executarFerramenta` da execução: o do escopo do agente, com o cartão para `externo`, e cada
   * chamada a uma ferramenta do escopo registrada com entrada, resultado e o cartão que a liberou.
   * Nome fora do escopo não é registrado: não há ferramenta nem efeito a mostrar.
   */
  private executorRegistrando(
    agenteId: string,
    execucaoId: string,
    escopo: EscopoAgente,
    sinal: AbortSignal,
  ): ExecutorDeFerramentas {
    const contexto = { agenteId, execucaoId, sinal };
    return async (chamada) => {
      let aprovacaoId: string | null = null;
      const autorizarComCartao = this.deps.autorizar;
      const autorizar: Autorizar | undefined =
        autorizarComCartao &&
        (async (pedidoAutorizacao) => {
          let esperando = false;
          try {
            return await autorizarComCartao(pedidoAutorizacao, (aprovacao) => {
              aprovacaoId = aprovacao.id;
              esperando = true;
              this.contarCartao(agenteId, 1);
            });
          } finally {
            if (esperando) this.contarCartao(agenteId, -1);
          }
        });
      const resultado = await escopo.executor(contexto, autorizar)(chamada);
      const ferramenta = escopo.obter(chamada.nome);
      if (ferramenta) {
        this.deps.execucoes.registrarChamada({
          id: this.gerarId(),
          execucaoId,
          agenteId,
          ferramenta: ferramenta.nome,
          efeito: ferramenta.efeito,
          entrada: chamada.entrada,
          resultado,
          aprovacaoId,
          agora: this.agora().toISOString(),
        });
      }
      return resultado;
    };
  }

  private contarCartao(agenteId: string, delta: number): void {
    const n = (this.cartoes.get(agenteId) ?? 0) + delta;
    if (n > 0) this.cartoes.set(agenteId, n);
    else this.cartoes.delete(agenteId);
    this.avisos.agente(agenteId);
  }

  private avisar(execucaoId: string, agenteId: string): Execucao {
    const execucao = this.deps.execucoes.execucao(execucaoId);
    if (!execucao) throw new Error(`execução ${execucaoId} sumiu do banco`);
    this.avisos.execucao(execucao);
    this.avisos.agente(agenteId);
    return execucao;
  }
}

/** O streaming é de quem pediu: um erro dele não derruba a execução. */
function repassar(pedido: PedidoExecucao, evento: EventoAgente, execucaoId: string): void {
  if (!pedido.aoEvento) return;
  try {
    pedido.aoEvento(evento, execucaoId);
  } catch (erro) {
    console.error(`aoEvento da execução ${execucaoId} falhou: ${String(erro)}`);
  }
}
