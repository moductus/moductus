import type { DatabaseSync } from "node:sqlite";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../../banco/tabela.ts";
import { novoId } from "../../../banco/ulid.ts";
import {
  CODIFICACOES,
  DECIMAIS,
  ErroDoCsv,
  mesmoCabecalho,
  FORMATOS_DATA,
  MapeamentoCsv,
  SEPARADORES,
  type Codificacao,
  type Decimal,
  type FormatoData,
  type Separador,
} from "./csv.ts";

/**
 * Perfis de CSV em `perfis_importacao` (migração 029, ADR-0041): reconhecer o banco pelo cabeçalho
 * exato e salvar o perfil que o usuário confirmou no mapeamento guiado, para a próxima vez ser
 * sozinha. Os de fábrica (F4-18) moram na mesma tabela com `de_fabrica = 1` e são reconhecidos do
 * mesmo jeito; o do usuário vence.
 */

export type TipoContaPerfil = "conta" | "cartao";

export interface PerfilCsv {
  id: string;
  banco: string;
  tipoConta: TipoContaPerfil;
  deFabrica: boolean;
  mapeamento: MapeamentoCsv;
  /** Vazios quando o leitor detecta pela amostra. */
  separador: Separador | null;
  formatoDecimal: Decimal | null;
  formatoData: FormatoData | null;
  codificacao: Codificacao | null;
}

export type NovoPerfilCsv = Omit<PerfilCsv, "id" | "deFabrica">;

interface LinhaPerfil {
  id: string;
  banco: string;
  tipo_conta: TipoContaPerfil;
  mapeamento: string;
  separador: string | null;
  formato_data: string | null;
  formato_decimal: string | null;
  codificacao: string | null;
  de_fabrica: number;
}

const umaDe = <T extends string>(lista: readonly T[], valor: string | null): T | null =>
  valor !== null && (lista as readonly string[]).includes(valor) ? (valor as T) : null;

/** A linha em perfil; mapeamento que não é de CSV (gravado à mão, versão antiga) fica de fora. */
function paraPerfil(l: LinhaPerfil): PerfilCsv | null {
  let json: unknown;
  try {
    json = JSON.parse(l.mapeamento);
  } catch {
    return null;
  }
  const mapeamento = MapeamentoCsv.safeParse(json);
  if (!mapeamento.success) return null;
  return {
    id: l.id,
    banco: l.banco,
    tipoConta: l.tipo_conta,
    deFabrica: l.de_fabrica === 1,
    mapeamento: mapeamento.data,
    separador: umaDe(SEPARADORES, l.separador),
    formatoDecimal: umaDe(DECIMAIS, l.formato_decimal),
    formatoData: umaDe(FORMATOS_DATA, l.formato_data),
    codificacao: umaDe(CODIFICACOES, l.codificacao),
  };
}

export class PerfisCsv {
  constructor(
    private readonly db: DatabaseSync,
    private readonly gerarId: () => string = novoId,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Os perfis de CSV vivos: os do usuário antes dos de fábrica, o mais recente primeiro. */
  private perfis(): PerfilCsv[] {
    const linhas = this.db
      .prepare(
        `SELECT id, banco, tipo_conta, mapeamento, separador, formato_data, formato_decimal, codificacao, de_fabrica
           FROM perfis_importacao
          WHERE formato = 'csv' AND apagado_em IS NULL
          ORDER BY de_fabrica ASC, atualizado_em DESC, id DESC`,
      )
      .all() as unknown as LinhaPerfil[];
    return linhas.map(paraPerfil).filter((p): p is PerfilCsv => p !== null);
  }

  /** O perfil deste tipo de conta com exatamente este cabeçalho (`mesmoCabecalho`). */
  private comCabecalho(
    perfis: readonly PerfilCsv[],
    cabecalho: readonly string[],
    tipoConta: TipoContaPerfil,
  ): PerfilCsv | undefined {
    return perfis.find(
      (p) =>
        p.tipoConta === tipoConta &&
        p.mapeamento.cabecalho !== null &&
        mesmoCabecalho(p.mapeamento.cabecalho, cabecalho),
    );
  }

  /**
   * O perfil cujo cabeçalho é exatamente este (mesmos títulos, na mesma ordem, maiúsculas como
   * vieram; só o espaço em volta não conta), para o tipo da conta de destino: o banco pode exportar
   * conta e cartão com os mesmos títulos e o sinal ao contrário. Arquivo sem títulos não tem o que
   * reconhecer.
   */
  reconhecer(cabecalho: readonly string[] | null, tipoConta: TipoContaPerfil): PerfilCsv | null {
    if (cabecalho === null) return null;
    return this.comCabecalho(this.perfis(), cabecalho, tipoConta) ?? null;
  }

  /**
   * Salva o perfil confirmado no mapeamento guiado. Se o usuário já tem perfil com este cabeçalho e
   * este tipo de conta, ele é atualizado em vez de duplicado; o de fábrica nunca é tocado (o do
   * usuário passa a vencer).
   */
  salvar(novo: NovoPerfilCsv, carimbo: Carimbo = DO_USUARIO): PerfilCsv {
    const mapeamento = MapeamentoCsv.parse(novo.mapeamento);
    if (novo.banco.trim() === "") throw new ErroDoCsv("O perfil precisa do nome do banco.");
    const origem = colunasDeOrigem(carimbo);
    const agora = this.agora().toISOString();
    const existente =
      mapeamento.cabecalho === null
        ? undefined
        : this.comCabecalho(
            this.perfis().filter((p) => !p.deFabrica),
            mapeamento.cabecalho,
            novo.tipoConta,
          );
    const valores = [
      novo.banco.trim(),
      novo.tipoConta,
      JSON.stringify(mapeamento),
      novo.separador,
      novo.formatoData,
      novo.formatoDecimal,
      novo.codificacao,
      agora,
      origem.origem,
      origem.agente_id,
      origem.execucao_id,
    ];
    let id: string;
    if (existente) {
      id = existente.id;
      this.db
        .prepare(
          `UPDATE perfis_importacao
              SET banco = ?, tipo_conta = ?, mapeamento = ?, separador = ?, formato_data = ?,
                  formato_decimal = ?, codificacao = ?, atualizado_em = ?, origem = ?, agente_id = ?,
                  execucao_id = ?
            WHERE id = ?`,
        )
        .run(...valores, id);
    } else {
      id = this.gerarId();
      this.db
        .prepare(
          `INSERT INTO perfis_importacao
             (banco, tipo_conta, mapeamento, separador, formato_data, formato_decimal, codificacao,
              atualizado_em, origem, agente_id, execucao_id, id, formato, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv', ?)`,
        )
        .run(...valores, id, agora);
    }
    return {
      id,
      banco: novo.banco.trim(),
      tipoConta: novo.tipoConta,
      deFabrica: false,
      mapeamento,
      separador: novo.separador,
      formatoDecimal: novo.formatoDecimal,
      formatoData: novo.formatoData,
      codificacao: novo.codificacao,
    };
  }
}
