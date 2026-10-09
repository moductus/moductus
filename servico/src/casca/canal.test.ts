import { expect, test } from "vitest";
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

test("sem resposta, o pedido falha no prazo", async () => {
  const canal = new CanalCasca({ write: () => undefined });
  await expect(canal.pedir({ tipo: "credencial" }, 10)).rejects.toThrow("não respondeu");
});
