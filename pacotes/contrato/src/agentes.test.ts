import { describe, expect, test } from "vitest";
import {
  AGENTES_DE_FABRICA,
  Agente,
  ChamadaFerramenta,
  Execucao,
  ExecucaoDetalhada,
  Gatilho,
  MotivoSono,
  MudancaAgente,
  PaginaExecucoes,
  PedidoExecucoes,
  PedidoPausar,
} from "./agentes.ts";

const nuno = {
  id: "nuno",
  nome: "Nuno",
  funcao: "Fica de olho nas suas IAs e no seu código",
  instrucoes: "Você é o Nuno.",
  personagem: { silhueta: "capsula", traco: "fones", tom: "ardosia" },
  ferramentas: ["sessoes.*", "uso.*", "github.*", "tarefas.criar"],
  provedorId: "01K79Z6N7Q4W3J5XG2B8C1D0EF",
  provedorReservaId: null,
  gatilhos: [
    { tipo: "intervalo", minutos: 15 },
    { tipo: "evento", nome: "sessao.contexto_alto" },
  ],
  escoposMemoria: ["dev", "geral"],
  tetoDiarioCentavos: null,
  deFabrica: true,
  situacao: {
    estado: "dormindo",
    atividade: "ocioso",
    motivoSono: "limite",
    dormeAte: "2026-10-09T18:00:00.000Z",
    pausadoAte: null,
    fila: 2,
  },
};

const execucao = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EG",
  agenteId: "nuno",
  gatilho: "intervalo",
  provedorId: null,
  inicio: "2026-10-09T12:00:00.000Z",
  fim: null,
  estado: "rodando",
  erro: null,
  tokensEntrada: null,
  tokensSaida: null,
  custoEstimadoMicrodolares: null,
  cobranca: null,
  resumo: null,
};

describe("agente", () => {
  test("os quatro de fábrica, com o id igual ao da migração 003", () => {
    expect(AGENTES_DE_FABRICA).toEqual(["alba", "tula", "faina", "nuno"]);
  });

  test("agente completo passa", () => {
    expect(Agente.parse(nuno)).toEqual(nuno);
  });

  test("agente sem situação, com teto negativo ou ferramenta fora do padrão é recusado", () => {
    const { situacao: _situacao, ...semSituacao } = nuno;
    expect(Agente.safeParse(semSituacao).success).toBe(false);
    expect(Agente.safeParse({ ...nuno, tetoDiarioCentavos: -1 }).success).toBe(false);
    expect(Agente.safeParse({ ...nuno, ferramentas: ["Bash"] }).success).toBe(false);
    expect(Agente.safeParse({ ...nuno, nome: "  " }).success).toBe(false);
  });

  test("estado e motivo de sono só com os valores conhecidos", () => {
    expect(MotivoSono.options).toEqual([
      "limite",
      "fora_do_ar",
      "credencial",
      "ausente",
      "teto",
      "sem_modelo",
    ]);
    const situacao = (s: object) =>
      Agente.safeParse({ ...nuno, situacao: { ...nuno.situacao, ...s } }).success;
    expect(situacao({ estado: "acordado" })).toBe(false);
    expect(situacao({ atividade: "aviso" })).toBe(false);
    expect(situacao({ fila: -1 })).toBe(false);
  });

  test("mudança precisa do id e aceita só parte dos campos", () => {
    expect(MudancaAgente.parse({ id: "tula", provedorId: null })).toEqual({ id: "tula", provedorId: null });
    expect(MudancaAgente.safeParse({ provedorId: null }).success).toBe(false);
    expect(MudancaAgente.safeParse({ id: "tula", gatilhos: [{ tipo: "horario", hora: "8h" }] }).success).toBe(
      false,
    );
  });

  test("pausar o time inteiro ou um agente, com ou sem prazo", () => {
    expect(PedidoPausar.safeParse({ ate: null }).success).toBe(true);
    expect(PedidoPausar.safeParse({ agenteId: "alba", ate: "2026-10-09T13:00:00.000Z" }).success).toBe(true);
    expect(PedidoPausar.safeParse({ agenteId: "alba" }).success).toBe(false);
    expect(PedidoPausar.safeParse({ ate: "amanhã" }).success).toBe(false);
  });
});

