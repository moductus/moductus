import { describe, expect, it } from "vitest";
import { ateQuando, horaCurta, horaDoDia, quando } from "./quando.ts";

// Quinta, 8 de outubro de 2026, 10h, na hora local.
const AGORA = new Date(2026, 9, 8, 10, 0);
const local = (dia: number, hora: number, minuto = 0) => new Date(2026, 9, dia, hora, minuto).toISOString();

describe("quando o agente volta", () => {
  it("hora cheia sem minutos, com minutos no relógio", () => {
    expect(horaDoDia(new Date(2026, 9, 8, 9, 0))).toBe("9h");
    expect(horaDoDia(new Date(2026, 9, 8, 17, 5))).toBe("17:05");
  });

  it("hoje, amanhã, na semana e mais longe, curto no dock e longo no cartão", () => {
    expect(quando(local(8, 17, 40), AGORA, "curta")).toBe("às 17:40");
    expect(quando(local(9, 9), AGORA, "curta")).toBe("amanhã 9h");
    expect(quando(local(9, 9), AGORA, "longa")).toBe("amanhã às 9h");
    expect(quando(local(12, 9), AGORA, "curta")).toBe("seg 9h");
    expect(quando(local(12, 9), AGORA, "longa")).toBe("segunda às 9h");
    expect(quando(local(20, 14, 30), AGORA, "longa")).toBe("dia 20 às 14:30");
  });

  it("instante passado ou inválido não vira hora inventada", () => {
    expect(quando(local(8, 9), AGORA, "curta")).toBeNull();
    expect(quando("não é data", AGORA, "longa")).toBeNull();
    expect(ateQuando(local(8, 9), AGORA)).toBeNull();
  });

  it("hora curta de listas: a hora hoje, com o dia da semana em outro dia, passado ou futuro", () => {
    expect(horaCurta(local(8, 9, 2), AGORA)).toBe("9:02");
    expect(horaCurta(local(10, 9), AGORA)).toBe("sáb 9h");
    expect(horaCurta(local(7, 18, 30), AGORA)).toBe("qua 18:30");
  });

  it("fim da pausa: até a hora hoje, até o dia depois", () => {
    expect(ateQuando(local(8, 14), AGORA)).toBe("até 14h");
    expect(ateQuando(local(9, 9), AGORA)).toBe("até amanhã às 9h");
  });
});
