import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { ProvedorDetectado, TipoProvedor, TipoProvedorCli } from "@moductus/contrato";
import { ambienteDoCli } from "./claude-cli/claude-cli.ts";

/**
 * Detecção dos CLIs de IA no PC (F2-08; PRODUCT.md §5 "Primeiro uso"): procura cada um no PATH,
 * pergunta a versão e, quando o CLI tem como dizer, se há login. Nada aqui chama o modelo nem
 * gasta a assinatura: o teste de verdade é o `testar` dos provedores, só quando o usuário pede.
 */

/** O nome de cada CLI no PATH. */
export const COMANDOS_CLI: Readonly<Record<TipoProvedorCli, string>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "opencode-cli": "opencode",
};

/**
 * A versão mais velha com que o adaptador funciona. A do Claude Code vem da flag mais nova que o
 * adaptador passa, `--system-prompt-snapshot` (2.1.257); a fixture gravada é da 2.1.287.
 */
export const VERSOES_MINIMAS: Readonly<Partial<Record<TipoProvedorCli, string>>> = {
  "claude-cli": "2.1.257",
};

/** Quanto esperar cada pergunta ao CLI; um CLI travado não segura a tela. */
export const PRAZO_SONDA_MS = 10_000;

/** O que o CLI respondeu: código de saída e a saída padrão. `codigo` é `null` se não terminou. */
export interface RespostaCli {
  codigo: number | null;
  saida: string;
}

/** Roda o CLI com argumentos fixos e devolve a resposta; os testes trocam por respostas gravadas. */
export type RodarCli = (
  caminho: string,
  argumentos: readonly string[],
  ambiente: NodeJS.ProcessEnv,
) => Promise<RespostaCli>;

export interface OpcoesDeteccao {
  /** Se esta versão do Moductus tem adaptador para o tipo (`RegistroProvedores.atende`). */
  atende: (tipo: TipoProvedor) => boolean;
  rodar?: RodarCli;
  /** Onde o comando está; sem isso, a busca no PATH do processo. */
  achar?: (comando: string) => string | null;
  ambiente?: NodeJS.ProcessEnv;
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
  const caminho = valorDe(ambiente, "PATH") ?? "";
  const pastas = caminho.split(windows ? ";" : ":").filter((p) => p.trim() !== "");
  const extensoes = windows
    ? (valorDe(ambiente, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const pasta of pastas) {
    const limpa = pasta.trim().replace(/^"(.*)"$/, "$1");
    for (const extensao of extensoes) {
      const candidato = join(limpa, comando + extensao.toLowerCase());
      if (eArquivo(candidato)) return candidato;
    }
  }
  return null;
}

/** A primeira versão no formato `1.2.3` que o CLI escreveu (`2.1.287 (Claude Code)`). */
export function versaoDe(saida: string): string | null {
  return /\b(\d+\.\d+\.\d+)\b/.exec(saida)?.[1] ?? null;
}

/** Compara `1.2.3` com `1.10.0` número a número; negativo quando `a` é mais velha. */
export function compararVersoes(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diferenca = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/**
 * O login do Claude Code pelo `claude auth status` (JSON por padrão; conferido na 2.1.287). O
 * ambiente é o mesmo dos agentes: sem as variáveis que trocariam a assinatura por chave de API.
 * Resposta que não dá para ler é "não sei", nunca "não logado".
 */
export function loginDoClaude(resposta: RespostaCli): boolean | null {
  try {
    const status = JSON.parse(resposta.saida) as { loggedIn?: unknown };
    return typeof status.loggedIn === "boolean" ? status.loggedIn : null;
  } catch {
    return null;
  }
}

/**
 * Os CLIs achados no PC, cada um com versão e login. Os quatro são procurados em paralelo; CLI
 * que não responde a tempo aparece sem versão. Só o Claude Code diz o login de um jeito
 * conferido: os outros ficam com `logado: null` até terem adaptador.
 */
export async function detectar(opcoes: OpcoesDeteccao): Promise<ProvedorDetectado[]> {
  const ambiente = opcoes.ambiente ?? process.env;
  const achar = opcoes.achar ?? ((comando: string) => acharNoPath(comando, ambiente));
  const rodar = opcoes.rodar ?? rodarCli;
  const perguntar = (caminho: string, argumentos: readonly string[], amb: NodeJS.ProcessEnv) =>
    rodar(caminho, argumentos, amb).catch((): RespostaCli => ({ codigo: null, saida: "" }));

  const tipos = Object.keys(COMANDOS_CLI) as TipoProvedorCli[];
  const achados = await Promise.all(
    tipos.map(async (tipo): Promise<ProvedorDetectado | null> => {
      const caminho = achar(COMANDOS_CLI[tipo]);
      if (!caminho) return null;
      const amb = tipo === "claude-cli" ? ambienteDoCli(ambiente, null) : ambiente;
      const [comVersao, comLogin] = await Promise.all([
        perguntar(caminho, ["--version"], amb),
        tipo === "claude-cli" ? perguntar(caminho, ["auth", "status", "--json"], amb) : null,
      ]);
      const versao = versaoDe(comVersao.saida);
      const minima = VERSOES_MINIMAS[tipo] ?? null;
      return {
        tipo,
        caminho,
        versao,
        logado: comLogin ? loginDoClaude(comLogin) : null,
        atendido: opcoes.atende(tipo),
        versaoMinima: versao && minima && compararVersoes(versao, minima) < 0 ? minima : null,
      };
    }),
  );
  return achados.filter((a): a is ProvedorDetectado => a !== null);
}

/**
 * Roda o CLI sem janela, com prazo. `.cmd` e `.bat` (instalação pelo npm) só rodam pelo `cmd.exe`:
 * o comando vai inteiro numa linha, com o caminho entre aspas e só argumentos fixos deste arquivo.
 */
export const rodarCli: RodarCli = (caminho, argumentos, ambiente) =>
  new Promise((resolve, reject) => {
    const peloCmd = /\.(cmd|bat)$/i.test(caminho);
    const processo = peloCmd
      ? spawn(`"${caminho}" ${argumentos.join(" ")}`, { shell: true, env: ambiente, windowsHide: true })
      : spawn(caminho, [...argumentos], { env: ambiente, windowsHide: true });
    let saida = "";
    processo.stdout.setEncoding("utf8");
    processo.stdout.on("data", (pedaco: string) => (saida = (saida + pedaco).slice(-20_000)));
    processo.stderr.resume();
    processo.stdin.end();
    const prazo = setTimeout(() => processo.kill(), PRAZO_SONDA_MS);
    processo.once("error", (erro) => {
      clearTimeout(prazo);
      reject(erro);
    });
    processo.once("close", (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo, saida });
    });
  });

function arquivoExiste(caminho: string): boolean {
  return statSync(caminho, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** Variável de ambiente sem diferenciar caixa, como o Windows lê (`Path`, `PATH`). */
function valorDe(ambiente: NodeJS.ProcessEnv, nome: string): string | undefined {
  const chave = Object.keys(ambiente).find((k) => k.toUpperCase() === nome);
  return chave === undefined ? undefined : ambiente[chave];
}
