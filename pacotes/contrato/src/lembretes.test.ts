import { describe, expect, test } from "vitest";
import {
  CanalLembrete,
  EstadoLembrete,
  Lembrete,
  LembretesDeHoje,
  MudancaLembretes,
  NovoLembrete,
  PedidoAdiarLembretes,
  PedidoLembretes,
} from "./lembretes.ts";
import { METODOS } from "./metodos.ts";

const lembrete = {
  id: "01K7A0000000000000000000L1",
  texto: "Ligar para o contador",
  quando: "2026-10-08T17:45:00.000Z",
  recorrencia: null,
  tarefaId: "01K7A0000000000000000000T1",
  eventoId: null,
  estado: "agendado",
  disparadoEm: null,
  adiadoAte: null,
  canal: "windows",
  origem: "usuario",
  agenteId: null,
  execucaoId: null,
  criadoEm: "2026-10-08T12:00:00.000Z",
  atualizadoEm: "2026-10-08T12:00:00.000Z",
};

describe("lembretes", () => {
  test("a mudança pode trazer o quando de antes dos que mudaram de horário", () => {
    expect(MudancaLembretes.safeParse({ lembretes: [lembrete], removidos: [] }).success).toBe(true);
    const comAnteriores = {
      lembretes: [lembrete],
      removidos: [],
      anteriores: [{ id: lembrete.id, quando: "2026-10-08T17:30:00.000Z" }],
    };
    expect(MudancaLembretes.parse(comAnteriores)).toEqual(comAnteriores);
    expect(MudancaLembretes.safeParse({ ...comAnteriores, anteriores: [{ id: lembrete.id }] }).success).toBe(
      false,
    );
  });

  test("estados e canais são os da migração 013", () => {
    expect(EstadoLembrete.options).toEqual(["agendado", "disparado", "adiado", "perdido"]);
    expect(CanalLembrete.options).toEqual(["dock", "windows", "calendario"]);
  });

  test("lembrete agendado passa; adiado pede até quando e disparado, a hora do disparo", () => {
    expect(Lembrete.parse(lembrete)).toEqual(lembrete);
    expect(Lembrete.safeParse({ ...lembrete, estado: "adiado" }).success).toBe(false);
    expect(
      Lembrete.safeParse({ ...lembrete, estado: "adiado", adiadoAte: "2026-10-08T17:55:00.000Z" }).success,
    ).toBe(true);
    expect(Lembrete.safeParse({ ...lembrete, adiadoAte: "2026-10-08T17:55:00.000Z" }).success).toBe(false);
    expect(Lembrete.safeParse({ ...lembrete, estado: "disparado" }).success).toBe(false);
    expect(Lembrete.safeParse({ ...lembrete, quando: "amanhã 15h" }).success).toBe(false);
  });

  test("novo pede texto e quando; adiar pede minutos entre 1 e um dia", () => {
    expect(NovoLembrete.safeParse({ texto: "Beber água", quando: lembrete.quando }).success).toBe(true);
    expect(NovoLembrete.safeParse({ texto: "Beber água" }).success).toBe(false);
    // O instante vai como o banco guarda, com milissegundos.
    expect(NovoLembrete.safeParse({ texto: "Beber água", quando: "2026-10-09T18:00:00Z" }).success).toBe(
      false,
    );
    expect(
      METODOS["lembretes.definir"].entrada.safeParse({ id: "l", quando: "2026-10-09T18:00Z" }).success,
    ).toBe(false);
    expect(METODOS["lembretes.listar"].entrada.safeParse({ de: "2026-10-09T00:00:00Z" }).success).toBe(false);
    expect(PedidoAdiarLembretes.safeParse({ ids: ["a", "b"], minutos: 30 }).success).toBe(true);
    expect(PedidoAdiarLembretes.safeParse({ ids: ["a"], minutos: 0 }).success).toBe(false);
    expect(PedidoLembretes.safeParse({ ids: [] }).success).toBe(false);
  });

  test("adiar e concluir levam a ocorrência que estava tocando, só para um lembrete", () => {
    const quando = "2026-10-08T17:45:00.000Z";
    expect(PedidoAdiarLembretes.safeParse({ ids: ["a"], minutos: 10, quando }).success).toBe(true);
    expect(PedidoAdiarLembretes.safeParse({ ids: ["a", "b"], minutos: 10, quando }).success).toBe(false);
    expect(METODOS["lembretes.concluir"].entrada.safeParse({ ids: ["a"], quando }).success).toBe(true);
    expect(METODOS["lembretes.concluir"].entrada.safeParse({ ids: ["a", "b"], quando }).success).toBe(false);
    expect(METODOS["lembretes.concluir"].entrada.safeParse({ ids: ["a", "b"] }).success).toBe(true);
    // Como o banco guarda: com milissegundos e Z.
    expect(
      PedidoAdiarLembretes.safeParse({ ids: ["a"], minutos: 10, quando: "2026-10-08T17:45Z" }).success,
    ).toBe(false);
  });

  test("o painel Hoje traz o que chega, o que toca e os atrasados com a ausência", () => {
    const perdido = { ...lembrete, estado: "perdido" };
    const hoje = {
      chegando: lembrete,
      tocando: [],
      atrasados: [perdido, perdido],
      ausencia: { de: "2026-10-08T17:20:00.000Z", ate: "2026-10-08T19:05:00.000Z" },
    };
    expect(LembretesDeHoje.parse(hoje)).toEqual(hoje);
    expect(
      LembretesDeHoje.safeParse({ ...hoje, ausencia: { de: hoje.ausencia.ate, ate: hoje.ausencia.de } })
        .success,
    ).toBe(false);
    expect(METODOS["lembretes.concluir"].saida.safeParse({ lembretes: [], removidos: ["x"] }).success).toBe(
      true,
    );
  });
});
