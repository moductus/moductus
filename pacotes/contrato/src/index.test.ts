import { expect, test } from "vitest";
import { VERSAO_PROTOCOLO } from "./index.ts";

test("protocolo começa na versão 1", () => {
  expect(VERSAO_PROTOCOLO).toBe(1);
});
