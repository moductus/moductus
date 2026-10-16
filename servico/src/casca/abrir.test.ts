import { describe, expect, test, vi } from "vitest";
import { abrirPelaCasca, projetosNaCasca } from "./abrir.ts";

/** Canal de mentira: guarda os pedidos e devolve as respostas na ordem; nada chega ao Windows. */
function canal(respostas: Record<string, unknown>[]) {
  const pedidos: Record<string, unknown>[] = [];
  return {
    pedidos,
    canal: {
      pedir: <T extends Record<string, unknown>>(pedido: Record<string, unknown>) => {
        pedidos.push(pedido);
        return Promise.resolve((respostas.shift() ?? { ok: true }) as T);
      },
    },
  };
}

describe("abrir pela casca", () => {
  test("endereço, arquivo e projetos vão pelo canal com o pedido que a casca entende", async () => {
    const { canal: c, pedidos } = canal([]);
    const abrir = abrirPelaCasca(c);
    await abrir.endereco("https://accounts.google.com/o/oauth2/v2/auth?state=x");
    await abrir.arquivo("C:\\Users\\voce\\.claude\\settings.json");
    await abrir.projetos(["V:\\moductus"]);
    expect(pedidos).toEqual([
      { tipo: "abrir", op: "endereco", endereco: "https://accounts.google.com/o/oauth2/v2/auth?state=x" },
      { tipo: "abrir", op: "arquivo", caminho: "C:\\Users\\voce\\.claude\\settings.json" },
      { tipo: "abrir", op: "projetos", pastas: ["V:\\moductus"] },
    ]);
  });

  test("a recusa da casca vira exceção com o motivo; sem confirmação também", async () => {
    const { canal: c } = canal([{ erro: "só endereço https:// abre no navegador" }, {}]);
    const abrir = abrirPelaCasca(c);
    await expect(abrir.endereco("http://github.com")).rejects.toThrow("só endereço https://");
    await expect(abrir.arquivo("C:\\x.txt")).rejects.toThrow("não confirmou");
  });
});

describe("projetos na casca", () => {
  test("manda ao subir e de novo só quando chega projeto que a casca não tem", async () => {
    const enviados: (readonly string[])[] = [];
    let vivos = [{ id: "p1", caminho: "V:\\moductus" }];
    const projetos = projetosNaCasca(
      {
        projetos: (pastas) => {
          enviados.push(pastas);
          return Promise.resolve();
        },
      },
      () => vivos,
    );
    projetos.mandar();
    projetos.aoMudarSessao("p1");
    projetos.aoMudarSessao(null);
    expect(enviados).toEqual([["V:\\moductus"]]);
    vivos = [...vivos, { id: "p2", caminho: "V:\\portfolio" }];
    projetos.aoMudarSessao("p2");
    projetos.aoMudarSessao("p2");
    expect(enviados).toEqual([["V:\\moductus"], ["V:\\moductus", "V:\\portfolio"]]);
  });

  test("a casca fora do ar não derruba quem mandou: a falha vai ao log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const projetos = projetosNaCasca({ projetos: () => Promise.reject(new Error("sem casca")) }, () => [
      { id: "p1", caminho: "V:\\moductus" },
    ]);
    expect(() => projetos.mandar()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sem casca"));
    log.mockRestore();
  });
});
