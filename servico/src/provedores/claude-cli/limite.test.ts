import { describe, expect, test } from "vitest";
import { horaDeVolta, pareceLimite } from "./limite.ts";

// 17:07 em São Paulo (UTC-3, sem horário de verão desde 2019).
const agora = new Date("2026-10-09T20:07:00Z");

describe("mensagem de limite do Claude Code", () => {
  test("reconhece os textos das versões conhecidas e não confunde com outro erro", () => {
    expect(pareceLimite("You've hit your limit · resets 5:40pm (America/Sao_Paulo)")).toBe(true);
    expect(pareceLimite("5-hour limit reached ∙ resets 3am")).toBe(true);
    expect(pareceLimite("Claude AI usage limit reached|1791578400")).toBe(true);
    expect(pareceLimite("Weekly limit reached ∙ resets Oct 10, 3pm")).toBe(true);
    expect(pareceLimite("API Error: 529 Overloaded")).toBe(false);
    expect(pareceLimite("Invalid API key · Please run /login")).toBe(false);
  });

  test("segundos Unix depois da barra", () => {
    expect(horaDeVolta("Claude AI usage limit reached|1791578400", agora)).toBe("2026-10-09T20:40:00.000Z");
  });

  test("hora com fuso informado: hoje, se ainda não passou", () => {
    expect(horaDeVolta("You've hit your limit · resets 5:40pm (America/Sao_Paulo)", agora)).toBe(
      "2026-10-09T20:40:00.000Z",
    );
    expect(horaDeVolta("limit reached · resets 17:40 (America/Sao_Paulo)", agora)).toBe(
      "2026-10-09T20:40:00.000Z",
    );
  });

  test("hora que já passou hoje é a de amanhã", () => {
    expect(horaDeVolta("5-hour limit reached ∙ resets 3am (America/Sao_Paulo)", agora)).toBe(
      "2026-10-10T06:00:00.000Z",
    );
  });

  test("data e hora do limite semanal; virada do ano", () => {
    expect(horaDeVolta("Weekly limit reached ∙ resets Oct 12, 3pm (America/Sao_Paulo)", agora)).toBe(
      "2026-10-12T18:00:00.000Z",
    );
    expect(
      horaDeVolta(
        "Weekly limit reached ∙ resets Jan 2, 9am (America/Sao_Paulo)",
        new Date("2026-12-30T12:00:00Z"),
      ),
    ).toBe("2027-01-02T12:00:00.000Z");
  });

  test("sem fuso, ou com fuso desconhecido, vale o relógio da máquina", () => {
    const meioDia = new Date(2026, 9, 9, 12, 0);
    const esperado = new Date(2026, 9, 9, 17, 40).toISOString();
    expect(horaDeVolta("5-hour limit reached ∙ resets 5:40pm", meioDia)).toBe(esperado);
    expect(horaDeVolta("limit reached ∙ resets 5:40pm (Marte/Base_Alfa)", meioDia)).toBe(esperado);
  });

  test("sem hora reconhecível não inventa uma", () => {
    expect(horaDeVolta("You've hit your limit", agora)).toBeNull();
    expect(horaDeVolta("limit reached · resets 13pm", agora)).toBeNull();
    expect(horaDeVolta("limit reached · resets 25:00", agora)).toBeNull();
  });
});
