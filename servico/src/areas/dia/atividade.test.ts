import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { motivoDaCasca, PrimeiraAtividade, RepositorioAtividade, type InicioDoDia } from "./atividade.ts";
import { TempoDoDia } from "./tempo.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const FUSO = "America/Sao_Paulo";

/**
 * Banco migrado de verdade (a rotina do briefing semeada sem hora) e um relógio falso em São Paulo
 * (UTC−3): `as("07:10")` põe o relógio de parede nessa hora do dia `2026-10-19`, uma segunda-feira.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-atividade-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const relogio = { agora: new Date("2026-10-19T07:00:00.000Z") };
  const agora = () => relogio.agora;
  const tempo = new TempoDoDia(() => FUSO, agora);
  const as = (hora: string, dia = "2026-10-19") => {
    relogio.agora = tempo.instante(dia, hora);
  };
  const comecos: InicioDoDia[] = [];
  const atividade = new PrimeiraAtividade(new RepositorioAtividade(db), tempo, (i) => comecos.push(i), agora);
  const briefing = (sql: string, ...valores: Array<string | null>) =>
    db.prepare(`UPDATE rotinas SET ${sql} WHERE id = 'briefing'`).run(...valores);
  return { db, atividade, comecos, as, briefing };
}

describe("primeira atividade do dia", () => {
  test("antes das 05:00 desbloquear não conta; o primeiro desbloqueio depois conta", () => {
    const { atividade, comecos, as } = montar();
    as("04:59");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    expect(atividade.sinal("retomada")).toBeNull();
    as("05:00");
    expect(atividade.sinal("desbloqueio")).toEqual({
      dia: "2026-10-19",
      motivo: "desbloqueio",
      em: "2026-10-19T08:00:00.000Z",
    });
    expect(comecos).toHaveLength(1);
  });

  test("a segunda atividade do dia não repete; a do dia seguinte começa outro", () => {
    const { atividade, comecos, as } = montar();
    as("07:10");
    expect(atividade.sinal("subida")?.motivo).toBe("subida");
    as("09:00");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    as("13:30");
    expect(atividade.sinal("retomada")).toBeNull();
    // Meia-noite e madrugada são do dia novo, mas ainda não o começo dele.
    as("02:00", "2026-10-20");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    as("06:15", "2026-10-20");
    expect(atividade.sinal("logon")?.dia).toBe("2026-10-20");
    expect(comecos.map((c) => [c.dia, c.motivo])).toEqual([
      ["2026-10-19", "subida"],
      ["2026-10-20", "logon"],
    ]);
  });

  test("o briefing que já apareceu hoje vale depois de o serviço reiniciar", () => {
    const { db, atividade, comecos, as } = montar();
    db.prepare(
      "INSERT INTO rotinas_registro (id, rotina_id, dia, conteudo) VALUES ('r1', 'briefing', ?, '{}')",
    ).run("2026-10-19");
    // O serviço acabou de subir, sem memória do dia: o registro do briefing é que diz.
    as("09:00");
    expect(atividade.sinal("subida")).toBeNull();
    expect(comecos).toEqual([]);
    as("08:00", "2026-10-20");
    expect(atividade.sinal("subida")?.dia).toBe("2026-10-20");
  });

  test("sem horário fixo, o relógio sozinho não começa o dia", () => {
    const { atividade, comecos, as } = montar();
    as("10:00");
    expect(atividade.sinal("horario")).toBeNull();
    expect(comecos).toEqual([]);
  });

  test("horário fixo: nada antes da hora, o relógio dispara na hora e uma vez", () => {
    const { atividade, comecos, as, briefing } = montar();
    briefing("hora = ?", "08:30");
    as("07:00");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    expect(atividade.sinal("horario")).toBeNull();
    as("08:30");
    expect(atividade.sinal("horario")?.motivo).toBe("horario");
    as("09:00");
    expect(atividade.sinal("horario")).toBeNull();
    expect(atividade.sinal("desbloqueio")).toBeNull();
    expect(comecos).toHaveLength(1);
  });

  test("horário fixo com o PC dormindo na hora: a volta depois dela começa o dia", () => {
    const { atividade, as, briefing } = montar();
    briefing("hora = ?", "08:30");
    as("10:40");
    expect(atividade.sinal("retomada")).toMatchObject({ dia: "2026-10-19", motivo: "retomada" });
  });

  test("horário fixo vale também antes das 05:00, se é o que você escolheu", () => {
    const { atividade, as, briefing } = montar();
    briefing("hora = ?", "04:30");
    as("04:30");
    expect(atividade.sinal("horario")?.dia).toBe("2026-10-19");
  });

  test("briefing desligado, na lixeira ou fora dos dias da semana não começa nada", () => {
    const { atividade, comecos, as, briefing } = montar();
    as("08:00");
    briefing("ativa = 0");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    briefing("ativa = 1, dias_semana = ?", "[2,3,4,5,6]");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    briefing("dias_semana = ?, apagado_em = ?", "[1]", "2026-10-19T10:00:00.000Z");
    expect(atividade.sinal("desbloqueio")).toBeNull();
    briefing("apagado_em = NULL");
    expect(atividade.sinal("desbloqueio")?.dia).toBe("2026-10-19");
    expect(comecos).toHaveLength(1);
  });

  test("domingo é o 7 da ISO", () => {
    const { atividade, as, briefing } = montar();
    briefing("dias_semana = ?", "[7]");
    as("08:00", "2026-10-25");
    expect(atividade.sinal("desbloqueio")?.dia).toBe("2026-10-25");
  });

  test("o dia é o civil do fuso de config, não o do UTC", () => {
    const { atividade, as } = montar();
    // 22:00 em São Paulo já é 01:00 do dia seguinte em UTC.
    as("22:00");
    expect(atividade.sinal("desbloqueio")?.dia).toBe("2026-10-19");
  });
});

describe("começo que falha", () => {
  test("o briefing que falhou (promessa ou exceção) deixa o próximo sinal tentar de novo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-atividade-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta);
    bancos.push(db);
    const agora = () => new Date("2026-10-19T11:00:00.000Z");
    const tentativas: string[] = [];
    const respostas: Array<() => void | Promise<unknown>> = [
      () => Promise.reject(new Error("agenda fora")),
      () => {
        throw new Error("banco travado");
      },
      () => Promise.resolve(),
    ];
    const atividade = new PrimeiraAtividade(
      new RepositorioAtividade(db),
      new TempoDoDia(() => FUSO, agora),
      (i) => {
        tentativas.push(i.motivo);
        return respostas.shift()!();
      },
      agora,
    );
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(atividade.sinal("subida")).not.toBeNull();
    await vi.waitFor(() => expect(erro).toHaveBeenCalledWith(expect.stringContaining("agenda fora")));
    expect(() => atividade.sinal("desbloqueio")).toThrow("banco travado");
    expect(atividade.sinal("retomada")).not.toBeNull();
    await Promise.resolve();
    expect(atividade.sinal("desbloqueio")).toBeNull();
    expect(tentativas).toEqual(["subida", "desbloqueio", "retomada"]);
    erro.mockRestore();
  });
});

describe("aviso da casca", () => {
  test("desbloqueio e logon passam; motivo estranho conta como desbloqueio", () => {
    expect(motivoDaCasca({ tipo: "atividade", motivo: "desbloqueio" })).toBe("desbloqueio");
    expect(motivoDaCasca({ tipo: "atividade", motivo: "logon" })).toBe("logon");
    expect(motivoDaCasca({ tipo: "atividade", motivo: "horario" })).toBe("desbloqueio");
    expect(motivoDaCasca({ tipo: "atividade", motivo: { x: 1 } })).toBe("desbloqueio");
    expect(motivoDaCasca({ tipo: "atividade" })).toBe("desbloqueio");
  });
});
