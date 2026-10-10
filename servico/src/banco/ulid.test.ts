import { describe, expect, test } from "vitest";
import { criarGeradorUlid, novoId, tempoDoUlid } from "./ulid.ts";

/** Relógio que devolve os tempos dados, em ordem. */
const relogio = (...tempos: number[]) => {
  let i = 0;
  return () => tempos[Math.min(i++, tempos.length - 1)]!;
};
const sorteioFixo = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);

describe("ULID", () => {
  test("26 caracteres do base32 de Crockford, com o milissegundo na frente", () => {
    const id = criarGeradorUlid(() => 1_700_000_000_000)();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(tempoDoUlid(id)).toBe(1_700_000_000_000);
    expect(criarGeradorUlid(() => 0, sorteioFixo(0))()).toBe("0".repeat(26));
  });

  test("ordena como texto na ordem de criação, entre milissegundos diferentes", () => {
    // O sorteio do mais novo é menor: quem decide a ordem é o tempo.
    const sorteios = [31, 0];
    const gerar = criarGeradorUlid(relogio(1000, 1001), (n) => new Uint8Array(n).fill(sorteios.shift()!));
    const a = gerar();
    const b = gerar();
    expect(a < b).toBe(true);
  });

  test("é monotônico dentro do mesmo milissegundo", () => {
    const gerar = criarGeradorUlid(() => 5000);
    const ids = Array.from({ length: 1000 }, gerar);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => tempoDoUlid(id) === 5000)).toBe(true);
  });

  test("incrementa a parte aleatória com vai-um, sem sortear de novo", () => {
    const gerar = criarGeradorUlid(
      () => 0,
      (n) => Uint8Array.from({ length: n }, (_, i) => (i === n - 1 ? 31 : 0)),
    );
    expect(gerar().slice(10)).toBe("000000000000000Z");
    expect(gerar().slice(10)).toBe("0000000000000010");
  });

  test("relógio que volta não quebra a ordem", () => {
    const gerar = criarGeradorUlid(relogio(9000, 8000, 9000));
    const ids = [gerar(), gerar(), gerar()];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
    expect(ids.map(tempoDoUlid)).toEqual([9000, 9000, 9000]);
  });

  test("estourar a parte aleatória no mesmo milissegundo falha e não repete id", () => {
    const gerar = criarGeradorUlid(() => 0, sorteioFixo(31));
    const ultimo = gerar();
    expect(() => gerar()).toThrow("esgotados");
    expect(() => gerar()).toThrow("esgotados");
    expect(ultimo.slice(10)).toBe("Z".repeat(16));
  });

  test("recusa tempo fora dos 48 bits", () => {
    expect(() => criarGeradorUlid(() => -1)()).toThrow(RangeError);
    expect(() => criarGeradorUlid(() => 2 ** 48)()).toThrow(RangeError);
  });

  test("o gerador do serviço também ordena", () => {
    const ids = Array.from({ length: 200 }, () => novoId());
    expect([...ids].sort()).toEqual(ids);
  });
});
