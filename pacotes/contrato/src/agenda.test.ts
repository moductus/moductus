import { describe, expect, test } from "vitest";
import {
  Agenda,
  CALENDARIO_LOCAL,
  Calendario,
  EventoAgenda,
  MudancaEvento,
  NovoEvento,
  Ocorrencia,
  PedidoAgenda,
  PedidoAplicarSugestao,
  SugestaoAplicada,
} from "./agenda.ts";
import { METODOS } from "./metodos.ts";

const evento = {
  id: "01K7A0000000000000000000V1",
  calendarioId: "local",
  titulo: "Reunião com o contador",
  descricao: null,
  inicio: "2026-10-09T13:00:00.000Z",
  fim: "2026-10-09T14:00:00.000Z",
  diaInteiro: false,
  local: null,
  recorrencia: null,
  alertas: [10],
  editavel: true,
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-08T12:00:00.000Z",
  atualizadoEm: "2026-10-08T12:00:00.000Z",
};

describe("agenda", () => {
  test("o local tem o id da migração 014", () => {
    expect(CALENDARIO_LOCAL).toBe("local");
    const local = {
      id: "local",
      nome: "Local",
      fonte: "local",
      cor: null,
      espelho: false,
      podeEscrever: true,
      ler: true,
      sincronizadoEm: null,
    };
    expect(Calendario.parse(local)).toEqual(local);
    expect(Calendario.safeParse({ ...local, fonte: "icloud" }).success).toBe(false);
  });

  test("evento com hora vai em instantes; o de dia inteiro, em dias, com o fim no dia seguinte", () => {
    expect(EventoAgenda.parse(evento)).toEqual(evento);
    const diaInteiro = { ...evento, diaInteiro: true, inicio: "2026-10-09", fim: "2026-10-10" };
    expect(EventoAgenda.safeParse(diaInteiro).success).toBe(true);
    expect(EventoAgenda.safeParse({ ...diaInteiro, fim: "2026-10-09" }).success).toBe(false);
    expect(EventoAgenda.safeParse({ ...evento, inicio: "2026-10-09" }).success).toBe(false);
    expect(EventoAgenda.safeParse({ ...diaInteiro, inicio: evento.inicio }).success).toBe(false);
    expect(EventoAgenda.safeParse({ ...evento, fim: "2026-10-09T12:00:00.000Z" }).success).toBe(false);
  });

  test("alertas: até 5, de 0 a 4 semanas", () => {
    expect(EventoAgenda.safeParse({ ...evento, alertas: [0, 40320] }).success).toBe(true);
    expect(EventoAgenda.safeParse({ ...evento, alertas: [40321] }).success).toBe(false);
    expect(EventoAgenda.safeParse({ ...evento, alertas: [1, 2, 3, 4, 5, 6] }).success).toBe(false);
  });

  test("novo e mudança: início, fim e dia inteiro andam juntos", () => {
    const { inicio, fim } = evento;
    expect(NovoEvento.safeParse({ titulo: "Dentista", inicio, fim, diaInteiro: false }).success).toBe(true);
    expect(NovoEvento.safeParse({ titulo: "Dentista", inicio, diaInteiro: false }).success).toBe(false);
    expect(MudancaEvento.safeParse({ id: "x", titulo: "Outro" }).success).toBe(true);
    expect(MudancaEvento.safeParse({ id: "x", inicio }).success).toBe(false);
    expect(MudancaEvento.safeParse({ id: "x", inicio, fim, diaInteiro: false }).success).toBe(true);
  });

  test("a mudança pode trocar o calendário, sozinha ou com outros campos; vazio não é calendário", () => {
    expect(MudancaEvento.parse({ id: "x", calendarioId: "local" })).toEqual({
      id: "x",
      calendarioId: "local",
    });
    expect(MudancaEvento.safeParse({ id: "x", calendarioId: "m", titulo: "Dentista" }).success).toBe(true);
    expect(MudancaEvento.safeParse({ id: "x", calendarioId: "" }).success).toBe(false);
    expect(MudancaEvento.safeParse({ id: "x", calendarioId: null }).success).toBe(false);
  });

  test("o intervalo vai de um dia a outro, até 62 dias", () => {
    expect(PedidoAgenda.safeParse({ de: "2026-10-01", ate: "2026-10-31" }).success).toBe(true);
    expect(PedidoAgenda.safeParse({ de: "2026-10-09", ate: "2026-10-08" }).success).toBe(false);
    expect(PedidoAgenda.safeParse({ de: "2026-10-01", ate: "2026-12-01" }).success).toBe(true);
    expect(PedidoAgenda.safeParse({ de: "2026-10-01", ate: "2026-12-02" }).success).toBe(false);
  });

  test("a agenda traz as ocorrências e o dia com o livre e o planejado", () => {
    const agenda = {
      ocorrencias: [
        {
          eventoId: evento.id,
          calendarioId: "local",
          titulo: evento.titulo,
          inicio: evento.inicio,
          fim: evento.fim,
          diaInteiro: false,
          local: null,
          recorrente: false,
          editavel: true,
        },
      ],
      dias: [
        {
          dia: "2026-10-09",
          livres: [{ inicio: "2026-10-09T19:00:00.000Z", fim: "2026-10-09T20:30:00.000Z", minutos: 90 }],
          livreMin: 300,
          planejadoMin: 420,
          cheio: true,
          sugestoes: [
            {
              tarefaId: "01K7A0000000000000000000T1",
              inicio: "2026-10-09T19:00:00.000Z",
              fim: "2026-10-09T20:00:00.000Z",
            },
          ],
        },
      ],
    };
    expect(Agenda.parse(agenda)).toEqual(agenda);
    expect(METODOS["agenda.consultar"].saida.safeParse(agenda).success).toBe(true);
    const [dia] = agenda.dias;
    expect(Agenda.safeParse({ ...agenda, dias: [{ ...dia, sugestoes: undefined }] }).success).toBe(false);
    const sugestao = dia!.sugestoes[0]!;
    expect(
      Agenda.safeParse({ ...agenda, dias: [{ ...dia, sugestoes: [{ ...sugestao, fim: sugestao.inicio }] }] })
        .success,
    ).toBe(false);
  });

  test("aplicar o encaixe devolve o evento e a chamada que o desfaz", () => {
    const pedido = { tarefaId: "01K7A0000000000000000000T1", inicio: evento.inicio, fim: evento.fim };
    expect(METODOS["agenda.aplicarSugestao"].entrada.parse(pedido)).toEqual(pedido);
    expect(PedidoAplicarSugestao.safeParse({ ...pedido, fim: evento.inicio }).success).toBe(false);
    const aplicada = {
      evento,
      chamadaId: "01K7A0000000000000000000C1",
      desfazerAte: "2026-10-10T12:00:00.000Z",
    };
    expect(SugestaoAplicada.parse(aplicada)).toEqual(aplicada);
    expect(METODOS["agenda.aplicarSugestao"].saida.safeParse({ evento }).success).toBe(false);
  });

  test("instante de entrada vai com milissegundos; a saída aceita sem", () => {
    const semMs = "2026-10-09T13:00:00Z";
    const { inicio, fim } = evento;
    expect(NovoEvento.safeParse({ titulo: "Dentista", inicio: semMs, fim, diaInteiro: false }).success).toBe(
      false,
    );
    expect(
      MudancaEvento.safeParse({ id: "x", inicio, fim: "2026-10-09T14:00Z", diaInteiro: false }).success,
    ).toBe(false);
    expect(
      PedidoAplicarSugestao.safeParse({ tarefaId: "t", inicio: semMs, fim: "2026-10-09T14:00:00.000Z" })
        .success,
    ).toBe(false);
    expect(EventoAgenda.safeParse({ ...evento, inicio: semMs }).success).toBe(true);
  });

  test("evento lido sem título passa na saída; criar e mudar exigem texto", () => {
    expect(EventoAgenda.safeParse({ ...evento, titulo: "" }).success).toBe(true);
    const ocorrencia = {
      eventoId: evento.id,
      calendarioId: "google-primario",
      titulo: "",
      inicio: evento.inicio,
      fim: evento.fim,
      diaInteiro: false,
      local: null,
      recorrente: false,
      editavel: false,
    };
    expect(Ocorrencia.safeParse(ocorrencia).success).toBe(true);
    const { inicio, fim } = evento;
    expect(NovoEvento.safeParse({ titulo: " ", inicio, fim, diaInteiro: false }).success).toBe(false);
    expect(MudancaEvento.safeParse({ id: "x", titulo: "" }).success).toBe(false);
  });
});
