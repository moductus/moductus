import type { DatabaseSync } from "node:sqlite";
import type {
  ChamadaFerramenta,
  Efeito,
  EstadoExecucao,
  Execucao,
  ExecucaoDetalhada,
  PaginaExecucoes,
  PedidoExecucao,
  PedidoExecucoes,
  TipoGatilho,
} from "@moductus/contrato";
import { colunasDeOrigem, type Carimbo } from "../banco/tabela.ts";

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
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_estimado_microdolares: number | null;
  resumo: string | null;
}

const COLUNAS_EXECUCAO = `id, do_agente_id, gatilho, provedor_id, inicio, fim, estado, erro, tokens_entrada,
  tokens_saida, custo_estimado_microdolares, resumo`;

const paraExecucao = (l: LinhaExecucao): Execucao => ({
  id: l.id,
  agenteId: l.do_agente_id,
  gatilho: l.gatilho,
  provedorId: l.provedor_id,
  inicio: l.inicio,
  fim: l.fim,
  estado: l.estado,
  erro: l.erro,
  tokensEntrada: l.tokens_entrada,
  tokensSaida: l.tokens_saida,
  custoEstimadoMicrodolares: l.custo_estimado_microdolares,
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
  // O prazo de desfazer é da F2-14; até lá, nada se desfaz pelo histórico.
  desfazerAte: null,
});

export interface NovaExecucao {
  id: string;
  agenteId: string;
  gatilho: TipoGatilho;
  provedorId: string | null;
  inicio: string;
}

/** Como a execução terminou; tokens e custo vazios quando não há número honesto. */
export interface FimExecucao {
  fim: string;
  estado: Exclude<EstadoExecucao, "rodando">;
  erro: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoEstimadoMicrodolares: number | null;
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
            SET fim = ?, estado = ?, erro = ?, tokens_entrada = ?, tokens_saida = ?,
                custo_estimado_microdolares = ?, resumo = ?, atualizado_em = ?
          WHERE id = ?`,
      )
      .run(
        f.fim,
        f.estado,
        f.erro,
        f.tokensEntrada,
        f.tokensSaida,
        f.custoEstimadoMicrodolares,
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
}

/** O histórico como a interface pede: `execucoes.listar` e `execucoes.obter`. */
export class ServicoExecucoes {
  constructor(private readonly repo: RepositorioExecucoes) {}

  listar(pedido: PedidoExecucoes): PaginaExecucoes {
    return this.repo.pagina(pedido);
  }

  obter(pedido: PedidoExecucao): ExecucaoDetalhada {
    const execucao = this.repo.execucao(pedido.id);
    if (!execucao) throw new Error("execução não encontrada");
    return { ...execucao, chamadas: this.repo.chamadas(execucao.id) };
  }
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
