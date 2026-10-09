import type { DatabaseSync } from "node:sqlite";
import {
  MudancaPreferencia,
  PedidoMarcarVistas,
  PedidoPagina,
  PedidoRestaurarPreferencia,
  PREFERENCIA_PADRAO,
  TIPOS_QUE_PRECISAM,
  TipoNotificacao,
  type CanalNotificacao,
  type EstadoNotificacoes,
  type NivelNotificacao,
  type Notificacao,
  type PaginaNotificacoes,
  type PreferenciaNotificacao,
  type Silencio,
} from "@moductus/contrato";
import type { Origem } from "../banco/tabela.ts";
import { novoId } from "../banco/ulid.ts";

/** Um botão do aviso do Windows; o `id` volta quando o usuário clica. */
export interface BotaoAviso {
  id: string;
  rotulo: string;
}

/** O que uma área pede para avisar, em nome de um agente. */
export interface NovoAviso {
  /** O agente em nome de quem o aviso sai; vazio só para aviso do próprio app. */
  agenteId: string | null;
  tipo: TipoNotificacao;
  titulo: string;
  corpo?: string | null;
  /** O que gerou o aviso (`aprovacao:<id>`); enquanto um aviso dela não for visto, não repete. */
  referencia?: string | null;
  /** Os botões do aviso do Windows; a ação de cada um mora na área ({@link registrarAcao}). */
  botoes?: readonly BotaoAviso[];
  /** Carimbo da linha; o padrão é `agente` quando há agente e `conexao` quando não há. */
  origem?: Origem;
  execucaoId?: string | null;
}

/** O aviso do Windows como a casca recebe: o `id` é o da notificação e vira a tag do aviso. */
export interface AvisoWindows {
  id: string;
  /** Nome do agente, na linha de atribuição ("Nuno"). */
  agente: string | null;
  titulo: string;
  corpo: string | null;
  botoes: readonly BotaoAviso[];
}

/** O que só a casca sabe fazer: mostrar e retirar o aviso do Windows e ver a tela cheia. */
export interface AvisosDoWindows {
  mostrar(aviso: AvisoWindows): Promise<void>;
  /** Tira da Central de Notificações o aviso que já não vale (o cartão foi decidido). */
  retirar(id: string): Promise<void>;
  /** Jogo, vídeo ou apresentação em tela cheia agora (`SHQueryUserNotificationState`). */
  telaCheia(): Promise<boolean>;
}

/** Como o aviso sai, pela preferência: `avisa` falso é só registro, sem ponto nem Windows. */
export interface Entrega {
  avisa: boolean;
  ponto: boolean;
  windows: boolean;
}

/**
 * A regra do nível e do canal (PRODUCT.md §5): "tudo" avisa qualquer tipo; "só o que precisa de
 * mim", só aprovação, lembrete e erro; "nada" não avisa. O canal escolhe ponto, Windows ou os dois.
 */
export function entregaPela(
  preferencia: { nivel: NivelNotificacao; canal: CanalNotificacao },
  tipo: TipoNotificacao,
): Entrega {
  const avisa =
    preferencia.nivel === "tudo" ||
    (preferencia.nivel === "so_o_que_precisa" && TIPOS_QUE_PRECISAM.includes(tipo));
  return {
    avisa,
    ponto: avisa && preferencia.canal !== "windows",
    windows: avisa && preferencia.canal !== "dock",
  };
}

/** Durante o foco ainda chegam aprovações e lembretes; o resto espera no dock. */
const PASSAM_NO_FOCO: readonly TipoNotificacao[] = ["aprovacao", "lembrete"];

export type MotivoSilencio = "horario" | "tela-cheia" | "foco";

const minutosDe = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Se a hora local está no horário de silêncio; início depois do fim atravessa a meia-noite. */
export function dentroDoHorario(agora: Date, inicio: string, fim: string): boolean {
  const atual = agora.getHours() * 60 + agora.getMinutes();
  const de = minutosDe(inicio);
  const ate = minutosDe(fim);
  if (de === ate) return false;
  return de < ate ? atual >= de && atual < ate : atual >= de || atual < ate;
}

