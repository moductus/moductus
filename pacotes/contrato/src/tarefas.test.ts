import { describe, expect, test } from "vitest";
import { METODOS } from "./metodos.ts";
import {
  LISTA_ENTRADA,
  LISTAS_PADRAO,
  Lista,
  MudancaTarefa,
  MudancaTarefas,
  NovaTarefa,
  PedidoAdiarTarefas,
  PedidoMoverTarefa,
  PedidoTarefas,
  Tarefa,
} from "./tarefas.ts";

const tarefa = {
  id: "01K7A0000000000000000000T1",
  listaId: "pessoal",
  tarefaPaiId: null,
  titulo: "Ligar pro banco",
  notas: null,
  notaId: null,
  prioridade: 0,
  venceEm: "2026-10-09",
  hora: "15:00",
  duracaoEstimadaMin: null,
  recorrencia: null,
  estado: "aberta",
  concluidaEm: null,
  ordem: 0,
  etiquetas: [{ id: "01K7A0000000000000000000E1", nome: "casa" }],
  lembreteMinutosAntes: 15,
  origem: "agente",
  agenteId: "alba",
  execucaoId: "01K7A0000000000000000000X1",
  criadoEm: "2026-10-08T12:00:00.000Z",
  atualizadoEm: "2026-10-08T12:00:00.000Z",
};

describe("listas", () => {
  test("as três padrão têm o id da migração 013, e a Entrada recebe o que vem sem lista", () => {
    expect(LISTAS_PADRAO).toEqual(["entrada", "trabalho", "pessoal"]);
    expect(LISTA_ENTRADA).toBe("entrada");
  });

  test("lista sem nome é recusada", () => {
    const lista = { id: "entrada", nome: "Entrada", ordem: 0, cor: null, arquivada: false };
    expect(Lista.parse(lista)).toEqual(lista);
    expect(Lista.safeParse({ ...lista, nome: " " }).success).toBe(false);
  });
});

describe("tarefas", () => {
  test("tarefa completa passa, com o carimbo de quem criou", () => {
    expect(Tarefa.parse(tarefa)).toEqual(tarefa);
  });

  test("hora sem dia, prioridade fora de 0 a 3 e conclusão fora do estado feita são recusadas", () => {
    expect(Tarefa.safeParse({ ...tarefa, venceEm: null }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, hora: "15h" }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, prioridade: 4 }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, concluidaEm: "2026-10-09T15:10:00.000Z" }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, estado: "feita" }).success).toBe(false);
    expect(
      Tarefa.safeParse({ ...tarefa, estado: "feita", concluidaEm: "2026-10-09T15:10:00.000Z" }).success,
    ).toBe(true);
    expect(Tarefa.safeParse({ ...tarefa, origem: "robo" }).success).toBe(false);
  });

  test("como o banco: aberta sem data de conclusão, feita com, cancelada com ou sem", () => {
    const concluidaEm = "2026-10-09T15:10:00.000Z";
    expect(Tarefa.safeParse({ ...tarefa, estado: "aberta", concluidaEm }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, estado: "feita", concluidaEm: null }).success).toBe(false);
    expect(Tarefa.safeParse({ ...tarefa, estado: "cancelada", concluidaEm: null }).success).toBe(true);
    expect(Tarefa.safeParse({ ...tarefa, estado: "cancelada", concluidaEm }).success).toBe(true);
  });

  test("nova tarefa só exige o título; hora pede o dia", () => {
    expect(NovaTarefa.parse({ titulo: "Comprar pão" })).toEqual({ titulo: "Comprar pão" });
    expect(NovaTarefa.safeParse({}).success).toBe(false);
    expect(NovaTarefa.safeParse({ titulo: "Ligar", hora: "15:00" }).success).toBe(false);
    expect(NovaTarefa.safeParse({ titulo: "Ligar", venceEm: "2026-10-09", hora: "15:00" }).success).toBe(
      true,
    );
    expect(NovaTarefa.safeParse({ titulo: "Ligar", etiquetas: [" "] }).success).toBe(false);
  });

  test("mudança parcial: tirar o dia e pôr hora no mesmo pedido é recusado", () => {
    expect(MudancaTarefa.safeParse({ id: "x", titulo: "Novo" }).success).toBe(true);
    expect(MudancaTarefa.safeParse({ id: "x", venceEm: null, hora: null }).success).toBe(true);
    expect(MudancaTarefa.safeParse({ id: "x", venceEm: null, hora: "09:00" }).success).toBe(false);
    expect(MudancaTarefa.safeParse({ titulo: "Sem id" }).success).toBe(false);
    // Lista e mãe mudam por tarefas.mover.
    expect(MudancaTarefa.parse({ id: "x", listaId: "trabalho" })).toEqual({ id: "x" });
  });

  test("adiar aceita um dia ou hoje e amanhã, que o serviço resolve no fuso do usuário", () => {
    expect(PedidoAdiarTarefas.safeParse({ ids: ["a"], para: "amanha" }).success).toBe(true);
    expect(PedidoAdiarTarefas.safeParse({ ids: ["a", "b"], para: "2026-10-12", hora: null }).success).toBe(
      true,
    );
    expect(PedidoAdiarTarefas.safeParse({ ids: [], para: "hoje" }).success).toBe(false);
    expect(PedidoAdiarTarefas.safeParse({ ids: ["a"], para: "semana que vem" }).success).toBe(false);
  });

  test("vistas e mover", () => {
    expect(PedidoTarefas.safeParse({ vista: "hoje" }).success).toBe(true);
    expect(PedidoTarefas.safeParse({ vista: "ontem" }).success).toBe(false);
    expect(PedidoMoverTarefa.safeParse({ id: "x", tarefaPaiId: null }).success).toBe(true);
  });

  test("os métodos devolvem a forma que a interface espera", () => {
    expect(METODOS["tarefas.concluir"].saida.safeParse({ tarefa, proxima: null }).success).toBe(true);
    expect(METODOS["tarefas.apagar"].saida.safeParse({ ids: [tarefa.id] }).success).toBe(true);
    expect(MudancaTarefas.safeParse({ tarefas: [tarefa], apagadas: [] }).success).toBe(true);
    expect(METODOS["listas.listar"].entrada.safeParse(undefined).success).toBe(true);
  });
});
