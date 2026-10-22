import type { EstadoFoco, EtapaFoco } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  ciclosDaRodada,
  duracaoCurta,
  esperaAteMudar,
  fracaoFeita,
  minutosDoDock,
  relogioDoFoco,
  relogioFalado,
  restanteMs,
  segundosRestantes,
} from "./foco.ts";

const INICIO = Date.parse("2026-10-18T14:42:00.000Z");
const MIN = 60_000;

function etapa(campos: Partial<EtapaFoco> = {}): EtapaFoco {
  return {
    id: "01JETAPA000000000000000000",
    tipo: "foco",
    tarefaId: null,
    inicio: new Date(INICIO).toISOString(),
    terminaEm: new Date(INICIO + 25 * MIN).toISOString(),
    pausadaEm: null,
    fim: null,
    duracaoPlanejadaMin: 25,
    duracaoRealMin: null,
    interrompida: false,
    ...campos,
  };
}

function estado(campos: Partial<EstadoFoco> = {}): EstadoFoco {
  return {
    etapa: null,
    tarefaTitulo: null,
    cicloAtual: 1,
    ciclosAtePausaLonga: 4,
    proxima: "foco",
    focoHojeMin: 0,
    ciclosHoje: 0,
    ...campos,
  };
}

describe("o tempo da etapa", () => {
  it("conta do fim planejado e nunca fica negativo", () => {
    const e = etapa();
    expect(restanteMs(e, INICIO + 6 * MIN + 18_000)).toBe(18 * MIN + 42_000);
    expect(restanteMs(e, INICIO + 30 * MIN)).toBe(0);
  });

  it("em pausa, fica no que faltava quando parou, por mais que o relógio ande", () => {
    const e = etapa({ pausadaEm: new Date(INICIO + 12 * MIN + 50_000).toISOString() });
    expect(segundosRestantes(e, INICIO + 13 * MIN)).toBe(12 * 60 + 10);
    expect(segundosRestantes(e, INICIO + 40 * MIN)).toBe(12 * 60 + 10);
  });

  it("arredonda os segundos para cima: 00:00 só no fim", () => {
    const e = etapa();
    expect(segundosRestantes(e, INICIO + 25 * MIN - 300)).toBe(1);
    expect(segundosRestantes(e, INICIO + 25 * MIN)).toBe(0);
  });
});

describe("o relógio do painel e o número do dock", () => {
  it("escrevem 18:42 e 18, e passam de uma hora com as horas", () => {
    expect(relogioDoFoco(18 * 60 + 42)).toBe("18:42");
    expect(minutosDoDock(18 * 60 + 42)).toBe(18);
    expect(relogioDoFoco(5)).toBe("00:05");
    expect(relogioDoFoco(65 * 60)).toBe("1:05:00");
    expect(minutosDoDock(65 * 60)).toBe(65);
  });

  it("batem em todo segundo da etapa: o minuto do dock é o minuto do relógio do painel", () => {
    const e = etapa({ duracaoPlanejadaMin: 50, terminaEm: new Date(INICIO + 50 * MIN).toISOString() });
    for (let ms = 0; ms <= 50 * MIN; ms += 250) {
      const segundos = segundosRestantes(e, INICIO + ms);
      expect(Number(relogioDoFoco(segundos).split(":")[0])).toBe(minutosDoDock(segundos));
    }
  });

  it("diz o relógio por extenso para o leitor de tela", () => {
    expect(relogioFalado(18 * 60 + 42)).toBe("18 minutos e 42 segundos");
    expect(relogioFalado(60)).toBe("1 minuto");
    expect(relogioFalado(61)).toBe("1 minuto e 1 segundo");
  });
});

describe("esperaAteMudar", () => {
  /** O número que o painel (passo 1) ou o dock (passo 60) mostra num instante. */
  const mostrado = (e: EtapaFoco, agora: number, passo: number) =>
    Math.floor(segundosRestantes(e, agora) / passo);

  it("acorda exatamente quando o número muda, nem antes nem depois", () => {
    const e = etapa({ terminaEm: new Date(INICIO + 25 * MIN + 437).toISOString() });
    for (const passo of [1, 60]) {
      for (const agora of [INICIO, INICIO + 6 * MIN + 18_123, INICIO + 24 * MIN + 59_900]) {
        const espera = esperaAteMudar(e, agora, passo)!;
        expect(espera).toBeGreaterThan(0);
        const antes = mostrado(e, agora, passo);
        expect(mostrado(e, agora + espera - 1, passo)).toBe(antes);
        // No zero o número não cai mais: acorda no fim da etapa.
        if (antes > 0) expect(mostrado(e, agora + espera, passo)).toBe(antes - 1);
        else expect(restanteMs(e, agora + espera)).toBe(0);
      }
    }
  });

  it("no último minuto o dock só acorda no fim", () => {
    const e = etapa();
    expect(esperaAteMudar(e, INICIO + 24 * MIN + 30_000, 60)).toBe(30_000);
  });

  it("não agenda nada com a etapa em pausa, terminada ou vencida", () => {
    expect(esperaAteMudar(etapa({ pausadaEm: new Date(INICIO).toISOString() }), INICIO, 1)).toBeNull();
    expect(esperaAteMudar(etapa(), INICIO + 26 * MIN, 1)).toBeNull();
  });
});

describe("fracaoFeita", () => {
  it("anda pela duração planejada, que o +5 min estica", () => {
    expect(fracaoFeita(etapa(), 25 * 60)).toBe(0);
    expect(fracaoFeita(etapa(), 18 * 60 + 45)).toBeCloseTo(0.25);
    expect(fracaoFeita(etapa({ duracaoPlanejadaMin: 30 }), 15 * 60)).toBeCloseTo(0.5);
    expect(fracaoFeita(etapa(), 0)).toBe(1);
  });
});

describe("duracaoCurta", () => {
  it("escreve o foco de hoje como o quadro", () => {
    expect(duracaoCurta(0)).toBe("0 min");
    expect(duracaoCurta(40)).toBe("40 min");
    expect(duracaoCurta(75)).toBe("1h15");
    expect(duracaoCurta(120)).toBe("2h");
  });
});

describe("ciclosDaRodada", () => {
  it("no foco do ciclo 3, dois feitos, o atual e um que falta", () => {
    expect(ciclosDaRodada(estado({ etapa: etapa(), cicloAtual: 3 }))).toEqual([
      "feito",
      "feito",
      "atual",
      "falta",
    ]);
  });

  it("na pausa e no ciclo que acabou, o ciclo já conta como feito", () => {
    expect(ciclosDaRodada(estado({ etapa: etapa({ tipo: "pausa" }), cicloAtual: 2 }))).toEqual([
      "feito",
      "feito",
      "falta",
      "falta",
    ]);
    expect(ciclosDaRodada(estado({ cicloAtual: 4, proxima: "pausa_longa" }))).toEqual([
      "feito",
      "feito",
      "feito",
      "feito",
    ]);
  });

  it("parado, cicloAtual é o próximo foco: a rodada nova não tem nada feito", () => {
    expect(ciclosDaRodada(estado())).toEqual(["falta", "falta", "falta", "falta"]);
    expect(ciclosDaRodada(estado({ cicloAtual: 3 }))).toEqual(["feito", "feito", "falta", "falta"]);
  });
});
