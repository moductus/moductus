// @vitest-environment happy-dom
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: { comando: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (comando: string, args?: unknown) => {
    chamadas.push({ comando, args });
    return comando === "acessibilidade_estado" ? { animacoes: false } : undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { aplicarMovimento } = await import("../nativo/acessibilidade.ts");

// Lidos do disco: o vitest não entrega o CSS importado. Caminhos relativos à raiz do repo.
const TEMAS = readFileSync("src/tokens/temas.css", "utf8");
const BASE = readFileSync("src/tokens/base.css", "utf8");
const ALTO_CONTRASTE = readFileSync("src/tokens/alto-contraste.css", "utf8");

/* ---------- contraste (WCAG 2.1: texto 4,5:1; anel de foco e borda de controle 3:1) ---------- */

type Rgba = [number, number, number, number];

function cor(valor: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(valor.trim());
  if (!rgba) throw new Error(`cor que o teste não lê: ${valor}`);
  const [r, g, b, a = 1] = rgba[1]!.split(",").map(Number);
  return [r!, g!, b!, a];
}

/** Cor translúcida sobre o fundo opaco: é o que chega à tela. */
const sobre = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [
  r * a + R * (1 - a),
  g * a + G * (1 - a),
  b * a + B * (1 - a),
  1,
];

function luminancia([r, g, b]: Rgba): number {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

const contraste = (a: Rgba, b: Rgba) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
};

/** Variáveis de um tema, com var() resolvido dentro do próprio bloco. */
function tokensDoTema(tema: string): Record<string, string> {
  const bloco = new RegExp(`\\[data-tema="${tema}"\\]\\s*\\{([^}]*)\\}`).exec(TEMAS)?.[1];
  if (!bloco) throw new Error(`tema ${tema} não achado em temas.css`);
  const tokens: Record<string, string> = {};
  for (const [, nome, valor] of bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[nome!] = valor!.trim();
  for (const [nome, valor] of Object.entries(tokens)) {
    const ref = /^var\((--[\w-]+)\)$/.exec(valor)?.[1];
    if (ref) tokens[nome] = tokens[ref]!;
  }
  return tokens;
}

const TEXTOS = ["--texto", "--texto-2", "--texto-3"];
const STATUS = ["--sucesso", "--aviso", "--perigo"];
const FUNDOS = [
  "--fundo-dock",
  "--fundo-janela",
  "--fundo-lateral",
  "--fundo-cartao",
  "--fundo-elevado",
  "--fundo-campo",
  "--fundo-chip",
  "--fundo-ativo",
];

/** Todos os pares abaixo do mínimo, num tema: "--texto-3 sobre --fundo-chip 4.21". */
function abaixoDoMinimo(tema: string): string[] {
  const t = tokensDoTema(tema);
  // O Vidro mede o fundo sólido (sem Acrylic); com Acrylic o fundo é o papel de parede, e a
  // opacidade do vidro é que garante o contraste (DESIGN.md §4).
  const base = cor(tema === "vidro" ? t["--fundo-solido-vidro"]! : t["--fundo-janela"]!);
  const fundo = (nome: string) =>
    sobre(cor(tema === "vidro" && nome.match(/dock|janela/) ? t["--fundo-solido-vidro"]! : t[nome]!), base);
  const falhas: string[] = [];
  const medir = (frente: string[], fundos: string[], minimo: number) => {
    for (const f of frente)
      for (const b of fundos) {
        const r = contraste(sobre(cor(t[f]!), fundo(b)), fundo(b));
        if (r < minimo) falhas.push(`${f} sobre ${b} ${r.toFixed(2)}`);
      }
  };
  medir(TEXTOS, FUNDOS, 4.5);
  medir(STATUS, ["--fundo-janela", "--fundo-lateral", "--fundo-cartao", "--fundo-elevado"], 4.5);
  medir(["--cor-foco"], FUNDOS, 3);
  // Borda da caixa e do interruptor desligado (controle sem texto): 3:1.
  medir(["--texto-apagado"], ["--fundo-janela", "--fundo-cartao", "--fundo-elevado"], 3);
  const destaque = cor(t["--destaque"]!);
  const sobreDestaque = contraste(cor(t["--sobre-destaque"]!), destaque);
  if (sobreDestaque < 4.5) falhas.push(`--sobre-destaque sobre --destaque ${sobreDestaque.toFixed(2)}`);
  return falhas;
}

describe("contraste dos três temas", () => {
  it.each(["grafite", "papel", "vidro"])("%s: texto 4,5:1, foco e bordas de controle 3:1", (tema) => {
    expect(abaixoDoMinimo(tema)).toEqual([]);
  });

  it("o anel de foco é um token de cada tema, e a base usa só ele", () => {
    for (const tema of ["grafite", "papel", "vidro"]) expect(tokensDoTema(tema)["--cor-foco"]).toBeTruthy();
    expect(BASE).toMatch(/:focus-visible\s*\{\s*outline: var\(--espessura-foco\) solid var\(--cor-foco\);/);
  });
});

/* ---------- movimento ---------- */

const variavel = (nome: string) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

describe("animação zero quando o Windows pede", () => {
  beforeAll(() => {
    const estilo = document.createElement("style");
    estilo.textContent = TEMAS;
    document.head.appendChild(estilo);
  });
  beforeEach(() => {
    chamadas.length = 0;
    delete document.documentElement.dataset.movimento;
  });

  it("com Efeitos de animação desligado, as durações dos tokens vão a zero", () => {
    expect(variavel("--dur-entrada")).toBe("140ms");
    aplicarMovimento({ animacoes: false });
    expect(document.documentElement.dataset.movimento).toBe("reduzido");
    for (const nome of ["--dur-entrada", "--dur-saida", "--dur-respirar", "--dur-piscar"]) {
      expect(variavel(nome)).toBe("0ms");
    }
    aplicarMovimento({ animacoes: true });
    expect(variavel("--dur-entrada")).toBe("140ms");
  });

  it("registra no log só quando muda", () => {
    aplicarMovimento({ animacoes: false });
    aplicarMovimento({ animacoes: false });
    aplicarMovimento({ animacoes: true });
    expect(chamadas.filter((c) => c.comando === "interface_registro").map((c) => c.args)).toEqual([
      { linha: "movimento reduzido" },
      { linha: "movimento normal" },
    ]);
  });

  it("o prefers-reduced-motion e o data-movimento desligam keyframes e transições", () => {
    const regra = /animation: none !important;\s*transition: none !important;/g;
    expect(BASE.match(regra)).toHaveLength(2);
    expect(BASE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(BASE).toContain(':root[data-movimento="reduzido"] *');
  });
});

/* ---------- alto contraste ---------- */

function* arquivosCss(pasta: string): Generator<string> {
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) yield* arquivosCss(caminho);
    else if (e.name.endsWith(".css") && !caminho.includes("tokens")) yield caminho;
  }
}

describe("alto contraste do Windows", () => {
  it("só usa cores do sistema, e toda classe que ele ajusta existe num componente", () => {
    const componentes = [...arquivosCss("src")].map((c) => readFileSync(c, "utf8")).join("\n");
    const classes = new Set([...ALTO_CONTRASTE.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]!));
    const ausentes = [...classes].filter((c) => !componentes.includes(`.${c}`));
    expect(ausentes).toEqual([]);
    expect(ALTO_CONTRASTE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(ALTO_CONTRASTE).toMatch(/^@media \(forced-colors: active\) \{/m);
  });

  it("anel de foco, item atual e opção marcada usam Highlight", () => {
    expect(ALTO_CONTRASTE).toMatch(/:focus-visible,[\s\S]*?outline-color: Highlight;/);
    expect(ALTO_CONTRASTE).toMatch(/\.navegacao-item\[aria-current="page"\],[\s\S]*?background: Highlight;/);
    expect(ALTO_CONTRASTE).toMatch(/\.seletor-opcao\[aria-checked="true"\]/);
  });
});