/**
 * Por que o aviso do Windows fica quieto agora, ou `null`. O silêncio só cala o Windows: o ponto
 * no dock e o registro continuam. A tela cheia só é perguntada à casca quando importa.
 */
export async function motivoDoSilencio(
  silencio: Silencio,
  tipo: TipoNotificacao,
  situacao: { agora: Date; telaCheia: () => Promise<boolean>; emFoco: () => boolean },
): Promise<MotivoSilencio | null> {
  const { horario } = silencio;
  if (horario.ligado && dentroDoHorario(situacao.agora, horario.inicio, horario.fim)) return "horario";
  if (silencio.foco && !PASSAM_NO_FOCO.includes(tipo) && situacao.emFoco()) return "foco";
  if (silencio.telaCheia && (await situacao.telaCheia())) return "tela-cheia";
  return null;
}

interface LinhaPreferencia {
  do_agente_id: string | null;
  tipo: TipoNotificacao;
  nivel: NivelNotificacao;
  canal: CanalNotificacao;
}

interface LinhaNotificacao {
  id: string;
  do_agente_id: string | null;
  tipo: TipoNotificacao;
  titulo: string;
  corpo: string | null;
  referencia: string | null;
  canal: CanalNotificacao;
  criado_em: string;
  vista_em: string | null;
}

const COLUNAS = "id, do_agente_id, tipo, titulo, corpo, referencia, canal, criado_em, vista_em";
const PAGINA_PADRAO = 50;

const paraNotificacao = (l: LinhaNotificacao): Notificacao => ({
  id: l.id,
  agenteId: l.do_agente_id,
  tipo: l.tipo,
  titulo: l.titulo,
  corpo: l.corpo,
  referencia: l.referencia,
  canal: l.canal,
  criadoEm: l.criado_em,
  vistaEm: l.vista_em,
});

/** As tabelas da migração 005: preferências (configuração) e o histórico do que foi avisado. */
export class RepositorioNotificacoes {
  constructor(private readonly db: DatabaseSync) {}

  preferencias(): LinhaPreferencia[] {
    return this.db
      .prepare("SELECT do_agente_id, tipo, nivel, canal FROM notificacoes_preferencias")
      .all() as unknown as LinhaPreferencia[];
  }

