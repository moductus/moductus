import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProvedorDetectado } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  acharNoPath,
  compararVersoes,
  detectar,
  loginDoClaude,
  rodarComPrazo,
  versaoDe,
  type RespostaCli,
  type RodarCli,
} from "./deteccao.ts";

/** `claude auth status` gravado da 2.1.287, sem e-mail nem organização. */
const STATUS_LOGADO = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" });

describe("achar no PATH", () => {
  const existentes = new Set([
    join("C:\\npm", "gemini"),
    join("C:\\npm", "gemini.cmd"),
    join("C:\\local", "claude.exe"),
    join("C:\\outro", "claude.exe"),
  ]);
  const eArquivo = (c: string) => existentes.has(c);

  test("no Windows segue a ordem do PATH e do PATHEXT, e ignora o script sem extensão do npm", () => {
    const ambiente = { Path: 'C:\\vazio;"C:\\local";C:\\outro;C:\\npm', PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    expect(acharNoPath("claude", ambiente, true, eArquivo)).toBe(join("C:\\local", "claude.exe"));
    expect(acharNoPath("gemini", ambiente, true, eArquivo)).toBe(join("C:\\npm", "gemini.cmd"));
    expect(acharNoPath("codex", ambiente, true, eArquivo)).toBeNull();
  });

  test("sem PATH, nada é achado", () => {
    expect(acharNoPath("claude", {}, true, eArquivo)).toBeNull();
  });
});

describe("versão e login", () => {
  test("lê a versão do jeito que cada CLI escreve", () => {
    expect(versaoDe("2.1.287 (Claude Code)\n")).toBe("2.1.287");
    expect(versaoDe("codex-cli 0.46.0")).toBe("0.46.0");
    expect(versaoDe("sem versão")).toBeNull();
  });

  test("compara número a número, não como texto", () => {
    expect(compararVersoes("2.1.100", "2.1.257")).toBeLessThan(0);
    expect(compararVersoes("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compararVersoes("2.1.257", "2.1.257")).toBe(0);
  });

  test("login do Claude Code pelo JSON; o que não dá para ler é não sei", () => {
    expect(loginDoClaude({ codigo: 0, saida: STATUS_LOGADO })).toBe(true);
    expect(loginDoClaude({ codigo: 1, saida: JSON.stringify({ loggedIn: false }) })).toBe(false);
    expect(loginDoClaude({ codigo: 1, saida: "error: unknown command 'auth'" })).toBeNull();
  });
});

describe("detectar", () => {
  /** Respostas gravadas por caminho e argumentos; o que não está aqui falha como CLI quebrado. */
  function cli(respostas: Record<string, RespostaCli>) {
    const chamadas: { linha: string; ambiente: NodeJS.ProcessEnv }[] = [];
    const rodar: RodarCli = (caminho, argumentos, ambiente) => {
      const linha = [caminho, ...argumentos].join(" ");
      chamadas.push({ linha, ambiente });
      const resposta = respostas[linha];
      return resposta ? Promise.resolve(resposta) : Promise.reject(new Error("spawn EINVAL"));
    };
    return { rodar, chamadas };
  }
  const caminhos: Record<string, string> = {
    claude: "C:\\local\\claude.exe",
    gemini: "C:\\npm\\gemini.cmd",
    opencode: "C:\\npm\\opencode.cmd",
  };
  const achar = (comando: string) => caminhos[comando] ?? null;
  const atende = (tipo: string) => tipo === "claude-cli";

  test("acha os CLIs com versão e login, só pergunta o login a quem sabe dizer", async () => {
    const { rodar, chamadas } = cli({
      "C:\\local\\claude.exe --version": { codigo: 0, saida: "2.1.287 (Claude Code)\n" },
      "C:\\local\\claude.exe auth status --json": { codigo: 0, saida: STATUS_LOGADO },
      "C:\\npm\\gemini.cmd --version": { codigo: 0, saida: "0.42.0\n" },
    });
    const ambiente = { ANTHROPIC_API_KEY: "sk-ant-x", PATH: "C:\\local" };

    const achados = await detectar({ atende, rodar, achar, ambiente });

    expect(achados.map((a) => ProvedorDetectado.parse(a))).toEqual([
      {
        tipo: "claude-cli",
        caminho: "C:\\local\\claude.exe",
        versao: "2.1.287",
        logado: true,
        impedimento: null,
        versaoMinima: null,
      },
      // O gemini não tem adaptador nesta versão, e o opencode quebrado aparece sem versão.
      {
        tipo: "gemini-cli",
        caminho: "C:\\npm\\gemini.cmd",
        versao: "0.42.0",
        logado: null,
        impedimento: "sem_adaptador",
        versaoMinima: null,
      },
      {
        tipo: "opencode-cli",
        caminho: "C:\\npm\\opencode.cmd",
        versao: null,
        logado: null,
        impedimento: "sem_adaptador",
        versaoMinima: null,
      },
    ]);
    expect(chamadas.map((c) => c.linha).sort()).toEqual([
      "C:\\local\\claude.exe --version",
      "C:\\local\\claude.exe auth status --json",
      "C:\\npm\\gemini.cmd --version",
      "C:\\npm\\opencode.cmd --version",
    ]);
    // O Claude Code é perguntado no ambiente dos agentes: sem a chave de API, que trocaria o login.
    const doClaude = chamadas.filter((c) => c.linha.startsWith("C:\\local"));
    for (const c of doClaude) expect(c.ambiente).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(chamadas.find((c) => c.linha.startsWith("C:\\npm\\gemini"))?.ambiente).toBe(ambiente);
  });

  test("Claude Code mais velho que o adaptador pede diz a versão mínima", async () => {
    const { rodar } = cli({
      "C:\\local\\claude.exe --version": { codigo: 0, saida: "2.1.100 (Claude Code)" },
      "C:\\local\\claude.exe auth status --json": { codigo: 0, saida: STATUS_LOGADO },
    });
    const [claude] = await detectar({
      atende,
      rodar,
      achar: (c) => (c === "claude" ? caminhos.claude! : null),
    });
    expect(claude).toMatchObject({ versao: "2.1.100", versaoMinima: "2.1.257" });
  });

  test("nada no PATH, nenhum CLI rodado", async () => {
    const { rodar, chamadas } = cli({});
    await expect(detectar({ atende, rodar, achar: () => null })).resolves.toEqual([]);
    expect(chamadas).toEqual([]);
  });

  test("o Claude Code do npm (.cmd) aparece, mas o Moductus não o usa", async () => {
    const { rodar } = cli({
      "C:\\npm\\claude.cmd --version": { codigo: 0, saida: "2.1.287 (Claude Code)" },
      "C:\\npm\\claude.cmd auth status --json": { codigo: 0, saida: STATUS_LOGADO },
    });
    const [claude] = await detectar({
      atende,
      rodar,
      achar: (c) => (c === "claude" ? "C:\\npm\\claude.cmd" : null),
    });
    expect(claude).toMatchObject({ logado: true, impedimento: "instalado_pelo_npm" });
  });
});

describe("rodar o CLI", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  /** O pid que o neto escreveu no arquivo; `null` enquanto o arquivo não existe ou está vazio. */
  function pidEscrito(arquivo: string): number | null {
    const texto = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
    return texto === "" ? null : Number(texto);
  }

  /** Resolve com o pid quando o neto o escreve: pelo aviso da pasta, conferido também de saída. */
  function quandoOPidChegar(arquivo: string): Promise<number> {
    return new Promise((resolve) => {
      const conferir = () => {
        const pid = pidEscrito(arquivo);
        if (pid === null) return;
        vigia.close();
        resolve(pid);
      };
      const vigia = watch(dirname(arquivo), conferir);
      conferir();
    });
  }

  function vivo(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // Um .cmd que abre um node que não sai, como o do npm: matar o cmd.exe não fecharia a saída.
  // O prazo é disparado pelo teste quando o neto avisa que está de pé, e não por relógio: o `echo`
  // já saiu antes de o cmd.exe abrir o neto, com a máquina carregada ou não. O neto dura 120 s e
  // o teste tem 30 s: esperar o `close` estouraria o teste, e `codigo: null` diz que foi o prazo.
  // O teste só acaba com o neto morto: sem isso, o worker do vitest podia sair antes de o
  // `taskkill` terminar, e o neto ficava órfão até o fim dos 120 s.
  test.runIf(process.platform === "win32")(
    "o prazo vale para o .cmd: a árvore cai e a resposta sai sem esperar o neto",
    async () => {
      const pasta = mkdtempSync(join(tmpdir(), "moductus-sonda-"));
      pastas.push(pasta);
      const cmd = join(pasta, "travado.cmd");
      const dePe = join(pasta, "neto-de-pe");
      const neto = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 120000)`;
      writeFileSync(cmd, `@echo 1.2.3\r\n@"${process.execPath}" -e "${neto}" "${dePe}"\r\n`);
      const prazo = new AbortController();
      const pidDoNeto = quandoOPidChegar(dePe);

      const resposta = rodarComPrazo(cmd, ["--version"], process.env, prazo.signal);
      const pid = await pidDoNeto;
      prazo.abort();

      expect(await resposta).toEqual({ codigo: null, saida: "1.2.3\r\n" });
      await vi.waitFor(() => expect(vivo(pid)).toBe(false), { timeout: 25_000 });
    },
    30_000,
  );

  // O sinal já vencido é atendido na hora, antes de qualquer saída do CLI: `codigo: null` e saída
  // vazia, mesmo que o `--version` responda e saia sozinho logo depois.
  test("prazo já vencido responde na hora, sem esperar o CLI", async () => {
    const resposta = await rodarComPrazo(process.execPath, ["--version"], process.env, AbortSignal.abort());
    expect(resposta).toEqual({ codigo: null, saida: "" });
  });
});
