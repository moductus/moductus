import type { Agente, Execucao, Provedor, SituacaoAgente } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  contarDeHoje,
  descreverProvedor,
  estadoDoProvedor,
  execucoesEmTexto,
  falaDaTroca,
  temChaveTrocavel,
  escolhaInicial,
  mudancaDoPainel,
} from "./modelos.ts";

const AGORA = new Date(2026, 9, 10, 14, 5);

const provedor = (mudar: Partial<Provedor> = {}): Provedor => ({
  id: "p1",
  tipo: "claude-cli",
  nome: "Claude Code",
  modelo: null,
  baseUrl: null,
  temChave: false,
  testadoEm: null,
  ...mudar,
});

const SITUACAO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const agente = (mudar: Partial<Agente> = {}, situacao: Partial<SituacaoAgente> = {}): Agente => ({
  id: "nuno",
  nome: "Nuno",
  funcao: "x",
  instrucoes: "",
  personagem: { silhueta: "capsula", traco: "fones", tom: "ardosia" },
  ferramentas: [],
  provedorId: "p1",
  provedorReservaId: null,
  gatilhos: [],
  escoposMemoria: [],
  tetoDiarioCentavos: null,
  deFabrica: true,
  situacao: { ...SITUACAO, ...situacao },
  ...mudar,
});

describe("estado do provedor", () => {
  it("o teste desta tela vem primeiro: rodando, passou com a latência, falhou com a mensagem", () => {
    const p = provedor({ testadoEm: new Date(2026, 9, 10, 14, 2).toISOString() });
    expect(estadoDoProvedor(p, { fase: "testando" }, [], AGORA)).toMatchObject({
      texto: "testando",
      resposta: "…",
    });
    expect(
      estadoDoProvedor(p, { fase: "ok", latenciaMs: 2100, testadoEm: AGORA.toISOString() }, [], AGORA),
    ).toEqual({
      texto: "funcionando",
      tom: "sucesso",
      resposta: "2,1 s",
      quando: "testado agora",
      erro: null,
    });
    const falhou = estadoDoProvedor(
      p,
      {
        fase: "falhou",
        falha: { motivo: "credencial", mensagem: "A chave foi recusada (401).", voltaEm: null },
        testadoEm: new Date(2026, 9, 10, 14, 2).toISOString(),
      },
      [],
      AGORA,
    );
    expect(falhou).toEqual({
      texto: "erro",
      tom: "perigo",
      resposta: "—",
      quando: "falhou às 14:02",
      erro: "A chave foi recusada (401).",
    });
  });

  it("sem teste aqui: o agente que dorme porque o principal falhou marca o erro, sem número inventado", () => {
    const p = provedor({ testadoEm: new Date(2026, 9, 10, 14, 2).toISOString() });
    const caiu = agente({}, { estado: "dormindo", motivoSono: "credencial" });
    // CLI recusado é login, não chave: diz o comando para entrar.
    expect(estadoDoProvedor(p, undefined, [caiu], AGORA)).toMatchObject({
      texto: "erro",
      resposta: "—",
      erro: "O Claude Code está sem login. Entre no terminal com o comando abaixo e teste de novo.",
      comando: "claude",
    });
    const api = provedor({ tipo: "openai", nome: "OpenAI", temChave: true });
    const daApi = estadoDoProvedor(api, undefined, [caiu], AGORA);
    expect(daApi).toMatchObject({
      texto: "erro",
      erro: "A chave foi recusada na última execução. Troque a chave e teste de novo.",
    });
    expect(daApi.comando).toBeUndefined();
    // Limite de uso é sono tranquilo, não erro do provedor.
    const limite = agente({}, { estado: "dormindo", motivoSono: "limite" });
    expect(estadoDoProvedor(p, undefined, [limite], AGORA)).toEqual({
      texto: "funcionando",
      tom: "sucesso",
      resposta: "—",
      quando: "testado há 3 min",
      erro: null,
    });
    expect(estadoDoProvedor(provedor(), undefined, [], AGORA)).toMatchObject({
      texto: "não testado",
      tom: "apagado",
    });
  });
});

