import type { Nota, PedidoSalvarNota, ResultadoSalvarNota } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel } from "@moductus/contrato/cliente";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPERA_APOS_FALHA_MS, ESPERA_SALVAR_MS, NOTA_SUMIU, RascunhoNota } from "./salvamento.ts";

const nota = (extra: Partial<Nota> = {}): Nota => ({
  id: "01NOTA",
  titulo: "Viagem",
  conteudo: "três dias",
  fixada: false,
  pasta: null,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-18T10:00:00.000Z",
  atualizadoEm: "2026-10-18T10:00:00.000Z",
  ...extra,
});

/** O serviço de mentira: cada salvar fica pendurado até o teste responder. */
function servicoFalso() {
  const pedidos: {
    pedido: PedidoSalvarNota;
    responder: (r: ResultadoSalvarNota) => void;
    falhar: (e: Error) => void;
  }[] = [];
  const salvar = (pedido: PedidoSalvarNota) =>
    new Promise<ResultadoSalvarNota>((responder, falhar) => pedidos.push({ pedido, responder, falhar }));
  /** Responde o último pedido como o serviço: grava com versão nova. */
  const gravar = async (versao: string) => {
    const p = pedidos.at(-1)!;
    p.responder({
      salvou: true,
      nota: nota({ titulo: p.pedido.titulo, conteudo: p.pedido.conteudo, atualizadoEm: versao }),
    });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { pedidos, salvar, gravar };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RascunhoNota", () => {
  it("espera 800 ms depois da última tecla e manda o texto com a versão que conhece", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "três" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS - 100);
    r.editar({ conteudo: "três dias na serra" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS - 1);
    expect(s.pedidos).toHaveLength(0);
    expect(r.atual.situacao).toBe("esperando");
    await vi.advanceTimersByTimeAsync(1);
    expect(s.pedidos.map((p) => p.pedido)).toEqual([
      { id: "01NOTA", versao: "2026-10-18T10:00:00.000Z", titulo: "Viagem", conteudo: "três dias na serra" },
    ]);
    expect(r.atual.situacao).toBe("salvando");
    await s.gravar("2026-10-18T10:01:00.000Z");
    expect(r.atual.situacao).toBe("salvo");
    expect(r.atual.nota.atualizadoEm).toBe("2026-10-18T10:01:00.000Z");
    expect(r.quieto).toBe(true);
  });

  it("descarregar salva na hora, sem esperar a pausa (a janela fechou no meio da digitação)", () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "três dias na ser" });
    r.descarregar();
    expect(s.pedidos.map((p) => p.pedido.conteudo)).toEqual(["três dias na ser"]);
  });

  it("voltar ao texto do banco antes da pausa não salva nada", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "três dias!" });
    r.editar({ conteudo: "três dias" });
    expect(r.atual.situacao).toBe("salvo");
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS * 2);
    r.descarregar();
    expect(s.pedidos).toHaveLength(0);
  });

  it("o que muda enquanto um salvar está fora sai depois, já com a versão nova", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "a" });
    r.descarregar();
    r.editar({ conteudo: "ab" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS);
    // Um pedido só fora de cada vez.
    expect(s.pedidos).toHaveLength(1);
    await s.gravar("2026-10-18T10:01:00.000Z");
    expect(s.pedidos.map((p) => [p.pedido.conteudo, p.pedido.versao])).toEqual([
      ["a", "2026-10-18T10:00:00.000Z"],
      ["ab", "2026-10-18T10:01:00.000Z"],
    ]);
  });

  it("recusado por versão mais nova: nada se perde e você escolhe qual texto fica", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "o meu texto" });
    r.descarregar();
    const outra = nota({ conteudo: "o texto do painel", atualizadoEm: "2026-10-18T10:00:05.000Z" });
    s.pedidos[0]!.responder({
      salvou: false,
      atual: outra,
      recusada: { titulo: "Viagem", conteudo: "o meu texto" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.atual.situacao).toBe("conflito");
    expect(r.atual.conteudo).toBe("o meu texto");
    expect(r.atual.outra).toEqual(outra);
    // No conflito, nada sai sozinho, nem com mais texto.
    r.editar({ conteudo: "o meu texto, mais" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS * 2);
    expect(s.pedidos).toHaveLength(1);

    r.ficarComAMinha();
    expect(s.pedidos.at(-1)?.pedido).toMatchObject({
      conteudo: "o meu texto, mais",
      versao: "2026-10-18T10:00:05.000Z",
    });
  });

  it("usar a outra versão troca o texto da tela pelo do banco", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "o meu texto" });
    r.descarregar();
    const outra = nota({ conteudo: "o texto do painel", atualizadoEm: "2026-10-18T10:00:05.000Z" });
    s.pedidos[0]!.responder({
      salvou: false,
      atual: outra,
      recusada: { titulo: "Viagem", conteudo: "o meu texto" },
    });
    await vi.advanceTimersByTimeAsync(0);
    r.usarAOutra();
    expect(r.atual).toMatchObject({ situacao: "salvo", conteudo: "o texto do painel", outra: null });
    expect(r.quieto).toBe(true);
  });

  it("aviso de outra janela: sem nada pendente vale o de lá; com texto pendente diferente, é conflito na hora", () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.chegou(nota({ conteudo: "mudou no painel", atualizadoEm: "2026-10-18T10:00:01.000Z" }));
    expect(r.atual).toMatchObject({ situacao: "salvo", conteudo: "mudou no painel" });

    r.editar({ conteudo: "e aqui também" });
    r.chegou(nota({ conteudo: "de novo no painel", atualizadoEm: "2026-10-18T10:00:02.000Z" }));
    expect(r.atual.situacao).toBe("conflito");
    expect(r.atual.conteudo).toBe("e aqui também");
    expect(s.pedidos).toHaveLength(0);
  });

  it("o eco do próprio salvar e um aviso antigo não mexem no texto", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "a" });
    r.descarregar();
    r.editar({ conteudo: "ab" });
    // O serviço avisa antes de responder.
    r.chegou(nota({ conteudo: "a", atualizadoEm: "2026-10-18T10:01:00.000Z" }));
    expect(r.atual.conteudo).toBe("ab");
    expect(r.atual.situacao).not.toBe("conflito");
    await s.gravar("2026-10-18T10:01:00.000Z");
    r.chegou(nota({ conteudo: "velho", atualizadoEm: "2026-10-18T09:00:00.000Z" }));
    expect(r.atual.conteudo).toBe("ab");
  });

  it("canal caído: o texto fica, tenta de novo sozinho em 5 s, e o que já tinha gravado não vira conflito", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "não posso perder" });
    r.descarregar();
    // A conexão caiu depois do envio: o serviço gravou, mas a resposta se perdeu.
    s.pedidos[0]!.falhar(new Error("conexão trocada"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.atual).toMatchObject({ situacao: "falhou", erro: null, conteudo: "não posso perder" });
    r.editar({ conteudo: "não posso perder isto" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS);
    expect(s.pedidos).toHaveLength(2);
    s.pedidos[1]!.falhar(new ServicoIndisponivel());
    await vi.advanceTimersByTimeAsync(ESPERA_APOS_FALHA_MS - 1);
    expect(s.pedidos).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.pedidos).toHaveLength(3);
    // O banco tem "não posso perder" com versão nova: é desta janela, então vai de novo sobre ela.
    s.pedidos[2]!.responder({
      salvou: false,
      atual: nota({ conteudo: "não posso perder isto", atualizadoEm: "2026-10-18T10:02:00.000Z" }),
      recusada: { titulo: "Viagem", conteudo: "não posso perder isto" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.atual.situacao).toBe("salvo");
    expect(r.atual.nota.atualizadoEm).toBe("2026-10-18T10:02:00.000Z");
  });

  it("a versão perdida com o texto que saiu é adotada e o resto vai por cima", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "um" });
    r.descarregar();
    s.pedidos[0]!.falhar(new Error("conexão trocada"));
    await vi.advanceTimersByTimeAsync(0);
    r.editar({ conteudo: "um dois" });
    r.descarregar();
    s.pedidos[1]!.responder({
      salvou: false,
      atual: nota({ conteudo: "um", atualizadoEm: "2026-10-18T10:02:00.000Z" }),
      recusada: { titulo: "Viagem", conteudo: "um dois" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.atual.situacao).not.toBe("conflito");
    expect(s.pedidos.at(-1)?.pedido).toMatchObject({
      conteudo: "um dois",
      versao: "2026-10-18T10:02:00.000Z",
    });
  });

  it("recusa do serviço diz o motivo e não insiste; nota que sumiu fica como apagada, com o texto", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "x".repeat(10) });
    r.descarregar();
    s.pedidos[0]!.falhar(new RecusaDoServico("texto grande demais"));
    await vi.advanceTimersByTimeAsync(ESPERA_APOS_FALHA_MS * 2);
    expect(r.atual).toMatchObject({ situacao: "falhou", erro: "texto grande demais" });
    expect(s.pedidos).toHaveLength(1);

    r.editar({ conteudo: "y" });
    r.descarregar();
    s.pedidos[1]!.falhar(new RecusaDoServico(NOTA_SUMIU));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.atual).toMatchObject({ situacao: "apagada", conteudo: "y" });
    r.editar({ conteudo: "yz" });
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS);
    expect(s.pedidos).toHaveLength(2);
  });

  it("descartar larga o texto pendente e fica com o que o banco tem, sem mandar o largado", async () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "rascunho" });
    r.descarregar();
    r.editar({ conteudo: "rascunho 2" });
    r.descartar();
    expect(r.atual).toMatchObject({ situacao: "salvo", conteudo: "três dias" });
    await s.gravar("2026-10-18T10:01:00.000Z");
    await vi.advanceTimersByTimeAsync(ESPERA_SALVAR_MS * 2);
    expect(s.pedidos).toHaveLength(1);
    expect(r.atual).toMatchObject({ situacao: "salvo", conteudo: "rascunho" });
    expect(r.quieto).toBe(true);
  });

  it("fixar ou mudar de pasta em outra janela não mexe no texto pendente", () => {
    const s = servicoFalso();
    const r = new RascunhoNota(nota(), { salvar: s.salvar });
    r.editar({ conteudo: "pendente" });
    r.chegou(nota({ pasta: "Pessoal" }));
    expect(r.atual).toMatchObject({ situacao: "esperando", conteudo: "pendente" });
    expect(r.atual.nota.pasta).toBe("Pessoal");
  });
});
