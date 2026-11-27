import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ErroSemIdioma, type OcrNaCasca } from "../casca/ocr.ts";
import { AutorizacoesDeArquivo, ErroDoArquivo } from "./autorizacoes.ts";
import { lerTextoDaImagem } from "./texto-da-imagem.ts";

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function imagem(nome: string): string {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ocr-"));
  pastas.push(pasta);
  const caminho = join(pasta, nome);
  writeFileSync(caminho, "PNG");
  return caminho;
}

/** OCR de mentira: guarda os caminhos pedidos e devolve as linhas dadas, ou falha. */
function ocr(resultado: string[] | Error) {
  const caminhos: string[] = [];
  const falso: OcrNaCasca = {
    lerTextoImagem: (caminho) => {
      caminhos.push(caminho);
      return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado);
    },
  };
  return { caminhos, falso };
}

describe("texto da imagem autorizada", () => {
  test("consome a autorização de comprovante e manda à casca o caminho resolvido, sem devolvê-lo", async () => {
    const caminho = imagem("Comprovante Pix.png");
    const autorizacoes = new AutorizacoesDeArquivo();
    const { id } = autorizacoes.autorizar({ caminho, finalidade: "comprovante" });
    const { caminhos, falso } = ocr(["Pix enviado", "R$ 1.234,56"]);

    const lido = await lerTextoDaImagem(autorizacoes, falso)(id);

    expect(lido).toEqual({
      nome: "Comprovante Pix.png",
      linhas: ["Pix enviado", "R$ 1.234,56"],
      texto: "Pix enviado\nR$ 1.234,56",
    });
    expect(caminhos).toEqual([realpathSync.native(caminho)]);
    expect(JSON.stringify(lido)).not.toContain(pastas[0]);
    // Uso único: a segunda leitura com o mesmo id nem chega à casca.
    await expect(lerTextoDaImagem(autorizacoes, falso)(id)).rejects.toBeInstanceOf(ErroDoArquivo);
    expect(caminhos).toHaveLength(1);
  });

  test("id de extrato, inventado ou caminho no lugar do id não chegam à casca", async () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const extrato = autorizacoes.autorizar({ caminho: imagem("extrato.ofx"), finalidade: "extrato" });
    const { caminhos, falso } = ocr([]);
    const ler = lerTextoDaImagem(autorizacoes, falso);
    await expect(ler(extrato.id)).rejects.toBeInstanceOf(ErroDoArquivo);
    await expect(ler("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ErroDoArquivo);
    await expect(ler(imagem("a.png"))).rejects.toBeInstanceOf(ErroDoArquivo);
    expect(caminhos).toEqual([]);
  });

  test("sem o pt-BR, o ErroSemIdioma chega a quem pediu como veio", async () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const { id } = autorizacoes.autorizar({ caminho: imagem("print.jpg"), finalidade: "comprovante" });
    await expect(lerTextoDaImagem(autorizacoes, ocr(new ErroSemIdioma()).falso)(id)).rejects.toBeInstanceOf(
      ErroSemIdioma,
    );
  });
});
