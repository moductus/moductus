import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type { EstadoLembrete, EstadoTarefa, Origem } from "@moductus/contrato";
import { colunasDeOrigem, type Carimbo } from "../../banco/tabela.ts";

/**
 * O SQL das Tarefas (migração 013): listas, tarefas, etiquetas, a ligação entre as duas e o lembrete
 * ligado à tarefa. O que está na lixeira não aparece em nenhuma leitura daqui. A regra (o que é
 * "hoje", a próxima recorrente, quando o lembrete toca) fica no serviço, em `tarefas.ts`.
 */

export interface LinhaLista {
  id: string;
  nome: string;
  ordem: number;
  cor: string | null;
  arquivada: number;
}

export interface LinhaTarefa {
  id: string;
  lista_id: string;
  tarefa_pai_id: string | null;
  titulo: string;
  notas: string | null;
  nota_id: string | null;
  prioridade: number;
  vence_em: string | null;
  hora: string | null;
  duracao_estimada_min: number | null;
  recorrencia: string | null;
  estado: EstadoTarefa;
  concluida_em: string | null;
  ordem: number;
  fechada_em: string | null;
  gerada_por: string | null;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface LinhaEtiqueta {
  id: string;
  nome: string;
}

export interface LinhaLembrete {
  id: string;
  texto: string;
  quando: string;
  recorrencia: string | null;
  tarefa_id: string | null;
  evento_id: string | null;
  estado: EstadoLembrete;
  disparado_em: string | null;
  adiado_ate: string | null;
  canal: "dock" | "windows" | "calendario";
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** Os campos da tarefa que o serviço grava; o id, a origem e as datas de linha vêm à parte. */
export interface CamposTarefa {
  lista_id: string;
  tarefa_pai_id: string | null;
  titulo: string;
  notas: string | null;
  nota_id: string | null;
  prioridade: number;
  vence_em: string | null;
  hora: string | null;
  duracao_estimada_min: number | null;
  recorrencia: string | null;
  estado: EstadoTarefa;
  concluida_em: string | null;
  ordem: number;
  /** O instante do fechamento (migração 018): o lembrete que foi junto tem o mesmo pagado_em. */
  fechada_em: string | null;
  /** A recorrente de onde esta nasceu (migração 018). */
  gerada_por: string | null;
}

const COLUNAS_TAREFA = [
  "lista_id",
  "tarefa_pai_id",
  "titulo",
  "notas",
  "nota_id",
  "prioridade",
  "vence_em",
  "hora",
  "duracao_estimada_min",
  "recorrencia",
  "estado",
  "concluida_em",
  "ordem",
  "fechada_em",
  "gerada_por",
] as const satisfies readonly (keyof CamposTarefa)[];

const SELECT_TAREFA = `SELECT id, ${COLUNAS_TAREFA.join(", ")}, origem, agente_id, execucao_id, criado_em, atualizado_em
  FROM tarefas`;

const COLUNAS_LEMBRETE = `id, texto, quando, recorrencia, tarefa_id, evento_id, estado, disparado_em, adiado_ate,
  canal, origem, agente_id, execucao_id, criado_em, atualizado_em`;
const SELECT_LEMBRETE = `SELECT ${COLUNAS_LEMBRETE} FROM lembretes`;

/** O dia da tarefa comparado com um dia: igual, antes, depois, ou sem dia. */
export type FiltroDia = { op: "=" | "<" | ">"; dia: string } | { op: "sem" };

export interface FiltroTarefas {
  /** Os estados que entram; sem o campo, todos. */
  estados?: readonly EstadoTarefa[];
  dia?: FiltroDia;
  /** Junta, com OU, as feitas neste intervalo de `concluida_em` (as "feitas hoje" do Hoje). */
  feitasEntre?: { de: string; ate: string };
  listaId?: string;
  etiquetaId?: string;
  notaId?: string;
}

/** Os ids como um parâmetro só (JSON), para o `IN` não depender de quantos são. */
const emJson = (ids: readonly string[]) => JSON.stringify(ids);
const DOS_IDS = "(SELECT value FROM json_each(?))";

export class RepositorioTarefas {
  /** Cada SQL é preparado uma vez: um pedido de milhares de ids não paga o preparo a cada linha. */
  private readonly preparados = new Map<string, StatementSync>();

