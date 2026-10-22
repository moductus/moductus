import type { CiclosFoco, EstadoFoco, EtapaFoco, HistoricoFoco } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  ciclosDoDia,
  etapasDaRodada,
  etapasDeHoje,
  falaDaRodada,
  falaDoCicloTerminado,
  inicioDaSemana,
  relatorioPorTarefa,
  resumoDaRodada,
  semanaDoFoco,
  situacaoDoCiclo,
  textoDosCiclos,
} from "./foco.ts";

const MIN = 60_000;
const CICLOS: CiclosFoco = { focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 };

/** Um instante na hora local do PC, como a área escreve as horas. */
const local = (h: number, m = 0, dia = 21) => new Date(2026, 9, dia, h, m).getTime();

let seq = 0;
/** Uma etapa que terminou na hora: `inicio` em ms, `minutos` de duração. */
function etapa(
  tipo: EtapaFoco["tipo"],
  inicio: number,
  minutos: number,
  campos: Partial<EtapaFoco> = {},
): EtapaFoco {
  return {
    id: `E${String(++seq).padStart(3, "0")}`,
    tipo,
    tarefaId: "t1",
    inicio: new Date(inicio).toISOString(),
    terminaEm: new Date(inicio + minutos * MIN).toISOString(),
    pausadaEm: null,
    fim: new Date(inicio + minutos * MIN).toISOString(),
    duracaoPlanejadaMin: minutos,
    duracaoRealMin: minutos,
    interrompida: false,
    ...campos,
  };
}

const correndo = (e: EtapaFoco): EtapaFoco => ({ ...e, fim: null, duracaoRealMin: null });

function estado(campos: Partial<EstadoFoco> = {}): EstadoFoco {
  return {
    etapa: null,
    tarefaTitulo: null,
    cicloAtual: 1,
    ciclosAtePausaLonga: 4,
    proxima: "foco",
    podeEstender: false,
    focoHojeMin: 0,
    ciclosHoje: 0,
    ...campos,
  };
}

const linhas = (etapas: ReturnType<typeof etapasDaRodada>) =>
  etapas.map(
    (e) =>
      `${e.nome} ${new Date(e.inicio).getHours()}:${String(new Date(e.inicio).getMinutes()).padStart(2, "0")} ${e.situacao}`,
  );

describe("etapasDaRodada", () => {
  it("no foco 2, as feitas com a hora real, a atual e as que faltam contadas do fim dela", () => {
    const f1 = etapa("foco", local(14, 12), 25);
    const p1 = etapa("pausa", local(14, 37), 5);
    const f2 = correndo(etapa("foco", local(14, 42), 25));
    const e = estado({ etapa: f2, cicloAtual: 2, proxima: "pausa" });
    const rodada = etapasDaRodada(e, [f1, p1, f2], CICLOS, local(14, 48));
    expect(linhas(rodada)).toEqual([
      "Foco 1 14:12 feito",
      "Pausa 14:37 feito",
      "Foco 2 14:42 agora",
      "Pausa 15:07 falta",
      "Foco 3 15:12 falta",
      "Pausa 15:37 falta",
      "Foco 4 15:42 falta",
      "Pausa longa 16:07 falta",
    ]);
    expect(rodada.at(-1)!.fim).toBe(local(16, 22));
    expect(resumoDaRodada(rodada)).toBe("4 focos · 2h10");
  });

  it("não volta além da pausa longa da rodada de antes, e o foco parado antes da hora fica como parou", () => {
    const antes = [etapa("foco", local(9), 25), etapa("pausa_longa", local(9, 25), 15)];
    const f1 = etapa("foco", local(10), 25, { interrompida: true, duracaoRealMin: 12 });
    const p1 = correndo(etapa("pausa", local(10, 12), 5));
    const e = estado({ etapa: p1, cicloAtual: 1, proxima: "foco" });
    const rodada = etapasDaRodada(e, [...antes, f1, p1], CICLOS, local(10, 14));
    expect(linhas(rodada).slice(0, 3)).toEqual([
      "Foco 1 10:00 parou",
      "Pausa 10:12 agora",
      "Foco 2 10:17 falta",
    ]);
  });

  it("pausada, o que falta começa depois do que resta da etapa, a partir de agora", () => {
    const f1 = {
      ...correndo(etapa("foco", local(14), 25)),
      pausadaEm: new Date(local(14, 10)).toISOString(),
    };
    const e = estado({ etapa: f1, cicloAtual: 1, proxima: "pausa" });
    const rodada = etapasDaRodada(e, [f1], CICLOS, local(14, 30));
    // Faltavam 15 min quando parou: a pausa viria às 14:45.
    expect(linhas(rodada).slice(0, 2)).toEqual(["Foco 1 14:00 agora", "Pausa 14:45 falta"]);
  });

  it("com o foco terminado, a pausa proposta vem já; parado numa rodada nova, a rodada inteira vem por fazer", () => {
    const f1 = etapa("foco", local(14), 25);
    const terminado = etapasDaRodada(
      estado({ cicloAtual: 1, proxima: "pausa" }),
      [f1],
      CICLOS,
      local(14, 30),
    );
    expect(linhas(terminado).slice(0, 2)).toEqual(["Foco 1 14:00 feito", "Pausa 14:30 falta"]);

    const nova = etapasDaRodada(estado(), [], CICLOS, local(8));
    expect(nova.map((x) => x.nome)).toEqual([
      "Foco 1",
      "Pausa",
      "Foco 2",
      "Pausa",
      "Foco 3",
      "Pausa",
      "Foco 4",
      "Pausa longa",
    ]);
    expect(nova.every((x) => x.situacao === "falta")).toBe(true);
  });

  it("sem a configuração, só o que já aconteceu", () => {
    const f1 = correndo(etapa("foco", local(14), 25));
    expect(etapasDaRodada(estado({ etapa: f1, proxima: "pausa" }), [f1], null, local(14, 5))).toHaveLength(1);
  });
});

