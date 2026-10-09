import type { DatabaseSync } from "node:sqlite";
import {
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
      const campo = Config.shape[chave as keyof Config].safeParse(JSON.parse(valor));
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
    return { config: this.repo.ler(), portable: this.portable, falhasAtalhos: this.falhasAtalhos };
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
