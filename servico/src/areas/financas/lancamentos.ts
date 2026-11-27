import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  CATEGORIA_TRANSFERENCIA,
  MOEDA_PADRAO,
  type Apagados,
  type DetalheLancamento,
  type Fatura,
  type GastoCategoria,
  type Lancamento,
  type LancamentoEditado,
  type MudancaFinancas,
  type MudancaLancamento,
  type NovaTransferencia,
  type NovoLancamento,
  type PaginaLancamentos,
  type PedidoLancamento,
  type PedidoLancamentos,
  type PedidoMes,
  type ResumoMes,
  type TipoCategoria,
  type TipoConta,
  type Totais,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { diaNoFuso, diasNoMes, somarDias } from "../dia/tempo.ts";
import { normalizarTexto, type ServicoCategorias } from "./categorias.ts";
import {
  impressaoDoLancamento,
  paraLancamento,
  SELECT_LANCAMENTO,
  type LinhaLancamento,
  type ServicoContas,
} from "./contas.ts";
import { dividirEmParcelas, ErroDeValor } from "./dinheiro.ts";

/**
 * Lançamentos da Tula (DATA.md §3, ADR-0046): lançar, editar, mandar à lixeira e restaurar; a
 * transferência entre contas próprias com dois lados; a compra parcelada em N lançamentos com o
 * mesmo `compra_id`, um por fatura, com a sobra de centavos na primeira; a busca (período, conta,
 * categoria com as filhas, texto sem acento nem caixa) e o resumo do mês sem transferências. Tela,
 * captura, importação e ferramentas da Tula chamam estas funções; nenhuma conta mora na tela.
 */

export class ErroDosLancamentos extends Error {}

export const MENSAGEM_LANCAMENTO_NAO_ENCONTRADO = "lançamento não encontrado";
export const MENSAGEM_NAO_ESTA_NA_LIXEIRA = "o lançamento não está na lixeira";
export const MENSAGEM_CONTA_NAO_ENCONTRADA = "conta não encontrada";
export const MENSAGEM_CONTA_ARQUIVADA = "a conta está arquivada: reative-a para lançar nela";
export const MENSAGEM_CATEGORIA_NAO_ENCONTRADA = "categoria não encontrada";
export const MENSAGEM_CATEGORIA_ARQUIVADA = "a categoria está arquivada";
export const MENSAGEM_CATEGORIA_DE_TRANSFERENCIA =
  "a categoria de transferência é só da transferência entre contas";
export const MENSAGEM_TRANSFERENCIA_SEM_CATEGORIA = "a transferência fica na categoria de transferência";
export const MENSAGEM_MESMA_CONTA = "a transferência vai para outra conta";
export const MENSAGEM_MOEDAS_DIFERENTES = "a transferência é entre contas da mesma moeda";
export const MENSAGEM_OUTRA_MOEDA = "o lançamento só muda para uma conta da mesma moeda";
export const MENSAGEM_PARCELA_MUDA_DE_CONTA = "a parcela fica na conta da compra";
export const MENSAGEM_PARCELAS_SEM_VALOR = "o valor não chega a um centavo por parcela";

/** A página da busca quando o pedido não diz o tamanho. */
export const LIMITE_PADRAO = 100;

// ---------- Datas e períodos ----------

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** O primeiro e o último dia do mês `AAAA-MM`. */
export function periodoDoMes(mes: string): { inicio: string; fim: string } {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return { inicio: `${mes}-01`, fim: `${mes}-${doisDigitos(diasNoMes(ano, m))}` };
}

