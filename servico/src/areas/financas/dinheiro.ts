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
