import { describe, expect, test } from "vitest";
import { FilaPorAgente } from "./fila.ts";

/** Um trabalho que só termina quando o teste manda, anotando quando começa. */
function trabalho(nome: string, ordem: string[]) {
  let terminar!: () => void;
  const fim = new Promise<void>((resolve) => (terminar = resolve));
  return {
    rodar: async () => {
      ordem.push(nome);
      await fim;
      return nome;
    },
    terminar,
  };
}

const vez = () => new Promise((resolve) => setImmediate(resolve));

describe("fila por agente", () => {
  test("o mesmo agente roda um de cada vez, na ordem de chegada, e conta quem espera", async () => {
    const avisos: string[] = [];
    const fila = new FilaPorAgente((id) => avisos.push(id));
    const ordem: string[] = [];
    const a = trabalho("a", ordem);
    const b = trabalho("b", ordem);
    const c = trabalho("c", ordem);
    const pa = fila.rodar("alba", a.rodar);
    const pb = fila.rodar("alba", b.rodar);
    const pc = fila.rodar("alba", c.rodar);
    await vez();
    expect(ordem).toEqual(["a"]);
    expect(fila.esperandoDe("alba")).toBe(2);

    a.terminar();
    expect(await pa).toBe("a");
    await vez();
    expect(ordem).toEqual(["a", "b"]);
    expect(fila.esperandoDe("alba")).toBe(1);
    b.terminar();
    c.terminar();
    expect(await Promise.all([pb, pc])).toEqual(["b", "c"]);
    expect(fila.esperandoDe("alba")).toBe(0);
    expect(avisos.every((id) => id === "alba")).toBe(true);
  });

  test("agentes diferentes não esperam um pelo outro", async () => {
    const fila = new FilaPorAgente();
    const ordem: string[] = [];
    const alba = trabalho("alba", ordem);
    const nuno = trabalho("nuno", ordem);
    const pa = fila.rodar("alba", alba.rodar);
    const pn = fila.rodar("nuno", nuno.rodar);
    await vez();
    expect(ordem).toEqual(["alba", "nuno"]);
    nuno.terminar();
    expect(await pn).toBe("nuno");
    alba.terminar();
    await pa;
  });

  test("trabalho que falha libera a vez do próximo", async () => {
    const fila = new FilaPorAgente();
    const falha = fila.rodar("alba", () => Promise.reject(new Error("quebrou")));
    const depois = fila.rodar("alba", async () => "seguiu");
    await expect(falha).rejects.toThrow("quebrou");
    expect(await depois).toBe("seguiu");
  });

  test("cancelado na espera sai sem rodar e mantém a ordem de quem fica", async () => {
    const fila = new FilaPorAgente();
    const ordem: string[] = [];
    const a = trabalho("a", ordem);
    const c = trabalho("c", ordem);
    const cancelar = new AbortController();
    const pa = fila.rodar("alba", a.rodar);
    const pb = fila.rodar("alba", async () => ordem.push("b"), cancelar.signal);
    const pc = fila.rodar("alba", c.rodar);
    cancelar.abort(new Error("desisti"));
    await expect(pb).rejects.toThrow("desisti");
    await vez();
    // O c continua atrás do a, que ainda não terminou.
    expect(ordem).toEqual(["a"]);
    a.terminar();
    c.terminar();
    await Promise.all([pa, pc]);
    expect(ordem).toEqual(["a", "c"]);
  });
});