describe("situação do ciclo", () => {
  const rodadaInteira = () => {
    const lista: EtapaFoco[] = [];
    let t = local(14);
    for (let i = 1; i <= 4; i++) {
      lista.push(etapa("foco", t, 25, { tarefaId: i === 2 ? "t2" : "t1" }));
      t += 25 * MIN;
      lista.push(etapa(i === 4 ? "pausa_longa" : "pausa", t, i === 4 ? 15 : 5));
      t += (i === 4 ? 15 : 5) * MIN;
    }
    return lista;
  };

  it("etapa correndo, foco terminado com a pausa proposta, rodada completa até fechar por aqui, ou começar", () => {
    const f1 = correndo(etapa("foco", local(14), 25));
    expect(situacaoDoCiclo(estado({ etapa: f1 }), [f1], null).tipo).toBe("etapa");

    const feito = etapa("foco", local(14), 25);
    expect(situacaoDoCiclo(estado({ proxima: "pausa" }), [feito], null)).toEqual({
      tipo: "terminado",
      foco: feito,
    });

    const rodada = rodadaInteira();
    const completa = situacaoDoCiclo(estado(), rodada, null);
    expect(completa.tipo).toBe("completa");
    if (completa.tipo !== "completa") return;
    expect(completa.rodada.focos).toHaveLength(4);
    expect(completa.rodada.minutos).toBe(100);
    expect(completa.rodada.etapas.every((e) => e.situacao === "feito")).toBe(true);
    expect(situacaoDoCiclo(estado(), rodada, completa.rodada.chave).tipo).toBe("comecar");

    expect(situacaoDoCiclo(estado(), [], null).tipo).toBe("comecar");
    // A pausa encerrada antes da hora ("Encerrar a rodada") não é rodada completa.
    const encerrada = [feito, etapa("pausa", local(14, 25), 5, { interrompida: true })];
    expect(situacaoDoCiclo(estado(), encerrada, null).tipo).toBe("comecar");
  });

  it("depois da meia-noite, sem o foco no histórico de hoje, o ciclo segue terminado com a pausa proposta", () => {
    // O foco começou às 23:40 de ontem e terminou às 00:05: o histórico de hoje não o traz.
    const ontem = etapa("foco", local(23, 40, 20), 25);
    const historico: HistoricoFoco = { etapas: [ontem], porTarefa: [], porDia: [] };
    const e = estado({ cicloAtual: 1, proxima: "pausa", tarefaTitulo: "Revisar PR" });
    const hoje = etapasDeHoje(historico, e, "2026-10-21", null);
    expect(hoje).toEqual([]);
    expect(situacaoDoCiclo(e, hoje, null)).toEqual({ tipo: "terminado", foco: null });
    expect(linhas(etapasDaRodada(e, hoje, CICLOS, local(0, 6))).slice(0, 2)).toEqual([
      "Pausa 0:06 falta",
      "Foco 2 0:11 falta",
    ]);
    expect(falaDoCicloTerminado(null, "Revisar PR", "pausa", CICLOS)).toBe(
      "Ciclo de foco em “Revisar PR” terminado. Começo a pausa de 5 min?",
    );
  });

  it("a fala da rodada diz quanto foi para cada tarefa quando são até duas", () => {
    const completa = situacaoDoCiclo(estado(), rodadaInteira(), null);
    if (completa.tipo !== "completa") throw new Error("esperava a rodada completa");
    const titulos = new Map([
      ["t1", "Revisar PR"],
      ["t2", "Comprovantes"],
    ]);
    expect(falaDaRodada(completa.rodada, titulos)).toBe(
      "4 ciclos, 1h40 de foco: 3 em “Revisar PR” e 1 em “Comprovantes”. Começo outra rodada ou fecho por aqui?",
    );
    expect(falaDaRodada({ ...completa.rodada, focos: completa.rodada.focos.slice(0, 1) }, titulos)).toBe(
      "1 ciclo, 1h40 de foco em “Revisar PR”. Começo outra rodada ou fecho por aqui?",
    );
  });

  it("a fala do ciclo terminado propõe a pausa certa, com a tarefa ou livre", () => {
    const feito = etapa("foco", local(14), 25);
    expect(falaDoCicloTerminado(feito, "Revisar PR", "pausa", CICLOS)).toBe(
      "25 min de foco em “Revisar PR”. Começo a pausa de 5 min?",
    );
    expect(falaDoCicloTerminado({ ...feito, duracaoRealMin: 12 }, null, "pausa_longa", CICLOS)).toBe(
      "12 min de foco livre. Começo a pausa longa de 15 min?",
    );
  });
});