  constructor(private readonly db: DatabaseSync) {}

  private sql(texto: string): StatementSync {
    let s = this.preparados.get(texto);
    if (s === undefined) {
      s = this.db.prepare(texto);
      this.preparados.set(texto, s);
    }
    return s;
  }

  /**
   * Por `SAVEPOINT`, não `BEGIN`: o desfazer de uma ferramenta (`interno`) já roda numa transação, e
   * a área chamada de dentro dele não pode abrir outra.
   */
  /** Se já há uma transação aberta por fora (a do desfazer): o aviso espera ela terminar. */
  emTransacao(): boolean {
    return this.db.isTransaction;
  }

  transacao<T>(fazer: () => T): T {
    this.db.exec("SAVEPOINT tarefas");
    try {
      const resultado = fazer();
      this.db.exec("RELEASE tarefas");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK TO tarefas");
      this.db.exec("RELEASE tarefas");
      throw erro;
    }
  }

  // Listas

  listas(): LinhaLista[] {
    return this.sql(
      "SELECT id, nome, ordem, cor, arquivada FROM listas WHERE apagado_em IS NULL ORDER BY ordem, id",
    ).all() as unknown as LinhaLista[];
  }

  lista(id: string): LinhaLista | null {
    const linha = this.sql(
      "SELECT id, nome, ordem, cor, arquivada FROM listas WHERE id = ? AND apagado_em IS NULL",
    ).get(id) as unknown as LinhaLista | undefined;
    return linha ?? null;
  }

  proximaOrdemDeLista(): number {
    const r = this.sql(
      "SELECT coalesce(max(ordem) + 1, 0) AS n FROM listas WHERE apagado_em IS NULL",
    ).get() as { n: number };
    return r.n;
  }

  criarLista(
    l: { id: string; nome: string; cor: string | null; ordem: number },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `INSERT INTO listas (id, nome, ordem, cor, arquivada, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).run(l.id, l.nome, l.ordem, l.cor, agora, agora, o.origem, o.agente_id, o.execucao_id);
  }

  definirLista(
    id: string,
    campos: { nome: string; cor: string | null; arquivada: boolean; ordem: number },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE listas SET nome = ?, cor = ?, arquivada = ?, ordem = ?, atualizado_em = ?, origem = ?, agente_id = ?,
           execucao_id = ? WHERE id = ? AND apagado_em IS NULL`,
    ).run(
      campos.nome,
      campos.cor,
      campos.arquivada ? 1 : 0,
      campos.ordem,
      agora,
      o.origem,
      o.agente_id,
      o.execucao_id,
      id,
    );
  }

