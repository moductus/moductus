import type { DatabaseSync } from "node:sqlite";
import {
  formatarCentavos,
  MOEDA_PADRAO,
  type Apagados,
  type Divida,
  type Lancamento,
  type MudancaDivida,
  type MudancaFinancas,
  type NovaDivida,
  type Origem,
  type PagamentoDivida,
  type ParteFinancas,
  type PedidoDivida,
  type PedidoDividas,
  type PedidoPagamentoDivida,
  type PedidoQuitar,
  type PedidoSimulacao,
  type ResultadoQuitacao,
  type Simulacao,
  type TipoDivida,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { diaNoFuso, diasNoMes } from "../dia/tempo.ts";
import { paraLancamento, SELECT_LANCAMENTO, type LinhaLancamento } from "./contas.ts";
import { ErroDeValor, jurosDoMes } from "./dinheiro.ts";
import type { ServicoLancamentos } from "./lancamentos.ts";

/**
 * Dívidas da Tula (DATA.md §3, ADR-0046): cadastrar, editar, mandar à lixeira, registrar o pagamento
 * que você fez (ligado a um lançamento do extrato ou lançado numa conta), quitar e simular a
 * quitação. Todo mês, os juros entram sobre o saldo e depois sai a parcela; o custo total e a
 * simulação são calculados na hora e nada deles é gravado. A Tula organiza e calcula; nunca paga.
 */

export class ErroDasDividas extends Error {}

export const MENSAGEM_DIVIDA_NAO_ENCONTRADA = "dívida não encontrada";
export const MENSAGEM_DIVIDA_QUITADA = "a dívida já está quitada";
export const MENSAGEM_PAGAMENTO_ANTES_DO_SALDO =
  "o pagamento é de antes da data do saldo, e o saldo informado já o desconta";
export const MENSAGEM_LANCAMENTO_NAO_ENCONTRADO = "lançamento não encontrado";
export const MENSAGEM_LANCAMENTO_NAO_E_SAIDA = "o pagamento de uma dívida é uma saída da conta";
export const MENSAGEM_LANCAMENTO_DE_TRANSFERENCIA =
  "o lado de uma transferência entre as suas contas não paga dívida";
export const MENSAGEM_LANCAMENTO_JA_LIGADO = "o lançamento já está registrado como pagamento de uma dívida";
export const MENSAGEM_VALOR_DO_LANCAMENTO = "o valor do pagamento é o do lançamento";
export const MENSAGEM_PAGAMENTO_EM_REAL = "a dívida é em real: o pagamento sai de uma conta em real";
export const MENSAGEM_NADA_PARA_SIMULAR = "nenhuma dívida em aberto com juros e parcela para simular";
export const MENSAGEM_VALOR_GRANDE_DEMAIS = "os valores passam do maior que dá para calcular";

/** Até quantos meses a conta vai: dívida que leva mais que isso com a parcela não acaba (100 anos). */
export const LIMITE_MESES = 1200;

// ---------- Contas da dívida (testes de mesa) ----------

/** Soma em centavos que recusa passar do inteiro seguro. */
function somar(a: number, b: number): number {
  const soma = a + b;
  if (!Number.isSafeInteger(soma)) throw new ErroDeValor(MENSAGEM_VALOR_GRANDE_DEMAIS);
  return soma;
}

export interface Amortizacao {
  /** Quantas parcelas faltam pela conta, a última menor. */
  parcelas: number;
  /** Os juros que ainda vão: a soma das parcelas menos o saldo. */
  jurosCentavos: number;
  ultimaParcelaCentavos: number;
}

/**
 * A dívida mês a mês só com a parcela (ADR-0046): os juros do mês entram sobre o saldo, depois sai a
 * parcela, e a última é o que sobrou. Sem fim quando a parcela não passa dos juros do primeiro mês
 * (o saldo nunca cai) ou passa de `LIMITE_MESES`: aí, nada.
 */
export function amortizar(
  saldoCentavos: number,
  jurosBp: number,
  parcelaCentavos: number,
): Amortizacao | null {
  if (saldoCentavos === 0) return { parcelas: 0, jurosCentavos: 0, ultimaParcelaCentavos: 0 };
  if (parcelaCentavos <= jurosDoMes(saldoCentavos, jurosBp)) return null;
  let saldo = saldoCentavos;
  let juros = 0;
  let parcelas = 0;
  let ultima = 0;
  while (saldo > 0) {
    if (parcelas === LIMITE_MESES) return null;
    const doMes = jurosDoMes(saldo, jurosBp);
    saldo = somar(saldo, doMes);
    juros = somar(juros, doMes);
    ultima = Math.min(parcelaCentavos, saldo);
    saldo -= ultima;
    parcelas += 1;
  }
  return { parcelas, jurosCentavos: juros, ultimaParcelaCentavos: ultima };
}

/**
 * O custo total: os juros que ainda vão pela amortização, não parcela × parcelas − saldo. Fica fora
 * (vazio) a dívida sem taxa, sem parcela ou cuja parcela não a faz acabar.
 */
export function custoTotal(
  saldoCentavos: number,
  jurosBp: number,
  parcelaCentavos: number | null,
): number | null {
  if (jurosBp === 0 || parcelaCentavos === null) return null;
  try {
    return amortizar(saldoCentavos, jurosBp, parcelaCentavos)?.jurosCentavos ?? null;
  } catch (erro) {
    if (erro instanceof ErroDeValor) return null;
    throw erro;
  }
}

export type Estrategia = "semExtra" | "maiorJuro" | "menorSaldo";

export interface DividaParaSimular {
  id: string;
  saldoCentavos: number;
  jurosMensalBp: number;
  parcelaCentavos: number;
  /** O mês (`AAAA-MM`) da primeira parcela que entra na conta. */
  inicio: string;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const indiceDoMes = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;
const mesDoIndice = (indice: number) => `${Math.floor(indice / 12)}-${doisDigitos((indice % 12) + 1)}`;

/**
 * A fila da estratégia: maior juro primeiro (empate, o menor saldo) ou menor saldo primeiro (empate,
 * o maior juro), pelo saldo de hoje. Só com as parcelas, a ordem é a de entrada.
 */
function fila(dividas: readonly DividaParaSimular[], estrategia: Estrategia): DividaParaSimular[] {
  const ordem = [...dividas];
  if (estrategia === "maiorJuro") {
    ordem.sort(
      (a, b) =>
        b.jurosMensalBp - a.jurosMensalBp || a.saldoCentavos - b.saldoCentavos || a.id.localeCompare(b.id),
    );
  } else if (estrategia === "menorSaldo") {
    ordem.sort(
      (a, b) =>
        a.saldoCentavos - b.saldoCentavos || b.jurosMensalBp - a.jurosMensalBp || a.id.localeCompare(b.id),
    );
  }
  return ordem;
}

/**
 * A simulação mês a mês (ADR-0046). Em cada mês, os juros entram sobre o saldo de cada dívida que já
 * começou e cada uma recebe a parcela (a última, o que sobrou). Só com as parcelas, é isso: a
 * parcela da quitada não vai para outra. Nas estratégias, o mês tem sempre o mesmo caixa, o extra
 * mais as parcelas de todas as que já começaram: o que sobra depois das parcelas (o extra, as
 * parcelas das quitadas e a diferença da última) vai para a primeira da fila que ainda deve, e o que
 * sobrar dela, para a seguinte. Devolve em quantos meses tudo acaba, o mês, os juros pagos e o mês
 * de cada quitação. As parcelas precisam passar dos juros do primeiro mês (o serviço confere antes).
 */
export function simularQuitacao(
  dividas: readonly DividaParaSimular[],
  extraMensalCentavos: number,
  estrategia: Estrategia,
): ResultadoQuitacao {
  const abertas = dividas.filter((d) => d.saldoCentavos > 0);
  if (abertas.length === 0) throw new ErroDasDividas(MENSAGEM_NADA_PARA_SIMULAR);
  const ordem = fila(abertas, estrategia).map((d) => ({ ...d, comeca: indiceDoMes(d.inicio) }));
  const saldos = new Map(ordem.map((d) => [d.id, d.saldoCentavos]));
  const saldo = (id: string) => saldos.get(id) ?? 0;
  const comeco = Math.min(...ordem.map((d) => d.comeca));
  const extra = estrategia === "semExtra" ? 0 : extraMensalCentavos;
  const quitacoes: { id: string; mes: string }[] = [];
  let jurosPagos = 0;
  let ultimo = comeco;
  for (let mes = comeco; ordem.some((d) => saldo(d.id) > 0); mes++) {
    if (mes - comeco >= LIMITE_MESES) throw new ErroDeValor("a simulação não acaba em 100 anos");
    const ativas = ordem.filter((d) => d.comeca <= mes && saldo(d.id) > 0);
    for (const d of ativas) {
      const juros = jurosDoMes(saldo(d.id), d.jurosMensalBp);
      saldos.set(d.id, somar(saldo(d.id), juros));
      jurosPagos = somar(jurosPagos, juros);
    }
    let caixa = ordem.reduce(
      (total, d) => (d.comeca <= mes ? somar(total, d.parcelaCentavos) : total),
      extra,
    );
    for (const d of ativas) {
      const pago = Math.min(d.parcelaCentavos, saldo(d.id));
      saldos.set(d.id, saldo(d.id) - pago);
      caixa -= pago;
    }
    if (estrategia !== "semExtra") {
      for (const d of ativas) {
        if (caixa <= 0) break;
        const pago = Math.min(caixa, saldo(d.id));
        saldos.set(d.id, saldo(d.id) - pago);
        caixa -= pago;
      }
    }
    for (const d of ativas) {
      if (saldo(d.id) > 0) continue;
      quitacoes.push({ id: d.id, mes: mesDoIndice(mes) });
      ultimo = mes;
    }
  }
  return {
    meses: ultimo - comeco + 1,
    terminaEm: mesDoIndice(ultimo),
    jurosPagosCentavos: jurosPagos,
    quitacoes,
  };
}

/**
 * O dia da próxima parcela: o primeiro dia de vencimento depois da data do saldo (o mês curto usa o
 * último dia). O saldo do próprio dia de vencimento já é o que ficou depois da parcela daquele dia.
 */
export function proximaParcela(saldoEm: string, diaVencimento: number): string {
  let ano = Number(saldoEm.slice(0, 4));
  let mes = Number(saldoEm.slice(5, 7));
  const noMes = () =>
    `${ano}-${doisDigitos(mes)}-${doisDigitos(Math.min(diaVencimento, diasNoMes(ano, mes)))}`;
  if (noMes() > saldoEm) return noMes();
  if (mes === 12) [ano, mes] = [ano + 1, 1];
  else mes += 1;
  return noMes();
}

/** O mês da primeira parcela depois do saldo: pelo vencimento, ou o mês seguinte ao do saldo. */
function mesDaPrimeiraParcela(saldoEm: string, diaVencimento: number | null): string {
  if (diaVencimento !== null) return proximaParcela(saldoEm, diaVencimento).slice(0, 7);
  return mesDoIndice(indiceDoMes(saldoEm.slice(0, 7)) + 1);
}

// ---------- Repositório ----------

interface LinhaDivida {
  id: string;
  nome: string;
  credor: string | null;
  tipo: TipoDivida;
  saldo_centavos: number;
  saldo_em: string;
  juros_mensal_bp: number;
  parcela_centavos: number | null;
  parcelas_restantes: number | null;
  dia_vencimento: number | null;
  quitada_em: string | null;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** O que a dívida guarda e o serviço grava inteiro, na criação e em cada mudança. */
export interface CamposDivida {
  nome: string;
  credor: string | null;
  tipo: TipoDivida;
  saldoCentavos: number;
  saldoEm: string;
  jurosMensalBp: number;
  parcelaCentavos: number | null;
  parcelasRestantes: number | null;
  diaVencimento: number | null;
  quitadaEm: string | null;
}

const SELECT_DIVIDA = `
  SELECT id, nome, credor, tipo, saldo_centavos, saldo_em, juros_mensal_bp, parcela_centavos,
         parcelas_restantes, dia_vencimento, quitada_em, origem, agente_id, execucao_id, criado_em,
         atualizado_em
    FROM dividas`;

/** `dividas` (migração 031) e o `divida_id` do lançamento que pagou (030). */
export class RepositorioDividas {
  constructor(private readonly db: DatabaseSync) {}

  /** Vivas (fora da lixeira); sem `todas`, só as que não estão quitadas. Quitadas por último. */
  listar(todas: boolean): LinhaDivida[] {
    const filtro = todas ? "" : "AND quitada_em IS NULL";
    return this.db
      .prepare(
        `${SELECT_DIVIDA} WHERE apagado_em IS NULL ${filtro} ORDER BY quitada_em IS NOT NULL, nome, id`,
      )
      .all() as unknown as LinhaDivida[];
  }

  viva(id: string): LinhaDivida | null {
    return (
      (this.db.prepare(`${SELECT_DIVIDA} WHERE id = ? AND apagado_em IS NULL`).get(id) as
        LinhaDivida | undefined) ?? null
    );
  }

  criar(id: string, c: CamposDivida, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO dividas (id, nome, credor, tipo, saldo_centavos, saldo_em, juros_mensal_bp,
           parcela_centavos, parcelas_restantes, dia_vencimento, quitada_em,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        c.nome,
        c.credor,
        c.tipo,
        c.saldoCentavos,
        c.saldoEm,
        c.jurosMensalBp,
        c.parcelaCentavos,
        c.parcelasRestantes,
        c.diaVencimento,
        c.quitadaEm,
        agora,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
      );
  }

  gravar(id: string, c: CamposDivida, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE dividas SET nome = ?, credor = ?, tipo = ?, saldo_centavos = ?, saldo_em = ?,
           juros_mensal_bp = ?, parcela_centavos = ?, parcelas_restantes = ?, dia_vencimento = ?,
           quitada_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        c.nome,
        c.credor,
        c.tipo,
        c.saldoCentavos,
        c.saldoEm,
        c.jurosMensalBp,
        c.parcelaCentavos,
        c.parcelasRestantes,
        c.diaVencimento,
        c.quitadaEm,
        agora,
        o.origem,
        o.agente_id,
        o.execucao_id,
        id,
      );
  }

  apagar(id: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE dividas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** O lançamento vivo, com a moeda da conta. */
  lancamento(id: string): Lancamento | null {
    const linha = this.db.prepare(`${SELECT_LANCAMENTO} WHERE l.id = ? AND l.apagado_em IS NULL`).get(id) as
      LinhaLancamento | undefined;
    return linha ? paraLancamento(linha) : null;
  }

  /** A moeda da conta viva, ou nada quando ela não existe (os lançamentos dizem o erro). */
  moedaDaConta(id: string): string | null {
    const linha = this.db.prepare("SELECT moeda FROM contas WHERE id = ? AND apagado_em IS NULL").get(id) as
      { moeda: string } | undefined;
    return linha?.moeda ?? null;
  }

  /** O lançamento passa a ser o pagamento da dívida: assim não conta duas vezes. */
  ligarLancamento(lancamentoId: string, dividaId: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE lancamentos SET divida_id = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(dividaId, agora, o.origem, o.agente_id, o.execucao_id, lancamentoId);
  }

  /** Por `SAVEPOINT`, não `BEGIN`: a área pode ser chamada de dentro de outra transação. */
  transacao<T>(fazer: () => T): T {
    this.db.exec("SAVEPOINT dividas");
    try {
      const resultado = fazer();
      this.db.exec("RELEASE dividas");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK TO dividas");
      this.db.exec("RELEASE dividas");
      throw erro;
    }
  }
}

// ---------- Serviço ----------

export interface DepsDividas {
  /** O pagamento lançado numa conta entra pelos lançamentos (F4-09): fatura, categoria por regra. */
  lancamentos: Pick<ServicoLancamentos, "lancar">;
  /** O fuso de `config`, lido a cada pergunta: "hoje" muda quando o fuso muda. */
  lerFuso: () => string;
}

export interface AvisosDividas {
  /** O que mudou no dinheiro, de qualquer janela ou ferramenta (`financas.mudou`). */
  mudou: (mudanca: MudancaFinancas) => void;
}

export interface OpcoesDividas {
  agora?: () => Date;
  gerarId?: () => string;
}

export class ServicoDividas {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;

  constructor(
    private readonly repo: RepositorioDividas,
    private readonly deps: DepsDividas,
    private readonly avisos: AvisosDividas,
    opcoes: OpcoesDividas = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  /** As vivas; sem `todas`, só as que não estão quitadas. */
  listar(pedido: PedidoDividas = {}): Divida[] {
    return this.repo.listar(pedido.todas ?? false).map(paraDivida);
  }

  obter(pedido: PedidoDivida): Divida {
    return paraDivida(this.exigir(pedido.id));
  }

  /** Sem juros, zero: a dívida entra na lista, mas fica fora do custo total e da simulação. */
  criar(nova: NovaDivida, carimbo: Carimbo = DO_USUARIO): Divida {
    const id = this.gerarId();
    this.repo.criar(
      id,
      {
        nome: nova.nome,
        credor: nova.credor ?? null,
        tipo: nova.tipo,
        saldoCentavos: nova.saldoCentavos,
        saldoEm: nova.saldoEm,
        jurosMensalBp: nova.jurosMensalBp ?? 0,
        parcelaCentavos: nova.parcelaCentavos ?? null,
        parcelasRestantes: nova.parcelasRestantes ?? null,
        diaVencimento: nova.diaVencimento ?? null,
        quitadaEm: null,
      },
      this.instante(),
      carimbo,
    );
    return this.avisar(this.exigir(id));
  }

  /**
   * Mudança parcial. A quitada que volta a ter saldo deixa de estar quitada (foi engano, ou a
   * dívida voltou).
   */
  definir(mudanca: MudancaDivida, carimbo: Carimbo = DO_USUARIO): Divida {
    const atual = camposDe(this.exigir(mudanca.id));
    const nova: CamposDivida = {
      nome: mudanca.nome ?? atual.nome,
      credor: mudanca.credor === undefined ? atual.credor : mudanca.credor,
      tipo: mudanca.tipo ?? atual.tipo,
      saldoCentavos: mudanca.saldoCentavos ?? atual.saldoCentavos,
      saldoEm: mudanca.saldoEm ?? atual.saldoEm,
      jurosMensalBp: mudanca.jurosMensalBp ?? atual.jurosMensalBp,
      parcelaCentavos:
        mudanca.parcelaCentavos === undefined ? atual.parcelaCentavos : mudanca.parcelaCentavos,
      parcelasRestantes:
        mudanca.parcelasRestantes === undefined ? atual.parcelasRestantes : mudanca.parcelasRestantes,
      diaVencimento: mudanca.diaVencimento === undefined ? atual.diaVencimento : mudanca.diaVencimento,
      quitadaEm: atual.quitadaEm,
    };
    if (nova.quitadaEm !== null && nova.saldoCentavos > 0) nova.quitadaEm = null;
    this.repo.gravar(mudanca.id, nova, this.instante(), carimbo);
    return this.avisar(this.exigir(mudanca.id));
  }

  /** Manda à lixeira. Os lançamentos que a pagaram ficam como estão. */
  apagar(pedido: PedidoDivida, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigir(pedido.id);
    this.repo.apagar(atual.id, this.instante(), carimbo);
    this.avisos.mudou({ partes: ["dividas"], lancamentos: [], apagados: [] });
    return { ids: [atual.id] };
  }

  /**
   * Registra o pagamento que você fez: primeiro os juros do mês entram sobre o saldo, depois o resto
   * abate o saldo; falta uma parcela a menos e o saldo passa a ser o do dia do pagamento. O que zera
   * o saldo quita a dívida. Com `lancamentoId`, liga o lançamento do extrato (uma saída em real, do
   * mesmo valor, fora de transferência e de outro pagamento), para não contar duas vezes; com
   * `contaId`, lança a saída na conta. Tudo numa transação.
   */
  registrarPagamento(pedido: PedidoPagamentoDivida, carimbo: Carimbo = DO_USUARIO): PagamentoDivida {
    const atual = camposDe(this.exigir(pedido.id));
    const nome = atual.nome;
    if (atual.quitadaEm !== null) throw new ErroDasDividas(MENSAGEM_DIVIDA_QUITADA);
    if (pedido.data < atual.saldoEm) throw new ErroDasDividas(MENSAGEM_PAGAMENTO_ANTES_DO_SALDO);
    if (pedido.lancamentoId !== undefined)
      this.exigirLancamentoParaLigar(pedido.lancamentoId, pedido.valorCentavos);
    if (pedido.contaId !== undefined) {
      const moeda = this.repo.moedaDaConta(pedido.contaId);
      if (moeda !== null && moeda !== MOEDA_PADRAO) throw new ErroDasDividas(MENSAGEM_PAGAMENTO_EM_REAL);
    }
    const saldoNovo = Math.max(
      0,
      this.calcular(() => somar(atual.saldoCentavos, jurosDoMes(atual.saldoCentavos, atual.jurosMensalBp))) -
        pedido.valorCentavos,
    );
    const quitou = saldoNovo === 0;
    const nova: CamposDivida = {
      ...atual,
      saldoCentavos: saldoNovo,
      saldoEm: pedido.data,
      parcelasRestantes:
        atual.parcelasRestantes === null ? null : quitou ? 0 : Math.max(0, atual.parcelasRestantes - 1),
      quitadaEm: quitou ? pedido.data : null,
    };
    const agora = this.instante();
    const lancamentoId = this.repo.transacao(() => {
      let id = pedido.lancamentoId ?? null;
      if (pedido.contaId !== undefined) {
        const [lancado] = this.deps.lancamentos.lancar(
          {
            contaId: pedido.contaId,
            data: pedido.data,
            descricao: `Pagamento de ${nome}`,
            valorCentavos: -pedido.valorCentavos,
          },
          carimbo,
        );
        id = lancado?.id ?? null;
      }
      if (id !== null) this.repo.ligarLancamento(id, pedido.id, agora, carimbo);
      this.repo.gravar(pedido.id, nova, agora, carimbo);
      return id;
    });
    const lancamento = lancamentoId === null ? null : this.repo.lancamento(lancamentoId);
    const partes: ParteFinancas[] =
      lancamento === null
        ? ["dividas"]
        : lancamento.faturaId === null
          ? ["dividas", "lancamentos", "contas"]
          : ["dividas", "lancamentos", "contas", "faturas"];
    this.avisos.mudou({ partes, lancamentos: lancamento === null ? [] : [lancamento], apagados: [] });
    return { divida: this.obter({ id: pedido.id }), lancamento };
  }

  /** "Quitada": o saldo vai a zero, não falta parcela e a dívida sai da lista. Sem dia, hoje. */
  quitar(pedido: PedidoQuitar, carimbo: Carimbo = DO_USUARIO): Divida {
    const atual = camposDe(this.exigir(pedido.id));
    if (atual.quitadaEm !== null) throw new ErroDasDividas(MENSAGEM_DIVIDA_QUITADA);
    const data = pedido.data ?? this.hoje();
    this.repo.gravar(
      pedido.id,
      {
        ...atual,
        saldoCentavos: 0,
        saldoEm: data,
        parcelasRestantes: atual.parcelasRestantes === null ? null : 0,
        quitadaEm: data,
      },
      this.instante(),
      carimbo,
    );
    return this.avisar(this.exigir(pedido.id));
  }

  /**
   * Simula a quitação na hora, sem gravar nada (ADR-0046): só as parcelas, e com o extra pelas duas
   * estratégias. Sem a lista, as dívidas em aberto com saldo, taxa e parcela (a sem taxa fica fora);
   * com a lista, cada uma precisa ter as três. Cada dívida entra no mês da primeira parcela depois do
   * saldo, nunca antes do mês de hoje. Parcela que não passa dos juros do mês é recusada com o motivo.
   */
  simular(pedido: PedidoSimulacao): Simulacao {
    const linhas =
      pedido.ids === undefined
        ? this.repo
            .listar(false)
            .filter((l) => l.saldo_centavos > 0 && l.juros_mensal_bp > 0 && l.parcela_centavos !== null)
        : [...new Set(pedido.ids)].map((id) => this.exigirSimulavel(this.exigir(id)));
    if (linhas.length === 0) throw new ErroDasDividas(MENSAGEM_NADA_PARA_SIMULAR);
    const mesDeHoje = this.hoje().slice(0, 7);
    const itens = linhas.map((l): DividaParaSimular => {
      const parcela = this.exigirQueAcaba(l);
      const primeira = mesDaPrimeiraParcela(l.saldo_em, l.dia_vencimento);
      return {
        id: l.id,
        saldoCentavos: l.saldo_centavos,
        jurosMensalBp: l.juros_mensal_bp,
        parcelaCentavos: parcela,
        inicio: primeira > mesDeHoje ? primeira : mesDeHoje,
      };
    });
    const extra = pedido.extraMensalCentavos;
    return this.calcular(() => ({
      extraMensalCentavos: extra,
      semExtra: simularQuitacao(itens, 0, "semExtra"),
      maiorJuro: simularQuitacao(itens, extra, "maiorJuro"),
      menorSaldo: simularQuitacao(itens, extra, "menorSaldo"),
    }));
  }

  // ----- Apoio -----

  private exigir(id: string): LinhaDivida {
    const linha = this.repo.viva(id);
    if (!linha) throw new ErroDasDividas(MENSAGEM_DIVIDA_NAO_ENCONTRADA);
    return linha;
  }

  /** Na simulação pedida pela lista: em aberto, com saldo, taxa e parcela. */
  private exigirSimulavel(l: LinhaDivida): LinhaDivida {
    if (l.quitada_em !== null) throw new ErroDasDividas(`${l.nome} já está quitada`);
    if (l.saldo_centavos === 0) throw new ErroDasDividas(`${l.nome} está sem saldo a pagar`);
    if (l.juros_mensal_bp === 0) {
      throw new ErroDasDividas(`${l.nome} está sem a taxa de juros, e sem ela fica fora da simulação`);
    }
    if (l.parcela_centavos === null) {
      throw new ErroDasDividas(`${l.nome} está sem a parcela, e sem ela fica fora da simulação`);
    }
    return l;
  }

  /** A parcela, se ela faz a dívida acabar; senão, o motivo. */
  private exigirQueAcaba(l: LinhaDivida): number {
    const parcela = l.parcela_centavos as number;
    const juros = this.calcular(() => jurosDoMes(l.saldo_centavos, l.juros_mensal_bp));
    if (parcela <= juros) {
      throw new ErroDasDividas(
        `a parcela de ${l.nome}, ${formatarCentavos(parcela)}, não passa dos juros do mês, ` +
          `${formatarCentavos(juros)}: só com ela, a dívida não acaba`,
      );
    }
    if (this.calcular(() => amortizar(l.saldo_centavos, l.juros_mensal_bp, parcela)) === null) {
      throw new ErroDasDividas(`só com a parcela, ${l.nome} levaria mais de 100 anos para acabar`);
    }
    return parcela;
  }

  private exigirLancamentoParaLigar(id: string, valorCentavos: number): Lancamento {
    const lancamento = this.repo.lancamento(id);
    if (!lancamento) throw new ErroDasDividas(MENSAGEM_LANCAMENTO_NAO_ENCONTRADO);
    if (lancamento.valorCentavos >= 0) throw new ErroDasDividas(MENSAGEM_LANCAMENTO_NAO_E_SAIDA);
    if (lancamento.transferenciaId !== null) throw new ErroDasDividas(MENSAGEM_LANCAMENTO_DE_TRANSFERENCIA);
    if (lancamento.dividaId !== null) throw new ErroDasDividas(MENSAGEM_LANCAMENTO_JA_LIGADO);
    if (lancamento.moeda !== MOEDA_PADRAO) throw new ErroDasDividas(MENSAGEM_PAGAMENTO_EM_REAL);
    if (-lancamento.valorCentavos !== valorCentavos) throw new ErroDasDividas(MENSAGEM_VALOR_DO_LANCAMENTO);
    return lancamento;
  }

  /** A conta que passa do inteiro seguro volta como erro da regra, não como falha por dentro. */
  private calcular<T>(fazer: () => T): T {
    try {
      return fazer();
    } catch (erro) {
      if (erro instanceof ErroDeValor) throw new ErroDasDividas(MENSAGEM_VALOR_GRANDE_DEMAIS);
      throw erro;
    }
  }

  private avisar(linha: LinhaDivida): Divida {
    this.avisos.mudou({ partes: ["dividas"], lancamentos: [], apagados: [] });
    return paraDivida(linha);
  }

  private hoje(): string {
    return diaNoFuso(this.agora(), this.deps.lerFuso());
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

function camposDe(l: LinhaDivida): CamposDivida {
  return {
    nome: l.nome,
    credor: l.credor,
    tipo: l.tipo,
    saldoCentavos: l.saldo_centavos,
    saldoEm: l.saldo_em,
    jurosMensalBp: l.juros_mensal_bp,
    parcelaCentavos: l.parcela_centavos,
    parcelasRestantes: l.parcelas_restantes,
    diaVencimento: l.dia_vencimento,
    quitadaEm: l.quitada_em,
  };
}

/** O custo e a próxima parcela saem da linha na hora; a quitada e a sem parcela a vencer não têm próxima. */
function paraDivida(l: LinhaDivida): Divida {
  const emAberto = l.quitada_em === null && l.saldo_centavos > 0 && l.parcelas_restantes !== 0;
  return {
    id: l.id,
    nome: l.nome,
    credor: l.credor,
    tipo: l.tipo,
    saldoCentavos: l.saldo_centavos,
    saldoEm: l.saldo_em,
    jurosMensalBp: l.juros_mensal_bp,
    parcelaCentavos: l.parcela_centavos,
    parcelasRestantes: l.parcelas_restantes,
    diaVencimento: l.dia_vencimento,
    quitadaEm: l.quitada_em,
    custoTotalCentavos: custoTotal(l.saldo_centavos, l.juros_mensal_bp, l.parcela_centavos),
    proximaParcelaEm:
      emAberto && l.dia_vencimento !== null ? proximaParcela(l.saldo_em, l.dia_vencimento) : null,
    origem: l.origem,
    agenteId: l.agente_id,
    execucaoId: l.execucao_id,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}
