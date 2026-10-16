import type {
  ChamadaFerramenta,
  Conexao,
  Execucao,
  ExecucaoDetalhada,
  SituacaoAgente,
} from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  agoraDoAgente,
  aindaDesfaziveis,
  custoDaExecucao,
  custoEmTexto,
  deHoje,
  descreverGatilho,
  descreverProvedor,
  desfaziveis,
  juntarExecucao,
  resumoDoDia,
  textoDaExecucao,
  tomDoModelo,
  vigiasDoAgente,
} from "./agente.ts";

const agora = new Date(2026, 9, 9, 15, 0);
const as = (hora: number, minuto = 0, dia = 9) => new Date(2026, 9, dia, hora, minuto).toISOString();

function execucao(id: string, parte: Partial<Execucao> = {}): Execucao {
  return {
    id,
    agenteId: "tula",
    gatilho: "mensagem",
    provedorId: "p1",
    inicio: as(14),
    fim: as(14, 1),
    estado: "ok",
    erro: null,
    falhaDoProvedor: null,
    tokensEntrada: null,
    tokensSaida: null,
    custoEstimadoMicrodolares: null,
    cobranca: "assinatura",
    resumo: null,
    ...parte,
  };
}

function chamada(id: string, parte: Partial<ChamadaFerramenta> = {}): ChamadaFerramenta {
  return {
    id,
    execucaoId: "e1",
    ferramenta: "tarefas.criar",
    efeito: "interno",
    entrada: {},
    resultado: {},
    aprovacaoId: null,
    criadoEm: as(14),
    desfeitaEm: null,
    desfazerAte: as(14, 0, 10),
    ...parte,
  };
}

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