  apagarLista(id: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE listas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
    ).run(agora, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  // Tarefas

  tarefa(id: string): LinhaTarefa | null {
    const linha = this.sql(`${SELECT_TAREFA} WHERE id = ? AND apagado_em IS NULL`).get(id) as unknown as
      LinhaTarefa | undefined;
    return linha ?? null;
  }

  /** As vivas dos ids, na ordem do banco; id que não existe fica de fora. */
  tarefasDosIds(ids: readonly string[]): LinhaTarefa[] {
    if (ids.length === 0) return [];
    return this.sql(`${SELECT_TAREFA} WHERE id IN ${DOS_IDS} AND apagado_em IS NULL`).all(
      emJson(ids),
    ) as unknown as LinhaTarefa[];
  }

  /**
   * As que passam no filtro, do dia mais cedo para o mais tarde (as sem dia por último) e, no
   * mesmo dia, na ordem que o usuário deu.
   */
  buscar(f: FiltroTarefas): LinhaTarefa[] {
    const condicoes: string[] = ["apagado_em IS NULL"];
    const parametros: SQLInputValue[] = [];
    const doFiltro: string[] = [];
    if (f.estados !== undefined) {
      doFiltro.push(`estado IN ${DOS_IDS}`);
      parametros.push(emJson(f.estados));
    }
    if (f.dia !== undefined) {
      if (f.dia.op === "sem") doFiltro.push("vence_em IS NULL");
      else {
        doFiltro.push(`vence_em ${f.dia.op} ?`);
        parametros.push(f.dia.dia);
      }
    }
    const principal = doFiltro.length === 0 ? "1" : doFiltro.join(" AND ");
    if (f.feitasEntre !== undefined) {
      condicoes.push(`((${principal}) OR (estado = 'feita' AND concluida_em >= ? AND concluida_em < ?))`);
      parametros.push(f.feitasEntre.de, f.feitasEntre.ate);
    } else {
      condicoes.push(`(${principal})`);
    }
    if (f.listaId !== undefined) {
      condicoes.push("lista_id = ?");
      parametros.push(f.listaId);
    }
    if (f.notaId !== undefined) {
      condicoes.push("nota_id = ?");
      parametros.push(f.notaId);
    }
    if (f.etiquetaId !== undefined) {
      condicoes.push("id IN (SELECT tarefa_id FROM tarefa_etiquetas WHERE etiqueta_id = ?)");
      parametros.push(f.etiquetaId);
    }
    return this.sql(
      `${SELECT_TAREFA} WHERE ${condicoes.join(" AND ")}
          ORDER BY vence_em IS NULL, vence_em, ordem, criado_em, id`,
    ).all(...parametros) as unknown as LinhaTarefa[];
  }

  /** Quantas abertas vivas vencem até o dia dado, ele incluído (pelo índice das abertas por dia). */
  contarAbertasAte(dia: string): number {
    const r = this.sql(
      "SELECT count(*) AS n FROM tarefas WHERE estado = 'aberta' AND apagado_em IS NULL AND vence_em <= ?",
    ).get(dia) as { n: number };
    return r.n;
  }

  /** Quantas tarefas (sem as subtarefas) vivas foram feitas no intervalo de `concluida_em`. */
  contarFeitasEntre(de: string, ate: string): number {
    const r = this.sql(
      `SELECT count(*) AS n FROM tarefas
         WHERE estado = 'feita' AND apagado_em IS NULL AND tarefa_pai_id IS NULL
           AND concluida_em >= ? AND concluida_em < ?`,
    ).get(de, ate) as { n: number };
    return r.n;
  }

  /** As subtarefas vivas das mães dadas, em todos os estados ("subtarefas 1 de 3"). */
  subtarefas(maes: readonly string[]): LinhaTarefa[] {
    if (maes.length === 0) return [];
    return this.sql(
      `${SELECT_TAREFA} WHERE tarefa_pai_id IN ${DOS_IDS} AND apagado_em IS NULL
          ORDER BY tarefa_pai_id, ordem, criado_em, id`,
    ).all(emJson(maes)) as unknown as LinhaTarefa[];
  }

  /** A próxima posição entre as irmãs: a mesma lista e a mesma mãe. */
  proximaOrdemDeTarefa(listaId: string, paiId: string | null): number {
    const r = this.sql(
      `SELECT coalesce(max(ordem) + 1, 0) AS n FROM tarefas
          WHERE lista_id = ? AND tarefa_pai_id IS ? AND apagado_em IS NULL`,
    ).get(listaId, paiId) as { n: number };
    return r.n;
  }

  criarTarefa(id: string, campos: CamposTarefa, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `INSERT INTO tarefas (id, ${COLUNAS_TAREFA.join(", ")}, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ${COLUNAS_TAREFA.map(() => "?").join(", ")}, ?, ?, ?, ?, ?)`,
    ).run(id, ...COLUNAS_TAREFA.map((c) => campos[c]), agora, agora, o.origem, o.agente_id, o.execucao_id);
  }

