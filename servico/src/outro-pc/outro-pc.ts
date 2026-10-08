import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  CONFIG_PADRAO,
  Config,
  FORMATO_ARQUIVO,
  Manifesto,
  PedidoExportar,
  PedidoImportar,
  VERSAO_FORMATO,
  type EstadoConfig,
  type MudancaConfig,
  type ResultadoExportar,
} from "@moductus/contrato";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ServicoConfig } from "../config/config.ts";

/** De onde o arquivo sai: vai no manifesto. */
export interface Origem {
  versaoApp: string;
  versaoEsquema: number;
  pcOrigem: string;
}

const MANIFESTO = "manifesto.json";
const CONFIG = "config.json";

/** Arquivo só de configurações tem poucos KB; o teto barra zip-bomba e arquivo errado. */
const TETO_BYTES = 4 * 1024 * 1024;

const CORROMPIDO = "O arquivo está corrompido ou não é um arquivo do Moductus.";

/** Erro com a mensagem que a interface mostra como está. */
export class ArquivoRecusado extends Error {}

/**
 * Levar para outro PC, modalidade "só configurações": gera o .moductus com manifesto e
 * config, e importa passando pelo ServicoConfig, para a casca aplicar o que é nativo e
 * nada ser gravado se ela recusar. Credenciais e a pasta portable nunca entram: o arquivo
 * leva só a tabela config.
 */
export class ServicoOutroPc {
  constructor(
    private readonly config: ServicoConfig,
    private readonly origem: Origem,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async exportar(entrada: PedidoExportar): Promise<ResultadoExportar> {
    const { caminho } = PedidoExportar.parse(entrada);
    const config = this.config.obter().config;
    const chaves = Object.keys(config);
    const manifesto: Manifesto = {
      formato: FORMATO_ARQUIVO,
      versao_formato: VERSAO_FORMATO,
      versao_app: this.origem.versaoApp,
      versao_esquema: this.origem.versaoEsquema,
      pc_origem: this.origem.pcOrigem,
      criado_em: this.agora().toISOString(),
      modalidade: "configuracoes",
      conteudo: ["config"],
    };
    const zip = zipSync({
      [MANIFESTO]: strToU8(JSON.stringify(Manifesto.parse(manifesto), null, 2)),
      [CONFIG]: strToU8(JSON.stringify(config, null, 2)),
    });
    // Grava ao lado e renomeia: uma falha no meio não deixa um .moductus pela metade.
    const temporario = `${caminho}.${process.pid}.tmp`;
    try {
      await writeFile(temporario, zip);
      await rename(temporario, caminho);
    } catch (erro) {
      await rm(temporario, { force: true });
      throw new ArquivoRecusado(`Não consegui gravar o arquivo em ${caminho}: ${motivo(erro)}`);
    }
    return { caminho, bytes: zip.byteLength, chaves };
  }

  async importar(entrada: PedidoImportar): Promise<EstadoConfig> {
    const { caminho, modo } = PedidoImportar.parse(entrada);
    const chaves = lerConfigDoArquivo(await lerZip(caminho));
    // Substituir: o que o arquivo não traz volta ao padrão. Juntar: só o que ele traz.
    const mudanca: MudancaConfig = modo === "substituir" ? { ...CONFIG_PADRAO, ...chaves } : chaves;
    return this.config.definir(mudanca);
  }
}

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

async function lerZip(caminho: string): Promise<Record<string, Uint8Array>> {
  let tamanho: number;
  try {
    tamanho = (await stat(caminho)).size;
  } catch {
    throw new ArquivoRecusado(`Não encontrei o arquivo ${caminho}.`);
  }
  if (tamanho > TETO_BYTES) throw new ArquivoRecusado(CORROMPIDO);
  const bruto = new Uint8Array(await readFile(caminho));
  try {
    // Só os dois arquivos conhecidos são extraídos, e cada um com teto de tamanho.
    return unzipSync(bruto, {
      filter: (f) => {
        if (f.originalSize > TETO_BYTES) throw new Error("conteúdo grande demais");
        return f.name === MANIFESTO || f.name === CONFIG;
      },
    });
  } catch {
    throw new ArquivoRecusado(CORROMPIDO);
  }
}

function lerJson(arquivos: Record<string, Uint8Array>, nome: string): unknown {
  const conteudo = arquivos[nome];
  if (!conteudo) throw new ArquivoRecusado(CORROMPIDO);
  try {
    return JSON.parse(strFromU8(conteudo));
  } catch {
    throw new ArquivoRecusado(CORROMPIDO);
  }
}

/** Confere o manifesto antes de tudo; a versão vem primeiro para a mensagem ser a certa. */
function conferirManifesto(json: unknown): Manifesto {
  const cabeca = json as Partial<Record<keyof Manifesto, unknown>> | null;
  if (typeof cabeca !== "object" || cabeca === null || cabeca.formato !== FORMATO_ARQUIVO) {
    throw new ArquivoRecusado(CORROMPIDO);
  }
  if (typeof cabeca.versao_formato === "number" && cabeca.versao_formato > VERSAO_FORMATO) {
    throw new ArquivoRecusado(
      `Este arquivo foi gerado por um Moductus mais novo (${String(cabeca.versao_app)}). Atualize este PC antes de importar.`,
    );
  }
  if (cabeca.modalidade !== undefined && cabeca.modalidade !== "configuracoes") {
    throw new ArquivoRecusado("Este arquivo traz dados; por enquanto o Moductus importa só configurações.");
  }
  const manifesto = Manifesto.safeParse(json);
  if (!manifesto.success) throw new ArquivoRecusado(CORROMPIDO);
  return manifesto.data;
}

/**
 * Lê e valida cada chave pelo schema da Config. Uma chave inválida recusa o arquivo
 * inteiro, antes de qualquer gravação. Chave que este Moductus não conhece (de uma versão
 * mais nova, mesmo formato) é ignorada.
 */
function lerConfigDoArquivo(arquivos: Record<string, Uint8Array>): MudancaConfig {
  const manifesto = conferirManifesto(lerJson(arquivos, MANIFESTO));
  if (!manifesto.conteudo.includes("config")) {
    throw new ArquivoRecusado("Este arquivo não traz configurações.");
  }
  const json = lerJson(arquivos, CONFIG);
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ArquivoRecusado(CORROMPIDO);
  const chaves: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(json)) {
    if (!(chave in Config.shape)) continue;
    const campo = Config.shape[chave as keyof Config].safeParse(valor);
    if (!campo.success) {
      throw new ArquivoRecusado(
        `A configuração "${chave}" do arquivo é inválida (${campo.error.issues[0]?.message ?? "formato inesperado"}). Nada foi importado.`,
      );
    }
    chaves[chave] = campo.data;
  }
  return chaves as MudancaConfig;
}
