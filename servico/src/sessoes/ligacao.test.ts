import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Um `settings.json` numa pasta temporária: nunca o do usuário desta máquina. */
function montar(conteudo?: string) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ligacao-"));
  pastas.push(pasta);
  const caminho = join(pasta, "settings.json");
  if (conteudo !== undefined) writeFileSync(caminho, conteudo, "utf8");
  let agora = new Date("2026-10-09T12:00:00.000Z");
  const ligacao = new LigacaoClaudeCode({
    caminho,
    porta: PORTA,
    agora: () => (agora = new Date(agora.getTime() + 1000)),
  });
  const ler = () => readFileSync(caminho, "utf8");
  const copias = () => readdirSync(pasta).filter((f) => f.endsWith(".bak"));
  return { pasta, caminho, ligacao, ler, copias };
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

  test("cópia de segurança antes de cada escrita, com o conteúdo de antes; ficam só as últimas", () => {
    const { ligacao, ler, copias } = montar(ORIGINAL);
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
    expect(copias()).toHaveLength(COPIAS_GUARDADAS);
    expect(
      copias().every((f) => /^settings\.json\.moductus-2026-10-09T12-\d\d-\d\d-000Z\.bak$/.test(f)),
    ).toBe(true);
  });

  test("sem settings.json, ligar cria o arquivo só com os hooks; sem cópia, que não havia o que copiar", () => {
    const { ligacao, caminho, ler } = montar();
    expect(ligacao.previa().antes).toBeNull();
    expect(ligacao.ligar()).toEqual({ mudou: true, copia: null });
    expect(Object.keys(JSON.parse(ler()) as object)).toEqual(["hooks"]);
    expect(ler().endsWith("}\n")).toBe(true);
    ligacao.desligar();
    expect(existsSync(caminho)).toBe(true);
    expect(JSON.parse(ler())).toEqual({});
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
