import { describe, expect, test } from "vitest";
import {
  comecoDoTexto,
  consultaFts,
  encurtarPedacos,
  lerSnippet,
  TAMANHO_DO_COMECO,
  trechoCorrido,
} from "./trecho.ts";

describe("começo do texto", () => {
  test("cada linha vira um pedaço, sem as marcas de bloco do Markdown", () => {
    const conteudo =
      "# Viagem\n\n- [x] reservar a pousada\n* trocar filtro da água\n1. ver frete\n> citação\n---\n";
    expect(comecoDoTexto(conteudo)).toBe(
      "Viagem · reservar a pousada · trocar filtro da água · ver frete · citação",
    );
  });

  test("espaços seguidos viram um e o CRLF conta como quebra de linha", () => {
    expect(comecoDoTexto("  código   do portão\r\n\r\ntrocar\tfiltro  ")).toBe(
      "código do portão · trocar filtro",
    );
  });

  test("o que não é marca fica: #hashtag, -5 graus, o número que não é item", () => {
    expect(comecoDoTexto("#casa\n-5 graus\n2026 foi bom")).toBe("#casa · -5 graus · 2026 foi bom");
  });

  test("texto longo corta na palavra, com reticências, dentro do tamanho", () => {
    const longo = "palavra ".repeat(40);
    const comeco = comecoDoTexto(longo);
    expect(comeco.length).toBeLessThanOrEqual(TAMANHO_DO_COMECO);
    expect(comeco.endsWith("palavra…")).toBe(true);
    expect(comecoDoTexto(longo, 12)).toBe("palavra…");
  });

  test("o corte não deixa o separador pendurado", () => {
    expect(comecoDoTexto("abcde\nfghij", 9)).toBe("abcde…");
  });

  test("vazio é vazio", () => {
    expect(comecoDoTexto("")).toBe("");
    expect(comecoDoTexto("\n\n- \n")).toBe("");
  });
});

describe("trecho com destaques", () => {
  test("as posições apontam para o que bateu no texto final, depois de limpar o Markdown", () => {
    const trecho = trechoCorrido([
      { texto: "# Viagem\n\n- passagem para ", marcado: false },
      { texto: "amanhã", marcado: true },
      { texto: " cedo\n- ", marcado: false },
      { texto: "hotel", marcado: true },
    ]);
    expect(trecho.texto).toBe("Viagem · passagem para amanhã cedo · hotel");
    expect(trecho.destaques.map((d) => trecho.texto.slice(d.inicio, d.fim))).toEqual(["amanhã", "hotel"]);
  });

  test("a frase que bateu inteira fica num destaque só, com o espaço de dentro", () => {
    const trecho = trechoCorrido([
      { texto: "ligar ", marcado: false },
      { texto: "amanhã   cedo", marcado: true },
      { texto: " sem falta", marcado: false },
    ]);
    expect(trecho.texto).toBe("ligar amanhã cedo sem falta");
    expect(trecho.destaques).toEqual([{ inicio: 6, fim: 17 }]);
  });

  test("palavras vizinhas que bateram separadas não viram um destaque só", () => {
    const trecho = trechoCorrido([
      { texto: "água", marcado: true },
      { texto: " ", marcado: false },
      { texto: "filtro", marcado: true },
    ]);
    expect(trecho.destaques).toEqual([
      { inicio: 0, fim: 4 },
      { inicio: 5, fim: 11 },
    ]);
  });

  test("um número de item que bateu com a busca não some como marca", () => {
    const trecho = trechoCorrido([
      { texto: "12", marcado: true },
      { texto: ". de outubro", marcado: false },
    ]);
    expect(trecho.texto).toBe("12. de outubro");
    expect(trecho.destaques).toEqual([{ inicio: 0, fim: 2 }]);
  });

  test("emoji conta como as janelas contam (UTF-16)", () => {
    const trecho = trechoCorrido([
      { texto: "🎉 festa ", marcado: false },
      { texto: "amanhã", marcado: true },
    ]);
    expect(trecho.destaques.map((d) => trecho.texto.slice(d.inicio, d.fim))).toEqual(["amanhã"]);
  });
});

