import { describe, expect, test } from "vitest";
import { cobre, padraoDe, TODA_A_FERRAMENTA } from "./padrao.ts";

describe("padrão da regra", () => {
  test("comando de terminal vira o próprio comando, sem os espaços das pontas", () => {
    expect(padraoDe("Bash", { command: "  pnpm test " })).toBe("pnpm test");
    expect(padraoDe("PowerShell", { command: "Get-ChildItem" })).toBe("Get-ChildItem");
  });

  test("comando ausente ou vazio não vira padrão", () => {
    expect(padraoDe("Bash", {})).toBeNull();
    expect(padraoDe("Bash", { command: "   " })).toBeNull();
    expect(padraoDe("Bash", null)).toBeNull();
    expect(padraoDe("Bash", "pnpm test")).toBeNull();
  });

  test("o resto cobre a ferramenta inteira", () => {
    expect(padraoDe("Edit", { file_path: "V:\\moductus\\a.ts" })).toBe(TODA_A_FERRAMENTA);
    expect(padraoDe("github.comentar", { numero: 12 })).toBe(TODA_A_FERRAMENTA);
  });

  test("comando só cobre o mesmo comando; a ferramenta inteira cobre tudo", () => {
    expect(cobre("pnpm test", "pnpm test")).toBe(true);
    expect(cobre("pnpm test", "pnpm test && rm -rf .")).toBe(false);
    expect(cobre("pnpm test", null)).toBe(false);
    expect(cobre(TODA_A_FERRAMENTA, "qualquer coisa")).toBe(true);
    expect(cobre(TODA_A_FERRAMENTA, null)).toBe(true);
  });
});
