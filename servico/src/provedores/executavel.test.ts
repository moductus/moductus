import { describe, expect, test } from "vitest";
import { alvoDoCli, type Arquivos } from "./executavel.ts";

// Os dois formatos do cmd-shim, copiados dos shims que o npm grava em %APPDATA%\npm.
const SHIM_NODE = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  "",
].join("\r\n");

const SHIM_NATIVO = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  "",
].join("\r\n");

const NPM = "C:\\Users\\x\\AppData\\Roaming\\npm";
const SCRIPT = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
const NATIVO = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
const NODE_DO_PATH = "C:\\Program Files\\nodejs\\node.exe";

/** Um disco de mentira: os shims com o texto dado e os arquivos que existem. */
function disco(shims: Record<string, string>, existentes: string[]): Arquivos {
  const todos = new Set([...Object.keys(shims), ...existentes].map((c) => c.toLowerCase()));
  return {
    ler: (caminho) => shims[caminho] ?? null,
    eArquivo: (caminho) => todos.has(caminho.toLowerCase()),
  };
}

const ambiente = { Path: "C:\\Program Files\\nodejs;C:\\outro", PATHEXT: ".COM;.EXE;.BAT;.CMD" };

describe("alvo do CLI sem shell", () => {
  test("executável comum roda direto, sem ler nada", () => {
    const nada = disco({}, []);
    expect(alvoDoCli("C:\\local\\claude.exe", ambiente, nada)).toEqual({
      executavel: "C:\\local\\claude.exe",
      antes: [],
    });
  });

  test("shim do npm de script roda pelo node do PATH com o script do pacote", () => {
    const arquivos = disco({ [`${NPM}\\claude.cmd`]: SHIM_NODE }, [SCRIPT, NODE_DO_PATH]);
    expect(alvoDoCli(`${NPM}\\claude.cmd`, ambiente, arquivos)).toEqual({
      executavel: NODE_DO_PATH,
      antes: [SCRIPT],
    });
  });

  test("o node.exe ao lado do shim vem antes do PATH, como no próprio shim", () => {
    const arquivos = disco({ [`${NPM}\\claude.cmd`]: SHIM_NODE }, [SCRIPT, NODE_DO_PATH, `${NPM}\\node.exe`]);
    expect(alvoDoCli(`${NPM}\\claude.cmd`, ambiente, arquivos)?.executavel).toBe(`${NPM}\\node.exe`);
  });

  test("shim do npm de executável nativo roda o executável do pacote", () => {
    const arquivos = disco({ [`${NPM}\\claude.cmd`]: SHIM_NATIVO }, [NATIVO]);
    expect(alvoDoCli(`${NPM}\\claude.cmd`, ambiente, arquivos)).toEqual({ executavel: NATIVO, antes: [] });
  });

  test("shim sem alvo é nulo: script ou executável que não existe, node só em .cmd, shim ilegível", () => {
    const shim = `${NPM}\\claude.cmd`;
    // O pacote foi apagado e o shim ficou.
    expect(alvoDoCli(shim, ambiente, disco({ [shim]: SHIM_NODE }, [NODE_DO_PATH]))).toBeNull();
    expect(alvoDoCli(shim, ambiente, disco({ [shim]: SHIM_NATIVO }, []))).toBeNull();
    // O node do PATH é outro shim (gerenciador de versões): também só rodaria pelo cmd.exe.
    const soNodeCmd = disco({ [shim]: SHIM_NODE }, [SCRIPT, "C:\\Program Files\\nodejs\\node.cmd"]);
    expect(alvoDoCli(shim, ambiente, soNodeCmd)).toBeNull();
    // O arquivo não existe ou não dá para ler.
    expect(alvoDoCli(shim, ambiente, disco({}, []))).toBeNull();
  });

  test("shim de outra forma não é adivinhado: shebang com argumento, outro interpretador, escrito à mão", () => {
    const shim = `${NPM}\\claude.cmd`;
    const existentes = [SCRIPT, NODE_DO_PATH, NATIVO];
    const comArgumento = SHIM_NODE.replace('"%_prog%"  "%dp0%', '"%_prog%" --no-warnings "%dp0%');
    const outroInterpretador = SHIM_NODE.replace('SET "_prog=node"', 'SET "_prog=bun"');
    const aMao = "@echo off\r\nnode %~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js %*\r\n";
    const nativoQueEhCmd = SHIM_NATIVO.replace("claude.exe", "claude.cmd");
    for (const texto of [comArgumento, outroInterpretador, aMao, nativoQueEhCmd]) {
      expect(alvoDoCli(shim, ambiente, disco({ [shim]: texto }, existentes))).toBeNull();
    }
  });

  test("variável fora das do cmd-shim (o `@SET` de um shebang com ambiente) não é adivinhada", () => {
    const shim = `${NPM}\\claude.cmd`;
    const existentes = [SCRIPT, NODE_DO_PATH, NATIVO];
    const comAmbiente = (texto: string, linha: string) =>
      texto.replace("CALL :find_dp0\r\n", `CALL :find_dp0\r\n${linha}\r\n`);
    for (const texto of [
      comAmbiente(SHIM_NODE, "@SET NODE_OPTIONS=--require=C:\\outro.js"),
      comAmbiente(SHIM_NATIVO, "@SET CLAUDE_CONFIG_DIR=C:\\outra-conta"),
      comAmbiente(SHIM_NODE, 'SET "ANTHROPIC_API_KEY=x"'),
    ]) {
      expect(alvoDoCli(shim, ambiente, disco({ [shim]: texto }, existentes))).toBeNull();
    }
    // As três do próprio cmd-shim, em qualquer caixa, continuam valendo.
    const emCaixaAlta = SHIM_NODE.replace("SET dp0=", "SET DP0=");
    expect(alvoDoCli(shim, ambiente, disco({ [shim]: emCaixaAlta }, existentes))?.antes).toEqual([SCRIPT]);
  });

  test("a linha do programa vale só inteira, do começo: comentada ou com outro prefixo é nula", () => {
    const shim = `${NPM}\\claude.cmd`;
    const existentes = [SCRIPT, NODE_DO_PATH, NATIVO];
    const linhaNode = SHIM_NODE.split("\r\n").find((l) => l.startsWith("endLocal"))!;
    const linhaNativo = SHIM_NATIVO.split("\r\n").find((l) => l.startsWith('"%dp0%'))!;
    for (const texto of [
      SHIM_NODE.replace(linhaNode, `REM ${linhaNode}`),
      SHIM_NODE.replace(linhaNode, linhaNode.replace(/^.*& "%_prog%"/, '"%_prog%"')),
      SHIM_NODE.replace(linhaNode, linhaNode.replace("endLocal &", "outro.exe & endLocal &")),
      SHIM_NATIVO.replace(linhaNativo, `REM ${linhaNativo}`),
      SHIM_NATIVO.replace(linhaNativo, `outro.exe & ${linhaNativo}`),
    ]) {
      expect(alvoDoCli(shim, ambiente, disco({ [shim]: texto }, existentes))).toBeNull();
    }
  });
});
