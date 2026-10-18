import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Conexao } from "@moductus/contrato";
import { lerRecorrencia } from "../../areas/dia/recorrencia.ts";
import { ehDia, instanteNoFuso, noFuso } from "../../areas/dia/tempo.ts";
import { novoId } from "../../banco/ulid.ts";
import { ENDERECOS_GOOGLE, type EnderecosGoogle } from "./cliente.ts";
import {
  apagarEvento,
  conferirCalendario,
  criarCalendario,
  ErroCalendario,
  inserirEvento,
  lerEvento,
  mudarEvento,
  paginaDeEventos,
  type CamposLidos,
  type EventoEscrito,
  type PontoDeLeitura,
} from "./calendario.ts";
import type { ServicoGoogleAgenda } from "./google-agenda.ts";
import {
  DIAS_PARA_TRAS,
  INTERVALO_LEITURA_MS,
  MAXIMO_LEITURA_BYTES,
  MAXIMO_PAGINAS,
  VARIACAO_LEITURA,
  type MudancaCache,
} from "./leitura.ts";

/**
 * O espelho no calendário "Moductus" do Google (F3-24, ADR-0035): o que precisa te alcançar longe
 * do PC vira evento com alerta `popup` num calendário que o Moductus cria na conta ao conectar
 * (AGENTS.md §2 Alba, PRODUCT.md §6 "Fora do PC"). Escrever nele não pede aprovação: foi
 * autorizado na conexão.
 *
 * - **O que vai:** a tarefa aberta com dia e hora (o alerta é o lembrete dela, 15 min antes por
 *   padrão), o lembrete com horário que não é de uma tarefa espelhada (alerta na hora; o
 *   recorrente vai com a regra, para o celular tocar mesmo com o PC desligado) e o evento que você
 *   pôs no "Moductus" pela agenda. Da tarefa e do lembrete só vão título, horário e alerta. O
 *   lembrete do canal `dock` não vai: ele é quieto por escolha.
 * - **Fila:** toda escrita passa por `agenda_saida`, uma linha por item. O espelho confere o que
 *   cada item devia ser contra o que foi mandado (`agenda_espelho`) e põe na fila só o que mudou;
 *   o envio monta o evento na hora, do estado daquele momento. Falha de rede, de cota ou do Google
 *   espera com backoff exponencial e variação; o que o Google recusa de vez sai da fila.
 * - **Sem duplicar:** o id do evento é escolhido aqui antes do primeiro envio. Se o Google gravou
 *   e a resposta se perdeu, a nova tentativa dá 409, e o evento que já está lá é atualizado.
 * - **De volta:** o "Moductus" também é lido (pelo `nextSyncToken`). Mudança de hora ou título
 *   feita lá é adotada pela tarefa, pelo lembrete ou pelo evento; o eco da própria escrita é
 *   reconhecido pelo etag e pelo que foi mandado. Se o item ainda tem envio na fila, a mudança
 *   daqui vence. Evento apagado lá desliga o espelho daquele item (a tarefa fica); o evento da
 *   agenda vai junto para a lixeira.
 * - **Calendário apagado** (404): é criado de novo uma vez, com aviso, e tudo é mandado outra vez.
 */

export const NOME_DO_ESPELHO = "Moductus";

/** A tarefa sem estimativa ocupa isso no Google; o lembrete, isso. Os dois não marcam ocupado. */
export const DURACAO_TAREFA_MIN = 30;
export const DURACAO_LEMBRETE_MIN = 15;

/** O que o Google aceita de alerta por evento: até 5, de 0 a 4 semanas antes. */
export const MAXIMO_ALERTAS = 5;
export const MAXIMO_MINUTOS_ALERTA = 40_320;

/** A espera da primeira nova tentativa, que dobra a cada falha até o teto, com variação de 25%. */
export const ESPERA_INICIAL_MS = 15_000;
export const ESPERA_MAXIMA_MS = 15 * 60_000;
export const VARIACAO_ESPERA = 0.25;

/** Quantos envios uma passada faz: o resto vai na seguinte, sem prender o serviço. */
export const ENVIOS_POR_VEZ = 50;

/** Quantos itens o espelho confere de uma vez (os mais próximos primeiro). */
export const MAXIMO_ITENS = 2000;

/** Mudanças em rajada (adiar dez tarefas) viram um envio só. */
export const ESPERA_AO_MUDAR_MS = 500;

/** O aviso da Alba quando o "Moductus" sumiu do Google e foi criado de novo. */
export const TITULO_RECRIADO = 'O calendário "Moductus" sumiu do Google.';
export const CORPO_RECRIADO =
  "Criei de novo e estou mandando as tarefas e os lembretes com horário outra vez.";

const MS_DIA = 86_400_000;
const MAXIMO_ERRO = 500;

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export type TipoItem = "tarefa" | "lembrete" | "evento";
const TIPOS: readonly TipoItem[] = ["tarefa", "lembrete", "evento"];
const ehTipo = (v: unknown): v is TipoItem => typeof v === "string" && TIPOS.includes(v as TipoItem);

/**
 * O evento que um item vira no Google, no formato das datas do banco. É também o que se guarda
 * como `enviado`, e a comparação do que mudou é por ele: a ordem dos campos é fixa.
 */
export interface EventoDoItem {
  titulo: string;
  descricao: string | null;
  local: string | null;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  /** RRULE sem o `RRULE:`; só com ela vai o fuso, onde a regra anda. */
  recorrencia: string | null;
  fuso: string | null;
  /** Minutos antes de cada `popup`. */
  alertas: number[];
  /** Não marca ocupado (`transparency`): a tarefa e o lembrete. */
  livre: boolean;
}

const impressao = (e: EventoDoItem): string =>
  JSON.stringify({
    titulo: e.titulo,
    descricao: e.descricao,
    local: e.local,
    inicio: e.inicio,
    fim: e.fim,
    diaInteiro: e.diaInteiro,
    recorrencia: e.recorrencia,
    fuso: e.fuso,
    alertas: e.alertas,
    livre: e.livre,
  });

function lerImpressao(texto: string | null): Pick<EventoDoItem, "titulo" | "inicio" | "diaInteiro"> | null {
  if (texto === null) return null;
  try {
    const v = JSON.parse(texto) as Partial<EventoDoItem>;
    return typeof v.titulo === "string" && typeof v.inicio === "string"
      ? { titulo: v.titulo, inicio: v.inicio, diaInteiro: v.diaInteiro === true }
      : null;
  } catch {
    return null;
  }
}

/** Os alertas que o Google aceita: inteiros de 0 a 4 semanas, sem repetir, até 5. */
function alertasValidos(minutos: readonly number[]): number[] {
  const validos = minutos.filter((m) => Number.isInteger(m) && m >= 0 && m <= MAXIMO_MINUTOS_ALERTA);
  return [...new Set(validos)].sort((a, b) => a - b).slice(0, MAXIMO_ALERTAS);
}

const depois = (instante: string, minutos: number) =>
  new Date(Date.parse(instante) + minutos * 60_000).toISOString();

/** Um id de evento do Google (base32hex, de 5 a 1024 letras), novo a cada item. */
export const novoIdExterno = () => `md${randomBytes(16).toString("hex")}`;

