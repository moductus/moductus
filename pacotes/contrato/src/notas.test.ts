import { describe, expect, test } from "vitest";
import { METODOS } from "./metodos.ts";
import {
  NOTA_BLOCO_RAPIDO,
  Nota,
  PedidoBuscarNotas,
  PedidoSalvarNota,
  ResultadoBuscaNota,
  ResultadoSalvarNota,
  ResumoNota,
} from "./notas.ts";

const nota = {
  id: "01K7A0000000000000000000N1",
  titulo: "Ideias para a viagem de dezembro",
  conteudo: "Três dias na serra.\n\n- Trilha da cachoeira",
  fixada: false,
  pasta: "Pessoal · Viagem de dezembro",
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-08T12:00:00.000Z",
  atualizadoEm: "2026-10-08T12:05:00.000Z",
};

describe("notas", () => {
  test("o bloco rápido tem o id da migração 015", () => {
    expect(NOTA_BLOCO_RAPIDO).toBe("bloco_rapido");
  });

  test("nota passa; a da lista leva o trecho em vez do conteúdo", () => {
    expect(Nota.parse(nota)).toEqual(nota);
    const { conteudo: _conteudo, ...semConteudo } = nota;
    const resumo = { ...semConteudo, trecho: "Três dias na serra." };
    expect(ResumoNota.parse(resumo)).toEqual(resumo);
    expect(ResumoNota.parse({ ...resumo, conteudo: nota.conteudo })).toEqual(resumo);
  });

  test("salvar manda a versão conhecida e algo para salvar", () => {
    expect(
      PedidoSalvarNota.safeParse({ id: nota.id, versao: nota.atualizadoEm, conteudo: "x" }).success,
    ).toBe(true);
    expect(PedidoSalvarNota.safeParse({ id: nota.id, conteudo: "x" }).success).toBe(false);
    expect(PedidoSalvarNota.safeParse({ id: nota.id, versao: nota.atualizadoEm }).success).toBe(false);
  });

  test("versão mais nova em outra janela volta as duas, sem gravar", () => {
    expect(ResultadoSalvarNota.safeParse({ salvou: true, nota }).success).toBe(true);
    const conflito = {
      salvou: false,
      atual: nota,
      recusada: { titulo: nota.titulo, conteudo: "outro texto" },
    };
    expect(ResultadoSalvarNota.parse(conflito)).toEqual(conflito);
    expect(ResultadoSalvarNota.safeParse({ salvou: false, nota }).success).toBe(false);
    expect(METODOS["notas.salvar"].saida.safeParse(conflito).success).toBe(true);
  });

  test("busca pede texto; o destaque marca posições, não HTML", () => {
    expect(PedidoBuscarNotas.safeParse({ texto: "amanha" }).success).toBe(true);
    expect(PedidoBuscarNotas.safeParse({ texto: "  " }).success).toBe(false);
    const { conteudo: _conteudo, ...semConteudo } = nota;
    const achado = { ...semConteudo, trecho: "Três dias na serra.", destaques: [{ inicio: 14, fim: 19 }] };
    expect(ResultadoBuscaNota.safeParse(achado).success).toBe(true);
    expect(ResultadoBuscaNota.safeParse({ ...achado, destaques: [{ inicio: 5, fim: 5 }] }).success).toBe(
      false,
    );
  });
});
