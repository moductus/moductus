import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import type { EventoHook } from "../../sessoes/hooks.ts";
import { RepositorioSessoes, ServicoSessoes } from "../../sessoes/sessoes.ts";
import { Catalogo } from "../catalogo.ts";
import { ferramentasSessoes } from "./sessoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const hook = (tipo: string, idSessao: string, extra: Partial<EventoHook> = {}): EventoHook => ({
  tipo,
  idSessao,
  cwd: "V:\\moductus",
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

/** Banco migrado, duas sessões vindas de hooks e as ferramentas do Nuno no escopo dele. */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-sessoes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const sessoes = new ServicoSessoes(new RepositorioSessoes(db), () => {}, {
    agora: () => new Date("2026-10-09T12:00:00.000Z"),
    raizDoProjeto: (cwd) => cwd,
  });
  const a = sessoes.registrar("claude-code", hook("SessionStart", "a")).sessao;
  sessoes.registrar("claude-code", hook("PreToolUse", "a", { ferramenta: "Bash", resumo: "pnpm test" }));
  sessoes.registrar("codex", hook("SessionStart", "b", { cwd: "V:\\outro" }));
  db.prepare(
    "UPDATE sessoes_ia SET contexto_usado_tokens = 170000, contexto_janela_tokens = 200000 WHERE id = ?",
  ).run(a.id);
  const escopo = new Catalogo(ferramentasSessoes(sessoes)).doAgente(["sessoes.*"]);
  const chamar = (nome: string, entrada: unknown) =>
    escopo.executor({ agenteId: "nuno", execucaoId: null, sinal: new AbortController().signal })({
      id: "c1",
      nome,
      entrada,
    });
  return { a, chamar };
}

describe("ferramentas sessoes.*", () => {
  test("listar dá projeto pelo nome, estado e contexto em %; sem contexto, vazio", async () => {
    const { chamar } = montar();
    const r = await chamar("sessoes__listar", {});
    expect(r.ok).toBe(true);
    const { sessoes } = (r as { valor: { sessoes: Record<string, unknown>[] } }).valor;
    expect(sessoes.map((s) => [s.ferramenta, s.projeto, s.estado])).toEqual([
      ["codex", "outro", "esperando"],
      ["claude-code", "moductus", "trabalhando"],
    ]);
    expect(sessoes[1]).toMatchObject({
      contexto: { porcentagem: 85, usadoTokens: 170000, janelaTokens: 200000 },
      ultimoEvento: { tipo: "PreToolUse", resumo: "pnpm test" },
    });
    expect(sessoes[0]?.contexto).toBeNull();

    const filtrado = await chamar("sessoes__listar", { estado: "esperando" });
    expect((filtrado as { valor: { sessoes: unknown[] } }).valor.sessoes).toHaveLength(1);
  });

  test("eventos da sessão, o mais novo primeiro; limite fora do intervalo volta como erro legível", async () => {
    const { a, chamar } = montar();
    const r = await chamar("sessoes.eventos", { sessaoId: a.id });
    expect(r).toMatchObject({
      ok: true,
      valor: [
        { tipo: "PreToolUse", ferramenta: "Bash", resumo: "pnpm test" },
        { tipo: "SessionStart", ferramenta: null },
      ],
    });
    expect(await chamar("sessoes.eventos", { sessaoId: a.id, limite: 500 })).toEqual({
      ok: false,
      erro: "Entrada inválida para sessoes.eventos. limite: precisa ser no máximo 50.",
    });
  });
});
