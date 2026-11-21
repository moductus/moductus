import { describe, expect, test } from "vitest";
import {
  AutorizacaoArquivo,
  EXTENSOES_ARQUIVO,
  PedidoAutorizarArquivo,
  TAMANHO_MAXIMO_ARQUIVO,
  VALIDADE_AUTORIZACAO_MS,
} from "./arquivos.ts";
import { METODOS } from "./metodos.ts";

describe("arquivos do usuário (ADR-0044)", () => {
  test("o caminho chega uma vez, absoluto, com a finalidade", () => {
    expect(
      PedidoAutorizarArquivo.safeParse({
        caminho: "C:\\Users\\eu\\Downloads\\extrato.ofx",
        finalidade: "extrato",
      }).success,
    ).toBe(true);
    expect(PedidoAutorizarArquivo.safeParse({ caminho: "extrato.ofx", finalidade: "extrato" }).success).toBe(
      false,
    );
    expect(PedidoAutorizarArquivo.safeParse({ caminho: "C:\\a.png", finalidade: "foto" }).success).toBe(
      false,
    );
  });

  test("a autorização volta sem o caminho, só com o nome, o tamanho e até quando vale", () => {
    const autorizacao = {
      id: "01KA0000000000000000000A01",
      finalidade: "comprovante",
      nome: "pix.png",
      bytes: 240_000,
      valeAte: "2026-11-21T12:10:00.000Z",
    };
    expect(AutorizacaoArquivo.parse(autorizacao)).toEqual(autorizacao);
    expect(Object.keys(AutorizacaoArquivo.parse({ ...autorizacao, caminho: "C:\\pix.png" }))).not.toContain(
      "caminho",
    );
    expect(METODOS["arquivos.autorizar"].saida).toBe(AutorizacaoArquivo);
  });

  test("filtros, tamanhos e validade do ADR-0044", () => {
    expect(EXTENSOES_ARQUIVO.extrato).toEqual(["ofx", "csv", "xml", "txt"]);
    expect(EXTENSOES_ARQUIVO.comprovante).toEqual(["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff"]);
    expect(TAMANHO_MAXIMO_ARQUIVO).toEqual({ extrato: 10 * 1024 * 1024, comprovante: 15 * 1024 * 1024 });
    expect(VALIDADE_AUTORIZACAO_MS).toBe(600_000);
  });
});
