import type { DatabaseSync } from "node:sqlite";
import type {
  ChamadaFerramenta,
  Cobranca,
  Efeito,
  EstadoExecucao,
  Execucao,
  ExecucaoDetalhada,
  MotivoFalhaProvedor,
  PaginaExecucoes,
  PedidoDesfazer,
  PedidoExecucao,
  PedidoExecucoes,
  TipoGatilho,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../banco/tabela.ts";
import type { Catalogo } from "../ferramentas/catalogo.ts";
import { RecusaDesfazer, type Ferramenta } from "../ferramentas/ferramenta.ts";
import { MENSAGEM_CANCELADA } from "./runtime.ts";

/**
 * O histórico do que os agentes fizeram (AGENTS.md §6 "Agendador e execuções"; DATA.md §6
 * execucoes e chamadas_ferramenta): cada execução com gatilho, provedor, tokens, custo, duração e
 * resumo, e cada ferramenta que ela chamou. O histórico do agente no Sistema lê daqui.
 */

interface LinhaExecucao {
  id: string;
  do_agente_id: string;
  gatilho: TipoGatilho;
  provedor_id: string | null;
  inicio: string | null;
  fim: string | null;
  estado: EstadoExecucao;
  erro: string | null;
  falha_do_provedor: MotivoFalhaProvedor | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_estimado_microdolares: number | null;
  cobranca: Cobranca | null;
  resumo: string | null;
}

const COLUNAS_EXECUCAO = `id, do_agente_id, gatilho, provedor_id, inicio, fim, estado, erro, falha_do_provedor,
  tokens_entrada, tokens_saida, custo_estimado_microdolares, cobranca, resumo`;

const paraExecucao = (l: LinhaExecucao): Execucao => ({
  id: l.id,
  agenteId: l.do_agente_id,
  gatilho: l.gatilho,
  provedorId: l.provedor_id,
  inicio: l.inicio,
  fim: l.fim,
  estado: l.estado,
  erro: l.erro,
  falhaDoProvedor: l.falha_do_provedor,
  tokensEntrada: l.tokens_entrada,
  tokensSaida: l.tokens_saida,
  custoEstimadoMicrodolares: l.custo_estimado_microdolares,
  cobranca: l.cobranca,
  resumo: l.resumo,
});

interface LinhaChamada {
  id: string;
  da_execucao_id: string | null;
  ferramenta: string;
  efeito: Efeito;
  entrada: string;
  resultado: string | null;
  aprovacao_id: string | null;
  criado_em: string;
  desfeita_em: string | null;
}

const paraChamada = (l: LinhaChamada): ChamadaFerramenta => ({
  id: l.id,
  execucaoId: l.da_execucao_id,
  ferramenta: l.ferramenta,
  efeito: l.efeito,
  entrada: JSON.parse(l.entrada) as unknown,
  resultado: l.resultado === null ? null : (JSON.parse(l.resultado) as unknown),
  aprovacaoId: l.aprovacao_id,
  criadoEm: l.criado_em,
  desfeitaEm: l.desfeita_em,
  // O prazo depende do catálogo: quem preenche é o ServicoExecucoes.
  desfazerAte: null,
});

/** Uma chamada com o agente da execução que a fez, para desfazer. */
export interface ChamadaGuardada {
  chamada: ChamadaFerramenta;
  agenteId: string | null;
}

export interface NovaExecucao {
  id: string;
  agenteId: string;
  gatilho: TipoGatilho;
  provedorId: string | null;
  inicio: string;
}

/**
 * Como a execução terminou; tokens e custo vazios quando não há número honesto, e a cobrança
 * dizendo se o custo vazio é assinatura ou modelo sem preço (vazia sem provedor).
 */
export interface FimExecucao {
  fim: string;
  estado: Exclude<EstadoExecucao, "rodando">;
  erro: string | null;
  /** O motivo, quando o erro foi do provedor (o classificador dele); vazio em erro de outra causa. */
  falhaDoProvedor: MotivoFalhaProvedor | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoEstimadoMicrodolares: number | null;
  cobranca: Cobranca | null;
  resumo: string | null;
}

export interface NovaChamada {
  id: string;
  execucaoId: string;
  agenteId: string;
  ferramenta: string;
  efeito: Efeito;
  entrada: unknown;
  resultado: unknown;
  aprovacaoId: string | null;
  agora: string;
}

/** Quantas execuções uma página traz quando o pedido não diz. */
const PAGINA_PADRAO = 50;

export class RepositorioExecucoes {
  constructor(private readonly db: DatabaseSync) {}

  /** A execução entra rodando, carimbada pelo agente que trabalha nela. */
  iniciar(e: NovaExecucao): void {
    const origem = colunasDeOrigem(carimboDa(e.agenteId, e.id));
    this.db
      .prepare(
        `INSERT INTO execucoes (id, do_agente_id, gatilho, provedor_id, inicio, estado,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, 'rodando', ?, ?, ?, ?, ?)`,
      )
      .run(
        e.id,
        e.agenteId,
        e.gatilho,
        e.provedorId,
        e.inicio,
        e.inicio,
        e.inicio,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  terminar(id: string, f: FimExecucao): void {
    this.db
      .prepare(
        `UPDATE execucoes
            SET fim = ?, estado = ?, erro = ?, falha_do_provedor = ?, tokens_entrada = ?, tokens_saida = ?,
                custo_estimado_microdolares = ?, cobranca = ?, resumo = ?, atualizado_em = ?
          WHERE id = ?`,
      )
      .run(
        f.fim,
        f.estado,
        f.erro,
        f.falhaDoProvedor,
        f.tokensEntrada,
        f.tokensSaida,
        f.custoEstimadoMicrodolares,
        f.cobranca,
        f.resumo,
        f.fim,
        id,
      );
  }

  registrarChamada(c: NovaChamada): void {
    const origem = colunasDeOrigem(carimboDa(c.agenteId, c.execucaoId));
    this.db
      .prepare(
        `INSERT INTO chamadas_ferramenta (id, da_execucao_id, ferramenta, efeito, entrada, resultado,
           aprovacao_id, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.execucaoId,
        c.ferramenta,
        c.efeito,
        emJson(c.entrada),
        emJson(c.resultado),
        c.aprovacaoId,
        c.agora,
        c.agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /**
   * Fecha como erro as execuções que ficaram `rodando` porque o serviço parou no meio, e devolve
   * os cartões do Moductus que elas deixaram pendentes, para expirar.
   */
  encerrarInterrompidas(agora: string, erro: string): { execucoes: string[]; cartoes: string[] } {
    const ids = (
      this.db.prepare("SELECT id FROM execucoes WHERE estado = 'rodando' ORDER BY id").all() as unknown as {
        id: string;
      }[]
    ).map((l) => l.id);
    if (ids.length === 0) return { execucoes: [], cartoes: [] };
    const cartoes = (
      this.db
        .prepare(
          `SELECT a.id FROM aprovacoes a JOIN execucoes e ON e.id = a.da_execucao_id
            WHERE a.estado = 'pendente' AND a.fonte = 'moductus' AND e.estado = 'rodando'
            ORDER BY a.criado_em, a.id`,
        )
        .all() as unknown as { id: string }[]
    ).map((l) => l.id);
    this.db
      .prepare(
        "UPDATE execucoes SET estado = 'erro', erro = ?, fim = ?, atualizado_em = ? WHERE estado = 'rodando'",
      )
      .run(erro, agora, agora);
    return { execucoes: ids, cartoes };
  }

  /** Como terminou a última execução do agente que já terminou; `null` se nenhuma terminou. */
  ultimaTerminada(agenteId: string): { estado: EstadoExecucao; erro: string | null } | null {
    const linha = this.db
      .prepare(
        `SELECT estado, erro FROM execucoes WHERE do_agente_id = ? AND estado IN ('ok', 'erro')
          ORDER BY id DESC LIMIT 1`,
      )
      .get(agenteId) as unknown as { estado: EstadoExecucao; erro: string | null } | undefined;
    return linha ?? null;
  }

  /**
   * Quanto as execuções do agente que começaram desde `desde` custaram, em microdólares: só a
   * estimativa que existe (assinatura e modelo sem preço não somam nada).
   */
  custoDesde(agenteId: string, desde: string): number {
    const linha = this.db
      .prepare(
        `SELECT coalesce(sum(custo_estimado_microdolares), 0) AS total FROM execucoes
          WHERE do_agente_id = ? AND inicio >= ?`,
      )
      .get(agenteId, desde) as unknown as { total: number };
    return linha.total;
  }

  execucao(id: string): Execucao | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_EXECUCAO} FROM execucoes WHERE id = ?`)
      .get(id) as unknown as LinhaExecucao | undefined;
    return linha ? paraExecucao(linha) : null;
  }

  /** Da mais nova para a mais antiga; o ULID ordena pela criação. */
  pagina(pedido: PedidoExecucoes): PaginaExecucoes {
    const limite = pedido.limite ?? PAGINA_PADRAO;
    const filtros: string[] = [];
    const valores: string[] = [];
    if (pedido.agenteId !== undefined) {
      filtros.push("do_agente_id = ?");
      valores.push(pedido.agenteId);
    }
    if (pedido.antesDe !== undefined) {
      filtros.push("id < ?");
      valores.push(pedido.antesDe);
    }
    const onde = filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS_EXECUCAO} FROM execucoes ${onde} ORDER BY id DESC LIMIT ?`)
      .all(...valores, limite + 1) as unknown as LinhaExecucao[];
    const itens = linhas.slice(0, limite).map(paraExecucao);
    return { itens, proximo: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
  }

  /** As ferramentas que a execução chamou, na ordem em que chamou. */
  chamadas(execucaoId: string): ChamadaFerramenta[] {
    const linhas = this.db
      .prepare(
        `SELECT id, da_execucao_id, ferramenta, efeito, entrada, resultado, aprovacao_id, criado_em, desfeita_em
           FROM chamadas_ferramenta WHERE da_execucao_id = ? ORDER BY id`,
      )
      .all(execucaoId) as unknown as LinhaChamada[];
    return linhas.map(paraChamada);
  }

  chamada(id: string): ChamadaGuardada | null {
    const linha = this.db
      .prepare(
        `SELECT c.id, c.da_execucao_id, c.ferramenta, c.efeito, c.entrada, c.resultado, c.aprovacao_id,
                c.criado_em, c.desfeita_em, e.do_agente_id
           FROM chamadas_ferramenta c LEFT JOIN execucoes e ON e.id = c.da_execucao_id
          WHERE c.id = ?`,
      )
      .get(id) as unknown as (LinhaChamada & { do_agente_id: string | null }) | undefined;
    return linha ? { chamada: paraChamada(linha), agenteId: linha.do_agente_id } : null;
  }

  /**
   * Marca a chamada como desfeita. Quem desfez foi o usuário: o carimbo passa a ser dele (DATA.md
   * §1). Devolve `false` se ela já estava desfeita.
   */
  marcarDesfeita(id: string, agora: string): boolean {
    const origem = colunasDeOrigem(DO_USUARIO);
    const r = this.db
      .prepare(
        `UPDATE chamadas_ferramenta
            SET desfeita_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND desfeita_em IS NULL`,
      )
      .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
    return r.changes > 0;
  }

  /** A inversa e a marca de desfeita entram juntas ou nenhuma entra. */
  transacao<T>(fazer: () => T): T {
    this.db.exec("BEGIN");
    try {
      const resultado = fazer();
      this.db.exec("COMMIT");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/**
 * Por quanto tempo o que o agente fez dentro do Moductus se desfaz pelo histórico. O mesmo "dá
 * para desfazer até amanhã" dos quadros (Fechamento, PreviaFaina): um dia inteiro para notar.
 */
export const PRAZO_DESFAZER_MS = 24 * 60 * 60 * 1000;

export const MENSAGENS_DESFAZER = {
  naoEncontrada: "chamada não encontrada",
  leitura: "Uma leitura não muda nada: não há o que desfazer.",
  externo: "Ação fora do Moductus não se desfaz pelo histórico.",
  falhou: "A chamada não deu certo e não mudou nada: não há o que desfazer.",
  cancelada: "A execução foi cancelada no meio; confira o que ficou.",
  rodando: "O agente ainda está trabalhando nisso. Dá para desfazer quando ele terminar.",
  jaDesfeita: (quando: string) => `Já foi desfeita em ${quando}.`,
  semFerramenta: (nome: string) => `${nome} não existe mais nesta versão do Moductus: não dá para desfazer.`,
  ferramentaMudou: (nome: string) => `${nome} mudou desde a chamada e não se desfaz mais pelo histórico.`,
  foraDoPrazo: (quando: string) =>
    `O prazo para desfazer é de ${PRAZO_DESFAZER_MS / 3_600_000} horas e acabou em ${quando}.`,
  areaRecusou: (motivo: string) => `Não deu para desfazer: ${motivo}`,
  falhaInterna: "Não deu para desfazer por um erro interno. Nada mudou.",
} as const;

export interface OpcoesExecucoes {
  agora?: () => Date;
  /** Fuso das datas nas mensagens; o padrão é o do PC. */
  fuso?: string;
  /** Uma chamada da execução foi desfeita: quem mostra o histórico relê. */
  mudou?: (execucao: Execucao) => void;
}

/**
 * O histórico como a interface pede: `execucoes.listar`, `execucoes.obter` e `execucoes.desfazer`.
 * Desfazer roda a função inversa da ferramenta (AGENTS.md §4): só chamada `interno` que deu certo,
 * ainda não desfeita e dentro do prazo; fora disso, o erro diz por quê.
 */
export class ServicoExecucoes {
  private readonly agora: () => Date;
  private readonly fuso: string | undefined;

  constructor(
    private readonly repo: RepositorioExecucoes,
    private readonly catalogo: Catalogo,
    private readonly opcoes: OpcoesExecucoes = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.fuso = opcoes.fuso;
  }

  listar(pedido: PedidoExecucoes): PaginaExecucoes {
    return this.repo.pagina(pedido);
  }

  obter(pedido: PedidoExecucao): ExecucaoDetalhada {
    const execucao = this.repo.execucao(pedido.id);
    if (!execucao) throw new Error("execução não encontrada");
    return { ...execucao, chamadas: this.repo.chamadas(execucao.id).map((c) => this.comPrazo(c)) };
  }

  /**
   * Síncrono de ponta a ponta: a inversa e a marca de desfeita rodam numa transação só, e dois
   * pedidos para a mesma chamada não se cruzam (o segundo encontra a chamada já desfeita).
   */
  desfazer(pedido: PedidoDesfazer): ChamadaFerramenta {
    const guardada = this.repo.chamada(pedido.chamadaId);
    if (!guardada) throw new Error(MENSAGENS_DESFAZER.naoEncontrada);
    const { chamada, agenteId } = guardada;
    const ferramenta = this.conferir(chamada);

    this.repo.transacao(() => {
      try {
        ferramenta.desfazer(valorDoResultado(chamada.resultado), {
          chamadaId: chamada.id,
          agenteId,
          execucaoId: chamada.execucaoId,
          carimbo: DO_USUARIO,
        });
      } catch (erro) {
        if (erro instanceof RecusaDesfazer) {
          throw new Error(MENSAGENS_DESFAZER.areaRecusou(erro.message), { cause: erro });
        }
        console.error(`a inversa de ${chamada.ferramenta} falhou na chamada ${chamada.id}: ${String(erro)}`);
        throw new Error(MENSAGENS_DESFAZER.falhaInterna, { cause: erro });
      }
      if (!this.repo.marcarDesfeita(chamada.id, this.agora().toISOString())) {
        // Conferida há pouco e já desfeita: a inversa rodou duas vezes e volta inteira.
        console.error(`a chamada ${chamada.id} já estava desfeita ao marcar; a inversa voltou`);
        const em = this.repo.chamada(chamada.id)?.chamada.desfeitaEm;
        throw new Error(
          em ? MENSAGENS_DESFAZER.jaDesfeita(this.quando(em)) : MENSAGENS_DESFAZER.naoEncontrada,
        );
      }
    });

    const desfeita = this.repo.chamada(chamada.id);
    if (!desfeita) throw new Error(MENSAGENS_DESFAZER.naoEncontrada);
    const execucao = chamada.execucaoId ? this.repo.execucao(chamada.execucaoId) : null;
    if (execucao) this.opcoes.mudou?.(execucao);
    return this.comPrazo(desfeita.chamada);
  }

  /** A ferramenta que desfaz a chamada, ou o erro que diz por que ela não se desfaz. */
  private conferir(chamada: ChamadaFerramenta): Ferramenta {
    if (chamada.desfeitaEm) throw new Error(MENSAGENS_DESFAZER.jaDesfeita(this.quando(chamada.desfeitaEm)));
    if (chamada.efeito === "leitura") throw new Error(MENSAGENS_DESFAZER.leitura);
    if (chamada.efeito === "externo") throw new Error(MENSAGENS_DESFAZER.externo);
    // Cancelada no meio da área, não dá para dizer o que ficou nem desfazer pela metade.
    if (foiCancelada(chamada.resultado)) throw new Error(MENSAGENS_DESFAZER.cancelada);
    if (!deuCerto(chamada.resultado)) throw new Error(MENSAGENS_DESFAZER.falhou);
    const ferramenta = this.catalogo.obter(chamada.ferramenta);
    if (!ferramenta) throw new Error(MENSAGENS_DESFAZER.semFerramenta(chamada.ferramenta));
    if (!ferramenta.desfazivel) throw new Error(MENSAGENS_DESFAZER.ferramentaMudou(chamada.ferramenta));
    // O agente pode ainda usar o que criou nesta execução: desfazer agora mudaria o chão dele.
    const execucao = chamada.execucaoId ? this.repo.execucao(chamada.execucaoId) : null;
    if (execucao?.estado === "rodando") throw new Error(MENSAGENS_DESFAZER.rodando);
    const ate = prazoDe(chamada);
    if (this.agora().getTime() > Date.parse(ate))
      throw new Error(MENSAGENS_DESFAZER.foraDoPrazo(this.quando(ate)));
    return ferramenta;
  }

  /**
   * Até quando a chamada se desfaz. Passado o prazo, o instante continua: a interface tira o botão
   * pelo relógio e diz até quando dava.
   */
  private comPrazo(chamada: ChamadaFerramenta): ChamadaFerramenta {
    const desfazivel =
      chamada.efeito === "interno" &&
      chamada.desfeitaEm === null &&
      deuCerto(chamada.resultado) &&
      this.catalogo.obter(chamada.ferramenta)?.desfazivel === true;
    return { ...chamada, desfazerAte: desfazivel ? prazoDe(chamada) : null };
  }

  /** "10/10 às 12:00", no fuso do PC. */
  private quando(instante: string): string {
    const partes = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: this.fuso,
    }).formatToParts(new Date(instante));
    const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
    return `${parte("day")}/${parte("month")} às ${parte("hour")}:${parte("minute")}`;
  }
}

function prazoDe(chamada: ChamadaFerramenta): string {
  return new Date(Date.parse(chamada.criadoEm) + PRAZO_DESFAZER_MS).toISOString();
}

/** O resultado gravado é o `ResultadoDeFerramenta` que voltou ao modelo. */
function deuCerto(resultado: unknown): boolean {
  return typeof resultado === "object" && resultado !== null && (resultado as { ok?: unknown }).ok === true;
}

/** O runtime grava assim a chamada que a execução cancelou enquanto a área trabalhava. */
function foiCancelada(resultado: unknown): boolean {
  if (typeof resultado !== "object" || resultado === null) return false;
  const r = resultado as { ok?: unknown; erro?: unknown };
  return r.ok === false && r.erro === MENSAGEM_CANCELADA;
}

function valorDoResultado(resultado: unknown): unknown {
  return (resultado as { valor?: unknown }).valor ?? null;
}

/** Tudo o que uma execução grava é do agente que trabalhou nela. */
function carimboDa(agenteId: string, execucaoId: string): Carimbo {
  return { origem: "agente", agenteId, execucaoId };
}

/** O que fica no lugar de um objeto que contém a si mesmo. */
export const MARCA_CIRCULAR = "[circular]";

/**
 * Entrada e resultado vêm do modelo e da área, e o registro não pode derrubar a execução: bigint
 * vira texto, referência circular vira {@link MARCA_CIRCULAR} e o que ainda assim não serializa
 * (um `toJSON` que lança) fica como texto.
 */
export function emJson(valor: unknown): string {
  // Os objetos do caminho até o valor atual: o `this` do replacer é o pai do que está sendo lido.
  const caminho: object[] = [];
  try {
    return (
      JSON.stringify(valor, function (this: unknown, _chave, v: unknown) {
        if (typeof v === "bigint") return v.toString();
        if (typeof v !== "object" || v === null) return v;
        while (caminho.length > 0 && caminho.at(-1) !== this) caminho.pop();
        if (caminho.includes(v)) return MARCA_CIRCULAR;
        caminho.push(v);
        return v;
      }) ?? "null"
    );
  } catch {
    return JSON.stringify(String(valor));
  }
}
