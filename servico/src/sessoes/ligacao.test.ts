import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { MudancaArquivo } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import {
  caminhoSettingsClaude,
  COPIAS_GUARDADAS,
  comOMoductus,
  EVENTOS_LIGADOS,
  eDoMoductus,
  ESPERA_PERMISSAO_S,
  hookDoMoductus,
  LigacaoClaudeCode,
  semOMoductus,
  SettingsInvalido,
  situacaoDosHooks,
  trocarChaveRaiz,
  VARIAVEL_TOKEN,
} from "./ligacao.ts";

const PORTA = 47821;
const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/**
 * Um `settings.json` numa pasta temporária: nunca o do usuário desta máquina. A memória de antes
 * de ligar vai para outra pasta temporária, como a pasta de dados do Moductus; `semMemoria`
 * simula a memória perdida. `relogioParado` faz todas as cópias caírem no mesmo milissegundo.
 */
function montar(conteudo?: string, opcoes: { semMemoria?: boolean; relogioParado?: boolean } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ligacao-"));
  pastas.push(pasta);
  const caminho = join(pasta, "settings.json");
  if (conteudo !== undefined) writeFileSync(caminho, conteudo, "utf8");
  let agora = new Date("2026-10-09T12:00:00.000Z");
  const memoria = opcoes.semMemoria ? undefined : join(pasta, "dados-moductus", "ligacao-claude-code.json");
  const nova = () =>
    new LigacaoClaudeCode({
      caminho,
      porta: PORTA,
      memoria,
      agora: () => (opcoes.relogioParado ? agora : (agora = new Date(agora.getTime() + 1000))),
    });
  const ligacao = nova();
  const ler = () => readFileSync(caminho, "utf8");
  const copias = () => readdirSync(pasta).filter((f) => f.endsWith(".bak"));
  return { pasta, caminho, ligacao, nova, ler, copias };
}

/** Hooks do próprio usuário, que o Moductus nunca pode tocar. */
const HOOKS_DO_USUARIO = {
  PreToolUse: [
    { matcher: "Bash", hooks: [{ type: "command", command: "pwsh -File C:\\guarda.ps1", timeout: 5 }] },
  ],
  Stop: [{ hooks: [{ type: "command", command: "echo fim" }] }],
  PostToolUse: [{ matcher: "Edit", hooks: [{ type: "http", url: "http://127.0.0.1:9000/meu-hook" }] }],
};

/** Como o Claude Code grava: dois espaços; aqui com CRLF, como os arquivos do Windows. */
const ORIGINAL = JSON.stringify(
  {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    model: "opus",
    env: { MINHA_CHAVE: "não aparece na prévia" },
    hooks: HOOKS_DO_USUARIO,
    permissions: { allow: ["Bash(git status)"], deny: [] },
    statusLine: { type: "command", command: "rtk statusline" },
  },
  null,
  2,
)
  .split("\n")
  .join("\r\n")
  .concat("\r\n");

