import { describe, expect, test } from "vitest";
import { credenciaisPelaCasca, type Credenciais } from "../casca/credenciais.ts";
import { CREDENCIAL_HOOKS, tokenDosHooks } from "./token.ts";

/** Cofre em memória no lugar do Gerenciador de Credenciais. */
function cofre(inicial: Record<string, string> = {}) {
  const valores = new Map(Object.entries(inicial));
  const credenciais: Credenciais = {
    ler: (nome) => Promise.resolve(valores.get(nome) ?? null),
    guardar: (nome, valor) => {
      valores.set(nome, valor);
      return Promise.resolve();
    },
  };
  return { credenciais, valores };
}

describe("token dos hooks", () => {
  test("primeira subida sorteia e guarda; as próximas usam o mesmo", async () => {
    const { credenciais, valores } = cofre();
    const primeiro = await tokenDosHooks(credenciais);
    expect(primeiro).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(valores.get(CREDENCIAL_HOOKS)).toBe(primeiro);
    await expect(tokenDosHooks(credenciais, () => "outro")).resolves.toBe(primeiro);
  });

  test("dois sorteios não se repetem", async () => {
    const a = await tokenDosHooks(cofre().credenciais);
    const b = await tokenDosHooks(cofre().credenciais);
    expect(a).not.toBe(b);
  });
});

describe("credenciais pela casca", () => {
  test("lê e guarda pelo canal, com o pedido que a casca entende", async () => {
    const pedidos: Record<string, unknown>[] = [];
    const respostas: Record<string, unknown>[] = [{ valor: null }, { ok: true }, { valor: "guardado" }];
    const canal = {
      pedir: <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
        pedidos.push(pedido);
        return Promise.resolve(respostas.shift() as T);
      },
    };
    const credenciais = credenciaisPelaCasca(canal);
    await expect(credenciais.ler("hooks")).resolves.toBeNull();
    await credenciais.guardar("hooks", "segredo");
    await expect(credenciais.ler("hooks")).resolves.toBe("guardado");
    expect(pedidos).toEqual([
      { tipo: "credencial", op: "ler", nome: "hooks" },
      { tipo: "credencial", op: "guardar", nome: "hooks", valor: "segredo" },
      { tipo: "credencial", op: "ler", nome: "hooks" },
    ]);
  });

  test("erro da casca vira exceção, sem token sorteado no lugar", async () => {
    const canal = {
      pedir: <T extends Record<string, unknown>>() =>
        Promise.resolve({ erro: "cofre trancado" } as unknown as T),
    };
    await expect(tokenDosHooks(credenciaisPelaCasca(canal))).rejects.toThrow("cofre trancado");
  });
});
