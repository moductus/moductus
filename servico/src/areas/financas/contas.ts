import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  CATEGORIA_TRANSFERENCIA,
  MOEDA_PADRAO,
  Mes,
  type Apagados,
  type Conta,
  type EstadoFatura,
  type Fatura,
  type Lancamento,
  type MudancaConta,
  type MudancaFinancas,
  type NovaConta,
  type Origem,
  type PedidoConta,
  type PedidoContas,
  type PedidoFatura,
  type PedidoFaturas,
  type PedidoPagarFatura,
  type TipoConta,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { diaNoFuso, diasNoMes } from "../dia/tempo.ts";

/**
 * Contas e cartões da Tula (DATA.md §3, ADR-0046): criar, editar, arquivar e mandar à lixeira; o
 * saldo derivado dos lançamentos; a fatura do cartão pelo dia de fechamento, criada sob demanda,
 * com o total pela soma; e "Pagar fatura", que registra a transferência que você já fez no banco.
 * O Moductus nunca paga nada.
 */

export class ErroDasContas extends Error {}

export const MENSAGEM_CONTA_NAO_ENCONTRADA = "conta não encontrada";
export const MENSAGEM_FATURA_NAO_ENCONTRADA = "fatura não encontrada";
export const MENSAGEM_CONTA_COM_LANCAMENTO = "conta com lançamento só arquiva";
export const MENSAGEM_SO_CARTAO = "só o cartão tem fechamento, vencimento, limite e conta de pagamento";
export const MENSAGEM_CARTAO_SEM_DIAS = "cartão precisa dos dias de fechamento e vencimento";
export const MENSAGEM_NAO_E_CARTAO = "só o cartão tem fatura";
export const MENSAGEM_PAGAMENTO_INVALIDO =
  "a conta de pagamento é outra conta sua, ativa, na mesma moeda e que não é cartão";
export const MENSAGEM_SEM_CONTA_PAGAMENTO = "diga de qual conta saiu o pagamento da fatura";
export const MENSAGEM_FATURA_PAGA = "a fatura já está paga";
export const MENSAGEM_FATURA_NAO_PAGA = "a fatura não está paga";
export const MENSAGEM_FATURA_SEM_VALOR = "a fatura não tem valor a pagar";
export const MENSAGEM_MOEDA_COM_LANCAMENTO = "a moeda não muda depois que a conta tem lançamento";