/** O mesmo dia `meses` adiante; o mês curto usa o último dia (31/01 + 1 mês = 28/02). */
export function mesmoDiaMesesDepois(data: string, meses: number): string {
  const total = Number(data.slice(5, 7)) - 1 + meses;
  const ano = Number(data.slice(0, 4)) + Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const dia = Math.min(Number(data.slice(8, 10)), diasNoMes(ano, mes));
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

/**
 * A data da parcela dentro do período da fatura dela (do fechamento da anterior até a véspera do
 * dela): assim a parcela não troca de fatura se o cartão mudar o dia de fechamento depois.
 */
function dentroDaFatura(data: string, desde: string, fechaEm: string): string {
  if (data < desde) return desde;
  if (data >= fechaEm) return somarDias(fechaEm, -1);
  return data;
}

// ---------- Repositório ----------

interface LinhaContaDoLancamento {
  id: string;
  nome: string;
  tipo: TipoConta;
  moeda: string;
  ativa: number;
}

interface LinhaCategoriaDoLancamento {
  id: string;
  tipo: TipoCategoria;
  arquivada: number;
}

/** Um lançamento como entra no banco; a `impressao` (ADR-0042) o repositório calcula. */
export interface LancamentoParaGravar {
  id: string;
  contaId: string;
  data: string;
  descricao: string;
  descricaoOriginal: string | null;
  valorCentavos: number;
  categoriaId: string | null;
  faturaId: string | null;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  compraId: string | null;
  transferenciaId: string | null;
  importacaoId: string | null;
  idExterno: string | null;
  conciliado: boolean;
  notas: string | null;
  agora: string;
}

/** O que a edição grava num lançamento que já existe. */
export interface CamposEditaveis {
  contaId: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  categoriaId: string | null;
  faturaId: string | null;
  conciliado: boolean;
  notas: string | null;
  /**
   * Refaz a `impressao` com a conta, a data e o valor novos. Só o lançado à mão: o importado guarda
   * a chave de como veio do banco, para o mesmo extrato não entrar de novo depois da edição.
   */
  reimprimir: boolean;
}

/** O filtro da busca, já com o período resolvido. */
export interface FiltroLancamentos {
  inicio?: string;
  fim?: string;
  contaId?: string;
  /** A categoria e as filhas dela. */
  categoriaId?: string;
  semCategoria?: boolean;
  /** Já normalizado (`normalizarTexto`): sem acento, em maiúsculas, espaços simples. */
  texto?: string;
  /** Só os mais antigos que este ponto da ordem (data, id). */
  antesDe?: { data: string; id: string };
}

/** Entradas e saídas (sem sinal) de uma moeda no período. */
export interface TotaisDaMoeda {
  moeda: string;
  entradas: number;
  saidas: number;
}

/**
 * Fora do gasto e da receita (ADR-0046): o lado de uma transferência e o que está numa categoria do
 * tipo `transferencia` (um importado que a Tula ou você marcou assim, sem o outro lado).
 */
const NAO_E_TRANSFERENCIA = `l.transferencia_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categorias t WHERE t.id = l.categoria_id AND t.tipo = 'transferencia')`;

const lugares = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** `lancamentos` (migração 030), com a conta e a categoria que o lançamento precisa conferir. */
export class RepositorioLancamentos {
  constructor(private readonly db: DatabaseSync) {
    // A busca por texto compara sem acento nem caixa ("acougue" acha "Açougue"), como as regras.
    db.function("normalizar_texto", { deterministic: true }, (texto) =>
      typeof texto === "string" ? normalizarTexto(texto) : null,
    );
  }

  /** A conta viva (fora da lixeira), ativa ou arquivada. */
  conta(id: string): LinhaContaDoLancamento | null {
    return (
      (this.db
        .prepare("SELECT id, nome, tipo, moeda, ativa FROM contas WHERE id = ? AND apagado_em IS NULL")
        .get(id) as LinhaContaDoLancamento | undefined) ?? null
    );
  }

  /** A categoria viva, arquivada ou não. */
  categoria(id: string): LinhaCategoriaDoLancamento | null {
    return (
      (this.db
        .prepare("SELECT id, tipo, arquivada FROM categorias WHERE id = ? AND apagado_em IS NULL")
        .get(id) as LinhaCategoriaDoLancamento | undefined) ?? null
    );
  }

  criar(l: LancamentoParaGravar, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO lancamentos (id, conta_id, data, descricao, descricao_original, valor_centavos,
           categoria_id, fatura_id, parcela_numero, parcela_total, compra_id, transferencia_id,
           importacao_id, id_externo, impressao, conciliado, notas,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        l.id,
        l.contaId,
        l.data,
        l.descricao,
        l.descricaoOriginal,
        l.valorCentavos,
        l.categoriaId,
        l.faturaId,
        l.parcelaNumero,
        l.parcelaTotal,
        l.compraId,
        l.transferenciaId,
        l.importacaoId,
        l.idExterno,
        impressaoDoLancamento(l.contaId, l.data, l.valorCentavos),
        l.conciliado ? 1 : 0,
        l.notas,
        l.agora,
        l.agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
      );
  }

  atualizar(id: string, c: CamposEditaveis, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    const impressao = c.reimprimir ? impressaoDoLancamento(c.contaId, c.data, c.valorCentavos) : null;
    this.db
      .prepare(
        `UPDATE lancamentos SET conta_id = ?, data = ?, descricao = ?, valor_centavos = ?, categoria_id = ?,
           fatura_id = ?, conciliado = ?, notas = ?, impressao = COALESCE(?, impressao),
           atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        c.contaId,
        c.data,
        c.descricao,
        c.valorCentavos,
        c.categoriaId,
        c.faturaId,
        c.conciliado ? 1 : 0,
        c.notas,
        impressao,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        id,
      );
  }

  /** Vivo (fora da lixeira). */
  vivo(id: string): Lancamento | null {
    return this.onde("l.id = ? AND l.apagado_em IS NULL", id)[0] ?? null;
  }

  /** Vivo ou na lixeira, com a marca da lixeira. */
  comLixeira(id: string): { lancamento: Lancamento; apagadoEm: string | null } | null {
    const lancamento = this.onde("l.id = ?", id)[0];
    if (!lancamento) return null;
    const { apagado_em } = this.db.prepare("SELECT apagado_em FROM lancamentos WHERE id = ?").get(id) as {
      apagado_em: string | null;
    };
    return { lancamento, apagadoEm: apagado_em };
  }

  /** Na ordem dos ids pedidos. */
  porIds(ids: readonly string[]): Lancamento[] {
    if (ids.length === 0) return [];
    const porId = new Map(this.onde(`l.id IN (${lugares(ids.length)})`, ...ids).map((l) => [l.id, l]));
    return ids.flatMap((id) => porId.get(id) ?? []);
  }

  vivosDaTransferencia(transferenciaId: string): Lancamento[] {
    return this.onde("l.transferencia_id = ? AND l.apagado_em IS NULL", transferenciaId);
  }

  /** As parcelas vivas da compra, pela ordem. */
  vivosDaCompra(compraId: string): Lancamento[] {
    return this.onde("l.compra_id = ? AND l.apagado_em IS NULL", compraId);
  }

  /** Os lados da transferência que foram à lixeira juntos (a mesma marca). */
  idsDaMarca(transferenciaId: string, marca: string): string[] {
    return (
      this.db
        .prepare("SELECT id FROM lancamentos WHERE transferencia_id = ? AND apagado_em = ? ORDER BY id")
        .all(transferenciaId, marca) as { id: string }[]
    ).map((l) => l.id);
  }

  apagar(ids: readonly string[], marca: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE lancamentos SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id IN (${lugares(ids.length)}) AND apagado_em IS NULL`,
      )
      .run(marca, marca, o.origem, o.agente_id, o.execucao_id, ...ids);
  }

  /**
   * Tira da lixeira. A categoria que não está mais viva fica vazia: lançamento nunca aponta para
   * categoria apagada (a lixeira da categoria já limpa os dela; isto é a garantia).
   */
  restaurar(ids: readonly string[], agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    const lista = lugares(ids.length);
    this.db
      .prepare(
        `UPDATE lancamentos SET apagado_em = NULL, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id IN (${lista}) AND apagado_em IS NOT NULL`,
      )
      .run(agora, o.origem, o.agente_id, o.execucao_id, ...ids);
    this.db
      .prepare(
        `UPDATE lancamentos SET categoria_id = NULL
          WHERE id IN (${lista}) AND categoria_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM categorias c WHERE c.id = lancamentos.categoria_id AND c.apagado_em IS NULL)`,
      )
      .run(...ids);
  }

  importacao(id: string): { id: string; arquivoNome: string; criadoEm: string } | null {
    const linha = this.db
      .prepare("SELECT id, arquivo_nome, criado_em FROM importacoes WHERE id = ?")
      .get(id) as { id: string; arquivo_nome: string; criado_em: string } | undefined;
    return linha ? { id: linha.id, arquivoNome: linha.arquivo_nome, criadoEm: linha.criado_em } : null;
  }

  /** A data do lançamento (vivo ou na lixeira): o ponto da página seguinte. */
  dataDe(id: string): string | null {
    const linha = this.db.prepare("SELECT data FROM lancamentos WHERE id = ?").get(id) as
      { data: string } | undefined;
    return linha?.data ?? null;
  }

  /** Os vivos que passam no filtro, do mais novo para o mais antigo (data, depois id). */
  buscar(filtro: FiltroLancamentos, limite: number): Lancamento[] {
    const condicoes = ["l.apagado_em IS NULL"];
    const valores: SQLInputValue[] = [];
    if (filtro.inicio !== undefined) {
      condicoes.push("l.data >= ?");
      valores.push(filtro.inicio);
    }
    if (filtro.fim !== undefined) {
      condicoes.push("l.data <= ?");
      valores.push(filtro.fim);
    }
    if (filtro.contaId !== undefined) {
      condicoes.push("l.conta_id = ?");
      valores.push(filtro.contaId);
    }
    if (filtro.categoriaId !== undefined) {
      condicoes.push(
        "(l.categoria_id = ? OR l.categoria_id IN (SELECT f.id FROM categorias f WHERE f.categoria_pai_id = ?))",
      );
      valores.push(filtro.categoriaId, filtro.categoriaId);
    }
    if (filtro.semCategoria === true) condicoes.push("l.categoria_id IS NULL");
    if (filtro.texto !== undefined) {
      condicoes.push(
        "(instr(normalizar_texto(l.descricao), ?) > 0 OR instr(normalizar_texto(l.descricao_original), ?) > 0)",
      );
      valores.push(filtro.texto, filtro.texto);
    }
    if (filtro.antesDe !== undefined) {
      condicoes.push("(l.data < ? OR (l.data = ? AND l.id < ?))");
      valores.push(filtro.antesDe.data, filtro.antesDe.data, filtro.antesDe.id);
    }
    return (
      this.db
        .prepare(
          `${SELECT_LANCAMENTO} WHERE ${condicoes.join(" AND ")} ORDER BY l.data DESC, l.id DESC LIMIT ?`,
        )
        .all(...valores, limite) as unknown as LinhaLancamento[]
    ).map(paraLancamento);
  }

  /** Entradas e saídas vivas do período por moeda da conta, sem transferências. */
  totais(inicio: string, fim: string): TotaisDaMoeda[] {
    return (
      this.db
        .prepare(
          `SELECT c.moeda AS moeda,
                  COALESCE(SUM(CASE WHEN l.valor_centavos > 0 THEN l.valor_centavos END), 0) AS entradas,
                  COALESCE(SUM(CASE WHEN l.valor_centavos < 0 THEN -l.valor_centavos END), 0) AS saidas
             FROM lancamentos l JOIN contas c ON c.id = l.conta_id
            WHERE l.apagado_em IS NULL AND l.data >= ? AND l.data <= ? AND ${NAO_E_TRANSFERENCIA}
            GROUP BY c.moeda
            ORDER BY c.moeda`,
        )
        .all(inicio, fim) as unknown as TotaisDaMoeda[]
    ).map((t) => ({ moeda: t.moeda, entradas: Number(t.entradas), saidas: Number(t.saidas) }));
  }

  /** As saídas vivas do período numa moeda, por categoria (com a mãe dela), sem transferências. */
  saidasPorCategoria(
    inicio: string,
    fim: string,
    moeda: string,
  ): { categoria_id: string | null; categoria_pai_id: string | null; saidas: number; n: number }[] {
    return this.db
      .prepare(
        `SELECT l.categoria_id, k.categoria_pai_id, SUM(-l.valor_centavos) AS saidas, count(*) AS n
           FROM lancamentos l
           JOIN contas c ON c.id = l.conta_id
           LEFT JOIN categorias k ON k.id = l.categoria_id
          WHERE l.apagado_em IS NULL AND l.data >= ? AND l.data <= ? AND c.moeda = ?
            AND l.valor_centavos < 0 AND ${NAO_E_TRANSFERENCIA}
          GROUP BY l.categoria_id`,
      )
      .all(inicio, fim, moeda) as {
      categoria_id: string | null;
      categoria_pai_id: string | null;
      saidas: number;
      n: number;
    }[];
  }

  /** Por `SAVEPOINT`, não `BEGIN`: a área pode ser chamada de dentro de outra transação. */
  transacao<T>(fazer: () => T): T {
    this.db.exec("SAVEPOINT lancamentos");
    try {
      const resultado = fazer();
      this.db.exec("RELEASE lancamentos");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK TO lancamentos");
      this.db.exec("RELEASE lancamentos");
      throw erro;
    }
  }

  private onde(onde: string, ...valores: SQLInputValue[]): Lancamento[] {
    return (
      this.db
        .prepare(`${SELECT_LANCAMENTO} WHERE ${onde} ORDER BY l.parcela_numero, l.data, l.id`)
        .all(...valores) as unknown as LinhaLancamento[]
    ).map(paraLancamento);
  }
}

// ---------- Serviço ----------

export interface DepsLancamentos {
  /** A fatura em que cai a compra do cartão (F4-08), criada sob demanda. */
  contas: Pick<ServicoContas, "faturaDaCompra">;
  /** A categorização por código e a proposta de regra (F4-10, ADR-0045). */
  categorias: Pick<ServicoCategorias, "categorizar" | "registrarAplicacoes" | "proporRegra">;
  /** O fuso de `config`, lido a cada pergunta: "este mês" muda quando o fuso muda. */
  lerFuso: () => string;
}

export interface AvisosLancamentos {
  /** O que mudou no dinheiro, de qualquer janela ou ferramenta (`financas.mudou`). */
  mudou: (mudanca: MudancaFinancas) => void;
}

export interface OpcoesLancamentos {
  agora?: () => Date;
  gerarId?: () => string;
}

export class ServicoLancamentos {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  /** O último instante usado como marca da lixeira: a marca seguinte é sempre maior. */
  private ultimoInstante = 0;

  constructor(
    private readonly repo: RepositorioLancamentos,
    private readonly deps: DepsLancamentos,
    private readonly avisos: AvisosLancamentos,
    opcoes: OpcoesLancamentos = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  // ----- Busca e resumo -----

  /**
   * A lista e a busca, do mais novo para o mais antigo, em páginas: período (`mes`, ou `inicio` e
   * `fim`), conta, categoria com as filhas, só os sem categoria e texto sem acento nem caixa na
   * descrição ou na descrição original ("acougue" acha "Açougue"). `proximo` vai em `antesDe`.
   */
  lancamentos(pedido: PedidoLancamentos = {}): PaginaLancamentos {
    const limite = pedido.limite ?? LIMITE_PADRAO;
    const periodo = pedido.mes !== undefined ? periodoDoMes(pedido.mes) : pedido;
    const filtro: FiltroLancamentos = {};
    if (periodo.inicio !== undefined) filtro.inicio = periodo.inicio;
    if (periodo.fim !== undefined) filtro.fim = periodo.fim;
    if (pedido.contaId !== undefined) filtro.contaId = pedido.contaId;
    if (pedido.categoriaId !== undefined) filtro.categoriaId = pedido.categoriaId;
    if (pedido.semCategoria === true) filtro.semCategoria = true;
    if (pedido.texto !== undefined) {
      const texto = normalizarTexto(pedido.texto);
      if (texto !== "") filtro.texto = texto;
    }
    if (pedido.antesDe !== undefined) {
      const data = this.repo.dataDe(pedido.antesDe);
      if (data === null) throw new ErroDosLancamentos(MENSAGEM_LANCAMENTO_NAO_ENCONTRADO);
      filtro.antesDe = { data, id: pedido.antesDe };
    }
    const itens = this.repo.buscar(filtro, limite + 1);
    const temMais = itens.length > limite;
    if (temMais) itens.length = limite;
    return { itens, proximo: temMais ? (itens.at(-1)?.id ?? null) : null };
  }

  /**
   * O resumo do mês (sem mês, o de hoje no fuso): entradas, saídas (sem sinal) e a sobra, sem as
   * transferências entre contas próprias (ADR-0046), pela data do lançamento. Real à parte das
   * outras moedas, nunca somadas. Vale também para o que veio pela fatura do cartão: a compra conta
   * no dia em que foi feita, e o pagamento da fatura é transferência.
   */
  resumo(pedido: PedidoMes = {}): ResumoMes {
    const mes = pedido.mes ?? this.hoje().slice(0, 7);
    const { inicio, fim } = periodoDoMes(mes);
    const porMoeda = this.repo.totais(inicio, fim).map(paraTotais);
    const totais =
      porMoeda.find((t) => t.moeda === MOEDA_PADRAO) ??
      paraTotais({ moeda: MOEDA_PADRAO, entradas: 0, saidas: 0 });
    return {
      mes,
      totais,
      outrasMoedas: porMoeda.filter((t) => t.moeda !== MOEDA_PADRAO),
      porCategoria: this.gastoPorCategoria(inicio, fim),
    };
  }

  /**
   * As saídas em real do período por categoria, sem sinal e sem transferências: uma linha por
   * categoria com saída, e a mãe somando as próprias e as das filhas (que também têm a linha delas).
   * As linhas das categorias sem mãe e a de "sem categoria" (`categoriaId` vazio) somam as saídas do
   * período. Da maior para a menor.
   */
  gastoPorCategoria(inicio: string, fim: string): GastoCategoria[] {
    const linhas = new Map<string | null, GastoCategoria>();
    const somar = (categoriaId: string | null, gasto: number, n: number) => {
      const linha = linhas.get(categoriaId) ?? { categoriaId, gastoCentavos: 0, lancamentos: 0 };
      linha.gastoCentavos += gasto;
      linha.lancamentos += n;
      linhas.set(categoriaId, linha);
    };
    for (const l of this.repo.saidasPorCategoria(inicio, fim, MOEDA_PADRAO)) {
      somar(l.categoria_id, Number(l.saidas), Number(l.n));
      if (l.categoria_pai_id !== null) somar(l.categoria_pai_id, Number(l.saidas), Number(l.n));
    }
    return [...linhas.values()].sort(
      (a, b) =>
        b.gastoCentavos - a.gastoCentavos ||
        Number(a.categoriaId === null) - Number(b.categoriaId === null) ||
        (a.categoriaId ?? "").localeCompare(b.categoriaId ?? ""),
    );
  }

  /** O detalhe: o lançamento, as outras parcelas da compra, o outro lado e a importação. */
  obterLancamento(pedido: PedidoLancamento): DetalheLancamento {
    const lancamento = this.exigirVivo(pedido.id);
    const parcelas =
      lancamento.compraId === null
        ? []
        : this.repo.vivosDaCompra(lancamento.compraId).filter((p) => p.id !== lancamento.id);
    return {
      lancamento,
      parcelas,
      outroLado: this.outroLado(lancamento),
      importacao: lancamento.importacaoId === null ? null : this.repo.importacao(lancamento.importacaoId),
    };
  }

  // ----- Lançar -----

  /**
   * Gasto (negativo) ou receita (positiva) numa conta ativa. No cartão, cai na fatura pelo dia de
   * fechamento (F4-08). Sem `categoriaId`, a categorização por código do ADR-0045 (regra, depois o
   * lançamento igual anterior); `null` é "sem categoria". Com `parcelas`, o valor é o total da
   * compra: N lançamentos com o mesmo `compra_id`, a sobra de centavos na primeira, um por mês e,
   * no cartão, um por fatura seguida.
   */
  lancar(novo: NovoLancamento, carimbo: Carimbo = DO_USUARIO): Lancamento[] {
    const conta = this.exigirContaAtiva(novo.contaId);
    let categoriaId: string | null;
    let regraId: string | null = null;
    if (novo.categoriaId === undefined) {
      const [categorizacao] = this.deps.categorias.categorizar([
        { contaId: conta.id, descricao: novo.descricao },
      ]);
      categoriaId = categorizacao?.categoriaId ?? null;
      regraId = categorizacao?.regraId ?? null;
    } else {
      categoriaId = novo.categoriaId;
      if (categoriaId !== null) this.exigirCategoriaDeLancamento(categoriaId);
    }
    const total = novo.parcelas ?? 1;
    const valores = this.parcelar(novo.valorCentavos, total);
    const compraId = total > 1 ? this.gerarId() : null;
    const agora = this.instante();
    const ids = this.repo.transacao(() => {
      const ids: string[] = [];
      let anterior: Fatura | null = null;
      for (const [i, valorCentavos] of valores.entries()) {
        let data = mesmoDiaMesesDepois(novo.data, i);
        let faturaId: string | null = null;
        if (conta.tipo === "cartao") {
          // A primeira pela data da compra; cada seguinte, a fatura depois da anterior.
          const fatura: Fatura = this.deps.contas.faturaDaCompra(
            conta.id,
            anterior === null ? novo.data : anterior.fechaEm,
          );
          if (anterior !== null) data = dentroDaFatura(data, anterior.fechaEm, fatura.fechaEm);
          faturaId = fatura.id;
          anterior = fatura;
        }
        const id = this.gerarId();
        this.repo.criar(
          {
            id,
            contaId: conta.id,
            data,
            descricao: novo.descricao,
            descricaoOriginal: null,
            valorCentavos,
            categoriaId,
            faturaId,
            parcelaNumero: compraId === null ? null : i + 1,
            parcelaTotal: compraId === null ? null : total,
            compraId,
            transferenciaId: null,
            importacaoId: null,
            idExterno: null,
            conciliado: false,
            notas: novo.notas ?? null,
            agora,
          },
          carimbo,
        );
        ids.push(id);
      }
      return ids;
    });
    // A regra conta uma vez por compra, depois que ela entrou.
    if (regraId !== null) this.deps.categorias.registrarAplicacoes([regraId]);
    const criados = this.repo.porIds(ids);
    this.avisar(criados, [], conta.tipo === "cartao");
    return criados;
  }

  /**
   * Transferência entre contas próprias, ativas e da mesma moeda: sai de uma, entra na outra, dois
   * lançamentos com o mesmo `transferencia_id` na categoria de transferência, fora de gasto e de
   * receita (ADR-0046). Nenhum dos lados cai em fatura: pagar o cartão é "Pagar fatura" (F4-08).
   */
  transferir(nova: NovaTransferencia, carimbo: Carimbo = DO_USUARIO): Lancamento[] {
    const de = this.exigirContaAtiva(nova.deContaId);
    const para = this.exigirContaAtiva(nova.paraContaId);
    if (de.id === para.id) throw new ErroDosLancamentos(MENSAGEM_MESMA_CONTA);
    if (de.moeda !== para.moeda) throw new ErroDosLancamentos(MENSAGEM_MOEDAS_DIFERENTES);
    const transferenciaId = this.gerarId();
    const agora = this.instante();
    const lado = {
      data: nova.data,
      descricao: nova.descricao ?? `Transferência de ${de.nome} para ${para.nome}`,
      descricaoOriginal: null,
      categoriaId: CATEGORIA_TRANSFERENCIA,
      faturaId: null,
      parcelaNumero: null,
      parcelaTotal: null,
      compraId: null,
      transferenciaId,
      importacaoId: null,
      idExterno: null,
      conciliado: false,
      notas: nova.notas ?? null,
      agora,
    };
    const saidaId = this.gerarId();
    const entradaId = this.gerarId();
    this.repo.transacao(() => {
      this.repo.criar({ ...lado, id: saidaId, contaId: de.id, valorCentavos: -nova.valorCentavos }, carimbo);
      this.repo.criar(
        { ...lado, id: entradaId, contaId: para.id, valorCentavos: nova.valorCentavos },
        carimbo,
      );
    });
    const lados = this.repo.porIds([saidaId, entradaId]);
    this.avisar(lados, [], de.tipo === "cartao" || para.tipo === "cartao");
    return lados;
  }

  // ----- Editar -----

  /**
   * Mudança parcial. No cartão, a data ou a conta nova refaz a fatura. Num lado da transferência, a
   * data e o valor valem para os dois (o outro com o sinal trocado) e a categoria não sai da de
   * transferência. Numa parcela, a descrição e a categoria novas valem para as outras parcelas que
   * ainda tinham as antigas; a conta só muda com a compra. Trocar a categoria de um importado volta
   * com a regra proposta (ADR-0045).
   */
  definirLancamento(mudanca: MudancaLancamento, carimbo: Carimbo = DO_USUARIO): LancamentoEditado {
    const atual = this.exigirVivo(mudanca.id);
    const outroLado = this.outroLado(atual);
    const contaAtual = this.exigirConta(atual.contaId);
    const conta =
      mudanca.contaId === undefined || mudanca.contaId === atual.contaId
        ? contaAtual
        : this.exigirContaAtiva(mudanca.contaId);
    const contaMudou = conta.id !== atual.contaId;
    if (contaMudou) {
      if (atual.compraId !== null) throw new ErroDosLancamentos(MENSAGEM_PARCELA_MUDA_DE_CONTA);
      if (conta.moeda !== contaAtual.moeda) throw new ErroDosLancamentos(MENSAGEM_OUTRA_MOEDA);
      if (outroLado !== null && conta.id === outroLado.contaId)
        throw new ErroDosLancamentos(MENSAGEM_MESMA_CONTA);
    }
    const categoriaId = mudanca.categoriaId === undefined ? atual.categoriaId : mudanca.categoriaId;
    const categoriaMudou = categoriaId !== atual.categoriaId;
    if (categoriaMudou) {
      if (atual.transferenciaId !== null) throw new ErroDosLancamentos(MENSAGEM_TRANSFERENCIA_SEM_CATEGORIA);
      if (categoriaId !== null) this.exigirCategoriaDeLancamento(categoriaId);
    }
    const campos: CamposEditaveis = {
      contaId: conta.id,
      data: mudanca.data ?? atual.data,
      descricao: mudanca.descricao ?? atual.descricao,
      valorCentavos: mudanca.valorCentavos ?? atual.valorCentavos,
      categoriaId,
      faturaId: atual.faturaId,
      conciliado: mudanca.conciliado ?? atual.conciliado,
      notas: mudanca.notas === undefined ? atual.notas : mudanca.notas,
      reimprimir: atual.importacaoId === null,
    };
    const dataMudou = campos.data !== atual.data;
    const valorMudou = campos.valorCentavos !== atual.valorCentavos;
    const descricaoMudou = campos.descricao !== atual.descricao;
    const nadaMudou =
      !contaMudou &&
      !dataMudou &&
      !valorMudou &&
      !descricaoMudou &&
      !categoriaMudou &&
      campos.conciliado === atual.conciliado &&
      campos.notas === atual.notas;
    if (nadaMudou) return { lancamentos: [atual], propostaRegra: null };

    const agora = this.instante();
    const mudados = this.repo.transacao(() => {
      if (atual.transferenciaId === null && (contaMudou || dataMudou)) {
        campos.faturaId =
          conta.tipo === "cartao" ? this.deps.contas.faturaDaCompra(conta.id, campos.data).id : null;
      }
      this.repo.atualizar(atual.id, campos, agora, carimbo);
      const mudados = [atual.id];
      if (outroLado !== null && (dataMudou || valorMudou)) {
        this.repo.atualizar(
          outroLado.id,
          {
            ...camposDe(outroLado),
            data: campos.data,
            valorCentavos: -campos.valorCentavos,
          },
          agora,
          carimbo,
        );
        mudados.push(outroLado.id);
      }
      if (atual.compraId !== null && (descricaoMudou || categoriaMudou)) {
        for (const p of this.repo.vivosDaCompra(atual.compraId)) {
          if (p.id === atual.id) continue;
          const descricao =
            descricaoMudou && p.descricao === atual.descricao ? campos.descricao : p.descricao;
          const categoria =
            categoriaMudou && p.categoriaId === atual.categoriaId ? categoriaId : p.categoriaId;
          if (descricao === p.descricao && categoria === p.categoriaId) continue;
          this.repo.atualizar(p.id, { ...camposDe(p), descricao, categoriaId: categoria }, agora, carimbo);
          mudados.push(p.id);
        }
      }
      return mudados;
    });
    const propostaRegra = categoriaMudou
      ? this.deps.categorias.proporRegra({
          descricao: campos.descricao,
          descricaoOriginal: atual.descricaoOriginal,
          importacaoId: atual.importacaoId,
          categoriaAntes: atual.categoriaId,
          categoriaDepois: categoriaId,
        })
      : null;
    const lancamentos = this.repo.porIds(mudados);
    this.avisar(lancamentos, [], contaAtual.tipo === "cartao" || conta.tipo === "cartao");
    return { lancamentos, propostaRegra };
  }

  // ----- Lixeira -----

  /**
   * Manda à lixeira; o outro lado da transferência vai junto, com a mesma marca. Apagar o pagamento
   * de uma fatura a deixa sem pagamento até ele voltar (contrato `EstadoFatura`).
   */
  apagarLancamento(pedido: PedidoLancamento, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigirVivo(pedido.id);
    const lados =
      atual.transferenciaId === null ? [atual] : this.repo.vivosDaTransferencia(atual.transferenciaId);
    const ids = lados.map((l) => l.id);
    this.repo.transacao(() => this.repo.apagar(ids, this.marca(), carimbo));
    this.avisar(
      [],
      ids,
      lados.some((l) => this.exigirConta(l.contaId).tipo === "cartao"),
    );
    return { ids };
  }

  /** Tira da lixeira; o outro lado da transferência que foi junto (a mesma marca) volta junto. */
  restaurarLancamento(pedido: PedidoLancamento, carimbo: Carimbo = DO_USUARIO): Lancamento[] {
    const linha = this.repo.comLixeira(pedido.id);
    if (!linha) throw new ErroDosLancamentos(MENSAGEM_LANCAMENTO_NAO_ENCONTRADO);
    const { lancamento, apagadoEm } = linha;
    if (apagadoEm === null) throw new ErroDosLancamentos(MENSAGEM_NAO_ESTA_NA_LIXEIRA);
    const ids =
      lancamento.transferenciaId === null
        ? [lancamento.id]
        : this.repo.idsDaMarca(lancamento.transferenciaId, apagadoEm);
    this.repo.transacao(() => this.repo.restaurar(ids, this.instante(), carimbo));
    const restaurados = this.repo.porIds(ids);
    this.avisar(
      restaurados,
      [],
      restaurados.some((l) => this.exigirConta(l.contaId).tipo === "cartao"),
    );
    return restaurados;
  }

  // ----- Apoio -----

  /** Divide o total da compra; o valor que não chega a um centavo por parcela volta como erro da regra. */
  private parcelar(valorCentavos: number, parcelas: number): number[] {
    try {
      return dividirEmParcelas(valorCentavos, parcelas);
    } catch (erro) {
      if (erro instanceof ErroDeValor) throw new ErroDosLancamentos(MENSAGEM_PARCELAS_SEM_VALOR);
      throw erro;
    }
  }

  /** O outro lado vivo da transferência, ou nada. */
  private outroLado(lancamento: Lancamento): Lancamento | null {
    if (lancamento.transferenciaId === null) return null;
    return (
      this.repo.vivosDaTransferencia(lancamento.transferenciaId).find((l) => l.id !== lancamento.id) ?? null
    );
  }

  private exigirVivo(id: string): Lancamento {
    const lancamento = this.repo.vivo(id);
    if (!lancamento) throw new ErroDosLancamentos(MENSAGEM_LANCAMENTO_NAO_ENCONTRADO);
    return lancamento;
  }

  private exigirConta(id: string): LinhaContaDoLancamento {
    const conta = this.repo.conta(id);
    if (!conta) throw new ErroDosLancamentos(MENSAGEM_CONTA_NAO_ENCONTRADA);
    return conta;
  }

  /** Lançamento novo só entra em conta ativa: a arquivada guarda os que já tem. */
  private exigirContaAtiva(id: string): LinhaContaDoLancamento {
    const conta = this.exigirConta(id);
    if (conta.ativa !== 1) throw new ErroDosLancamentos(MENSAGEM_CONTA_ARQUIVADA);
    return conta;
  }

  /** Viva, não arquivada e de gasto ou receita: a de transferência é só dos dois lados dela. */
  private exigirCategoriaDeLancamento(id: string): void {
    const categoria = this.repo.categoria(id);
    if (!categoria) throw new ErroDosLancamentos(MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    if (categoria.tipo === "transferencia") throw new ErroDosLancamentos(MENSAGEM_CATEGORIA_DE_TRANSFERENCIA);
    if (categoria.arquivada === 1) throw new ErroDosLancamentos(MENSAGEM_CATEGORIA_ARQUIVADA);
  }

  /** Mudou lançamento: o saldo das contas muda junto e, se tocou cartão, o total das faturas. */
  private avisar(lancamentos: Lancamento[], apagados: string[], cartao: boolean): void {
    this.avisos.mudou({
      partes: cartao ? ["lancamentos", "contas", "faturas"] : ["lancamentos", "contas"],
      lancamentos,
      apagados,
    });
  }

  /** Agora, sempre depois da marca anterior: duas idas à lixeira no mesmo ms não se confundem. */
  private marca(): string {
    const ms = Math.max(this.agora().getTime(), this.ultimoInstante + 1);
    this.ultimoInstante = ms;
    return new Date(ms).toISOString();
  }

  private hoje(): string {
    return diaNoFuso(this.agora(), this.deps.lerFuso());
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

/** Os campos de um lançamento como estão, para editar só um ou dois. */
function camposDe(l: Lancamento): CamposEditaveis {
  return {
    contaId: l.contaId,
    data: l.data,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    categoriaId: l.categoriaId,
    faturaId: l.faturaId,
    conciliado: l.conciliado,
    notas: l.notas,
    reimprimir: l.importacaoId === null,
  };
}

function paraTotais(t: TotaisDaMoeda): Totais {
  return {
    moeda: t.moeda,
    entradasCentavos: t.entradas,
    saidasCentavos: t.saidas,
    sobraCentavos: t.entradas - t.saidas,
  };
}
