/**
 * A aritmética do dinheiro no serviço (ADR-0046): tudo em centavos inteiros com sinal, nunca ponto
 * flutuante. O texto pt-BR (formatar e ler) fica no contrato (`@moductus/contrato`, `dinheiro.ts`).
 */

export class ErroDeValor extends RangeError {}

/**
 * Divide `totalCentavos` em `parcelas` partes inteiras com o mesmo sinal: todas iguais, e a sobra
 * de centavos na primeira (ADR-0046). R$ 100,00 em 3 vezes dá 33,34 + 33,33 + 33,33. Recusa total
 * que não chega a um centavo por parcela.
 */
export function dividirEmParcelas(totalCentavos: number, parcelas: number): number[] {
  if (!Number.isSafeInteger(totalCentavos))
    throw new ErroDeValor(`Valor em centavos inválido: ${totalCentavos}`);
  if (!Number.isSafeInteger(parcelas) || parcelas < 1)
    throw new ErroDeValor(`Parcelas inválidas: ${parcelas}`);
  const absoluto = Math.abs(totalCentavos);
  if (absoluto < parcelas) throw new ErroDeValor("o valor não chega a um centavo por parcela");
  const sobra = absoluto % parcelas;
  const base = (absoluto - sobra) / parcelas;
  const sinal = totalCentavos < 0 ? -1 : 1;
  return Array.from({ length: parcelas }, (_, i) => sinal * (i === 0 ? base + sobra : base));
}

/**
 * `valor × parte ÷ todo` arredondado meio-para-cima, uma vez, no inteiro (ADR-0046): o previsto da
 * semana (o limite do mês × dias da semana no mês ÷ dias do mês) e o percentual (gasto × 100 ÷
 * limite). Em `BigInt`, para o produto não perder precisão. Só valores sem sinal.
 */
export function proporcional(valor: number, parte: number, todo: number): number {
  for (const n of [valor, parte, todo]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new ErroDeValor(`Valor inválido para proporção: ${n}`);
  }
  if (todo === 0) throw new ErroDeValor("proporção sobre zero");
  const dobro = 2n * BigInt(valor) * BigInt(parte);
  const divisor = 2n * BigInt(todo);
  return Number((dobro + BigInt(todo)) / divisor);
}

/**
 * Os juros de um mês sobre um saldo sem sinal, com a taxa em pontos-base (2,1% ao mês é 210),
 * arredondados meio-para-cima no centavo (ADR-0046). Em `BigInt`: saldo grande vezes a taxa passa
 * do inteiro seguro antes da divisão. R$ 6.400,00 a 2,1% dá R$ 134,40.
 */
export function jurosDoMes(saldoCentavos: number, jurosBp: number): number {
  if (!Number.isSafeInteger(saldoCentavos) || saldoCentavos < 0)
    throw new ErroDeValor(`Saldo em centavos inválido: ${saldoCentavos}`);
  if (!Number.isSafeInteger(jurosBp) || jurosBp < 0) throw new ErroDeValor(`Juros inválidos: ${jurosBp}`);
  const juros = Number((BigInt(saldoCentavos) * BigInt(jurosBp) * 2n + 10_000n) / 20_000n);
  if (!Number.isSafeInteger(juros))
    throw new ErroDeValor("os juros passam do maior valor que dá para contar");
  return juros;
}
