import { expect, test, vi } from "vitest";
import { CanalCasca } from "./canal.ts";

test("pedido recebe a resposta com o mesmo id", async () => {
  const enviadas: string[] = [];
  const canal = new CanalCasca({ write: (l) => enviadas.push(l) });
  const resposta = canal.pedir({ tipo: "credencial", op: "ler", nome: "x" });
  const pedido = JSON.parse(enviadas[0]!) as { id: number };
  canal.receber(JSON.stringify({ id: pedido.id, valor: "segredo" }));
  await expect(resposta).resolves.toEqual({ id: pedido.id, valor: "segredo" });
});

test("linha inválida ou id desconhecido é ignorado", () => {
  const canal = new CanalCasca({ write: () => undefined });
  expect(() => canal.receber("não é json")).not.toThrow();
  expect(() => canal.receber(JSON.stringify({ id: 999 }))).not.toThrow();
});

test("aviso sem id vai a quem escuta o tipo, e um ouvinte que falha não cala os outros", () => {
  const canal = new CanalCasca({ write: () => undefined });
  const recebidos: string[] = [];
  canal.aoAvisar("retomou", () => {
    throw new Error("quebrou");
  });
  canal.aoAvisar("retomou", (aviso) => recebidos.push(String(aviso.tipo)));
  const erros = vi.spyOn(console, "error").mockImplementation(() => {});
  canal.receber(JSON.stringify({ tipo: "retomou" }));
  canal.receber(JSON.stringify({ tipo: "outro" }));
  expect(recebidos).toEqual(["retomou"]);
  expect(erros).toHaveBeenCalledWith(expect.stringContaining("aviso retomou da casca falhou"));
  erros.mockRestore();
});

test("sem resposta, o pedido falha no prazo", async () => {
  const canal = new CanalCasca({ write: () => undefined });
  await expect(canal.pedir({ tipo: "credencial" }, 10)).rejects.toThrow("não respondeu");
});
