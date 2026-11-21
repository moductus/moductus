import type { DatabaseSync } from "node:sqlite";
import type { TempoDoDia } from "./tempo.ts";

/**
 * A primeira atividade do dia no PC (ADR-0033; AGENTS.md §2 "Briefing da manhã"): é ela que abre
 * o briefing. Conta o primeiro sinal depois das 05:00 do dia civil no fuso de `config`: o
 * desbloqueio ou o logon da sessão (a casca avisa `atividade`), a volta da suspensão (`retomou`)
 * ou a subida do serviço. Quem escolheu horário fixo para o briefing (a `hora` da rotina, em
 * Configurações › O dia) tem o dia começando nessa hora, venha o sinal do relógio do dia (o vigia
 * da Alba, `agentes/vigias/alba.ts`) ou de uma atividade depois dela (o PC dormiu na hora marcada).
 *
 * Uma vez por dia: a segunda atividade não repete, nem a que vem depois de o briefing de hoje já
 * ter aparecido (`rotinas_registro`, que sobrevive ao serviço reiniciando). O briefing desligado ou
 * fora dos dias da semana dele não começa nada.
 */

/** Antes disso, desbloquear o PC é madrugada, não o começo do dia. */
export const HORA_DA_MANHA = "05:00";

/** Os ids das duas rotinas, iguais em todo PC (migração 014). */
export const BRIEFING = "briefing";
export const FECHAMENTO = "fechamento";

/**
 * O que acordou o dia: o que a casca avisou (`desbloqueio`, `logon`), a volta da suspensão, a
 * subida do serviço ou, no horário fixo, o relógio.
 */
export type MotivoAtividade = "desbloqueio" | "logon" | "retomada" | "subida" | "horario";

const MOTIVOS_DA_CASCA = new Set<MotivoAtividade>(["desbloqueio", "logon"]);

/** O motivo que a casca mandou no aviso `atividade`; o desconhecido conta como desbloqueio. */
export function motivoDaCasca(aviso: Record<string, unknown>): MotivoAtividade {
  const motivo = aviso.motivo as MotivoAtividade;
  return MOTIVOS_DA_CASCA.has(motivo) ? motivo : "desbloqueio";
}

/** O que uma rotina diz sobre quando ela sai. */
export interface QuandoRotina {
  /** `HH:MM` no horário fixo; `null` é a primeira atividade (só o briefing; o fechamento tem hora). */
  hora: string | null;
  /** De 1 (segunda) a 7 (domingo), como a ISO 8601. */
  diasSemana: number[];
  ativa: boolean;
}

/** O dia que começou: qual, o que o acordou e quando. */
export interface InicioDoDia {
  dia: string;
  motivo: MotivoAtividade;
  em: string;
}

export class RepositorioAtividade {
  constructor(private readonly db: DatabaseSync) {}

  /** A rotina do briefing; `null` se foi para a lixeira. */
  briefing(): QuandoRotina | null {
    return this.rotina(BRIEFING);
  }

  /** A rotina do fechamento; `null` se foi para a lixeira. */
  fechamento(): QuandoRotina | null {
    return this.rotina(FECHAMENTO);
  }

  /** Se a rotina (o briefing, sem dizer qual) do dia já apareceu. */
  jaApareceu(dia: string, rotina: string = BRIEFING): boolean {
    return (
      this.db.prepare("SELECT 1 FROM rotinas_registro WHERE rotina_id = ? AND dia = ?").get(rotina, dia) !==
      undefined
    );
  }

  private rotina(id: string): QuandoRotina | null {
    const linha = this.db
      .prepare("SELECT hora, dias_semana, ativa FROM rotinas WHERE id = ? AND apagado_em IS NULL")
      .get(id) as { hora: string | null; dias_semana: string; ativa: number } | undefined;
    if (linha === undefined) return null;
    return {
      hora: linha.hora,
      diasSemana: JSON.parse(linha.dias_semana) as number[],
      ativa: linha.ativa === 1,
    };
  }
}

export class PrimeiraAtividade {
  /** O último dia que começou neste serviço: o registro só existe depois que o briefing aparece. */
  private comecou: string | null = null;

  constructor(
    private readonly repositorio: Pick<RepositorioAtividade, "briefing" | "jaApareceu">,
    private readonly tempo: TempoDoDia,
    /** Quem abre o dia (o briefing); se falhar, o próximo sinal tenta de novo. */
    private readonly aoComecar: (inicio: InicioDoDia) => unknown,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Um sinal de atividade. Devolve o dia que começou com ele, ou `null` se não conta. */
  sinal(motivo: MotivoAtividade): InicioDoDia | null {
    const briefing = this.repositorio.briefing();
    if (briefing === null || !briefing.ativa) return null;
    // Sem horário fixo, o relógio sozinho não começa o dia: falta alguém no PC.
    if (briefing.hora === null && motivo === "horario") return null;
    const { dia, hora, diaDaSemana } = this.tempo.momento();
    if (!briefing.diasSemana.includes(diaDaSemana === 0 ? 7 : diaDaSemana)) return null;
    if (hora < (briefing.hora ?? HORA_DA_MANHA)) return null;
    if (this.comecou === dia || this.repositorio.jaApareceu(dia)) return null;
    this.comecou = dia;
    const inicio: InicioDoDia = { dia, motivo, em: this.agora().toISOString() };
    let feito: unknown;
    try {
      feito = this.aoComecar(inicio);
    } catch (erro) {
      this.liberar(dia);
      throw erro;
    }
    if (feito instanceof Promise) {
      feito.catch((erro: unknown) => {
        console.error(`dia: o começo de ${dia} falhou; o próximo sinal tenta de novo: ${String(erro)}`);
        this.liberar(dia);
      });
    }
    return inicio;
  }

  /** O começo do dia falhou (o briefing não apareceu): o dia volta a poder começar. */
  private liberar(dia: string): void {
    if (this.comecou === dia) this.comecou = null;
  }
}
