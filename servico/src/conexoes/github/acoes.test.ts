import { describe, expect, test } from "vitest";
import { CORPO_MAXIMO, detalheDaResposta, FALA_MAXIMA, lerDetalhe, ULTIMAS_FALAS } from "./acoes.ts";
import type { ExecutorGh } from "./gh.ts";

const ALVO = { repositorio: "loja/api-pedidos", numero: 412 };

describe("detalhe de um PR ou issue", () => {
  test("PR: tamanho, decisão, verificações que falharam e as últimas falas, encurtadas", () => {
    const reviews = Array.from({ length: ULTIMAS_FALAS + 2 }, (_, i) => ({
      author: { login: `r${i}` },
      state: i === ULTIMAS_FALAS + 1 ? "CHANGES_REQUESTED" : "COMMENTED",
      body: i === ULTIMAS_FALAS + 1 ? "x".repeat(FALA_MAXIMA + 50) : `review ${i}`,
      submittedAt: "2026-10-09T10:00:00Z",
    }));
    const detalhe = detalheDaResposta(
      "pr",
      {
        number: 412,
        title: "Cancelar pedido",
        body: "a".repeat(CORPO_MAXIMO + 10),
        author: { login: "colega" },
        state: "OPEN",
        isDraft: false,
        reviewDecision: "CHANGES_REQUESTED",
        additions: 120,
        deletions: 8,
        changedFiles: 5,
        reviews,
        comments: [{ author: { login: "voce" }, body: "ok", createdAt: "2026-10-09T11:00:00Z" }],
        statusCheckRollup: [
          { __typename: "CheckRun", name: "testes", conclusion: "FAILURE", status: "COMPLETED" },
          { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
          { __typename: "StatusContext", context: "ci/deploy", state: "ERROR" },
          { __typename: "CheckRun", name: "testes", conclusion: "TIMED_OUT", status: "COMPLETED" },
          { __typename: "CheckRun", name: "build", conclusion: null, status: "IN_PROGRESS" },
        ],
        url: "https://github.com/loja/api-pedidos/pull/412",
        campoNovo: { qualquer: 1 },
      },
      ALVO,
    );
    expect(detalhe).toMatchObject({
      tipo: "pr",
      numero: 412,
      autor: "colega",
      estado: "aberto",
      rascunho: false,
      decisaoReview: "CHANGES_REQUESTED",
      adicoes: 120,
      remocoes: 8,
      arquivos: 5,
      corpoCortado: true,
      verificacoesQueFalharam: ["testes", "ci/deploy"],
    });
    if (detalhe.tipo !== "pr") throw new Error("esperava PR");
    expect(detalhe.corpo).toHaveLength(CORPO_MAXIMO);
    expect(detalhe.reviews).toHaveLength(ULTIMAS_FALAS);
    expect(detalhe.reviews[0]?.autor).toBe("r2");
    expect(detalhe.reviews.at(-1)).toMatchObject({ estado: "CHANGES_REQUESTED" });
    expect(detalhe.reviews.at(-1)?.texto).toHaveLength(FALA_MAXIMA);
    expect(detalhe.comentarios).toEqual([
      { autor: "voce", estado: null, texto: "ok", em: "2026-10-09T11:00:00Z" },
    ]);
  });

  test("issue: atribuídas e rótulos; resposta sem campo vira vazio, não erro", () => {
    expect(
      detalheDaResposta(
        "issue",
        {
          number: 31,
          title: "Bug",
          state: "CLOSED",
          assignees: [{ login: "voce" }],
          labels: [{ name: "bug" }],
        },
        { repositorio: "voce/moductus", numero: 31 },
      ),
    ).toEqual({
      tipo: "issue",
      repositorio: "voce/moductus",
      numero: 31,
      titulo: "Bug",
      autor: null,
      estado: "fechado",
      corpo: "",
      corpoCortado: false,
      comentarios: [],
      url: null,
      atribuidas: ["voce"],
      rotulos: ["bug"],
    });
    expect(() => detalheDaResposta("pr", [], ALVO)).toThrow("formato que não reconheço");
  });

  test("resposta que não é JSON vira erro legível", async () => {
    const gh: ExecutorGh = () => Promise.resolve({ codigo: 0, saida: "<html>", erro: "" });
    await expect(lerDetalhe(gh, { ...ALVO, tipo: "pr" })).rejects.toThrow("formato que não reconheço");
  });
});