  /** Regrava todos os campos da tarefa e o carimbo de quem mexeu. */
  gravarTarefa(id: string, campos: CamposTarefa, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE tarefas SET ${COLUNAS_TAREFA.map((c) => `${c} = ?`).join(", ")}, atualizado_em = ?, origem = ?,
           agente_id = ?, execucao_id = ? WHERE id = ? AND apagado_em IS NULL`,
    ).run(...COLUNAS_TAREFA.map((c) => campos[c]), agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** Só a posição, para ordenar milhares sem regravar o resto da linha. */
  ordemDaTarefa(id: string, ordem: number, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE tarefas SET ordem = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
        WHERE id = ? AND apagado_em IS NULL`,
    ).run(ordem, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /**
   * Se a tarefa tem filhas, também as da lixeira: o gatilho de um nível da 013 conta todas, e a
   * filha da lixeira ainda pode voltar.
   */
  temFilhas(id: string): boolean {
    return this.sql("SELECT 1 FROM tarefas WHERE tarefa_pai_id = ? LIMIT 1").get(id) !== undefined;
  }

  /** A próxima viva que a recorrente gerou, se houver. */
  geradaPor(id: string): LinhaTarefa | null {
    const linha = this.sql(`${SELECT_TAREFA} WHERE gerada_por = ? AND apagado_em IS NULL LIMIT 1`).get(
      id,
    ) as unknown as LinhaTarefa | undefined;
    return linha ?? null;
  }

  /** As vivas de uma lista, inclusive as subtarefas (vão juntas para a lixeira com ela). */
  idsDaLista(listaId: string): string[] {
    const linhas = this.sql("SELECT id FROM tarefas WHERE lista_id = ? AND apagado_em IS NULL").all(
      listaId,
    ) as { id: string }[];
    return linhas.map((l) => l.id);
  }

  apagarTarefas(ids: readonly string[], agora: string, carimbo: Carimbo): void {
    if (ids.length === 0) return;
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE tarefas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id IN ${DOS_IDS} AND apagado_em IS NULL`,
    ).run(agora, agora, o.origem, o.agente_id, o.execucao_id, emJson(ids));
  }

  // Etiquetas

  etiquetas(): LinhaEtiqueta[] {
    return this.sql(
      "SELECT id, nome FROM etiquetas WHERE apagado_em IS NULL ORDER BY nome_chave, id",
    ).all() as unknown as LinhaEtiqueta[];
  }

  etiqueta(id: string): LinhaEtiqueta | null {
    const linha = this.sql("SELECT id, nome FROM etiquetas WHERE id = ? AND apagado_em IS NULL").get(
      id,
    ) as unknown as LinhaEtiqueta | undefined;
    return linha ?? null;
  }

  etiquetaPelaChave(chave: string): LinhaEtiqueta | null {
    const linha = this.sql("SELECT id, nome FROM etiquetas WHERE nome_chave = ? AND apagado_em IS NULL").get(
      chave,
    ) as unknown as LinhaEtiqueta | undefined;
    return linha ?? null;
  }

  criarEtiqueta(e: { id: string; nome: string; chave: string }, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `INSERT INTO etiquetas (id, nome, nome_chave, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.id, e.nome, e.chave, agora, agora, o.origem, o.agente_id, o.execucao_id);
  }

  renomearEtiqueta(id: string, nome: string, chave: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE etiquetas SET nome = ?, nome_chave = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
    ).run(nome, chave, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  apagarEtiqueta(id: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE etiquetas SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
    ).run(agora, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** As etiquetas vivas de cada tarefa, pelo nome. */
  etiquetasDasTarefas(ids: readonly string[]): Map<string, LinhaEtiqueta[]> {
    const mapa = new Map<string, LinhaEtiqueta[]>();
    if (ids.length === 0) return mapa;
    const linhas = this.sql(
      `SELECT te.tarefa_id, e.id, e.nome FROM tarefa_etiquetas te JOIN etiquetas e ON e.id = te.etiqueta_id
          WHERE te.tarefa_id IN ${DOS_IDS} AND e.apagado_em IS NULL ORDER BY e.nome_chave, e.id`,
    ).all(emJson(ids)) as { tarefa_id: string; id: string; nome: string }[];
    for (const l of linhas) {
      const lista = mapa.get(l.tarefa_id) ?? [];
      lista.push({ id: l.id, nome: l.nome });
      mapa.set(l.tarefa_id, lista);
    }
    return mapa;
  }

  /** Troca as etiquetas da tarefa pelas dadas. */
  ligarEtiquetas(
    tarefaId: string,
    etiquetaIds: readonly string[],
    agora: string,
    gerarId: () => string,
  ): void {
    this.sql("DELETE FROM tarefa_etiquetas WHERE tarefa_id = ?").run(tarefaId);
    const inserir = this.sql(
      "INSERT INTO tarefa_etiquetas (id, tarefa_id, etiqueta_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)",
    );
    for (const etiquetaId of etiquetaIds) inserir.run(gerarId(), tarefaId, etiquetaId, agora, agora);
  }

  /** As vivas que levam a etiqueta. */
  idsComEtiqueta(etiquetaId: string): string[] {
    const linhas = this.sql(
      `SELECT t.id FROM tarefa_etiquetas te JOIN tarefas t ON t.id = te.tarefa_id
          WHERE te.etiqueta_id = ? AND t.apagado_em IS NULL`,
    ).all(etiquetaId) as { id: string }[];
    return linhas.map((l) => l.id);
  }

  // Lembretes ligados às tarefas

  /**
   * O lembrete da própria tarefa: o mais antigo vivo e sem repetição ligado a ela. Os outros que
   * alguém ligar à tarefa (a área Lembretes) são deles, não deste cálculo.
   */
  lembretesDasTarefas(ids: readonly string[]): Map<string, LinhaLembrete> {
    const mapa = new Map<string, LinhaLembrete>();
    if (ids.length === 0) return mapa;
    const linhas = this.sql(
      `${SELECT_LEMBRETE} WHERE tarefa_id IN ${DOS_IDS} AND recorrencia IS NULL AND apagado_em IS NULL
          ORDER BY criado_em, id`,
    ).all(emJson(ids)) as unknown as LinhaLembrete[];
    for (const l of linhas) if (l.tarefa_id !== null && !mapa.has(l.tarefa_id)) mapa.set(l.tarefa_id, l);
    return mapa;
  }

  /** Os vivos dos ids, numa leitura só. */
  lembretesDosIds(ids: readonly string[]): LinhaLembrete[] {
    if (ids.length === 0) return [];
    return this.sql(
      `${SELECT_LEMBRETE} WHERE id IN ${DOS_IDS} AND apagado_em IS NULL ORDER BY criado_em, id`,
    ).all(emJson(ids)) as unknown as LinhaLembrete[];
  }

  /** Os ids dos lembretes vivos das tarefas, todos (vão juntos para a lixeira com elas). */
  idsDosLembretes(tarefaIds: readonly string[]): string[] {
    if (tarefaIds.length === 0) return [];
    const linhas = this.sql(
      `SELECT id FROM lembretes WHERE tarefa_id IN ${DOS_IDS} AND apagado_em IS NULL`,
    ).all(emJson(tarefaIds)) as { id: string }[];
    return linhas.map((l) => l.id);
  }

  criarLembrete(
    l: { id: string; texto: string; quando: string; tarefaId: string },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `INSERT INTO lembretes (id, texto, quando, tarefa_id, estado, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, 'agendado', ?, ?, ?, ?, ?)`,
    ).run(l.id, l.texto, l.quando, l.tarefaId, agora, agora, o.origem, o.agente_id, o.execucao_id);
  }

  /**
   * Novo horário: volta a agendado, sem disparo nem adiamento. Vale também para o lembrete que está
   * na lixeira com a tarefa fechada, que volta certo quando ela reabre.
   */
  reagendarLembrete(id: string, texto: string, quando: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE lembretes SET texto = ?, quando = ?, estado = 'agendado', disparado_em = NULL, adiado_ate = NULL,
           atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ? WHERE id = ?`,
    ).run(texto, quando, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** Só o texto (a tarefa mudou de título): o estado do lembrete fica. Como o reagendar, vale na lixeira. */
  textoDoLembrete(id: string, texto: string, agora: string, carimbo: Carimbo): void {
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE lembretes SET texto = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ?`,
    ).run(texto, agora, o.origem, o.agente_id, o.execucao_id, id);
  }

  /** O lembrete próprio (o mais antigo sem repetição) que foi para a lixeira com a tarefa naquele instante. */
  lembreteApagadoEm(tarefaId: string, instante: string): LinhaLembrete | null {
    const linha = this.sql(
      `${SELECT_LEMBRETE} WHERE tarefa_id = ? AND apagado_em = ? AND recorrencia IS NULL
          ORDER BY criado_em, id LIMIT 1`,
    ).get(tarefaId, instante) as unknown as LinhaLembrete | undefined;
    return linha ?? null;
  }

  /**
   * Os lembretes próprios que foram para a lixeira com cada tarefa fechada, pela marca dela (o
   * `fechada_em`), numa leitura só.
   */
  lembretesDasFechadas(fechadas: readonly { id: string; fechadaEm: string }[]): Map<string, LinhaLembrete> {
    const mapa = new Map<string, LinhaLembrete>();
    if (fechadas.length === 0) return mapa;
    const marca = new Map(fechadas.map((f) => [f.id, f.fechadaEm]));
    const linhas = this.sql(
      `SELECT ${COLUNAS_LEMBRETE}, apagado_em AS marca FROM lembretes
        WHERE tarefa_id IN ${DOS_IDS} AND recorrencia IS NULL AND apagado_em IS NOT NULL
        ORDER BY criado_em, id`,
    ).all(emJson([...marca.keys()])) as unknown as (LinhaLembrete & { marca: string })[];
    for (const { marca: apagadoEm, ...l } of linhas) {
      if (l.tarefa_id !== null && !mapa.has(l.tarefa_id) && marca.get(l.tarefa_id) === apagadoEm) {
        mapa.set(l.tarefa_id, l);
      }
    }
    return mapa;
  }

  /**
   * Põe os lembretes na lixeira com o instante dado: a marca do fechamento da tarefa (o que volta ao
   * reabrir) ou outro (o que não volta mais).
   */
  marcarLembretesApagados(ids: readonly string[], apagadoEm: string, agora: string): void {
    if (ids.length === 0) return;
    this.sql(`UPDATE lembretes SET apagado_em = ?, atualizado_em = ? WHERE id IN ${DOS_IDS}`).run(
      apagadoEm,
      agora,
      emJson(ids),
    );
  }

  apagarLembretes(ids: readonly string[], agora: string, carimbo: Carimbo): void {
    if (ids.length === 0) return;
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE lembretes SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id IN ${DOS_IDS} AND apagado_em IS NULL`,
    ).run(agora, agora, o.origem, o.agente_id, o.execucao_id, emJson(ids));
  }

  /** Os lembretes da tarefa que foram para a lixeira naquele instante (junto com o fechamento dela). */
  idsDosLembretesApagadosEm(tarefaId: string, instante: string): string[] {
    const linhas = this.sql("SELECT id FROM lembretes WHERE tarefa_id = ? AND apagado_em = ?").all(
      tarefaId,
      instante,
    ) as { id: string }[];
    return linhas.map((l) => l.id);
  }

  restaurarLembretes(ids: readonly string[], agora: string, carimbo: Carimbo): void {
    if (ids.length === 0) return;
    const o = colunasDeOrigem(carimbo);
    this.sql(
      `UPDATE lembretes SET apagado_em = NULL, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id IN ${DOS_IDS} AND apagado_em IS NOT NULL`,
    ).run(agora, o.origem, o.agente_id, o.execucao_id, emJson(ids));
  }
}
