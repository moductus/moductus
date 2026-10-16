import { describe, expect, test } from "vitest";
import { avisosPelaCasca, lerClique } from "./avisos.ts";

/** Canal de mentira: guarda os pedidos e devolve as respostas na ordem; nada chega ao Windows. */
function canal(respostas: Record<string, unknown>[]) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    canal: {
      pedir: <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
        pedidos.push(pedido);
        return Promise.resolve(respostas.shift() as T);
      },
    },
  };
}

describe("aviso do Windows pela casca", () => {
  test("mostra, retira e pergunta a tela cheia com o pedido que a casca entende", async () => {
    const { canal: c, pedidos } = canal([{ ok: true }, { ok: true }, { tela_cheia: true }]);
    const avisos = avisosPelaCasca(c);
    await avisos.mostrar({
      id: "n1",
      agente: "Nuno",
      titulo: "Claude Code pede permissão",
      corpo: "Rodar pnpm test.",
      botoes: [{ id: "permitir", rotulo: "Permitir" }],
    });
    await avisos.retirar("n1");
    expect(await avisos.telaCheia()).toBe(true);
    expect(pedidos).toEqual([
      {
        tipo: "notificacao",
        op: "mostrar",
        notificacao: "n1",
        agente: "Nuno",
        titulo: "Claude Code pede permissão",
        corpo: "Rodar pnpm test.",
        botoes: [{ id: "permitir", rotulo: "Permitir" }],
      },
      { tipo: "notificacao", op: "retirar", notificacao: "n1" },
      { tipo: "notificacao", op: "tela-cheia" },
    ]);
  });

  test("erro ou resposta sem confirmação viram exceção; tela cheia sem resposta é não", async () => {
    const { canal: c } = canal([{ erro: "aviso recusado pelo Windows" }, {}, {}]);
    const avisos = avisosPelaCasca(c);
    await expect(
      avisos.mostrar({ id: "n1", agente: null, titulo: "x", corpo: null, botoes: [] }),
    ).rejects.toThrow("aviso recusado pelo Windows");
    await expect(avisos.retirar("n1")).rejects.toThrow("não confirmou");
    expect(await avisos.telaCheia()).toBe(false);
  });

  test("clique sem notificação é ignorado; botão vazio é clique no corpo", () => {
    expect(lerClique({ tipo: "notificacao-clique", notificacao: "n1", botao: "negar" })).toEqual({
      id: "n1",
      botao: "negar",
    });
    expect(lerClique({ notificacao: "n1", botao: "" })).toEqual({ id: "n1", botao: null });
    expect(lerClique({ notificacao: "n1" })).toEqual({ id: "n1", botao: null });
    expect(lerClique({ botao: "permitir" })).toBeNull();
  });
});
