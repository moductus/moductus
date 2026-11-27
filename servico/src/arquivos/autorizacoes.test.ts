import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutorizacaoArquivo, VALIDADE_AUTORIZACAO_MS } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AutorizacoesDeArquivo, ErroDoArquivo } from "./autorizacoes.ts";
import { atendentesDosArquivos, MENSAGEM_ERRO_INTERNO } from "./canal.ts";

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "moductus-arquivos-"));
  pastas.push(p);
  return p;
}

function arquivo(nome: string, conteudo = "OFXHEADER:100"): string {
  const caminho = join(pasta(), nome);
  writeFileSync(caminho, conteudo);
  return caminho;
}

/** Relógio que o teste avança; começa num instante fixo, em UTC. */
function relogio() {
  let agora = Date.parse("2026-11-27T12:00:00.000Z");
  return { agora: () => agora, andar: (ms: number) => (agora += ms) };
}

describe("autorizar (ADR-0044)", () => {
  test("arquivo comum na extensão e no tamanho certos vira uma autorização sem o caminho", () => {
    const caminho = arquivo("Extrato Nubank.OFX");
    const r = relogio();
    const autorizacoes = new AutorizacoesDeArquivo({ agora: r.agora });

    const autorizacao = autorizacoes.autorizar({ caminho, finalidade: "extrato" });

    expect(AutorizacaoArquivo.parse(autorizacao)).toEqual(autorizacao);
    expect(autorizacao).toMatchObject({
      finalidade: "extrato",
      nome: "Extrato Nubank.OFX",
      bytes: 13,
      valeAte: "2026-11-27T12:10:00.000Z",
    });
    expect(JSON.stringify(autorizacao)).not.toContain(pastas[0]);
    expect(autorizacoes.usar(autorizacao.id, "extrato")).toEqual({
      caminho: realpathSync.native(caminho),
      finalidade: "extrato",
      nome: "Extrato Nubank.OFX",
      bytes: 13,
    });
  });

  test("o id usado duas vezes é recusado", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const { id } = autorizacoes.autorizar({ caminho: arquivo("extrato.csv"), finalidade: "extrato" });

    autorizacoes.usar(id, "extrato");

    expect(() => autorizacoes.usar(id, "extrato")).toThrow(ErroDoArquivo);
    expect(() => autorizacoes.usar(id, "extrato")).toThrow(/não está mais autorizado/);
  });

  test("o id vencido é recusado, e um minuto antes ainda vale", () => {
    const r = relogio();
    const autorizacoes = new AutorizacoesDeArquivo({ agora: r.agora });
    const caminho = arquivo("pix.png");
    const vencida = autorizacoes.autorizar({ caminho, finalidade: "comprovante" });
    const valendo = autorizacoes.autorizar({ caminho, finalidade: "comprovante" });

    r.andar(VALIDADE_AUTORIZACAO_MS - 60_000);
    expect(autorizacoes.usar(valendo.id, "comprovante").nome).toBe("pix.png");

    r.andar(60_001);
    expect(() => autorizacoes.usar(vencida.id, "comprovante")).toThrow(/venceu depois de 10 minutos/);
    // Recusado uma vez, já não existe.
    expect(() => autorizacoes.usar(vencida.id, "comprovante")).toThrow(/não está mais autorizado/);
  });

  test("o id que não veio daqui ou de outra finalidade é recusado, e não vale mais depois", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const { id } = autorizacoes.autorizar({ caminho: arquivo("extrato.ofx"), finalidade: "extrato" });

    expect(() => autorizacoes.usar("01KA0000000000000000000A01", "extrato")).toThrow(ErroDoArquivo);
    expect(() => autorizacoes.usar(id, "comprovante")).toThrow(/não está mais autorizado/);
    expect(() => autorizacoes.usar(id, "extrato")).toThrow(/não está mais autorizado/);
  });

  test("caminho de pasta é recusado, mesmo com extensão de extrato", () => {
    const p = join(pasta(), "extratos.ofx");
    mkdirSync(p);
    const autorizacoes = new AutorizacoesDeArquivo();

    expect(() => autorizacoes.autorizar({ caminho: p, finalidade: "extrato" })).toThrow(
      "Escolha um arquivo, não uma pasta.",
    );
    expect(() => autorizacoes.autorizar({ caminho: pastas[0]!, finalidade: "extrato" })).toThrow(
      ErroDoArquivo,
    );
  });

  test("arquivo de 50 MB é recusado; o limite é 10 MB no extrato e 15 MB na imagem", () => {
    const grande = arquivo("grande.ofx", "");
    truncateSync(grande, 50 * 1024 * 1024);
    const autorizacoes = new AutorizacoesDeArquivo();

    expect(() => autorizacoes.autorizar({ caminho: grande, finalidade: "extrato" })).toThrow(
      "O arquivo tem 50 MB; o extrato vai até 10 MB.",
    );

    const imagem = arquivo("print.jpg", "");
    truncateSync(imagem, 12 * 1024 * 1024);
    expect(autorizacoes.autorizar({ caminho: imagem, finalidade: "comprovante" }).bytes).toBe(
      12 * 1024 * 1024,
    );
    truncateSync(imagem, 15 * 1024 * 1024 + 1);
    expect(() => autorizacoes.autorizar({ caminho: imagem, finalidade: "comprovante" })).toThrow(
      "O arquivo tem 15,1 MB; o comprovante vai até 15 MB.",
    );
  });

  test("o arquivo que cresceu depois de autorizado é recusado no uso", () => {
    const caminho = arquivo("extrato.ofx");
    const autorizacoes = new AutorizacoesDeArquivo();
    const { id } = autorizacoes.autorizar({ caminho, finalidade: "extrato" });

    truncateSync(caminho, 10 * 1024 * 1024 + 1);

    expect(() => autorizacoes.usar(id, "extrato")).toThrow(/vai até 10 MB/);
  });

  test("extensão fora da finalidade é recusada, inclusive executável e sem extensão", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    for (const nome of ["extrato.exe", "extrato.ofx.lnk", "extrato", "foto.png"]) {
      expect(() => autorizacoes.autorizar({ caminho: arquivo(nome), finalidade: "extrato" })).toThrow(
        "Este arquivo não é um extrato: use OFX, CSV, XML ou TXT.",
      );
    }
    expect(() =>
      autorizacoes.autorizar({ caminho: arquivo("extrato.ofx"), finalidade: "comprovante" }),
    ).toThrow(/PNG, JPEG, BMP, GIF ou TIFF/);
  });

  test("arquivo que não existe, rede, dispositivo e fluxo alternativo são recusados", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const p = pasta();
    const casos = [
      [join(p, "sumiu.ofx"), /não foi encontrado/],
      [join(arquivo("extrato.txt"), "dentro.ofx"), /não foi encontrado/],
      ["\\\\?\\C:\\Users\\eu\\extrato.ofx", /não é de um arquivo neste PC/],
      ["\\\\.\\PhysicalDrive0.ofx", /não é de um arquivo neste PC/],
      ["\\\\servidor\\financas\\extrato.ofx", /não é de um arquivo neste PC/],
      ["//servidor/financas/extrato.ofx", /não é de um arquivo neste PC/],
      ["/home/eu/extrato.ofx", /não é de um arquivo neste PC/],
      [`${arquivo("extrato.txt")}:escondido.ofx`, /não é de um arquivo neste PC/],
    ] as const;
    for (const [caminho, motivo] of casos) {
      expect(() => autorizacoes.autorizar({ caminho, finalidade: "extrato" })).toThrow(motivo);
    }
  });

  test("o arquivo trocado por outro ou editado depois de autorizado é recusado no uso", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const caminho = arquivo("extrato.ofx");
    const trocado = autorizacoes.autorizar({ caminho, finalidade: "extrato" });
    // Outro arquivo, do mesmo tamanho, no mesmo lugar.
    const outro = join(pastas.at(-1)!, "outro.ofx");
    writeFileSync(outro, "OFXHEADER:200");
    renameSync(outro, caminho);
    expect(() => autorizacoes.usar(trocado.id, "extrato")).toThrow(/mudou depois de escolhido/);

    const editado = autorizacoes.autorizar({ caminho, finalidade: "extrato" });
    utimesSync(caminho, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    expect(() => autorizacoes.usar(editado.id, "extrato")).toThrow(/mudou depois de escolhido/);
  });

  test("link com extensão de extrato para arquivo de outro tipo é recusado; para extrato, vale o resolvido", (ctx) => {
    const p = pasta();
    const segredo = join(p, "segredo.env");
    writeFileSync(segredo, "TOKEN=1");
    const link = join(p, "extrato.ofx");
    try {
      symlinkSync(segredo, link, "file");
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code;
      if (codigo === "EPERM" || codigo === "EACCES") {
        ctx.skip("o Windows negou criar link simbólico (sem o Modo de Desenvolvedor nem administrador)");
      }
      throw erro;
    }
    const autorizacoes = new AutorizacoesDeArquivo();
    expect(() => autorizacoes.autorizar({ caminho: link, finalidade: "extrato" })).toThrow(
      "Este arquivo não é um extrato: use OFX, CSV, XML ou TXT.",
    );

    const real = join(p, "real.csv");
    writeFileSync(real, "data;valor");
    const outroLink = join(p, "atalho.ofx");
    symlinkSync(real, outroLink, "file");
    const { id, nome } = autorizacoes.autorizar({ caminho: outroLink, finalidade: "extrato" });
    expect(nome).toBe("atalho.ofx");
    expect(autorizacoes.usar(id, "extrato").caminho).toBe(realpathSync.native(real));
  });

  test("cada autorização tem um id próprio, que não se deduz do anterior", () => {
    const autorizacoes = new AutorizacoesDeArquivo();
    const caminho = arquivo("extrato.ofx");
    const ids = new Set(
      Array.from({ length: 20 }, () => autorizacoes.autorizar({ caminho, finalidade: "extrato" }).id),
    );
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("arquivos.autorizar no canal", () => {
  test("a recusa vai à janela como veio; o erro de dentro vira o texto genérico, sem o caminho", () => {
    const caminho = arquivo("extrato.ofx");
    const atendente = atendentesDosArquivos(new AutorizacoesDeArquivo())["arquivos.autorizar"];
    expect(atendente({ caminho, finalidade: "extrato" })).toMatchObject({ nome: "extrato.ofx" });
    expect(() => atendente({ caminho: pastas[0]!, finalidade: "extrato" })).toThrow(ErroDoArquivo);

    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const quebrado = atendentesDosArquivos({
      autorizar: () => {
        throw new Error(`EPERM: ${caminho}`);
      },
    })["arquivos.autorizar"];
    expect(() => quebrado({ caminho, finalidade: "extrato" })).toThrow(MENSAGEM_ERRO_INTERNO);
    expect(erro).toHaveBeenCalledOnce();
    erro.mockRestore();
  });
});
