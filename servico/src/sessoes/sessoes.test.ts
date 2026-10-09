import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ListaSessoes, MudancaSessao } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import type { EventoHook } from "./hooks.ts";
import { LIMITE_PARADA_MS, raizPeloGit, RepositorioSessoes, ServicoSessoes } from "./sessoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Banco migrado de verdade, relógio na mão e a raiz do repositório dada pelo teste. */
function montar(raizes: Record<string, string> = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-sessoes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  let agora = new Date("2026-10-09T12:00:00.000Z");
  const mudancas: MudancaSessao[] = [];
  const servico = new ServicoSessoes(new RepositorioSessoes(db), (m) => mudancas.push(m), {
    agora: () => agora,
    raizDoProjeto: (cwd) => raizes[cwd] ?? cwd,
  });
  const andar = (ms: number) => (agora = new Date(agora.getTime() + ms));
  return { db, servico, mudancas, andar };
}

const hook = (tipo: string, extra: Partial<EventoHook> = {}): EventoHook => ({
  tipo,
  idSessao: "sessao-a",
  cwd: "V:\\moductus",
  transcript: null,
  modelo: null,
  ferramenta: null,
  resumo: null,
  entrada: null,
  aviso: null,
  origem: null,
  ...extra,
});

describe("sessões de IA pelos hooks", () => {
  test("primeiro evento cria projeto pela raiz do repositório e a sessão, e avisa no formato do contrato", () => {
    const { servico, mudancas } = montar({ "V:\\moductus\\servico": "V:\\moductus" });
    const m = servico.registrar(
      "claude-code",
      hook("SessionStart", {
        cwd: "V:\\moductus\\servico",
        modelo: "claude-opus-4-1",
        transcript: "C:\\t.jsonl",
      }),
    );
    expect(MudancaSessao.parse(m)).toEqual(m);
    expect(mudancas).toEqual([m]);
    expect(m.projeto).toMatchObject({ nome: "moductus", caminho: "V:\\moductus", arquivado: false });
    expect(m.sessao).toMatchObject({
      projetoId: m.projeto?.id,
      ferramenta: "claude-code",
      idExterno: "sessao-a",
      modelo: "claude-opus-4-1",
      estado: "esperando",
      iniciadaEm: "2026-10-09T12:00:00.000Z",
      encerradaEm: null,
      contexto: null,
    });
    expect(m.sessao.ultimoEvento).toMatchObject({
      tipo: "SessionStart",
      recebidoEm: "2026-10-09T12:00:00.000Z",
    });
  });

  test("mesma sessão segue o turno; outra pasta do mesmo projeto, com outra caixa e barra, não cria projeto", () => {
    const { servico, db } = montar();
    servico.registrar("claude-code", hook("SessionStart"));
    const turno = servico.registrar(
      "claude-code",
      hook("PreToolUse", { cwd: "v:/MODUCTUS/src-tauri", ferramenta: "Bash", resumo: "cargo test" }),
    );
    expect(turno.sessao.estado).toBe("trabalhando");
    expect(turno.sessao.ultimoEvento).toMatchObject({ ferramentaUsada: "Bash", entradaResumo: "cargo test" });
    expect(servico.registrar("claude-code", hook("PermissionRequest")).sessao.estado).toBe("esperando");
    expect(servico.registrar("claude-code", hook("Stop")).sessao.estado).toBe("terminou");
    const contagem = db
      .prepare("SELECT (SELECT count(*) FROM projetos) p, (SELECT count(*) FROM sessoes_ia) s")
      .get();
    expect(contagem).toEqual({ p: 1, s: 1 });
    expect(servico.eventos({ sessaoId: turno.sessao.id }).map((e) => e.tipo)).toEqual([
      "Stop",
      "PermissionRequest",
      "PreToolUse",
      "SessionStart",
    ]);
    expect(servico.eventos({ sessaoId: turno.sessao.id, limite: 1 })).toHaveLength(1);
  });

  test("projeto mais específico ganha; o mesmo session id de outra ferramenta é outra sessão", () => {
    const { servico } = montar();
    const pai = servico.registrar("claude-code", hook("SessionStart", { cwd: "V:\\moductus" })).projeto;
    const filho = servico.registrar(
      "claude-code",
      hook("SessionStart", { idSessao: "b", cwd: "V:\\moductus-wt\\F2-21" }),
    );
    expect(filho.projeto?.id).not.toBe(pai?.id);
    const outra = servico.registrar("codex", hook("Stop", { cwd: "V:\\moductus-wt\\F2-21\\servico" }));
    expect(outra.projeto?.id).toBe(filho.projeto?.id);
    expect(outra.sessao.ferramenta).toBe("codex");
    expect(servico.listar().sessoes).toHaveLength(3);
  });

  test("SessionEnd encerra; o resume volta com o mesmo id e reabre", () => {
    const { servico } = montar();
    servico.registrar("claude-code", hook("SessionStart"));
    const fim = servico.registrar("claude-code", hook("SessionEnd"));
    expect(fim.sessao).toMatchObject({ estado: "terminou", encerradaEm: "2026-10-09T12:00:00.000Z" });
    const volta = servico.registrar("claude-code", hook("SessionStart", { origem: "resume" }));
    expect(volta.sessao).toMatchObject({ estado: "esperando", encerradaEm: null, id: fim.sessao.id });
  });

  test("sem cwd, a sessão fica sem projeto", () => {
    const { servico } = montar();
    const m = servico.registrar("claude-code", hook("Stop", { cwd: null }));
    expect(m.projeto).toBeNull();
    expect(m.sessao.projetoId).toBeNull();
  });

  test("sessão aberta sem evento por mais do limite vira parada, avisa uma vez e volta com o próximo evento", () => {
    const { servico, mudancas, andar } = montar();
    servico.registrar("claude-code", hook("Stop"));
    servico.registrar("claude-code", hook("SessionStart", { idSessao: "encerrada" }));
    servico.registrar("claude-code", hook("SessionEnd", { idSessao: "encerrada" }));
    mudancas.length = 0;

    andar(LIMITE_PARADA_MS);
    expect(servico.marcarParadas()).toEqual([]);
    andar(1);
    const paradas = servico.marcarParadas();
    expect(paradas.map((m) => [m.sessao.idExterno, m.sessao.estado])).toEqual([["sessao-a", "parada"]]);
    expect(mudancas).toEqual(paradas);
    expect(servico.marcarParadas()).toEqual([]);

    expect(servico.registrar("claude-code", hook("UserPromptSubmit")).sessao.estado).toBe("trabalhando");
  });

  test("lista as abertas e as do último dia; parada antiga sai da lista", () => {
    const { servico, andar } = montar();
    servico.registrar("claude-code", hook("Stop", { idSessao: "velha" }));
    andar(LIMITE_PARADA_MS + 1);
    servico.marcarParadas();
    servico.registrar("claude-code", hook("PreToolUse", { idSessao: "viva", cwd: "V:\\outro" }));
    let lista = ListaSessoes.parse(servico.listar());
    expect(lista.sessoes.map((s) => s.idExterno)).toEqual(["viva", "velha"]);
    expect(lista.projetos).toHaveLength(2);

    andar(24 * 60 * 60_000);
    lista = servico.listar();
    expect(lista.sessoes.map((s) => s.idExterno)).toEqual(["viva"]);
    expect(lista.projetos.map((p) => p.caminho)).toEqual(["V:\\outro"]);
  });
});

describe("raiz do projeto", () => {
  test("sobe até a pasta com .git; sem repositório, o próprio cwd", () => {
    const repositorio = new Set(["V:\\moductus\\.git"]);
    const existe = (c: string) => repositorio.has(c);
    expect(raizPeloGit("V:\\moductus\\servico\\src", existe)).toBe("V:\\moductus");
    expect(raizPeloGit("V:/moductus", existe)).toBe("V:\\moductus");
    expect(raizPeloGit("C:\\temp\\solto", existe)).toBe("C:\\temp\\solto");
  });
});
