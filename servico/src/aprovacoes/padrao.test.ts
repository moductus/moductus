import { describe, expect, test } from "vitest";
import { cobre, dentroDe, ehDeArquivo, entradaParaGuardar, padraoDe } from "./padrao.ts";

describe("padrão da regra", () => {
  test("comando de terminal vira o próprio comando, sem os espaços das pontas", () => {
    expect(padraoDe("Bash", { command: "  pnpm test " })).toBe("pnpm test");
    expect(padraoDe("PowerShell", { command: "Get-ChildItem" })).toBe("Get-ChildItem");
    expect(padraoDe("Bash", {})).toBeNull();
    expect(padraoDe("Bash", { command: "   " })).toBeNull();
    expect(padraoDe("Bash", null)).toBeNull();
    expect(padraoDe("Bash", "pnpm test")).toBeNull();
  });

  test("ferramenta de arquivo vira o caminho absoluto normalizado; relativo não serve", () => {
    expect(padraoDe("Edit", { file_path: "V:/moductus/src/../a.ts" })).toBe("V:\\moductus\\a.ts");
    expect(padraoDe("Write", { file_path: "V:\\moductus\\pasta\\" })).toBe("V:\\moductus\\pasta");
    expect(padraoDe("NotebookEdit", { notebook_path: "V:\\n.ipynb" })).toBe("V:\\n.ipynb");
    expect(padraoDe("Read", { file_path: "src\\a.ts" })).toBeNull();
    expect(padraoDe("Read", {})).toBeNull();
    expect(ehDeArquivo("MultiEdit")).toBe(true);
    expect(ehDeArquivo("Bash")).toBe(false);
  });

  test("busca na web vira o domínio, em minúsculas", () => {
    expect(padraoDe("WebFetch", { url: "https://Docs.Anthropic.com/a?b=1" })).toBe("docs.anthropic.com");
    expect(padraoDe("WebFetch", { url: "não é endereço" })).toBeNull();
  });

  test("o resto vira a entrada com as chaves em ordem; nunca a ferramenta inteira", () => {
    expect(padraoDe("github.comentar", { numero: 12, b: { z: 1, a: [2, { y: 1, x: 0 }] } })).toBe(
      '{"b":{"a":[2,{"x":0,"y":1}],"z":1},"numero":12}',
    );
    expect(padraoDe("mcp__x__y", undefined)).toBe("null");
  });

  test("cobre só o mesmo padrão; caminho sem diferença de caixa", () => {
    expect(cobre("Bash", "pnpm test", "pnpm test")).toBe(true);
    expect(cobre("Bash", "pnpm test", "pnpm test && rm -rf .")).toBe(false);
    expect(cobre("Bash", "*", "pnpm test")).toBe(false);
    expect(cobre("Bash", "pnpm test", null)).toBe(false);
    expect(cobre("Edit", "V:\\Moductus\\a.ts", "v:\\moductus\\A.ts")).toBe(true);
    expect(cobre("mcp__x__y", '{"a":1}', '{"a":2}')).toBe(false);
  });

  test("dentro da pasta: resolve `..`, barra e caixa, e não confunde prefixo", () => {
    expect(dentroDe("v:/MODUCTUS/src/a.ts", "V:\\moductus")).toBe(true);
    expect(dentroDe("V:\\moductus", "V:\\moductus\\")).toBe(true);
    expect(dentroDe("V:\\moductus\\..\\outro\\a.ts", "V:\\moductus")).toBe(false);
    expect(dentroDe("V:\\moductus2\\a.ts", "V:\\moductus")).toBe(false);
    expect(dentroDe("V:\\qualquer\\a.ts", "V:\\")).toBe(true);
    expect(dentroDe("a.ts", "V:\\moductus")).toBe(false);
  });
});

describe("entrada guardada no pedido", () => {
  test("ferramenta de arquivo guarda só o caminho; as outras, a entrada como veio", () => {
    expect(entradaParaGuardar("Edit", { file_path: "V:\\a.ts", old_string: "x", new_string: "y" })).toEqual({
      file_path: "V:\\a.ts",
    });
    expect(entradaParaGuardar("Write", { file_path: "V:\\b.ts", content: "segredo" })).toEqual({
      file_path: "V:\\b.ts",
    });
    expect(entradaParaGuardar("NotebookEdit", { notebook_path: "V:\\n.ipynb", new_source: "x" })).toEqual({
      notebook_path: "V:\\n.ipynb",
    });
    expect(entradaParaGuardar("Write", { content: "sem caminho" })).toEqual({});
    expect(entradaParaGuardar("Write", null)).toEqual({});
    const bash = { command: "pnpm test", description: "Roda" };
    expect(entradaParaGuardar("Bash", bash)).toBe(bash);
  });
});
