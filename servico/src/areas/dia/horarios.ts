import type { DatabaseSync } from "node:sqlite";
import { MudancaRotina, Rotina, type MudancaRotina as Mudanca, type TipoRotina } from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";

/**
 * Quando o briefing e o fechamento saem (Configurações › O dia, ConfigDia.dc.html; tabela
 * `rotinas` da migração 014): a hora, os dias e se estão ligados. Quem lê é a primeira atividade
 * (`atividade.ts`) e o vigia da Alba (`agentes/vigias/alba.ts`), a cada sinal e a cada vez que o
 * relógio do dia se arma; por isso mudar aqui rearma o relógio, e a hora de parar nova vale já hoje.
 *
 * Os dias da semana são os dias de trabalho, um só conjunto: valem para as duas rotinas e para o
 * expediente em que a agenda procura horário livre (`RepositorioRotinas.diasDeTrabalho`).
 */

export const MENSAGEM_ROTINA_NAO_ENCONTRADA = "Essa rotina não existe mais.";
export const MENSAGEM_FECHAMENTO_SEM_HORA = "O fechamento precisa de uma hora de parar.";

/** De 1 (segunda) a 7 (domingo): sem dias de trabalho conhecidos, todos contam. */
export const TODOS_OS_DIAS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

interface LinhaRotina {
  id: string;
  tipo: string;
  hora: string | null;
  dias_semana: string;
  ativa: number;
}

/** Os dias como ficam gravados: sem repetição, de segunda a domingo. */
const emOrdem = (dias: readonly number[]) => [...new Set(dias)].sort((a, b) => a - b);

export class RepositorioRotinas {
  constructor(
    private readonly db: DatabaseSync,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** As rotinas fora da lixeira, o briefing antes do fechamento; a linha que não se lê fica de fora. */
  listar(): Rotina[] {
    const linhas = this.db
      .prepare(
        `SELECT id, tipo, hora, dias_semana, ativa FROM rotinas WHERE apagado_em IS NULL
          ORDER BY CASE tipo WHEN 'briefing' THEN 0 ELSE 1 END, id`,
      )
      .all() as unknown as LinhaRotina[];
    return linhas.flatMap((l) => {
      const rotina = paraRotina(l);
      return rotina ? [rotina] : [];
    });
  }

  porId(id: string): Rotina | null {
    return this.listar().find((r) => r.id === id) ?? null;
  }

  /**
   * Os dias de trabalho, de 1 (segunda) a 7 (domingo): os das rotinas (gravados juntos, os
   * mesmos nas duas; se um dia divergirem, vale a soma). Sem rotina, todos.
   */
  diasDeTrabalho(): number[] {
    const dias = emOrdem(this.listar().flatMap((r) => r.diasSemana));
    return dias.length > 0 ? dias : [...TODOS_OS_DIAS];
  }

  /**
   * Grava a hora e o ligado de uma rotina e, se vierem, os dias em todas, numa transação: os dias
   * de trabalho nunca ficam pela metade.
   */
  gravar(
    id: string,
    campos: { hora: string | null; ativa: boolean },
    dias: number[] | null,
    carimbo: Carimbo,
  ) {
    const agora = this.agora().toISOString();
    const origem = colunasDeOrigem(carimbo);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE rotinas SET hora = ?, ativa = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
            WHERE id = ? AND apagado_em IS NULL`,
        )
        .run(
          campos.hora,
          campos.ativa ? 1 : 0,
          agora,
          origem.origem,
          origem.agente_id,
          origem.execucao_id,
          id,
        );
      if (dias !== null) {
        this.db
          .prepare(
            `UPDATE rotinas SET dias_semana = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
              WHERE apagado_em IS NULL AND dias_semana <> ?`,
          )
          .run(
            JSON.stringify(dias),
            agora,
            origem.origem,
            origem.agente_id,
            origem.execucao_id,
            JSON.stringify(dias),
          );
      }
      this.db.exec("COMMIT");
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

function paraRotina(l: LinhaRotina): Rotina | null {
  let dias: unknown;
  try {
    dias = JSON.parse(l.dias_semana);
  } catch {
    dias = null;
  }
  const rotina = Rotina.safeParse({
    id: l.id,
    tipo: l.tipo as TipoRotina,
    hora: l.hora,
    diasSemana: Array.isArray(dias) ? emOrdem(dias as number[]) : dias,
    ativa: l.ativa === 1,
  });
  if (!rotina.success) {
    console.error(`rotinas: a rotina ${l.id} não se lê; fica de fora`);
    return null;
  }
  return rotina.data;
}

export interface DependenciasRotinas {
  repo: RepositorioRotinas;
  /** As rotinas como ficaram (`rotinas.mudou`). */
  emitir: (rotinas: Rotina[]) => void;
  /** O relógio do dia: a hora nova arma o timer de novo, e vale já hoje. */
  relogio: { mudou(): void };
}

export class ServicoRotinas {
  constructor(private readonly deps: DependenciasRotinas) {}

  listar(): Rotina[] {
    return this.deps.repo.listar();
  }

  /**
   * Muda a hora (vazia no briefing é a primeira atividade), os dias de trabalho ou o ligado. Os
   * dias que vierem valem para as duas rotinas. Sem nada diferente do gravado, nada se grava nem
   * se avisa.
   */
  definir(entrada: Mudanca, carimbo: Carimbo = DO_USUARIO): Rotina {
    const mudanca = MudancaRotina.parse(entrada);
    const atual = this.deps.repo.porId(mudanca.id);
    if (!atual) throw new Error(MENSAGEM_ROTINA_NAO_ENCONTRADA);
    const hora = mudanca.hora === undefined ? atual.hora : mudanca.hora;
    if (atual.tipo === "fechamento" && hora === null) throw new Error(MENSAGEM_FECHAMENTO_SEM_HORA);
    const ativa = mudanca.ativa ?? atual.ativa;
    const dias = mudanca.diasSemana === undefined ? null : emOrdem(mudanca.diasSemana);
    const todas = this.deps.repo.listar();
    const mudaDias =
      dias !== null && todas.some((r) => JSON.stringify(r.diasSemana) !== JSON.stringify(dias));
    if (hora === atual.hora && ativa === atual.ativa && !mudaDias) return atual;

    this.deps.repo.gravar(atual.id, { hora, ativa }, mudaDias ? dias : null, carimbo);
    const rotinas = this.deps.repo.listar();
    this.deps.emitir(rotinas);
    this.deps.relogio.mudou();
    const gravada = rotinas.find((r) => r.id === atual.id);
    if (!gravada) throw new Error(MENSAGEM_ROTINA_NAO_ENCONTRADA);
    return gravada;
  }
}