describe("ligar e desligar o Claude Code no settings.json", () => {
  test("ligar e desligar duas vezes devolve o arquivo byte a byte, com os hooks do usuário intocados", () => {
    const { ligacao, ler } = montar(ORIGINAL);

    for (let volta = 0; volta < 2; volta++) {
      expect(ligacao.ligar().mudou).toBe(true);
      const ligado = JSON.parse(ler()) as { hooks: Record<string, unknown[]> };
      expect(ligacao.situacao()).toBe("ligada");
      // Os do usuário continuam primeiro em cada evento, iguais; o do Moductus entra no fim.
      expect(ligado.hooks.PreToolUse?.[0]).toEqual(HOOKS_DO_USUARIO.PreToolUse[0]);
      expect(ligado.hooks.Stop?.[0]).toEqual(HOOKS_DO_USUARIO.Stop[0]);
      expect(ligado.hooks.PostToolUse?.[0]).toEqual(HOOKS_DO_USUARIO.PostToolUse[0]);
      for (const evento of EVENTOS_LIGADOS) {
        expect(
          ligado.hooks[evento]?.filter((g) => (g as { hooks: unknown[] }).hooks.some(eDoMoductus)),
        ).toHaveLength(1);
      }
      expect(ler()).toContain("\r\n");
      expect(ler()).not.toMatch(/[^\r]\n/);

      expect(ligacao.desligar().mudou).toBe(true);
      expect(ler()).toBe(ORIGINAL);
      expect(ligacao.situacao()).toBe("desligada");
    }
  });

  test("sem hooks antes: a chave entra e sai inteira; o resto do arquivo não muda nem de formatação", () => {
    const original = '{\n    "model": "sonnet",\n    "env": {"A": "1"},   "outro": [1,2]\n}\n';
    const { ligacao, ler } = montar(original);
    ligacao.ligar();
    expect(
      ler().startsWith(
        '{\n    "model": "sonnet",\n    "env": {"A": "1"},   "outro": [1,2],\n    "hooks": {\n        "SessionStart"',
      ),
    ).toBe(true);
    ligacao.ligar();
    ligacao.desligar();
    expect(ler()).toBe(original);
  });

  test("arquivo compacto, objeto vazio e chave hooks primeira também voltam iguais", () => {
    const hooksPrimeiro = `${JSON.stringify({ hooks: { Stop: HOOKS_DO_USUARIO.Stop }, model: "opus" }, null, 2)}\n`;
    for (const original of ['{"model":"opus","x":true}', "{}", hooksPrimeiro]) {
      const { ligacao, ler } = montar(original);
      ligacao.ligar();
      expect(ligacao.situacao()).toBe("ligada");
      ligacao.desligar();
      ligacao.ligar();
      ligacao.desligar();
      expect(ler()).toBe(original);
    }
  });

  test("ligar duas vezes não duplica nem escreve; desligar o desligado não escreve", () => {
    const { ligacao, ler, copias } = montar(ORIGINAL);
    expect(ligacao.desligar()).toEqual({ mudou: false, copia: null });
    expect(copias()).toHaveLength(0);
    ligacao.ligar();
    const ligado = ler();
    expect(ligacao.ligar()).toEqual({ mudou: false, copia: null });
    expect(ler()).toBe(ligado);
    expect(copias()).toHaveLength(1);
  });

  test("cópia de segurança antes de cada escrita, com o conteúdo de antes; ficam a primeira e as últimas", () => {
    const { ligacao, ler, copias, pasta } = montar(ORIGINAL);
    const { copia } = ligacao.ligar();
    expect(copia).not.toBeNull();
    expect(readFileSync(copia ?? "", "utf8")).toBe(ORIGINAL);
    const ligado = ler();
    const desligou = ligacao.desligar();
    expect(readFileSync(desligou.copia ?? "", "utf8")).toBe(ligado);
    for (let i = 0; i < COPIAS_GUARDADAS; i++) {
      ligacao.ligar();
      ligacao.desligar();
    }
    const guardadas = copias().sort();
    expect(guardadas).toHaveLength(COPIAS_GUARDADAS + 1);
    expect(
      guardadas.every((f) => /^settings\.json\.moductus-2026-10-09T12-\d\d-\d\d-000Z\.bak$/.test(f)),
    ).toBe(true);
    // A primeira é o arquivo de antes do Moductus, e não sai.
    expect(guardadas[0]).toBe(basename(copia ?? ""));
    expect(readFileSync(join(pasta, guardadas[0] ?? ""), "utf8")).toBe(ORIGINAL);
  });

  test("cópias no mesmo milissegundo: o sufixo conta como número, e a primeira fica", () => {
    const { ligacao, copias } = montar(ORIGINAL, { relogioParado: true });
    for (let i = 0; i < 6; i++) {
      ligacao.ligar();
      ligacao.desligar();
    }
    const base = "settings.json.moductus-2026-10-09T12-00-00-000Z";
    expect(copias().sort()).toEqual(
      [`${base}.bak`, ...[8, 9, 10, 11, 12].map((n) => `${base}-${n}.bak`)].sort(),
    );
  });

  test("sem settings.json, ligar cria o arquivo só com os hooks; desligar apaga o que o Moductus criou", () => {
    const { ligacao, caminho, ler, copias } = montar();
    expect(ligacao.previa().antes).toBeNull();
    expect(ligacao.ligar()).toEqual({ mudou: true, copia: null });
    expect(Object.keys(JSON.parse(ler()) as object)).toEqual(["hooks"]);
    expect(ler().endsWith("}\n")).toBe(true);
    expect(ligacao.desligar()).toEqual({ mudou: true, copia: null });
    expect(existsSync(caminho)).toBe(false);
    expect(copias()).toHaveLength(0);
  });

  test("arquivo criado pelo Moductus que ganhou outra chave depois não é apagado ao desligar", () => {
    const { ligacao, caminho, ler } = montar();
    ligacao.ligar();
    writeFileSync(caminho, trocarChaveRaiz(ler(), "model", "opus"), "utf8");
    ligacao.desligar();
    expect(JSON.parse(ler())).toEqual({ model: "opus" });
  });

  test("arquivo que não é JSON não é tocado: nem prévia, nem ligar, nem desligar", () => {
    const quebrado = '{ "model": "opus", // comentário\n}';
    const { ligacao, ler, copias } = montar(quebrado);
    expect(() => ligacao.previa()).toThrow(SettingsInvalido);
    expect(() => ligacao.ligar()).toThrow(SettingsInvalido);
    expect(() => ligacao.desligar()).toThrow(SettingsInvalido);
    expect(ler()).toBe(quebrado);
    expect(copias()).toHaveLength(0);
    expect(() => montar("[1, 2]").ligacao.ligar()).toThrow(SettingsInvalido);
    expect(() => montar('{"hooks": {"Stop": "x"}}').ligacao.ligar()).toThrow(SettingsInvalido);
  });

  test("a prévia mostra só o bloco hooks, antes e depois, e não grava nada", () => {
    const { ligacao, ler, copias, caminho } = montar(ORIGINAL);
    const previa = ligacao.previa();
    expect(MudancaArquivo.parse(previa)).toEqual(previa);
    expect(previa.caminho).toBe(caminho);
    expect(previa.trecho).toBe("hooks");
    expect(JSON.parse(previa.antes ?? "")).toEqual(HOOKS_DO_USUARIO);
    expect(JSON.parse(previa.depois)).toEqual(comOMoductus(HOOKS_DO_USUARIO, PORTA));
    expect(previa.antes).not.toContain("MINHA_CHAVE");
    expect(previa.depois).not.toContain("MINHA_CHAVE");
    expect(ler()).toBe(ORIGINAL);
    expect(copias()).toHaveLength(0);
  });
});

