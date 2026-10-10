import type { DatabaseSync } from "node:sqlite";
import {
  AGENTES_DE_FABRICA,
  type Agente,
  type Capacidade,
  type ConfigAgente,
  type EstadoAgente,
  type Gatilho,
  type MotivoSono,
  type MudancaAgente,
  type PedidoAgente,
  type PedidoLigarAgente,
  type PedidoPausar,
  type PedidoRetomar,
  type Personagem,
  type SituacaoAgente,
  type TipoProvedor,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO } from "../banco/tabela.ts";
import type { Catalogo } from "../ferramentas/catalogo.ts";
import type { ConfigProvedor } from "../provedores/provedor.ts";
import type { EstadosAgentes } from "./estado.ts";

/** Um agente como está no banco: a configuração e o estado guardado, sem o que o runtime vê agora. */
export interface AgenteGuardado extends ConfigAgente {
  id: string;
  deFabrica: boolean;
  estado: EstadoAgente;
  dormeAte: string | null;
  /** Por que dorme; `null` fora do sono. Sem modelo não é guardado: vem de `provedorId`. */
  motivoSono: MotivoSonoGuardado | null;
  pausadoAte: string | null;
}

/** O motivo do sono que fica no banco (migração 011). */
export type MotivoSonoGuardado = Exclude<MotivoSono, "sem_modelo">;

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
  motivo_sono: MotivoSonoGuardado | null;
  pausado_ate: string | null;
  de_fabrica: number;
}