describe("snippet do FTS5", () => {
  test("separa o que bateu do resto pelas marcas", () => {
    expect(lerSnippet("…para <a>amanhã</a> cedo e <a>hotel</a>", "<a>", "</a>")).toEqual([
      { texto: "…para ", marcado: false },
      { texto: "amanhã", marcado: true },
      { texto: " cedo e ", marcado: false },
      { texto: "hotel", marcado: true },
    ]);
    expect(lerSnippet("", "<a>", "</a>")).toEqual([]);
    expect(lerSnippet("sem nada", "<a>", "</a>")).toEqual([{ texto: "sem nada", marcado: false }]);
  });

  test("uma palavra de 300 mil letras não estoura a pilha ao montar o trecho", () => {
    const enorme = "x".repeat(300_000);
    expect(trechoCorrido([{ texto: enorme, marcado: false }]).texto).toHaveLength(300_000);
  });

  test("pedaço longo fica com o lado que encosta no destaque, e o destaque sobrevive", () => {
    const antes = "a".repeat(1000);
    const meio = `${"b".repeat(500)} ${"c".repeat(500)}`;
    const depois = "d".repeat(1000);
    const curtos = encurtarPedacos(
      [
        { texto: antes, marcado: false },
        { texto: "amanhã", marcado: true },
        { texto: meio, marcado: false },
        { texto: "x".repeat(300_000), marcado: true },
        { texto: depois, marcado: false },
      ],
      10,
    );
    expect(curtos).toEqual([
      { texto: "…aaaaaaaaaa", marcado: false },
      { texto: "amanhã", marcado: true },
      { texto: "bbbbb…ccccc", marcado: false },
      { texto: "xxxxxxxxxx", marcado: true },
      { texto: "…", marcado: false },
      { texto: "dddddddddd…", marcado: false },
    ]);
    const trecho = trechoCorrido(curtos);
    expect(trecho.destaques.map((d) => trecho.texto.slice(d.inicio, d.fim))).toEqual([
      "amanhã",
      "xxxxxxxxxx",
    ]);
  });

  test("sem destaque, fica o começo; o corte não parte um emoji ao meio", () => {
    expect(encurtarPedacos([{ texto: "abcdefghijkl", marcado: false }], 4)).toEqual([
      { texto: "abcd…", marcado: false },
    ]);
    expect(encurtarPedacos([{ texto: "abc🎉defgh", marcado: false }], 4)).toEqual([
      { texto: "abc…", marcado: false },
    ]);
    expect(
      encurtarPedacos(
        [
          { texto: "abcdef🎉gh", marcado: false },
          { texto: "z", marcado: true },
        ],
        3,
      ),
    ).toEqual([
      { texto: "…gh", marcado: false },
      { texto: "z", marcado: true },
    ]);
  });
});

describe("consulta do FTS5", () => {
  test("cada palavra entre aspas, como prefixo", () => {
    expect(consultaFts("ligar  amanha")).toBe('"ligar"* "amanha"*');
  });

  test("operadores e aspas do usuário não viram sintaxe; a aspa vai dobrada, não some", () => {
    expect(consultaFts('a OR "b" NEAR(c) -d')).toBe('"a"* "OR"* """b"""* "NEAR(c)"* "-d"*');
    expect(consultaFts('a"b')).toBe('"a""b"*');
  });

  test("caractere de controle separa palavras como o espaço", () => {
    expect(consultaFts("a\u0000b\u0001c")).toBe('"a"* "b"* "c"*');
  });

  test("sem letra nem número, não há busca", () => {
    expect(consultaFts(' - * "" ')).toBeNull();
  });
});
