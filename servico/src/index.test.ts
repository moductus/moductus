import { expect, test } from "vitest";
import { descrever } from "./index.ts";

test("descreve o protocolo do contrato", () => {
  expect(descrever()).toContain("protocolo 2");
});
