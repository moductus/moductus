import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "foco-etapas");

describe("migração foco-etapas", () => {
  test("sobe a partir da anterior: a etapa que existia ganha o fim planejado e o ciclo 1", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES.slice(0, posicao));
    db.prepare(
      `INSERT INTO sessoes_foco (id, tipo, inicio, fim, duracao_planejada_min, duracao_real_min)
       VALUES ('f', 'foco', '2026-10-18T14:00:00.000Z', '2026-10-18T14:25:00.000Z', 25, 25)`,
    ).run();
    expect(migrar(db, MIGRACOES)).toEqual({ de: posicao, para: MIGRACOES.length });
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(db.prepare("SELECT termina_em, pausada_em, ciclo, na_ausencia FROM sessoes_foco").all()).toEqual([
      { termina_em: "2026-10-18T14:25:00.000Z", pausada_em: null, ciclo: 1, na_ausencia: 0 },
    ]);
  });

  test("só a etapa em andamento fica em pausa, e os instantes só no formato exato do serviço", () => {
    const db = new DatabaseSync(":memory:");
    migrar(db, MIGRACOES);
    const inserir = (
      id: string,
      fim: string | null,
      pausada: string | null,
      termina = "2026-10-18T14:25:00.000Z",
    ) =>
      db
        .prepare(
          `INSERT INTO sessoes_foco (id, tipo, inicio, fim, duracao_planejada_min, duracao_real_min, termina_em,
             pausada_em, ciclo)
           VALUES (?, 'foco', '2026-10-18T14:00:00.000Z', ?, 25, ?, ?, ?, 1)`,
        )
        .run(id, fim, fim === null ? null : 10, termina, pausada);
    inserir("parada", null, "2026-10-18T14:10:00.000Z");
    expect(() => inserir("terminada", "2026-10-18T14:10:00.000Z", "2026-10-18T14:05:00.000Z")).toThrow(
      /CHECK/,
    );
    expect(() => inserir("formato", "2026-10-18T14:10:00.000Z", null, "2026-10-18T14:25:00Z")).toThrow(
      /CHECK/,
    );
    expect(() => inserir("antes", "2026-10-18T14:10:00.000Z", null, "2026-10-18T13:00:00.000Z")).toThrow(
      /CHECK/,
    );
    expect(() =>
      db.prepare("UPDATE sessoes_foco SET pausada_em = '2026-10-18T13:00:00.000Z' WHERE id = 'parada'").run(),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE sessoes_foco SET ciclo = -1 WHERE id = 'parada'").run()).toThrow(/CHECK/);
    // Só a etapa interrompida pode ter fechado na ausência.
    expect(() => db.prepare("UPDATE sessoes_foco SET na_ausencia = 1 WHERE id = 'parada'").run()).toThrow(
      /CHECK/,
    );
  });
});
