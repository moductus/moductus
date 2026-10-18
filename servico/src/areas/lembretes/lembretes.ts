import type { DatabaseSync } from "node:sqlite";
import {
  MudancaLembrete,
  NovoLembrete,
  PedidoAdiarLembretes,
  PedidoLembretes,
  PedidoListarLembretes,
  type Apagados,
  type CanalLembrete,
  type EstadoLembrete,
  type Lembrete,
  type LembretesDeHoje,
  type MudancaLembretes,
  type Origem,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import type { BotaoAviso, NovoAviso, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import { escreverRecorrencia, lerRecorrencia, proximoInstante } from "../dia/recorrencia.ts";
import type { Ausencia, Conferencia, FonteDoRelogio } from "../dia/relogio.ts";
import { TempoDoDia } from "../dia/tempo.ts";

/**
 * Lembretes (PRODUCT.md §5, DATA.md §2, ADR-0032): o que dispara na hora, sem modelo e sem rede,
 * pelo relógio do dia. Cada linha é um lembrete e o `quando` é a ocorrência que ele representa
 * agora: a que vai tocar (`agendado`, ou `adiado` até `adiado_ate`), a que está tocando
 * (`disparado`) ou a que passou sem tocar (`perdido`).
 *
 * - **Disparo:** grava `disparado` e `disparado_em` numa transação e avisa como notificação do
 *   tipo `lembrete` em nome da Alba, com **Adiar 10 min** e **Feito** no aviso do Windows.
 * - **Recorrente:** a próxima ocorrência vem da regra a partir do `quando` (o `COUNT` desconta as
 *   que ficaram para trás). Tocando ou perdido, ele toca de novo na próxima, que toma o lugar da
 *   anterior; Feito o volta a `agendado` na próxima depois de agora; regra que acabou sai.
 * - **Atrasado:** o que o relógio só confere mais de 2 min depois da hora vira `perdido`, sem tocar.
 *   Se foi numa ausência (serviço parado, PC suspenso), os dessa vez saem juntos num aviso só.
 *   Escrito para um horário que já passou há mais de 2 min também vira `perdido`, quieto.
 * - O `quando` é um instante UTC: mudar o fuso não remarca o que está gravado; só a próxima
 *   ocorrência de um recorrente passa a ser contada no relógio do fuso novo.
 */

export const MENSAGEM_NAO_ENCONTRADO = "lembrete não encontrado";
export const MENSAGEM_TAREFA = "a tarefa deste lembrete não existe mais";
export const MENSAGEM_EVENTO = "o evento deste lembrete não existe mais";

/** Até quanto depois da hora o lembrete ainda toca; mais que isso, vira atrasado. */
export const TOLERANCIA_MS = 2 * 60_000;
/** O próximo lembrete aparece no topo do Hoje, sem som, a partir de 30 min antes. */
export const ANTECEDENCIA_MS = 30 * 60_000;
/** O "Adiar 10 min" do aviso do Windows. */
export const ADIAR_DO_AVISO_MIN = 10;

/** Os botões do aviso, os mesmos do lembrete tocando no painel Hoje (LembreteHoje.dc.html). */
export const BOTOES_DO_LEMBRETE: readonly BotaoAviso[] = [
  { id: "adiar", rotulo: `Adiar ${ADIAR_DO_AVISO_MIN} min` },
  { id: "feito", rotulo: "Feito" },
];

/** Os lembretes tocam em nome da Alba (AGENTS.md §2). */
const ALBA = "alba";
const PREFIXO = "lembrete";
/** O aviso agrupado dos atrasados: um só, trocado a cada ausência. */
export const REFERENCIA_ATRASADOS = "lembretes:atrasados";
/** Quantos textos o aviso agrupado mostra antes do "e mais N". */
const TEXTOS_NO_AGRUPADO = 3;
/** Teto de passos ao andar uma regra: um recorrente esquecido por anos não trava o serviço. */
const PASSOS_MAXIMOS = 5000;
/** Sem `COUNT`, o andar salta direto para perto do alvo: alguns dias antes dele. */
const SALTO_MS = 8 * 86_400_000;

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
  "id, texto, quando, recorrencia, tarefa_id, evento_id, estado, disparado_em, adiado_ate, canal, origem, agente_id, execucao_id, criado_em, atualizado_em";
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
  canal: CanalLembrete;
  estado: EstadoLembrete;
  disparado_em: string | null;
  adiado_ate: string | null;
}

const camposDe = (l: LinhaLembrete): CamposLembrete => ({
  texto: l.texto,
  quando: l.quando,
  recorrencia: l.recorrencia,
  canal: l.canal,
  estado: l.estado,
  disparado_em: l.disparado_em,
  adiado_ate: l.adiado_ate,
});

/** `lembretes` da migração 013. O que está na lixeira não aparece. */
export class RepositorioLembretes {
  constructor(private readonly db: DatabaseSync) {}

  lembrete(id: string): LinhaLembrete | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM lembretes WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaLembrete | undefined;
    return linha ?? null;
  }

  /** Os de um intervalo de `quando` ou de `adiado_ate`, e só dos estados pedidos. */
  lista(filtro: { de?: string; ate?: string; estados?: readonly EstadoLembrete[] }): LinhaLembrete[] {
    const filtros = ["apagado_em IS NULL"];
    const valores: string[] = [];
    if (filtro.de !== undefined || filtro.ate !== undefined) {
      const de = filtro.de ?? "";
      const ate = filtro.ate ?? "￿";
      filtros.push("((quando >= ? AND quando <= ?) OR (adiado_ate >= ? AND adiado_ate <= ?))");
      valores.push(de, ate, de, ate);
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

  /** Os recorrentes tocando ou perdidos: tocam de novo na próxima ocorrência. */
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
        `INSERT INTO lembretes (id, texto, quando, recorrencia, tarefa_id, evento_id, estado, disparado_em,
           adiado_ate, canal, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        l.id,
        l.texto,
        l.quando,
        l.recorrencia,
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
      c.canal,
      c.estado,
      c.disparado_em,
      c.adiado_ate,
      agora,
    ];
    if (carimbo === null) {
      this.db
        .prepare(
          `UPDATE lembretes SET texto = ?, quando = ?, recorrencia = ?, canal = ?, estado = ?, disparado_em = ?,
             adiado_ate = ?, atualizado_em = ? WHERE id = ? AND apagado_em IS NULL`,
        )
        .run(...valores, id);
      return;
    }
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE lembretes SET texto = ?, quando = ?, recorrencia = ?, canal = ?, estado = ?, disparado_em = ?,
           adiado_ate = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
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

/** Uma ocorrência de um lembrete: o instante e a regra que vale a partir dele (com o `COUNT` que resta). */
export interface Ocorrencia {
  quando: Date;
  recorrencia: string | null;
}

/** A ocorrência seguinte, ou `null` sem regra, com a regra acabada ou fora do subconjunto. */
export function seguinte(o: Ocorrencia, fuso: string): Ocorrencia | null {
  if (o.recorrencia === null) return null;
  const leitura = lerRecorrencia(o.recorrencia);
  if (!leitura.entendida) return null;
  const proxima = proximoInstante(o.recorrencia, o.quando, fuso, o.quando);
  if (proxima === null) return null;
  const { contagem } = leitura.regra;
  // A regra passa a contar da ocorrência nova: o COUNT perde a que ficou para trás.
  const recorrencia =
    contagem === null ? o.recorrencia : escreverRecorrencia({ ...leitura.regra, contagem: contagem - 1 });
  return { quando: proxima, recorrencia };
}

/** A última ocorrência até `limite`, a partir de `o` (que fica, se a seguinte já passa do limite). */
export function ultimaAte(o: Ocorrencia, limite: Date, fuso: string): Ocorrencia {
  let atual = saltar(o, new Date(limite.getTime() - SALTO_MS), fuso);
  if (atual.quando.getTime() > limite.getTime()) atual = o;
  for (let i = 0; i < PASSOS_MAXIMOS; i++) {
    const s = seguinte(atual, fuso);
    if (s === null || s.quando.getTime() > limite.getTime()) break;
    atual = s;
  }
  return atual;
}

/** A primeira ocorrência depois de `limite`, ou `null` se a regra acaba antes. */
export function primeiraDepois(o: Ocorrencia, limite: Date, fuso: string): Ocorrencia | null {
  let atual = o;
  const salto = saltar(o, new Date(limite.getTime() - SALTO_MS), fuso);
  if (salto !== o) {
    // O salto já é a primeira depois de alguns dias antes do limite: se passou dele, é a resposta.
    if (salto.quando.getTime() > limite.getTime()) return salto;
    atual = salto;
  }
  for (let i = 0; i < PASSOS_MAXIMOS; i++) {
    const s = seguinte(atual, fuso);
    if (s === null) return null;
    atual = s;
    if (atual.quando.getTime() > limite.getTime()) return atual;
  }
  return null;
}

/**
 * Sem `COUNT`, a regra vale igual a partir de qualquer ocorrência: salta direto para a primeira
 * depois de `depoisDe`, sem andar uma a uma (um diário esquecido por um ano). Com `COUNT`, anda.
 */
function saltar(o: Ocorrencia, depoisDe: Date, fuso: string): Ocorrencia {
  if (o.recorrencia === null || depoisDe.getTime() <= o.quando.getTime()) return o;
  const leitura = lerRecorrencia(o.recorrencia);
  if (!leitura.entendida || leitura.regra.contagem !== null) return o;
  const salto = proximoInstante(o.recorrencia, o.quando, fuso, depoisDe);
  return salto === null ? o : { quando: salto, recorrencia: o.recorrencia };
}

const ocorrenciaDe = (l: LinhaLembrete): Ocorrencia => ({
  quando: new Date(l.quando),
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
  /** A ausência em que os atrasados de agora venceram, para o cartão; some com eles. */
  private ausencia: { de: string; ate: string } | null = null;
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
   * O lembrete do painel Hoje: o próximo a tocar, se faltam 30 min ou menos; os que estão tocando;
   * os atrasados, com a ausência em que venceram, quando se sabe.
   */
  hoje(): LembretesDeHoje {
    const agora = this.agora();
    const proximo = this.repo.primeiroEsperando(agora.toISOString());
    const chegando =
      proximo !== null &&
      Date.parse(proximo.adiado_ate ?? proximo.quando) - agora.getTime() <= ANTECEDENCIA_MS
        ? paraLembrete(proximo)
        : null;
    const atrasados = this.repo.doEstado("perdido", "quando").map(paraLembrete);
    return {
      chegando,
      tocando: this.repo.doEstado("disparado", "disparado_em").map(paraLembrete),
      atrasados,
      ausencia: atrasados.length > 0 ? this.ausencia : null,
    };
  }

  async criar(entrada: NovoLembrete, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete> {
    const novo = NovoLembrete.parse(entrada);
    const tarefaId = novo.tarefaId ?? null;
    const eventoId = novo.eventoId ?? null;
    if (tarefaId !== null && !this.repo.tarefaViva(tarefaId)) throw new Error(MENSAGEM_TAREFA);
    if (eventoId !== null && !this.repo.eventoVivo(eventoId)) throw new Error(MENSAGEM_EVENTO);
    const id = this.gerarId();
    this.repo.criar(
      {
        id,
        tarefaId,
        eventoId,
        texto: novo.texto,
        quando: novo.quando,
        recorrencia: novo.recorrencia ?? null,
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

  /** Texto, horário, repetição e canal. Mudar o `quando` volta o lembrete a agendado. */
  async definir(entrada: MudancaLembrete, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete> {
    const mudanca = MudancaLembrete.parse(entrada);
    const atual = this.exigir(mudanca.id);
    const reagendou = mudanca.quando !== undefined && mudanca.quando !== atual.quando;
    const campos: CamposLembrete = {
      ...camposDe(atual),
      texto: mudanca.texto ?? atual.texto,
      recorrencia: mudanca.recorrencia === undefined ? atual.recorrencia : mudanca.recorrencia,
      canal: mudanca.canal ?? atual.canal,
      ...(reagendou
        ? { quando: mudanca.quando ?? atual.quando, estado: "agendado" as const, adiado_ate: null }
        : {}),
    };
    if (
      campos.texto === atual.texto &&
      campos.recorrencia === atual.recorrencia &&
      campos.canal === atual.canal &&
      !reagendou
    ) {
      return paraLembrete(atual);
    }
    this.repo.gravar(atual.id, campos, this.instante(), carimbo);
    const lembrete = paraLembrete(this.exigir(atual.id));
    this.mudou({ lembretes: [lembrete], removidos: [] });
    if (reagendou) await this.resolver([atual]);
    return lembrete;
  }

  /** "Adiar 10 min" do aviso e do painel, "Adiar os 2 em 30 min" dos atrasados: a partir de agora. */
  async adiar(entrada: PedidoAdiarLembretes, carimbo: Carimbo = DO_USUARIO): Promise<Lembrete[]> {
    const pedido = PedidoAdiarLembretes.parse(entrada);
    const linhas = [...new Set(pedido.ids)].map((id) => this.exigir(id));
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
  async concluir(entrada: PedidoLembretes, carimbo: Carimbo = DO_USUARIO): Promise<MudancaLembretes> {
    const pedido = PedidoLembretes.parse(entrada);
    const linhas = [...new Set(pedido.ids)].map((id) => this.exigir(id));
    const agora = this.agora();
    const fuso = this.fontes.lerFuso();
    const continuam: string[] = [];
    const removidos: string[] = [];
    this.repo.transacao(() => {
      for (const l of linhas) {
        const limite = new Date(Math.max(agora.getTime(), Date.parse(l.quando)));
        const proxima = primeiraDepois(ocorrenciaDe(l), limite, fuso);
        if (proxima === null) {
          this.repo.apagar([l.id], agora.toISOString(), carimbo);
          removidos.push(l.id);
          continue;
        }
        const campos: CamposLembrete = {
          ...camposDe(l),
          quando: proxima.quando.toISOString(),
          recorrencia: proxima.recorrencia,
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
   * as janelas: o relógio se rearma, o painel Hoje se atualiza, e o aviso do que saiu é retirado.
   */
  mudaramPorFora(mudanca: MudancaLembretes): void {
    this.fontes.relogio?.mudou();
    this.emitirHoje();
    const quandos = mudanca.removidos.flatMap((id) => {
      const quando = this.repo.quandoDe(id);
      return quando === null ? [] : [{ id, quando }];
    });
    this.resolver(quandos).catch((erro: unknown) =>
      console.error(`lembretes: aviso do que saiu não retirado: ${String(erro)}`),
    );
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
    for (const l of this.repo.recorrentesParados()) {
      const s = seguinte(ocorrenciaDe(l), fuso);
      if (s !== null) horas.push(s.quando.getTime());
    }
    const chegando = this.repo.primeiroEsperando(agora.toISOString());
    if (chegando !== null) {
      const entrada = Date.parse(chegando.adiado_ate ?? chegando.quando) - ANTECEDENCIA_MS;
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
    if (devidos.length === 0) {
      this.emitirHoje();
      return;
    }
    const instante = agora.toISOString();
    const tocaram: { antes: LinhaLembrete; depois: LinhaLembrete }[] = [];
    const perdidos: { antes: LinhaLembrete; depois: LinhaLembrete }[] = [];
    this.repo.transacao(() => {
      for (const { linha, vencimento } of devidos) {
        // O recorrente vai até a última ocorrência que já chegou: as que ficaram no meio não tocam.
        const ocorrencia = ultimaAte(ocorrenciaDe(linha), agora, fuso);
        const hora = Math.max(vencimento, ocorrencia.quando.getTime());
        const perdeu = agora.getTime() - hora > TOLERANCIA_MS;
        const campos: CamposLembrete = {
          ...camposDe(linha),
          quando: ocorrencia.quando.toISOString(),
          recorrencia: ocorrencia.recorrencia,
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

    // O aviso da ocorrência que deu lugar a outra sai da Central de Notificações.
    await this.resolver(
      [...tocaram, ...perdidos].filter((m) => m.antes.estado === "disparado").map((m) => m.antes),
      { atrasados: false },
    );
    for (const { depois } of tocaram) await this.avisar(this.avisoDoLembrete(depois));
    if (perdidos.length > 0 && ausencia !== null) {
      this.ausencia =
        ausencia.de === null ? null : { de: ausencia.de.toISOString(), ate: ausencia.ate.toISOString() };
      if (this.atrasadosAvisados) await this.resolverAtrasados();
      await this.avisar(
        avisoDosAtrasados(
          perdidos.map((m) => m.depois),
          ausencia,
        ),
      );
      this.atrasadosAvisados = true;
    }
    this.emitirHoje();
  }

  /** O que já chegou à hora: os que esperam e a próxima ocorrência dos recorrentes parados. */
  private devidos(agora: Date, fuso: string): { linha: LinhaLembrete; vencimento: number }[] {
    const devidos = this.repo
      .vencidos(agora.toISOString())
      .map((linha) => ({ linha, vencimento: Date.parse(linha.adiado_ate ?? linha.quando) }));
    for (const linha of this.repo.recorrentesParados()) {
      const s = seguinte(ocorrenciaDe(linha), fuso);
      if (s !== null && s.quando.getTime() <= agora.getTime())
        devidos.push({ linha, vencimento: s.quando.getTime() });
    }
    return devidos;
  }

  /** O botão do aviso do Windows: só vale para o lembrete tocando, na mesma ocorrência do aviso. */
  private async aoClicar(alvo: string, botao: string): Promise<boolean> {
    const arroba = alvo.indexOf("@");
    if (arroba < 0) return false;
    const linha = this.repo.lembrete(alvo.slice(0, arroba));
    if (!linha || linha.estado !== "disparado" || linha.quando !== alvo.slice(arroba + 1)) return false;
    if (botao === "adiar") {
      await this.adiar({ ids: [linha.id], minutos: ADIAR_DO_AVISO_MIN });
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
   * agrupado também sai, e a ausência deles some.
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
    if (this.repo.doEstado("perdido", "quando").length === 0) this.ausencia = null;
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
