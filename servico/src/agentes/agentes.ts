import type { DatabaseSync } from "node:sqlite";
import {
  AGENTES_DE_FABRICA,
  type Agente,
  type Capacidade,
  type ConfigAgente,
  type EstadoAgente,
  type Gatilho,
  type PedidoAgente,
  type Personagem,
  type SituacaoAgente,
  type TipoProvedor,
} from "@moductus/contrato";
import type { Catalogo } from "../ferramentas/catalogo.ts";
import type { ConfigProvedor } from "../provedores/provedor.ts";

/** Um agente como está no banco: a configuração e o estado guardado, sem o que o runtime vê agora. */
export interface AgenteGuardado extends ConfigAgente {
  id: string;
  deFabrica: boolean;
  estado: EstadoAgente;
  dormeAte: string | null;
}

interface LinhaAgente {
  id: string;
  nome: string;
  funcao: string;
  instrucoes: string;
  personagem: string;
  ferramentas: string;
  provedor_id: string | null;
  provedor_reserva_id: string | null;
  gatilhos: string;
  escopos_memoria: string;
  teto_diario_centavos: number | null;
  estado: EstadoAgente;
  dorme_ate: string | null;
  de_fabrica: number;
}

const COLUNAS_AGENTE = `id, nome, funcao, instrucoes, personagem, ferramentas, provedor_id, provedor_reserva_id,
  gatilhos, escopos_memoria, teto_diario_centavos, estado, dorme_ate, de_fabrica`;

/** Os de fábrica na ordem do time (AGENTS.md §2); os criados depois, na ordem em que nasceram. */
const ORDEM_DO_TIME = `CASE id ${AGENTES_DE_FABRICA.map((id, i) => `WHEN '${id}' THEN ${i}`).join(" ")} ELSE ${AGENTES_DE_FABRICA.length} END`;

const paraAgente = (l: LinhaAgente): AgenteGuardado => ({
  id: l.id,
  nome: l.nome,
  funcao: l.funcao,
  instrucoes: l.instrucoes,
  personagem: JSON.parse(l.personagem) as Personagem,
  ferramentas: JSON.parse(l.ferramentas) as string[],
  provedorId: l.provedor_id,
  provedorReservaId: l.provedor_reserva_id,
  gatilhos: JSON.parse(l.gatilhos) as Gatilho[],
  escoposMemoria: JSON.parse(l.escopos_memoria) as string[],
  tetoDiarioCentavos: l.teto_diario_centavos,
  estado: l.estado,
  dormeAte: l.dorme_ate,
  deFabrica: l.de_fabrica === 1,
});

interface LinhaProvedor {
  id: string;
  tipo: TipoProvedor;
  modelo: string | null;
  base_url: string | null;
  credencial: string | null;
}

/** Leitura de `agentes` e `provedores` (migração 003). O que está na lixeira não aparece. */
export class RepositorioAgentes {
  constructor(private readonly db: DatabaseSync) {}

  agentes(): AgenteGuardado[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_AGENTE} FROM agentes WHERE apagado_em IS NULL ORDER BY ${ORDEM_DO_TIME}, criado_em, id`,
      )
      .all() as unknown as LinhaAgente[];
    return linhas.map(paraAgente);
  }

  agente(id: string): AgenteGuardado | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_AGENTE} FROM agentes WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaAgente | undefined;
    return linha ? paraAgente(linha) : null;
  }

  /** A configuração com que o registro monta o adaptador; a credencial é só o nome no Gerenciador. */
  provedor(id: string): ConfigProvedor | null {
    const linha = this.db
      .prepare(
        "SELECT id, tipo, modelo, base_url, credencial FROM provedores WHERE id = ? AND apagado_em IS NULL",
      )
      .get(id) as unknown as LinhaProvedor | undefined;
    if (!linha) return null;
    return {
      id: linha.id,
      tipo: linha.tipo,
      modelo: linha.modelo,
      baseUrl: linha.base_url,
      credencial: linha.credencial,
    };
  }
}

/** O que o runtime vê de um agente agora (fila, trabalhando, esperando você). */
export type SituacaoDe = (agente: AgenteGuardado) => SituacaoAgente;

/** Os agentes como a interface vê: configuração, estado e o que estão fazendo agora. */
export class ServicoAgentes {
  constructor(
    private readonly repo: RepositorioAgentes,
    private readonly catalogo: Catalogo,
    private readonly situacao: SituacaoDe,
  ) {}

  listar(): Agente[] {
    return this.repo.agentes().map((a) => this.comSituacao(a));
  }

  obter(pedido: PedidoAgente): Agente {
    const agente = this.procurar(pedido.id);
    if (!agente) throw new Error("agente não encontrado");
    return agente;
  }

  /** O mesmo que {@link obter}, sem erro: para avisar a interface de um agente que pode ter saído. */
  procurar(id: string): Agente | null {
    const agente = this.repo.agente(id);
    return agente ? this.comSituacao(agente) : null;
  }

  /** O recorte do catálogo que o agente enxerga, como a lista `/capacidades` mostra. */
  capacidades(pedido: PedidoAgente): Capacidade[] {
    const agente = this.repo.agente(pedido.id);
    if (!agente) throw new Error("agente não encontrado");
    return this.catalogo.doAgente(agente.ferramentas).capacidades();
  }

  private comSituacao(agente: AgenteGuardado): Agente {
    const { estado: _estado, dormeAte: _dormeAte, ...config } = agente;
    return { ...config, situacao: this.situacao(agente) };
  }
}