describe("gatilho", () => {
  test("horário, intervalo e evento", () => {
    for (const g of [
      { tipo: "horario", hora: "08:30" },
      { tipo: "intervalo", minutos: 15 },
      { tipo: "evento", nome: "arquivo.chegou" },
    ]) {
      expect(Gatilho.safeParse(g).success, JSON.stringify(g)).toBe(true);
    }
  });

  test("hora inválida, intervalo zero, evento sem domínio e tipo desconhecido são recusados", () => {
    for (const g of [
      { tipo: "horario", hora: "24:00" },
      { tipo: "intervalo", minutos: 0 },
      { tipo: "evento", nome: "chegou" },
      { tipo: "cron", expressao: "* * * * *" },
    ]) {
      expect(Gatilho.safeParse(g).success, JSON.stringify(g)).toBe(false);
    }
  });
});

describe("execução e histórico", () => {
  test("execução rodando sem tokens nem custo passa; estado fora da lista não", () => {
    expect(Execucao.safeParse(execucao).success).toBe(true);
    expect(Execucao.safeParse({ ...execucao, estado: "cancelada" }).success).toBe(false);
    expect(Execucao.safeParse({ ...execucao, custoEstimadoMicrodolares: 1.5 }).success).toBe(false);
  });

  test("execução terminada diz como o uso é pago: assinatura sem custo, por token com estimativa", () => {
    const ok = { ...execucao, estado: "ok", tokensEntrada: 1000, tokensSaida: 200 };
    expect(Execucao.safeParse({ ...ok, cobranca: "assinatura" }).success).toBe(true);
    expect(
      Execucao.safeParse({ ...ok, cobranca: "por_token", custoEstimadoMicrodolares: 2600 }).success,
    ).toBe(true);
    expect(Execucao.safeParse({ ...ok, cobranca: "gratis" }).success).toBe(false);
    // Assinatura com custo seria número inventado, no histórico e no detalhe.
    const comCusto = { ...ok, cobranca: "assinatura", custoEstimadoMicrodolares: 2600 };
    expect(Execucao.safeParse(comCusto).success).toBe(false);
    expect(ExecucaoDetalhada.safeParse({ ...comCusto, chamadas: [] }).success).toBe(false);
    expect(
      ExecucaoDetalhada.safeParse({ ...comCusto, custoEstimadoMicrodolares: null, chamadas: [] }).success,
    ).toBe(true);
    expect(Execucao.safeParse({ ...ok, cobranca: undefined }).success).toBe(false);
  });

  test("página de execuções com cursor", () => {
    expect(PaginaExecucoes.safeParse({ itens: [execucao], proximo: execucao.id }).success).toBe(true);
    expect(PaginaExecucoes.safeParse({ itens: [execucao] }).success).toBe(false);
    expect(PedidoExecucoes.safeParse({ agenteId: "nuno", limite: 50 }).success).toBe(true);
    expect(PedidoExecucoes.safeParse({ limite: 0 }).success).toBe(false);
    expect(PedidoExecucoes.safeParse({ limite: 201 }).success).toBe(false);
  });

  test("chamada de ferramenta com efeito e prazo de desfazer", () => {
    const chamada = {
      id: "01K79Z6N7Q4W3J5XG2B8C1D0EH",
      execucaoId: execucao.id,
      ferramenta: "tarefas.criar",
      efeito: "interno",
      entrada: { titulo: "Revisar o PR 142" },
      resultado: { id: "01K79Z6N7Q4W3J5XG2B8C1D0EJ" },
      aprovacaoId: null,
      criadoEm: "2026-10-09T12:00:01.000Z",
      desfeitaEm: null,
      desfazerAte: "2026-10-10T12:00:01.000Z",
    };
    expect(ChamadaFerramenta.safeParse(chamada).success).toBe(true);
    expect(ChamadaFerramenta.safeParse({ ...chamada, efeito: "sistema" }).success).toBe(false);
    expect(ChamadaFerramenta.safeParse({ ...chamada, criadoEm: "ontem" }).success).toBe(false);
  });
});
