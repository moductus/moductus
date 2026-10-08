#!/usr/bin/env node
// Regra "nenhum valor visual literal fora de src/tokens": cor, medida, sombra e fonte só
// existem como token. Fora de src/tokens, CSS e TS/TSX usam var(--...). Roda no `pnpm lint`.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COR_HEX = /(?<![\w.&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const COR_FUNCAO = /\b(?:rgba?|hsla?)\s*\(/i;
const MEDIDA = /(?<![\w-])-?\d*\.?\d+(?:px|rem|em)\b/;
const PROPRIEDADE_CSS = /(?:^|[;{\s])(box-shadow|font-family)\s*:\s*([^;}]+)/gi;
const PROPRIEDADE_ESTILO = /\b(boxShadow|fontFamily)\s*:\s*(['"`])((?:(?!\2).)*)\2/g;
const OBJETO_ESTILO = /style\s*=\s*\{\{([\s\S]*?)\}\}/g;
const NUMERO_ESTILO = /\b([A-Za-z]+)\s*:\s*(-?\d*\.?\d+)\b(?!\s*[\w.'"`])/g;
// Propriedades sem unidade que não são valor visual (ordem e distribuição de espaço).
const SEM_UNIDADE = new Set(["zIndex", "flex", "flexGrow", "flexShrink", "order"]);
// Aspas simples e duplas não atravessam linha (um apóstrofo em texto JSX não abre string).
const LITERAL_TEXTO = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g;

const usaSoToken = (valor) =>
  /^(?:var\(--[\w-]+\)\s*,?\s*)+$|^(?:inherit|initial|unset|none)$/i.test(valor.trim());

function semComentariosCss(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

function semComentariosTs(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/.*$/gm, (_, antes) => antes);
}

function linhaDe(texto, indice) {
  return texto.slice(0, indice).split("\n").length;
}

/** Valores proibidos num trecho de texto (linha de CSS ou literal de string). */
function proibidos(trecho) {
  const achados = [];
  if (COR_HEX.test(trecho)) achados.push("cor hex");
  if (COR_FUNCAO.test(trecho)) achados.push("cor rgb/hsl");
  const medida = trecho.match(MEDIDA);
  if (medida) achados.push(`medida ${medida[0].trim()}`);
  return achados;
}

/** Achados de um arquivo: `{ linha, motivo }`. Só CSS, TS e TSX são verificados. */
export function verificarConteudo(texto, caminho) {
  const achados = [];
  if (caminho.endsWith(".css")) {
    semComentariosCss(texto)
      .split("\n")
      .forEach((linha, i) => {
        for (const motivo of proibidos(linha)) achados.push({ linha: i + 1, motivo });
        for (const prop of linha.matchAll(PROPRIEDADE_CSS)) {
          if (!usaSoToken(prop[2])) achados.push({ linha: i + 1, motivo: `${prop[1]} literal` });
        }
      });
    return achados;
  }
  if (!/\.(?:ts|tsx|mts)$/.test(caminho)) return achados;

  const codigo = semComentariosTs(texto);
  for (const m of codigo.matchAll(LITERAL_TEXTO)) {
    // Caminhos de import não são valor visual.
    const antes = codigo.slice(Math.max(0, m.index - 12), m.index);
    if (/\b(?:from|import)\s*$/.test(antes)) continue;
    for (const motivo of proibidos(m[0].slice(1, -1)))
      achados.push({ linha: linhaDe(codigo, m.index), motivo });
  }
  for (const m of codigo.matchAll(PROPRIEDADE_ESTILO)) {
    if (!usaSoToken(m[3])) achados.push({ linha: linhaDe(codigo, m.index), motivo: `${m[1]} literal` });
  }
  for (const m of codigo.matchAll(OBJETO_ESTILO)) {
    for (const n of m[1].matchAll(NUMERO_ESTILO)) {
      if (SEM_UNIDADE.has(n[1]) || Number(n[2]) === 0) continue;
      achados.push({
        linha: linhaDe(codigo, m.index + 2 + n.index),
        motivo: `número ${n[2]} em style.${n[1]}`,
      });
    }
  }
  return achados;
}

function* arquivos(pasta) {
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) yield* arquivos(caminho);
    else yield caminho;
  }
}

/** Verifica `src/` da raiz dada, sem `src/tokens` e sem testes. */
export function verificarPasta(raiz) {
  const src = join(raiz, "src");
  const tokens = join(src, "tokens") + sep;
  const achados = [];
  for (const caminho of arquivos(src)) {
    if (caminho.startsWith(tokens) || /\.test\.[cm]?[jt]sx?$/.test(caminho)) continue;
    for (const a of verificarConteudo(readFileSync(caminho, "utf8"), caminho)) {
      achados.push({ arquivo: relative(raiz, caminho).split(sep).join("/"), ...a });
    }
  }
  return achados;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const achados = verificarPasta(raiz);
  for (const a of achados) console.error(`${a.arquivo}:${a.linha} ${a.motivo} fora de src/tokens`);
  if (achados.length > 0) {
    console.error(
      `lint-visual: ${achados.length} valor(es) visual(is) literal(is); use os tokens de src/tokens.`,
    );
    process.exit(1);
  }
  console.log("lint-visual: nenhum valor visual literal fora de src/tokens");
}
