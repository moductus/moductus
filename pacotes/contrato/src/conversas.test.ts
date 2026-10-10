import { describe, expect, test } from "vitest";
import {
  Conversa,
  FalaParcial,
  Mensagem,
  PaginaMensagens,
  PedidoAbrirConversa,
  PedidoApagarConversa,
  PedidoEnviar,
  ResultadoEnviar,
} from "./conversas.ts";
import { METODOS } from "./metodos.ts";

const time = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0ER",
  tipo: "time",
  agenteId: null,
  titulo: null,
  arquivada: false,
  criadoEm: "2026-10-09T12:00:00.000Z",
};

const doUsuario = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0ES",
  conversaId: time.id,
  agenteId: null,
  conteudo: "separa os comprovantes de setembro e lança tudo",
  execucaoId: null,
  falhaDoProvedor: null,
  criadoEm: "2026-10-09T12:00:01.000Z",
};

describe("conversa", () => {
  test("com o time e com um agente", () => {
    expect(Conversa.safeParse(time).success).toBe(true);
    expect(Conversa.safeParse({ ...time, tipo: "agente", agenteId: "tula" }).success).toBe(true);
    expect(Conversa.safeParse({ ...time, tipo: "grupo" }).success).toBe(false);
  });

  test("abrir a do time ou a de um agente", () => {
    expect(PedidoAbrirConversa.safeParse({}).success).toBe(true);
    expect(PedidoAbrirConversa.safeParse({ agenteId: "nuno" }).success).toBe(true);
    expect(PedidoAbrirConversa.safeParse({ agenteId: "" }).success).toBe(false);
  });

  test("apagar pede a conversa e devolve a lista que ficou", () => {
    expect(PedidoApagarConversa.safeParse({ id: time.id }).success).toBe(true);
    expect(PedidoApagarConversa.safeParse({}).success).toBe(false);
    expect(METODOS["conversas.apagar"].saida.safeParse([time]).success).toBe(true);
  });
});

describe("mensagem", () => {
  test("do usuário e do agente, em página", () => {
    const daTula = {
      ...doUsuario,
      id: "01K79Z6N7Q4W3J5XG2B8C1D0ET",
      agenteId: "tula",
      execucaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EV",
    };
    expect(Mensagem.safeParse(doUsuario).success).toBe(true);
    expect(PaginaMensagens.safeParse({ itens: [doUsuario, daTula], proximo: null }).success).toBe(true);
    expect(Mensagem.safeParse({ ...doUsuario, criadoEm: null }).success).toBe(false);
    expect(Mensagem.safeParse({ ...daTula, falhaDoProvedor: "credencial" }).success).toBe(true);
    expect(Mensagem.safeParse({ ...daTula, falhaDoProvedor: "teto" }).success).toBe(false);
    expect(Mensagem.safeParse({ ...daTula, falhaDoProvedor: undefined }).success).toBe(false);
  });

  test("enviar recusa mensagem vazia e devolve quem vai responder", () => {
    expect(PedidoEnviar.safeParse({ conversaId: time.id, conteudo: "   " }).success).toBe(false);
    expect(PedidoEnviar.parse({ conversaId: time.id, conteudo: " oi " }).conteudo).toBe("oi");
    expect(ResultadoEnviar.safeParse({ mensagem: doUsuario, agentes: ["faina", "tula"] }).success).toBe(true);
    expect(ResultadoEnviar.safeParse({ mensagem: doUsuario }).success).toBe(false);
  });

  test("fala parcial leva o texto até agora e de qual execução", () => {
    const parcial = {
      conversaId: time.id,
      agenteId: "tula",
      execucaoId: "01K79Z6N7Q4W3J5XG2B8C1D0EV",
      texto: "",
    };
    expect(FalaParcial.safeParse(parcial).success).toBe(true);
    expect(FalaParcial.safeParse({ ...parcial, execucaoId: undefined }).success).toBe(false);
  });
});