describe("o dia", () => {
  it("as etapas de hoje vêm em ordem, sem as de ontem, com a atual como o estado a conhece", () => {
    const ontem = etapa("foco", local(22, 0, 20), 25);
    const f1 = etapa("foco", local(9), 25);
    const f2 = correndo(etapa("foco", local(10), 25));
    const historico: HistoricoFoco = {
      etapas: [{ ...f2, pausadaEm: null }, f1, ontem],
      porTarefa: [],
      porDia: [],
    };
    const pausada = { ...f2, pausadaEm: new Date(local(10, 5)).toISOString() };
    const hoje = etapasDeHoje(historico, estado({ etapa: pausada }), "2026-10-21", null);
    expect(hoje.map((e) => e.id)).toEqual([f1.id, f2.id]);
    expect(hoje[1]!.pausadaEm).not.toBeNull();
  });

  it("só os focos entram, o que corre diz desde quando e o parado antes do fim fica marcado", () => {
    const f1 = etapa("foco", local(9, 40), 25);
    const p1 = etapa("pausa", local(10, 5), 5);
    const f2 = etapa("foco", local(10, 10), 25, { interrompida: true, duracaoRealMin: 9 });
    const f3 = correndo(etapa("foco", local(14, 42), 25));
    expect(ciclosDoDia([f1, p1, f2, f3], 6)).toEqual([
      { chave: f1.id, tarefaId: "t1", hora: "09:40–10:05", minutos: 25, atual: false, interrompido: false },
      { chave: f2.id, tarefaId: "t1", hora: "10:10–10:35", minutos: 9, atual: false, interrompido: true },
      { chave: f3.id, tarefaId: "t1", hora: "desde 14:42", minutos: 6, atual: true, interrompido: false },
    ]);
  });
});

describe("a semana e o relatório", () => {
  it("a semana vai de segunda a domingo, com hoje marcado e a média dos dias com foco", () => {
    expect(inicioDaSemana("2026-10-22")).toBe("2026-10-19");
    expect(inicioDaSemana("2026-10-25")).toBe("2026-10-19");
    expect(inicioDaSemana("2026-10-19")).toBe("2026-10-19");
    const semana = semanaDoFoco(
      [
        { dia: "2026-10-19", minutos: 125, ciclos: 5 },
        { dia: "2026-10-20", minutos: 100, ciclos: 4 },
        { dia: "2026-10-21", minutos: 150, ciclos: 6 },
        { dia: "2026-10-22", minutos: 75, ciclos: 3 },
      ],
      "2026-10-22",
    );
    expect(semana.dias.map((d) => d.nome)).toEqual(["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]);
    expect(semana.dias.map((d) => d.fracao)).toEqual([125 / 150, 100 / 150, 1, 0.5, 0, 0, 0]);
    expect(semana.dias.findIndex((d) => d.hoje)).toBe(3);
    expect(semana.dias.filter((d) => d.futuro).map((d) => d.nome)).toEqual(["sex", "sáb", "dom"]);
    expect([semana.minutos, semana.ciclos]).toEqual([450, 18]);
    expect(semana.resumo).toBe("Média de 1h53 por dia com foco. Quarta foi o dia mais longo, com 2h30.");
  });

  it("com um dia só, a média sem o dia mais longo; sem foco, nada", () => {
    expect(semanaDoFoco([{ dia: "2026-10-21", minutos: 75, ciclos: 3 }], "2026-10-21").resumo).toBe(
      "Média de 1h15 por dia com foco.",
    );
    expect(semanaDoFoco([], "2026-10-21").resumo).toBe("");
  });

  it("por tarefa, da que recebeu mais foco, com o foco livre por último e a barra contra a maior", () => {
    const linhas = relatorioPorTarefa([
      { tarefaId: null, titulo: null, minutos: 100, ciclos: 4 },
      { tarefaId: "t1", titulo: "Revisar PR", minutos: 175, ciclos: 7 },
      { tarefaId: "t2", titulo: null, minutos: 25, ciclos: 1 },
    ]);
    expect(linhas.map((l) => [l.titulo, l.fracao])).toEqual([
      ["Revisar PR", 1],
      ["Tarefa apagada", 25 / 175],
      ["Sem tarefa ligada", 100 / 175],
    ]);
  });

  it("os ciclos configurados em uma linha", () => {
    expect(textoDosCiclos(CICLOS)).toBe("25 · 5 · 15 min, pausa longa a cada 4");
  });
});
