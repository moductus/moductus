import type { DatabaseSync } from "node:sqlite";
import {
  Atalhos,
  CONFIG_PADRAO,
  Config,
  MudancaConfig,
  type EstadoConfig,
  type MudancaConfig as Mudanca,
} from "@moductus/contrato";

/** O que só a casca sabe fazer: posicionar o dock, registrar atalhos, ligar o autostart. */
export interface AplicadorNativo {
  /** Aplica a configuração; rejeita com o motivo se a casca recusar (atalho em conflito). */
  aplicar(config: Config, mudou: (keyof Config)[]): Promise<{ falhasAtalhos: Record<string, string> }>;
}

const NATIVAS: (keyof Config)[] = ["dock", "atalhos", "autostart"];

export const AUTOSTART_NO_PORTABLE =
  "No modo portable o Moductus não inicia com o Windows. Instale para ligar esta opção.";

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** O que cada atalho faz, com as palavras da casca (`src-tauri/src/atalhos.rs`). */
const ACAO_DO_ATALHO: Readonly<Record<keyof Atalhos, string>> = {
  sistema: "abrir o Sistema",
  dock: "mostrar o dock",
  captura: "abrir a captura",
  foco: "iniciar ou pausar o foco",
};

/** A combinação sem caixa, espaço nem ordem dos modificadores: "Alt+Ctrl+p" é "Ctrl+Alt+P". */
function normalizarAtalho(combinacao: string): string {
  const partes = combinacao.toLowerCase().replace(/\s+/g, "").split("+");
  const tecla = partes.pop() ?? "";
  return [...partes.map((p) => (p === "control" ? "ctrl" : p)).sort(), tecla].join("+");
}

/** Qual outro atalho já usa a combinação, ou `null`. */
export function atalhoQueUsa(
  atalhos: Atalhos,
  combinacao: string,
  exceto: keyof Atalhos,
): keyof Atalhos | null {
  if (combinacao === "") return null;
  const alvo = normalizarAtalho(combinacao);
  for (const acao of Object.keys(ACAO_DO_ATALHO) as (keyof Atalhos)[]) {
    if (acao !== exceto && atalhos[acao] !== "" && normalizarAtalho(atalhos[acao]) === alvo) return acao;
  }
  return null;
}

/** Por que o foco está sem atalho, para `falhasAtalhos.foco`. */
export function motivoDoFocoSemAtalho(atalhos: Atalhos): string {
  const padrao = CONFIG_PADRAO.atalhos.foco;
  const outro = atalhoQueUsa(atalhos, padrao, "foco");
  if (outro === null) return "O foco está sem atalho. Escolha um em Configurações.";
  return `${padrao} já é o atalho para ${ACAO_DO_ATALHO[outro]}, então o foco ficou sem atalho. Escolha outro em Configurações.`;
}

/**
 * O valor guardado de uma chave por cima do padrão dela, campo a campo: o que foi salvo por uma
 * versão anterior (os atalhos sem o do foco) ganha só o que falta e fica com o resto. O atalho que
 * chega pelo padrão e colide com um que o usuário já tinha salvo fica vazio: o dele vale.
 */
export function completarComPadrao(chave: keyof Config, valor: unknown): unknown {
  const juntar = (padrao: unknown, salvo: unknown): unknown => {
    if (!ehObjeto(padrao) || !ehObjeto(salvo)) return salvo;
    const junto: Record<string, unknown> = { ...padrao };
    for (const [campo, v] of Object.entries(salvo)) junto[campo] = juntar(padrao[campo], v);
    return junto;
  };
  const junto = juntar(CONFIG_PADRAO[chave], valor);
  if (chave === "atalhos" && ehObjeto(valor) && !("foco" in valor)) {
    const atalhos = Atalhos.safeParse(junto);
    if (atalhos.success && atalhoQueUsa(atalhos.data, atalhos.data.foco, "foco") !== null) {
      return { ...atalhos.data, foco: "" };
    }
  }
  return junto;
}

/** Leitura e gravação da tabela config: uma linha por chave de primeiro nível. */
export class RepositorioConfig {
  constructor(private readonly db: DatabaseSync) {}

  /** Chave ausente ou inválida volta ao padrão, sem derrubar o resto. */
  ler(): Config {
    const linhas = this.db.prepare("SELECT chave, valor FROM config").all() as {
      chave: string;
      valor: string;
    }[];
    const config: Record<string, unknown> = { ...CONFIG_PADRAO };
    for (const { chave, valor } of linhas) {
      if (!(chave in CONFIG_PADRAO)) continue;
      const campo = Config.shape[chave as keyof Config].safeParse(
        completarComPadrao(chave as keyof Config, JSON.parse(valor)),
      );
      if (campo.success) config[chave] = campo.data;
    }
    return Config.parse(config);
  }

  gravar(mudanca: Mudanca): void {
    const upsert = this.db.prepare(
      `INSERT INTO config (chave, valor) VALUES (?, ?)
       ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor,
         atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    );
    this.db.exec("BEGIN");
    try {
      for (const [chave, valor] of Object.entries(mudanca)) upsert.run(chave, JSON.stringify(valor));
      this.db.exec("COMMIT");
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/**
 * A regra da configuração: valida, pede à casca o que é nativo e só grava se ela aceitar.
 * Assim um atalho em conflito volta com o motivo e o anterior continua salvo e valendo.
 */
export class ServicoConfig {
  private falhasAtalhos: Record<string, string> = {};

  constructor(
    private readonly repo: RepositorioConfig,
    private readonly nativo: AplicadorNativo,
    private readonly emitir: (estado: EstadoConfig) => void,
    private readonly portable: boolean,
  ) {}

  obter(): EstadoConfig {
    const config = this.repo.ler();
    // O foco sem atalho não é recusa da casca (nada foi pedido a ela), mas aparece igual.
    const falhasAtalhos =
      config.atalhos.foco === ""
        ? { ...this.falhasAtalhos, foco: motivoDoFocoSemAtalho(config.atalhos) }
        : this.falhasAtalhos;
    return { config, portable: this.portable, falhasAtalhos };
  }

  /** Ao subir: a casca recebe a configuração salva (lado do dock, atalhos, autostart). */
  async aplicarAoSubir(): Promise<void> {
    const r = await this.nativo.aplicar(this.repo.ler(), NATIVAS);
    this.falhasAtalhos = r.falhasAtalhos;
    this.emitir(this.obter());
  }

  async definir(entrada: Mudanca): Promise<EstadoConfig> {
    const mudanca = MudancaConfig.parse(entrada);
    // A cópia portable roda de um pendrive ou pasta solta: não se registra no Windows.
    if (this.portable && mudanca.autostart === true) throw new Error(AUTOSTART_NO_PORTABLE);
    const nova = Config.parse({ ...this.repo.ler(), ...mudanca });
    const nativasMudadas = NATIVAS.filter((k) => k in mudanca);
    if (nativasMudadas.length > 0) {
      const r = await this.nativo.aplicar(nova, nativasMudadas);
      this.falhasAtalhos = r.falhasAtalhos;
    }
    this.repo.gravar(mudanca);
    const estado = this.obter();
    this.emitir(estado);
    return estado;
  }
}
