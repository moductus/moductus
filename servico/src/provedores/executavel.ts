import { readFileSync, statSync } from "node:fs";
import { join, win32 } from "node:path";

/**
 * Como iniciar um CLI achado no PC sem shell (ADR-0025, ADR-0037). Executável comum roda direto. O
 * `.cmd` do npm só roda pelo `cmd.exe`, e as instruções do agente vão como argumento: em vez de
 * escapar texto livre para o shell, o serviço lê o shim, acha o programa que ele chama e roda esse
 * programa direto (`node.exe <script>` ou o executável nativo do pacote).
 */

/** O programa a iniciar e o que vai antes dos argumentos do CLI (o script, quando é o node). */
export interface AlvoCli {
  executavel: string;
  antes: readonly string[];
}

/** O que a leitura do shim precisa do disco; os testes trocam por arquivos de mentira. */
export interface Arquivos {
  /** O texto do arquivo; `null` se não existe ou não dá para ler. */
  ler: (caminho: string) => string | null;
  eArquivo: (caminho: string) => boolean;
}

/** Shim do npm é maior que isto só se não for shim: não se lê arquivo grande à toa. */
const TAMANHO_MAXIMO_SHIM = 64 * 1024;

export const ARQUIVOS_DO_DISCO: Arquivos = {
  ler: (caminho) => {
    try {
      const tamanho = statSync(caminho, { throwIfNoEntry: false })?.size;
      if (tamanho === undefined || tamanho > TAMANHO_MAXIMO_SHIM) return null;
      return readFileSync(caminho, "utf8");
    } catch {
      return null;
    }
  },
  eArquivo: arquivoExiste,
};

/** `.cmd` e `.bat`, como o npm instala os comandos no Windows. */
export const ehShim = (caminho: string) => /\.(cmd|bat)$/i.test(caminho);

/**
 * O que iniciar para rodar `caminho` sem shell. Executável comum é ele mesmo; shim do npm é o
 * programa que ele chama; shim que não dá para ler, ou cujo alvo não existe, é `null`: só rodaria
 * pelo `cmd.exe`.
 */
export function alvoDoCli(
  caminho: string,
  ambiente: NodeJS.ProcessEnv = process.env,
  arquivos: Arquivos = ARQUIVOS_DO_DISCO,
): AlvoCli | null {
  if (!ehShim(caminho)) return { executavel: caminho, antes: [] };
  const texto = arquivos.ler(caminho);
  return texto === null ? null : alvoDoShim(texto, win32.dirname(caminho), ambiente, arquivos);
}

/**
 * A linha que chama o script pelo `_prog`, inteira e do começo, como o cmd-shim a grava (o
 * `endLocal & goto ...` evita a pergunta "Terminate batch job?"): linha com REM não vale.
 */
const PELO_NODE =
  /^endLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%"[ \t]+"%dp0%\\([^"%\r\n]+)"[ \t]+%\*[ \t]*$/im;

/** A linha que chama o executável nativo, do começo ao fim. */
const NATIVO = /^"%dp0%\\([^"%\r\n]+\.(?:exe|com))"[ \t]+%\*[ \t]*$/im;

/** As variáveis que o cmd-shim define; qualquer outra (`@SET` do shebang) muda o que o shim roda. */
const VARIAVEIS_DO_SHIM = new Set(["DP0", "_PROG", "PATHEXT"]);

/**
 * Os dois formatos do `cmd-shim` que o npm grava, conferidos nos shims do npm em `%APPDATA%\npm`
 * em 16/10/2026:
 * - script com `#!/usr/bin/env node`: a última linha chama `"%_prog%"  "%dp0%\<script>" %*`, e o
 *   `_prog` é o `node.exe` ao lado do shim ou, sem ele, o `node` do PATH;
 * - executável nativo: a linha é `"%dp0%\<programa>.exe"   %*`.
 *
 * Qualquer outra forma (argumentos no shebang, outro interpretador, variável de ambiente do
 * shebang em `@SET`, shim escrito à mão, linha comentada) é `null`: adivinhar o que o shim faria é
 * rodar outra coisa no lugar dele.
 */
