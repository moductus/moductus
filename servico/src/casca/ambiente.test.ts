import { describe, expect, test } from "vitest";
import { ambientePelaCasca } from "./ambiente.ts";

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

describe("ambiente do usuário pela casca", () => {
  test("define e apaga pelo canal, com o pedido que a casca entende", async () => {
    const { canal: c, pedidos } = canal([{ ok: true }, { ok: true }]);
    const ambiente = ambientePelaCasca(c);
    await ambiente.definir("MODUCTUS_HOOKS_TOKEN", "segredo");
    await ambiente.apagar("MODUCTUS_HOOKS_TOKEN");
    expect(pedidos).toEqual([
      { tipo: "ambiente", op: "definir", nome: "MODUCTUS_HOOKS_TOKEN", valor: "segredo" },
      { tipo: "ambiente", op: "apagar", nome: "MODUCTUS_HOOKS_TOKEN" },
    ]);
  });

  test("erro ou resposta sem confirmação viram exceção", async () => {
    const { canal: c } = canal([{ erro: "nome fora do Moductus" }, {}]);
    const ambiente = ambientePelaCasca(c);
    await expect(ambiente.definir("PATH", "x")).rejects.toThrow("nome fora do Moductus");
    await expect(ambiente.apagar("MODUCTUS_HOOKS_TOKEN")).rejects.toThrow("não confirmou");
  });
});
