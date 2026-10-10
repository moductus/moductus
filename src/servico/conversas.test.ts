import type { Conversa, FalaParcial, Mensagem, SituacaoAgente } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { describe, expect, it } from "vitest";
import {
  aplicarParcial,
  conversaEmUso,
  encerrarParcial,
  falhaNaConversa,
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
    falhaDoProvedor: null,
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

describe("a falha do provedor na conversa", () => {
  // Sábado, 10 de outubro de 2026, 2:45, na hora local.
  const agora = new Date(2026, 9, 10, 2, 45);
  const volta = new Date(2026, 9, 10, 2, 46).toISOString();
  const CLAUDE = { tipo: "claude-cli", nome: "Claude Code" } as const;
  const semLogin: SituacaoAgente = {
    estado: "dormindo",
    atividade: "ocioso",
    motivoSono: "credencial",
    dormeAte: volta,
    pausadoAte: null,
    fila: 0,
  };
  const cru = mensagem("01E", {
    agenteId: "tula",
    execucaoId: "e1",
    conteudo: "O Claude Code recusou o login: Not logged in · Please run /login",
    falhaDoProvedor: "credencial",
  });
  const NO_PASSADO = { texto: "O Claude Code estava sem login." };

  it("a última fala, com o agente ainda dormindo por ela: o cartão do painel, com o comando e a hora", () => {
    expect(falhaNaConversa(cru, true, semLogin, CLAUDE, agora)).toEqual({
      texto: "O Claude Code está sem login. Entre no terminal com ",
      comando: { codigo: "claude", depois: " e tento de novo às 02:46." },
    });
    const foraDoAr = { ...cru, falhaDoProvedor: "fora_do_ar" } as const;
    expect(falhaNaConversa(foraDoAr, true, { ...semLogin, motivoSono: "fora_do_ar" }, CLAUDE, agora)).toEqual(
      {
        texto: "O Claude Code não respondeu. Nada foi alterado; tento de novo às 02:46.",
      },
    );
  });

  it("fala antiga, agente acordado, dormindo por outro motivo ou no limite: a falha no passado, sem hora", () => {
    expect(falhaNaConversa(cru, false, semLogin, CLAUDE, agora)).toEqual(NO_PASSADO);
    const acordado: SituacaoAgente = { ...semLogin, estado: "ativo", motivoSono: null, dormeAte: null };
    expect(falhaNaConversa(cru, true, acordado, CLAUDE, agora)).toEqual(NO_PASSADO);
    expect(falhaNaConversa(cru, true, { ...semLogin, motivoSono: "fora_do_ar" }, CLAUDE, agora)).toEqual(
      NO_PASSADO,
    );
    expect(falhaNaConversa(cru, true, undefined, CLAUDE, agora)).toEqual(NO_PASSADO);
    const limite = { ...cru, falhaDoProvedor: "limite" } as const;
    expect(falhaNaConversa(limite, true, { ...semLogin, motivoSono: "limite" }, CLAUDE, agora)).toEqual({
      texto: "O Claude Code estava no limite de uso.",
    });
  });

  it("resposta de verdade ou erro de outra causa (ferramenta, prazo): a fala como foi gravada", () => {
    const outraCausa = { ...cru, conteudo: "a ferramenta financas.quebrar falhou", falhaDoProvedor: null };
    expect(falhaNaConversa(outraCausa, true, semLogin, CLAUDE, agora)).toBeNull();
  });
});

describe("como a lista escreve", () => {
  const agora = new Date(2026, 9, 9, 15, 0);

  it("quando: hora hoje, ontem, dia da semana e depois a data", () => {
    expect(quandoCurto(new Date(2026, 9, 9, 9, 2).toISOString(), agora)).toBe("09:02");
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

  it("a prévia da falha dita pela janela junta o comando ao texto", () => {
    const falha = {
      texto: "O Claude Code está sem login. Entre no terminal com ",
      comando: { codigo: "claude", depois: " e tento de novo às 15:05." },
    };
    const daTula = mensagem("01C", {
      agenteId: "tula",
      conteudo: "Not logged in",
      falhaDoProvedor: "credencial",
    });
    expect(previa(daTula, true, falha)).toBe(
      "Tula: O Claude Code está sem login. Entre no terminal com claude e tento de novo às 15:05.",
    );
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
