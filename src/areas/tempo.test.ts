import { describe, expect, it } from "vitest";
import { diaLocal, haQuanto } from "./tempo.ts";

const AGORA = new Date("2026-10-09T14:00:00");
const antes = (ms: number) => new Date(AGORA.getTime() - ms);
const MIN = 60_000;
const H = 60 * MIN;

describe("haQuanto", () => {
  it("escreve minutos, horas até dois dias e depois dias", () => {
    expect(haQuanto(antes(30_000), AGORA)).toBe("agora");
    expect(haQuanto(antes(5 * MIN), AGORA)).toBe("há 5 min");
    expect(haQuanto(antes(59 * MIN), AGORA)).toBe("há 59 min");
    expect(haQuanto(antes(26 * H), AGORA)).toBe("há 26 h");
    expect(haQuanto(antes(47 * H + 59 * MIN), AGORA)).toBe("há 47 h");
    expect(haQuanto(antes(72 * H), AGORA)).toBe("há 3 dias");
  });

  it("instante inválido ou no futuro vale agora, sem número negativo", () => {
    expect(haQuanto("ontem", AGORA)).toBe("agora");
    expect(haQuanto(new Date(AGORA.getTime() + H), AGORA)).toBe("agora");
  });

  it("aceita o instante ISO do contrato", () => {
    expect(haQuanto(antes(2 * H).toISOString(), AGORA)).toBe("há 2 h");
  });
});

describe("diaLocal", () => {
  it("o dia é o local, com zeros, como o uso_ia do serviço", () => {
    expect(diaLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