export function alvoDoShim(
  texto: string,
  pasta: string,
  ambiente: NodeJS.ProcessEnv,
  arquivos: Arquivos,
): AlvoCli | null {
  if (!soVariaveisDoShim(texto)) return null;
  const peloNode = PELO_NODE.exec(texto);
  if (peloNode && /^[ \t]*SET "_prog=node"[ \t]*$/im.test(texto)) {
    const script = win32.join(pasta, peloNode[1]!);
    if (!arquivos.eArquivo(script)) return null;
    const node = nodeDoShim(pasta, ambiente, arquivos);
    return node ? { executavel: node, antes: [script] } : null;
  }
  const nativo = NATIVO.exec(texto);
  if (nativo) {
    const programa = win32.join(pasta, nativo[1]!);
    return arquivos.eArquivo(programa) ? { executavel: programa, antes: [] } : null;
  }
  return null;
}

function soVariaveisDoShim(texto: string): boolean {
  for (const [, nome] of texto.matchAll(/^[ \t]*@?SET[ \t]+"?([^="\s]+)=/gim)) {
    if (!VARIAVEIS_DO_SHIM.has(nome!.toUpperCase())) return false;
  }
  return true;
}

/**
 * O node que o shim usaria: o `node.exe` ao lado dele ou o do PATH. Só o `.exe`: um `node.cmd`
 * no PATH (gerenciador de versões) seria outro shim, que só roda pelo `cmd.exe`.
 */
function nodeDoShim(pasta: string, ambiente: NodeJS.ProcessEnv, arquivos: Arquivos): string | null {
  const aoLado = win32.join(pasta, "node.exe");
  if (arquivos.eArquivo(aoLado)) return aoLado;
  const soExe: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(ambiente).filter(([nome]) => nome.toUpperCase() !== "PATHEXT"),
  );
  soExe.PATHEXT = ".EXE";
  return acharNoPath("node", soExe, true, arquivos.eArquivo);
}

/**
 * O caminho do comando como o Windows acharia: cada pasta do PATH, em ordem, com cada extensão do
 * PATHEXT. No Windows o nome sem extensão não vale: o npm deixa ao lado do `.cmd` um script de
 * shell sem extensão, que não roda fora do bash.
 */
export function acharNoPath(
  comando: string,
  ambiente: NodeJS.ProcessEnv = process.env,
  windows = process.platform === "win32",
  eArquivo: (caminho: string) => boolean = arquivoExiste,
): string | null {
  for (const candidato of noPath(comando, ambiente, windows, eArquivo)) return candidato;
  return null;
}

/**
 * Todos os arquivos do comando no PATH, na ordem em que o Windows os tentaria. Quem roda sem shell
 * passa adiante de um `.cmd` que só o `cmd.exe` rodaria, até um que rode.
 */
export function* noPath(
  comando: string,
  ambiente: NodeJS.ProcessEnv = process.env,
  windows = process.platform === "win32",
  eArquivo: (caminho: string) => boolean = arquivoExiste,
): Generator<string> {
  const caminho = valorDe(ambiente, "PATH") ?? "";
  const pastas = caminho.split(windows ? ";" : ":").filter((p) => p.trim() !== "");
  const extensoes = windows
    ? (valorDe(ambiente, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const pasta of pastas) {
    const limpa = pasta.trim().replace(/^"(.*)"$/, "$1");
    for (const extensao of extensoes) {
      const candidato = join(limpa, comando + extensao.toLowerCase());
      if (eArquivo(candidato)) yield candidato;
    }
  }
}

export function arquivoExiste(caminho: string): boolean {
  return statSync(caminho, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** Variável de ambiente sem diferenciar caixa, como o Windows lê (`Path`, `PATH`). */
function valorDe(ambiente: NodeJS.ProcessEnv, nome: string): string | undefined {
  const chave = Object.keys(ambiente).find((k) => k.toUpperCase() === nome);
  return chave === undefined ? undefined : ambiente[chave];
}
