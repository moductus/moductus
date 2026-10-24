import type { ApresentacaoRotina, LinhaRotina, RotinasDeHoje } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import { tarefa } from "../../teste/dia.ts";
import {
  aindaAbertas,
  comApresentacao,
  ehOntem,
  linhaDoFeito,
  linhasDaAlba,
  linhasDosOutros,
  pendentesDoOntem,
  rotinaDaVez,
  rotuloDaLinha,
  textoDoAdiado,
} from "./rotinas.ts";

const linha = (extra: Partial<LinhaRotina> = {}): LinhaRotina => ({
  agenteId: "alba",
  rotulo: null,
  texto: "texto",
  tarefaIds: [],
  ...extra,
});

function rotina(
  tipo: "briefing" | "fechamento",
  extra: Partial<ApresentacaoRotina> = {},
): ApresentacaoRotina {
  return {
    id: `r-${tipo}`,
    rotinaId: tipo,
    tipo,
    dia: "2026-10-08",
    abertura: "Bom dia.",
    daExecucaoId: null,
    linhas: [],
    abertas: [],
    acao: null,
    acaoEm: null,
    criadoEm: "2026-10-08T11:12:00.000Z",
    ...extra,
  };
}

const NADA: RotinasDeHoje = { briefing: null, fechamento: null, diaEncerrado: false, pergunta: null };
const agida = (r: ApresentacaoRotina, acao: ApresentacaoRotina["acao"]) => ({
  ...r,
  acao,
  acaoEm: "2026-10-08T12:00:00.000Z",
});

describe("rotinaDaVez", () => {
  it("o fechamento sem ação vem antes do briefing sem ação; respondida ou ignorada, nenhuma", () => {
    const briefing = rotina("briefing");
    const fechamento = rotina("fechamento");
    expect(rotinaDaVez(null)).toBeNull();
    expect(rotinaDaVez(NADA)).toBeNull();
    expect(rotinaDaVez({ ...NADA, briefing })).toBe(briefing);
    expect(rotinaDaVez({ ...NADA, briefing, fechamento })).toBe(fechamento);
    expect(rotinaDaVez({ ...NADA, briefing, fechamento: agida(fechamento, "adiar") })).toBe(briefing);
    expect(rotinaDaVez({ ...NADA, briefing: agida(briefing, "comecar") })).toBeNull();
    expect(rotinaDaVez({ ...NADA, briefing: agida(briefing, "ignorado") })).toBeNull();
  });
});

describe("comApresentacao", () => {
  it("troca a rotina do mesmo tipo; o fechamento encerrado encerra o dia", () => {
    const briefing = rotina("briefing");
    const fechamento = rotina("fechamento");
    const antes = { ...NADA, briefing, fechamento };
    expect(comApresentacao(antes, agida(briefing, "comecar")).briefing?.acao).toBe("comecar");
    expect(comApresentacao(antes, agida(briefing, "comecar")).fechamento).toBe(fechamento);
    expect(comApresentacao(antes, agida(fechamento, "adiar")).diaEncerrado).toBe(false);
    expect(comApresentacao(antes, agida(fechamento, "encerrar"))).toMatchObject({
      diaEncerrado: true,
      fechamento: { acao: "encerrar" },
    });
  });
});

describe("rotuloDaLinha", () => {
  it("a primeira da Alba é o dia dela; com rótulo, o rótulo; os outros, só o nome", () => {
    expect(rotuloDaLinha(linha())).toEqual({ agente: "alba", texto: "Alba · o dia" });
    expect(rotuloDaLinha(linha({ rotulo: "Ontem" }))).toEqual({ agente: "alba", texto: "Alba · ontem" });
    expect(rotuloDaLinha(linha({ agenteId: "nuno" }))).toEqual({ agente: "nuno", texto: "Nuno" });
    // Agente que o painel não conhece não ganha a cabeça de outro.
    expect(rotuloDaLinha(linha({ agenteId: "zeca", rotulo: null }))).toEqual({ agente: null, texto: "zeca" });
    expect(rotuloDaLinha(linha({ agenteId: null, rotulo: "Ontem" }))).toEqual({
      agente: null,
      texto: "Ontem",
    });
  });
});

describe("o Ontem do briefing", () => {
  it("só a linha Ontem com tarefas tem ações, e leva só as que continuam atrasadas e abertas", () => {
    const ontem = linha({ rotulo: "Ontem", tarefaIds: ["a", "b", "c"] });
    expect(ehOntem(ontem)).toBe(true);
    expect(ehOntem(linha({ rotulo: "Ontem" }))).toBe(false);
    expect(ehOntem(linha({ tarefaIds: ["a"] }))).toBe(false);
    expect(pendentesDoOntem(ontem, null)).toEqual(["a", "b", "c"]);
    const atrasadas = [tarefa("a"), tarefa("c", { estado: "feita" })];
    expect(pendentesDoOntem(ontem, atrasadas)).toEqual(["a"]);
    expect(pendentesDoOntem(ontem, [])).toEqual([]);
  });
});

describe("o Ficou aberto do fechamento", () => {
  it("tira as resolvidas aqui e, com o dia lido, as que deixaram de estar abertas", () => {
    const abertas = [tarefa("a"), tarefa("b"), tarefa("c")];
    expect(aindaAbertas(abertas, new Set(["b"]), null).map((t) => t.id)).toEqual(["a", "c"]);
    const doDia = [tarefa("a"), tarefa("b"), tarefa("c", { estado: "feita" })];
    expect(aindaAbertas(abertas, new Set(), doDia).map((t) => t.id)).toEqual(["a", "b"]);
    expect(aindaAbertas(abertas, new Set(["a"]), doDia).map((t) => t.id)).toEqual(["b"]);
  });

  it("separa a linha do feito, as outras da Alba e as dos outros agentes", () => {
    const feito = linha({ texto: "5 feitas" });
    const amanha = linha({ rotulo: "Amanhã", texto: "Nada marcado ainda." });
    const nuno = linha({ agenteId: "nuno", texto: "1 sessão aberta." });
    const linhas = [feito, amanha, nuno];
    expect(linhaDoFeito(linhas)).toBe(feito);
    expect(linhaDoFeito([amanha, nuno])).toBeNull();
    expect(linhasDaAlba(linhas)).toEqual([amanha]);
    expect(linhasDosOutros(linhas)).toEqual([nuno]);
  });

  it("o aviso diz para quando a tarefa foi", () => {
    expect(textoDoAdiado("Ligar", "2026-10-09", "2026-10-08")).toBe("Ligar: vai para amanhã.");
    expect(textoDoAdiado("Ligar", "2026-10-12", "2026-10-08")).toBe("Ligar: vai para seg, 12 out.");
  });
});
