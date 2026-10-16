import type { ItemGithub } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import { colunasDoGithub, falaDoNuno, metaDoItem, seloDoItem, situacaoDaLeitura } from "./dev.ts";

const AGORA = new Date("2026-10-09T14:00:00.000Z");

let seq = 0;
const item = (extra: Partial<ItemGithub> = {}): ItemGithub => ({
  id: `i${++seq}`,
  repositorio: "gustavo/api-pedidos",
  numero: 412,
  tipo: "pr",
  titulo: "Importação de pedidos em lote",
  autor: "ana",
  estado: "aberto",
  meuPapel: "revisor",
  precisaDeMim: true,
  ciEstado: null,
  atualizadoNoGithub: "2026-10-08T12:00:00.000Z",
  url: "https://github.com/gustavo/api-pedidos/pull/412",
  ...extra,
});

describe("colunas", () => {
  it("separa review, seus PRs e o que foi atribuído; fechado e mesclado ficam de fora", () => {
    const itens = [
      item({ id: "r" }),
      item({ id: "m", meuPapel: "autor" }),
      item({ id: "a", tipo: "issue", meuPapel: "atribuido" }),
      item({ id: "x", meuPapel: "autor", estado: "mesclado" }),
      item({ id: "f", tipo: "issue", meuPapel: "atribuido", estado: "fechado" }),
    ];
    expect(colunasDoGithub(itens).map((c) => [c.nome, c.itens.map((i) => i.id)])).toEqual([
      ["Esperando seu review", ["r"]],
      ["Seus PRs", ["m"]],
      ["Issues para você", ["a"]],
    ]);
  });

  it("a contagem do review só chama atenção quando tem item", () => {
    expect(colunasDoGithub([])[0]!.tom).toBe("neutro");
    expect(colunasDoGithub([item()])[0]!.tom).toBe("aviso");
  });
});

describe("selo e linha do cartão", () => {
  it("review pedido a você chama; pedido ao time não", () => {
    expect(seloDoItem(item(), "review")).toEqual({ texto: "pedido a você", tom: "aviso" });
    expect(seloDoItem(item({ precisaDeMim: false }), "review")).toEqual({
      texto: "pedido ao time",
      tom: "apagado",
    });
  });

  it("seu PR: CI quebrado antes de mudanças pedidas, depois o CI que passou ou roda", () => {
    const meu = (extra: Partial<ItemGithub>) => item({ meuPapel: "autor", precisaDeMim: false, ...extra });
    expect(seloDoItem(meu({ ciEstado: "falhou", precisaDeMim: true }), "meus").texto).toBe("CI falhou");
    expect(seloDoItem(meu({ ciEstado: "passou", precisaDeMim: true }), "meus").texto).toBe(
      "mudanças pedidas",
    );
    expect(seloDoItem(meu({ ciEstado: "rodando" }), "meus").texto).toBe("CI rodando");
    expect(seloDoItem(meu({ ciEstado: "passou" }), "meus")).toEqual({ texto: "CI passou", tom: "sucesso" });
    expect(seloDoItem(meu({}), "meus")).toEqual({ texto: "aberto", tom: "apagado" });
  });

  it("atribuído diz se é issue ou PR", () => {
    expect(seloDoItem(item({ tipo: "issue", meuPapel: "atribuido" }), "atribuidos").texto).toBe("issue");
    expect(seloDoItem(item({ meuPapel: "atribuido" }), "atribuidos").texto).toBe("PR");
  });

  it("a linha diz quem abriu (menos no seu PR) e há quanto mudou", () => {
    expect(metaDoItem(item(), "review", AGORA)).toBe("de ana · mudou há 26 h");
    expect(metaDoItem(item({ meuPapel: "autor" }), "meus", AGORA)).toBe("mudou há 26 h");
    expect(metaDoItem(item({ autor: null, atualizadoNoGithub: null }), "review", AGORA)).toBe("");
  });
});

describe("fala do Nuno", () => {
  it("o review vem antes do resto, e os outros viram uma contagem", () => {
    const itens = [
      item({ meuPapel: "autor", ciEstado: "falhou", repositorio: "gustavo/site", numero: 57 }),
      item(),
      item({ tipo: "issue", meuPapel: "atribuido", numero: 31 }),
    ];
    expect(falaDoNuno(itens)).toBe("O api-pedidos #412 espera seu review. Mais 2 itens precisam de você.");
  });

  it("uma frase só quando é um item; CI quebrado e mudanças pedidas no seu PR", () => {
    const meu = (extra: Partial<ItemGithub>) => item({ meuPapel: "autor", ...extra });
    expect(falaDoNuno([meu({ ciEstado: "falhou" })])).toBe("O CI do seu api-pedidos #412 falhou.");
    expect(falaDoNuno([meu({}), item({ precisaDeMim: false })])).toBe(
      "Pediram mudanças no seu api-pedidos #412.",
    );
    expect(falaDoNuno([item({ tipo: "issue", meuPapel: "atribuido" })])).toBe(
      "A issue api-pedidos #412 está atribuída a você.",
    );
  });

  it("nada precisando de você, ou só fechado, ele não fala", () => {
    expect(falaDoNuno([item({ precisaDeMim: false })])).toBeNull();
    expect(falaDoNuno([item({ estado: "fechado" })])).toBeNull();
  });
});

describe("situação da leitura", () => {
  it("conta repositórios dos itens abertos e diz quando leu", () => {
    const itens = [item(), item({ meuPapel: "autor" }), item({ repositorio: "gustavo/site" })];
    expect(situacaoDaLeitura({ itens, atualizadoEm: "2026-10-09T13:58:00.000Z" }, AGORA)).toBe(
      "2 repositórios · atualizado há 2 min",
    );
    expect(situacaoDaLeitura({ itens: [item()], atualizadoEm: null }, AGORA)).toBe(
      "1 repositório · ainda não lido",
    );
  });
});