describe("desligar sem nada do Moductus não escreve", () => {
  test("bloco compacto do usuário em arquivo recuado fica intocado, sem cópia", () => {
    const original =
      '{\n  "model": "opus",\n  "hooks": {"Stop":[{"hooks":[{"type":"command","command":"echo"}]}]}\n}\n';
    const { ligacao, ler, copias } = montar(original);
    expect(ligacao.desligar()).toEqual({ mudou: false, copia: null });
    expect(ler()).toBe(original);
    expect(copias()).toHaveLength(0);

    ligacao.ligar();
    ligacao.desligar();
    const depois = copias().length;
    expect(ligacao.desligar()).toEqual({ mudou: false, copia: null });
    expect(ler()).toBe(original);
    expect(copias()).toHaveLength(depois);
  });

  test("a memória de uma ligação desfeita à mão é esquecida", () => {
    const original = '{"hooks": {"Stop": []}, "model": "opus"}';
    const { ligacao, caminho, ler } = montar(original);
    ligacao.ligar();
    writeFileSync(caminho, original, "utf8"); // o usuário tirou os hooks à mão
    expect(ligacao.desligar().mudou).toBe(false);
    // Ligar de novo guarda a memória de agora; desligar devolve o de agora.
    const mudado = '{"hooks": {"Stop": []}, "model": "sonnet"}';
    writeFileSync(caminho, mudado, "utf8");
    ligacao.ligar();
    ligacao.desligar();
    expect(ler()).toBe(mudado);
  });
});