interface LinhaConta {
  id: string;
  nome: string;
  tipo: TipoConta;
  banco: string | null;
  moeda: string;
  saldo_inicial_centavos: number;
  saldo_inicial_em: string | null;
  ativa: number;
  dia_fechamento: number | null;
  dia_vencimento: number | null;
  limite_centavos: number | null;
  conta_pagamento_id: string | null;
  saldo_centavos: number;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/**
 * O saldo não é coluna (ADR-0046): o inicial mais os lançamentos vivos desde `saldo_inicial_em`
 * (o próprio dia entra); sem o dia, todos.
 */
const SELECT_CONTA = `
  SELECT c.id, c.nome, c.tipo, c.banco, c.moeda, c.saldo_inicial_centavos, c.saldo_inicial_em, c.ativa,
         c.dia_fechamento, c.dia_vencimento, c.limite_centavos, c.conta_pagamento_id,
         c.saldo_inicial_centavos + COALESCE((
           SELECT SUM(l.valor_centavos) FROM lancamentos l
            WHERE l.conta_id = c.id AND l.apagado_em IS NULL
              AND (c.saldo_inicial_em IS NULL OR l.data >= c.saldo_inicial_em)
         ), 0) AS saldo_centavos,
         c.origem, c.agente_id, c.execucao_id, c.criado_em, c.atualizado_em
    FROM contas c`;

const paraConta = (l: LinhaConta): Conta => ({
  id: l.id,
  nome: l.nome,
  tipo: l.tipo,
  banco: l.banco,
  moeda: l.moeda,
  saldoInicialCentavos: l.saldo_inicial_centavos,
  saldoInicialEm: l.saldo_inicial_em,
  diaFechamento: l.dia_fechamento,
  diaVencimento: l.dia_vencimento,
  limiteCentavos: l.limite_centavos,
  contaPagamentoId: l.conta_pagamento_id,
  ativa: l.ativa === 1,
  saldoCentavos: l.saldo_centavos,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

interface LinhaFatura {
  id: string;
  conta_id: string;
  mes_referencia: string;
  fecha_em: string;
  vence_em: string;
  paga: number;
  pagamento_lancamento_id: string | null;
  total_centavos: number;
  criado_em: string;
  atualizado_em: string;
}

/** O total não é coluna (ADR-0046): a soma dos lançamentos vivos da fatura, saída negativa. */
const SELECT_FATURA = `
  SELECT f.id, f.conta_id, f.mes_referencia, f.fecha_em, f.vence_em, f.paga, f.pagamento_lancamento_id,
         COALESCE((SELECT SUM(l.valor_centavos) FROM lancamentos l
                    WHERE l.fatura_id = f.id AND l.apagado_em IS NULL), 0) AS total_centavos,
         f.criado_em, f.atualizado_em
    FROM faturas f`;

interface LinhaLancamento {
  id: string;
  conta_id: string;
  data: string;
  descricao: string;
  descricao_original: string | null;
  valor_centavos: number;
  moeda: string;
  categoria_id: string | null;
  fatura_id: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  compra_id: string | null;
  transferencia_id: string | null;
  recorrencia_id: string | null;
  divida_id: string | null;
  importacao_id: string | null;
  id_externo: string | null;
  conciliado: number;
  notas: string | null;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const SELECT_LANCAMENTO = `
  SELECT l.id, l.conta_id, l.data, l.descricao, l.descricao_original, l.valor_centavos, c.moeda,
         l.categoria_id, l.fatura_id, l.parcela_numero, l.parcela_total, l.compra_id, l.transferencia_id,
         l.recorrencia_id, l.divida_id, l.importacao_id, l.id_externo, l.conciliado, l.notas,
         l.origem, l.agente_id, l.execucao_id, l.criado_em, l.atualizado_em
    FROM lancamentos l JOIN contas c ON c.id = l.conta_id`;

const paraLancamento = (l: LinhaLancamento): Lancamento => ({
  id: l.id,
  contaId: l.conta_id,
  data: l.data,
  descricao: l.descricao,
  descricaoOriginal: l.descricao_original,
  valorCentavos: l.valor_centavos,
  moeda: l.moeda,
  categoriaId: l.categoria_id,
  faturaId: l.fatura_id,
  parcelaNumero: l.parcela_numero,
  parcelaTotal: l.parcela_total,
  compraId: l.compra_id,
  transferenciaId: l.transferencia_id,
  recorrenciaId: l.recorrencia_id,
  dividaId: l.divida_id,
  importacaoId: l.importacao_id,
  idExterno: l.id_externo,
  conciliado: l.conciliado === 1,
  notas: l.notas,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

/**
 * A chave natural do lançamento (ADR-0042): SHA-256 da conta, da data literal e do valor, sem a
 * descrição, que muda entre exportações. Lançamento manual, importação e pagamento usam a mesma.
 */
export function impressaoDoLancamento(contaId: string, data: string, valorCentavos: number): string {
  return createHash("sha256").update(`${contaId}\n${data}\n${valorCentavos}`).digest("hex");
}

// ---------- Datas da fatura ----------

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** O dia `dia` do mês, ou o último dia quando o mês é curto (ADR-0046). */
function diaNoMes(ano: number, mes: number, dia: number): string {
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(Math.min(dia, diasNoMes(ano, mes)))}`;
}

function mesSeguinte(ano: number, mes: number): [number, number] {
  return mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
}

export interface DatasFatura {
  mesReferencia: string;
  fechaEm: string;
  venceEm: string;
}

/**
 * Em que fatura cai a compra do dia `data` (ADR-0046): a que fecha no primeiro dia de fechamento
 * depois dela; a compra do próprio dia de fechamento já vai para a seguinte. O mês curto usa o
 * último dia ("fecha dia 31" fecha em 28 ou 29 de fevereiro). O vencimento é o primeiro dia de
 * vencimento depois do fechamento.
 */
export function datasDaFatura(data: string, diaFechamento: number, diaVencimento: number): DatasFatura {
  let ano = Number(data.slice(0, 4));
  let mes = Number(data.slice(5, 7));
  let fechaEm = diaNoMes(ano, mes, diaFechamento);
  if (data >= fechaEm) {
    [ano, mes] = mesSeguinte(ano, mes);
    fechaEm = diaNoMes(ano, mes, diaFechamento);
  }
  let venceEm = diaNoMes(ano, mes, diaVencimento);
  if (venceEm <= fechaEm) {
    const [anoV, mesV] = mesSeguinte(ano, mes);
    venceEm = diaNoMes(anoV, mesV, diaVencimento);
  }
  // A 030 só confere a forma do mês; o mês de 01 a 12 é garantido aqui (pendência da revisão da F4-05).
  const mesReferencia = Mes.parse(`${ano}-${doisDigitos(mes)}`);
  return { mesReferencia, fechaEm, venceEm };
}

// ---------- Repositório ----------

export interface NovaLinhaConta {
  id: string;
  nome: string;
  tipo: TipoConta;
  banco: string | null;
  moeda: string;
  saldoInicialCentavos: number;
  saldoInicialEm: string | null;
  diaFechamento: number | null;
  diaVencimento: number | null;
  limiteCentavos: number | null;
  contaPagamentoId: string | null;
  agora: string;
}

export interface NovaLinhaLancamento {
  id: string;
  contaId: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  categoriaId: string | null;
  transferenciaId: string | null;
  agora: string;
}

/** `contas`, `faturas` e os lançamentos que o pagamento da fatura cria (migrações 029 e 030). */
export class RepositorioContas {
  constructor(private readonly db: DatabaseSync) {}

  /** Vivas (fora da lixeira); só as ativas, a não ser com `todas`. */
  contas(todas: boolean): Conta[] {
    const filtro = todas ? "" : "AND c.ativa = 1";
    return (
      this.db
        .prepare(`${SELECT_CONTA} WHERE c.apagado_em IS NULL ${filtro} ORDER BY c.ativa DESC, c.nome, c.id`)
        .all() as unknown as LinhaConta[]
    ).map(paraConta);
  }

  conta(id: string): Conta | null {
    const linha = this.db.prepare(`${SELECT_CONTA} WHERE c.id = ? AND c.apagado_em IS NULL`).get(id) as
      LinhaConta | undefined;
    return linha ? paraConta(linha) : null;
  }

  temLancamento(contaId: string): boolean {
    return this.db.prepare("SELECT 1 FROM lancamentos WHERE conta_id = ? LIMIT 1").get(contaId) !== undefined;
  }

  criarConta(n: NovaLinhaConta, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO contas (id, nome, tipo, banco, moeda, saldo_inicial_centavos, saldo_inicial_em,
           dia_fechamento, dia_vencimento, limite_centavos, conta_pagamento_id,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        n.id,
        n.nome,
        n.tipo,
        n.banco,
        n.moeda,
        n.saldoInicialCentavos,
        n.saldoInicialEm,
        n.diaFechamento,
        n.diaVencimento,
        n.limiteCentavos,
        n.contaPagamentoId,
        n.agora,
        n.agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
      );
  }

  definirConta(conta: Conta, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE contas SET nome = ?, banco = ?, moeda = ?, saldo_inicial_centavos = ?, saldo_inicial_em = ?,
           ativa = ?, dia_fechamento = ?, dia_vencimento = ?, limite_centavos = ?, conta_pagamento_id = ?,
           atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        conta.nome,
        conta.banco,
        conta.moeda,
        conta.saldoInicialCentavos,
        conta.saldoInicialEm,
        conta.ativa ? 1 : 0,
        conta.diaFechamento,
        conta.diaVencimento,
        conta.limiteCentavos,
        conta.contaPagamentoId,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        conta.id,
      );
  }

  apagarConta(id: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE contas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  faturas(contaId: string): LinhaFatura[] {
    return this.db
      .prepare(`${SELECT_FATURA} WHERE f.conta_id = ? ORDER BY f.mes_referencia DESC`)
      .all(contaId) as unknown as LinhaFatura[];
  }

  fatura(id: string): LinhaFatura | null {
    return (this.db.prepare(`${SELECT_FATURA} WHERE f.id = ?`).get(id) as LinhaFatura | undefined) ?? null;
  }

  faturaDoMes(contaId: string, mesReferencia: string): LinhaFatura | null {
    return (
      (this.db
        .prepare(`${SELECT_FATURA} WHERE f.conta_id = ? AND f.mes_referencia = ?`)
        .get(contaId, mesReferencia) as LinhaFatura | undefined) ?? null
    );
  }

  criarFatura(id: string, contaId: string, datas: DatasFatura, agora: string): void {
    this.db
      .prepare(
        `INSERT INTO faturas (id, conta_id, mes_referencia, fecha_em, vence_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, contaId, datas.mesReferencia, datas.fechaEm, datas.venceEm, agora, agora);
  }

  marcarPagamento(id: string, pagamentoLancamentoId: string | null, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE faturas SET paga = ?, pagamento_lancamento_id = ?, atualizado_em = ?,
           origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ?`,
      )
      .run(
        pagamentoLancamentoId === null ? 0 : 1,
        pagamentoLancamentoId,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        id,
      );
  }

  criarLancamento(n: NovaLinhaLancamento, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO lancamentos (id, conta_id, data, descricao, valor_centavos, categoria_id, transferencia_id,
           impressao, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        n.id,
        n.contaId,
        n.data,
        n.descricao,
        n.valorCentavos,
        n.categoriaId,
        n.transferenciaId,
        impressaoDoLancamento(n.contaId, n.data, n.valorCentavos),
        n.agora,
        n.agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
      );
  }

  /** Vivos ou na lixeira: o desfazer do pagamento leva os dois lados de onde estiverem. */
  lancamentosDaTransferencia(transferenciaId: string): Lancamento[] {
    return this.lancamentosOnde("l.transferencia_id = ?", transferenciaId);
  }

  lancamento(id: string): Lancamento | null {
    return this.lancamentosOnde("l.id = ?", id)[0] ?? null;
  }

  /** O desfazer do pagamento: os lançamentos dele somem como se nunca tivessem existido. */
  removerLancamentos(ids: readonly string[]): void {
    const remover = this.db.prepare("DELETE FROM lancamentos WHERE id = ?");
    for (const id of ids) remover.run(id);
  }

  /** Por `SAVEPOINT`, não `BEGIN`: a área pode ser chamada de dentro de outra transação. */
  transacao<T>(fazer: () => T): T {
    this.db.exec("SAVEPOINT contas");
    try {
      const resultado = fazer();
      this.db.exec("RELEASE contas");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK TO contas");
      this.db.exec("RELEASE contas");
      throw erro;
    }
  }

  private lancamentosOnde(onde: string, ...valores: SQLInputValue[]): Lancamento[] {
    return (
      this.db
        .prepare(`${SELECT_LANCAMENTO} WHERE ${onde} ORDER BY l.id`)
        .all(...valores) as unknown as LinhaLancamento[]
    ).map(paraLancamento);
  }
}

// ---------- Serviço ----------

export interface DepsContas {
  /** O fuso de `config`, lido a cada pergunta: "hoje" muda quando o fuso muda. */
  lerFuso: () => string;
}

export interface AvisosContas {
  /** O que mudou no dinheiro, de qualquer janela ou ferramenta (`financas.mudou`). */
  mudou: (mudanca: MudancaFinancas) => void;
}

export interface OpcoesContas {
  agora?: () => Date;
  gerarId?: () => string;
}

/** O saldo somado em real e, à parte, o de cada outra moeda: sem conversão nesta fase (ADR-0046). */
export interface SaldosDasContas {
  totalCentavos: number;
  outrasMoedas: { moeda: string; saldoCentavos: number }[];
}

export class ServicoContas {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;

  constructor(
    private readonly repo: RepositorioContas,
    private readonly deps: DepsContas,
    private readonly avisos: AvisosContas,
    opcoes: OpcoesContas = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  // Contas

  contas(pedido: PedidoContas = {}): Conta[] {
    return this.repo.contas(pedido.todas ?? false);
  }

  obterConta(pedido: PedidoConta): Conta {
    return this.exigirConta(pedido.id);
  }

  criarConta(nova: NovaConta, carimbo: Carimbo = DO_USUARIO): Conta {
    const cartao = nova.tipo === "cartao";
    const moeda = nova.moeda ?? MOEDA_PADRAO;
    const contaPagamentoId = nova.contaPagamentoId ?? null;
    if (contaPagamentoId !== null) this.exigirContaDePagamento(contaPagamentoId, null, moeda);
    const id = this.gerarId();
    this.repo.criarConta(
      {
        id,
        nome: nova.nome,
        tipo: nova.tipo,
        banco: nova.banco ?? null,
        moeda,
        saldoInicialCentavos: nova.saldoInicialCentavos ?? 0,
        saldoInicialEm: nova.saldoInicialEm ?? null,
        diaFechamento: cartao ? (nova.diaFechamento ?? null) : null,
        diaVencimento: cartao ? (nova.diaVencimento ?? null) : null,
        limiteCentavos: cartao ? (nova.limiteCentavos ?? null) : null,
        contaPagamentoId,
        agora: this.instante(),
      },
      carimbo,
    );
    return this.avisarConta(this.exigirConta(id));
  }

  /**
   * Mudança parcial; o tipo não muda. `ativa: false` arquiva, e a conta arquivada some da lista
   * mas guarda os lançamentos. A moeda só muda enquanto a conta não tem lançamento: o valor deles
   * está na moeda dela.
   */
  definirConta(mudanca: MudancaConta, carimbo: Carimbo = DO_USUARIO): Conta {
    const atual = this.exigirConta(mudanca.id);
    const cartao = atual.tipo === "cartao";
    const camposDeCartao = [
      mudanca.diaFechamento,
      mudanca.diaVencimento,
      mudanca.limiteCentavos,
      mudanca.contaPagamentoId,
    ];
    if (!cartao && camposDeCartao.some((c) => c !== undefined && c !== null)) {
      throw new ErroDasContas(MENSAGEM_SO_CARTAO);
    }
    if (cartao && (mudanca.diaFechamento === null || mudanca.diaVencimento === null)) {
      throw new ErroDasContas(MENSAGEM_CARTAO_SEM_DIAS);
    }
    const nova: Conta = {
      ...atual,
      nome: mudanca.nome ?? atual.nome,
      banco: mudanca.banco === undefined ? atual.banco : mudanca.banco,
      moeda: mudanca.moeda ?? atual.moeda,
      saldoInicialCentavos: mudanca.saldoInicialCentavos ?? atual.saldoInicialCentavos,
      saldoInicialEm: mudanca.saldoInicialEm === undefined ? atual.saldoInicialEm : mudanca.saldoInicialEm,
      ativa: mudanca.ativa ?? atual.ativa,
      diaFechamento: mudanca.diaFechamento ?? atual.diaFechamento,
      diaVencimento: mudanca.diaVencimento ?? atual.diaVencimento,
      limiteCentavos: mudanca.limiteCentavos === undefined ? atual.limiteCentavos : mudanca.limiteCentavos,
      contaPagamentoId:
        mudanca.contaPagamentoId === undefined ? atual.contaPagamentoId : mudanca.contaPagamentoId,
    };
    if (nova.moeda !== atual.moeda && this.repo.temLancamento(atual.id)) {
      throw new ErroDasContas(MENSAGEM_MOEDA_COM_LANCAMENTO);
    }
    if (nova.contaPagamentoId !== null && nova.contaPagamentoId !== atual.contaPagamentoId) {
      this.exigirContaDePagamento(nova.contaPagamentoId, atual.id, nova.moeda);
    }
    this.repo.definirConta(nova, this.instante(), carimbo);
    return this.avisarConta(this.exigirConta(atual.id));
  }

  /** Manda à lixeira; conta com lançamento (mesmo na lixeira) só arquiva. */
  apagarConta(pedido: PedidoConta, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigirConta(pedido.id);
    if (this.repo.temLancamento(atual.id)) throw new ErroDasContas(MENSAGEM_CONTA_COM_LANCAMENTO);
    this.repo.apagarConta(atual.id, this.instante(), carimbo);
    this.avisos.mudou({ partes: ["contas"], lancamentos: [], apagados: [] });
    return { ids: [atual.id] };
  }

  /** O saldo das contas ativas: o real somado, cada outra moeda à parte, nunca misturadas. */
  saldos(): SaldosDasContas {
    let totalCentavos = 0;
    const outras = new Map<string, number>();
    for (const conta of this.repo.contas(false)) {
      if (conta.moeda === MOEDA_PADRAO) totalCentavos += conta.saldoCentavos;
      else outras.set(conta.moeda, (outras.get(conta.moeda) ?? 0) + conta.saldoCentavos);
    }
    const outrasMoedas = [...outras]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moeda, saldoCentavos]) => ({ moeda, saldoCentavos }));
    return { totalCentavos, outrasMoedas };
  }

  // Faturas

  faturas(pedido: PedidoFaturas): Fatura[] {
    const cartao = this.exigirCartao(pedido.contaId);
    const hoje = this.hoje();
    return this.repo.faturas(cartao.id).map((f) => paraFatura(f, hoje));
  }

  /**
   * A fatura em que cai a compra do cartão no dia `data`, criada se ainda não existe (ADR-0046).
   * Os lançamentos chamam ao lançar no cartão, dentro da transação deles.
   */
  faturaDaCompra(contaId: string, data: string): Fatura {
    const cartao = this.exigirCartao(contaId);
    const datas = datasDaFatura(data, cartao.diaFechamento as number, cartao.diaVencimento as number);
    const linha =
      this.repo.faturaDoMes(cartao.id, datas.mesReferencia) ??
      this.repo.transacao(() => {
        this.repo.criarFatura(this.gerarId(), cartao.id, datas, this.instante());
        return this.repo.faturaDoMes(cartao.id, datas.mesReferencia) as LinhaFatura;
      });
    return paraFatura(linha, this.hoje());
  }

  /**
   * "Pagar fatura" registra o pagamento que você já fez no banco: uma transferência da conta de
   * pagamento para o cartão (dois lançamentos com o mesmo `transferencia_id`, categoria de
   * transferência, fora de gasto e de receita), que marca a fatura paga. Sem conta, a do cartão; sem
   * valor, o total; sem dia, hoje.
   */
  pagarFatura(pedido: PedidoPagarFatura, carimbo: Carimbo = DO_USUARIO): Fatura {
    const fatura = this.exigirFatura(pedido.id);
    if (fatura.paga === 1) throw new ErroDasContas(MENSAGEM_FATURA_PAGA);
    const cartao = this.exigirCartao(fatura.conta_id);
    const contaPagamentoId = pedido.contaPagamentoId ?? cartao.contaPagamentoId;
    if (contaPagamentoId === null) throw new ErroDasContas(MENSAGEM_SEM_CONTA_PAGAMENTO);
    const pagadora = this.exigirContaDePagamento(contaPagamentoId, cartao.id, cartao.moeda);
    const valor = pedido.valorCentavos ?? -fatura.total_centavos;
    if (valor <= 0) throw new ErroDasContas(MENSAGEM_FATURA_SEM_VALOR);
    const data = pedido.data ?? this.hoje();
    const agora = this.instante();
    const transferenciaId = this.gerarId();
    const saidaId = this.gerarId();
    const entradaId = this.gerarId();
    const descricao = `Pagamento da fatura ${cartao.nome} ${fatura.mes_referencia.slice(5, 7)}/${fatura.mes_referencia.slice(0, 4)}`;
    const lado = { data, descricao, categoriaId: CATEGORIA_TRANSFERENCIA, transferenciaId, agora };
    this.repo.transacao(() => {
      this.repo.criarLancamento(
        { ...lado, id: saidaId, contaId: pagadora.id, valorCentavos: -valor },
        carimbo,
      );
      this.repo.criarLancamento(
        { ...lado, id: entradaId, contaId: cartao.id, valorCentavos: valor },
        carimbo,
      );
      this.repo.marcarPagamento(fatura.id, entradaId, agora, carimbo);
    });
    this.avisos.mudou({
      partes: ["contas", "faturas", "lancamentos"],
      lancamentos: this.repo.lancamentosDaTransferencia(transferenciaId),
      apagados: [],
    });
    return paraFatura(this.exigirFatura(fatura.id), this.hoje());
  }

  /**
   * Desfaz o "Pagar fatura": os dois lados da transferência somem de vez (vivos ou na lixeira, o
   * pagamento nunca aconteceu) e a fatura volta a aberta ou fechada.
   */
  desfazerPagamento(pedido: PedidoFatura, carimbo: Carimbo = DO_USUARIO): Fatura {
    const fatura = this.exigirFatura(pedido.id);
    if (fatura.paga !== 1) throw new ErroDasContas(MENSAGEM_FATURA_NAO_PAGA);
    const pagamento =
      fatura.pagamento_lancamento_id === null ? null : this.repo.lancamento(fatura.pagamento_lancamento_id);
    const lados =
      pagamento === null
        ? []
        : pagamento.transferenciaId === null
          ? [pagamento]
          : this.repo.lancamentosDaTransferencia(pagamento.transferenciaId);
    const ids = lados.map((l) => l.id);
    this.repo.transacao(() => {
      this.repo.removerLancamentos(ids);
      this.repo.marcarPagamento(fatura.id, null, this.instante(), carimbo);
    });
    this.avisos.mudou({ partes: ["contas", "faturas", "lancamentos"], lancamentos: [], apagados: ids });
    return paraFatura(this.exigirFatura(fatura.id), this.hoje());
  }

  // Apoio

  private exigirConta(id: string): Conta {
    const conta = this.repo.conta(id);
    if (!conta) throw new ErroDasContas(MENSAGEM_CONTA_NAO_ENCONTRADA);
    return conta;
  }

  private exigirCartao(id: string): Conta {
    const conta = this.exigirConta(id);
    if (conta.tipo !== "cartao") throw new ErroDasContas(MENSAGEM_NAO_E_CARTAO);
    return conta;
  }

  private exigirFatura(id: string): LinhaFatura {
    const fatura = this.repo.fatura(id);
    if (!fatura) throw new ErroDasContas(MENSAGEM_FATURA_NAO_ENCONTRADA);
    return fatura;
  }

  /** De onde sai o pagamento do cartão: outra conta viva, ativa, que não é cartão, na mesma moeda. */
  private exigirContaDePagamento(id: string, cartaoId: string | null, moeda: string): Conta {
    const conta = this.repo.conta(id);
    if (!conta || conta.id === cartaoId || conta.tipo === "cartao" || !conta.ativa || conta.moeda !== moeda) {
      throw new ErroDasContas(MENSAGEM_PAGAMENTO_INVALIDO);
    }
    return conta;
  }

  private avisarConta(conta: Conta): Conta {
    this.avisos.mudou({ partes: ["contas"], lancamentos: [], apagados: [] });
    return conta;
  }

  private hoje(): string {
    return diaNoFuso(this.agora(), this.deps.lerFuso());
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

/** Aberta até o dia de fechamento; daí, fechada a pagar, até o pagamento. */
function estadoDaFatura(f: LinhaFatura, hoje: string): EstadoFatura {
  if (f.paga === 1) return "paga";
  return hoje >= f.fecha_em ? "fechada" : "aberta";
}

function paraFatura(f: LinhaFatura, hoje: string): Fatura {
  return {
    id: f.id,
    contaId: f.conta_id,
    mesReferencia: f.mes_referencia,
    fechaEm: f.fecha_em,
    venceEm: f.vence_em,
    totalCentavos: f.total_centavos,
    estado: estadoDaFatura(f, hoje),
    pagamentoLancamentoId: f.pagamento_lancamento_id,
    criadoEm: f.criado_em,
    atualizadoEm: f.atualizado_em,
  };
}
