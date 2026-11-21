import type { DatabaseSync } from "node:sqlite";
import {
  AcaoRotina,
  LinhaRotina,
  Tarefa,
  type ApresentacaoRotina,
  type TipoRotina,
} from "@moductus/contrato";
import { z } from "zod";
import { novoId } from "../../banco/ulid.ts";

/**
 * O registro das rotinas (`rotinas_registro`, migração 014, ADR-0039): cada vez que o briefing ou o
 * fechamento apareceu, com o que foi mostrado (a abertura e as linhas, em JSON) e a ação escolhida.
 * Uma por rotina e dia. A linha é gravada em nome da Alba, que monta as duas; `da_execucao_id` é a
 * execução dela que redigiu a abertura, vazio quando saiu a frase de molde.
 */

/** O que fica em `conteudo`. */
const Conteudo = z.object({
  abertura: z.string().trim().min(1),
  linhas: z.array(LinhaRotina),
  abertas: z.array(Tarefa),
});
type Conteudo = z.infer<typeof Conteudo>;

/** O que se grava quando a rotina aparece. */
export interface NovoRegistroRotina extends Conteudo {
  rotinaId: string;
  dia: string;
  daExecucaoId: string | null;
}

interface LinhaRegistro {
  id: string;
  rotina_id: string;
  dia: string;
  conteudo: string;
  acao: string | null;
  acao_em: string | null;
  da_execucao_id: string | null;
  criado_em: string;
}

const COLUNAS = "id, rotina_id, dia, conteudo, acao, acao_em, da_execucao_id, criado_em";

/** As duas rotinas têm o id igual ao tipo (migração 014); outro id não é rotina que este código conhece. */
const tipoDa = (rotinaId: string): TipoRotina | null =>
  rotinaId === "briefing" || rotinaId === "fechamento" ? rotinaId : null;

export class RepositorioRegistroRotinas {
  constructor(
    private readonly db: DatabaseSync,
    private readonly agora: () => Date = () => new Date(),
    private readonly gerarId: () => string = novoId,
  ) {}

  /** A vez da rotina no dia, se já apareceu e o que foi gravado ainda se lê. */
  doDia(rotinaId: string, dia: string): ApresentacaoRotina | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM rotinas_registro WHERE rotina_id = ? AND dia = ?`)
      .get(rotinaId, dia) as LinhaRegistro | undefined;
    return linha ? paraApresentacao(linha) : null;
  }

  porId(id: string): ApresentacaoRotina | null {
    const linha = this.db.prepare(`SELECT ${COLUNAS} FROM rotinas_registro WHERE id = ?`).get(id) as
      LinhaRegistro | undefined;
    return linha ? paraApresentacao(linha) : null;
  }

  /**
   * Grava a vez da rotina. A do mesmo dia que já está lá fica (a segunda atividade não repete o
   * briefing): volta a gravada.
   */
  gravar(novo: NovoRegistroRotina): ApresentacaoRotina {
    const conteudo: Conteudo = { abertura: novo.abertura, linhas: novo.linhas, abertas: novo.abertas };
    const agora = this.agora().toISOString();
    this.db
      .prepare(
        `INSERT INTO rotinas_registro (id, rotina_id, dia, conteudo, da_execucao_id, criado_em, atualizado_em,
           origem, agente_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'agente', 'alba')
         ON CONFLICT (rotina_id, dia) DO NOTHING`,
      )
      .run(
        this.gerarId(),
        novo.rotinaId,
        novo.dia,
        JSON.stringify(conteudo),
        novo.daExecucaoId,
        agora,
        agora,
      );
    const gravada = this.doDia(novo.rotinaId, novo.dia);
    if (!gravada) throw new Error(`o registro da rotina ${novo.rotinaId} de ${novo.dia} não se lê`);
    return gravada;
  }

  /** A ação escolhida (ou `ignorado`), com a hora: a última vale. */
  agir(id: string, acao: AcaoRotina): ApresentacaoRotina | null {
    const agora = this.agora().toISOString();
    this.db
      .prepare("UPDATE rotinas_registro SET acao = ?, acao_em = ?, atualizado_em = ? WHERE id = ?")
      .run(acao, agora, agora, id);
    return this.porId(id);
  }

  /**
   * As vezes da rotina de antes de `antesDe` que ficaram sem ação fecham sozinhas: `ignorado`, com a
   * hora. Quem chama é a rotina seguinte, ao aparecer (AGENTS.md §2 "Se você ignorar"). A adiada
   * não entra: teve resposta. Devolve quantas fecharam.
   */
  fecharSozinhas(rotinaId: string, antesDe: string): number {
    const agora = this.agora().toISOString();
    const r = this.db
      .prepare(
        `UPDATE rotinas_registro SET acao = 'ignorado', acao_em = ?, atualizado_em = ?
          WHERE rotina_id = ? AND dia < ? AND acao IS NULL`,
      )
      .run(agora, agora, rotinaId, antesDe);
    return Number(r.changes);
  }

  /** As ações das últimas `quantas` vezes da rotina antes de `antesDe`, da mais recente para trás. */
  ultimasAcoes(rotinaId: string, antesDe: string, quantas: number): (string | null)[] {
    const linhas = this.db
      .prepare("SELECT acao FROM rotinas_registro WHERE rotina_id = ? AND dia < ? ORDER BY dia DESC LIMIT ?")
      .all(rotinaId, antesDe, quantas) as { acao: string | null }[];
    return linhas.map((l) => l.acao);
  }

  /**
   * A rotina adiada que volta: o que se mostra é montado de novo e a ação some, como se tivesse
   * acabado de aparecer.
   */
  reabrir(id: string, novo: Omit<NovoRegistroRotina, "rotinaId" | "dia">): ApresentacaoRotina | null {
    const conteudo: Conteudo = { abertura: novo.abertura, linhas: novo.linhas, abertas: novo.abertas };
    const agora = this.agora().toISOString();
    this.db
      .prepare(
        `UPDATE rotinas_registro SET conteudo = ?, da_execucao_id = ?, acao = NULL, acao_em = NULL,
           atualizado_em = ? WHERE id = ?`,
      )
      .run(JSON.stringify(conteudo), novo.daExecucaoId, agora, id);
    return this.porId(id);
  }
}

function paraApresentacao(l: LinhaRegistro): ApresentacaoRotina | null {
  const tipo = tipoDa(l.rotina_id);
  if (tipo === null) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(l.conteudo);
  } catch {
    return null;
  }
  const conteudo = Conteudo.safeParse(bruto);
  const acao = l.acao === null ? null : AcaoRotina.safeParse(l.acao);
  if (!conteudo.success || (acao !== null && !acao.success)) {
    console.error(`rotinas: o registro ${l.id} não se lê; fica de fora`);
    return null;
  }
  return {
    id: l.id,
    rotinaId: l.rotina_id,
    tipo,
    dia: l.dia,
    abertura: conteudo.data.abertura,
    daExecucaoId: l.da_execucao_id,
    linhas: conteudo.data.linhas,
    abertas: conteudo.data.abertas,
    acao: acao === null ? null : acao.data,
    acaoEm: l.acao_em,
    criadoEm: l.criado_em,
  };
}