interface LinhaEspelho {
  id: string;
  id_externo: string;
  token_sincronizacao: string | null;
}

export interface LinhaMapa {
  item_tipo: TipoItem;
  item_id: string;
  id_externo: string;
  etag_externo: string | null;
  enviado: string | null;
  desligado: number;
}

export interface LinhaSaida {
  id: string;
  item_tipo: TipoItem;
  item_id: string;
  operacao: "criar" | "mudar" | "apagar";
  tentativas: number;
  proxima_tentativa_em: string;
  atualizado_em: string;
}

interface TarefaDoEspelho {
  titulo: string;
  vence_em: string | null;
  hora: string | null;
  duracao_estimada_min: number | null;
  estado: string;
}

interface LembreteDoEspelho {
  texto: string;
  quando: string;
  adiado_ate: string | null;
  recorrencia: string | null;
  inicio_recorrencia: string | null;
  tarefa_id: string | null;
  canal: string;
}

interface EventoDoEspelho {
  titulo: string;
  descricao: string | null;
  local: string | null;
  inicio: string;
  fim: string;
  dia_inteiro: number;
  recorrencia: string | null;
  alertas: string;
}

const COLUNAS_MAPA = "item_tipo, item_id, id_externo, etag_externo, enviado, desligado";
const COLUNAS_SAIDA = "id, item_tipo, item_id, operacao, tentativas, proxima_tentativa_em, atualizado_em";

/** Linhas gravadas pelo espelho a partir do Google levam a origem `conexao` (DATA.md §1). */
const ORIGEM = "conexao";

/**
 * O calendário "Moductus" (`calendarios` com `espelho`), a fila `agenda_saida` (014), o que já foi
 * ao Google (`agenda_espelho`, 021) e o que cada tarefa, lembrete e evento devia ser lá. Tarefas e
 * lembretes são lidos direto do banco: as áreas são donas deles, e a mudança que vem do Google
 * volta por elas (`adotar`), não por aqui.
 */
export class RepositorioEspelhoGoogle {
  constructor(private readonly db: DatabaseSync) {}

  espelho(): LinhaEspelho | null {
    const linha = this.db
      .prepare(
        `SELECT id, id_externo, token_sincronizacao FROM calendarios
          WHERE fonte = 'google' AND espelho = 1 AND apagado_em IS NULL`,
      )
      .get() as LinhaEspelho | undefined;
    return linha ?? null;
  }

  /**
   * Guarda o calendário criado agora. Se a leitura dos calendários já o achou na lista da conta
   * e o guardou como um calendário qualquer, aquela linha sai (com o cache dela): o espelho é este.
   */
  gravarEspelho(idExterno: string, agora: string): void {
    this.tirarOutroComOId(idExterno);
    this.db
      .prepare(
        `INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever, ler, criado_em, atualizado_em, origem)
         VALUES (?, ?, 'google', ?, 1, 1, 1, ?, ?, ?)`,
      )
      .run(novoId(), NOME_DO_ESPELHO, idExterno, agora, agora, ORIGEM);
  }

  /**
   * O "Moductus" sumiu e foi criado de novo: o espelho passa a apontar para o novo, tudo o que já
   * tinha ido esquece o caminho (o próximo envio cria de novo, inclusive o que você tinha
   * desligado), e os eventos da agenda que estavam nele voltam à fila.
   */
  trocarEspelho(idExterno: string, agora: string): void {
    const espelho = this.espelho();
    if (espelho === null) {
      this.gravarEspelho(idExterno, agora);
      return;
    }
    this.tirarOutroComOId(idExterno);
    this.db
      .prepare(
        `UPDATE calendarios SET id_externo = ?, token_sincronizacao = NULL, sincronizado_em = NULL,
           atualizado_em = ?, origem = ? WHERE id = ?`,
      )
      .run(idExterno, agora, ORIGEM, espelho.id);
    this.db.prepare("DELETE FROM agenda_espelho").run();
    this.db.prepare("DELETE FROM agenda_saida").run();
    this.db
      .prepare("UPDATE eventos SET id_externo = NULL, etag_externo = NULL WHERE calendario_id = ?")
      .run(espelho.id);
    const vivos = this.db
      .prepare("SELECT id FROM eventos WHERE calendario_id = ? AND apagado_em IS NULL")
      .all(espelho.id) as { id: string }[];
    for (const { id } of vivos) this.enfileirar("evento", id, "criar", agora);
  }

  private tirarOutroComOId(idExterno: string): void {
    const outro = this.db
      .prepare("SELECT id FROM calendarios WHERE fonte = 'google' AND id_externo = ? AND espelho = 0")
      .get(idExterno) as { id: string } | undefined;
    if (!outro) return;
    this.db.prepare("DELETE FROM eventos WHERE calendario_id = ?").run(outro.id);
    this.db.prepare("DELETE FROM calendarios WHERE id = ?").run(outro.id);
  }

  zerarToken(): void {
    this.db.prepare("UPDATE calendarios SET token_sincronizacao = NULL WHERE espelho = 1").run();
  }

  gravarToken(calendarioId: string, token: string, agora: string): void {
    this.db
      .prepare("UPDATE calendarios SET token_sincronizacao = ?, sincronizado_em = ? WHERE id = ?")
      .run(token, agora, calendarioId);
  }

  // O que já foi ao Google.

