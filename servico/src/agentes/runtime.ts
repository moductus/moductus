import type {
  AtividadeAgente,
  Execucao,
  FalhaProvedor,
  MotivoSono,
  SituacaoAgente,
  TipoGatilho,
} from "@moductus/contrato";
import type { ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
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
import { estimarCusto, type CustoExecucao, type UsoDeChamada } from "../provedores/precos.ts";
import type { RegistroProvedores } from "../provedores/registro.ts";
import type { AgenteGuardado, RepositorioAgentes } from "./agentes.ts";
import type { AutorizarComCartao } from "./autorizar.ts";
import { EstadosAgentes, type ConverterCusto } from "./estado.ts";
import type { FimExecucao, RepositorioExecucoes } from "./execucoes.ts";
import { FilaPorAgente } from "./fila.ts";
import { historicoCurto, montarInstrucoes, resumir } from "./pedido.ts";

/**
 * O runtime dos agentes (AGENTS.md §1 e §6): um só para todos, porque agente é configuração. Para
 * cada pedido, monta o que vai ao modelo (instruções com a voz da família, as ferramentas do
 * escopo do agente e o histórico curto), espera a vez na fila do agente, roda pelo provedor
 * escolhido e registra a execução e cada ferramenta chamada. Agentes diferentes rodam em paralelo.
 *
 * Na vez, o pedido ainda espera o agente poder chamar o modelo (estado.ts): dormindo ou pausado,
 * fica na frente da fila até ele acordar ou retomar. A falha do provedor põe o agente para dormir,
 * ou, com provedor reserva, manda os pedidos à reserva (e o mesmo pedido, se o principal não chegou
 * a fazer nada).
 */

export interface PedidoExecucao {
  agenteId: string;
  gatilho: TipoGatilho;
  /** A conversa até aqui, a última fala por último; o runtime manda só o histórico curto. */
  mensagens: readonly MensagemModelo[];
  /** Sessão do provedor a continuar (`--resume`); devolvida no resultado da execução anterior. */
  continuarDe?: string | null;
  /**
   * A conversa inteira, para quando `continuarDe` não vale: a sessão é do provedor principal, e na
   * reserva o pedido começa outra. Sem ele, valem as `mensagens`.
   */
  mensagensSemSessao?: readonly MensagemModelo[];
  /**
   * Prompt de sistema no lugar das instruções do agente, para um trabalho curto que não é a voz
   * dele (o classificador do roteamento roda no modelo da Alba).
   */
  instrucoes?: string;
  /** Nenhuma ferramenta oferecida: o modelo só responde texto. */
  semFerramentas?: boolean;
  /**
   * Roda já, sem esperar a vez do agente nem tomar a dele, no runtime e no adaptador: para um
   * trabalho curto que não pode ficar atrás de uma resposta longa (o classificador do roteamento).
   */
  foraDaFila?: boolean;
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
  /**
   * O que passar em `continuarDe` para seguir a mesma sessão do provedor. Na reserva é sempre
   * `null`: a próxima vez pode ser no principal, que não conhece a sessão da reserva.
   */
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

/**
 * Como o uso é pago e o custo estimado em microdólares, pelas chamadas ao modelo; custo `null`
 * quando não há número honesto (assinatura, modelo sem preço).
 */
export type EstimarCusto = (provedor: ConfigProvedor, usos: readonly UsoDeChamada[]) => CustoExecucao;

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
  /** Sem ele, a tabela de preços do serviço (provedores/precos.ts). */
  estimarCusto?: EstimarCusto;
  /** O despertador de quem dorme ou está pausado; o teste troca pelo relógio falso. */
  programar?: (fazer: () => void, ms: number) => () => void;
  /** Câmbio do custo para a moeda do teto diário; sem ele, o teto não vale (estado.ts). */
  emCentavos?: ConverterCusto;
}

export const MENSAGEM_SEM_MODELO = (nome: string) =>
  `Nenhum modelo escolhido para ${nome}. Escolha um em Configurações › Modelos.`;

export const MENSAGEM_CANCELADA = "Execução cancelada.";

export const MENSAGEM_INTERROMPIDA = "O serviço parou no meio da execução. Nada mais foi feito.";

/**
 * Na subida: o que ficou `rodando` é de um serviço que parou no meio (caiu, o PC desligou). Ninguém
 * mais vai terminar essas execuções, então fecham como erro, e os cartões que elas deixaram no dock
 * expiram, porque não há quem rode a ação com o sim. Devolve os ids das execuções fechadas.
 */
export function encerrarInterrompidas(
  execucoes: RepositorioExecucoes,
  aprovacoes: Pick<ServicoAprovacoes, "expirar">,
  agora: Date = new Date(),
): string[] {
  const interrompidas = execucoes.encerrarInterrompidas(agora.toISOString(), MENSAGEM_INTERROMPIDA);
  for (const cartao of interrompidas.cartoes) aprovacoes.expirar(cartao);
  return interrompidas.execucoes;
}

/** O executor de ferramentas de uma execução em andamento. */
export type ExecutorDeFerramentas = (chamada: ChamadaDeFerramenta) => Promise<ResultadoDeFerramenta>;

interface Ativa {
  agenteId: string;
  executar: ExecutorDeFerramentas;
}

export class Runtime {
  /** Ativo, pausado, dormindo, desligado: quem decide se a vez do agente pode chamar o modelo. */
  readonly estados: EstadosAgentes;
  private readonly fila: FilaPorAgente;
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly estimarCusto: EstimarCusto;
  /** Execuções rodando agora, pelo id: o MCP do Moductus executa as ferramentas do CLI por aqui. */
  private readonly ativas = new Map<string, Ativa>();
  /** Cartões de cada agente esperando o usuário. */
  private readonly cartoes = new Map<string, number>();

  constructor(
    private readonly deps: DependenciasRuntime,
    private readonly avisos: AvisosRuntime,
    opcoes: OpcoesRuntime = {},
  ) {
    this.fila = new FilaPorAgente((agenteId) => this.avisos.agente(agenteId));
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.estimarCusto = opcoes.estimarCusto ?? estimarCusto;
    this.estados = new EstadosAgentes(
      { agentes: deps.agentes, execucoes: deps.execucoes },
      {
        agora: this.agora,
        aoMudar: (agenteId) => this.avisos.agente(agenteId),
        ...(opcoes.programar ? { programar: opcoes.programar } : {}),
        ...(opcoes.emCentavos ? { emCentavos: opcoes.emCentavos } : {}),
      },
    );
  }

  /**
   * Põe o pedido na fila do agente e devolve a execução registrada quando ela termina. Falha do
   * provedor, exceção e cancelamento durante a execução terminam registrados, sem lançar; só o
   * agente que não existe ou está desligado e o cancelamento antes da vez lançam (não chegou a
   * haver execução). Dormindo ou pausado, o pedido espera o agente acordar ou retomar.
   */
  async executar(pedido: PedidoExecucao): Promise<ResultadoExecucao> {
    if (!this.deps.agentes.agente(pedido.agenteId)) throw new Error("agente não encontrado");
    if (pedido.foraDaFila) {
      pedido.sinal?.throwIfAborted();
      return this.rodar(pedido);
    }
    return this.fila.rodar(pedido.agenteId, () => this.rodar(pedido), pedido.sinal);
  }

  /**
   * O que o agente está fazendo agora, com o estado guardado no banco. Ligado e sem modelo, ele
   * aparece dormindo sem hora, pelo motivo `sem_modelo`: não há o que acordá-lo além de escolher um.
   * A fila conta também o pedido que espera na porta o sono ou a pausa acabar.
   */
  situacao(agente: AgenteGuardado): SituacaoAgente {
    const semModelo = agente.estado === "ativo" && agente.provedorId === null;
    return {
      estado: semModelo ? "dormindo" : agente.estado,
      atividade: this.atividade(agente.id),
      motivoSono: semModelo ? "sem_modelo" : agente.estado === "dormindo" ? agente.motivoSono : null,
      dormeAte: agente.dormeAte,
      pausadoAte: agente.pausadoAte,
      fila: this.fila.esperandoDe(agente.id) + this.estados.naPorta(agente.id),
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
    // Pelo banco, para valer também depois de reiniciar. Cancelado pelo usuário não é erro do agente.
    const ultima = this.deps.execucoes.ultimaTerminada(agenteId);
    return ultima?.estado === "erro" && ultima.erro !== MENSAGEM_CANCELADA ? "erro" : "ocioso";
  }

  private async rodar(pedido: PedidoExecucao): Promise<ResultadoExecucao> {
    // Lido de novo na vez, depois do sono ou da pausa: configuração mudada enquanto esperava vale aqui.
    const agente = await this.estados.esperarVez(pedido.agenteId, pedido.sinal);
    const principal = agente.provedorId ? this.deps.agentes.provedor(agente.provedorId) : null;
    const reserva =
      principal && agente.provedorReservaId ? this.deps.agentes.provedor(agente.provedorReservaId) : null;
    const naReserva = reserva !== null && this.estados.naReserva(agente.id);
    let tentativa = naReserva
      ? await this.tentar(pedido, agente, reserva, true)
      : await this.tentar(pedido, agente, principal, false);
    const sono = tentativa.resultado.sono;
    if (!naReserva && reserva && sono) {
      // O principal falhou e há reserva: o agente não dorme, os próximos pedidos vão a ela. Este
      // vai também, numa execução própria, se o principal não chegou a responder nem agir.
      this.estados.principalFalhou(agente.id, sono);
      if (tentativa.agiu || pedido.sinal?.aborted) {
        this.estados.depoisDaExecucao(agente.id, null, false);
        return tentativa.resultado;
      }
      tentativa = await this.tentar(pedido, agente, reserva, true);
    }
    const { resultado } = tentativa;
    this.estados.depoisDaExecucao(agente.id, resultado.sono, resultado.execucao.estado === "ok");
    return resultado;
  }

  /**
   * Uma execução registrada pelo provedor dado. `agiu` diz se o provedor chegou a responder texto
   * ou chamar ferramenta: só o que não agiu pode ser repetido na reserva. Na reserva, o pedido não
   * continua a sessão do principal: vai com a conversa inteira e não devolve continuação.
   */
  private async tentar(
    pedido: PedidoExecucao,
    agente: AgenteGuardado,
    config: ConfigProvedor | null,
    naReserva: boolean,
  ): Promise<{ resultado: ResultadoExecucao; agiu: boolean }> {
    const sinal = pedido.sinal ?? new AbortController().signal;
    const id = this.gerarId();
    this.deps.execucoes.iniciar({
      id,
      agenteId: agente.id,
      gatilho: pedido.gatilho,
      provedorId: config?.id ?? null,
      inicio: this.agora().toISOString(),
    });

    const escopo = this.deps.catalogo.doAgente(agente.ferramentas);
    // As ferramentas param também quando a execução termina: uma chamada que o provedor largou no
    // meio (o CLI caiu ou desistiu esperando o cartão) não pode rodar com um sim dado depois. O
    // cartão dela expira.
    const encerramento = new AbortController();
    const executar = this.executorRegistrando(
      agente.id,
      id,
      escopo,
      AbortSignal.any([sinal, encerramento.signal]),
    );

    let texto = "";
    let agiu = false;
    let tokens: { entrada: number; saida: number } | null = null;
    // Cada chamada ao modelo, para o custo sair pelo preço de cada uma (modelo, cache, faixa).
    const usos: UsoDeChamada[] = [];
    let continuacao: string | null = null;
    let falha: FalhaProvedor | null = null;
    let sono: SonoPedido | null = null;
    let fim: Omit<
      FimExecucao,
      "fim" | "tokensEntrada" | "tokensSaida" | "custoEstimadoMicrodolares" | "cobranca"
    >;
    try {
      // Dentro do try: se avisar falhar, a execução ainda termina registrada e sai das ativas.
      this.ativas.set(id, { agenteId: agente.id, executar });
      this.avisar(id, agente.id);
      if (!config) {
        sono = { motivo: "sem_modelo", ate: null };
        fim = { estado: "erro", erro: MENSAGEM_SEM_MODELO(agente.nome), resumo: null };
      } else {
        const provedor = this.deps.provedores.obter(config);
        const eventos = provedor.executar(
          {
            agenteId: agente.id,
            execucaoId: id,
            instrucoes: pedido.instrucoes ?? montarInstrucoes(agente),
            mensagens: historicoCurto(
              naReserva ? (pedido.mensagensSemSessao ?? pedido.mensagens) : pedido.mensagens,
            ),
            ferramentas: pedido.semFerramentas ? [] : escopo.oferecidas(),
            executarFerramenta: executar,
            continuarDe: naReserva ? null : (pedido.continuarDe ?? null),
            // Fora da fila, a execução é a própria fila no adaptador: não espera nem segura ninguém.
            ...(pedido.foraDaFila ? { fila: id } : {}),
          },
          sinal,
        );
        for await (const evento of eventos) {
          if (evento.tipo === "texto" || evento.tipo === "ferramenta") agiu = true;
          if (evento.tipo === "texto") texto += evento.texto;
          else if (evento.tipo === "uso") {
            tokens ??= { entrada: 0, saida: 0 };
            tokens.entrada += evento.tokensEntrada;
            tokens.saida += evento.tokensSaida;
            usos.push(evento);
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
      fim = { estado: "erro", erro: mensagemDe(erro, sinal), resumo: resumir(texto) };
    } finally {
      this.ativas.delete(id);
      encerramento.abort(new Error("A execução terminou."));
    }

    // Com provedor, a execução diz como é paga mesmo sem tokens: a assinatura fica marcada.
    const custo = config ? this.estimarCusto(config, usos) : null;
    this.deps.execucoes.terminar(id, {
      ...fim,
      fim: this.agora().toISOString(),
      tokensEntrada: tokens?.entrada ?? null,
      tokensSaida: tokens?.saida ?? null,
      custoEstimadoMicrodolares: custo?.custoEstimadoMicrodolares ?? null,
      cobranca: custo?.cobranca ?? null,
    });
    const execucao = this.avisar(id, agente.id);
    return {
      resultado: { execucao, texto, continuacao: naReserva ? null : continuacao, falha, sono },
      agiu,
    };
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
      // A data da chamada é a de quando o modelo pediu, não a de quando a área terminou.
      const instante = this.agora().toISOString();
      const ferramenta = escopo.obter(chamada.nome);
      // Cancelada antes de começar, não houve chamada: o executor lança sem rodar nada.
      const comecou = !sinal.aborted;
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
      const registrar = (resultado: ResultadoDeFerramenta) => {
        if (!ferramenta) return;
        this.deps.execucoes.registrarChamada({
          id: this.gerarId(),
          execucaoId,
          agenteId,
          ferramenta: ferramenta.nome,
          efeito: ferramenta.efeito,
          entrada: chamada.entrada,
          resultado,
          aprovacaoId,
          agora: instante,
        });
      };
      let resultado: ResultadoDeFerramenta;
      try {
        resultado = await escopo.executor(contexto, autorizar)(chamada);
      } catch (erro) {
        // Cancelada no meio (esperando o cartão ou dentro da área): fica no histórico o que começou.
        if (comecou) registrar({ ok: false, erro: mensagemDe(erro, sinal) });
        throw erro;
      }
      registrar(resultado);
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

/** O que fica registrado de uma exceção; cancelamento diz que foi cancelado, não o motivo técnico. */
function mensagemDe(erro: unknown, sinal: AbortSignal): string {
  if (sinal.aborted) return MENSAGEM_CANCELADA;
  return erro instanceof Error ? erro.message : String(erro);
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
