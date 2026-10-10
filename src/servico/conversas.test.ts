import type { Conversa, FalaParcial, Mensagem } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { describe, expect, it } from "vitest";
import {
  aplicarParcial,
  conversaEmUso,
  encerrarParcial,
  juntarConversa,
  juntarMensagem,
  mencionar,
  mensagemDeErro,
  previa,
  quandoCurto,
} from "./conversas.ts";

function conversa(id: string, parte: Partial<Conversa> = {}): Conversa {
  return {
    id,
    tipo: "agente",
    agenteId: "tula",
    titulo: null,
    arquivada: false,
    criadoEm: "2026-10-09T12:00:00.000Z",
    ...parte,
  };
}

function mensagem(id: string, parte: Partial<Mensagem> = {}): Mensagem {
  return {
    id,
    conversaId: "c1",
    agenteId: null,
    conteudo: "oi",
    execucaoId: null,
    criadoEm: "2026-10-09T12:00:00.000Z",
    ...parte,
  };
}

const parcial = (execucaoId: string, texto: string): FalaParcial => ({
  conversaId: "c1",
  agenteId: "tula",
  execucaoId,
  texto,
});

describe("conversa em uso", () => {
  it("é a mais nova não arquivada de cada um; o time só olha as do time", () => {
    const lista = [
      conversa("01A", { tipo: "time", agenteId: null }),
      conversa("01B"),
      conversa("01C"),
      conversa("01D", { arquivada: true }),
      conversa("01E", { agenteId: "nuno" }),
    ];
    expect(conversaEmUso(lista, null)?.id).toBe("01A");
    expect(conversaEmUso(lista, "tula")?.id).toBe("01C");
    expect(conversaEmUso(lista, "alba")).toBeNull();
  });

  it("troca a conversa que mudou e põe a nova no fim", () => {
    const lista = [conversa("01A"), conversa("01B")];
    expect(juntarConversa(lista, conversa("01A", { arquivada: true })).map((c) => c.arquivada)).toEqual([
      true,
      false,
    ]);
    expect(juntarConversa(lista, conversa("01C")).map((c) => c.id)).toEqual(["01A", "01B", "01C"]);
  });
});

describe("mensagens e resposta em andamento", () => {
  it("põe a mensagem na ordem do id, sem repetir a que veio pela resposta do pedido", () => {
    const lista = [mensagem("01A"), mensagem("01C")];
    expect(juntarMensagem(lista, mensagem("01B")).map((m) => m.id)).toEqual(["01A", "01B", "01C"]);
    expect(juntarMensagem(lista, mensagem("01C"))).toHaveLength(2);
  });

  it("o pedaço novo substitui o texto da mesma execução; o de execução já gravada não volta", () => {
    let andamento = aplicarParcial({}, parcial("e1", "Lendo"), new Set());
    andamento = aplicarParcial(andamento, parcial("e1", "Lendo o extrato"), new Set());
    expect(andamento.e1?.texto).toBe("Lendo o extrato");
    expect(aplicarParcial(andamento, parcial("e2", "Oi"), new Set(["e2"]))).toBe(andamento);
  });

  it("a resposta gravada tira a fala em andamento da mesma execução, e só ela", () => {
    const andamento = { e1: parcial("e1", "a"), e2: parcial("e2", "b") };
    expect(
      Object.keys(encerrarParcial(andamento, mensagem("01A", { agenteId: "tula", execucaoId: "e1" }))),
    ).toEqual(["e2"]);
    expect(encerrarParcial(andamento, mensagem("01B"))).toBe(andamento);
  });
});

describe("como a lista escreve", () => {
  const agora = new Date(2026, 9, 9, 15, 0);

  it("quando: hora hoje, ontem, dia da semana e depois a data", () => {
    expect(quandoCurto(new Date(2026, 9, 9, 9, 2).toISOString(), agora)).toBe("9:02");
    expect(quandoCurto(new Date(2026, 9, 8, 23, 0).toISOString(), agora)).toBe("ontem");
    expect(quandoCurto(new Date(2026, 9, 5, 10, 0).toISOString(), agora)).toBe("seg");
    expect(quandoCurto(new Date(2026, 8, 30, 10, 0).toISOString(), agora)).toBe("30/09");
  });

  it("a prévia diz quem falou no time e junta as linhas", () => {
    const daFaina = mensagem("01A", { agenteId: "faina", conteudo: "Achei 38\ninstaladores" });
    expect(previa(daFaina, true)).toBe("Faina: Achei 38 instaladores");
    expect(previa(daFaina, false)).toBe("Achei 38 instaladores");
    expect(previa(mensagem("01B", { conteudo: "tira os velhos" }), false)).toBe("Você: tira os velhos");
  });

  it("menciona no começo, sem repetir a menção que já está no texto", () => {
    expect(mencionar("", "tula")).toBe("@tula ");
    expect(mencionar("quanto foi de mercado?", "tula")).toBe("@tula quanto foi de mercado?");
    expect(mencionar("@TULA quanto foi?", "tula")).toBe("@TULA quanto foi?");
  });

  it("o erro diz se nada saiu ou repete a recusa do serviço", () => {
    expect(mensagemDeErro(new ServicoIndisponivel())).toMatch(/Nada foi enviado/);
    expect(mensagemDeErro(new RecusaDoServico("conversa não encontrada"))).toBe("Conversa não encontrada");
    expect(mensagemDeErro(new Error("caiu"))).toMatch(/Não consegui confirmar/);
  });
});
