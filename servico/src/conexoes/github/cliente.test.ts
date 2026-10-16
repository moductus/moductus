import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CONSULTA, ITENS_POR_BUSCA, itensDaResposta, lerGithub } from "./cliente.ts";
import { GhAusente, type ExecutorGh, type SaidaGh } from "./gh.ts";

/** Resposta gravada da consulta, com os nomes trocados (a forma é a do GitHub em 09/10/2026). */
const RESPOSTA = readFileSync(new URL("./fixtures/resposta-graphql.json", import.meta.url), "utf8");

const gh =
  (saida: Partial<SaidaGh> | Error): ExecutorGh =>
  () =>
    saida instanceof Error
      ? Promise.reject(saida)
      : Promise.resolve({ codigo: 0, saida: "", erro: "", ...saida });

describe("itens da resposta", () => {
  test("PRs esperando seu review, seus PRs e issues atribuídas, como o GitHub mostra", () => {
    const { conta, itens } = itensDaResposta(JSON.parse(RESPOSTA));
    expect(conta).toBe("voce");
    const resumo = itens.map((i) => [`${i.repositorio}#${i.numero}`, i.meuPapel, i.precisaDeMim, i.ciEstado]);
    expect(resumo).toEqual([
      // Review pedido a você pelo nome precisa de você (o login vem com outra caixa); pedido só
      // ao seu time aparece na lista, sem pedir nada.
      ["loja/api-pedidos#412", "revisor", true, "falhou"],
      ["loja/relatorios#388", "revisor", false, null],
      // Seu PR aprovado e verde não precisa; mudanças pedidas ou CI quebrado (ERROR conta), sim.
      ["voce/moductus#12", "autor", false, "passou"],
      ["loja/api-pedidos#409", "autor", true, "rodando"],
      ["voce/site#57", "autor", true, "falhou"],
      // Issue atribuída precisa; o nó vazio (tipo que a busca não pediu) fica de fora.
      ["voce/moductus#31", "atribuido", true, null],
    ]);
    expect(itens[0]).toEqual({
      repositorio: "loja/api-pedidos",
      numero: 412,
      tipo: "pr",
      titulo: "Importação de pedidos em lote",
      autor: "colega",
      estado: "aberto",
      meuPapel: "revisor",
      precisaDeMim: true,
      ciEstado: "falhou",
      atualizadoNoGithub: "2026-10-08T10:00:00.000Z",
      url: "https://github.com/loja/api-pedidos/pull/412",
    });
    expect(itens[1]?.autor).toBeNull();
    expect(itens[5]?.tipo).toBe("issue");
  });

  test("review pedido ao time e a você: só o pedido a você precisa de você", () => {
    const resposta = JSON.parse(RESPOSTA) as { data: { revisar: { nodes: Record<string, unknown>[] } } };
    const [aVoce, aoTime] = resposta.data.revisar.nodes;
    if (!aVoce || !aoTime) throw new Error("fixture mudou");
    aoTime.reviewRequests = {
      nodes: [{ requestedReviewer: { login: "colega" } }, { requestedReviewer: {} }],
    };
    aVoce.reviewRequests = { nodes: [{ requestedReviewer: { login: "voce" } }] };
    const semPedidos = { ...aVoce, number: 500, reviewRequests: null };
    resposta.data.revisar.nodes.push(semPedidos);
    const { itens } = itensDaResposta(resposta);
    const precisa = (n: number) => itens.find((i) => i.numero === n)?.precisaDeMim;
    expect(precisa(412)).toBe(true);
    expect(precisa(388)).toBe(false);
    expect(precisa(500)).toBe(false);
    expect(CONSULTA).toContain("reviewRequests");
  });

  test("o mesmo item em duas buscas aparece uma vez, com o primeiro papel", () => {
    const resposta = JSON.parse(RESPOSTA) as {
      data: { meus: { nodes: unknown[] }; revisar: { nodes: unknown[] } };
    };
    resposta.data.meus.nodes.push({ ...(resposta.data.revisar.nodes[0] as object), title: "outro" });
    const { itens } = itensDaResposta(resposta);
    const doze = itens.filter((i) => i.repositorio === "loja/api-pedidos" && i.numero === 412);
    expect(doze).toHaveLength(1);
    expect(doze[0]?.meuPapel).toBe("revisor");
  });

  test("busca faltando ou sem usuário: recusa, para não apagar do cache o que ainda existe", () => {
    const semBusca = JSON.parse(RESPOSTA) as { data: Record<string, unknown> };
    semBusca.data.meus = null;
    expect(() => itensDaResposta(semBusca)).toThrow(/incompleta/);
    expect(() => itensDaResposta({ data: { revisar: { nodes: [] } } })).toThrow(/usuário/);
    expect(() => itensDaResposta(null)).toThrow();
  });

  test("nó sem repositório, número ou URL válida fica de fora; campo novo é ignorado", () => {
    const base = {
      number: 1,
      url: "https://github.com/a/b/issues/1",
      repository: { nameWithOwner: "a/b" },
      campoNovo: 1,
    };
    const resposta = {
      data: {
        viewer: { login: "voce" },
        revisar: { nodes: [] },
        meus: { nodes: [] },
        atribuidas: {
          nodes: [
            base,
            { ...base, number: 0 },
            { ...base, number: 2, url: "javascript:alert(1)" },
            { ...base, number: 3, repository: null },
          ],
        },
      },
    };
    const { itens } = itensDaResposta(resposta);
    expect(itens.map((i) => i.numero)).toEqual([1]);
    expect(itens[0]).toMatchObject({ titulo: "", autor: null, atualizadoNoGithub: null, estado: "aberto" });
  });
});

