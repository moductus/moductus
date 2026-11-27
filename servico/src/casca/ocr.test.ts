import { describe, expect, test } from "vitest";
import { ErroDoOcr, ErroSemIdioma, MENSAGEM_SEM_IDIOMA, ocrPelaCasca, PRAZO_OCR_MS } from "./ocr.ts";

/** Canal de mentira: guarda os pedidos e o prazo e devolve a resposta dada; nada chega ao Windows. */
function canal(resposta: Record<string, unknown>) {
  const pedidos: { pedido: Record<string, unknown>; prazo?: number }[] = [];
  return {
    pedidos,
    canal: {
      pedir: <T extends Record<string, unknown>>(pedido: Record<string, unknown>, prazo?: number) => {
        pedidos.push({ pedido, prazo });
        return Promise.resolve(resposta as T);
      },
    },
  };
}

describe("OCR pela casca", () => {
  test("o caminho vai no pedido que a casca entende e as linhas voltam como vieram", async () => {
    const { canal: c, pedidos } = canal({ linhas: ["Pix enviado", "R$ 1.234,56"] });
    const linhas = await ocrPelaCasca(c).lerTextoImagem("C:\\Users\\voce\\comprovante.png");
    expect(linhas).toEqual(["Pix enviado", "R$ 1.234,56"]);
    expect(pedidos).toEqual([
      {
        pedido: { tipo: "ocr", op: "ler_texto_imagem", caminho: "C:\\Users\\voce\\comprovante.png" },
        prazo: PRAZO_OCR_MS,
      },
    ]);
  });

  test("sem o pt-BR no Windows, o erro é ErroSemIdioma, com o caminho para instalar", async () => {
    const { canal: c } = canal({
      codigo: "sem_idioma",
      erro: "o reconhecimento de texto em português não está instalado",
    });
    const lendo = ocrPelaCasca(c).lerTextoImagem("C:\\a.png");
    await expect(lendo).rejects.toBeInstanceOf(ErroSemIdioma);
    await expect(lendo).rejects.toMatchObject({ codigo: "sem_idioma", message: MENSAGEM_SEM_IDIOMA });
  });

  test("recusa e imagem ilegível viram ErroDoOcr com o motivo em frase", async () => {
    const recusa = ocrPelaCasca(
      canal({ codigo: "recusado", erro: "só imagem numa unidade do PC é lida" }).canal,
    );
    await expect(recusa.lerTextoImagem("\\\\srv\\a.png")).rejects.toEqual(
      new ErroDoOcr("recusado", "Só imagem numa unidade do PC é lida."),
    );
    const ilegivel = ocrPelaCasca(
      canal({ codigo: "ilegivel", erro: "não foi possível abrir a imagem" }).canal,
    );
    await expect(ilegivel.lerTextoImagem("C:\\a.png")).rejects.toMatchObject({
      codigo: "ilegivel",
      message: "Não foi possível abrir a imagem.",
    });
  });

  test("pedido malformado ou resposta sem linhas não passam como texto vazio", async () => {
    await expect(
      ocrPelaCasca(canal({ erro: "pedido inválido: x" }).canal).lerTextoImagem("C:\\a.png"),
    ).rejects.toThrow("pedido inválido");
    await expect(ocrPelaCasca(canal({}).canal).lerTextoImagem("C:\\a.png")).rejects.toThrow("não devolveu");
    await expect(ocrPelaCasca(canal({ linhas: [1] }).canal).lerTextoImagem("C:\\a.png")).rejects.toThrow(
      "não devolveu",
    );
  });

  test("imagem sem texto devolve lista vazia", async () => {
    expect(await ocrPelaCasca(canal({ linhas: [] }).canal).lerTextoImagem("C:\\a.png")).toEqual([]);
  });
});
