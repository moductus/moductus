import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante } from "./comum.ts";
import { Centavos, DiaDoMes, Lancamento, Mes } from "./financas.ts";

/**
 * Dívidas da Tula (DATA.md §3 `dividas`; ADR-0046): o saldo devedor numa data, juros ao mês em
 * pontos-base e a parcela. O custo total e a simulação de quitação são calculados na hora pelo
 * serviço, nunca guardados. A Tula organiza e calcula; nunca paga nada.
 */

export const TipoDivida = z.enum([
  "cartao",
  "emprestimo",
  "financiamento",
  "cheque_especial",
  "pessoal",
  "outro",
]);
export type TipoDivida = z.infer<typeof TipoDivida>;

/** Juros ao mês em pontos-base: 1,99% é 199. */
export const JurosMensalBp = z.number().int().nonnegative().max(100_000);
export type JurosMensalBp = z.infer<typeof JurosMensalBp>;

const camposDivida = {
  nome: z.string().trim().min(1).max(120),
  credor: z.string().trim().min(1).max(120).nullable(),
  tipo: TipoDivida,
  /** Quanto ainda deve, sem sinal, no dia `saldoEm`. */
  saldoCentavos: Centavos.nonnegative(),
  saldoEm: Dia,
  jurosMensalBp: JurosMensalBp,
  parcelaCentavos: Centavos.positive().nullable(),
  parcelasRestantes: z.number().int().nonnegative().nullable(),
  diaVencimento: DiaDoMes.nullable(),
};

/**
 * Uma dívida. `custoTotalCentavos` é a soma das parcelas restantes menos o saldo (os juros que
 * ainda vão), vazio sem parcela ou sem parcelas restantes; `proximaParcelaEm` sai do dia de
 * vencimento. Quitada tem `quitadaEm`.
 */
export const Divida = z.object({
  id: Id,
  ...camposDivida,
  quitadaEm: Dia.nullable(),
  custoTotalCentavos: Centavos.nullable(),
  proximaParcelaEm: Dia.nullable(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Divida = z.infer<typeof Divida>;

/** Sem juros, zero. */
export const NovaDivida = z.object(camposDivida).partial({
  credor: true,
  jurosMensalBp: true,
  parcelaCentavos: true,
  parcelasRestantes: true,
  diaVencimento: true,
});
export type NovaDivida = z.infer<typeof NovaDivida>;

export const MudancaDivida = z.object(camposDivida).partial().extend({ id: Id });
export type MudancaDivida = z.infer<typeof MudancaDivida>;

export const PedidoDivida = z.object({ id: Id });
export type PedidoDivida = z.infer<typeof PedidoDivida>;

/** Sem o campo, só as que não estão quitadas. */
export const PedidoDividas = z.object({ todas: z.boolean().optional() });
export type PedidoDividas = z.infer<typeof PedidoDividas>;

/**
 * Registrar um pagamento que você fez: liga um lançamento que já existe (`lancamentoId`) ou cria o
 * lançamento na conta dada (`contaId`), e o serviço atualiza o saldo e as parcelas. Sem os dois, só a
 * dívida muda.
 */
export const PedidoPagamentoDivida = z
  .object({
    id: Id,
    valorCentavos: Centavos.positive(),
    data: Dia,
    contaId: Id.optional(),
    lancamentoId: Id.optional(),
  })
  .refine((p) => p.contaId === undefined || p.lancamentoId === undefined, {
    path: ["lancamentoId"],
    message: "o pagamento liga um lançamento ou cria outro, não os dois",
  });
export type PedidoPagamentoDivida = z.infer<typeof PedidoPagamentoDivida>;

export const PagamentoDivida = z.object({ divida: Divida, lancamento: Lancamento.nullable() });
export type PagamentoDivida = z.infer<typeof PagamentoDivida>;

/** "Quitada": sem dia, hoje no fuso do usuário. */
export const PedidoQuitar = z.object({ id: Id, data: Dia.optional() });
export type PedidoQuitar = z.infer<typeof PedidoQuitar>;

/**
 * Simular a quitação com um valor extra por mês, sobre as dívidas dadas (sem a lista, as não
 * quitadas). Parcela menor que os juros é recusada com o motivo.
 */
export const PedidoSimulacao = z.object({
  extraMensalCentavos: Centavos.nonnegative(),
  ids: z.array(Id).min(1).optional(),
});
export type PedidoSimulacao = z.infer<typeof PedidoSimulacao>;

/** O resultado de uma estratégia: em quantos meses acaba, quando, os juros pagos e quando cada uma sai. */
export const ResultadoQuitacao = z.object({
  meses: z.number().int().nonnegative(),
  terminaEm: Mes,
  jurosPagosCentavos: Centavos.nonnegative(),
  quitacoes: z.array(z.object({ id: Id, mes: Mes })),
});
export type ResultadoQuitacao = z.infer<typeof ResultadoQuitacao>;

/**
 * A simulação mês a mês (ADR-0046): só as parcelas, e com o extra pela estratégia "maior juro
 * primeiro" e "menor saldo primeiro", lado a lado. Nada é guardado.
 */
export const Simulacao = z.object({
  extraMensalCentavos: Centavos.nonnegative(),
  semExtra: ResultadoQuitacao,
  maiorJuro: ResultadoQuitacao,
  menorSaldo: ResultadoQuitacao,
});
export type Simulacao = z.infer<typeof Simulacao>;
