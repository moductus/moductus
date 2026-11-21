import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante, Recorrencia } from "./comum.ts";

/**
 * O dinheiro da Tula (DATA.md §3; migrações 029 a 031; ADR-0045, ADR-0046): contas e cartões,
 * faturas, lançamentos, categorias e regras, orçamento, recorrentes, resumo e relatórios. A regra
 * (saldo derivado, fatura pelo dia de fechamento, parcelas, orçamento proporcional da semana) mora
 * em `areas/financas` no serviço; aqui só a forma do que vai e volta. Valor é sempre centavo
 * inteiro com sinal, negativo é saída; o texto sai de `dinheiro.ts`.
 */

/** Centavos inteiros com sinal (negativo é saída). O `int` do Zod já recusa o que passa do inteiro seguro. */
export const Centavos = z.number().int();
export type Centavos = z.infer<typeof Centavos>;

/** Quantia sem sinal, para totais de saída mostrados como "Saídas R$ 3.214,77". */
const Quantia = Centavos.nonnegative();

/** Código ISO 4217, como o banco guarda (`BRL`, `USD`). */
export const Moeda = z.string().regex(/^[A-Z]{3}$/, "moeda em código ISO 4217");
export type Moeda = z.infer<typeof Moeda>;

/** Mês `AAAA-MM`, de 01 a 12, como `orcamentos.mes` e `faturas.mes_referencia`. */
export const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mês no formato AAAA-MM");
export type Mes = z.infer<typeof Mes>;

/** Dia do mês de 1 a 31; o mês curto usa o último dia (ADR-0046). */
export const DiaDoMes = z.number().int().min(1).max(31);
export type DiaDoMes = z.infer<typeof DiaDoMes>;

const Nome = z.string().trim().min(1).max(120);
const Descricao = z.string().trim().min(1).max(500);
const Notas = z.string().max(10_000);

// ---------- Contas e cartões ----------

export const TipoConta = z.enum(["corrente", "poupanca", "carteira", "investimento", "cartao"]);
export type TipoConta = z.infer<typeof TipoConta>;

interface CamposDeCartao {
  tipo?: TipoConta;
  diaFechamento?: number | null;
  diaVencimento?: number | null;
  limiteCentavos?: number | null;
  contaPagamentoId?: string | null;
}

/** Como o banco (029): o cartão tem os dois dias; a conta comum não tem nenhum campo de cartão. */
const cartaoComOsDias = (c: CamposDeCartao) =>
  c.tipo !== "cartao" || (typeof c.diaFechamento === "number" && typeof c.diaVencimento === "number");
const contaSemCamposDeCartao = (c: CamposDeCartao) =>
  c.tipo === undefined ||
  c.tipo === "cartao" ||
  ((c.diaFechamento ?? null) === null &&
    (c.diaVencimento ?? null) === null &&
    (c.limiteCentavos ?? null) === null &&
    (c.contaPagamentoId ?? null) === null);
const MENSAGEM_CARTAO_SEM_DIAS = {
  path: ["diaFechamento"],
  message: "cartão precisa dos dias de fechamento e vencimento",
};
const MENSAGEM_CAMPOS_DE_CARTAO = {
  path: ["tipo"],
  message: "só o cartão tem fechamento, vencimento, limite e conta de pagamento",
};

const camposConta = {
  nome: Nome,
  tipo: TipoConta,
  /** O código do perfil de importação do banco (`nubank`), quando há. */
  banco: z.string().trim().min(1).max(60).nullable(),
  moeda: Moeda,
  saldoInicialCentavos: Centavos,
  /** O dia do saldo inicial; vazio conta todos os lançamentos. */
  saldoInicialEm: Dia.nullable(),
  diaFechamento: DiaDoMes.nullable(),
  diaVencimento: DiaDoMes.nullable(),
  limiteCentavos: Centavos.positive().nullable(),
  contaPagamentoId: Id.nullable(),
};

/**
 * Uma conta, carteira, investimento ou cartão. `saldoCentavos` não é coluna (ADR-0046): o serviço
 * soma o inicial e os lançamentos vivos desde `saldoInicialEm`, na moeda da conta. Arquivada é
 * `ativa: false`.
 */
