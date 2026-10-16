import { describe, expect, it } from "vitest";
import { ClienteServico, ServicoIndisponivel } from "./cliente.ts";

describe("ClienteServico", () => {
  it("sem conexão aberta, o pedido nem sai: recusa com ServicoIndisponivel", async () => {
    const cliente = new ClienteServico();
    const erro = await cliente.pedir("agentes.listar").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ServicoIndisponivel);
    expect((erro as Error).message).toBe("serviço indisponível");
  });
});
