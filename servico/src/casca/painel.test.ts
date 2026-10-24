import { describe, expect, test } from "vitest";
import { painelPelaCasca } from "./painel.ts";

/** Canal de mentira: guarda os pedidos e devolve as respostas na ordem; nada chega ao Windows. */
function canal(respostas: Record<string, unknown>[]) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    canal: {
      pedir: <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
        pedidos.push(pedido);
        return Promise.resolve((respostas.shift() ?? {}) as T);
      },
    },
  };
}

describe("painel pela casca", () => {
  test("mostrar e perguntar vão pelo canal com o pedido que a casca entende", async () => {
    const { canal: c, pedidos } = canal([{ ok: true }, { aberto: true }]);
    const painel = painelPelaCasca(c);
    expect(await painel.mostrar("hoje")).toBe(true);
    expect(await painel.aberto("hoje")).toBe(true);
    expect(pedidos).toEqual([
      { tipo: "painel", op: "mostrar", area: "hoje" },
      { tipo: "painel", op: "aberto", area: "hoje" },
    ]);
  });

  test("em tela cheia não mostra; resposta sem campo é fechado; recusa vira exceção", async () => {
    const { canal: c } = canal([
      { ok: false, tela_cheia: true },
      {},
      { erro: "o serviço não abre o painel em x" },
    ]);
    const painel = painelPelaCasca(c);
    expect(await painel.mostrar("hoje")).toBe(false);
    expect(await painel.aberto("hoje")).toBe(false);
    await expect(painel.mostrar("hoje")).rejects.toThrow("não abre o painel");
  });
});
