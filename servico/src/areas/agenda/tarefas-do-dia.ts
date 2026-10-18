import type { DatabaseSync } from "node:sqlite";
import { colunasDeOrigem, type Carimbo } from "../../banco/tabela.ts";
import type { TarefaDoDia } from "./livre.ts";

/**
 * O pouco que a agenda lê e grava em `tarefas` (migração 013): as abertas com dia, para o planejado
 * e o encaixe, e a ligação da tarefa com o evento do encaixe. A área Tarefas (F3-15) é a dona da
 * tabela; aqui ficam só essas consultas, direto no banco, para a agenda não esperar por ela.
 *
 * A ligação é `tarefas.evento_id`, que já existe: na tarefa com hora ela aponta para o espelho no
 * "Moductus" (F3-24); na tarefa sem hora, para o evento do encaixe aplicado. O encaixe só vale para
 * tarefa sem hora, então os dois usos não se cruzam.
 */

interface LinhaTarefaDoDia {
  id: string;
  vence_em: string;
  hora: string | null;
  duracao_estimada_min: number | null;
  prioridade: number;
  ordem: number;
  na_agenda: number;
  coberta_pela_mae: number;
}

/** A tarefa que o encaixe vai ligar, com o evento a que ela já está ligada, se vivo. */
export interface TarefaDoEncaixe {
  id: string;
  titulo: string;
  estado: string;
  hora: string | null;
  eventoVivoId: string | null;
}

export class RepositorioTarefasDoDia {
  constructor(private readonly db: DatabaseSync) {}

  /** As abertas, fora da lixeira, que vencem até `ate` (as atrasadas inclusive). */
  abertasAte(ate: string): TarefaDoDia[] {
    const linhas = this.db
      .prepare(
        `SELECT t.id, t.vence_em, t.hora, t.duracao_estimada_min, t.prioridade, t.ordem,
                (ev.id IS NOT NULL) AS na_agenda,
                (m.id IS NOT NULL AND m.estado = 'aberta' AND m.apagado_em IS NULL
                  AND m.duracao_estimada_min IS NOT NULL) AS coberta_pela_mae
           FROM tarefas t
           LEFT JOIN eventos ev ON ev.id = t.evento_id AND ev.apagado_em IS NULL
           LEFT JOIN tarefas m ON m.id = t.tarefa_pai_id
          WHERE t.estado = 'aberta' AND t.apagado_em IS NULL AND t.vence_em IS NOT NULL AND t.vence_em <= ?
          ORDER BY t.vence_em, t.ordem, t.id`,
      )
      .all(ate) as unknown as LinhaTarefaDoDia[];
    return linhas.map((l) => ({
      id: l.id,
      venceEm: l.vence_em,
      hora: l.hora,
      duracaoMin: l.duracao_estimada_min,
      prioridade: l.prioridade,
      ordem: l.ordem,
      naAgenda: l.na_agenda === 1,
      cobertaPelaMae: l.coberta_pela_mae === 1,
    }));
  }

  tarefa(id: string): TarefaDoEncaixe | null {
    const linha = this.db
      .prepare(
        `SELECT t.id, t.titulo, t.estado, t.hora, ev.id AS evento_vivo_id
           FROM tarefas t LEFT JOIN eventos ev ON ev.id = t.evento_id AND ev.apagado_em IS NULL
          WHERE t.id = ? AND t.apagado_em IS NULL`,
      )
      .get(id) as
      | { id: string; titulo: string; estado: string; hora: string | null; evento_vivo_id: string | null }
      | undefined;
    if (!linha) return null;
    return {
      id: linha.id,
      titulo: linha.titulo,
      estado: linha.estado,
      hora: linha.hora,
      eventoVivoId: linha.evento_vivo_id,
    };
  }

  ligarEvento(tarefaId: string, eventoId: string, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE tarefas SET evento_id = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ?`,
      )
      .run(eventoId, agora, origem.origem, origem.agente_id, origem.execucao_id, tarefaId);
  }

  /** Solta a ligação só se ela ainda é com este evento: a tarefa pode ter sido ligada a outro. */
  desligarEvento(tarefaId: string, eventoId: string, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE tarefas SET evento_id = NULL, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND evento_id = ?`,
      )
      .run(agora, origem.origem, origem.agente_id, origem.execucao_id, tarefaId, eventoId);
  }
}
