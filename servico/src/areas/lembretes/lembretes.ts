import type { DatabaseSync } from "node:sqlite";
import {
  ADIAR_LEMBRETE_MIN,
  MENSAGEM_LEMBRETE_NAO_TOCA,
  MudancaLembrete,
  NovoLembrete,
  PedidoAdiarLembretes,
  PedidoConcluirLembretes,
  PedidoLembretes,
  PedidoListarLembretes,
  type Apagados,
  type Ausencia as AusenciaDoCartao,
  type CanalLembrete,
  type EstadoLembrete,
  type Lembrete,
  type LembretesDeHoje,
  type MudancaLembretes,
  type Origem,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { RecusaDesfazer, type ContextoDesfazer } from "../../ferramentas/ferramenta.ts";
import type { BotaoAviso, NovoAviso, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import { lerRecorrencia, proximoInstante } from "../dia/recorrencia.ts";
import type { Ausencia, Conferencia, FonteDoRelogio } from "../dia/relogio.ts";
import { TempoDoDia } from "../dia/tempo.ts";

/**
 * Lembretes (PRODUCT.md §5, DATA.md §2, ADR-0032): o que dispara na hora, sem modelo e sem rede,
 * pelo relógio do dia. Cada linha é um lembrete e o `quando` é a ocorrência que ele representa
 * agora: a que vai tocar (`agendado`, ou `adiado` até `adiado_ate`), a que está tocando
 * (`disparado`) ou a que passou sem tocar (`perdido`).
 *
 * - **Disparo:** grava `disparado` e `disparado_em` numa transação e avisa como notificação do
 *   tipo `lembrete` em nome da Alba, com **Adiar 10 min** e **Feito** no aviso do Windows. O canal
 *   `dock` só aparece no painel Hoje, sem aviso.
 * - **Recorrente:** a regra conta do início dela (`inicio_recorrencia`, o DTSTART), que não anda: a
 *   hora local de toda ocorrência vem dele, e o `COUNT` também. Tocando ou perdido, ele toca de novo
 *   na próxima, que toma o lugar da anterior; Feito o volta a `agendado` na próxima depois de agora;
 *   regra que acabou sai.
 * - **Atrasado:** o que o relógio só confere mais de 2 min depois da hora vira `perdido`, sem tocar.
 *   Se foi numa ausência (serviço parado, PC suspenso), os dessa vez saem juntos num aviso só.
 *   Escrito para um horário que já passou há mais de 2 min também vira `perdido`, quieto.
 * - O `quando` é um instante UTC: mudar o fuso não remarca o que está gravado; só a próxima
 *   ocorrência de um recorrente passa a ser contada no relógio do fuso novo.
 */

export const MENSAGEM_NAO_ENCONTRADO = "lembrete não encontrado";
export const MENSAGEM_TAREFA = "a tarefa deste lembrete não existe mais";
export const MENSAGEM_EVENTO = "o evento deste lembrete não existe mais";
export const MENSAGEM_DESFAZER_SAIU = "o lembrete já saiu";
export const MENSAGEM_DESFAZER_MUDOU = "o lembrete tocou ou foi mudado depois";
export const MENSAGEM_DESFAZER_DE_OUTRO = "o lembrete foi mudado depois por você ou em outra conversa";

/** Até quanto depois da hora o lembrete ainda toca; mais que isso, vira atrasado. */
export const TOLERANCIA_MS = 2 * 60_000;
/** O próximo lembrete aparece no topo do Hoje, sem som, a partir de 30 min antes. */
export const ANTECEDENCIA_MS = 30 * 60_000;
/** Os botões do aviso, os mesmos do lembrete tocando no painel Hoje (LembreteHoje.dc.html). */
export const BOTOES_DO_LEMBRETE: readonly BotaoAviso[] = [
  { id: "adiar", rotulo: `Adiar ${ADIAR_LEMBRETE_MIN} min` },
  { id: "feito", rotulo: "Feito" },
];

/** Os lembretes tocam em nome da Alba (AGENTS.md §2). */
const ALBA = "alba";
const PREFIXO = "lembrete";
/** O aviso agrupado dos atrasados: um só, trocado a cada ausência. */
export const REFERENCIA_ATRASADOS = "lembretes:atrasados";
/** Quantos textos o aviso agrupado mostra antes do "e mais N". */
const TEXTOS_NO_AGRUPADO = 3;
/** Teto de passos ao andar uma regra a partir de uma ocorrência achada. */
const PASSOS_MAXIMOS = 5000;
/**
 * As janelas em que a última ocorrência antes de um limite é procurada, da menor para a maior: o
 * diário acha na primeira, o mensal e o anual nas seguintes, sem andar uma a uma desde o início.
 */
const JANELAS_MS = [8, 64, 400, 4000, 40_000].map((dias) => dias * 86_400_000);

/**
 * A referência do aviso é a da ocorrência (`lembrete:<id>@<quando>`): o aviso de uma ocorrência que
 * já passou não decide pela próxima, e retirar o aviso não varre o histórico inteiro do lembrete.
 */
export const referenciaDe = (id: string, quando: string) => `${PREFIXO}:${id}@${quando}`;

export interface LinhaLembrete {
  id: string;
  texto: string;
  quando: string;
  recorrencia: string | null;
  inicio_recorrencia: string | null;
  tarefa_id: string | null;
  evento_id: string | null;
  estado: EstadoLembrete;
  disparado_em: string | null;
  adiado_ate: string | null;
  canal: CanalLembrete;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const COLUNAS =
  "id, texto, quando, recorrencia, inicio_recorrencia, tarefa_id, evento_id, estado, disparado_em, adiado_ate, canal, origem, agente_id, execucao_id, criado_em, atualizado_em";
/** A hora em que o lembrete toca: a do adiamento, ou a da ocorrência. */
const VENCIMENTO = "coalesce(adiado_ate, quando)";
const ESPERANDO = "estado IN ('agendado', 'adiado')";

export const paraLembrete = (l: LinhaLembrete): Lembrete => ({
  id: l.id,
  texto: l.texto,
  quando: l.quando,
  recorrencia: l.recorrencia,
  tarefaId: l.tarefa_id,
  eventoId: l.evento_id,
  estado: l.estado,
  disparadoEm: l.disparado_em,
  adiadoAte: l.adiado_ate,
  canal: l.canal,
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

/** O que muda numa linha: o resto (ligações, origem da criação) fica. */
export interface CamposLembrete {
  texto: string;
  quando: string;
  recorrencia: string | null;
  inicio_recorrencia: string | null;
  canal: CanalLembrete;
  estado: EstadoLembrete;
  disparado_em: string | null;
  adiado_ate: string | null;
}

/**
 * Como um lembrete estava, vivo ou na lixeira: os campos e a versão (`atualizado_em`). A ferramenta
 * guarda o de antes de mexer e a versão em que deixou, e o desfazer põe os campos de volta.
 */
export interface RetratoLembrete {
  id: string;
  campos: CamposLembrete;
  versao: string;
}

const camposDe = (l: LinhaLembrete): CamposLembrete => ({
  texto: l.texto,
  quando: l.quando,
  recorrencia: l.recorrencia,
  inicio_recorrencia: l.inicio_recorrencia,
  canal: l.canal,
  estado: l.estado,
  disparado_em: l.disparado_em,
  adiado_ate: l.adiado_ate,
});

/** `lembretes` das migrações 013 e 019. O que está na lixeira não aparece. */
export class RepositorioLembretes {
  constructor(private readonly db: DatabaseSync) {}

  lembrete(id: string): LinhaLembrete | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM lembretes WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaLembrete | undefined;
    return linha ?? null;
  }

  /** Os que tocam num intervalo (a hora do adiamento, ou a da ocorrência), e só dos estados pedidos. */
  lista(filtro: { de?: string; ate?: string; estados?: readonly EstadoLembrete[] }): LinhaLembrete[] {
    const filtros = ["apagado_em IS NULL"];
    const valores: string[] = [];
    if (filtro.de !== undefined) {
      filtros.push(`${VENCIMENTO} >= ?`);
      valores.push(filtro.de);
    }
    if (filtro.ate !== undefined) {
      filtros.push(`${VENCIMENTO} <= ?`);
      valores.push(filtro.ate);
    }
    if (filtro.estados) {
      filtros.push(`estado IN (${filtro.estados.map(() => "?").join(", ")})`);
      valores.push(...filtro.estados);
    }
    return this.db
      .prepare(`SELECT ${COLUNAS} FROM lembretes WHERE ${filtros.join(" AND ")} ORDER BY ${VENCIMENTO}, id`)
      .all(...valores) as unknown as LinhaLembrete[];
  }

  doEstado(estado: EstadoLembrete, ordem: string): LinhaLembrete[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS} FROM lembretes WHERE estado = ? AND apagado_em IS NULL ORDER BY ${ordem}, id`,
      )
      .all(estado) as unknown as LinhaLembrete[];
  }

  /** Quantos atrasados (`perdido`) vivos há: a contagem da área (`areas.contagens`). */
  contarPerdidos(): number {
    const r = this.db
      .prepare("SELECT count(*) AS n FROM lembretes WHERE estado = 'perdido' AND apagado_em IS NULL")
      .get() as { n: number };
    return r.n;
  }

  /** Os que esperam a hora e já chegaram a ela (índice `lembretes_proximo`). */
  vencidos(agora: string): LinhaLembrete[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS} FROM lembretes
          WHERE ${ESPERANDO} AND apagado_em IS NULL AND ${VENCIMENTO} <= ?
          ORDER BY ${VENCIMENTO}, id`,
      )
      .all(agora) as unknown as LinhaLembrete[];
  }

  /** O primeiro que espera a hora: com `depoisDe`, só os que ainda não chegaram a ela. */
  primeiroEsperando(depoisDe: string | null): LinhaLembrete | null {
    const linha = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM lembretes
          WHERE ${ESPERANDO} AND apagado_em IS NULL ${depoisDe === null ? "" : `AND ${VENCIMENTO} > ?`}
          ORDER BY ${VENCIMENTO}, id LIMIT 1`,
      )
      .get(...(depoisDe === null ? [] : [depoisDe])) as unknown as LinhaLembrete | undefined;
    return linha ?? null;
  }

  /** Os recorrentes tocando ou perdidos: tocam de novo na próxima (índice da 019). */
  recorrentesParados(): LinhaLembrete[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS} FROM lembretes
          WHERE estado IN ('disparado', 'perdido') AND recorrencia IS NOT NULL AND apagado_em IS NULL`,
      )
      .all() as unknown as LinhaLembrete[];
  }

  criar(
    l: { id: string; tarefaId: string | null; eventoId: string | null } & CamposLembrete,
    agora: string,
    carimbo: Carimbo,
  ): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO lembretes (id, texto, quando, recorrencia, inicio_recorrencia, tarefa_id, evento_id, estado,
           disparado_em, adiado_ate, canal, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        l.id,
        l.texto,
        l.quando,
        l.recorrencia,
        l.inicio_recorrencia,
        l.tarefaId,
        l.eventoId,
        l.estado,
        l.disparado_em,
        l.adiado_ate,
        l.canal,
        agora,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /** Grava os campos. Sem carimbo (o relógio mudando o estado), a origem fica a de quem escreveu. */
  gravar(id: string, c: CamposLembrete, agora: string, carimbo: Carimbo | null): void {
    const valores = [
      c.texto,
      c.quando,
      c.recorrencia,
      c.inicio_recorrencia,
      c.canal,
      c.estado,
      c.disparado_em,
      c.adiado_ate,
      agora,
    ];
    const campos = `texto = ?, quando = ?, recorrencia = ?, inicio_recorrencia = ?, canal = ?, estado = ?,
      disparado_em = ?, adiado_ate = ?, atualizado_em = ?`;
    if (carimbo === null) {
      this.db
        .prepare(`UPDATE lembretes SET ${campos} WHERE id = ? AND apagado_em IS NULL`)
        .run(...valores, id);
      return;
    }
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE lembretes SET ${campos}, origem = ?, agente_id = ?, execucao_id = ? WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(...valores, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  apagar(ids: readonly string[], agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    const apagar = this.db.prepare(
      `UPDATE lembretes SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
        WHERE id = ? AND apagado_em IS NULL`,
    );
    for (const id of ids) apagar.run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  /** O lembrete vivo ou na lixeira: o desfazer confere a versão dos dois. */
  qualquer(id: string): LinhaLembrete | null {
    const linha = this.db.prepare(`SELECT ${COLUNAS} FROM lembretes WHERE id = ?`).get(id) as unknown as
      LinhaLembrete | undefined;
    return linha ?? null;
  }

  /** Põe os campos de volta e tira da lixeira, se estava lá: a inversa das ferramentas da Alba. */
  restaurar(id: string, c: CamposLembrete, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE lembretes SET texto = ?, quando = ?, recorrencia = ?, inicio_recorrencia = ?, canal = ?, estado = ?,
           disparado_em = ?, adiado_ate = ?, apagado_em = NULL, atualizado_em = ?, origem = ?, agente_id = ?,
           execucao_id = ?
          WHERE id = ?`,
      )
      .run(
        c.texto,
        c.quando,
        c.recorrencia,
        c.inicio_recorrencia,
        c.canal,
        c.estado,
        c.disparado_em,
        c.adiado_ate,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        id,
      );
  }

  /** O `quando` de um lembrete, vivo ou na lixeira: o aviso da ocorrência sai com ele. */
  quandoDe(id: string): string | null {
    const linha = this.db.prepare("SELECT quando FROM lembretes WHERE id = ?").get(id) as
      { quando: string } | undefined;
    return linha?.quando ?? null;
  }

  tarefaViva(id: string): { titulo: string; vence_em: string | null; hora: string | null } | null {
    const linha = this.db
      .prepare("SELECT titulo, vence_em, hora FROM tarefas WHERE id = ? AND apagado_em IS NULL")
      .get(id) as { titulo: string; vence_em: string | null; hora: string | null } | undefined;
    return linha ?? null;
  }

  eventoVivo(id: string): { titulo: string; inicio: string; dia_inteiro: number } | null {
    const linha = this.db
      .prepare("SELECT titulo, inicio, dia_inteiro FROM eventos WHERE id = ? AND apagado_em IS NULL")
      .get(id) as { titulo: string; inicio: string; dia_inteiro: number } | undefined;
    return linha ?? null;
  }

  transacao<T>(fazer: () => T): T {
    this.db.exec("BEGIN");
    try {
      const resultado = fazer();
      this.db.exec("COMMIT");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/**
 * Uma ocorrência de um lembrete: o instante, a regra e o início dela (o DTSTART), de onde vêm a
 * hora local das ocorrências e a contagem do `COUNT`.
 */
export interface Ocorrencia {
  quando: Date;
  inicio: Date;
  recorrencia: string | null;
}

/** A primeira ocorrência da regra depois de `depoisDe`, ou `null` sem regra, acabada ou fora do subconjunto. */
function proximaDaRegra(o: Ocorrencia, depoisDe: Date, fuso: string): Ocorrencia | null {
  if (o.recorrencia === null || !lerRecorrencia(o.recorrencia).entendida) return null;
  const quando = proximoInstante(o.recorrencia, o.inicio, fuso, depoisDe);
  return quando === null ? null : { ...o, quando };
}

/** A ocorrência seguinte. */
export function seguinte(o: Ocorrencia, fuso: string): Ocorrencia | null {
  return proximaDaRegra(o, o.quando, fuso);
}

/** A primeira ocorrência depois de `limite` (e depois de `o`), ou `null` se a regra acaba antes. */
export function primeiraDepois(o: Ocorrencia, limite: Date, fuso: string): Ocorrencia | null {
  return proximaDaRegra(o, new Date(Math.max(limite.getTime(), o.quando.getTime())), fuso);
}

/**
 * A última ocorrência até `limite`, a partir de `o` (que fica, se a seguinte já passa do limite).
 * Procura numa janela antes do limite, que cresce até achar: nada de andar uma a uma desde `o`.
 */
export function ultimaAte(o: Ocorrencia, limite: Date, fuso: string): Ocorrencia {
  if (o.recorrencia === null || limite.getTime() <= o.quando.getTime()) return o;
  for (const janela of JANELAS_MS) {
    const desde = Math.max(o.quando.getTime(), limite.getTime() - janela);
    const achada = proximaDaRegra(o, new Date(desde), fuso);
    if (achada !== null && achada.quando.getTime() <= limite.getTime()) {
      let atual = achada;
      for (let i = 0; i < PASSOS_MAXIMOS; i++) {
        const s = seguinte(atual, fuso);
        if (s === null || s.quando.getTime() > limite.getTime()) break;
        atual = s;
      }
      return atual;
    }
    if (desde === o.quando.getTime()) return o;
  }
  return o;
}

const ocorrenciaDe = (l: LinhaLembrete): Ocorrencia => ({
  quando: new Date(l.quando),
  inicio: new Date(l.inicio_recorrencia ?? l.quando),
  recorrencia: l.recorrencia,
});

/** O que as notificações oferecem aos lembretes. */
export type NotificacoesDoLembrete = Pick<ServicoNotificacoes, "avisar" | "resolvido" | "registrarAcao">;

export interface FontesLembretes {
  /** O fuso de `config` (`dia.fuso`), lido a cada conta. */
  lerFuso: () => string;
  notificacoes: NotificacoesDoLembrete;
  /** O relógio do dia, para se rearmar a cada mudança. */
  relogio?: { mudou(): void };
  /**
   * Se o lembrete já está no calendário "Moductus" do Google, sem nada na fila (F3-24): o do canal
   * `calendario` então toca no celular, e o Windows não avisa de novo.
   */
  noGoogle?: (lembreteId: string) => boolean;
}

export interface AvisosLembretes {
  /** O que mudou, de qualquer janela, ferramenta ou do relógio (`lembretes.mudou`). */
  mudou: (mudanca: MudancaLembretes) => void;
  /** O lembrete do painel Hoje, quando muda (`lembretes.hoje`). */
  hoje: (hoje: LembretesDeHoje) => void;
}

export interface OpcoesLembretes {
  agora?: () => Date;
  gerarId?: () => string;
}

export class ServicoLembretes implements FonteDoRelogio {
  readonly nome = "lembretes";
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly tempo: TempoDoDia;
  /**
   * A ausência em que cada atrasado venceu, para o cartão; `null` quando não se sabe (serviço
   * parado, ou escrito para um horário que já passou). Fica em memória: some ao reiniciar.
   */
  private readonly ausencias = new Map<string, AusenciaDoCartao | null>();
  /** A próxima ocorrência de cada recorrente parado, calculada uma vez por ocorrência e fuso. */
  private readonly proximas = new Map<string, { chave: string; proxima: Ocorrencia | null }>();
  /** Se há um aviso agrupado de atrasados que pode estar na Central de Notificações. */
  private atrasadosAvisados: boolean;
  private ultimoHoje: string | null = null;

  constructor(
    private readonly repo: RepositorioLembretes,
    private readonly fontes: FontesLembretes,
    private readonly avisos: AvisosLembretes,
    opcoes: OpcoesLembretes = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.tempo = new TempoDoDia(fontes.lerFuso, this.agora);
    // O aviso agrupado da última vez pode ter ficado: sai quando os atrasados acabarem.
    this.atrasadosAvisados = this.repo.doEstado("perdido", "quando").length > 0;
    fontes.notificacoes.registrarAcao(PREFIXO, (alvo, botao) => this.aoClicar(alvo, botao));
  }

  listar(entrada: PedidoListarLembretes): Lembrete[] {
    const pedido = PedidoListarLembretes.parse(entrada);
    return this.repo.lista(pedido).map(paraLembrete);
  }

  /**
   * O lembrete do painel Hoje: o próximo a tocar, se faltam 30 min ou menos (o recorrente que está
   * tocando ou perdido entra pela próxima ocorrência dele, como agendado); os que estão tocando;
   * os atrasados, com a ausência em que venceram quando todos venceram na mesma.
   */
  hoje(): LembretesDeHoje {
    const agora = this.agora();
    const fuso = this.fontes.lerFuso();
    let chegando: Lembrete | null = null;
    let hora = Number.POSITIVE_INFINITY;
    const esperando = this.repo.primeiroEsperando(agora.toISOString());
    if (esperando !== null) {
      chegando = paraLembrete(esperando);
      hora = Date.parse(esperando.adiado_ate ?? esperando.quando);
    }
    for (const { linha, proxima } of this.proximosDosParados(fuso)) {
      const t = proxima.quando.getTime();
      if (t <= agora.getTime() || t >= hora) continue;
      hora = t;
      chegando = {
        ...paraLembrete(linha),
        quando: proxima.quando.toISOString(),
        estado: "agendado",
        adiadoAte: null,
      };
    }
    if (hora - agora.getTime() > ANTECEDENCIA_MS) chegando = null;
    const linhasAtrasadas = this.repo.doEstado("perdido", "quando");
    for (const id of this.ausencias.keys()) {
      if (!linhasAtrasadas.some((l) => l.id === id)) this.ausencias.delete(id);
    }
    return {
      chegando,
      tocando: this.repo.doEstado("disparado", "disparado_em").map(paraLembrete),
      atrasados: linhasAtrasadas.map(paraLembrete),
      ausencia: this.ausenciaComum(linhasAtrasadas),
    };
  }

  async criar(entrada: NovoLembrete, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete> {
    const novo = NovoLembrete.parse(entrada);
    const tarefaId = novo.tarefaId ?? null;
    const eventoId = novo.eventoId ?? null;
    if (tarefaId !== null && !this.repo.tarefaViva(tarefaId)) throw new Error(MENSAGEM_TAREFA);
    if (eventoId !== null && !this.repo.eventoVivo(eventoId)) throw new Error(MENSAGEM_EVENTO);
    const id = this.gerarId();
    const recorrencia = novo.recorrencia ?? null;
    this.repo.criar(
      {
        id,
        tarefaId,
        eventoId,
        texto: novo.texto,
        quando: novo.quando,
        recorrencia,
        inicio_recorrencia: recorrencia === null ? null : novo.quando,
        canal: novo.canal ?? "windows",
        estado: "agendado",
        disparado_em: null,
        adiado_ate: null,
      },
      this.instante(),
      carimbo,
    );
    const lembrete = paraLembrete(this.exigir(id));
    this.mudou({ lembretes: [lembrete], removidos: [] });
    return lembrete;
  }

  /**
   * Texto, horário, repetição e canal. Mudar o `quando` volta o lembrete a agendado; mudar o
   * horário ou a regra faz a regra contar de novo a partir do `quando`. O adiado que recebe o
   * próprio `quando` de volta (o evento movido no Google para a hora de antes do adiamento, F3-24)
   * também volta a agendado nele, sem mexer na regra.
   */
  async definir(entrada: MudancaLembrete, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete> {
    const mudanca = MudancaLembrete.parse(entrada);
    const atual = this.exigir(mudanca.id);
    const desadiou =
      mudanca.quando !== undefined && mudanca.quando === atual.quando && atual.estado === "adiado";
    const reagendou = mudanca.quando !== undefined && mudanca.quando !== atual.quando;
    const quando = mudanca.quando ?? atual.quando;
    const recorrencia = mudanca.recorrencia === undefined ? atual.recorrencia : mudanca.recorrencia;
    const regraNova = reagendou || recorrencia !== atual.recorrencia;
    const campos: CamposLembrete = {
      ...camposDe(atual),
      texto: mudanca.texto ?? atual.texto,
      recorrencia,
      inicio_recorrencia: recorrencia === null ? null : regraNova ? quando : atual.inicio_recorrencia,
      canal: mudanca.canal ?? atual.canal,
      ...(reagendou || desadiou ? { quando, estado: "agendado" as const, adiado_ate: null } : {}),
    };
    if (campos.texto === atual.texto && !regraNova && !desadiou && campos.canal === atual.canal)
      return paraLembrete(atual);
    this.repo.gravar(atual.id, campos, this.instante(), carimbo);
    const lembrete = paraLembrete(this.exigir(atual.id));
    this.mudou({ lembretes: [lembrete], removidos: [] });
    if (reagendou || desadiou) await this.resolver([atual]);
    return lembrete;
  }

  /** "Adiar 10 min" do aviso e do painel, "Adiar os 2 em 30 min" dos atrasados: a partir de agora. */
  async adiar(entrada: PedidoAdiarLembretes, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete[]> {
    const pedido = PedidoAdiarLembretes.parse(entrada);
    const linhas = [...new Set(pedido.ids)].map((id) => this.exigir(id));
    exigirTocando(linhas, pedido.quando);
    const agora = this.agora();
    const ate = new Date(agora.getTime() + pedido.minutos * 60_000).toISOString();
    this.repo.transacao(() => {
      for (const l of linhas) {
        this.repo.gravar(
          l.id,
          { ...camposDe(l), estado: "adiado", adiado_ate: ate },
          agora.toISOString(),
          carimbo,
        );
      }
    });
    const lembretes = linhas.map((l) => paraLembrete(this.exigir(l.id)));
    this.mudou({ lembretes, removidos: [] });
    await this.resolver(linhas);
    return lembretes;
  }

  /**
   * "Feito": o de uma vez vai para a lixeira; o recorrente volta a agendado na primeira ocorrência
   * depois de agora (ou depois da que estava marcada, se ainda não chegou), e sai se a regra acabou.
   */
  async concluir(entrada: PedidoConcluirLembretes, carimbo: Carimbo = DO_USUARIO): Promise<MudancaLembretes> {
    const pedido = PedidoConcluirLembretes.parse(entrada);
    const linhas = [...new Set(pedido.ids)].map((id) => this.exigir(id));
    exigirTocando(linhas, pedido.quando);
    const agora = this.agora();
    const fuso = this.fontes.lerFuso();
    const continuam: string[] = [];
    const removidos: string[] = [];
    this.repo.transacao(() => {
      for (const l of linhas) {
        const proxima = primeiraDepois(ocorrenciaDe(l), agora, fuso);
        if (proxima === null) {
          this.repo.apagar([l.id], agora.toISOString(), carimbo);
          removidos.push(l.id);
          continue;
        }
        const campos: CamposLembrete = {
          ...camposDe(l),
          quando: proxima.quando.toISOString(),
          inicio_recorrencia: proxima.inicio.toISOString(),
          estado: "agendado",
          adiado_ate: null,
        };
        this.repo.gravar(l.id, campos, agora.toISOString(), carimbo);
        continuam.push(l.id);
      }
    });
    const mudanca = { lembretes: continuam.map((id) => paraLembrete(this.exigir(id))), removidos };
    this.mudou(mudanca);
    await this.resolver(linhas);
    return mudanca;
  }

  /** Manda à lixeira, recorrente ou não. */
  async cancelar(entrada: PedidoLembretes, carimbo: Carimbo = DO_USUARIO): Promise<Apagados> {
    const pedido = PedidoLembretes.parse(entrada);
    const linhas = [...new Set(pedido.ids)].map((id) => this.exigir(id));
    const ids = linhas.map((l) => l.id);
    this.repo.transacao(() => this.repo.apagar(ids, this.instante(), carimbo));
    this.mudou({ lembretes: [], removidos: ids });
    await this.resolver(linhas);
    return { ids };
  }

  /**
   * Outra área mudou lembretes (as Tarefas criam, reagendam e levam o da tarefa junto) e já avisou
   * as janelas: o relógio se rearma, o painel Hoje se atualiza, e sai o aviso do que foi embora e
   * da ocorrência que mudou de horário (`anteriores`).
   */
  mudaramPorFora(mudanca: MudancaLembretes): void {
    this.fontes.relogio?.mudou();
    this.emitirHoje();
    const removidos = mudanca.removidos.flatMap((id) => {
      const quando = this.repo.quandoDe(id);
      return quando === null ? [] : [{ id, quando }];
    });
    this.resolver([...removidos, ...(mudanca.anteriores ?? [])]).catch((erro: unknown) =>
      console.error(`lembretes: aviso do que mudou não retirado: ${String(erro)}`),
    );
  }

  // O desfazer das ferramentas da Alba (AGENTS.md §4, ADR-0029). As inversas são síncronas e rodam
  // dentro da transação do desfazer, já aberta: não abrem outra, e os avisos saem depois dela.

  /** Como cada lembrete está agora, vivo ou na lixeira; o que não existe fica de fora. */
  retratos(ids: readonly string[]): RetratoLembrete[] {
    return ids.flatMap((id) => {
      const linha = this.repo.qualquer(id);
      return linha === null ? [] : [{ id, campos: camposDe(linha), versao: linha.atualizado_em }];
    });
  }

  /**
   * A inversa de criar: o lembrete vai à lixeira. Ter tocado não impede (o relógio muda o estado
   * sem trocar quem escreveu); ter sido mudado por você, ou por outra conversa, sim.
   */
  desfazerCriacao(alvo: { id: string }, ctx: ContextoDesfazer): void {
    const linha = this.repo.lembrete(alvo.id);
    if (linha === null) throw new RecusaDesfazer(MENSAGEM_DESFAZER_SAIU);
    const mesmoAutor =
      linha.origem === "agente" && linha.agente_id === ctx.agenteId && linha.execucao_id === ctx.execucaoId;
    if (!mesmoAutor) throw new RecusaDesfazer(MENSAGEM_DESFAZER_DE_OUTRO);
    this.repo.apagar([linha.id], this.instante(), ctx.carimbo);
    this.depoisDoDesfazer([linha.id]);
  }

  /**
   * A inversa de mudar, adiar, concluir e cancelar: cada lembrete volta aos campos de antes, e sai
   * da lixeira se foi para lá. Só se continua na versão em que a chamada o deixou: o que tocou
   * depois (o relógio também conta) ou que você mexeu fica como está.
   */
  desfazerMudancas(
    itens: readonly { id: string; antes: CamposLembrete; versao: string }[],
    carimbo: Carimbo,
  ): void {
    for (const { id, versao } of itens) {
      const linha = this.repo.qualquer(id);
      if (linha === null) throw new RecusaDesfazer(MENSAGEM_DESFAZER_SAIU);
      if (linha.atualizado_em !== versao) throw new RecusaDesfazer(MENSAGEM_DESFAZER_MUDOU);
    }
    const agora = this.instante();
    for (const { id, antes } of itens) this.repo.restaurar(id, antes, agora, carimbo);
    this.depoisDoDesfazer(itens.map((i) => i.id));
  }

  /**
   * Os avisos do desfazer saem depois da transação dele, com o que ficou gravado: se ela voltar, as
   * janelas recebem o de antes. O que saiu leva o aviso do Windows junto.
   */
  private depoisDoDesfazer(ids: readonly string[]): void {
    queueMicrotask(() => {
      const vivos = ids.flatMap((id) => {
        const linha = this.repo.lembrete(id);
        return linha === null ? [] : [linha];
      });
      const removidos = ids.filter((id) => !vivos.some((l) => l.id === id));
      this.mudou({ lembretes: vivos.map(paraLembrete), removidos });
      const saidos = removidos.flatMap((id) => {
        const quando = this.repo.quandoDe(id);
        return quando === null ? [] : [{ id, quando }];
      });
      this.resolver(saidos).catch((erro: unknown) =>
        console.error(`lembretes: aviso do desfeito não retirado: ${String(erro)}`),
      );
    });
  }

  // O relógio do dia.

  /**
   * O próximo instante em que há algo a fazer: o próximo vencimento, a próxima ocorrência de um
   * recorrente tocando ou perdido, e a entrada do próximo nos 30 min antes (o painel Hoje muda).
   */
  proximo(agora: Date): Date | null {
    const fuso = this.fontes.lerFuso();
    const horas: number[] = [];
    const primeiro = this.repo.primeiroEsperando(null);
    if (primeiro !== null) horas.push(Date.parse(primeiro.adiado_ate ?? primeiro.quando));
    const futuras: number[] = [];
    const chegando = this.repo.primeiroEsperando(agora.toISOString());
    if (chegando !== null) futuras.push(Date.parse(chegando.adiado_ate ?? chegando.quando));
    for (const { proxima } of this.proximosDosParados(fuso)) {
      const t = proxima.quando.getTime();
      horas.push(t);
      if (t > agora.getTime()) futuras.push(t);
    }
    if (futuras.length > 0) {
      const entrada = Math.min(...futuras) - ANTECEDENCIA_MS;
      if (entrada > agora.getTime()) horas.push(entrada);
    }
    return horas.length === 0 ? null : new Date(Math.min(...horas));
  }

  /**
   * O que venceu até agora toca, ou vira atrasado se o relógio chegou mais de 2 min depois da hora.
   * Tudo numa transação; os avisos saem depois de gravar.
   */
  async conferir({ agora, ausencia }: Conferencia): Promise<void> {
    const fuso = this.fontes.lerFuso();
    const devidos = this.devidos(agora, fuso);
    const instante = agora.toISOString();
    const tocaram: { antes: LinhaLembrete; depois: LinhaLembrete }[] = [];
    const perdidos: { antes: LinhaLembrete; depois: LinhaLembrete }[] = [];
    if (devidos.length > 0) {
      this.repo.transacao(() => {
        for (const { linha, vencimento } of devidos) {
          // O recorrente vai até a última ocorrência que já chegou: as que ficaram no meio não tocam.
          const ocorrencia = ultimaAte(ocorrenciaDe(linha), agora, fuso);
          const hora = Math.max(vencimento, ocorrencia.quando.getTime());
          const perdeu = agora.getTime() - hora > TOLERANCIA_MS;
          const campos: CamposLembrete = {
            ...camposDe(linha),
            quando: ocorrencia.quando.toISOString(),
            inicio_recorrencia: linha.recorrencia === null ? null : ocorrencia.inicio.toISOString(),
            estado: perdeu ? "perdido" : "disparado",
            disparado_em: perdeu ? linha.disparado_em : instante,
            adiado_ate: null,
          };
          this.repo.gravar(linha.id, campos, instante, null);
          const depois = this.exigir(linha.id);
          (perdeu ? perdidos : tocaram).push({ antes: linha, depois });
        }
      });
      this.avisos.mudou({
        lembretes: [...tocaram, ...perdidos].map((m) => paraLembrete(m.depois)),
        removidos: [],
      });
    }

    // O aviso da ocorrência que deu lugar a outra sai da Central de Notificações.
    await this.resolver(
      [...tocaram, ...perdidos].filter((m) => m.antes.estado === "disparado").map((m) => m.antes),
      { atrasados: false },
    );
    // O canal `dock` só aparece no painel Hoje. O `calendario` toca pelo celular quando o evento dele
    // já chegou ao "Moductus" (F3-24); sem Google, ou com o envio na fila, avisa no Windows.
    for (const { depois } of tocaram) {
      if (depois.canal === "dock") continue;
      if (depois.canal === "calendario" && this.fontes.noGoogle?.(depois.id) === true) continue;
      await this.avisar(this.avisoDoLembrete(depois));
    }
    if (perdidos.length > 0) {
      const doCartao =
        ausencia === null || ausencia.de === null
          ? null
          : { de: ausencia.de.toISOString(), ate: ausencia.ate.toISOString() };
      for (const { depois } of perdidos) this.ausencias.set(depois.id, doCartao);
      const avisados = perdidos.map((m) => m.depois).filter((l) => l.canal !== "dock");
      if (ausencia !== null && avisados.length > 0) {
        if (this.atrasadosAvisados) await this.resolverAtrasados();
        await this.avisar(avisoDosAtrasados(avisados, ausencia));
        this.atrasadosAvisados = true;
      }
    }
    // O único atrasado pode ter voltado a tocar (recorrente): o aviso agrupado sai.
    if (this.atrasadosAvisados && this.repo.doEstado("perdido", "quando").length === 0) {
      await this.resolverAtrasados();
    }
    this.emitirHoje();
  }

  /** O que já chegou à hora: os que esperam e a próxima ocorrência dos recorrentes parados. */
  private devidos(agora: Date, fuso: string): { linha: LinhaLembrete; vencimento: number }[] {
    const devidos = this.repo
      .vencidos(agora.toISOString())
      .map((linha) => ({ linha, vencimento: Date.parse(linha.adiado_ate ?? linha.quando) }));
    for (const { linha, proxima } of this.proximosDosParados(fuso)) {
      if (proxima.quando.getTime() <= agora.getTime())
        devidos.push({ linha, vencimento: proxima.quando.getTime() });
    }
    return devidos;
  }

  /**
   * A próxima ocorrência de cada recorrente tocando ou perdido. A regra só é recalculada quando a
   * ocorrência, a regra ou o fuso mudam: o relógio pergunta a cada minuto.
   */
  private proximosDosParados(fuso: string): { linha: LinhaLembrete; proxima: Ocorrencia }[] {
    const parados = this.repo.recorrentesParados();
    const vivos = new Set(parados.map((l) => l.id));
    for (const id of this.proximas.keys()) if (!vivos.has(id)) this.proximas.delete(id);
    const resultado: { linha: LinhaLembrete; proxima: Ocorrencia }[] = [];
    for (const linha of parados) {
      const chave = `${linha.quando}|${linha.inicio_recorrencia ?? ""}|${linha.recorrencia ?? ""}|${fuso}`;
      let guardada = this.proximas.get(linha.id);
      if (guardada?.chave !== chave) {
        guardada = { chave, proxima: seguinte(ocorrenciaDe(linha), fuso) };
        this.proximas.set(linha.id, guardada);
      }
      if (guardada.proxima !== null) resultado.push({ linha, proxima: guardada.proxima });
    }
    return resultado;
  }

  /** A ausência do cartão, se todos os atrasados venceram na mesma; se não, o cartão não inventa. */
  private ausenciaComum(atrasados: readonly LinhaLembrete[]): AusenciaDoCartao | null {
    let comum: AusenciaDoCartao | null = null;
    for (const l of atrasados) {
      const a = this.ausencias.get(l.id) ?? null;
      if (a === null) return null;
      if (comum !== null && (comum.de !== a.de || comum.ate !== a.ate)) return null;
      comum = a;
    }
    return comum;
  }

  /** O botão do aviso do Windows: só vale para o lembrete tocando, na mesma ocorrência do aviso. */
  private async aoClicar(alvo: string, botao: string): Promise<boolean> {
    const arroba = alvo.indexOf("@");
    if (arroba < 0) return false;
    const linha = this.repo.lembrete(alvo.slice(0, arroba));
    if (!linha || linha.estado !== "disparado" || linha.quando !== alvo.slice(arroba + 1)) return false;
    if (botao === "adiar") {
      await this.adiar({ ids: [linha.id], minutos: ADIAR_LEMBRETE_MIN });
      return true;
    }
    if (botao === "feito") {
      await this.concluir({ ids: [linha.id] });
      return true;
    }
    return false;
  }

  /** O aviso do lembrete tocando: o texto no título e, no corpo, de onde ele vem e a hora. */
  private avisoDoLembrete(l: LinhaLembrete): NovoAviso {
    return {
      agenteId: ALBA,
      tipo: "lembrete",
      titulo: l.texto,
      corpo: this.corpoDoLembrete(l),
      referencia: referenciaDe(l.id, l.quando),
      botoes: BOTOES_DO_LEMBRETE,
    };
  }

  /** "Tarefa de hoje às 15:00" (LembreteHoje.dc.html), "Compromisso às 10:00" ou "Lembrete das 14:45". */
  private corpoDoLembrete(l: LinhaLembrete): string {
    const tarefa = l.tarefa_id === null ? null : this.repo.tarefaViva(l.tarefa_id);
    if (tarefa !== null) {
      if (tarefa.vence_em === null) return "Tarefa";
      const dia = this.rotuloDoDia(tarefa.vence_em);
      return tarefa.hora === null ? `Tarefa ${dia}` : `Tarefa ${dia} às ${tarefa.hora}`;
    }
    const evento = l.evento_id === null ? null : this.repo.eventoVivo(l.evento_id);
    if (evento !== null) {
      if (evento.dia_inteiro === 1) return `Compromisso ${this.rotuloDoDia(evento.inicio)}`;
      return `Compromisso às ${this.tempo.horaDe(new Date(evento.inicio))}`;
    }
    return `Lembrete das ${this.tempo.horaDe(new Date(l.quando))}`;
  }

  private rotuloDoDia(dia: string): string {
    if (dia === this.tempo.hoje()) return "de hoje";
    if (dia === this.tempo.amanha()) return "de amanhã";
    return `de ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  }

  private async avisar(aviso: NovoAviso): Promise<void> {
    try {
      await this.fontes.notificacoes.avisar(aviso);
    } catch (erro) {
      console.error(`lembretes: aviso não saiu: ${String(erro)}`);
    }
  }

  /**
   * Tira o ponto e o aviso do Windows da ocorrência que já foi resolvida. Sem atrasados, o aviso
   * agrupado também sai.
   */
  private async resolver(
    linhas: readonly { id: string; quando: string }[],
    opcoes: { atrasados: boolean } = { atrasados: true },
  ): Promise<void> {
    for (const l of linhas) {
      try {
        await this.fontes.notificacoes.resolvido(referenciaDe(l.id, l.quando));
      } catch (erro) {
        console.error(`lembretes: aviso não retirado: ${String(erro)}`);
      }
    }
    if (opcoes.atrasados && this.atrasadosAvisados && this.repo.doEstado("perdido", "quando").length === 0) {
      await this.resolverAtrasados();
    }
    this.emitirHoje();
  }

  private async resolverAtrasados(): Promise<void> {
    this.atrasadosAvisados = false;
    try {
      await this.fontes.notificacoes.resolvido(REFERENCIA_ATRASADOS);
    } catch (erro) {
      console.error(`lembretes: aviso dos atrasados não retirado: ${String(erro)}`);
    }
  }

  /** Avisa as janelas, rearma o relógio e atualiza o painel Hoje. */
  private mudou(mudanca: MudancaLembretes): void {
    this.avisos.mudou(mudanca);
    this.fontes.relogio?.mudou();
    this.emitirHoje();
  }

  /** O painel Hoje só recebe quando muda: o relógio confere a cada minuto. */
  private emitirHoje(): void {
    const hoje = this.hoje();
    const texto = JSON.stringify(hoje);
    if (texto === this.ultimoHoje) return;
    this.ultimoHoje = texto;
    this.avisos.hoje(hoje);
  }

  private exigir(id: string): LinhaLembrete {
    const linha = this.repo.lembrete(id);
    if (!linha) throw new Error(MENSAGEM_NAO_ENCONTRADO);
    return linha;
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

/**
 * O aviso agrupado dos que venceram numa ausência (ADR-0032): um só, com quantos e onde o PC
 * estava, e os textos no corpo. Nada toca um por um.
 */
/**
 * A trava do botão do aviso do Windows para quem pede com a ocorrência (o painel Hoje): só vale
 * para o lembrete que ainda toca nela. Sem ocorrência, o pedido vale como sempre.
 */
function exigirTocando(linhas: readonly LinhaLembrete[], quando: string | undefined): void {
  if (quando === undefined) return;
  if (linhas.some((l) => l.estado !== "disparado" || l.quando !== quando)) {
    throw new Error(MENSAGEM_LEMBRETE_NAO_TOCA);
  }
}

export function avisoDosAtrasados(perdidos: readonly LinhaLembrete[], ausencia: Ausencia): NovoAviso {
  const n = perdidos.length;
  const onde = ausencia.de === null ? "o Moductus estava fechado" : "o PC dormia";
  const textos = perdidos.slice(0, TEXTOS_NO_AGRUPADO).map((l) => l.texto);
  const resto = n - textos.length;
  return {
    agenteId: ALBA,
    tipo: "lembrete",
    titulo: n === 1 ? `1 lembrete passou enquanto ${onde}` : `${n} lembretes passaram enquanto ${onde}`,
    corpo: textos.join(" · ") + (resto > 0 ? ` e mais ${resto}` : ""),
    referencia: REFERENCIA_ATRASADOS,
  };
}