describe("histórico", () => {
  it("o dia de hoje começa à meia-noite local", () => {
    const lista = [execucao("e2", { inicio: as(8) }), execucao("e1", { inicio: as(23, 0, 8) })];
    expect(deHoje(lista, agora).map((e) => e.id)).toEqual(["e2"]);
  });

  it("execução nova entra no alto; a que mudou troca no lugar", () => {
    const lista = [execucao("e2"), execucao("e1")];
    expect(juntarExecucao(lista, execucao("e3")).map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect(juntarExecucao(lista, execucao("e1", { estado: "erro" }))[1]?.estado).toBe("erro");
  });

  it("só pede o detalhe do que terminou nas últimas 24 h", () => {
    const lista = [
      execucao("e4", { estado: "rodando", fim: null }),
      execucao("e3"),
      execucao("e2", { inicio: as(16, 0, 8), fim: as(16, 0, 8) }),
      execucao("e1", { inicio: as(14, 0, 8), fim: as(14, 0, 8) }),
    ];
    expect(aindaDesfaziveis(lista, agora).map((e) => e.id)).toEqual(["e3", "e2"]);
  });

  it("desfaz só o que ainda está no prazo, da última chamada para a primeira", () => {
    const detalhe: ExecucaoDetalhada = {
      ...execucao("e1"),
      chamadas: [
        chamada("c1"),
        chamada("c2", { desfazerAte: null }),
        chamada("c3", { desfeitaEm: as(14, 30) }),
        chamada("c4", { desfazerAte: as(14, 59) }),
        chamada("c5"),
      ],
    };
    expect(desfaziveis(detalhe, agora).map((c) => c.id)).toEqual(["c5", "c1"]);
    expect(desfaziveis({ ...detalhe, estado: "rodando" }, agora)).toEqual([]);
    expect(desfaziveis(undefined, agora)).toEqual([]);
  });

  it("a linha diz o resumo, o erro ou o que disparou", () => {
    expect(textoDaExecucao(execucao("e1", { resumo: "Criou lembrete da fatura para sexta" }))).toBe(
      "Criou lembrete da fatura para sexta",
    );
    expect(textoDaExecucao(execucao("e1", { estado: "erro", erro: "O limite de uso acabou" }))).toBe(
      "O limite de uso acabou",
    );
    expect(textoDaExecucao(execucao("e1", { gatilho: "horario" }))).toBe("Trabalhou no horário marcado");
    // A falha do provedor sai no passado, pelo provedor em que rodou, nunca com o texto cru.
    const semLogin = execucao("e1", {
      estado: "erro",
      erro: "O Claude Code recusou o login: Not logged in · Please run /login",
      falhaDoProvedor: "credencial",
    });
    expect(textoDaExecucao(semLogin, { tipo: "claude-cli", nome: "Claude Code" })).toBe(
      "O Claude Code estava sem login.",
    );
    expect(textoDaExecucao(semLogin)).toBe("O modelo recusou o acesso.");
    expect(textoDaExecucao(execucao("e1", { estado: "rodando" }))).toBe("Respondendo na conversa");
    expect(textoDaExecucao(execucao("e1", { estado: "rodando", gatilho: "intervalo" }))).toBe(
      "Conferindo no intervalo marcado",
    );
  });
});

describe("custo com a fonte dita", () => {
  it("menos de um centavo não vira zero", () => {
    expect(custoEmTexto(4_000)).toBe("menos de US$ 0,01");
    expect(custoEmTexto(1_234_567)).toBe("US$ 1,23");
    expect(custoEmTexto(0)).toBe("US$ 0,00");
  });

  it("assinatura, estimativa marcada ou sem preço; sem provedor, nada", () => {
    expect(custoDaExecucao(execucao("e1"))).toBe("assinatura");
    expect(
      custoDaExecucao(execucao("e1", { cobranca: "por_token", custoEstimadoMicrodolares: 20_000 })),
    ).toBe("US$ 0,02 estimado");
    expect(custoDaExecucao(execucao("e1", { cobranca: "por_token" }))).toBe("sem preço");
    expect(custoDaExecucao(execucao("e1", { cobranca: null }))).toBeNull();
  });

  it("o resumo do dia só soma o que tem número e diz o resto", () => {
    expect(resumoDoDia([])).toBe("Hoje: nenhuma execução.");
    expect(resumoDoDia([execucao("e1")])).toBe("Hoje: 1 execução, pela assinatura.");
    expect(
      resumoDoDia([
        execucao("e1", { cobranca: "por_token", custoEstimadoMicrodolares: 20_000 }),
        execucao("e2", { cobranca: "por_token" }),
      ]),
    ).toBe("Hoje: 2 execuções, US$ 0,02 estimado, parte sem preço.");
  });

  it("o provedor diz o nome, o modelo e como é pago", () => {
    const base = { id: "p1", baseUrl: null, temChave: false, testadoEm: null };
    expect(descreverProvedor({ ...base, tipo: "claude-cli", nome: "Claude Code", modelo: null })).toBe(
      "Claude Code · sua assinatura",
    );
    expect(descreverProvedor({ ...base, tipo: "openai", nome: "OpenAI", modelo: "gpt-5" })).toBe(
      "OpenAI (gpt-5) · por token",
    );
  });
});

describe("o que o agente está fazendo", () => {
  it("parado, diz o mesmo texto do dock: pausa, sono com a hora de volta (Estados.dc.html) e a fila", () => {
    expect(agoraDoAgente({ ...ATIVO, estado: "pausado" }, null, agora)).toBe("Em pausa até você retomar");
    expect(agoraDoAgente({ ...ATIVO, estado: "pausado", pausadoAte: as(16, 30), fila: 2 }, null, agora)).toBe(
      "Em pausa até 16:30 · 2 pedidos na fila",
    );
    expect(
      agoraDoAgente(
        { ...ATIVO, estado: "dormindo", motivoSono: "limite", dormeAte: as(9, 0, 10) },
        null,
        agora,
      ),
    ).toBe("Volta amanhã 09:00");
    // Falha do provedor é erro, não sono tranquilo.
    expect(
      agoraDoAgente(
        { ...ATIVO, estado: "dormindo", motivoSono: "fora_do_ar", dormeAte: as(15, 5) },
        null,
        agora,
      ),
    ).toBe("Modelo fora do ar, tenta de novo às 15:05");
    expect(agoraDoAgente({ ...ATIVO, estado: "desligado" }, null, agora)).toBe(
      "Desligado: não trabalha nem responde",
    );
  });

  it("ativo, diz o trabalho em andamento ou a espera por você", () => {
    expect(
      agoraDoAgente({ ...ATIVO, atividade: "trabalhando" }, execucao("e1", { estado: "rodando" }), agora),
    ).toBe("Agora: respondendo na conversa");
    // Cada gatilho no gerúndio, não só o da conversa.
    expect(
      agoraDoAgente(
        { ...ATIVO, atividade: "trabalhando" },
        execucao("e1", { estado: "rodando", gatilho: "horario" }),
        agora,
      ),
    ).toBe("Agora: trabalhando no horário marcado");
    expect(
      agoraDoAgente(
        { ...ATIVO, atividade: "trabalhando" },
        execucao("e1", { estado: "rodando", gatilho: "evento" }),
        agora,
      ),
    ).toBe("Agora: atendendo um aviso");
    expect(agoraDoAgente({ ...ATIVO, atividade: "esperando", fila: 1 }, null, agora)).toBe(
      "Agora: esperando sua resposta num pedido · 1 pedido na fila",
    );
    expect(agoraDoAgente(ATIVO, null, agora)).toBe("Sem nada em andamento.");
  });

  it("o ponto do modelo: vermelho na falha do provedor, aviso no limite, verde no resto", () => {
    const dormindo = (motivoSono: SituacaoAgente["motivoSono"]) => ({
      ...ATIVO,
      estado: "dormindo" as const,
      motivoSono,
    });
    expect(tomDoModelo(dormindo("fora_do_ar"))).toBe("perigo");
    expect(tomDoModelo(dormindo("credencial"))).toBe("perigo");
    expect(tomDoModelo(dormindo("ausente"))).toBe("perigo");
    expect(tomDoModelo(dormindo("limite"))).toBe("aviso");
    expect(tomDoModelo(dormindo("teto"))).toBe("sucesso");
    expect(tomDoModelo(ATIVO)).toBe("sucesso");
  });
});

describe("vigias", () => {
  it("as conexões do Nuno, com a conta, e os gatilhos de cada um", () => {
    const conexoes: Conexao[] = [
      { tipo: "github", estado: "ligada", conta: "gustavo", ultimoErro: null, conectadaEm: as(8) },
      { tipo: "hooks-claude-code", estado: "desligada", conta: null, ultimoErro: null, conectadaEm: null },
    ];
    expect(vigiasDoAgente("nuno", [{ tipo: "intervalo", minutos: 15 }], conexoes)).toEqual([
      { nome: "GitHub", quando: "a cada 15 min · gustavo", estado: "ligada" },
      { nome: "Sessões do Claude Code", quando: "na hora, pelos hooks", estado: "desligada" },
      { nome: "Conferência periódica", quando: "a cada 15 min", estado: null },
    ]);
    expect(vigiasDoAgente("tula", [{ tipo: "evento", nome: "arquivo.chegou" }], conexoes)).toEqual([
      { nome: "Aviso arquivo.chegou", quando: "quando acontece", estado: null },
    ]);
  });

  it("descreve cada gatilho como a página escreve", () => {
    expect(descreverGatilho({ tipo: "horario", hora: "08:30" })).toBe("todo dia às 08:30");
    expect(descreverGatilho({ tipo: "evento", nome: "arquivo.chegou" })).toBe(
      "quando acontece arquivo.chegou",
    );
  });
});