describe("o bloco hooks volta como era", () => {
  test("bloco compacto em arquivo recuado, escapes, 5.0, {} e lista vazia voltam idênticos", () => {
    const originais = [
      '{\n  "model": "opus",\n  "hooks": {"Stop":[{"hooks":[{"type":"command","command":"echo"}]}]}\n}\n',
      '{\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "caf\\u00e9", "timeout": 5.0 }] }]\n  }\n}',
      '{"hooks": {}}',
      '{"hooks": {"Stop": []}}',
      "{\n}\n",
      "{}",
      '{\r\n\t"hooks": {\r\n\t\t"PreToolUse": [],\r\n\t\t"Stop": []\r\n\t},\r\n\t"x": 1\r\n}\r\n',
    ];
    for (const original of originais) {
      const { ligacao, ler } = montar(original);
      for (let volta = 0; volta < 2; volta++) {
        ligacao.ligar();
        expect(ligacao.situacao()).toBe("ligada");
        ligacao.desligar();
        expect(ler()).toBe(original);
      }
    }
  });

  test("a memória sobrevive a reinício do serviço e religar por troca de porta mantém a de antes", () => {
    const original = '{"hooks": {"Stop": []}, "model": "opus"}';
    const { ligacao, nova, caminho, ler } = montar(original);
    ligacao.ligar();
    new LigacaoClaudeCode({ caminho, porta: 50000 }).ligar(); // sem memória: não pode apagar a de antes
    nova().ligar();
    nova().desligar();
    expect(ler()).toBe(original);
  });

  test("hooks do usuário mudados enquanto ligado: desligar tira só o do Moductus e guarda a mudança", () => {
    const original = '{"hooks": {"Stop": []}}';
    const { ligacao, caminho, ler } = montar(original);
    ligacao.ligar();
    const ligado = JSON.parse(ler()) as { hooks: Record<string, unknown[]> };
    const meu = { hooks: [{ type: "command", command: "echo novo" }] };
    ligado.hooks.Stop = [meu, ...(ligado.hooks.Stop ?? [])];
    writeFileSync(caminho, JSON.stringify(ligado), "utf8");
    ligacao.desligar();
    expect(JSON.parse(ler())).toEqual({ hooks: { Stop: [meu] } });
  });

  test("sem a memória (só no processo, que reiniciou), desligar ainda tira só o do Moductus", () => {
    const original = '{"hooks": {"Stop": []}, "model": "opus"}';
    const { ligacao, nova, ler } = montar(original, { semMemoria: true });
    ligacao.ligar();
    nova().desligar();
    expect(JSON.parse(ler())).toEqual({ model: "opus" });
  });
});

