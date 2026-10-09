import type { SituacaoAgente } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import { CONVITE_MODELO, SEM_SITUACAO, lerSituacao } from "./situacao.ts";

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

describe("lerSituacao: do runtime para o personagem", () => {
  it("sem notícia do serviço, o time dorme e convida a conectar um modelo", () => {
    expect(lerSituacao(null)).toEqual(SEM_SITUACAO);
    expect(lerSituacao(undefined)).toEqual({
      expressao: "dormindo",
      texto: "dormindo",
      tom: "neutro",
      dica: CONVITE_MODELO,
    });
  });

  it.each([
    ["ocioso", "ocioso", "ocioso", "neutro"],
    ["trabalhando", "trabalhando", "trabalhando", "sucesso"],
    ["esperando", "esperando", "esperando você", "aviso"],
    ["erro", "erro", "erro", "perigo"],
  ] as const)("ativo e %s: expressão %s, status %s em %s", (atividade, expressao, texto, tom) => {
    expect(lerSituacao({ ...ATIVO, atividade })).toEqual({ expressao, texto, tom, dica: null });
  });

  it("sem modelo dorme com o convite; limite e provedor fora dormem sem dica", () => {
    const dormindo = { ...ATIVO, estado: "dormindo" } as const;
    expect(lerSituacao({ ...dormindo, motivoSono: "sem_modelo" })).toMatchObject({
      expressao: "dormindo",
      texto: "dormindo",
      dica: CONVITE_MODELO,
    });
    for (const motivoSono of ["limite", "fora_do_ar", "credencial", "ausente", null] as const) {
      expect(lerSituacao({ ...dormindo, motivoSono }), String(motivoSono)).toEqual({
        expressao: "dormindo",
        texto: "dormindo",
        tom: "neutro",
        dica: null,
      });
    }
  });

  it("teto de gasto é o sono preocupado, parado em aviso (Estados.dc.html)", () => {
    expect(lerSituacao({ ...ATIVO, estado: "dormindo", motivoSono: "teto" })).toMatchObject({
      expressao: "erro",
      texto: "parado",
      tom: "aviso",
    });
  });

  it("pausa e desligamento ganham da atividade: olhos fechados mesmo no meio de um trabalho", () => {
    expect(lerSituacao({ ...ATIVO, estado: "pausado", atividade: "trabalhando" })).toEqual({
      expressao: "dormindo",
      texto: "pausado",
      tom: "neutro",
      dica: null,
    });
    expect(lerSituacao({ ...ATIVO, estado: "desligado", atividade: "esperando" })).toEqual({
      expressao: "dormindo",
      texto: "desligado",
      tom: "apagado",
      dica: null,
    });
    // Dormindo por limite com uma execução marcada como erro continua dormindo.
    expect(
      lerSituacao({ ...ATIVO, estado: "dormindo", atividade: "erro", motivoSono: "limite" }).expressao,
    ).toBe("dormindo");
  });
});
