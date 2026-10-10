import { describe, expect, test } from "vitest";
import { estadoDepois, lerEventoHook, RESUMO_MAXIMO, type EventoHook } from "./hooks.ts";

/** Campos comuns de todo hook do Claude Code 2.x, como no teste de viabilidade (AGENTS.md §5.1). */
const comum = {
  session_id: "4f1c2e1a-8d7b-4b8e-9a3c-2f0d1e6b7a90",
  transcript_path: "C:\\Users\\voce\\.claude\\projects\\V--moductus\\4f1c2e1a.jsonl",
  cwd: "V:\\moductus",
  permission_mode: "default",
};

const evento = (corpo: Record<string, unknown>) => {
  const lido = lerEventoHook({ ...comum, ...corpo });
  if (!lido) throw new Error("evento não lido");
  return lido;
};

describe("leitura do hook", () => {
  test("PreToolUse do Bash: ferramenta e o comando como resumo", () => {
    expect(
      evento({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm test" } }),
    ).toEqual({
      tipo: "PreToolUse",
      idSessao: comum.session_id,
      cwd: comum.cwd,
      transcript: comum.transcript_path,
      modelo: null,
      ferramenta: "Bash",
      resumo: "pnpm test",
      entrada: { command: "pnpm test" },
      emSegundoPlano: 0,
      aviso: null,
      origem: null,
    });
  });

  test("entrada de ferramenta de arquivo guarda só o caminho; a de comando, inteira", () => {
    expect(
      evento({
        hook_event_name: "PermissionRequest",
        tool_name: "Write",
        tool_input: { file_path: "V:\\moductus\\.env", content: "SEGREDO=1" },
      }).entrada,
    ).toEqual({ file_path: "V:\\moductus\\.env" });
    expect(
      evento({
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "ls", timeout: 5 },
      }).entrada,
    ).toEqual({ command: "ls", timeout: 5 });
    expect(evento({ hook_event_name: "Stop" }).entrada).toBeNull();
  });

  test("Stop conta as tarefas em segundo plano; sem o campo, nenhuma", () => {
    expect(evento({ hook_event_name: "Stop" }).emSegundoPlano).toBe(0);
    expect(evento({ hook_event_name: "Stop", background_tasks: [] }).emSegundoPlano).toBe(0);
    expect(
      evento({ hook_event_name: "Stop", background_tasks: [{ id: "b1" }, { id: "b2" }] }).emSegundoPlano,
    ).toBe(2);
    expect(evento({ hook_event_name: "Stop", background_tasks: "x" }).emSegundoPlano).toBe(0);
  });

  test("Edit resume pelo arquivo; Notification pela mensagem; comando longo é cortado", () => {
    expect(
      evento({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "V:\\moductus\\src\\a.ts", old_string: "x", new_string: "y" },
        tool_response: { ok: true },
      }).resumo,
    ).toBe("V:\\moductus\\src\\a.ts");
    const aviso = evento({
      hook_event_name: "Notification",
      message: "Claude is waiting for your input",
      notification_type: "idle_prompt",
    });
    expect([aviso.resumo, aviso.aviso]).toEqual(["Claude is waiting for your input", "idle_prompt"]);
    const longo = evento({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "a\n".repeat(500) },
    });
    expect(longo.resumo).toHaveLength(RESUMO_MAXIMO);
    expect(longo.resumo).not.toContain("\n");
  });

  test("o pedido do usuário não é guardado", () => {
    expect(evento({ hook_event_name: "UserPromptSubmit", prompt: "minha senha é 123" }).resumo).toBeNull();
  });

  test("modelo do SessionStart como texto ou objeto; campo novo é ignorado", () => {
    expect(
      evento({ hook_event_name: "SessionStart", source: "startup", model: "claude-opus-4-1" }).modelo,
    ).toBe("claude-opus-4-1");
    const novo = evento({
      hook_event_name: "SessionStart",
      model: { id: "claude-sonnet-4-5" },
      campo_novo: [1],
    });
    expect(novo.modelo).toBe("claude-sonnet-4-5");
  });

  test("sem nome do evento ou sem sessão não é evento", () => {
    expect(lerEventoHook({ ...comum })).toBeNull();
    expect(lerEventoHook({ hook_event_name: "Stop", cwd: "V:\\x" })).toBeNull();
    expect(lerEventoHook([])).toBeNull();
    expect(lerEventoHook("Stop")).toBeNull();
  });
});

describe("estado depois do evento", () => {
  const de = (tipo: string, extra: Partial<EventoHook> = {}): EventoHook => ({
    tipo,
    idSessao: "s",
    cwd: null,
    transcript: null,
    modelo: null,
    ferramenta: null,
    resumo: null,
    entrada: null,
    emSegundoPlano: 0,
    aviso: null,
    origem: null,
    ...extra,
  });

  test.each([
    ["SessionStart", null, "esperando"],
    ["UserPromptSubmit", "esperando", "trabalhando"],
    ["PreToolUse", "terminou", "trabalhando"],
    ["PostToolUse", "esperando", "trabalhando"],
    ["PermissionRequest", "trabalhando", "esperando"],
    ["Notification", "terminou", "esperando"],
    ["Stop", "trabalhando", "terminou"],
    ["SessionEnd", "esperando", "terminou"],
  ] as const)("%s depois de %s: %s", (tipo, atual, esperado) => {
    expect(estadoDepois(de(tipo), atual)).toBe(esperado);
  });

  test("compactação no meio do trabalho e aviso que não pede nada mantêm o estado", () => {
    expect(estadoDepois(de("SessionStart", { origem: "compact" }), "trabalhando")).toBe("trabalhando");
    expect(estadoDepois(de("Notification", { aviso: "auth_success" }), "terminou")).toBe("terminou");
  });

  test("evento desconhecido mantém o estado, mas tira a sessão de parada", () => {
    expect(estadoDepois(de("EventoDoFuturo"), "esperando")).toBe("esperando");
    expect(estadoDepois(de("EventoDoFuturo"), "parada")).toBe("trabalhando");
    expect(estadoDepois(de("EventoDoFuturo"), null)).toBe("trabalhando");
  });
});