describe("settings.json que é link", () => {
  test("pasta do settings.json que é junção: as cópias vão para a pasta de dados, não para o repositório", () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-ligacao-"));
    pastas.push(pasta);
    const repositorio = join(pasta, "dotfiles");
    mkdirSync(repositorio);
    writeFileSync(join(repositorio, "settings.json"), ORIGINAL, "utf8");
    const juncao = join(pasta, "claude");
    symlinkSync(repositorio, juncao, "junction");
    const reserva = join(pasta, "dados", "copias");
    const ligacao = new LigacaoClaudeCode({
      caminho: join(juncao, "settings.json"),
      porta: PORTA,
      copiasForaDoLink: reserva,
    });

    ligacao.ligar();
    expect(ligacao.situacao()).toBe("ligada");
    ligacao.desligar();
    expect(readFileSync(join(repositorio, "settings.json"), "utf8")).toBe(ORIGINAL);
    expect(readdirSync(repositorio)).toEqual(["settings.json"]);
    const copias = readdirSync(reserva);
    expect(copias).toHaveLength(2);
    expect(readFileSync(join(reserva, copias.sort()[0] ?? ""), "utf8")).toBe(ORIGINAL);
  });

  test("pasta comum com reserva configurada: as cópias continuam ao lado do settings.json", () => {
    const { pasta, caminho } = montar(ORIGINAL);
    const reserva = join(pasta, "dados", "copias");
    new LigacaoClaudeCode({ caminho, porta: PORTA, copiasForaDoLink: reserva }).ligar();
    expect(readdirSync(pasta).filter((f) => f.endsWith(".bak"))).toHaveLength(1);
    expect(existsSync(reserva)).toBe(false);
  });

  test("hardlink: escrita que falha no meio devolve o conteúdo de antes, e o vínculo continua", () => {
    const { pasta, caminho } = montar();
    const outroNome = join(pasta, "dotfiles-settings.json");
    writeFileSync(outroNome, ORIGINAL, "utf8");
    linkSync(outroNome, caminho);
    let falhou = false;
    const ligacao = new LigacaoClaudeCode({
      caminho,
      porta: PORTA,
      gravar: (destino, conteudo) => {
        if (!falhou && !destino.endsWith(".moductus-tmp")) {
          falhou = true;
          writeFileSync(destino, String(conteudo).slice(0, 20));
          throw new Error("disco cheio");
        }
        writeFileSync(destino, conteudo);
      },
    });

    expect(() => ligacao.ligar()).toThrow("disco cheio");
    expect(readFileSync(outroNome, "utf8")).toBe(ORIGINAL);
    expect(statSync(caminho).nlink).toBe(2);
    expect(readdirSync(pasta).some((f) => f.endsWith(".moductus-tmp"))).toBe(false);
    // Na segunda tentativa, o disco tem espaço: liga normalmente.
    ligacao.ligar();
    expect(ligacao.situacao()).toBe("ligada");
    expect(statSync(outroNome).nlink).toBe(2);
  });

  test("symlink continua link; o alvo recebe os hooks e volta igual ao desligar", () => {
    const { pasta, caminho, ligacao, copias } = montar();
    const repositorio = join(pasta, "dotfiles");
    mkdirSync(repositorio);
    const alvo = join(repositorio, "settings.json");
    writeFileSync(alvo, ORIGINAL, "utf8");
    symlinkSync(alvo, caminho, "file");

    ligacao.ligar();
    expect(lstatSync(caminho).isSymbolicLink()).toBe(true);
    expect(
      situacaoDosHooks((JSON.parse(readFileSync(alvo, "utf8")) as { hooks: unknown }).hooks, PORTA),
    ).toBe("ligada");
    // Cópia ao lado do link, com o conteúdo do alvo; nada de arquivo novo no repositório.
    expect(readFileSync(join(pasta, copias()[0] ?? ""), "utf8")).toBe(ORIGINAL);
    expect(readdirSync(repositorio)).toEqual(["settings.json"]);

    ligacao.desligar();
    expect(lstatSync(caminho).isSymbolicLink()).toBe(true);
    expect(readFileSync(alvo, "utf8")).toBe(ORIGINAL);
    expect(readdirSync(repositorio)).toEqual(["settings.json"]);
  });

  test("hardlink continua com os dois nomes no mesmo arquivo, ligado e desligado", () => {
    const { pasta, caminho, ligacao } = montar();
    const outroNome = join(pasta, "dotfiles-settings.json");
    writeFileSync(outroNome, ORIGINAL, "utf8");
    linkSync(outroNome, caminho);

    ligacao.ligar();
    expect(statSync(caminho).nlink).toBe(2);
    expect(statSync(caminho).ino).toBe(statSync(outroNome).ino);
    expect(readFileSync(outroNome, "utf8")).toBe(readFileSync(caminho, "utf8"));
    expect(ligacao.situacao()).toBe("ligada");

    ligacao.desligar();
    expect(statSync(caminho).nlink).toBe(2);
    expect(readFileSync(outroNome, "utf8")).toBe(ORIGINAL);
  });
});

