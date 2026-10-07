import { expect, test } from "vitest";
import { janelaDoRotulo } from "./rotas.ts";

test("reconhece os rótulos das quatro janelas", () => {
  expect(janelaDoRotulo("dock")).toBe("dock");
  expect(janelaDoRotulo("captura")).toBe("captura");
  expect(janelaDoRotulo("outra")).toBeNull();
});
