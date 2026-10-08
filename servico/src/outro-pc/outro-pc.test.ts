import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_PADRAO, Manifesto, VERSAO_FORMATO, type Config, type EstadoConfig } from "@moductus/contrato";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { RepositorioConfig, ServicoConfig, type AplicadorNativo } from "../config/config.ts";
import { ServicoOutroPc } from "./outro-pc.ts";

const pastas: string[] = [];
const bancos: { close(): void; isOpen: boolean }[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "moductus-outro-pc-"));
  pastas.push(p);
  return p;
}

type Aplicacao = { config: Config; mudou: string[] };
const aceita = (registro: Aplicacao[] = []): AplicadorNativo => ({
  aplicar: async (config, mudou) => {
    registro.push({ config, mudou });
    return { falhasAtalhos: {} };
  },
});

const CRIADO_EM = new Date("2026-10-08T12:34:56.000Z");

/** Um PC: banco novo, o serviço de configuração e o de levar para outro PC. */
function pc(nativo: AplicadorNativo = aceita(), portable = false) {
  const db = abrirBanco(pasta());
  bancos.push(db);
  const eventos: EstadoConfig[] = [];
  const config = new ServicoConfig(new RepositorioConfig(db), nativo, (e) => eventos.push(e), portable);
  const outro = new ServicoOutroPc(
    config,
    { versaoApp: "0.5.0-alpha", versaoEsquema: 1, pcOrigem: "casa" },
    () => CRIADO_EM,
  );
  return { config, outro, eventos };
}

const MINHA: Config = {
  tema: "vidro",
  dock: { lado: "direita", modo: "inteligente", forma: "flutuante" },
  atalhos: { sistema: "Ctrl+Alt+M", dock: "Ctrl+Alt+B", captura: "Ctrl+Shift+Space" },
  autostart: true,
};

const manifestoValido = (extra: Partial<Record<string, unknown>> = {}) => ({
  formato: "moductus",
  versao_formato: VERSAO_FORMATO,
  versao_app: "0.5.0-alpha",
  versao_esquema: 1,
  pc_origem: "casa",
  criado_em: CRIADO_EM.toISOString(),
  modalidade: "configuracoes",
  conteudo: ["config"],
  ...extra,
});

/** Monta um .moductus à mão, para os casos que o exportar nunca produz. */
function arquivo(conteudo: Record<string, unknown>): string {
  const caminho = join(pasta(), "feito-a-mao.moductus");
  const entradas: Record<string, Uint8Array> = {};
  for (const [nome, json] of Object.entries(conteudo)) entradas[nome] = strToU8(JSON.stringify(json));
  writeFileSync(caminho, zipSync(entradas));
  return caminho;
}

