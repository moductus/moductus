import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CONSULTA, lerGithub } from "./cliente.ts";
import { executorGh, GhAusente } from "./gh.ts";

/** O executor de verdade, rodando um `gh` falso pelo próprio Node: nenhum pedido sai da máquina. */
const GH_FALSO = fileURLToPath(new URL("./fixtures/gh-falso.mjs", import.meta.url));
const falso = (modo: string, tempoMs?: number) =>
  executorGh({ comando: process.execPath, prefixo: [GH_FALSO, modo], tempoMs });

describe("executor do gh", () => {
  test("a consulta chega inteira ao programa, com aspas e espaços", async () => {
    const saida = await falso("eco")(["api", "graphql", "-f", `query=${CONSULTA}`]);
    expect(saida.codigo).toBe(0);
    expect(JSON.parse(saida.saida)).toEqual(["api", "graphql", "-f", `query=${CONSULTA}`]);
  });

  test("lê o GitHub pelo executor de verdade", async () => {
    const leitura = await lerGithub(falso("ok"));
    expect(leitura).toMatchObject({ tipo: "ok", conta: "voce" });
  });

  test("código de saída e stderr chegam como estão; sem login vira sem-login", async () => {
    const saida = await falso("sem-login")(["api", "user"]);
    expect(saida.codigo).toBe(4);
    expect(saida.erro).toContain("gh auth login");
    expect(await lerGithub(falso("sem-login"))).toEqual({ tipo: "sem-login" });
  });

  test("programa que não existe é gh ausente", async () => {
    const ausente = executorGh({ comando: "gh-que-nao-existe-moductus" });
    await expect(ausente(["--version"])).rejects.toBeInstanceOf(GhAusente);
    expect(await lerGithub(ausente)).toEqual({ tipo: "sem-gh" });
  });

  test("gh que não responde é encerrado no prazo", async () => {
    await expect(falso("dorme", 300)(["api", "user"])).rejects.toThrow(/não respondeu/);
  });
});
