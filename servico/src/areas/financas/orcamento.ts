import type { DatabaseSync } from "node:sqlite";
import {
  formatarCentavos,
  type Apagados,
  type DefinicaoOrcamento,
  type LinhaOrcamento,
  type MudancaFinancas,
  type Orcamento,
  type OrcamentoMes,
  type Origem,
  type PedidoDesfazerRemanejar,
  type PedidoMes,
  type PedidoOrcamento,
  type PedidoRemanejar,
  type Remanejamento,
  type SituacaoOrcamento,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { diaDaSemana, diaNoFuso, diasEntre, somarDias } from "../dia/tempo.ts";
import { proporcional } from "./dinheiro.ts";
import { periodoDoMes, type ServicoLancamentos } from "./lancamentos.ts";

/**
 * O orçamento da Tula (DATA.md §3, ADR-0046): o limite de cada categoria de gasto num mês ou em todo
 * mês (a linha do mês vence a de todo mês), o gasto do mês contra ele com a mãe somando as filhas
 * (o de `gastoPorCategoria` dos lançamentos, sem conta própria), o percentual e o que sobra; a
 * semana de hoje como a parte do limite do mês proporcional aos dias dela dentro do mês ("previsto");
 * e remanejar entre categorias só naquele mês, com desfazer. Mês sem orçamento volta vazio: nenhum
 * limite é inventado.
 */

/** Erro com texto para quem usa; o que não for daqui sai pelo canal como erro genérico. */
export class ErroDoOrcamento extends Error {}

export const MENSAGEM_ORCAMENTO_NAO_ENCONTRADO = "orçamento não encontrado";
export const MENSAGEM_CATEGORIA_NAO_ENCONTRADA = "categoria não encontrada";
export const MENSAGEM_CATEGORIA_ARQUIVADA = "a categoria está arquivada";
export const MENSAGEM_SO_GASTO = "orçamento é só para categoria de gasto";
export const MENSAGEM_ORIGEM_SEM_ORCAMENTO = "a categoria de onde sai o valor não tem orçamento neste mês";
export const MENSAGEM_PASSA_DO_LIMITE = (limite: number) =>
  `o valor passa do limite da categoria de onde ele sai neste mês (${formatarCentavos(limite)})`;
export const MENSAGEM_REMANEJAR_SUMIU =
  "Este remanejamento não dá mais para desfazer: passou o prazo de 24 horas ou o Moductus reiniciou desde então. Ajuste os limites à mão.";
export const MENSAGEM_ORCAMENTO_MUDOU =
  "Os limites dessas categorias mudaram depois de remanejar: ajuste à mão para não desfazer a mudança nova.";
export const MENSAGEM_JA_DESFEITO = "Este remanejamento já foi desfeito.";
export const MENSAGEM_MESMA_CATEGORIA = "remanejar é entre categorias diferentes";
export const MENSAGEM_MAE_E_FILHA =
  "remanejar entre a categoria e a subcategoria dela mudaria o total do mês: ajuste os limites à mão";
export const MENSAGEM_FILHA_DE_MAE_COM_LIMITE =
  "a subcategoria já conta no limite da categoria mãe neste mês: remaneje pela categoria mãe";
export const MENSAGEM_MAE_SEM_LIMITE_COM_FILHA =
  "dar limite a esta categoria tiraria do total o limite da subcategoria dela: defina o limite da categoria à mão";

/** Quanto do limite já avisa, quando a definição não diz (o padrão da coluna, 031). */
export const ALERTA_PADRAO = 80;
/** Por quanto tempo o remanejamento se desfaz: o mesmo dia inteiro do histórico dos agentes. */
export const PRAZO_DESFAZER_REMANEJAR_MS = 24 * 60 * 60 * 1000;

// ---------- Banco ----------

interface LinhaBanco {
  id: string;
  categoria_id: string;
  mes: string | null;
  limite_centavos: number;
  alerta_percentual: number;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface LinhaVigente extends LinhaBanco {
  categoria_nome: string;
  categoria_pai_id: string | null;
  pai_nome: string | null;
}

const COLUNAS = `o.id, o.categoria_id, o.mes, o.limite_centavos, o.alerta_percentual,
  o.origem, o.agente_id, o.execucao_id, o.criado_em, o.atualizado_em`;

const paraOrcamento = (l: LinhaBanco): Orcamento => ({
  id: l.id,
  categoriaId: l.categoria_id,
  mes: l.mes,
  limiteCentavos: l.limite_centavos,
  alertaPercentual: l.alerta_percentual,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

/** O limite que vale numa categoria no mês, com o nome dela e da mãe para ordenar. */
export interface Vigente {
  orcamento: Orcamento;
  nome: string;
  categoriaPaiId: string | null;
  nomePai: string | null;
}

export class RepositorioOrcamento {
  constructor(private readonly db: DatabaseSync) {}

  orcamento(id: string): Orcamento | null {
    const l = this.db.prepare(`SELECT ${COLUNAS} FROM orcamentos o WHERE o.id = ?`).get(id) as
      LinhaBanco | undefined;
    return l ? paraOrcamento(l) : null;
  }

  /** A linha da categoria naquele mês, ou a de todo mês com `mes` vazio. */
  doMes(categoriaId: string, mes: string | null): Orcamento | null {
    const l = this.db
      .prepare(`SELECT ${COLUNAS} FROM orcamentos o WHERE o.categoria_id = ? AND ifnull(o.mes, '') = ?`)
      .get(categoriaId, mes ?? "") as LinhaBanco | undefined;
    return l ? paraOrcamento(l) : null;
  }

  /**
   * O limite que vale no mês em cada categoria de gasto viva (fora da lixeira): a linha do mês, ou a
   * de todo mês quando não há a do mês. A de todo mês de categoria arquivada não vale mais; a linha
   * de um mês, sim (é o que valia naquele mês).
   */
  vigentes(mes: string): Vigente[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS}, c.nome AS categoria_nome, c.categoria_pai_id, p.nome AS pai_nome
           FROM orcamentos o
           JOIN categorias c ON c.id = o.categoria_id AND c.apagado_em IS NULL AND c.tipo = 'gasto'
           LEFT JOIN categorias p ON p.id = c.categoria_pai_id
          WHERE o.mes = ?
             OR (o.mes IS NULL AND c.arquivada = 0 AND NOT EXISTS (
                   SELECT 1 FROM orcamentos m WHERE m.categoria_id = o.categoria_id AND m.mes = ?))`,
      )
      .all(mes, mes) as unknown as LinhaVigente[];
    return linhas.map((l) => ({
      orcamento: paraOrcamento(l),
      nome: l.categoria_nome,
      categoriaPaiId: l.categoria_pai_id,
      nomePai: l.pai_nome,
    }));
  }

  /** A categoria viva (fora da lixeira), com o que o orçamento confere. */
  categoria(id: string): { tipo: string; arquivada: boolean; categoriaPaiId: string | null } | null {
    const l = this.db
      .prepare("SELECT tipo, arquivada, categoria_pai_id FROM categorias WHERE id = ? AND apagado_em IS NULL")
      .get(id) as { tipo: string; arquivada: number; categoria_pai_id: string | null } | undefined;
    return l ? { tipo: l.tipo, arquivada: l.arquivada === 1, categoriaPaiId: l.categoria_pai_id } : null;
  }

  criar(
    o: { id: string; categoriaId: string; mes: string | null; limite: number; alerta: number },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const c = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO orcamentos (id, categoria_id, mes, limite_centavos, alerta_percentual,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id,
        o.categoriaId,
        o.mes,
        o.limite,
        o.alerta,
        agora,
        agora,
        c.origem,
        c.agente_id,
        c.execucao_id,
      );
  }

  definir(id: string, limite: number, alerta: number, agora: string, carimbo: Carimbo): void {
    const c = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE orcamentos SET limite_centavos = ?, alerta_percentual = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ?`,
      )
      .run(limite, alerta, agora, c.origem, c.agente_id, c.execucao_id, id);
  }

  /** A linha volta a ser exatamente como era, carimbo e instante inclusive (o desfazer). */
  restaurar(o: Orcamento): void {
    this.db
      .prepare(
        `UPDATE orcamentos SET limite_centavos = ?, alerta_percentual = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ?`,
      )
      .run(o.limiteCentavos, o.alertaPercentual, o.atualizadoEm, o.origem, o.agenteId, o.execucaoId, o.id);
  }

  /** Sem lixeira (031): tirar o orçamento é voltar a não ter limite. */
  apagar(id: string): void {
    this.db.prepare("DELETE FROM orcamentos WHERE id = ?").run(id);
  }

  /** Por `SAVEPOINT`, não `BEGIN`: a área pode ser chamada de dentro de outra transação. */
  transacao<T>(fazer: () => T): T {
    this.db.exec("SAVEPOINT orcamento");
    try {
      const resultado = fazer();
      this.db.exec("RELEASE orcamento");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK TO orcamento");
      this.db.exec("RELEASE orcamento");
      throw erro;
    }
  }
}

// ---------- Semana ----------

/**
 * A semana de hoje (segunda a domingo, como o "até domingo" do painel) dentro do mês: a que começa
 * ou acaba no mês vizinho fica só com os dias deste. `diasRestantes` conta hoje.
 */
export function semanaNoMes(
  hoje: string,
  mes: string,
): { inicio: string; fim: string; dias: number; diasRestantes: number } {
  const periodo = periodoDoMes(mes);
  const segunda = somarDias(hoje, -((diaDaSemana(hoje) + 6) % 7));
  const domingo = somarDias(segunda, 6);
  const inicio = segunda < periodo.inicio ? periodo.inicio : segunda;
  const fim = domingo > periodo.fim ? periodo.fim : domingo;
  return { inicio, fim, dias: diasEntre(inicio, fim) + 1, diasRestantes: diasEntre(hoje, fim) + 1 };
}

// ---------- Serviço ----------

export interface DepsOrcamento {
  /** O gasto por categoria com a mãe somando as filhas (F4-09): o orçamento não refaz a conta. */
  lancamentos: Pick<ServicoLancamentos, "gastoPorCategoria">;
  /** O fuso de `config`, lido a cada pergunta: "este mês" e "esta semana" mudam com ele. */
  lerFuso: () => string;
}

export interface AvisosOrcamento {
  /** O que mudou no dinheiro (`financas.mudou`). */
  mudou: (mudanca: MudancaFinancas) => void;
}

export interface OpcoesOrcamento {
  agora?: () => Date;
  gerarId?: () => string;
}

/** Uma ponta do remanejamento: a linha do mês como era (vazia se ele a criou) e como ficou. */
interface PontaRemanejada {
  antes: Orcamento | null;
  depois: Orcamento;
}

interface Remanejado {
  mes: string;
  em: number;
  pontas: [PontaRemanejada, PontaRemanejada];
  /** Já desfeito: o segundo desfazer diz isso em vez de "não dá mais". */
  desfeito: boolean;
}

export class ServicoOrcamento {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  /**
   * Os remanejamentos que ainda se desfazem, pelo id devolvido. Na memória, como o desfazer da
   * captura: o banco não guarda remanejamento (DATA.md §3), e depois de reiniciar o desfazer diz
   * por que não dá mais.
   */
  private readonly remanejados = new Map<string, Remanejado>();

  constructor(
    private readonly repo: RepositorioOrcamento,
    private readonly deps: DepsOrcamento,
    private readonly avisos: AvisosOrcamento,
    opcoes: OpcoesOrcamento = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  /**
   * O orçamento do mês (sem mês, o de hoje no fuso): uma linha por categoria com limite, da mãe
   * para as filhas em ordem de nome, e os totais. O total soma os limites e os gastos das linhas
   * cuja mãe não tem limite: a filha com limite já está no gasto da mãe e não conta duas vezes. A
   * semana só aparece no mês de hoje.
   */
  orcamento(pedido: PedidoMes = {}): OrcamentoMes {
    const hoje = this.hoje();
    const mes = pedido.mes ?? hoje.slice(0, 7);
    const vigentes = this.repo.vigentes(mes).sort(compararVigentes);
    if (vigentes.length === 0) {
      return { mes, linhas: [], limiteCentavos: 0, gastoCentavos: 0, semana: null };
    }
    const periodo = periodoDoMes(mes);
    const diasDoMes = diasEntre(periodo.inicio, periodo.fim) + 1;
    const gastoMes = this.gastos(periodo.inicio, periodo.fim);
    const semana = hoje.slice(0, 7) === mes ? semanaNoMes(hoje, mes) : null;
    const gastoSemana = semana ? this.gastos(semana.inicio, semana.fim) : null;

    const comLimite = new Set(vigentes.map((v) => v.orcamento.categoriaId));
    let limiteTotal = 0;
    let gastoTotal = 0;
    let gastoTotalSemana = 0;
    const linhas = vigentes.map(({ orcamento: o, categoriaPaiId }): LinhaOrcamento => {
      const gasto = gastoMes.get(o.categoriaId) ?? 0;
      const naSemana = gastoSemana?.get(o.categoriaId) ?? 0;
      if (categoriaPaiId === null || !comLimite.has(categoriaPaiId)) {
        limiteTotal += o.limiteCentavos;
        gastoTotal += gasto;
        gastoTotalSemana += naSemana;
      }
      const percentual = percentualDo(gasto, o.limiteCentavos);
      return {
        orcamentoId: o.id,
        categoriaId: o.categoriaId,
        doMes: o.mes !== null,
        limiteCentavos: o.limiteCentavos,
        alertaPercentual: o.alertaPercentual,
        gastoCentavos: gasto,
        percentual,
        sobraCentavos: o.limiteCentavos - gasto,
        situacao: situacaoDo(gasto, o.limiteCentavos, percentual, o.alertaPercentual),
        semana: semana
          ? {
              previstoCentavos: proporcional(o.limiteCentavos, semana.dias, diasDoMes),
              gastoCentavos: naSemana,
            }
          : null,
      };
    });
    return {
      mes,
      linhas,
      limiteCentavos: limiteTotal,
      gastoCentavos: gastoTotal,
      semana: semana
        ? {
            inicio: semana.inicio,
            fim: semana.fim,
            // Arredondado uma vez sobre o total, não somando as linhas já arredondadas.
            previstoCentavos: proporcional(limiteTotal, semana.dias, diasDoMes),
            gastoCentavos: gastoTotalSemana,
            diasRestantes: semana.diasRestantes,
          }
        : null,
    };
  }

  /**
   * Define o limite de uma categoria de gasto num mês ou, com `mes: null`, em todo mês. Já havendo
   * a linha, muda o limite (e o alerta, se veio) na mesma linha.
   */
  definirOrcamento(definicao: DefinicaoOrcamento, carimbo: Carimbo = DO_USUARIO): Orcamento {
    this.exigirCategoria(definicao.categoriaId);
    const agora = this.instante();
    const id = this.repo.transacao(() => {
      const atual = this.repo.doMes(definicao.categoriaId, definicao.mes);
      if (atual) {
        const alerta = definicao.alertaPercentual ?? atual.alertaPercentual;
        this.repo.definir(atual.id, definicao.limiteCentavos, alerta, agora, carimbo);
        return atual.id;
      }
      const id = this.gerarId();
      this.repo.criar(
        {
          id,
          categoriaId: definicao.categoriaId,
          mes: definicao.mes,
          limite: definicao.limiteCentavos,
          alerta: definicao.alertaPercentual ?? ALERTA_PADRAO,
        },
        agora,
        carimbo,
      );
      return id;
    });
    this.avisar();
    return this.exigirOrcamento(id);
  }

  /** Tira o limite: a categoria volta a não ter orçamento (no mês, ou em todo mês). */
  removerOrcamento(pedido: PedidoOrcamento): Apagados {
    this.exigirOrcamento(pedido.id);
    this.repo.apagar(pedido.id);
    this.avisar();
    return { ids: [pedido.id] };
  }

  /**
   * Move `valorCentavos` do limite de uma categoria para o de outra, só naquele mês (ADR-0046): cada
   * uma ganha a linha do mês, que parte do limite que valia (o de todo mês, ou nenhum); a de todo
   * mês fica como estava. A de origem precisa ter limite no mês e não fica negativa. Devolve o
   * orçamento do mês e o id que desfaz por 24 horas.
   */
  remanejar(pedido: PedidoRemanejar, carimbo: Carimbo = DO_USUARIO): Remanejamento {
    const { deCategoriaId, paraCategoriaId, mes, valorCentavos } = pedido;
    if (deCategoriaId === paraCategoriaId) throw new ErroDoOrcamento(MENSAGEM_MESMA_CATEGORIA);
    const de = this.exigirCategoria(deCategoriaId);
    const para = this.exigirCategoria(paraCategoriaId);
    this.exigirTotalIgual(deCategoriaId, de.categoriaPaiId, paraCategoriaId, para.categoriaPaiId, mes);
    const agora = this.instante();
    const pontas = this.repo.transacao((): [PontaRemanejada, PontaRemanejada] => {
      const de = this.vigente(deCategoriaId, mes);
      if (!de) throw new ErroDoOrcamento(MENSAGEM_ORIGEM_SEM_ORCAMENTO);
      if (valorCentavos > de.limiteCentavos) {
        throw new ErroDoOrcamento(MENSAGEM_PASSA_DO_LIMITE(de.limiteCentavos));
      }
      const para = this.vigente(paraCategoriaId, mes);
      return [
        this.ajustarNoMes(deCategoriaId, mes, de, -valorCentavos, agora, carimbo),
        this.ajustarNoMes(paraCategoriaId, mes, para, valorCentavos, agora, carimbo),
      ];
    });
    const id = this.gerarId();
    this.esquecerVencidos();
    this.remanejados.set(id, { mes, em: this.agora().getTime(), pontas, desfeito: false });
    this.avisar();
    return { id, orcamento: this.orcamento({ mes }) };
  }

  /**
   * Desfaz o remanejamento: as linhas que ele criou somem e as que ele mudou voltam a ser como eram.
   * Uma vez só, por 24 horas, e só se ninguém mexeu nessas linhas depois (limite, alerta ou
   * qualquer gravação): aí desfazer apagaria a mudança nova, e ele diz para ajustar à mão.
   */
  desfazerRemanejar(pedido: PedidoDesfazerRemanejar): OrcamentoMes {
    const remanejado = this.remanejados.get(pedido.id);
    if (!remanejado || this.agora().getTime() - remanejado.em > PRAZO_DESFAZER_REMANEJAR_MS) {
      this.remanejados.delete(pedido.id);
      throw new ErroDoOrcamento(MENSAGEM_REMANEJAR_SUMIU);
    }
    if (remanejado.desfeito) throw new ErroDoOrcamento(MENSAGEM_JA_DESFEITO);
    this.repo.transacao(() => {
      for (const { depois } of remanejado.pontas) {
        const atual = this.repo.orcamento(depois.id);
        if (
          atual?.limiteCentavos !== depois.limiteCentavos ||
          atual.alertaPercentual !== depois.alertaPercentual ||
          atual.atualizadoEm !== depois.atualizadoEm
        ) {
          throw new ErroDoOrcamento(MENSAGEM_ORCAMENTO_MUDOU);
        }
      }
      for (const ponta of remanejado.pontas) {
        if (ponta.antes === null) this.repo.apagar(ponta.depois.id);
        else this.repo.restaurar(ponta.antes);
      }
    });
    remanejado.desfeito = true;
    this.avisar();
    return this.orcamento({ mes: remanejado.mes });
  }

  // ----- Apoio -----

  /** A linha do mês, ou a de todo mês. */
  private vigente(categoriaId: string, mes: string): Orcamento | null {
    return this.repo.doMes(categoriaId, mes) ?? this.repo.doMes(categoriaId, null);
  }

  /** Soma `delta` ao limite da linha do mês, criando-a a partir do limite que valia. */
  private ajustarNoMes(
    categoriaId: string,
    mes: string,
    vigente: Orcamento | null,
    delta: number,
    agora: string,
    carimbo: Carimbo,
  ): PontaRemanejada {
    const limite = (vigente?.limiteCentavos ?? 0) + delta;
    if (vigente?.mes === mes) {
      this.repo.definir(vigente.id, limite, vigente.alertaPercentual, agora, carimbo);
      return { antes: vigente, depois: this.exigirOrcamento(vigente.id) };
    }
    const id = this.gerarId();
    const alerta = vigente?.alertaPercentual ?? ALERTA_PADRAO;
    this.repo.criar({ id, categoriaId, mes, limite, alerta }, agora, carimbo);
    return { antes: null, depois: this.exigirOrcamento(id) };
  }

  /**
   * Remanejar só troca limite de lugar: o total do mês fica igual. Recusa o que o mudaria, porque a
   * filha com limite sai ou entra na conta do total conforme a mãe tem limite: mãe e filha entre
   * si; a filha cuja mãe tem limite no mês (ela já está no limite da mãe); e dar limite à mãe que
   * não tem, quando uma filha dela tem (a filha sairia do total).
   */
  private exigirTotalIgual(
    deId: string,
    dePaiId: string | null,
    paraId: string,
    paraPaiId: string | null,
    mes: string,
  ): void {
    if (dePaiId === paraId || paraPaiId === deId) throw new ErroDoOrcamento(MENSAGEM_MAE_E_FILHA);
    const comLimite = new Map(
      this.repo.vigentes(mes).map((v) => [v.orcamento.categoriaId, v.categoriaPaiId]),
    );
    for (const paiId of [dePaiId, paraPaiId]) {
      if (paiId !== null && comLimite.has(paiId)) throw new ErroDoOrcamento(MENSAGEM_FILHA_DE_MAE_COM_LIMITE);
    }
    if (paraPaiId === null && !comLimite.has(paraId) && [...comLimite.values()].includes(paraId)) {
      throw new ErroDoOrcamento(MENSAGEM_MAE_SEM_LIMITE_COM_FILHA);
    }
  }

  private esquecerVencidos(): void {
    const agora = this.agora().getTime();
    for (const [id, r] of this.remanejados) {
      if (agora - r.em > PRAZO_DESFAZER_REMANEJAR_MS) this.remanejados.delete(id);
    }
  }

  private gastos(inicio: string, fim: string): Map<string, number> {
    const gastos = new Map<string, number>();
    for (const g of this.deps.lancamentos.gastoPorCategoria(inicio, fim)) {
      if (g.categoriaId !== null) gastos.set(g.categoriaId, g.gastoCentavos);
    }
    return gastos;
  }

  private exigirCategoria(id: string): { categoriaPaiId: string | null } {
    const categoria = this.repo.categoria(id);
    if (!categoria) throw new ErroDoOrcamento(MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    if (categoria.tipo !== "gasto") throw new ErroDoOrcamento(MENSAGEM_SO_GASTO);
    if (categoria.arquivada) throw new ErroDoOrcamento(MENSAGEM_CATEGORIA_ARQUIVADA);
    return categoria;
  }

  private exigirOrcamento(id: string): Orcamento {
    const orcamento = this.repo.orcamento(id);
    if (!orcamento) throw new ErroDoOrcamento(MENSAGEM_ORCAMENTO_NAO_ENCONTRADO);
    return orcamento;
  }

  private avisar(): void {
    this.avisos.mudou({ partes: ["orcamento"], lancamentos: [], apagados: [] });
  }

  private hoje(): string {
    return diaNoFuso(this.agora(), this.deps.lerFuso());
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

/**
 * Percentual inteiro do limite. Limite zero ("não gastar nada aqui") com gasto já é o limite
 * inteiro: 100, e a situação diz que passou.
 */
function percentualDo(gasto: number, limite: number): number {
  if (limite === 0) return gasto > 0 ? 100 : 0;
  return proporcional(gasto, 100, limite);
}

/** Passou do limite pelo centavo; no alerta pelo percentual que aparece na tela. */
function situacaoDo(gasto: number, limite: number, percentual: number, alerta: number): SituacaoOrcamento {
  if (gasto > limite) return "estourado";
  if (gasto > 0 && percentual >= alerta) return "alerta";
  return "ok";
}

/** A mãe e logo abaixo as filhas, em ordem de nome pt-BR. */
function compararVigentes(a: Vigente, b: Vigente): number {
  const grupo = (v: Vigente) => v.nomePai ?? v.nome;
  const idDoGrupo = (v: Vigente) => v.categoriaPaiId ?? v.orcamento.categoriaId;
  return (
    grupo(a).localeCompare(grupo(b), "pt-BR") ||
    idDoGrupo(a).localeCompare(idDoGrupo(b)) ||
    Number(a.categoriaPaiId !== null) - Number(b.categoriaPaiId !== null) ||
    a.nome.localeCompare(b.nome, "pt-BR") ||
    a.orcamento.id.localeCompare(b.orcamento.id)
  );
}
