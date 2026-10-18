import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FOLGA_DO_TIMER_MS, GUARDA_MS, RelogioDoDia, type Conferencia } from "./relogio.ts";

const INICIO = new Date("2026-10-08T17:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(INICIO);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Uma fonte que anota as conferências e diz o próximo que o teste mandar. */
function fonte(nome = "teste") {
  const conferencias: Conferencia[] = [];
  const f = {
    nome,
    proximoEm: null as Date | null,
    falha: false,
    conferencias,
    proximo: () => f.proximoEm,
    conferir: (c: Conferencia) => {
      conferencias.push(c);
      if (f.falha) throw new Error("quebrou");
    },
  };
  return f;
}

const em = (ms: number) => new Date(INICIO.getTime() + ms);

describe("relógio do dia", () => {
  test("arma até o próximo da fonte e confere na hora exata", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    f.proximoEm = em(10_000);
    relogio.registrar(f);
    await relogio.ligar();
    expect(f.conferencias).toHaveLength(1);
    f.proximoEm = null;

    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.conferencias).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.conferencias).toHaveLength(2);
    expect(f.conferencias[1]).toEqual({ agora: em(10_000), ausencia: null });
  });

  test("nunca dorme mais que a guarda de 60 s, mesmo com o próximo longe ou sem próximo", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    f.proximoEm = em(3_600_000);
    relogio.registrar(f);
    await relogio.ligar();
    await vi.advanceTimersByTimeAsync(GUARDA_MS * 3);
    expect(f.conferencias.map((c) => c.agora)).toEqual([
      em(0),
      em(GUARDA_MS),
      em(GUARDA_MS * 2),
      em(GUARDA_MS * 3),
    ]);
  });

  test("a subida é ausência de começo desconhecido; a retomada começa na última conferência", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    relogio.registrar(f);
    await relogio.ligar();
    expect(f.conferencias[0]?.ausencia).toEqual({ de: null, ate: em(0) });

    await vi.advanceTimersByTimeAsync(GUARDA_MS);
    // O PC dorme: o relógio do sistema anda, os timers não.
    vi.setSystemTime(em(GUARDA_MS + 3_600_000));
    await relogio.retomar();
    expect(f.conferencias.at(-1)?.ausencia).toEqual({ de: em(GUARDA_MS), ate: em(GUARDA_MS + 3_600_000) });
  });

  test("o timer que acorda muito depois da hora conta como ausência, mesmo sem a casca avisar", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    relogio.registrar(f);
    await relogio.ligar();
    vi.setSystemTime(em(FOLGA_DO_TIMER_MS + 5_000));
    await vi.advanceTimersByTimeAsync(GUARDA_MS);
    expect(f.conferencias).toHaveLength(2);
    expect(f.conferencias[1]?.ausencia).toEqual({
      de: em(0),
      ate: em(GUARDA_MS + FOLGA_DO_TIMER_MS + 5_000),
    });
  });

  test("mudou rearma: o que ficou para antes confere na hora nova", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    relogio.registrar(f);
    await relogio.ligar();
    f.proximoEm = em(5_000);
    relogio.mudou();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.conferencias.map((c) => c.agora)).toEqual([em(0), em(5_000)]);
  });

  test("a fonte que falha não impede as outras, e o relógio continua armado", async () => {
    const relogio = new RelogioDoDia();
    const quebrada = fonte("quebrada");
    quebrada.falha = true;
    const boa = fonte("boa");
    relogio.registrar(quebrada);
    relogio.registrar(boa);
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await relogio.ligar();
    await vi.advanceTimersByTimeAsync(GUARDA_MS);
    expect(boa.conferencias).toHaveLength(2);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("quebrada falhou"));
    erro.mockRestore();
  });

  test("as conferências não se sobrepõem: a retomada espera a que está em andamento", async () => {
    const relogio = new RelogioDoDia();
    const ordem: string[] = [];
    let soltar: () => void = () => {};
    let primeira = true;
    relogio.registrar({
      nome: "lenta",
      proximo: () => null,
      conferir: async () => {
        ordem.push("começa");
        if (primeira) {
          primeira = false;
          await new Promise<void>((r) => (soltar = r));
        }
        ordem.push("acaba");
      },
    });
    const ligou = relogio.ligar();
    const retomou = relogio.retomar();
    await vi.advanceTimersByTimeAsync(0);
    expect(ordem).toEqual(["começa"]);
    soltar();
    await Promise.all([ligou, retomou]);
    expect(ordem).toEqual(["começa", "acaba", "começa", "acaba"]);
  });

  test("parado, não confere nem arma", async () => {
    const relogio = new RelogioDoDia();
    const f = fonte();
    relogio.registrar(f);
    await relogio.retomar();
    expect(f.conferencias).toHaveLength(0);
    await relogio.ligar();
    relogio.parar();
    await vi.advanceTimersByTimeAsync(GUARDA_MS * 2);
    expect(f.conferencias).toHaveLength(1);
  });
});
