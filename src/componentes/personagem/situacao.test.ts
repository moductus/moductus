import type { SituacaoAgente } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  CONVITE_MODELO,
  SEM_SITUACAO,
  eFalhaDoProvedor,
  fraseDaSituacao,
  lerSituacao,
  naFila,
} from "./situacao.ts";

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

// Quinta, 8 de outubro de 2026, 10h, na hora local.
const AGORA = new Date(2026, 9, 8, 10, 0);
const local = (dia: number, hora: number, minuto = 0) => new Date(2026, 9, dia, hora, minuto).toISOString();
const DORMINDO = { ...ATIVO, estado: "dormindo" } as const;

describe("lerSituacao: do runtime para o personagem", () => {
  it("sem notícia do serviço, o time dorme sem anel e convida a conectar um modelo", () => {
    expect(lerSituacao(null)).toEqual(SEM_SITUACAO);
    expect(lerSituacao(undefined)).toEqual({
      expressao: "dormindo",
      moldura: "nenhuma",
      texto: "dormindo",
      tom: "neutro",
      dica: CONVITE_MODELO,
      ponto: null,
    });
  });

  it.each([
    ["ocioso", "ocioso", "nenhuma", "ocioso", "neutro", null],
    ["trabalhando", "trabalhando", "sucesso", "trabalhando", "sucesso", null],
    ["esperando", "esperando", "aviso", "esperando você", "aviso", null],
    ["erro", "erro", "perigo", "erro", "perigo", "perigo"],
  ] as const)(
    "ativo e %s: expressão %s, anel %s, status %s em %s",
    (atividade, expressao, moldura, texto, tom, ponto) => {
      expect(lerSituacao({ ...ATIVO, atividade })).toEqual({
        expressao,
        moldura,
        texto,
        tom,
        dica: null,
        ponto,
      });
    },
  );

  it("sem modelo dorme com o convite; sem motivo, dorme sem dica", () => {
    expect(lerSituacao({ ...DORMINDO, motivoSono: "sem_modelo" }, AGORA)).toMatchObject({
      expressao: "dormindo",
      moldura: "nenhuma",
      texto: "dormindo",
      dica: CONVITE_MODELO,
      ponto: null,
    });
    expect(lerSituacao({ ...DORMINDO, motivoSono: null }, AGORA)).toMatchObject({ dica: null, ponto: null });
  });

  it("limite de uso: dorme tranquilo, sem ponto, e diz quando volta (Estados.dc.html, Sem modelo)", () => {
    const limite = { ...DORMINDO, motivoSono: "limite" } as const;
    expect(lerSituacao({ ...limite, dormeAte: local(12, 9) }, AGORA)).toEqual({
      expressao: "dormindo",
      moldura: "nenhuma",
      texto: "dormindo",
      tom: "neutro",
      dica: "Volta seg 9h",
      ponto: null,
    });
    expect(lerSituacao({ ...limite, dormeAte: local(8, 17, 40) }, AGORA).dica).toBe("Volta às 17:40");
    expect(lerSituacao(limite, AGORA).dica).toBe("Volta quando o limite renovar");
  });

  it("falha do provedor é o Erro de provedor do quadro: cara preocupada, anel e ponto vermelhos", () => {
    const falha = (motivoSono: "fora_do_ar" | "credencial" | "ausente", dormeAte: string | null) =>
      lerSituacao({ ...DORMINDO, motivoSono, dormeAte }, AGORA);
    expect(falha("fora_do_ar", local(8, 10, 5))).toEqual({
      expressao: "erro",
      moldura: "perigo",
      texto: "erro",
      tom: "perigo",
      dica: "Modelo fora do ar, tenta de novo às 10:05",
      ponto: "perigo",
    });
    expect(falha("credencial", null).dica).toBe("Chave do modelo recusada, tenta de novo em breve");
    expect(falha("ausente", local(9, 8)).dica).toBe("CLI do modelo não encontrado, tenta de novo amanhã 8h");
  });

  it("teto de gasto: cara preocupada, mas anel e ponto de aviso; vermelho é só erro (Estados.dc.html)", () => {
    const teto = lerSituacao({ ...DORMINDO, motivoSono: "teto" });
    expect(teto).toMatchObject({
      expressao: "erro",
      moldura: "aviso",
      texto: "parado",
      tom: "aviso",
      ponto: "aviso",
    });
    expect(lerSituacao({ ...ATIVO, atividade: "erro" }).moldura).toBe("perigo");
  });

  it("a frase de quem está parado é uma só por estado, com a fila; ativo não tem frase", () => {
    expect(fraseDaSituacao({ ...ATIVO, estado: "desligado" }, AGORA)).toBe(
      "Desligado: não trabalha nem responde",
    );
    expect(fraseDaSituacao({ ...ATIVO, estado: "pausado" }, AGORA)).toBe("Em pausa até você retomar");
    expect(fraseDaSituacao({ ...ATIVO, estado: "pausado", pausadoAte: local(8, 14), fila: 1 }, AGORA)).toBe(
      "Em pausa até 14h · 1 pedido na fila",
    );
    expect(
      fraseDaSituacao({ ...DORMINDO, motivoSono: "limite", dormeAte: local(12, 9), fila: 3 }, AGORA),
    ).toBe("Volta seg 9h · 3 pedidos na fila");
    expect(fraseDaSituacao({ ...DORMINDO, motivoSono: "fora_do_ar" }, AGORA)).toBe(
      "Modelo fora do ar, tenta de novo em breve",
    );
    expect(fraseDaSituacao({ ...DORMINDO, motivoSono: null }, AGORA)).toBe("Dormindo");
    expect(fraseDaSituacao({ ...ATIVO, atividade: "trabalhando" }, AGORA)).toBeNull();
    expect(naFila(0)).toBeNull();
    expect(eFalhaDoProvedor("credencial")).toBe(true);
    expect(eFalhaDoProvedor("limite")).toBe(false);
    expect(eFalhaDoProvedor(null)).toBe(false);
  });

  it("pausa e desligamento ganham da atividade: olhos fechados mesmo no meio de um trabalho", () => {
    expect(lerSituacao({ ...ATIVO, estado: "pausado", atividade: "trabalhando" })).toEqual({
      expressao: "dormindo",
      moldura: "nenhuma",
      texto: "pausado",
      tom: "neutro",
      dica: null,
      ponto: null,
    });
    expect(lerSituacao({ ...ATIVO, estado: "desligado", atividade: "esperando" })).toEqual({
      expressao: "dormindo",
      moldura: "nenhuma",
      texto: "desligado",
      tom: "apagado",
      dica: null,
      ponto: null,
    });
    // Dormindo por limite com uma execução marcada como erro continua dormindo.
    expect(lerSituacao({ ...DORMINDO, atividade: "erro", motivoSono: "limite" }).expressao).toBe("dormindo");
  });
});