const COLUNAS_AGENTE = `id, nome, funcao, instrucoes, personagem, ferramentas, provedor_id, provedor_reserva_id,
  gatilhos, escopos_memoria, teto_diario_centavos, estado, dorme_ate, motivo_sono, pausado_ate, de_fabrica`;

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
  motivoSono: l.motivo_sono,
  pausadoAte: l.pausado_ate,
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

  /** Grava o modelo do agente (principal, reserva e teto), com o usuário como origem. */
  definirModelo(id: string, modelo: ModeloAgente, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `UPDATE agentes SET provedor_id = ?, provedor_reserva_id = ?, teto_diario_centavos = ?,
                atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        modelo.provedorId,
        modelo.provedorReservaId,
        modelo.tetoDiarioCentavos,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        id,
      );
  }

  /**
   * Muda o estado guardado do agente, só se ele está num dos estados `de`: o sono que uma execução
   * pede não passa por cima da pausa nem do desligado. `pelo` diz quem mudou (o carimbo de origem):
   * o usuário pausando, ou o próprio agente dormindo e acordando. Devolve se mudou.
   */
  mudarEstado(
    id: string,
    para: EstadoGuardado,
    de: readonly EstadoAgente[],
    pelo: "usuario" | "agente",
    agora: string,
  ): boolean {
    const marcas = de.map(() => "?").join(", ");
    const r = this.db
      .prepare(
        `UPDATE agentes
            SET estado = ?, dorme_ate = ?, motivo_sono = ?, pausado_ate = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = NULL
          WHERE id = ? AND apagado_em IS NULL AND estado IN (${marcas})`,
      )
      .run(
        para.estado,
        para.dormeAte,
        para.motivoSono,
        para.pausadoAte,
        agora,
        pelo,
        pelo === "agente" ? id : null,
        id,
        ...de,
      );
    return Number(r.changes) > 0;
  }
}

/** O estado como fica guardado: cada data e o motivo só existem no estado deles. */
export type EstadoGuardado =
  | { estado: "ativo" | "desligado"; dormeAte: null; motivoSono: null; pausadoAte: null }
  | { estado: "dormindo"; dormeAte: string | null; motivoSono: MotivoSonoGuardado; pausadoAte: null }
  | { estado: "pausado"; dormeAte: null; motivoSono: null; pausadoAte: string | null };

/** O que o runtime vê de um agente agora (fila, trabalhando, esperando você). */
export type SituacaoDe = (agente: AgenteGuardado) => SituacaoAgente;

/** Quem muda o estado guardado (estado.ts), soltando ou recusando quem espera a vez. */
export type MudarEstados = Pick<EstadosAgentes, "ligar" | "pausar" | "retomar" | "modeloMudou">;

/** O modelo de um agente: o provedor principal, a reserva e o teto de gasto por dia. */
export type ModeloAgente = Pick<ConfigAgente, "provedorId" | "provedorReservaId" | "tetoDiarioCentavos">;

/** Os campos que `agentes.definir` muda por enquanto (Configurações › Modelos, F2-32). */
const CAMPOS_DO_MODELO: readonly string[] = ["provedorId", "provedorReservaId", "tetoDiarioCentavos"];

/** Ditos ao usuário na tela de Modelos (AGENTS.md §2 Voz: o que houve e o que fazer). */
export const MENSAGEM_SO_MODELO = "Por aqui só mudam o modelo, a reserva e o teto do agente.";
export const MENSAGEM_PROVEDOR_SAIU = "Esse provedor não existe mais. Escolha outro.";
export const MENSAGEM_RESERVA_IGUAL = "A reserva precisa ser outro provedor, não o principal.";
export const MENSAGEM_RESERVA_SEM_PRINCIPAL = "Escolha o principal antes da reserva.";
/**
 * O teto fica desligado até a moeda dele ser decidida: o custo é medido em dólar e o teto em
 * centavos de uma moeda que ainda não existe. Gravar um valor seria prometer um limite que não vale.
 */
export const MENSAGEM_TETO_SEM_MOEDA = "O teto por dia ainda não vale: falta decidir a moeda dele.";

/** Os agentes como a interface vê: configuração, estado e o que estão fazendo agora. */
export class ServicoAgentes {
  private readonly agora: () => Date;

  constructor(
    private readonly repo: RepositorioAgentes,
    private readonly catalogo: Catalogo,
    private readonly situacao: SituacaoDe,
    private readonly estados: MudarEstados,
    agora?: () => Date,
  ) {
    this.agora = agora ?? (() => new Date());
  }

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

  /** Desligado não roda nada, nem o que esperava a vez; ligado volta ativo. */
  ligar(pedido: PedidoLigarAgente): Agente {
    this.estados.ligar(pedido.id, pedido.ligado);
    return this.obter({ id: pedido.id });
  }

  /** Pausa um agente ou o time; os pedidos esperam e rodam ao retomar. Devolve quem ficou pausado. */
  pausar(pedido: PedidoPausar): Agente[] {
    return this.daLista(this.estados.pausar(pedido.agenteId, pedido.ate));
  }

  /** Retoma um agente ou o time; a fila de cada um roda. Devolve quem retomou. */
  retomar(pedido: PedidoRetomar): Agente[] {
    return this.daLista(this.estados.retomar(pedido.agenteId));
  }

  /**
   * Troca o modelo do agente: principal, reserva e teto por dia (Configurações › Modelos). Vale na
   * próxima execução: o runtime lê a configuração na vez de cada pedido, e a que está rodando
   * termina no modelo de antes. Trocar o principal ou a reserva esquece a falha do provedor de
   * antes (estado.ts). O teto fica desligado enquanto a moeda dele não for decidida.
   */
  definir(mudanca: MudancaAgente): Agente {
    const atual = this.repo.agente(mudanca.id);
    if (!atual) throw new Error("agente não encontrado");
    const fora = Object.keys(mudanca).filter((c) => c !== "id" && !CAMPOS_DO_MODELO.includes(c));
    if (fora.length > 0) throw new Error(MENSAGEM_SO_MODELO);
    const novo: ModeloAgente = {
      provedorId: mudanca.provedorId === undefined ? atual.provedorId : mudanca.provedorId,
      provedorReservaId:
        mudanca.provedorReservaId === undefined ? atual.provedorReservaId : mudanca.provedorReservaId,
      tetoDiarioCentavos:
        mudanca.tetoDiarioCentavos === undefined ? atual.tetoDiarioCentavos : mudanca.tetoDiarioCentavos,
    };
    if (mudanca.tetoDiarioCentavos !== undefined && mudanca.tetoDiarioCentavos !== null) {
      throw new Error(MENSAGEM_TETO_SEM_MOEDA);
    }
    // Só o que muda precisa existir: o de antes que saiu continua até o usuário trocar.
    for (const id of [mudanca.provedorId, mudanca.provedorReservaId]) {
      if (typeof id === "string" && !this.repo.provedor(id)) throw new Error(MENSAGEM_PROVEDOR_SAIU);
    }
    if (novo.provedorReservaId !== null) {
      if (novo.provedorId === null) throw new Error(MENSAGEM_RESERVA_SEM_PRINCIPAL);
      if (novo.provedorReservaId === novo.provedorId) throw new Error(MENSAGEM_RESERVA_IGUAL);
    }
    const trocouModelo =
      novo.provedorId !== atual.provedorId || novo.provedorReservaId !== atual.provedorReservaId;
    this.repo.definirModelo(atual.id, novo, this.agora().toISOString());
    if (trocouModelo) this.estados.modeloMudou(atual.id);
    return this.obter({ id: atual.id });
  }

  /** O recorte do catálogo que o agente enxerga, como a lista `/capacidades` mostra. */
  capacidades(pedido: PedidoAgente): Capacidade[] {
    const agente = this.repo.agente(pedido.id);
    if (!agente) throw new Error("agente não encontrado");
    return this.catalogo.doAgente(agente.ferramentas).capacidades();
  }

  private daLista(ids: readonly string[]): Agente[] {
    return ids.flatMap((id) => this.procurar(id) ?? []);
  }

  private comSituacao(agente: AgenteGuardado): Agente {
    const {
      estado: _estado,
      dormeAte: _dormeAte,
      motivoSono: _motivoSono,
      pausadoAte: _pausadoAte,
      ...config
    } = agente;
    return { ...config, situacao: this.situacao(agente) };
  }
}