describe("descrição e chave", () => {
  it("diz o tipo, o host (nunca o endereço inteiro), o modelo e onde está a chave", () => {
    expect(descreverProvedor(provedor())).toBe("CLI · sua assinatura");
    expect(
      descreverProvedor(provedor(), {
        tipo: "claude-cli",
        caminho: "c",
        versao: "2.4",
        logado: true,
        impedimento: null,
        versaoMinima: null,
      }),
    ).toBe("CLI · sua assinatura · versão 2.4");
    const ollama = provedor({
      tipo: "openai-compativel",
      baseUrl: "http://127.0.0.1:11434/v1?segredo=1",
      modelo: "llama3.1:8b",
    });
    expect(descreverProvedor(ollama)).toBe("Compatível com OpenAI · 127.0.0.1:11434 · llama3.1:8b");
    const openai = provedor({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5-mini", temChave: true });
    expect(descreverProvedor(openai)).toBe("OpenAI · gpt-5-mini · chave no Gerenciador de Credenciais");

    expect(temChaveTrocavel(provedor())).toBe(false);
    expect(temChaveTrocavel(ollama)).toBe(false);
    expect(temChaveTrocavel({ ...ollama, temChave: true })).toBe(true);
    expect(temChaveTrocavel(openai)).toBe(true);
  });
});

describe("trocar o modelo de um agente", () => {
  it("o painel abre com a escolha da tabela; a reserva escolhida como principal troca de lugar", () => {
    const nuno = agente({ provedorId: "p1", provedorReservaId: "p2" });
    expect(escolhaInicial(nuno)).toEqual({ principal: "p1", reserva: "p2" });
    expect(escolhaInicial(nuno, { principal: "p2" })).toEqual({ principal: "p2", reserva: "p1" });
    expect(escolhaInicial(nuno, { principal: "p3" })).toEqual({ principal: "p3", reserva: "p2" });
    expect(escolhaInicial(nuno, { reserva: null })).toEqual({ principal: "p1", reserva: null });
    // A reserva nunca é o próprio principal.
    expect(escolhaInicial(nuno, { reserva: "p1" })).toEqual({ principal: "p1", reserva: null });
  });

  it("o pedido só sai quando algo mudou e há principal", () => {
    const nuno = agente({ provedorId: "p1", provedorReservaId: "p2" });
    expect(mudancaDoPainel(nuno, { principal: "p1", reserva: "p2" })).toBeNull();
    expect(mudancaDoPainel(nuno, { principal: null, reserva: null })).toBeNull();
    expect(mudancaDoPainel(nuno, { principal: "p2", reserva: "p1" })).toEqual({
      id: "nuno",
      provedorId: "p2",
      provedorReservaId: "p1",
    });
  });

  it("a fala diz que vale na próxima execução e que a de agora termina no modelo de antes", () => {
    expect(falaDaTroca("Ollama neste PC", "Claude Code")).toBe(
      "Na próxima execução eu passo a usar o Ollama neste PC. O que estou fazendo agora termina no Claude Code.",
    );
    expect(falaDaTroca("Claude Code", null)).toBe("Na próxima execução eu passo a usar o Claude Code.");
  });
});

describe("hoje", () => {
  const execucao = (inicio: Date): Execucao => ({
    id: inicio.toISOString(),
    agenteId: "nuno",
    gatilho: "mensagem",
    provedorId: "p1",
    inicio: inicio.toISOString(),
    fim: null,
    estado: "ok",
    erro: null,
    tokensEntrada: null,
    tokensSaida: null,
    custoEstimadoMicrodolares: null,
    cobranca: "assinatura",
    resumo: null,
  });

  it("conta só as que começaram depois da meia-noite local", () => {
    const lista = [new Date(2026, 9, 10, 9), new Date(2026, 9, 10, 0, 1), new Date(2026, 9, 9, 23, 59)].map(
      execucao,
    );
    expect(contarDeHoje(lista, AGORA)).toBe(2);
    expect(execucoesEmTexto(2, false)).toBe("2 execuções");
    expect(execucoesEmTexto(1, false)).toBe("1 execução");
    expect(execucoesEmTexto(0, false)).toBe("nenhuma");
    expect(execucoesEmTexto(200, true)).toBe("200 ou mais");
  });
});