  /** Uma por agente e tipo (o vazio conta como "todos"): a nova substitui a anterior. */
  definirPreferencia(
    agenteId: string | null,
    tipos: readonly TipoNotificacao[],
    nivel: NivelNotificacao,
    canal: CanalNotificacao,
    agora: string,
  ): void {
    this.transacao(() => {
      this.restaurarPreferencia(agenteId, tipos);
      const inserir = this.db.prepare(
        `INSERT INTO notificacoes_preferencias (id, do_agente_id, tipo, nivel, canal, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const tipo of tipos) inserir.run(novoId(), agenteId, tipo, nivel, canal, agora, agora);
    });
  }

  restaurarPreferencia(agenteId: string | null, tipos: readonly TipoNotificacao[]): void {
    const apagar = this.db.prepare(
      "DELETE FROM notificacoes_preferencias WHERE coalesce(do_agente_id, '') = ? AND tipo = ?",
    );
    for (const tipo of tipos) apagar.run(agenteId ?? "", tipo);
  }

  inserir(n: {
    id: string;
    agenteId: string | null;
    tipo: TipoNotificacao;
    titulo: string;
    corpo: string | null;
    referencia: string | null;
    canal: CanalNotificacao;
    vistaEm: string | null;
    agora: string;
    origem: Origem;
    execucaoId: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO notificacoes (id, do_agente_id, tipo, titulo, corpo, referencia, canal, vista_em,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        n.id,
        n.agenteId,
        n.tipo,
        n.titulo,
        n.corpo,
        n.referencia,
        n.canal,
        n.vistaEm,
        n.agora,
        n.agora,
        n.origem,
        n.origem === "agente" ? n.agenteId : null,
        n.origem === "agente" ? n.execucaoId : null,
      );
  }

  notificacao(id: string): Notificacao | null {
    const linha = this.db.prepare(`SELECT ${COLUNAS} FROM notificacoes WHERE id = ?`).get(id) as unknown as
      LinhaNotificacao | undefined;
    return linha ? paraNotificacao(linha) : null;
  }

  /** O aviso ainda não visto que a mesma coisa já gerou. */
  naoVistaDa(referencia: string): Notificacao | null {
    const linha = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM notificacoes WHERE referencia = ? AND vista_em IS NULL ORDER BY id LIMIT 1`,
      )
      .get(referencia) as unknown as LinhaNotificacao | undefined;
    return linha ? paraNotificacao(linha) : null;
  }

  /** Todos os avisos que a mesma coisa gerou, vistos ou não. */
  idsDa(referencia: string): string[] {
    const linhas = this.db.prepare("SELECT id FROM notificacoes WHERE referencia = ?").all(referencia) as {
      id: string;
    }[];
    return linhas.map((l) => l.id);
  }

  /** As que pedem o ponto no dock: não vistas e com o dock no canal. */
  naoVistas(): Notificacao[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM notificacoes WHERE vista_em IS NULL AND canal <> 'windows' ORDER BY criado_em, id`,
      )
      .all() as unknown as LinhaNotificacao[];
    return linhas.map(paraNotificacao);
  }

  /** Do mais novo para o mais antigo; o ULID ordena pela criação. */
  pagina(pedido: PedidoPagina): PaginaNotificacoes {
    const limite = pedido.limite ?? PAGINA_PADRAO;
    const antes = pedido.antesDe !== undefined;
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS} FROM notificacoes ${antes ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`)
      .all(...(antes ? [pedido.antesDe as string] : []), limite + 1) as unknown as LinhaNotificacao[];
    const itens = linhas.slice(0, limite).map(paraNotificacao);
    return { itens, proximo: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
  }

  /** Marca como vistas; devolve quantas mudaram. */
  marcarVistas(
    filtro: { ids?: readonly string[]; agenteId?: string; referencia?: string },
    agora: string,
  ): number {
    const filtros = ["vista_em IS NULL"];
    const valores: string[] = [];
    if (filtro.ids) {
      if (filtro.ids.length === 0) return 0;
      filtros.push(`id IN (${filtro.ids.map(() => "?").join(", ")})`);
      valores.push(...filtro.ids);
    }
    if (filtro.agenteId !== undefined) {
      filtros.push("do_agente_id = ?");
      valores.push(filtro.agenteId);
    }
    if (filtro.referencia !== undefined) {
      filtros.push("referencia = ?");
      valores.push(filtro.referencia);
    }
    const r = this.db
      .prepare(`UPDATE notificacoes SET vista_em = ?, atualizado_em = ? WHERE ${filtros.join(" AND ")}`)
      .run(agora, agora, ...valores);
    return Number(r.changes);
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

export interface AvisosNotificacoes {
  /** As preferências mudaram. */
  estado: (estado: EstadoNotificacoes) => void;
  /** Saiu um aviso com ponto no dock. */
  nova: (notificacao: Notificacao) => void;
  /** O que ainda pede o ponto no dock, depois de qualquer mudança. */
  naoVistas: (notificacoes: Notificacao[]) => void;
}

export interface FontesNotificacoes {
  /** Os agentes que existem, na ordem do time. */
  agentes: () => { id: string; nome: string }[];
  /** O silêncio da configuração (`Config.silencio`). */
  silencio: () => Silencio;
  windows: AvisosDoWindows;
  /**
   * Se há uma sessão de foco agora. O Foco chega na fase 3 (PRODUCT.md §5); até lá, ninguém está
   * em foco.
   */
  emFoco?: () => boolean;
}

export interface OpcoesNotificacoes {
  agora?: () => Date;
}

/**
 * A ação de um botão, registrada pela área dona da referência (`aprovacao`). Devolve `true` se
 * fez o que o botão pedia; `false` quando o botão não vale mais (o cartão já foi decidido, o botão
 * não é um dos que o aviso oferece).
 */
export type AcaoAviso = (id: string, botao: string) => Promise<boolean>;

/**
 * A regra das notificações (PRODUCT.md §5, DATA.md §7): cada aviso passa pela preferência do
 * agente e do tipo (a do agente vence a geral, que vence o padrão), fica registrado e sai como
 * ponto no dock, aviso do Windows ou os dois. Com "nada", o agente continua trabalhando: o aviso
 * fica no histórico, sem ponto e sem Windows. O silêncio cala só o Windows.
 */
export class ServicoNotificacoes {
  private readonly agora: () => Date;
  private readonly emFoco: () => boolean;
  private readonly acoes = new Map<string, AcaoAviso>();

  constructor(
    private readonly repo: RepositorioNotificacoes,
    private readonly fontes: FontesNotificacoes,
    private readonly avisos: AvisosNotificacoes,
    opcoes: OpcoesNotificacoes = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.emFoco = fontes.emFoco ?? (() => false);
  }

  obter(): EstadoNotificacoes {
    const gravadas = this.repo.preferencias();
    const achar = (agenteId: string | null, tipo: TipoNotificacao) =>
      gravadas.find((p) => p.do_agente_id === agenteId && p.tipo === tipo);
    const preferencias: PreferenciaNotificacao[] = [];
    for (const { id } of this.fontes.agentes()) {
      for (const tipo of TipoNotificacao.options) {
        const propria = achar(id, tipo);
        const vale = propria ?? achar(null, tipo) ?? PREFERENCIA_PADRAO;
        preferencias.push({ agenteId: id, tipo, nivel: vale.nivel, canal: vale.canal, definida: !!propria });
      }
    }
    return { preferencias };
  }

  definir(entrada: MudancaPreferencia): EstadoNotificacoes {
    const mudanca = MudancaPreferencia.parse(entrada);
    const tipos = mudanca.tipo ? [mudanca.tipo] : TipoNotificacao.options;
    this.repo.definirPreferencia(mudanca.agenteId, tipos, mudanca.nivel, mudanca.canal, this.instante());
    return this.mudou();
  }

  restaurar(entrada: PedidoRestaurarPreferencia): EstadoNotificacoes {
    const pedido = PedidoRestaurarPreferencia.parse(entrada);
    this.repo.transacao(() =>
      this.repo.restaurarPreferencia(pedido.agenteId, pedido.tipo ? [pedido.tipo] : TipoNotificacao.options),
    );
    return this.mudou();
  }

  listar(entrada: PedidoPagina): PaginaNotificacoes {
    return this.repo.pagina(PedidoPagina.parse(entrada));
  }

  /** O que pede o ponto no dock. */
  naoVistas(): Notificacao[] {
    return this.repo.naoVistas();
  }

  marcarVistas(entrada: PedidoMarcarVistas): Notificacao[] {
    const pedido = PedidoMarcarVistas.parse(entrada);
    if (this.repo.marcarVistas(pedido, this.instante()) > 0) this.avisos.naoVistas(this.repo.naoVistas());
    return this.repo.naoVistas();
  }

  /** A preferência que vale para o agente e o tipo: a do agente, a geral ou o padrão. */
  preferenciaDe(
    agenteId: string | null,
    tipo: TipoNotificacao,
  ): { nivel: NivelNotificacao; canal: CanalNotificacao } {
    const gravadas = this.repo.preferencias().filter((p) => p.tipo === tipo);
    const propria = agenteId === null ? undefined : gravadas.find((p) => p.do_agente_id === agenteId);
    const vale = propria ?? gravadas.find((p) => p.do_agente_id === null) ?? PREFERENCIA_PADRAO;
    return { nivel: vale.nivel, canal: vale.canal };
  }

  /**
   * Registra o aviso e o entrega como a preferência manda. Devolve o aviso registrado, ou o que
   * ainda não foi visto da mesma referência (não repete). O aviso do Windows sai depois de
   * gravar; se a casca falhar, o aviso continua no histórico e no ponto.
   */
  async avisar(novo: NovoAviso): Promise<Notificacao> {
    const referencia = novo.referencia ?? null;
    const repetido = referencia ? this.repo.naoVistaDa(referencia) : null;
    if (repetido) return repetido;

    const preferencia = this.preferenciaDe(novo.agenteId, novo.tipo);
    const entrega = entregaPela(preferencia, novo.tipo);
    const agora = this.agora();
    const instante = agora.toISOString();
    const id = novoId();
    // Sem aviso, nasce visto: "nada" registra sem pedir a atenção de ninguém.
    this.repo.inserir({
      id,
      agenteId: novo.agenteId,
      tipo: novo.tipo,
      titulo: novo.titulo,
      corpo: novo.corpo ?? null,
      referencia,
      canal: preferencia.canal,
      vistaEm: entrega.avisa ? null : instante,
      agora: instante,
      origem: novo.origem ?? (novo.agenteId ? "agente" : "conexao"),
      execucaoId: novo.execucaoId ?? null,
    });
    const notificacao = this.repo.notificacao(id);
    if (!notificacao) throw new Error("notificação gravada e não encontrada");

    if (entrega.ponto) {
      this.avisos.nova(notificacao);
      this.avisos.naoVistas(this.repo.naoVistas());
    }
    if (entrega.windows) await this.mostrarNoWindows(notificacao, novo.botoes ?? [], agora);
    return notificacao;
  }

  /** Registra o que fazer quando um botão de um aviso com a referência `<prefixo>:<id>` é clicado. */
  registrarAcao(prefixo: string, acao: AcaoAviso): () => void {
    this.acoes.set(prefixo, acao);
    return () => this.acoes.delete(prefixo);
  }

  /**
   * O usuário clicou no aviso do Windows: no corpo (`botao` nulo) só marca como visto; num botão,
   * a área dona da referência executa a ação, e o aviso só fica visto se ela fez o que o botão
   * pedia (um botão que não vale mais não conta como resposta).
   */
  async aoClicar(id: string, botao: string | null): Promise<void> {
    const notificacao = this.repo.notificacao(id);
    if (!notificacao) return;
    if (!botao) {
      this.marcarVistas({ ids: [id] });
      return;
    }
    const referencia = notificacao.referencia ?? "";
    const separador = referencia.indexOf(":");
    const acao = separador < 0 ? undefined : this.acoes.get(referencia.slice(0, separador));
    if (!acao) return;
    if (await acao(referencia.slice(separador + 1), botao)) this.marcarVistas({ ids: [id] });
  }

  /**
   * O que gerou o aviso já foi resolvido (o cartão foi decidido em outro lugar): o ponto some e o
   * aviso sai da Central de Notificações.
   */
  async resolvido(referencia: string): Promise<void> {
    if (this.repo.marcarVistas({ referencia }, this.instante()) > 0) {
      this.avisos.naoVistas(this.repo.naoVistas());
    }
    for (const id of this.repo.idsDa(referencia)) {
      await this.fontes.windows.retirar(id).catch((erro: unknown) => {
        console.error(`notificações: aviso do Windows não retirado: ${String(erro)}`);
      });
    }
  }

  private async mostrarNoWindows(n: Notificacao, botoes: readonly BotaoAviso[], agora: Date): Promise<void> {
    try {
      const motivo = await motivoDoSilencio(this.fontes.silencio(), n.tipo, {
        agora,
        telaCheia: () => this.fontes.windows.telaCheia(),
        emFoco: this.emFoco,
      });
      // O que gerou o aviso pode ter sido resolvido enquanto a casca respondia a tela cheia.
      if (motivo || this.jaVista(n.id)) return;
      const agente = n.agenteId
        ? (this.fontes.agentes().find((a) => a.id === n.agenteId)?.nome ?? null)
        : null;
      await this.fontes.windows.mostrar({ id: n.id, agente, titulo: n.titulo, corpo: n.corpo, botoes });
      // Resolvido durante o `mostrar`: o `retirar` do `resolvido` pode ter chegado antes do aviso.
      if (this.jaVista(n.id)) await this.fontes.windows.retirar(n.id);
    } catch (erro) {
      console.error(`notificações: aviso do Windows não saiu: ${String(erro)}`);
    }
  }

  private jaVista(id: string): boolean {
    return (this.repo.notificacao(id)?.vistaEm ?? null) !== null;
  }

  private mudou(): EstadoNotificacoes {
    const estado = this.obter();
    this.avisos.estado(estado);
    return estado;
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}
