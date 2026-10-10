import { expect, test } from "vitest";
import { EVENTOS, METODOS, VERSAO_PROTOCOLO } from "./index.ts";

test("protocolo na versão 2: a fase 2 mudou a forma do canal", () => {
  expect(VERSAO_PROTOCOLO).toBe(2);
});

test("nomes de método e evento seguem dominio.acao", () => {
  for (const nome of [...Object.keys(METODOS), ...Object.keys(EVENTOS)]) {
    expect(nome).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
  }
});
