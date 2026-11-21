import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type Rotina } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioAtividade } from "./atividade.ts";
import {
  MENSAGEM_FECHAMENTO_SEM_HORA,
  MENSAGEM_ROTINA_NAO_ENCONTRADA,
  MENSAGEM_SO_BRIEFING_CURTO,
  RepositorioRotinas,
  ServicoRotinas,
} from "./horarios.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const AGORA = new Date("2026-10-19T20:00:00.000Z");

/** Banco migrado de verdade (as duas rotinas da 014), com o aviso e o relógio contados. */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-horarios-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const repo = new RepositorioRotinas(db, () => AGORA);
  const avisos: Rotina[][] = [];
  let rearmes = 0;
  const rotinas = new ServicoRotinas({
    repo,
    emitir: (lista) => avisos.push(lista),
    relogio: { mudou: () => rearmes++ },
  });
  return { db, repo, rotinas, avisos, rearmes: () => rearmes, atividade: new RepositorioAtividade(db) };
}

const TODOS = [1, 2, 3, 4, 5, 6, 7];

describe("rotinas do dia", () => {
  test("de fábrica: o briefing na primeira atividade e o fechamento às 18:00, todo dia", () => {
    const m = montar();
    const lista = m.rotinas.listar();
    expect(METODOS["rotinas.listar"].saida.safeParse(lista).success).toBe(true);
    expect(lista).toEqual([
      { id: "briefing", tipo: "briefing", hora: null, diasSemana: TODOS, ativa: true, curta: false },
      { id: "fechamento", tipo: "fechamento", hora: "18:00", diasSemana: TODOS, ativa: true, curta: false },
    ]);
    expect(m.repo.diasDeTrabalho()).toEqual(TODOS);
  });

  test("a hora de parar nova grava com o carimbo do usuário, avisa as janelas e rearma o relógio", () => {
    const m = montar();
    const fechamento = m.rotinas.definir({ id: "fechamento", hora: "18:30" });
    expect(fechamento).toEqual({
      id: "fechamento",
      tipo: "fechamento",
      hora: "18:30",
      diasSemana: TODOS,
      ativa: true,
      curta: false,
    });
    // Quem confere a hora (o vigia da Alba) lê a nova.
    expect(m.atividade.fechamento()?.hora).toBe("18:30");
    expect(m.avisos).toEqual([m.rotinas.listar()]);
    expect(m.rearmes()).toBe(1);
    expect(
      m.db.prepare("SELECT origem, agente_id, atualizado_em FROM rotinas WHERE id = 'fechamento'").get(),
    ).toEqual({ origem: "usuario", agente_id: null, atualizado_em: AGORA.toISOString() });
  });

  test("o briefing vai e volta entre o horário fixo e a primeira atividade, e desliga", () => {
    const m = montar();
    expect(m.rotinas.definir({ id: "briefing", hora: "08:30" }).hora).toBe("08:30");
    expect(m.atividade.briefing()).toEqual({ hora: "08:30", diasSemana: TODOS, ativa: true });
    expect(m.rotinas.definir({ id: "briefing", hora: null }).hora).toBeNull();
    expect(m.rotinas.definir({ id: "briefing", ativa: false }).ativa).toBe(false);
    expect(m.atividade.briefing()).toEqual({ hora: null, diasSemana: TODOS, ativa: false });
    expect(m.rearmes()).toBe(3);
  });

  test("o briefing fica curto e volta; o fechamento não tem versão curta", () => {
    const m = montar();
    expect(m.rotinas.definir({ id: "briefing", curta: true }).curta).toBe(true);
    expect(m.rotinas.listar().map((r) => r.curta)).toEqual([true, false]);
    expect(m.avisos).toHaveLength(1);
    expect(m.rotinas.definir({ id: "briefing", curta: false }).curta).toBe(false);
    expect(() => m.rotinas.definir({ id: "fechamento", curta: true })).toThrow(MENSAGEM_SO_BRIEFING_CURTO);
    expect(m.rotinas.listar().map((r) => r.curta)).toEqual([false, false]);
    expect(m.avisos).toHaveLength(2);
  });

  test("os dias de trabalho valem para as duas rotinas e para a agenda, em ordem e sem repetir", () => {
    const m = montar();
    const briefing = m.rotinas.definir({ id: "briefing", diasSemana: [5, 1, 3, 2, 4] });
    expect(briefing.diasSemana).toEqual([1, 2, 3, 4, 5]);
    expect(m.rotinas.listar().map((r) => r.diasSemana)).toEqual([
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
    ]);
    expect(m.atividade.fechamento()?.diasSemana).toEqual([1, 2, 3, 4, 5]);
    expect(m.repo.diasDeTrabalho()).toEqual([1, 2, 3, 4, 5]);
    expect(m.avisos).toHaveLength(1);
  });

  test("os mesmos valores não gravam nem avisam", () => {
    const m = montar();
    m.rotinas.definir({ id: "fechamento", hora: "18:00", diasSemana: TODOS, ativa: true });
    expect(m.avisos).toEqual([]);
    expect(m.rearmes()).toBe(0);
  });

  test("fechamento sem hora, rotina que não existe, dia repetido ou fora da semana são recusados", () => {
    const m = montar();
    expect(() => m.rotinas.definir({ id: "fechamento", hora: null })).toThrow(MENSAGEM_FECHAMENTO_SEM_HORA);
    expect(() => m.rotinas.definir({ id: "almoco", hora: "12:00" })).toThrow(MENSAGEM_ROTINA_NAO_ENCONTRADA);
    m.db.exec("UPDATE rotinas SET apagado_em = '2026-10-19T10:00:00.000Z' WHERE id = 'briefing'");
    expect(() => m.rotinas.definir({ id: "briefing", hora: "08:00" })).toThrow(
      MENSAGEM_ROTINA_NAO_ENCONTRADA,
    );
    expect(() => m.rotinas.definir({ id: "fechamento", diasSemana: [1, 1] })).toThrow();
    expect(() => m.rotinas.definir({ id: "fechamento", diasSemana: [0] })).toThrow();
    expect(() => m.rotinas.definir({ id: "fechamento", diasSemana: [] })).toThrow();
    expect(() => m.rotinas.definir({ id: "fechamento", hora: "24:00" })).toThrow();
    expect(m.atividade.fechamento()).toEqual({ hora: "18:00", diasSemana: TODOS, ativa: true });
    expect(m.avisos).toEqual([]);
  });

  test("a rotina que não se lê fica de fora da lista sem derrubar a outra", () => {
    const m = montar();
    m.db.exec("UPDATE rotinas SET dias_semana = '[8]' WHERE id = 'briefing'");
    expect(m.rotinas.listar().map((r) => r.id)).toEqual(["fechamento"]);
    expect(m.repo.diasDeTrabalho()).toEqual(TODOS);
  });
});