  mapa(tipo: TipoItem, id: string): LinhaMapa | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_MAPA} FROM agenda_espelho WHERE item_tipo = ? AND item_id = ?`)
      .get(tipo, id) as LinhaMapa | undefined;
    return linha ?? null;
  }

  mapaPeloIdExterno(idExterno: string): LinhaMapa | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_MAPA} FROM agenda_espelho WHERE id_externo = ?`)
      .get(idExterno) as LinhaMapa | undefined;
    return linha ?? null;
  }

  mapas(): LinhaMapa[] {
    return this.db
      .prepare(`SELECT ${COLUNAS_MAPA} FROM agenda_espelho ORDER BY item_tipo, item_id`)
      .all() as unknown as LinhaMapa[];
  }

  /** O item vai ao Google pela primeira vez: o id do evento de lá nasce aqui, antes do envio. */
  planejar(tipo: TipoItem, id: string, agora: string): LinhaMapa {
    this.db
      .prepare(
        `INSERT INTO agenda_espelho (id, item_tipo, item_id, id_externo, criado_em, atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (item_tipo, item_id) DO NOTHING`,
      )
      .run(novoId(), tipo, id, novoIdExterno(), agora, agora, ORIGEM);
    return this.mapa(tipo, id)!;
  }

  /**
   * Um evento achado no Google com o `moductus_id` deste item (mandado por outro PC, ou antes de
   * esta tabela existir): ele passa a ser o espelho do item, e o próximo envio o atualiza.
   */
  adotarMapa(tipo: TipoItem, id: string, idExterno: string, etag: string | null, agora: string): void {
    this.db.prepare("DELETE FROM agenda_espelho WHERE item_tipo = ? AND item_id = ?").run(tipo, id);
    this.db
      .prepare(
        `INSERT INTO agenda_espelho (id, item_tipo, item_id, id_externo, etag_externo, criado_em, atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(novoId(), tipo, id, idExterno, etag, agora, agora, ORIGEM);
    if (tipo === "evento") this.marcarEvento(id, idExterno, etag);
  }

  /** O que foi mandado chegou: o etag novo, o que foi, e o evento da agenda sabe o id de lá. */
  gravarEnvio(m: LinhaMapa, etag: string | null, enviado: string, agora: string): void {
    this.db
      .prepare(
        `UPDATE agenda_espelho SET etag_externo = ?, enviado = ?, atualizado_em = ?
          WHERE item_tipo = ? AND item_id = ?`,
      )
      .run(etag, enviado, agora, m.item_tipo, m.item_id);
    if (m.item_tipo === "evento") this.marcarEvento(m.item_id, m.id_externo, etag);
  }

  /** A mudança de lá foi adotada: o etag dela e o que o item virou passam a ser o que foi. */
  gravarAdotado(m: LinhaMapa, etag: string | null, enviado: string | null, agora: string): void {
    this.db
      .prepare(
        `UPDATE agenda_espelho SET etag_externo = ?, enviado = coalesce(?, enviado), atualizado_em = ?
          WHERE item_tipo = ? AND item_id = ?`,
      )
      .run(etag, enviado, agora, m.item_tipo, m.item_id);
    if (m.item_tipo === "evento") this.marcarEvento(m.item_id, m.id_externo, etag);
  }

  /** O Google recusou este conteúdo de vez: fica anotado como mandado, até o item mudar de novo. */
  gravarRecusa(m: LinhaMapa, enviado: string, agora: string): void {
    this.db
      .prepare("UPDATE agenda_espelho SET enviado = ?, atualizado_em = ? WHERE item_tipo = ? AND item_id = ?")
      .run(enviado, agora, m.item_tipo, m.item_id);
  }

  desligar(m: LinhaMapa, agora: string): void {
    this.db
      .prepare(
        `UPDATE agenda_espelho SET desligado = 1, etag_externo = NULL, atualizado_em = ?
          WHERE item_tipo = ? AND item_id = ?`,
      )
      .run(agora, m.item_tipo, m.item_id);
  }

  tirarMapa(tipo: TipoItem, id: string): void {
    this.db.prepare("DELETE FROM agenda_espelho WHERE item_tipo = ? AND item_id = ?").run(tipo, id);
    if (tipo === "evento") {
      this.db
        .prepare(
          "UPDATE eventos SET id_externo = NULL, etag_externo = NULL WHERE id = ? AND apagado_em IS NOT NULL",
        )
        .run(id);
    }
  }

  private marcarEvento(id: string, idExterno: string, etag: string | null): void {
    this.db
      .prepare("UPDATE eventos SET id_externo = ?, etag_externo = ? WHERE id = ?")
      .run(idExterno, etag, id);
  }

  // A fila.

  pendente(tipo: TipoItem, id: string): LinhaSaida | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_SAIDA} FROM agenda_saida WHERE item_tipo = ? AND item_id = ?`)
      .get(tipo, id) as LinhaSaida | undefined;
    return linha ?? null;
  }

  /** Os que já podem ir, na ordem em que podiam. */
  devidos(agora: string, limite: number): LinhaSaida[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS_SAIDA} FROM agenda_saida WHERE proxima_tentativa_em <= ?
          ORDER BY proxima_tentativa_em, id LIMIT ?`,
      )
      .all(agora, limite) as unknown as LinhaSaida[];
  }

  /** A próxima tentativa marcada, para o relógio do envio. */
  proximaTentativa(): string | null {
    const linha = this.db.prepare("SELECT min(proxima_tentativa_em) AS em FROM agenda_saida").get() as {
      em: string | null;
    };
    return linha.em;
  }

  /** Como a agenda faz (`RepositorioAgenda.enfileirarSaida`): a nova substitui a pendente e vai já. */
  enfileirar(tipo: TipoItem, id: string, operacao: LinhaSaida["operacao"], agora: string): void {
    this.db
      .prepare(
        `INSERT INTO agenda_saida (id, item_tipo, item_id, operacao, proxima_tentativa_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (item_tipo, item_id) DO UPDATE SET operacao = excluded.operacao, tentativas = 0,
           ultimo_erro = NULL, proxima_tentativa_em = excluded.proxima_tentativa_em,
           atualizado_em = excluded.atualizado_em`,
      )
      .run(novoId(), tipo, id, operacao, agora, agora, agora);
  }

  /** Sai da fila, a não ser que uma mudança nova tenha entrado enquanto o envio corria. */
  tirarDaFila(linha: Pick<LinhaSaida, "id" | "atualizado_em">): void {
    this.db
      .prepare("DELETE FROM agenda_saida WHERE id = ? AND atualizado_em = ?")
      .run(linha.id, linha.atualizado_em);
  }

  falhou(linha: LinhaSaida, proxima: string, erro: string, agora: string): void {
    this.db
      .prepare(
        `UPDATE agenda_saida SET tentativas = tentativas + 1, proxima_tentativa_em = ?, ultimo_erro = ?, atualizado_em = ?
          WHERE id = ? AND atualizado_em = ?`,
      )
      .run(proxima, erro.slice(0, MAXIMO_ERRO), agora, linha.id, linha.atualizado_em);
  }

  // O que cada item devia ser no Google.

  /**
   * Os itens que podem ir, do mais próximo ao mais distante: tarefas abertas com hora desde
   * `desdeDia`, lembretes vivos (fora do `dock`) desde `desde` e os recorrentes. A conferência de
   * cada um é a de {@link tarefa} e {@link lembrete}.
   */
  candidatos(desde: string, desdeDia: string, limite: number): { tipo: TipoItem; id: string }[] {
    return this.db
      .prepare(
        `SELECT tipo, id FROM (
           SELECT 'tarefa' AS tipo, id, vence_em || 'T' || hora AS ordem FROM tarefas
            WHERE estado = 'aberta' AND apagado_em IS NULL AND vence_em IS NOT NULL AND hora IS NOT NULL
              AND vence_em >= ?
           UNION ALL
           SELECT 'lembrete', id, coalesce(adiado_ate, quando) FROM lembretes
            WHERE apagado_em IS NULL AND canal <> 'dock'
              AND (recorrencia IS NOT NULL OR coalesce(adiado_ate, quando) >= ?))
         ORDER BY ordem, tipo, id LIMIT ?`,
      )
      .all(desdeDia, desde, limite) as { tipo: TipoItem; id: string }[];
  }

  tarefa(id: string): TarefaDoEspelho | null {
    const linha = this.db
      .prepare(
        `SELECT titulo, vence_em, hora, duracao_estimada_min, estado FROM tarefas
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .get(id) as TarefaDoEspelho | undefined;
    return linha ?? null;
  }

  /** Os horários dos lembretes vivos de uma tarefa: viram os alertas do evento dela. */
  quandosDosLembretes(tarefaId: string): string[] {
    return (
      this.db
        .prepare("SELECT quando FROM lembretes WHERE tarefa_id = ? AND apagado_em IS NULL ORDER BY quando")
        .all(tarefaId) as { quando: string }[]
    ).map((l) => l.quando);
  }

  lembrete(id: string): LembreteDoEspelho | null {
    const linha = this.db
      .prepare(
        `SELECT texto, quando, adiado_ate, recorrencia, inicio_recorrencia, tarefa_id, canal FROM lembretes
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .get(id) as LembreteDoEspelho | undefined;
    return linha ?? null;
  }

  /** O evento vivo do "Moductus" que a agenda criou. */
  evento(id: string): EventoDoEspelho | null {
    const linha = this.db
      .prepare(
        `SELECT e.titulo, e.descricao, e.local, e.inicio, e.fim, e.dia_inteiro, e.recorrencia, e.alertas
           FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE e.id = ? AND e.apagado_em IS NULL AND c.apagado_em IS NULL AND c.espelho = 1`,
      )
      .get(id) as EventoDoEspelho | undefined;
    return linha ?? null;
  }

  /** A mudança feita no Google num evento da agenda que está no "Moductus". */
  adotarEvento(id: string, c: CamposLidos, agora: string): void {
    this.db
      .prepare(
        `UPDATE eventos SET titulo = ?, descricao = ?, inicio = ?, fim = ?, dia_inteiro = ?, local = ?,
           atualizado_em = ?, origem = ?, agente_id = NULL, execucao_id = NULL
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(c.titulo, c.descricao, c.inicio, c.fim, c.diaInteiro ? 1 : 0, c.local, agora, ORIGEM, id);
  }

  /** O evento da agenda que você apagou no Google vai para a lixeira daqui. */
  apagarEvento(id: string, agora: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE eventos SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = NULL, execucao_id = NULL
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, ORIGEM, id);
    return Number(r.changes) > 0;
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

/** O calendário "Moductus" não existe mais no Google (404 nele): é criado de novo. */
class EspelhoSumiu extends Error {
  constructor() {
    super('o calendário "Moductus" não existe mais no Google');
    this.name = "EspelhoSumiu";
  }
}

/** Como terminou uma passada: tudo enviado, nada a fazer sem conexão, ou esperando nova tentativa. */
export type ResultadoEspelho = "enviado" | "desligada" | "esperando";

/** O que vem do Google e volta às áreas, que são donas da tarefa e do lembrete. */
export interface AdotarDoGoogle {
  tarefa: (id: string, mudanca: { titulo?: string; venceEm?: string; hora?: string }) => void;
  lembrete: (id: string, mudanca: { texto?: string; quando?: string }) => Promise<void>;
}

export interface AvisosEspelho {
  /** Eventos da agenda que mudaram ou saíram pelo que veio do Google. */
  eventos: (mudanca: MudancaCache) => void;
  /** O "Moductus" sumiu e foi criado de novo: a Alba avisa. */
  recriado: (aviso: { titulo: string; corpo: string }) => void;
}

export interface DependenciasEspelho {
  google: Pick<ServicoGoogleAgenda, "conexao" | "tokenDeAcesso" | "acessoRecusado">;
  repo: RepositorioEspelhoGoogle;
  /** O fuso de `config`: a hora da tarefa é nele, e a regra do lembrete anda nele. */
  lerFuso: () => string;
  adotar: AdotarDoGoogle;
  avisos: AvisosEspelho;
  enderecos?: Pick<EnderecosGoogle, "calendario">;
  buscar?: typeof fetch;
  agora?: () => Date;
  /** De 0 a 1, para a variação das esperas; o teste fixa. */
  aleatorio?: () => number;
  /** Arma o relógio da próxima tentativa e devolve como desarmar; o teste não arma timer. */
  programar?: (ms: number, fazer: () => void) => () => void;
}

const programarDeVerdade = (ms: number, fazer: () => void) => {
  const relogio = setTimeout(fazer, ms);
  relogio.unref();
  return () => clearTimeout(relogio);
};

/** A falha que espera: rede, cota, Google fora do ar, token que não renovou. As outras são do item. */
function ehPassageira(erro: unknown): boolean {
  if (!(erro instanceof ErroCalendario)) return true;
  if (erro.falha === "rede" || erro.falha === "cota" || erro.falha === "acesso") return true;
  return erro.status !== null && erro.status >= 500;
}

const statusDe = (erro: unknown) => (erro instanceof ErroCalendario ? erro.status : null);

type Acesso = <T>(fazer: (token: string) => Promise<T>) => Promise<T>;

export class EspelhoGoogleAgenda {
  private readonly agora: () => Date;
  private readonly aleatorio: () => number;
  private readonly enderecos: Pick<EnderecosGoogle, "calendario">;
  private readonly buscar: typeof fetch;
  private readonly programar: (ms: number, fazer: () => void) => () => void;
  private emAndamento: Promise<ResultadoEspelho> | null = null;
  /** Pediram outra passada enquanto uma corria; `true` quando alguma pediu a leitura de volta. */
  private pendente: { lerDeVolta: boolean } | null = null;
  /** O calendário guardado foi conferido no Google nesta conexão. */
  private conferido = false;
  private conectadaEm: string | null;
  private desarmar: (() => void) | null = null;
  private desarmarMudanca: (() => void) | null = null;
  /**
   * Passadas seguidas que pararam numa falha que espera, e até quando o relógio não tenta de novo:
   * sem rede, a próxima tentativa não vem a cada segundo, nem quando o token nem chega a renovar.
   */
  private falhasSeguidas = 0;
  private esperarAte = 0;

  constructor(private readonly deps: DependenciasEspelho) {
    this.agora = deps.agora ?? (() => new Date());
    this.aleatorio = deps.aleatorio ?? Math.random;
    this.enderecos = deps.enderecos ?? ENDERECOS_GOOGLE;
    this.buscar = deps.buscar ?? fetch;
    this.programar = deps.programar ?? programarDeVerdade;
    this.conectadaEm = deps.google.conexao().conectadaEm;
  }

  /**
   * Uma passada completa: garante o calendário, lê de volta o que mudou lá, confere o que cada
   * item devia ser e manda a fila. Duas chamadas juntas viram uma; nunca rejeita.
   */
  sincronizar(): Promise<ResultadoEspelho> {
    return this.pedir(true);
  }

  /** Uma tarefa, um lembrete ou um evento do "Moductus" mudou aqui: confere e manda, logo. */
  aoMudar(): void {
    if (this.deps.google.conexao().estado === "desligada") return;
    this.desarmarMudanca?.();
    this.desarmarMudanca = this.programar(ESPERA_AO_MUDAR_MS, () => {
      this.desarmarMudanca = null;
      void this.pedir(false);
    });
  }

  /** Conectou agora (cria ou confere o calendário e manda tudo); desligou (para de tentar). */
  aoMudarConexao(conexao: Conexao): void {
    if (conexao.estado === "desligada") {
      this.conectadaEm = null;
      this.conferido = false;
      this.desarmar?.();
      this.desarmar = null;
      return;
    }
    if (conexao.estado === "ligada" && conexao.conectadaEm !== this.conectadaEm) {
      this.conectadaEm = conexao.conectadaEm;
      this.conferido = false;
      void this.sincronizar();
    }
  }

  /** Ao subir e a cada 10 min com variação, contado do fim de cada passada. Devolve como parar. */
  vigiar(): () => void {
    let relogio: ReturnType<typeof setTimeout> | null = null;
    let parado = false;
    const ciclo = () => {
      void this.sincronizar().finally(() => {
        if (parado) return;
        const variacao = 1 + VARIACAO_LEITURA * (2 * this.aleatorio() - 1);
        relogio = setTimeout(ciclo, Math.round(INTERVALO_LEITURA_MS * variacao));
        relogio.unref();
      });
    };
    ciclo();
    return () => {
      parado = true;
      if (relogio) clearTimeout(relogio);
      this.desarmar?.();
      this.desarmarMudanca?.();
    };
  }

  /**
   * O lembrete está no Google e não tem nada na fila: o celular vai tocar. O do canal
   * `calendario` então não avisa também pelo Windows.
   */
  chegouAoGoogle(lembreteId: string): boolean {
    const m = this.deps.repo.mapa("lembrete", lembreteId);
    return (
      m !== null &&
      m.desligado === 0 &&
      m.etag_externo !== null &&
      this.deps.repo.pendente("lembrete", lembreteId) === null
    );
  }

  private pedir(lerDeVolta: boolean): Promise<ResultadoEspelho> {
    if (this.emAndamento) {
      this.pendente = { lerDeVolta: lerDeVolta || (this.pendente?.lerDeVolta ?? false) };
      return this.emAndamento;
    }
    const passada = this.passada(lerDeVolta).finally(() => {
      if (this.emAndamento === passada) this.emAndamento = null;
      const outra = this.pendente;
      this.pendente = null;
      if (outra) void this.pedir(outra.lerDeVolta);
      else this.armarProxima();
    });
    this.emAndamento = passada;
    return passada;
  }

  private async passada(lerDeVolta: boolean): Promise<ResultadoEspelho> {
    if (this.deps.google.conexao().estado === "desligada") return "desligada";
    const acesso = this.acesso();
    let recriou = false;
    for (;;) {
      try {
        const espelho = await this.garantirCalendario(acesso);
        this.conciliar();
        if (lerDeVolta && !recriou) {
          try {
            await this.lerDeVolta(espelho, acesso);
          } catch (erro) {
            // Sem rede para ler, o envio tenta assim mesmo: é ele que marca a espera de cada item.
            if (erro instanceof EspelhoSumiu || !ehPassageira(erro)) throw erro;
            console.error(`google: a leitura do "Moductus" falhou: ${mensagem(erro)}`);
          }
        }
        return await this.enviar(espelho, acesso);
      } catch (erro) {
        if (erro instanceof EspelhoSumiu && !recriou) {
          try {
            await this.recriar(acesso);
          } catch (outro) {
            console.error(`google: o calendário "Moductus" não foi criado de novo: ${mensagem(outro)}`);
            return "esperando";
          }
          recriou = true;
          continue;
        }
        console.error(`google: o espelho no "Moductus" espera: ${mensagem(erro)}`);
        this.adiarPassada();
        return "esperando";
      }
    }
  }

  /** A espera da próxima passada que o relógio arma: dobra a cada falha seguida, com variação. */
  private adiarPassada(): void {
    const passo = Math.min(ESPERA_INICIAL_MS * 2 ** this.falhasSeguidas, ESPERA_MAXIMA_MS);
    this.falhasSeguidas++;
    this.esperarAte =
      this.agora().getTime() + Math.round(passo * (1 + VARIACAO_ESPERA * (2 * this.aleatorio() - 1)));
  }

  /** O calendário guardado, conferido uma vez por conexão; sem ele, um novo. */
  private async garantirCalendario(acesso: Acesso): Promise<LinhaEspelho> {
    const guardado = this.deps.repo.espelho();
    if (guardado !== null) {
      if (this.conferido) return guardado;
      try {
        await acesso((token) => conferirCalendario(this.buscar, this.enderecos, token, guardado.id_externo));
      } catch (erro) {
        const status = statusDe(erro);
        // O 403 é o calendário de outra conta, ou que não foi o Moductus que criou.
        if (status === 404 || status === 403) throw new EspelhoSumiu();
        throw erro;
      }
      this.conferido = true;
      return guardado;
    }
    const { idExterno } = await acesso((token) =>
      criarCalendario(this.buscar, this.enderecos, token, {
        nome: NOME_DO_ESPELHO,
        fuso: this.deps.lerFuso(),
      }),
    );
    const agora = this.agora().toISOString();
    this.deps.repo.transacao(() => this.deps.repo.gravarEspelho(idExterno, agora));
    this.conferido = true;
    return this.deps.repo.espelho()!;
  }

  private async recriar(acesso: Acesso): Promise<void> {
    const { idExterno } = await acesso((token) =>
      criarCalendario(this.buscar, this.enderecos, token, {
        nome: NOME_DO_ESPELHO,
        fuso: this.deps.lerFuso(),
      }),
    );
    const agora = this.agora().toISOString();
    this.deps.repo.transacao(() => this.deps.repo.trocarEspelho(idExterno, agora));
    this.conferido = true;
    console.error('google: o calendário "Moductus" sumiu e foi criado de novo');
    this.deps.avisos.recriado({ titulo: TITULO_RECRIADO, corpo: CORPO_RECRIADO });
  }

  // O que cada item devia ser.

  private desejado(tipo: TipoItem, id: string, fuso: string): EventoDoItem | null {
    try {
      if (tipo === "tarefa") return this.daTarefa(id, fuso);
      if (tipo === "lembrete") return this.doLembrete(id, fuso);
      return this.doEvento(id, fuso);
    } catch (erro) {
      // Dia ou hora que não se lê (vindo de outro PC) não derruba o resto.
      console.error(`google: ${tipo} ${id} não vira evento: ${mensagem(erro)}`);
      return null;
    }
  }

  private daTarefa(id: string, fuso: string): EventoDoItem | null {
    const t = this.deps.repo.tarefa(id);
    if (t === null || t.estado !== "aberta" || t.vence_em === null || t.hora === null || !ehDia(t.vence_em))
      return null;
    const inicio = instanteNoFuso(t.vence_em, t.hora, fuso).toISOString();
    const alertas = this.deps.repo
      .quandosDosLembretes(id)
      .map((quando) => Math.round((Date.parse(inicio) - Date.parse(quando)) / 60_000));
    return {
      titulo: t.titulo,
      descricao: null,
      local: null,
      inicio,
      fim: depois(inicio, t.duracao_estimada_min ?? DURACAO_TAREFA_MIN),
      diaInteiro: false,
      recorrencia: null,
      fuso: null,
      alertas: alertasValidos(alertas),
      livre: true,
    };
  }

  /** O lembrete da tarefa espelhada é o alerta do evento dela: não vai sozinho. */
  private doLembrete(id: string, fuso: string): EventoDoItem | null {
    const l = this.deps.repo.lembrete(id);
    if (l === null || l.canal === "dock") return null;
    if (l.tarefa_id !== null && this.daTarefa(l.tarefa_id, fuso) !== null) return null;
    const regra = l.recorrencia !== null && lerRecorrencia(l.recorrencia).entendida ? l.recorrencia : null;
    const inicio = regra !== null ? (l.inicio_recorrencia ?? l.quando) : (l.adiado_ate ?? l.quando);
    return {
      titulo: l.texto,
      descricao: null,
      local: null,
      inicio,
      fim: depois(inicio, DURACAO_LEMBRETE_MIN),
      diaInteiro: false,
      recorrencia: regra,
      fuso: regra === null ? null : fuso,
      alertas: [0],
      livre: true,
    };
  }

  private doEvento(id: string, fuso: string): EventoDoItem | null {
    const e = this.deps.repo.evento(id);
    if (e === null) return null;
    return {
      titulo: e.titulo,
      descricao: e.descricao,
      local: e.local,
      inicio: e.inicio,
      fim: e.fim,
      diaInteiro: e.dia_inteiro === 1,
      recorrencia: e.recorrencia,
      fuso: e.recorrencia === null || e.dia_inteiro === 1 ? null : fuso,
      alertas: alertasValidos(JSON.parse(e.alertas) as number[]),
      livre: false,
    };
  }

  /**
   * Põe na fila o que mudou desde o último envio: o item novo (criar), o que mudou (mudar) e o
   * que deixou de ir (apagar). O que já está na fila fica com a espera que tem: o envio monta o
   * evento na hora. O que você desligou no Google não volta. O item que passou da janela (a
   * tarefa aberta de duas semanas atrás) fica como está lá.
   */
  private conciliar(): void {
    const repo = this.deps.repo;
    if (repo.espelho() === null) return;
    const fuso = this.deps.lerFuso();
    const agora = this.agora();
    const instante = agora.toISOString();
    const desde = new Date(agora.getTime() - DIAS_PARA_TRAS * MS_DIA);
    const desdeDia = noFuso(desde, fuso).dia;
    repo.transacao(() => {
      const vistos = new Set<string>();
      for (const c of repo.candidatos(desde.toISOString(), desdeDia, MAXIMO_ITENS)) {
        const desejado = this.desejado(c.tipo, c.id, fuso);
        if (desejado === null) continue;
        vistos.add(`${c.tipo}:${c.id}`);
        const m = repo.mapa(c.tipo, c.id);
        if (m?.desligado === 1) continue;
        const fila = repo.pendente(c.tipo, c.id);
        if (m === null) {
          repo.planejar(c.tipo, c.id, instante);
          repo.enfileirar(c.tipo, c.id, "criar", instante);
          continue;
        }
        const igual = m.enviado === impressao(desejado);
        if (fila?.operacao === "apagar") {
          // Voltou antes de o apagar sair (a tarefa reaberta): não apaga.
          if (igual && m.etag_externo !== null) repo.tirarDaFila(fila);
          else repo.enfileirar(c.tipo, c.id, m.etag_externo === null ? "criar" : "mudar", instante);
          continue;
        }
        if (fila !== null || igual) continue;
        repo.enfileirar(c.tipo, c.id, m.etag_externo === null ? "criar" : "mudar", instante);
      }
      for (const m of repo.mapas()) {
        const chave = `${m.item_tipo}:${m.item_id}`;
        if (vistos.has(chave)) continue;
        // O evento da agenda tem a fila dele (`ServicoAgenda`); aqui só sai o que ficou para trás.
        if (m.item_tipo === "evento") {
          if (repo.evento(m.item_id) !== null || repo.pendente("evento", m.item_id) !== null) continue;
          if (m.etag_externo === null) repo.tirarMapa("evento", m.item_id);
          else repo.enfileirar("evento", m.item_id, "apagar", instante);
          continue;
        }
        if (this.desejado(m.item_tipo, m.item_id, fuso) !== null) continue;
        const fila = repo.pendente(m.item_tipo, m.item_id);
        // Nunca tentou ir: some daqui sem pedido ao Google, como a agenda faz.
        if (m.desligado === 1 || (m.etag_externo === null && (fila === null || fila.tentativas === 0))) {
          if (fila !== null) repo.tirarDaFila(fila);
          repo.tirarMapa(m.item_tipo, m.item_id);
          continue;
        }
        if (fila?.operacao !== "apagar") repo.enfileirar(m.item_tipo, m.item_id, "apagar", instante);
      }
    });
  }

  // O envio.

  /** Manda o que já pode ir. A falha que espera para a passada: a rede caiu para todos. */
  private async enviar(espelho: LinhaEspelho, acesso: Acesso): Promise<ResultadoEspelho> {
    const repo = this.deps.repo;
    for (const linha of repo.devidos(this.agora().toISOString(), ENVIOS_POR_VEZ)) {
      try {
        await this.enviarUm(espelho, linha, acesso);
      } catch (erro) {
        if (erro instanceof EspelhoSumiu) throw erro;
        if (ehPassageira(erro)) {
          this.esperar(linha, erro);
          this.adiarPassada();
          return "esperando";
        }
        // O Google recusou este evento (400, 403): fica anotado e sai da fila até o item mudar.
        console.error(
          `google: o Google recusou o evento de ${linha.item_tipo} ${linha.item_id}: ${mensagem(erro)}`,
        );
        const m = repo.mapa(linha.item_tipo, linha.item_id);
        const desejado = this.desejado(linha.item_tipo, linha.item_id, this.deps.lerFuso());
        repo.transacao(() => {
          if (m !== null && desejado !== null)
            repo.gravarRecusa(m, impressao(desejado), this.agora().toISOString());
          repo.tirarDaFila(linha);
        });
      }
    }
    this.falhasSeguidas = 0;
    this.esperarAte = 0;
    // O que ficou na fila (esperando a vez, ou além das {@link ENVIOS_POR_VEZ}) vai na próxima.
    return repo.proximaTentativa() === null ? "enviado" : "esperando";
  }

  private esperar(linha: LinhaSaida, erro: unknown): void {
    const passo = Math.min(ESPERA_INICIAL_MS * 2 ** linha.tentativas, ESPERA_MAXIMA_MS);
    const espera = Math.round(passo * (1 + VARIACAO_ESPERA * (2 * this.aleatorio() - 1)));
    const agora = this.agora();
    this.deps.repo.falhou(
      linha,
      new Date(agora.getTime() + espera).toISOString(),
      mensagem(erro),
      agora.toISOString(),
    );
  }

  private async enviarUm(espelho: LinhaEspelho, linha: LinhaSaida, acesso: Acesso): Promise<void> {
    const repo = this.deps.repo;
    const { item_tipo: tipo, item_id: id } = linha;
    const atual = repo.mapa(tipo, id);
    if (linha.operacao === "apagar") return this.apagarUm(espelho, linha, atual, acesso);
    if (atual?.desligado === 1) {
      repo.tirarDaFila(linha);
      return;
    }
    const fuso = this.deps.lerFuso();
    const desejado = this.desejado(tipo, id, fuso);
    if (desejado === null) {
      // Saiu antes de chegar: se pode ter chegado (já tentou), apaga lá; se não, só sai da fila.
      if (atual !== null && (atual.etag_externo !== null || linha.tentativas > 0))
        return this.apagarUm(espelho, linha, atual, acesso);
      repo.transacao(() => {
        if (atual !== null) repo.tirarMapa(tipo, id);
        repo.tirarDaFila(linha);
      });
      return;
    }
    const m = atual ?? repo.planejar(tipo, id, this.agora().toISOString());
    const corpo = corpoDoEvento(desejado, tipo, id, fuso);
    let escrito: EventoEscrito;
    if (m.etag_externo === null) {
      try {
        escrito = await acesso((token) =>
          inserirEvento(this.buscar, this.enderecos, token, espelho.id_externo, {
            id: m.id_externo,
            ...corpo,
          }),
        );
      } catch (erro) {
        if (statusDe(erro) === 404) await this.conferirEspelho(espelho, acesso, erro);
        if (statusDe(erro) !== 409) throw erro;
        // Já está lá: a tentativa anterior chegou e a resposta se perdeu.
        escrito = await this.mudarLa(espelho, m, linha, corpo, acesso);
      }
    } else {
      escrito = await this.mudarLa(espelho, m, linha, corpo, acesso);
    }
    if (escrito.cancelado) {
      // O id é de um evento que você apagou lá: o espelho deste item para.
      repo.transacao(() => this.apagadoNoGoogle(m, linha));
      return;
    }
    const agora = this.agora().toISOString();
    repo.transacao(() => {
      repo.gravarEnvio(m, escrito.etag, impressao(desejado), agora);
      repo.tirarDaFila(linha);
    });
  }

  /** PATCH no evento de lá; o que sumiu (404, 410) foi apagado por você, ou o calendário sumiu. */
  private async mudarLa(
    espelho: LinhaEspelho,
    m: LinhaMapa,
    linha: LinhaSaida,
    corpo: Record<string, unknown>,
    acesso: Acesso,
  ): Promise<EventoEscrito> {
    try {
      return await acesso((token) =>
        mudarEvento(this.buscar, this.enderecos, token, espelho.id_externo, m.id_externo, corpo),
      );
    } catch (erro) {
      const status = statusDe(erro);
      if (status !== 404 && status !== 410) throw erro;
      if (status === 404) await this.conferirEspelho(espelho, acesso, erro);
      return { etag: null, cancelado: true };
    }
  }

  private async apagarUm(
    espelho: LinhaEspelho,
    linha: LinhaSaida,
    m: LinhaMapa | null,
    acesso: Acesso,
  ): Promise<void> {
    const repo = this.deps.repo;
    if (m !== null && m.desligado === 0) {
      try {
        await acesso((token) =>
          apagarEvento(this.buscar, this.enderecos, token, espelho.id_externo, m.id_externo),
        );
      } catch (erro) {
        // 404 e 410: já não está lá, que é o que se queria.
        const status = statusDe(erro);
        if (status !== 404 && status !== 410) throw erro;
      }
    }
    repo.transacao(() => {
      if (m !== null) repo.tirarMapa(linha.item_tipo, linha.item_id);
      repo.tirarDaFila(linha);
    });
  }

  /** O 404 de um evento pode ser o calendário inteiro que sumiu: confere antes de decidir. */
  private async conferirEspelho(espelho: LinhaEspelho, acesso: Acesso, original: unknown): Promise<void> {
    try {
      await acesso((token) => conferirCalendario(this.buscar, this.enderecos, token, espelho.id_externo));
    } catch (erro) {
      const status = statusDe(erro);
      if (status === 404 || status === 403) throw new EspelhoSumiu();
      throw original;
    }
  }

  /** Você apagou lá: o espelho do item para; o evento da agenda vai para a lixeira daqui. */
  private apagadoNoGoogle(m: LinhaMapa, linha: Pick<LinhaSaida, "id" | "atualizado_em"> | null): void {
    const repo = this.deps.repo;
    const agora = this.agora().toISOString();
    const fila = linha ?? repo.pendente(m.item_tipo, m.item_id);
    if (fila !== null) repo.tirarDaFila(fila);
    if (m.item_tipo !== "evento") {
      repo.desligar(m, agora);
      return;
    }
    repo.tirarMapa("evento", m.item_id);
    const saiu = repo.apagarEvento(m.item_id, agora);
    if (saiu) queueMicrotask(() => this.deps.avisos.eventos({ mudados: [], apagados: [m.item_id] }));
  }

  // A leitura de volta.

  /** O que mudou no "Moductus" desde a última leitura (a primeira lê desde 7 dias atrás). */
  private async lerDeVolta(espelho: LinhaEspelho, acesso: Acesso): Promise<void> {
    const limite = new Date(this.agora().getTime() - DIAS_PARA_TRAS * MS_DIA).toISOString();
    let ponto: PontoDeLeitura = espelho.token_sincronizacao
      ? { completa: false, sincronizacao: espelho.token_sincronizacao }
      : { completa: true, desde: limite };
    let leitura;
    try {
      leitura = await this.lerEventos(espelho, ponto, acesso);
    } catch (erro) {
      if (!(erro instanceof ErroCalendario && erro.falha === "sincronizacao-vencida") || ponto.completa)
        throw erro;
      this.deps.repo.zerarToken();
      ponto = { completa: true, desde: limite };
      leitura = await this.lerEventos(espelho, ponto, acesso);
    }
    const fuso = this.deps.lerFuso();
    for (const item of leitura.itens) await this.aplicarLido(item, fuso);
    this.deps.repo.gravarToken(espelho.id, leitura.sincronizacao, this.agora().toISOString());
  }

  private async lerEventos(
    espelho: LinhaEspelho,
    ponto: PontoDeLeitura,
    acesso: Acesso,
  ): Promise<{ itens: unknown[]; sincronizacao: string }> {
    const itens: unknown[] = [];
    let bytes = 0;
    let pagina: string | null = null;
    for (let n = 0; n < MAXIMO_PAGINAS; n++) {
      const atual: string | null = pagina;
      let resposta: Awaited<ReturnType<typeof paginaDeEventos>>;
      try {
        resposta = await acesso((token) =>
          paginaDeEventos(this.buscar, this.enderecos, token, espelho.id_externo, ponto, atual),
        );
      } catch (erro) {
        if (statusDe(erro) === 404 || statusDe(erro) === 403) throw new EspelhoSumiu();
        throw erro;
      }
      bytes += resposta.bytes;
      if (bytes > MAXIMO_LEITURA_BYTES)
        throw new ErroCalendario("rede", "a leitura passou do tamanho que uma agenda tem");
      itens.push(...resposta.itens);
      if (resposta.proxima === null) {
        if (resposta.sincronizacao === null) throw new ErroCalendario("rede", "a leitura terminou sem token");
        return { itens, sincronizacao: resposta.sincronizacao };
      }
      pagina = resposta.proxima;
    }
    throw new ErroCalendario("rede", "páginas demais nos eventos");
  }

  /**
   * Um item lido do "Moductus". Só o evento inteiro conta: a ocorrência mudada ou cancelada de um
   * recorrente (com `recurringEventId`) não desliga nem muda nada.
   */
  private async aplicarLido(item: unknown, fuso: string): Promise<void> {
    if (!ehObjeto(item) || typeof item.id !== "string" || item.recurringEventId !== undefined) return;
    const repo = this.deps.repo;
    const agora = this.agora().toISOString();
    const etag = typeof item.etag === "string" ? item.etag.slice(0, 200) : null;
    const m = repo.mapaPeloIdExterno(item.id);
    if (item.status === "cancelled") {
      if (m !== null && m.desligado === 0) repo.transacao(() => this.apagadoNoGoogle(m, null));
      return;
    }
    if (m === null) {
      this.acharDeOutroLugar(item, etag, agora);
      return;
    }
    // O eco da própria escrita, ou o item que você desligou.
    if (m.desligado === 1 || (etag !== null && etag === m.etag_externo)) return;
    // A mudança daqui ainda não saiu: ela vence a de lá.
    if (repo.pendente(m.item_tipo, m.item_id) !== null) return;
    const enviado = lerImpressao(m.enviado);
    const lido = lerEvento(item, fuso);
    if (enviado === null || lido === null || lido.tipo !== "guardar") {
      repo.gravarAdotado(m, etag, null, agora);
      return;
    }
    const c = lido.campos;
    const novoTitulo = c.titulo !== enviado.titulo ? c.titulo : undefined;
    const novoInicio = c.inicio !== enviado.inicio || c.diaInteiro !== enviado.diaInteiro ? c : undefined;
    try {
      await this.adotar(m, novoTitulo, novoInicio, fuso, agora);
    } catch (erro) {
      // A área recusou (a tarefa fechou no meio): o que vale é o daqui, e o próximo envio corrige lá.
      console.error(
        `google: a mudança do Google em ${m.item_tipo} ${m.item_id} não foi adotada: ${mensagem(erro)}`,
      );
      repo.gravarAdotado(m, etag, null, agora);
      return;
    }
    const depoisDeAdotar = this.desejado(m.item_tipo, m.item_id, fuso);
    repo.gravarAdotado(m, etag, depoisDeAdotar === null ? null : impressao(depoisDeAdotar), agora);
  }

  private async adotar(
    m: LinhaMapa,
    titulo: string | undefined,
    quando: CamposLidos | undefined,
    fuso: string,
    agora: string,
  ): Promise<void> {
    if (titulo === undefined && quando === undefined) return;
    if (m.item_tipo === "tarefa") {
      // A tarefa só tem hora: virar dia inteiro lá não tira a hora dela aqui.
      const hora = quando !== undefined && !quando.diaInteiro ? noFuso(new Date(quando.inicio), fuso) : null;
      if (titulo === undefined && hora === null) return;
      this.deps.adotar.tarefa(m.item_id, {
        ...(titulo !== undefined ? { titulo } : {}),
        ...(hora !== null ? { venceEm: hora.dia, hora: hora.hora } : {}),
      });
      return;
    }
    if (m.item_tipo === "lembrete") {
      const l = this.deps.repo.lembrete(m.item_id);
      if (l === null) return;
      // O recorrente segue a regra daqui; de lá, só o texto.
      const novoQuando =
        quando !== undefined && !quando.diaInteiro && l.recorrencia === null ? quando.inicio : undefined;
      if (titulo === undefined && novoQuando === undefined) return;
      await this.deps.adotar.lembrete(m.item_id, {
        ...(titulo !== undefined ? { texto: titulo } : {}),
        ...(novoQuando !== undefined ? { quando: novoQuando } : {}),
      });
      return;
    }
    const e = this.deps.repo.evento(m.item_id);
    if (e === null) return;
    const lido = quando;
    const campos: CamposLidos = {
      titulo: titulo ?? e.titulo,
      descricao: e.descricao,
      local: e.local,
      inicio: lido?.inicio ?? e.inicio,
      fim: lido?.fim ?? e.fim,
      diaInteiro: lido?.diaInteiro ?? e.dia_inteiro === 1,
      recorrencia: e.recorrencia,
      excecoes: [],
      fuso: null,
    };
    this.deps.repo.adotarEvento(m.item_id, campos, agora);
    queueMicrotask(() => this.deps.avisos.eventos({ mudados: [m.item_id], apagados: [] }));
  }

  /**
   * Evento com o `moductus_id` de um item daqui que não está nesta tabela: o espelho que outro PC
   * (ou uma tentativa perdida) pôs lá. Vira o espelho do item, se ele ainda não tem um no Google.
   */
  private acharDeOutroLugar(item: Record<string, unknown>, etag: string | null, agora: string): void {
    const extras = ehObjeto(item.extendedProperties) ? item.extendedProperties.private : null;
    if (!ehObjeto(extras) || !ehTipo(extras.moductus_tipo) || typeof extras.moductus_id !== "string") return;
    const tipo = extras.moductus_tipo;
    const id = extras.moductus_id;
    const idExterno = item.id as string;
    if (idExterno.length < 5 || idExterno.length > 1024) return;
    const repo = this.deps.repo;
    const atual = repo.mapa(tipo, id);
    if (atual !== null && (atual.etag_externo !== null || atual.desligado === 1)) return;
    const existe =
      tipo === "tarefa"
        ? repo.tarefa(id) !== null
        : tipo === "lembrete"
          ? repo.lembrete(id) !== null
          : repo.evento(id) !== null;
    if (!existe) return;
    repo.transacao(() => {
      repo.adotarMapa(tipo, id, idExterno, etag, agora);
      // O que ia ser criado vira uma mudança no que já está lá.
      const fila = repo.pendente(tipo, id);
      if (fila !== null && fila.operacao === "criar") repo.enfileirar(tipo, id, "mudar", agora);
    });
  }

  /** Quem faz os pedidos de uma passada com o mesmo token: o 401 renova uma vez e repete. */
  private acesso(): Acesso {
    let token: string | null = null;
    let renovou = false;
    return async <T>(fazer: (token: string) => Promise<T>): Promise<T> => {
      for (;;) {
        token ??= await this.deps.google.tokenDeAcesso();
        try {
          return await fazer(token);
        } catch (erro) {
          if (erro instanceof ErroCalendario && erro.falha === "acesso" && !renovou) {
            renovou = true;
            this.deps.google.acessoRecusado(token);
            token = null;
            continue;
          }
          throw erro;
        }
      }
    };
  }

  /** O relógio da próxima tentativa da fila, se há alguma e a conexão não está desligada. */
  private armarProxima(): void {
    this.desarmar?.();
    this.desarmar = null;
    if (this.deps.google.conexao().estado === "desligada") return;
    const proxima = this.deps.repo.proximaTentativa();
    if (proxima === null) return;
    const agora = this.agora().getTime();
    const ms = Math.max(1000, Date.parse(proxima) - agora, this.esperarAte - agora);
    this.desarmar = this.programar(ms, () => {
      this.desarmar = null;
      void this.pedir(false);
    });
  }
}

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * O evento como vai ao Google: título, horário no fuso, alertas `popup` e o `moductus_id`. Da
 * tarefa e do lembrete não vai mais nada; do evento da agenda, descrição e local também. A regra
 * vai como `RRULE`, e a lista vazia tira a que havia.
 */
export function corpoDoEvento(
  e: EventoDoItem,
  tipo: TipoItem,
  itemId: string,
  fusoDoUsuario: string,
): Record<string, unknown> {
  const ponta = (valor: string) =>
    e.diaInteiro ? { date: valor } : { dateTime: valor, timeZone: e.fuso ?? fusoDoUsuario };
  return {
    summary: e.titulo,
    ...(tipo === "evento" ? { description: e.descricao ?? "", location: e.local ?? "" } : {}),
    start: ponta(e.inicio),
    end: ponta(e.fim),
    recurrence: e.recorrencia === null ? [] : [`RRULE:${e.recorrencia}`],
    reminders: { useDefault: false, overrides: e.alertas.map((minutes) => ({ method: "popup", minutes })) },
    transparency: e.livre ? "transparent" : "opaque",
    extendedProperties: { private: { moductus_tipo: tipo, moductus_id: itemId } },
  };
}
