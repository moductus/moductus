import type { TipoProvedor } from "@moductus/contrato";
import type { ConfigProvedor, EventoAgente, Provedor } from "./provedor.ts";

/** Monta o adaptador de um tipo a partir da linha configurada. */
export type FabricaProvedor = (config: ConfigProvedor) => Provedor;

const mesmaConfig = (a: ConfigProvedor, b: ConfigProvedor) =>
  a.tipo === b.tipo && a.modelo === b.modelo && a.baseUrl === b.baseUrl && a.credencial === b.credencial;

/**
 * Qual adaptador atende cada tipo de provedor. O runtime pede pelo provedor configurado e recebe
 * sempre um `Provedor`: tipo sem adaptador nesta versão vira um provedor que falha com `ausente`,
 * e o agente dorme em vez de quebrar. Os testes registram o falso no lugar dos reais.
 */
export class RegistroProvedores {
  private readonly fabricas = new Map<TipoProvedor, FabricaProvedor>();
  /** Um adaptador por provedor, reaproveitado enquanto a configuração não muda. */
  private readonly criados = new Map<string, { config: ConfigProvedor; provedor: Provedor }>();

  registrar(tipo: TipoProvedor, fabrica: FabricaProvedor): this {
    this.fabricas.set(tipo, fabrica);
    for (const [id, { config }] of this.criados) if (config.tipo === tipo) this.criados.delete(id);
    return this;
  }

  obter(config: ConfigProvedor): Provedor {
    const criado = this.criados.get(config.id);
    if (criado && mesmaConfig(criado.config, config)) return criado.provedor;
    const fabrica = this.fabricas.get(config.tipo);
    const provedor = fabrica ? fabrica(config) : provedorAusente(config);
    this.criados.set(config.id, { config: { ...config }, provedor });
    return provedor;
  }

  /** O provedor saiu da configuração (removido ou na lixeira). */
  esquecer(id: string): void {
    this.criados.delete(id);
  }
}

function provedorAusente(config: ConfigProvedor): Provedor {
  return {
    id: config.id,
    async *executar(): AsyncIterable<EventoAgente> {
      yield {
        tipo: "erro",
        falha: {
          motivo: "ausente",
          mensagem: `Esta versão do Moductus ainda não fala com ${config.tipo}. Escolha outro modelo para o agente.`,
          voltaEm: null,
        },
      };
    },
  };
}