describe("leitura pelo gh", () => {
  test("pede as três buscas numa consulta só, pelo gh api graphql", async () => {
    const pedidos: (readonly string[])[] = [];
    const leitura = await lerGithub((args) => {
      pedidos.push(args);
      return Promise.resolve({ codigo: 0, saida: RESPOSTA, erro: "" });
    });
    expect(leitura).toMatchObject({ tipo: "ok", conta: "voce" });
    expect(pedidos).toEqual([["api", "graphql", "-f", `query=${CONSULTA}`, "-F", `n=${ITENS_POR_BUSCA}`]]);
    expect(CONSULTA).toContain("review-requested:@me");
    expect(CONSULTA).toContain("author:@me");
    expect(CONSULTA).toContain("assignee:@me");
    expect(CONSULTA).not.toMatch(/\n/);
  });

  test("sem gh, sem login ou com token vencido, a leitura diz qual dos dois", async () => {
    expect(await lerGithub(gh(new GhAusente()))).toEqual({ tipo: "sem-gh" });
    expect(
      await lerGithub(gh({ codigo: 4, erro: "To get started with GitHub CLI, please run:  gh auth login" })),
    ).toEqual({ tipo: "sem-login" });
    expect(await lerGithub(gh({ codigo: 1, erro: "gh: Bad credentials (HTTP 401)" }))).toEqual({
      tipo: "sem-login",
    });
  });

  test("sem rede ou erro do GraphQL sem dados: falhou, com o motivo do gh", async () => {
    expect(
      await lerGithub(
        gh({ codigo: 1, erro: "error connecting to api.github.com\ncheck your internet connection" }),
      ),
    ).toEqual({ tipo: "falhou", motivo: "error connecting to api.github.com" });
    expect(await lerGithub(gh({ codigo: 0, saida: "isto não é json" }))).toMatchObject({ tipo: "falhou" });
    expect(await lerGithub(gh(new Error("o gh não respondeu em 60 s")))).toEqual({
      tipo: "falhou",
      motivo: "o gh não respondeu em 60 s",
    });
  });

  test("erro do GraphQL com os dados inteiros: os dados valem", async () => {
    const comErro = JSON.stringify({ ...JSON.parse(RESPOSTA), errors: [{ message: "SAML" }] });
    const leitura = await lerGithub(gh({ codigo: 1, saida: comErro, erro: "gh: SAML" }));
    expect(leitura.tipo).toBe("ok");
  });
});