describe("o bloco do Moductus", () => {
  test("cada evento ganha um hook http com o token só pelo nome da variável", () => {
    const hooks = comOMoductus(undefined, PORTA) as Record<string, { matcher?: string; hooks: unknown[] }[]>;
    expect(Object.keys(hooks)).toEqual([...EVENTOS_LIGADOS]);
    expect(hooks.PermissionRequest?.[0]).toEqual({
      matcher: "*",
      hooks: [
        {
          type: "http",
          url: "http://127.0.0.1:47821/hooks/claude-code",
          headers: { Authorization: `Bearer $${VARIAVEL_TOKEN}` },
          allowedEnvVars: [VARIAVEL_TOKEN],
          timeout: ESPERA_PERMISSAO_S,
        },
      ],
    });
    expect(hooks.Stop?.[0]).toEqual({ hooks: [hookDoMoductus(PORTA, "Stop")] });
    expect(hookDoMoductus(PORTA, "Stop").timeout).toBeLessThan(ESPERA_PERMISSAO_S);
  });

  test("desligar tira o do Moductus em qualquer porta, até dentro de um grupo do usuário", () => {
    const meu = { type: "command", command: "echo oi" };
    const hooks = {
      Stop: [{ hooks: [meu, hookDoMoductus(50000, "Stop")] }],
      Notification: [{ hooks: [{ type: "http", url: "http://localhost:47821/hooks/claude-code" }] }],
      SessionEnd: [{ hooks: [{ type: "http", url: "http://127.0.0.1:47821/hooks/claude-code/outra" }] }],
      PreCompact: [],
    };
    expect(semOMoductus(hooks)).toEqual({
      Stop: [{ hooks: [meu] }],
      SessionEnd: hooks.SessionEnd,
      PreCompact: [],
    });
    expect(semOMoductus({ Stop: [{ hooks: [hookDoMoductus(PORTA, "Stop")] }] })).toBeUndefined();
    expect(semOMoductus({})).toEqual({});
  });

  test("porta trocada ou evento faltando deixam a ligação desatualizada", () => {
    expect(situacaoDosHooks(comOMoductus(undefined, PORTA), PORTA)).toBe("ligada");
    expect(situacaoDosHooks(comOMoductus(undefined, 47822), PORTA)).toBe("desatualizada");
    const semStop = comOMoductus(undefined, PORTA);
    delete semStop.Stop;
    expect(situacaoDosHooks(semStop, PORTA)).toBe("desatualizada");
    expect(situacaoDosHooks(HOOKS_DO_USUARIO, PORTA)).toBe("desligada");
    expect(situacaoDosHooks(undefined, PORTA)).toBe("desligada");
  });

  test("trocar a chave da raiz respeita texto com escapes e chaves parecidas dentro de outros valores", () => {
    const texto = '{\n  "a": "tem \\"hooks\\": {} e } dentro",\n  "b": {"hooks": [1, {"x": "]"}]}\n}';
    const ligado = trocarChaveRaiz(texto, "hooks", { Stop: [] });
    expect(JSON.parse(ligado)).toEqual({ ...(JSON.parse(texto) as object), hooks: { Stop: [] } });
    expect(trocarChaveRaiz(ligado, "hooks", undefined)).toBe(texto);
    expect(trocarChaveRaiz(texto, "nada", undefined)).toBe(texto);
  });

  test("o settings.json é o do CLAUDE_CONFIG_DIR quando definido, senão o de ~/.claude", () => {
    expect(caminhoSettingsClaude({}, "C:\\Users\\ana")).toBe(
      join("C:\\Users\\ana", ".claude", "settings.json"),
    );
    expect(caminhoSettingsClaude({ CLAUDE_CONFIG_DIR: "D:\\cfg" }, "C:\\Users\\ana")).toBe(
      join("D:\\cfg", "settings.json"),
    );
  });
});
