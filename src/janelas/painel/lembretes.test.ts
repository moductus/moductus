import { describe, expect, it } from "vitest";
import {
  acoesDosAtrasados,
  contextoDoTocando,
  falaDosAtrasados,
  horaDoLembrete,
  linhaDoChegando,
  metaDaAusencia,
  tarefaDoLembrete,
} from "./lembretes.ts";
import { lembrete, tarefa } from "../../teste/dia.ts";

const SP = "America/Sao_Paulo";

describe("o lembrete no painel Hoje", () => {
  const contador = tarefa("t1", { titulo: "Ligar para o contador", hora: "15:00", lembreteMinutosAntes: 15 });

  it("chegando diz a hora do lembrete e a da tarefa ligada; adiado, a hora do adiamento", () => {
    const l = lembrete("l1", { tarefaId: "t1" });
    expect(tarefaDoLembrete(l, [contador])).toBe(contador);
    expect(linhaDoChegando(l, contador, SP)).toBe("lembrete às 14:45 · tarefa às 15:00");
    expect(linhaDoChegando(lembrete("l2"), null, SP)).toBe("lembrete às 14:45");
    const adiado = lembrete("l3", { estado: "adiado", adiadoAte: "2026-10-08T17:55:00.000Z" });
    expect(horaDoLembrete(adiado)).toBe("2026-10-08T17:55:00.000Z");
    expect(linhaDoChegando(adiado, null, SP)).toBe("lembrete às 14:55");
  });

  it("tocando diz de onde vem e quem criou, como o aviso do Windows", () => {
    const l = lembrete("l1", { tarefaId: "t1" });
    expect(contextoDoTocando(l, contador, "2026-10-08")).toBe("Tarefa de hoje às 15:00 · você");
    expect(contextoDoTocando(l, contador, "2026-10-07")).toBe("Tarefa de qui, 8 out às 15:00 · você");
    expect(
      contextoDoTocando(lembrete("l2", { origem: "agente", agenteId: "alba" }), null, "2026-10-08"),
    ).toBe("Alba");
    expect(contextoDoTocando(lembrete("l3", { origem: "conexao" }), null, "2026-10-08")).toBeNull();
  });

  it("os atrasados: a fala da Alba com o tempo suspenso e quantos passaram", () => {
    const ausencia = { de: "2026-10-08T17:20:00.000Z", ate: "2026-10-08T19:05:00.000Z" };
    expect(metaDaAusencia(ausencia, SP)).toBe("PC suspenso 14:20–16:05");
    expect(falaDosAtrasados(2, ausencia)).toBe(
      "O PC ficou suspenso por 1h45 e 2 lembretes passaram nesse tempo. Seguem aqui até você decidir.",
    );
    expect(falaDosAtrasados(1, null)).toBe("1 lembrete passou da hora. Segue aqui até você decidir.");
  });

  it("as ações em grupo dizem quantos e quanto", () => {
    expect(acoesDosAtrasados(2, 30)).toEqual({ adiar: "Adiar os 2 em 30 min", concluir: "Concluir os 2" });
    expect(acoesDosAtrasados(1, 30)).toEqual({ adiar: "Adiar 30 min", concluir: "Concluir o lembrete" });
  });
});