describe("levar para outro PC: só configurações", () => {
  test("ida e volta: exportar num PC e importar em banco novo devolve a mesma configuração", async () => {
    const casa = pc();
    await casa.config.definir(MINHA);
    const caminho = join(pasta(), "casa-2026-10-08.moductus");
    const r = await casa.outro.exportar({ caminho });
    expect(r).toEqual({ caminho, bytes: readFileSync(caminho).byteLength, chaves: Object.keys(MINHA) });
    expect(r.bytes).toBeGreaterThan(0);

    const aplicados: Aplicacao[] = [];
    const trabalho = pc(aceita(aplicados));
    const estado = await trabalho.outro.importar({ caminho, modo: "substituir" });
    expect(estado.config).toEqual(MINHA);
    expect(trabalho.config.obter().config).toEqual(MINHA);
    // O que é nativo passou pela casca, e a interface ficou sabendo.
    expect(aplicados).toEqual([{ config: MINHA, mudou: ["dock", "atalhos", "autostart"] }]);
    expect(trabalho.eventos.at(-1)?.config).toEqual(MINHA);
  });

  test("o zip leva só manifesto e config, sem credencial nem a pasta portable", async () => {
    const casa = pc();
    await casa.config.definir(MINHA);
    const caminho = join(pasta(), "casa.moductus");
    await casa.outro.exportar({ caminho });
    const conteudo = unzipSync(new Uint8Array(readFileSync(caminho)));
    expect(Object.keys(conteudo).sort()).toEqual(["config.json", "manifesto.json"]);

    const manifesto = Manifesto.parse(JSON.parse(strFromU8(conteudo["manifesto.json"]!)));
    expect(manifesto).toEqual(manifestoValido());
    const config = JSON.parse(strFromU8(conteudo["config.json"]!)) as Record<string, unknown>;
    expect(config).toEqual(MINHA);
    expect(Object.keys(config)).not.toContain("portable");
  });

  test("juntar aplica só as chaves que o arquivo traz e mantém as outras", async () => {
    const trabalho = pc();
    await trabalho.config.definir({ tema: "papel", autostart: true });
    const caminho = arquivo({ "manifesto.json": manifestoValido(), "config.json": { dock: MINHA.dock } });
    const estado = await trabalho.outro.importar({ caminho, modo: "juntar" });
    expect(estado.config).toEqual({ ...CONFIG_PADRAO, tema: "papel", autostart: true, dock: MINHA.dock });
  });

  test("substituir: o que o arquivo não traz volta ao padrão", async () => {
    const trabalho = pc();
    await trabalho.config.definir({ tema: "papel", autostart: true });
    const caminho = arquivo({ "manifesto.json": manifestoValido(), "config.json": { dock: MINHA.dock } });
    const estado = await trabalho.outro.importar({ caminho, modo: "substituir" });
    expect(estado.config).toEqual({ ...CONFIG_PADRAO, dock: MINHA.dock });
  });

  test("prévia: lista o que muda, chave a chave, e não grava nada", async () => {
    const trabalho = pc();
    await trabalho.config.definir({ tema: "papel" });
    const antes = trabalho.eventos.length;
    const caminho = arquivo({
      "manifesto.json": manifestoValido(),
      "config.json": { tema: "vidro", dock: MINHA.dock, autostart: false },
    });
    const previa = await trabalho.outro.previa({ caminho, modo: "juntar" });
    expect(previa).toEqual({
      pc_origem: "casa",
      criado_em: CRIADO_EM.toISOString(),
      versao_app: "0.5.0-alpha",
      // autostart já é false aqui: não aparece.
      mudancas: [
        { chave: "tema", atual: "papel", novo: "vidro" },
        { chave: "dock", atual: CONFIG_PADRAO.dock, novo: MINHA.dock },
      ],
    });
    expect(trabalho.config.obter().config.tema).toBe("papel");
    expect(trabalho.eventos.length).toBe(antes);

    // Substituir também mostra o que volta ao padrão.
    const substituir = await trabalho.outro.previa({
      caminho: arquivo({ "manifesto.json": manifestoValido(), "config.json": { dock: MINHA.dock } }),
      modo: "substituir",
    });
    expect(substituir.mudancas.map((m) => m.chave)).toEqual(["tema", "dock"]);
    expect(substituir.mudancas[0]).toEqual({ chave: "tema", atual: "papel", novo: CONFIG_PADRAO.tema });
  });

  test("portable: o autostart do arquivo fica de fora, o resto entra", async () => {
    const pendrive = pc(aceita(), true);
    const caminho = arquivo({ "manifesto.json": manifestoValido(), "config.json": MINHA });
    const previa = await pendrive.outro.previa({ caminho, modo: "juntar" });
    expect(previa.mudancas.map((m) => m.chave)).not.toContain("autostart");
    const estado = await pendrive.outro.importar({ caminho, modo: "substituir" });
    expect(estado.config).toEqual({ ...MINHA, autostart: false });
  });

  test("arquivo corrompido é recusado com mensagem clara e nada muda", async () => {
    const trabalho = pc();
    await trabalho.config.definir({ tema: "papel" });
    const antes = trabalho.eventos.length;
    const lixo = join(pasta(), "lixo.moductus");
    writeFileSync(lixo, Buffer.from("isto não é um zip"));
    await expect(trabalho.outro.importar({ caminho: lixo, modo: "substituir" })).rejects.toThrow(
      "O arquivo está corrompido ou não é um arquivo do Moductus.",
    );

    // Zip verdadeiro cortado ao meio.
    const casa = pc();
    const inteiro = join(pasta(), "inteiro.moductus");
    await casa.outro.exportar({ caminho: inteiro });
    const cortado = join(pasta(), "cortado.moductus");
    const bytes = readFileSync(inteiro);
    writeFileSync(cortado, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await expect(trabalho.outro.importar({ caminho: cortado, modo: "substituir" })).rejects.toThrow(
      "corrompido",
    );

    // Zip sem manifesto.
    await expect(
      trabalho.outro.importar({ caminho: arquivo({ "config.json": MINHA }), modo: "juntar" }),
    ).rejects.toThrow("corrompido");

    expect(trabalho.config.obter().config).toEqual({ ...CONFIG_PADRAO, tema: "papel" });
    expect(trabalho.eventos.length).toBe(antes);
  });

  test("manifesto de formato mais novo é recusado pedindo para atualizar", async () => {
    const trabalho = pc();
    const caminho = arquivo({
      "manifesto.json": manifestoValido({ versao_formato: VERSAO_FORMATO + 1, versao_app: "2.0.0" }),
      "config.json": MINHA,
    });
    await expect(trabalho.outro.importar({ caminho, modo: "substituir" })).rejects.toThrow(
      "Este arquivo foi gerado por um Moductus mais novo (2.0.0). Atualize este PC antes de importar.",
    );
    expect(trabalho.config.obter().config).toEqual(CONFIG_PADRAO);
  });

  test("arquivo com dados é recusado nesta fase", async () => {
    const trabalho = pc();
    const caminho = arquivo({
      "manifesto.json": manifestoValido({ modalidade: "configuracoes_e_dados" }),
      "config.json": MINHA,
    });
    await expect(trabalho.outro.importar({ caminho, modo: "juntar" })).rejects.toThrow("só configurações");
  });

  test("chave inválida no arquivo recusa tudo, sem gravar nem chamar a casca", async () => {
    const aplicados: Aplicacao[] = [];
    const trabalho = pc(aceita(aplicados));
    const caminho = arquivo({
      "manifesto.json": manifestoValido(),
      "config.json": { ...MINHA, tema: "neon" },
    });
    await expect(trabalho.outro.importar({ caminho, modo: "substituir" })).rejects.toThrow(
      /A configuração "tema" do arquivo é inválida.*Nada foi importado\./,
    );
    expect(trabalho.config.obter().config).toEqual(CONFIG_PADRAO);
    expect(aplicados).toEqual([]);
    expect(trabalho.eventos).toEqual([]);
  });

  test("chave que este Moductus não conhece é ignorada", async () => {
    const trabalho = pc();
    const caminho = arquivo({
      "manifesto.json": manifestoValido(),
      "config.json": { tema: "grafite", fuso: "America/Sao_Paulo" },
    });
    const estado = await trabalho.outro.importar({ caminho, modo: "juntar" });
    expect(estado.config).toEqual({ ...CONFIG_PADRAO, tema: "grafite" });
  });

  test("a casca recusa um atalho do arquivo: o motivo volta e nada é gravado", async () => {
    const casa = pc();
    await casa.config.definir(MINHA);
    const caminho = join(pasta(), "casa.moductus");
    await casa.outro.exportar({ caminho });

    const trabalho = pc({
      aplicar: () => Promise.reject(new Error("Ctrl+Alt+M já está em uso por outro programa")),
    });
    await expect(trabalho.outro.importar({ caminho, modo: "substituir" })).rejects.toThrow("já está em uso");
    expect(trabalho.config.obter().config).toEqual(CONFIG_PADRAO);
    expect(trabalho.eventos).toEqual([]);
  });

  test("caminho relativo, sem .moductus ou inexistente é recusado", async () => {
    const { outro } = pc();
    await expect(outro.exportar({ caminho: "casa.moductus" })).rejects.toThrow("absoluto");
    await expect(outro.exportar({ caminho: join(pasta(), "casa.zip") })).rejects.toThrow(".moductus");
    await expect(
      outro.importar({ caminho: join(pasta(), "nao-existe.moductus"), modo: "juntar" }),
    ).rejects.toThrow("Não encontrei o arquivo");
    await expect(
      outro.exportar({ caminho: join(pasta(), "pasta-que-nao-existe", "casa.moductus") }),
    ).rejects.toThrow("Não consegui gravar o arquivo");
  });
});