export const Conta = z
  .object({
    id: Id,
    ...camposConta,
    ativa: z.boolean(),
    saldoCentavos: Centavos,
    ...CamposOrigem,
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  .refine(cartaoComOsDias, MENSAGEM_CARTAO_SEM_DIAS)
  .refine(contaSemCamposDeCartao, MENSAGEM_CAMPOS_DE_CARTAO);
export type Conta = z.infer<typeof Conta>;

/** Sem moeda, real; sem saldo inicial, zero. */
export const NovaConta = z
  .object(camposConta)
  .partial()
  .required({ nome: true, tipo: true })
  .refine(cartaoComOsDias, MENSAGEM_CARTAO_SEM_DIAS)
  .refine(contaSemCamposDeCartao, MENSAGEM_CAMPOS_DE_CARTAO);
export type NovaConta = z.infer<typeof NovaConta>;

/** Mudança parcial; o tipo não muda (o cartão tem faturas). `ativa: false` arquiva. */
export const MudancaConta = z
  .object(camposConta)
  .omit({ tipo: true })
  .partial()
  .extend({ id: Id, ativa: z.boolean().optional() });
export type MudancaConta = z.infer<typeof MudancaConta>;

export const PedidoConta = z.object({ id: Id });
export type PedidoConta = z.infer<typeof PedidoConta>;

/** Sem o campo, só as ativas. */
export const PedidoContas = z.object({ todas: z.boolean().optional() });
export type PedidoContas = z.infer<typeof PedidoContas>;

// ---------- Faturas ----------

/** Aberta até o fechamento; fechada a pagar; paga quando a transferência da conta de pagamento existe. */
export const EstadoFatura = z.enum(["aberta", "fechada", "paga"]);
export type EstadoFatura = z.infer<typeof EstadoFatura>;

/**
 * A fatura do cartão num mês (o mês em que fecha), criada sob demanda. O total não é coluna
 * (ADR-0046): é a soma dos lançamentos dela, saída negativa. `pagamentoLancamentoId` é o lado do
 * cartão da transferência que a pagou.
 */
export const Fatura = z
  .object({
    id: Id,
    contaId: Id,
    mesReferencia: Mes,
    fechaEm: Dia,
    venceEm: Dia,
    totalCentavos: Centavos,
    estado: EstadoFatura,
    pagamentoLancamentoId: Id.nullable(),
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  .refine((f) => f.venceEm > f.fechaEm, { path: ["venceEm"], message: "a fatura vence depois de fechar" })
  .refine((f) => f.pagamentoLancamentoId === null || f.estado === "paga", {
    path: ["pagamentoLancamentoId"],
    message: "só a fatura paga tem o lançamento do pagamento",
  });
export type Fatura = z.infer<typeof Fatura>;

/** As faturas de um cartão, da mais nova para a mais antiga. */
export const PedidoFaturas = z.object({ contaId: Id });
export type PedidoFaturas = z.infer<typeof PedidoFaturas>;

export const PedidoFatura = z.object({ id: Id });
export type PedidoFatura = z.infer<typeof PedidoFatura>;

/**
 * "Pagar fatura": uma transferência da conta de pagamento para o cartão, que marca a fatura paga.
 * Sem conta, a do cartão; sem valor, o total; sem dia, hoje no fuso do usuário. Registra o que você
 * já pagou no banco: o Moductus nunca paga nada.
 */
export const PedidoPagarFatura = z.object({
  id: Id,
  contaPagamentoId: Id.optional(),
  valorCentavos: Centavos.positive().optional(),
  data: Dia.optional(),
});
export type PedidoPagarFatura = z.infer<typeof PedidoPagarFatura>;

// ---------- Categorias e regras ----------

export const TipoCategoria = z.enum(["gasto", "receita", "transferencia"]);
export type TipoCategoria = z.infer<typeof TipoCategoria>;

/** A categoria semeada das transferências entre contas próprias (029): fora de gasto e de receita. */
export const CATEGORIA_TRANSFERENCIA = "transferencia";

/** Categoria com um nível de subcategoria ("Casa › Mercado"); `cor` vazia usa a da interface. */
export const Categoria = z.object({
  id: Id,
  nome: Nome,
  categoriaPaiId: Id.nullable(),
  tipo: TipoCategoria,
  cor: z.string().min(1).nullable(),
  arquivada: z.boolean(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Categoria = z.infer<typeof Categoria>;

export const NovaCategoria = z.object({
  nome: Nome,
  tipo: TipoCategoria,
  categoriaPaiId: Id.nullable().optional(),
  cor: z.string().min(1).nullable().optional(),
});
export type NovaCategoria = z.infer<typeof NovaCategoria>;

export const MudancaCategoria = z.object({
  id: Id,
  nome: Nome.optional(),
  categoriaPaiId: Id.nullable().optional(),
  cor: z.string().min(1).nullable().optional(),
  arquivada: z.boolean().optional(),
});
export type MudancaCategoria = z.infer<typeof MudancaCategoria>;

/**
 * Categoria em uso só vai para a lixeira com `confirmado`, levando os lançamentos para "sem
 * categoria" (spec da fase 4, "Lixeira").
 */
export const PedidoApagarCategoria = z.object({ id: Id, confirmado: z.boolean().optional() });
export type PedidoApagarCategoria = z.infer<typeof PedidoApagarCategoria>;

/** Apagou (e o que foi junto), ou não apagou porque está em uso e pede a confirmação. */
export const ResultadoApagarCategoria = z.discriminatedUnion("apagada", [
  z.object({ apagada: z.literal(true), ids: z.array(Id) }),
  z.object({ apagada: z.literal(false), lancamentos: z.number().int().positive() }),
]);
export type ResultadoApagarCategoria = z.infer<typeof ResultadoApagarCategoria>;

export const TipoPadrao = z.enum(["contem", "comeca_com", "regex"]);
export type TipoPadrao = z.infer<typeof TipoPadrao>;

/** Quem ensinou a regra; decide a ordem (a do usuário vence a do agente, ADR-0045). */
export const CriadaPor = z.enum(["usuario", "agente"]);
export type CriadaPor = z.infer<typeof CriadaPor>;

/** O padrão da regra; o limite de tempo da regex fica no serviço. */
export const PadraoRegra = z.string().trim().min(1).max(200);

/** "Descrição contém IFOOD → Restaurantes": o que a Tula e você ensinaram (DATA.md §3). */
export const RegraCategoria = z.object({
  id: Id,
  padrao: PadraoRegra,
  tipoPadrao: TipoPadrao,
  categoriaId: Id,
  vezesAplicada: z.number().int().nonnegative(),
  criadaPor: CriadaPor,
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type RegraCategoria = z.infer<typeof RegraCategoria>;

export const NovaRegraCategoria = z.object({ padrao: PadraoRegra, tipoPadrao: TipoPadrao, categoriaId: Id });
export type NovaRegraCategoria = z.infer<typeof NovaRegraCategoria>;

export const MudancaRegraCategoria = NovaRegraCategoria.partial().extend({ id: Id });
export type MudancaRegraCategoria = z.infer<typeof MudancaRegraCategoria>;

export const PedidoRegraCategoria = z.object({ id: Id });
export type PedidoRegraCategoria = z.infer<typeof PedidoRegraCategoria>;

/**
 * A regra que o serviço propõe quando você troca a categoria de um importado ("Daqui em diante,
 * MERCADO BOM PRECO é sempre Mercado"). Aceita, vai a `financas.criarRegra` como veio.
 */
export const PropostaRegra = NovaRegraCategoria;
export type PropostaRegra = z.infer<typeof PropostaRegra>;

// ---------- Lançamentos ----------

/**
 * Entrada ou saída de uma conta, na moeda dela (`moeda` vem da conta, para a tela não perguntar).
 * Compra parcelada: as parcelas têm o mesmo `compraId`, com número e total. Transferência entre
 * contas próprias: dois lados com o mesmo `transferenciaId`. A chave natural (`impressao`) é do
 * serviço e não sai daqui. Sem categoria é "sem categoria".
 */
export const Lancamento = z
  .object({
    id: Id,
    contaId: Id,
    data: Dia,
    descricao: z.string().min(1),
    /** Como veio do banco, quando veio. */
    descricaoOriginal: z.string().nullable(),
    valorCentavos: Centavos,
    moeda: Moeda,
    categoriaId: Id.nullable(),
    faturaId: Id.nullable(),
    parcelaNumero: z.number().int().positive().nullable(),
    parcelaTotal: z.number().int().min(2).nullable(),
    compraId: Id.nullable(),
    transferenciaId: Id.nullable(),
    recorrenciaId: Id.nullable(),
    dividaId: Id.nullable(),
    importacaoId: Id.nullable(),
    /** O FITID do OFX, guardado como sinal (ADR-0042). */
    idExterno: z.string().min(1).nullable(),
    /** Lançado à mão e depois achado no extrato. */
    conciliado: z.boolean(),
    notas: z.string().nullable(),
    ...CamposOrigem,
    criadoEm: Instante,
    atualizadoEm: Instante,
  })
  // Como o banco (030): número e total juntos, a parcela dentro do total, compra só com parcelas.
  .refine((l) => (l.parcelaNumero === null) === (l.parcelaTotal === null), {
    path: ["parcelaTotal"],
    message: "parcela tem número e total",
  })
  .refine((l) => l.parcelaNumero === null || l.parcelaTotal === null || l.parcelaNumero <= l.parcelaTotal, {
    path: ["parcelaNumero"],
    message: "a parcela não passa do total",
  })
  .refine((l) => (l.compraId === null) === (l.parcelaTotal === null), {
    path: ["compraId"],
    message: "só a compra parcelada tem compra",
  });
export type Lancamento = z.infer<typeof Lancamento>;

/** Até quantas vezes uma compra se parcela à mão. */
export const PARCELAS_MAXIMAS = 120;

/**
 * Gasto (negativo) ou receita (positivo) numa conta. `parcelas` divide a compra em N lançamentos,
 * um por fatura, com a sobra de centavos na primeira (ADR-0046): o valor é o total da compra.
 */
export const NovoLancamento = z.object({
  contaId: Id,
  data: Dia,
  descricao: Descricao,
  valorCentavos: Centavos.refine((v) => v !== 0, "lançamento sem valor"),
  categoriaId: Id.nullable().optional(),
  notas: Notas.nullable().optional(),
  parcelas: z.number().int().min(2).max(PARCELAS_MAXIMAS).optional(),
});
export type NovoLancamento = z.infer<typeof NovoLancamento>;

/** Transferência entre contas próprias: sai de uma, entra na outra, fora de gasto e de receita. */
export const NovaTransferencia = z
  .object({
    deContaId: Id,
    paraContaId: Id,
    data: Dia,
    valorCentavos: Centavos.positive(),
    descricao: Descricao.optional(),
    notas: Notas.nullable().optional(),
  })
  .refine((t) => t.deContaId !== t.paraContaId, {
    path: ["paraContaId"],
    message: "a transferência vai para outra conta",
  });
export type NovaTransferencia = z.infer<typeof NovaTransferencia>;

/** Mudança parcial: só o que vem muda; `null` limpa. */
export const MudancaLancamento = z.object({
  id: Id,
  contaId: Id.optional(),
  data: Dia.optional(),
  descricao: Descricao.optional(),
  valorCentavos: Centavos.refine((v) => v !== 0, "lançamento sem valor").optional(),
  categoriaId: Id.nullable().optional(),
  notas: Notas.nullable().optional(),
  conciliado: z.boolean().optional(),
});
export type MudancaLancamento = z.infer<typeof MudancaLancamento>;

/**
 * O lançamento editado e, quando a categoria de um importado mudou, a regra proposta (ADR-0045).
 * Editar um lado da transferência ou uma parcela pode mudar os outros: voltam em `lancamentos`.
 */
export const LancamentoEditado = z.object({
  lancamentos: z.array(Lancamento).min(1),
  propostaRegra: PropostaRegra.nullable(),
});
export type LancamentoEditado = z.infer<typeof LancamentoEditado>;

export const PedidoLancamento = z.object({ id: Id });
export type PedidoLancamento = z.infer<typeof PedidoLancamento>;

/**
 * O detalhe ao lado: o lançamento, as outras parcelas da compra, o outro lado da transferência e a
 * importação que o trouxe ("importado do Nubank em 12/11").
 */
export const DetalheLancamento = z.object({
  lancamento: Lancamento,
  parcelas: z.array(Lancamento),
  outroLado: Lancamento.nullable(),
  importacao: z.object({ id: Id, arquivoNome: z.string().min(1), criadoEm: Instante }).nullable(),
});
export type DetalheLancamento = z.infer<typeof DetalheLancamento>;

/**
 * A lista e a busca: período (`mes`, ou `inicio` e `fim`), conta, categoria (com as filhas), texto
 * sem acento nem caixa ("acougue" acha "Açougue") e só os sem categoria. Do mais novo para o mais
 * antigo, em páginas: `antesDe` é o `proximo` da página anterior.
 */
export const PedidoLancamentos = z
  .object({
    mes: Mes.optional(),
    inicio: Dia.optional(),
    fim: Dia.optional(),
    contaId: Id.optional(),
    categoriaId: Id.optional(),
    texto: z.string().trim().min(1).max(200).optional(),
    semCategoria: z.boolean().optional(),
    antesDe: Id.optional(),
    limite: z.number().int().min(1).max(500).optional(),
  })
  .refine((p) => p.mes === undefined || (p.inicio === undefined && p.fim === undefined), {
    path: ["mes"],
    message: "o período é o mês ou o intervalo, não os dois",
  })
  .refine((p) => p.inicio === undefined || p.fim === undefined || p.inicio <= p.fim, {
    path: ["fim"],
    message: "o período termina depois de começar",
  })
  .refine((p) => !(p.semCategoria === true && p.categoriaId !== undefined), {
    path: ["semCategoria"],
    message: "sem categoria não combina com uma categoria",
  });
export type PedidoLancamentos = z.infer<typeof PedidoLancamentos>;

export const PaginaLancamentos = z.object({ itens: z.array(Lancamento), proximo: Id.nullable() });
export type PaginaLancamentos = z.infer<typeof PaginaLancamentos>;

// ---------- Resumo e relatórios ----------

/**
 * Entradas e saídas de um período numa moeda, sem transferências (ADR-0046). As saídas vêm sem
 * sinal ("Saídas R$ 3.214,77"); a sobra é entradas menos saídas, com sinal.
 */
export const Totais = z.object({
  moeda: Moeda,
  entradasCentavos: Quantia,
  saidasCentavos: Quantia,
  sobraCentavos: Centavos,
});
export type Totais = z.infer<typeof Totais>;

/** Gasto de uma categoria no período, sem sinal; `categoriaId` vazio é "sem categoria". */
export const GastoCategoria = z.object({
  categoriaId: Id.nullable(),
  gastoCentavos: Quantia,
  lancamentos: z.number().int().nonnegative(),
});
export type GastoCategoria = z.infer<typeof GastoCategoria>;

/** Sem mês, o de hoje no fuso do usuário. */
export const PedidoMes = z.object({ mes: Mes.optional() });
export type PedidoMes = z.infer<typeof PedidoMes>;

/**
 * O resumo do mês: os totais em real e, à parte, os de cada conta em outra moeda (sem total
 * misturado); o gasto por categoria é o do real, a pai somando as filhas.
 */
export const ResumoMes = z.object({
  mes: Mes,
  totais: Totais,
  outrasMoedas: z.array(Totais),
  porCategoria: z.array(GastoCategoria),
});
export type ResumoMes = z.infer<typeof ResumoMes>;

/**
 * Uma categoria no relatório do mês contra os três meses anteriores, do mais recente para o mais
 * antigo, sem sinal.
 */
export const LinhaRelatorio = z.object({
  categoriaId: Id.nullable(),
  gastoCentavos: Quantia,
  anterioresCentavos: z.array(Quantia).length(3),
});
export type LinhaRelatorio = z.infer<typeof LinhaRelatorio>;

/** O relatório do mês (quadro `RelatorioMes`): os meses anteriores vêm do mais recente ao mais antigo. */
export const RelatorioMes = z.object({
  mes: Mes,
  anteriores: z.array(Mes).length(3),
  totais: Totais,
  totaisAnteriores: z.array(Totais).length(3),
  linhas: z.array(LinhaRelatorio),
});
export type RelatorioMes = z.infer<typeof RelatorioMes>;

/**
 * "Quanto gastei com X": por categoria (com as filhas) ou por texto da descrição, no período. Sem
 * nenhum dos dois, o gasto todo.
 */
export const PedidoGastoCom = z
  .object({
    categoriaId: Id.optional(),
    texto: z.string().trim().min(1).max(200).optional(),
    contaId: Id.optional(),
    inicio: Dia,
    fim: Dia,
  })
  .refine((p) => p.inicio <= p.fim, { path: ["fim"], message: "o período termina depois de começar" });
export type PedidoGastoCom = z.infer<typeof PedidoGastoCom>;

/** A resposta, em real, sem sinal, com o mês a mês do período. */
export const GastoCom = z.object({
  inicio: Dia,
  fim: Dia,
  categoriaId: Id.nullable(),
  texto: z.string().nullable(),
  gastoCentavos: Quantia,
  lancamentos: z.number().int().nonnegative(),
  porMes: z.array(z.object({ mes: Mes, gastoCentavos: Quantia })),
});
export type GastoCom = z.infer<typeof GastoCom>;

/** O que vence: a fatura do cartão, a parcela de uma dívida ou uma recorrente. */
export const TipoVencimento = z.enum(["fatura", "divida", "recorrente"]);
export type TipoVencimento = z.infer<typeof TipoVencimento>;

/**
 * Um vencimento, com o item de onde veio. Só saídas vencem: a recorrente de entrada (salário) e a
 * fatura sem gasto ficam fora, e por isso o valor (estimado na recorrente) vem sem sinal.
 */
export const Vencimento = z.object({
  tipo: TipoVencimento,
  itemId: Id,
  descricao: z.string().min(1),
  venceEm: Dia,
  valorCentavos: Quantia,
  moeda: Moeda,
  contaId: Id.nullable(),
});
export type Vencimento = z.infer<typeof Vencimento>;

/** O que vence a partir de hoje, até `dias` adiante (3 sem o campo, como os avisos da Tula). */
export const PedidoVencimentos = z.object({ dias: z.number().int().min(1).max(60).optional() });
export type PedidoVencimentos = z.infer<typeof PedidoVencimentos>;

/** Do mais próximo ao mais distante; o total é o das saídas em real ("Vence em breve R$ 1.792,30"). */
export const Vencimentos = z.object({ itens: z.array(Vencimento), totalCentavos: Quantia });
export type Vencimentos = z.infer<typeof Vencimentos>;

// ---------- Orçamento ----------

/**
 * Limite de uma categoria num mês ou, com `mes` vazio, em todo mês; a linha do mês vence a de todo
 * mês. Zero é "não gastar nada aqui". `alertaPercentual` é quanto do limite já avisa.
 */
export const Orcamento = z.object({
  id: Id,
  categoriaId: Id,
  mes: Mes.nullable(),
  limiteCentavos: Quantia,
  alertaPercentual: z.number().int().min(1).max(100),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Orcamento = z.infer<typeof Orcamento>;

/** Abaixo do alerta, no alerta, ou passou do limite. */
export const SituacaoOrcamento = z.enum(["ok", "alerta", "estourado"]);
export type SituacaoOrcamento = z.infer<typeof SituacaoOrcamento>;

/**
 * Uma categoria contra o limite no mês (ADR-0046): o gasto sem sinal, a pai somando as filhas, o
 * percentual inteiro e o que sobra (negativo quando passou). A semana é o limite do mês
 * proporcional aos dias dela dentro do mês, mostrado como "previsto"; vazia fora do mês corrente.
 */
export const LinhaOrcamento = z.object({
  orcamentoId: Id,
  categoriaId: Id,
  /** O limite vem da linha deste mês (remanejado ou só deste mês), não da de todo mês. */
  doMes: z.boolean(),
  limiteCentavos: Quantia,
  alertaPercentual: z.number().int().min(1).max(100),
  gastoCentavos: Quantia,
  percentual: z.number().int().nonnegative(),
  sobraCentavos: Centavos,
  situacao: SituacaoOrcamento,
  semana: z.object({ previstoCentavos: Quantia, gastoCentavos: Quantia }).nullable(),
});
export type LinhaOrcamento = z.infer<typeof LinhaOrcamento>;

/**
 * O orçamento do mês: as linhas, a soma dos limites e do gasto ("R$ 3.214 de 4.200") e a semana de
 * hoje contra o previsto ("R$ 420 de R$ 600, sobram R$ 180 para 4 dias"), só no mês corrente. Mês
 * sem orçamento volta sem linhas, sem limite inventado.
 */
export const OrcamentoMes = z.object({
  mes: Mes,
  linhas: z.array(LinhaOrcamento),
  limiteCentavos: Quantia,
  gastoCentavos: Quantia,
  semana: z
    .object({
      inicio: Dia,
      fim: Dia,
      previstoCentavos: Quantia,
      gastoCentavos: Quantia,
      diasRestantes: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type OrcamentoMes = z.infer<typeof OrcamentoMes>;

/** Definir o limite de uma categoria neste mês ou, com `mes: null`, em todo mês. */
export const DefinicaoOrcamento = z.object({
  categoriaId: Id,
  mes: Mes.nullable(),
  limiteCentavos: Quantia,
  alertaPercentual: z.number().int().min(1).max(100).optional(),
});
export type DefinicaoOrcamento = z.infer<typeof DefinicaoOrcamento>;

export const PedidoOrcamento = z.object({ id: Id });
export type PedidoOrcamento = z.infer<typeof PedidoOrcamento>;

/** "Remanejar R$ 80" de uma categoria para outra, só naquele mês (cria as linhas do mês). */
export const PedidoRemanejar = z
  .object({ deCategoriaId: Id, paraCategoriaId: Id, mes: Mes, valorCentavos: Centavos.positive() })
  .refine((p) => p.deCategoriaId !== p.paraCategoriaId, {
    path: ["paraCategoriaId"],
    message: "remanejar é entre categorias diferentes",
  });
export type PedidoRemanejar = z.infer<typeof PedidoRemanejar>;

/** O orçamento do mês depois de remanejar, e o id que o desfaz. */
export const Remanejamento = z.object({ id: Id, orcamento: OrcamentoMes });
export type Remanejamento = z.infer<typeof Remanejamento>;

export const PedidoDesfazerRemanejar = z.object({ id: Id });
export type PedidoDesfazerRemanejar = z.infer<typeof PedidoDesfazerRemanejar>;

// ---------- Recorrentes ----------

/**
 * Conta fixa ou assinatura (aluguel, internet, streaming): o valor estimado com sinal, a regra como
 * RRULE do relógio do dia (ADR-0034) e a próxima data que sai dela. `detectadaAutomaticamente` diz
 * que nasceu de uma sugestão aceita.
 */
export const Recorrente = z.object({
  id: Id,
  descricao: Descricao,
  valorCentavos: Centavos,
  categoriaId: Id.nullable(),
  contaId: Id.nullable(),
  regra: Recorrencia,
  proximaEm: Dia.nullable(),
  ativa: z.boolean(),
  detectadaAutomaticamente: z.boolean(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Recorrente = z.infer<typeof Recorrente>;

const camposRecorrente = {
  descricao: Descricao,
  valorCentavos: Centavos.refine((v) => v !== 0, "recorrente sem valor"),
  categoriaId: Id.nullable(),
  contaId: Id.nullable(),
  regra: Recorrencia,
};

export const NovaRecorrente = z.object(camposRecorrente).partial({ categoriaId: true, contaId: true });
export type NovaRecorrente = z.infer<typeof NovaRecorrente>;

/** `ativa: false` pausa. */
export const MudancaRecorrente = z
  .object(camposRecorrente)
  .partial()
  .extend({ id: Id, ativa: z.boolean().optional() });
export type MudancaRecorrente = z.infer<typeof MudancaRecorrente>;

export const PedidoRecorrente = z.object({ id: Id });
export type PedidoRecorrente = z.infer<typeof PedidoRecorrente>;

/**
 * Uma recorrência detectada por código (a mesma descrição em 3 meses seguidos, valor a até 10%,
 * ADR-0046), ainda não aceita. `chave` a identifica para aceitar ou recusar; recusada não volta.
 */
export const SugestaoRecorrente = z.object({
  chave: z.string().min(1),
  descricao: z.string().min(1),
  valorCentavos: Centavos,
  categoriaId: Id.nullable(),
  contaId: Id,
  regra: Recorrencia,
  proximaEm: Dia,
  ocorrencias: z.array(Dia).min(3),
});
export type SugestaoRecorrente = z.infer<typeof SugestaoRecorrente>;

export const PedidoSugestaoRecorrente = z.object({ chave: z.string().min(1) });
export type PedidoSugestaoRecorrente = z.infer<typeof PedidoSugestaoRecorrente>;

// ---------- Mudanças ----------

/** O que pode mudar no dinheiro: as janelas recarregam só o que veio. */
export const ParteFinancas = z.enum([
  "contas",
  "faturas",
  "lancamentos",
  "categorias",
  "regras",
  "orcamento",
  "recorrentes",
  "dividas",
  "planos",
  "importacoes",
]);
export type ParteFinancas = z.infer<typeof ParteFinancas>;

/**
 * O que mudou no dinheiro, de qualquer caminho (tela, captura, importação, ferramenta da Tula):
 * as partes para recarregar e, quando foram lançamentos, os que mudaram e os que saíram.
 */
export const MudancaFinancas = z.object({
  partes: z.array(ParteFinancas).min(1),
  lancamentos: z.array(Lancamento),
  apagados: z.array(Id),
});
export type MudancaFinancas = z.infer<typeof MudancaFinancas>;
