import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classesDeclaradas, colisoesDeClasse, verificarConteudo, verificarPasta } from "./lint-visual.mjs";

const motivos = (texto, caminho) => verificarConteudo(texto, caminho).map((a) => a.motivo);

describe("lint-visual em CSS", () => {
  it("aceita regras que só usam tokens", () => {
    const css = `.botao {\n  padding: var(--esp-8) var(--esp-12);\n  color: var(--texto);\n  box-shadow: var(--sombra-painel);\n  font-family: var(--fonte-mono);\n  border-radius: var(--raio-botao);\n  opacity: 0;\n}`;
    expect(motivos(css, "a.css")).toEqual([]);
  });

  it("recusa cor hex, rgb/hsl, medidas, sombra e fonte literais", () => {
    expect(motivos(".a { color: #fff; }", "a.css")).toEqual(["cor hex"]);
    expect(motivos(".a { color: rgba(0, 0, 0, 0.5); }", "a.css")).toEqual(["cor rgb/hsl"]);
    expect(motivos(".a { color: hsl(10 20% 30%); }", "a.css")).toEqual(["cor rgb/hsl"]);
    expect(motivos(".a { width: 12px; }", "a.css")).toEqual(["medida 12px"]);
    expect(motivos(".a { margin: 1.5rem; }", "a.css")).toEqual(["medida 1.5rem"]);
    expect(motivos(".a { gap: .5em; }", "a.css")).toEqual(["medida .5em"]);
    expect(motivos(".a { box-shadow: 0 0 0 var(--borda); }", "a.css")).toEqual(["box-shadow literal"]);
    expect(motivos('.a { font-family: "Geist"; }', "a.css")).toEqual(["font-family literal"]);
  });

  it("ignora comentários", () => {
    expect(motivos("/* antes era #fff e 12px */\n.a { color: var(--texto); }", "a.css")).toEqual([]);
  });
});

describe("lint-visual em TS/TSX", () => {
  it("aceita style com tokens, imports e texto comum", () => {
    const tsx = [
      'import "./tokens/base.css";',
      'import { x } from "../x.ts";',
      "// comentário com #fff e 10px",
      'const a = <div style={{ padding: "var(--esp-8)", zIndex: 2, flex: 1, margin: 0 }}>Don\'t 3 itens</div>;',
      'const b = { fontFamily: "var(--fonte-mono)" };',
      'const c = document.getElementById("raiz");',
    ].join("\n");
    expect(motivos(tsx, "a.tsx")).toEqual([]);
  });

  it("recusa literais visuais em strings e em style", () => {
    expect(motivos('const cor = "#0D0E10";', "a.ts")).toEqual(["cor hex"]);
    expect(motivos("const s = `0 0 4px ${x}`;", "a.ts")).toEqual(["medida 4px"]);
    expect(motivos('const c = "rgb(1, 2, 3)";', "a.ts")).toEqual(["cor rgb/hsl"]);
    expect(motivos("<div style={{ width: 12 }} />", "a.tsx")).toEqual(["número 12 em style.width"]);
    expect(motivos('<div style={{ width: "12px" }} />', "a.tsx")).toEqual(["medida 12px"]);
    expect(motivos('<div style={{ fontFamily: "Geist" }} />', "a.tsx")).toEqual(["fontFamily literal"]);
    expect(motivos('<div style={{ boxShadow: "none" }} />', "a.tsx")).toEqual([]);
  });

  it("informa a linha do achado", () => {
    expect(verificarConteudo('const a = 1;\nconst b = "#abc";', "a.ts")).toEqual([
      { linha: 2, motivo: "cor hex" },
    ]);
  });
});

describe("lint-visual numa pasta", () => {
  let raiz;
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it("deixa src/tokens e testes de fora e aponta o resto", () => {
    raiz = mkdtempSync(join(tmpdir(), "lint-visual-"));
    mkdirSync(join(raiz, "src", "tokens"), { recursive: true });
    mkdirSync(join(raiz, "src", "janelas"), { recursive: true });
    writeFileSync(join(raiz, "src", "tokens", "temas.css"), ":root { --texto: #e8e9eb; --esp-4: 4px; }");
    writeFileSync(join(raiz, "src", "janelas", "a.test.ts"), 'expect("#fff")');
    writeFileSync(join(raiz, "src", "janelas", "ok.css"), ".a { color: var(--texto); }");
    writeFileSync(join(raiz, "src", "janelas", "ruim.css"), ".a {\n  width: 10px;\n}");
    expect(verificarPasta(raiz)).toEqual([
      { arquivo: "src/janelas/ruim.css", linha: 2, motivo: "medida 10px" },
    ]);
  });
});

describe("classes repetidas entre áreas", () => {
  let raiz;
  afterEach(() => {
    if (raiz) rmSync(raiz, { recursive: true, force: true });
    raiz = undefined;
  });

  it("conta só a classe declarada sozinha, também em lista e dentro de @media", () => {
    const css = [
      "/* .comentada { } */",
      ".a,\n.b {",
      "}",
      ".pai .filha, .c:hover, .d[data-x], .e:has(> .f) {",
      "}",
      "@media (forced-colors: active) {",
      "  .g {",
      "  }",
      "}",
    ].join("\n");
    expect([...classesDeclaradas(css)]).toEqual(["a", "b", "g"]);
  });

  it("aponta a classe declarada em dois CSS e deixa src/tokens de fora", () => {
    raiz = mkdtempSync(join(tmpdir(), "lint-visual-"));
    for (const pasta of ["tokens", "areas", "janelas"])
      mkdirSync(join(raiz, "src", pasta), { recursive: true });
    writeFileSync(join(raiz, "src", "areas", "Sessoes.css"), ".uso-titulo {\n}\n.so-sessoes {\n}");
    writeFileSync(join(raiz, "src", "janelas", "Uso.css"), ".uso-titulo {\n}\n.so-uso .so-sessoes {\n}");
    writeFileSync(join(raiz, "src", "janelas", "Botao.css"), ".botao {\n}");
    writeFileSync(join(raiz, "src", "tokens", "alto-contraste.css"), ".botao {\n}");
    expect(colisoesDeClasse(raiz)).toEqual([
      { classe: "uso-titulo", arquivos: ["src/areas/Sessoes.css", "src/janelas/Uso.css"] },
    ]);
  });

  it("o src/ do repositório não tem nenhuma", () => {
    expect(colisoesDeClasse(join(import.meta.dirname, ".."))).toEqual([]);
  });
});
