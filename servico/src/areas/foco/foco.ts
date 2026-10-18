import type { DatabaseSync } from "node:sqlite";
import {
  PedidoEstenderFoco,
  PedidoHistoricoFoco,
  PedidoIniciarFoco,
  type CiclosFoco,
  type EstadoFoco,
  type EtapaFoco,
  type FocoPorDia,
  type FocoPorTarefa,
  type HistoricoFoco,
  type TipoEtapa,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import type { BotaoAviso, NovoAviso, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import type { Conferencia, FonteDoRelogio } from "../dia/relogio.ts";
import { somarDias, TempoDoDia } from "../dia/tempo.ts";

/**
 * Foco (PRODUCT.md §5, ADR-0032): rodadas de etapas de foco, pausa e pausa longa (25/5 quatro vezes
 * e a longa de 15, pela configuração), livres ou ligadas a uma tarefa. Cada etapa é uma linha de
 * `sessoes_foco` com o fim planejado absoluto (`termina_em`); o relógio do dia fecha a etapa na hora
 * e a interface conta o tempo sozinha, sem tique pelo canal.
 *
 * - **Fim do foco:** a etapa fecha completa e a Alba avisa uma vez, propondo a pausa; nada começa
 *   sozinho (AreaFocoEstados, "Ciclo terminado").
 * - **Fim da pausa:** o foco seguinte começa sozinho, sem tocar, ligado à mesma tarefa.
 * - **Fim da pausa longa:** a rodada acabou; a Alba avisa uma vez e o próximo foco é o ciclo 1.
 * - **Pausar:** congela a etapa (`pausada_em`); ao retomar, o fim planejado anda o tempo parado, que
 *   não conta no histórico. Etapa pausada não silencia avisos.
 * - **Terminar:** fecha agora; antes da hora fica interrompida. Terminar a pausa encerra a rodada.
 * - **Reinício e suspensão:** a etapa que ainda está no prazo segue; a que venceu há mais de 2 min
 *   fecha interrompida, no último momento em que se sabe que o PC estava acordado.
 *
 * Minutos de foco somam o tempo real de cada foco, interrompido ou não; ciclos contam só os focos
 * completos. Pausas não entram na conta.
 */

export class ErroDoFoco extends Error {}

export const MENSAGEM_EM_ANDAMENTO = "já há uma etapa do foco em andamento";
export const MENSAGEM_PARADO = "não há etapa do foco em andamento";
export const MENSAGEM_JA_PAUSADA = "a etapa do foco já está em pausa";
export const MENSAGEM_NAO_PAUSADA = "a etapa do foco não está em pausa";
export const MENSAGEM_SEM_PAUSA = "não há pausa para pular";
export const MENSAGEM_TAREFA = "tarefa não encontrada";
export const MENSAGEM_DIA = "dia fora do calendário";

/** Até quanto depois do fim planejado a etapa ainda fecha completa; mais que isso, interrompida. */
export const TOLERANCIA_MS = 2 * 60_000;
/** O "+5 min de foco" do aviso de ciclo terminado. */
export const MINUTOS_DO_AVISO = 5;

/** O aviso do Windows quando o foco termina (AreaFocoEstados, "Ciclo terminado"). */
export const BOTOES_DO_CICLO: readonly BotaoAviso[] = [
  { id: "pausa", rotulo: "Começar a pausa" },
  { id: "pular", rotulo: "Pular a pausa" },
  { id: "mais", rotulo: `+${MINUTOS_DO_AVISO} min de foco` },
];
/** O aviso do Windows quando a pausa longa termina ("Rodada completa"). */
export const BOTOES_DA_RODADA: readonly BotaoAviso[] = [{ id: "outra", rotulo: "Começar outra rodada" }];

/** O foco avisa em nome da Alba (AGENTS.md §2). */
const ALBA = "alba";
const PREFIXO = "foco";
const MIN = 60_000;

/** A referência do aviso é a da etapa que terminou: o botão só vale enquanto ela for a última. */
export const referenciaDe = (etapaId: string) => `${PREFIXO}:${etapaId}`;

export interface LinhaEtapa {
  id: string;
  tipo: TipoEtapa;
  tarefa_id: string | null;
  inicio: string;
  fim: string | null;
  termina_em: string | null;
  pausada_em: string | null;
  duracao_planejada_min: number;
  duracao_real_min: number | null;
  interrompida: number;
  ciclo: number | null;
}

const COLUNAS =
  "id, tipo, tarefa_id, inicio, fim, termina_em, pausada_em, duracao_planejada_min, duracao_real_min, interrompida, ciclo";

/** O fim planejado: o gravado, ou (na etapa de antes da migração 021) o início mais a duração. */
export const terminaEmDe = (l: LinhaEtapa): number =>
  l.termina_em !== null ? Date.parse(l.termina_em) : Date.parse(l.inicio) + l.duracao_planejada_min * MIN;

const cicloDe = (l: LinhaEtapa): number => l.ciclo ?? 1;

export const paraEtapa = (l: LinhaEtapa): EtapaFoco => ({
  id: l.id,
  tipo: l.tipo,
  tarefaId: l.tarefa_id,
  inicio: l.inicio,
  terminaEm: new Date(terminaEmDe(l)).toISOString(),
  pausadaEm: l.pausada_em,
  fim: l.fim,
  duracaoPlanejadaMin: l.duracao_planejada_min,
  duracaoRealMin: l.duracao_real_min,
  interrompida: l.interrompida === 1,
});

/** O que muda numa etapa. */
export interface CamposEtapa {
  fim: string | null;
  termina_em: string;
  pausada_em: string | null;
  duracao_planejada_min: number;
  duracao_real_min: number | null;
  interrompida: boolean;
}

/** `sessoes_foco` das migrações 014 e 021. */
export class RepositorioFoco {
  constructor(private readonly db: DatabaseSync) {}

  /** A etapa em andamento: só pode haver uma (índice `sessoes_foco_em_andamento`). */
  emAndamento(): LinhaEtapa | null {
    const linha = this.db.prepare(`SELECT ${COLUNAS} FROM sessoes_foco WHERE fim IS NULL LIMIT 1`).get() as
      LinhaEtapa | undefined;
    return linha ?? null;
  }

  /** A última etapa a começar. */
  ultima(): LinhaEtapa | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM sessoes_foco ORDER BY inicio DESC, id DESC LIMIT 1`)
      .get() as LinhaEtapa | undefined;
    return linha ?? null;
  }

  etapa(id: string): LinhaEtapa | null {
    const linha = this.db.prepare(`SELECT ${COLUNAS} FROM sessoes_foco WHERE id = ?`).get(id) as
      LinhaEtapa | undefined;
    return linha ?? null;
  }

  /** As etapas que começaram no intervalo (`ate` vazio é sem fim), da mais nova para a mais antiga. */
  doIntervalo(de: string, ate: string | null): LinhaEtapa[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS} FROM sessoes_foco WHERE inicio >= ? ${ate === null ? "" : "AND inicio < ?"}
          ORDER BY inicio DESC, id DESC`,
      )
      .all(de, ...(ate === null ? [] : [ate])) as unknown as LinhaEtapa[];
  }

  /** O início do foco que abriu a rodada da etapa: o último ciclo 1 antes dela. */
  inicioDaRodada(antesDe: string): string | null {
    const linha = this.db
      .prepare(
        `SELECT inicio FROM sessoes_foco WHERE tipo = 'foco' AND coalesce(ciclo, 1) = 1 AND inicio < ?
          ORDER BY inicio DESC, id DESC LIMIT 1`,
      )
      .get(antesDe) as { inicio: string } | undefined;
    return linha?.inicio ?? null;
  }

  /** Se há um foco correndo agora: em andamento, não pausado e antes do fim planejado. */
  emFoco(agora: string): boolean {
    const linha = this.db
      .prepare(
        `SELECT 1 AS sim FROM sessoes_foco
          WHERE fim IS NULL AND tipo = 'foco' AND pausada_em IS NULL AND coalesce(termina_em, ?) > ?`,
      )
      .get(agora, agora) as { sim: number } | undefined;
    return linha !== undefined;
  }

  inserir(
    e: {
      id: string;
      tipo: TipoEtapa;
      tarefaId: string | null;
      inicio: string;
      terminaEm: string;
      planejadaMin: number;
      ciclo: number;
    },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO sessoes_foco (id, tipo, tarefa_id, inicio, termina_em, duracao_planejada_min, ciclo,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.id,
        e.tipo,
        e.tarefaId,
        e.inicio,
        e.terminaEm,
        e.planejadaMin,
        e.ciclo,
        agora,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /** Grava os campos. Sem carimbo (o relógio fechando a etapa), a origem fica a de quem escreveu. */
  gravar(id: string, c: CamposEtapa, agora: string, carimbo: Carimbo | null): void {
    const valores = [
      c.fim,
      c.termina_em,
      c.pausada_em,
      c.duracao_planejada_min,
      c.duracao_real_min,
      c.interrompida ? 1 : 0,
      agora,
    ];
    const campos = `fim = ?, termina_em = ?, pausada_em = ?, duracao_planejada_min = ?, duracao_real_min = ?,
      interrompida = ?, atualizado_em = ?`;
    if (carimbo === null) {
      this.db.prepare(`UPDATE sessoes_foco SET ${campos} WHERE id = ?`).run(...valores, id);
      return;
    }
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(`UPDATE sessoes_foco SET ${campos}, origem = ?, agente_id = ?, execucao_id = ? WHERE id = ?`)
      .run(...valores, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  tarefaViva(id: string): boolean {
    return (
      this.db.prepare("SELECT 1 AS sim FROM tarefas WHERE id = ? AND apagado_em IS NULL").get(id) !==
      undefined
    );
  }

  /** O título de cada tarefa, viva ou na lixeira: o histórico mostra o nome de quando ela existia. */
  titulos(ids: readonly string[], soVivas = false): Map<string, string> {
    const unicos = [...new Set(ids)];
    const titulos = new Map<string, string>();
    if (unicos.length === 0) return titulos;
    const linhas = this.db
      .prepare(
        `SELECT id, titulo FROM tarefas WHERE id IN (SELECT value FROM json_each(?))
          ${soVivas ? "AND apagado_em IS NULL" : ""}`,
      )
      .all(JSON.stringify(unicos)) as { id: string; titulo: string }[];
    for (const l of linhas) titulos.set(l.id, l.titulo);
    return titulos;
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
 * A etapa fechada em `fim`: o tempo real é o planejado menos o que faltava (o tempo parado não
 * entra, porque empurrou o fim planejado), e antes da hora fica interrompida. Pausada, o relógio
 * dela parou em `pausada_em`.
 */
export function fechada(l: LinhaEtapa, fim: Date, interrompida?: boolean): CamposEtapa {
  const parouEm = l.pausada_em !== null ? Date.parse(l.pausada_em) : fim.getTime();
  const faltava = Math.max(0, terminaEmDe(l) - parouEm);
  const realMs = Math.max(0, l.duracao_planejada_min * MIN - faltava);
  const fimGravado = new Date(Math.max(Date.parse(l.inicio), fim.getTime()));
  return {
    fim: fimGravado.toISOString(),
    termina_em: new Date(terminaEmDe(l)).toISOString(),
    pausada_em: null,
    duracao_planejada_min: l.duracao_planejada_min,
    duracao_real_min: Math.round(realMs / MIN),
    interrompida: interrompida ?? faltava > 0,
  };
}

/** "25 min", "1h", "1h40". */
export function duracaoEmTexto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** O que as notificações oferecem ao foco. */
export type NotificacoesDoFoco = Pick<ServicoNotificacoes, "avisar" | "resolvido" | "registrarAcao">;

export interface FontesFoco {
  /** O fuso e os ciclos de `config` (`dia`), lidos a cada conta: mudou no Sistema, vale na próxima etapa. */
  lerDia: () => { fuso: string; foco: CiclosFoco };
  notificacoes: NotificacoesDoFoco;
  /** O relógio do dia, para se rearmar a cada mudança. */
  relogio?: { mudou(): void };
}

export interface AvisosFoco {
  /** O foco agora, depois de qualquer mudança (`foco.mudou`). */
  mudou: (estado: EstadoFoco) => void;
}

export interface OpcoesFoco {
  agora?: () => Date;
  gerarId?: () => string;
}

/** Onde a rodada está: a etapa em andamento e a última que terminou hoje, se ainda conta. */
interface Situacao {
  andamento: LinhaEtapa | null;
  /** A última etapa terminada, se for de hoje e nada estiver em andamento. */
  ultima: LinhaEtapa | null;
}

export class ServicoFoco implements FonteDoRelogio {
  readonly nome = "foco";
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly tempo: TempoDoDia;

  constructor(
    private readonly repo: RepositorioFoco,
    private readonly fontes: FontesFoco,
    private readonly avisos: AvisosFoco,
    opcoes: OpcoesFoco = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.tempo = new TempoDoDia(() => fontes.lerDia().fuso, this.agora);
    fontes.notificacoes.registrarAcao(PREFIXO, (alvo, botao) => this.aoClicar(alvo, botao));
  }

  obter(): EstadoFoco {
    const ciclos = this.fontes.lerDia().foco;
    const situacao = this.situacao();
    const { andamento } = situacao;
    const tarefaId = andamento?.tarefa_id ?? this.tarefaQueContinua(situacao);
    const titulo = tarefaId === null ? null : (this.repo.titulos([tarefaId], true).get(tarefaId) ?? null);
    const hoje = this.tempo.hoje();
    const { minutos, ciclos: ciclosHoje } = somaDosFocos(this.etapasDosDias(hoje, hoje));
    return {
      etapa: andamento === null ? null : paraEtapa(andamento),
      tarefaTitulo: titulo,
      cicloAtual: Math.max(1, this.cicloAtual(situacao, ciclos)),
      ciclosAtePausaLonga: ciclos.ciclosAtePausaLonga,
      proxima: this.proxima(situacao, ciclos),
      focoHojeMin: minutos,
      ciclosHoje,
    };
  }

  /**
   * Começa uma etapa: sem `tipo`, a que vem agora na rodada; sem `minutos`, a duração da
   * configuração; sem `tarefaId`, a tarefa da rodada que continua (a nova rodada começa livre).
   */
  iniciar(entrada: PedidoIniciarFoco = {}, carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const pedido = PedidoIniciarFoco.parse(entrada);
    const situacao = this.situacao();
    if (situacao.andamento !== null) throw new ErroDoFoco(MENSAGEM_EM_ANDAMENTO);
    const ciclos = this.fontes.lerDia().foco;
    const tipo = pedido.tipo ?? this.proxima(situacao, ciclos);
    const tarefaId = pedido.tarefaId === undefined ? this.tarefaQueContinua(situacao, tipo) : pedido.tarefaId;
    if (tarefaId !== null && !this.repo.tarefaViva(tarefaId)) throw new ErroDoFoco(MENSAGEM_TAREFA);
    const ciclo = tipo === "foco" ? this.cicloDoProximoFoco(situacao, ciclos) : this.cicloDaPausa(situacao);
    this.repo.transacao(() =>
      this.comecar({ tipo, tarefaId, ciclo, minutos: pedido.minutos, inicio: this.agora() }, carimbo),
    );
    return this.mudou(situacao.ultima);
  }

  /** O atalho do foco (Ctrl+Alt+P): inicia se está parado, pausa se está rodando, retoma se pausado. */
  alternar(carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const andamento = this.repo.emAndamento();
    if (andamento === null) return this.iniciar({}, carimbo);
    return andamento.pausada_em === null ? this.pausar(carimbo) : this.retomar(carimbo);
  }

  pausar(carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const andamento = this.exigirAndamento();
    if (andamento.pausada_em !== null) throw new ErroDoFoco(MENSAGEM_JA_PAUSADA);
    this.repo.gravar(
      andamento.id,
      { ...camposDe(andamento), pausada_em: this.instante() },
      this.instante(),
      carimbo,
    );
    return this.mudou(null);
  }

  /** O fim planejado anda o tempo que a etapa ficou parada. */
  retomar(carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const andamento = this.exigirAndamento();
    if (andamento.pausada_em === null) throw new ErroDoFoco(MENSAGEM_NAO_PAUSADA);
    const agora = this.agora();
    const parado = Math.max(0, agora.getTime() - Date.parse(andamento.pausada_em));
    this.repo.gravar(
      andamento.id,
      {
        ...camposDe(andamento),
        pausada_em: null,
        termina_em: new Date(terminaEmDe(andamento) + parado).toISOString(),
      },
      agora.toISOString(),
      carimbo,
    );
    return this.mudou(null);
  }

  /**
   * "+5 min": estica a etapa em andamento. Com o foco recém-terminado pelo relógio ("Ciclo
   * terminado"), ele volta a correr por mais esses minutos; o intervalo parado não conta.
   */
  estender(entrada: PedidoEstenderFoco, carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const { minutos } = PedidoEstenderFoco.parse(entrada);
    const situacao = this.situacao();
    const agora = this.agora();
    const andamento = situacao.andamento;
    if (andamento !== null) {
      this.repo.gravar(
        andamento.id,
        {
          ...camposDe(andamento),
          termina_em: new Date(terminaEmDe(andamento) + minutos * MIN).toISOString(),
          duracao_planejada_min: andamento.duracao_planejada_min + minutos,
        },
        agora.toISOString(),
        carimbo,
      );
      return this.mudou(null);
    }
    const ultima = situacao.ultima;
    if (ultima === null || ultima.tipo !== "foco" || ultima.interrompida === 1) {
      throw new ErroDoFoco(MENSAGEM_PARADO);
    }
    this.repo.gravar(
      ultima.id,
      {
        fim: null,
        termina_em: new Date(agora.getTime() + minutos * MIN).toISOString(),
        pausada_em: null,
        duracao_planejada_min: ultima.duracao_planejada_min + minutos,
        duracao_real_min: null,
        interrompida: false,
      },
      agora.toISOString(),
      carimbo,
    );
    return this.mudou(ultima);
  }

  /**
   * "Terminar ciclo": fecha a etapa agora (antes da hora, fica interrompida). Depois do foco, vem a
   * proposta da pausa; terminar a pausa encerra a rodada.
   */
  terminar(carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const andamento = this.exigirAndamento();
    const agora = this.agora();
    this.repo.gravar(andamento.id, fechada(andamento, agora), agora.toISOString(), carimbo);
    return this.mudou(null);
  }

  /**
   * Pula a pausa: a que está correndo fecha interrompida, ou a proposta depois do foco não começa,
   * e o foco seguinte começa já. Depois da pausa longa, ele abre outra rodada.
   */
  pularPausa(carimbo: Carimbo = DO_USUARIO): EstadoFoco {
    const situacao = this.situacao();
    const { andamento, ultima } = situacao;
    const agora = this.agora();
    const ciclos = this.fontes.lerDia().foco;
    let anterior: LinhaEtapa;
    if (andamento !== null && andamento.tipo !== "foco") anterior = andamento;
    else if (andamento === null && ultima !== null && ultima.tipo === "foco") anterior = ultima;
    else throw new ErroDoFoco(MENSAGEM_SEM_PAUSA);
    this.repo.transacao(() => {
      if (andamento !== null)
        this.repo.gravar(andamento.id, fechada(andamento, agora, true), agora.toISOString(), carimbo);
      this.comecar(
        {
          tipo: "foco",
          tarefaId: anterior.tarefa_id,
          ciclo: anterior.tipo === "pausa_longa" ? 1 : proximoCiclo(cicloDe(anterior), ciclos),
          inicio: agora,
        },
        carimbo,
      );
    });
    return this.mudou(ultima);
  }

  /** O histórico e o relatório dos dias pedidos, no fuso do usuário. */
  historico(entrada: PedidoHistoricoFoco): HistoricoFoco {
    const pedido = PedidoHistoricoFoco.parse(entrada);
    const linhas = this.etapasDosDias(pedido.de, pedido.ate);
    const focos = linhas.filter((l) => l.tipo === "foco" && l.fim !== null);
    const titulos = this.repo.titulos(focos.flatMap((l) => (l.tarefa_id === null ? [] : [l.tarefa_id])));

    const porTarefa = new Map<string | null, FocoPorTarefa>();
    const porDia = new Map<string, FocoPorDia>();
    for (const l of focos) {
      const tarefa = porTarefa.get(l.tarefa_id) ?? {
        tarefaId: l.tarefa_id,
        titulo: l.tarefa_id === null ? null : (titulos.get(l.tarefa_id) ?? null),
        minutos: 0,
        ciclos: 0,
      };
      const dia = this.tempo.diaDe(new Date(l.inicio));
      const doDia = porDia.get(dia) ?? { dia, minutos: 0, ciclos: 0 };
      const completo = l.interrompida === 0 ? 1 : 0;
      tarefa.minutos += l.duracao_real_min ?? 0;
      tarefa.ciclos += completo;
      doDia.minutos += l.duracao_real_min ?? 0;
      doDia.ciclos += completo;
      porTarefa.set(l.tarefa_id, tarefa);
      porDia.set(dia, doDia);
    }
    return {
      etapas: linhas.map(paraEtapa),
      porTarefa: [...porTarefa.values()].sort((a, b) => b.minutos - a.minutos || b.ciclos - a.ciclos),
      porDia: [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1)),
    };
  }

  /**
   * Se há um foco correndo agora, para o silêncio das notificações: a pausa e o foco pausado não
   * silenciam. Banco com problema não segura aviso nenhum.
   */
  emFoco(): boolean {
    try {
      return this.repo.emFoco(this.instante());
    } catch (erro) {
      console.error(`foco: não deu para saber se há foco agora: ${String(erro)}`);
      return false;
    }
  }

  // O relógio do dia.

  /** O fim planejado da etapa que está correndo; pausada, nada vence. */
  proximo(): Date | null {
    const andamento = this.repo.emAndamento();
    if (andamento === null || andamento.pausada_em !== null) return null;
    return new Date(terminaEmDe(andamento));
  }

  /**
   * A etapa que chegou ao fim planejado fecha. Na hora (até 2 min depois), fecha completa: depois
   * da pausa o foco seguinte começa, depois do foco e da pausa longa a Alba avisa. Mais tarde que
   * isso (serviço parado, PC suspenso), fecha interrompida, sem aviso, no último momento em que o PC
   * estava acordado. Numa ausência, a etapa pausada de outro dia também fecha.
   */
  async conferir({ agora, ausencia }: Conferencia): Promise<void> {
    const andamento = this.repo.emAndamento();
    if (andamento === null) return;
    const instante = agora.toISOString();
    if (andamento.pausada_em !== null) {
      const deOutroDia = this.tempo.diaDe(new Date(andamento.pausada_em)) < this.tempo.diaDe(agora);
      if (ausencia === null || !deOutroDia) return;
      this.repo.gravar(
        andamento.id,
        fechada(andamento, new Date(andamento.pausada_em), true),
        instante,
        null,
      );
      this.mudou(null);
      return;
    }
    const termina = terminaEmDe(andamento);
    if (termina > agora.getTime()) return;

    if (agora.getTime() - termina > TOLERANCIA_MS) {
      const acordado = ausencia?.de?.getTime() ?? termina;
      this.repo.gravar(
        andamento.id,
        fechada(andamento, new Date(Math.min(acordado, termina)), true),
        instante,
        null,
      );
      this.mudou(null);
      return;
    }

    const ciclos = this.fontes.lerDia().foco;
    this.repo.transacao(() => {
      this.repo.gravar(andamento.id, fechada(andamento, new Date(termina)), instante, null);
      if (andamento.tipo === "pausa") {
        this.comecar(
          {
            tipo: "foco",
            tarefaId: andamento.tarefa_id,
            ciclo: proximoCiclo(cicloDe(andamento), ciclos),
            inicio: agora,
          },
          DO_USUARIO,
        );
      }
    });
    this.mudou(null);
    if (andamento.tipo === "foco") await this.avisar(this.avisoDoCiclo(andamento.id, ciclos));
    if (andamento.tipo === "pausa_longa") await this.avisar(this.avisoDaRodada(andamento.id));
  }

  // A rodada.

  /** A etapa em andamento e, sem ela, a última terminada hoje (a de ontem não continua a rodada). */
  private situacao(): Situacao {
    const andamento = this.repo.emAndamento();
    if (andamento !== null) return { andamento, ultima: null };
    const ultima = this.repo.ultima();
    if (ultima === null || ultima.fim === null) return { andamento: null, ultima: null };
    const deHoje = this.tempo.diaDe(new Date(ultima.fim)) === this.tempo.hoje();
    return { andamento: null, ultima: deHoje ? ultima : null };
  }

  /** A pausa interrompida sem foco depois foi "Encerrar a rodada"; a longa fecha a rodada. */
  private cicloDoProximoFoco({ andamento, ultima }: Situacao, ciclos: CiclosFoco): number {
    const anterior = andamento ?? ultima;
    if (anterior === null || anterior.tipo === "pausa_longa") return 1;
    if (anterior.tipo === "pausa" && anterior.interrompida === 1) return 1;
    return proximoCiclo(cicloDe(anterior), ciclos);
  }

  /** A pausa leva o ciclo do foco que a antecede; sem foco antes, é a pausa livre (0). */
  private cicloDaPausa({ ultima }: Situacao): number {
    return ultima !== null && ultima.tipo === "foco" ? cicloDe(ultima) : 0;
  }

  private cicloAtual(situacao: Situacao, ciclos: CiclosFoco): number {
    const atual = situacao.andamento ?? situacao.ultima;
    if (atual !== null && (situacao.andamento !== null || atual.tipo === "foco")) return cicloDe(atual);
    return this.cicloDoProximoFoco(situacao, ciclos);
  }

  /** Depois do foco, a pausa (a longa no último ciclo da rodada); depois de qualquer pausa, o foco. */
  private proxima(situacao: Situacao, ciclos: CiclosFoco): TipoEtapa {
    const atual = situacao.andamento ?? situacao.ultima;
    if (atual === null || atual.tipo !== "foco") return "foco";
    return cicloDe(atual) >= ciclos.ciclosAtePausaLonga ? "pausa_longa" : "pausa";
  }

  /** A tarefa da rodada, se a etapa que vem a continua; a nova rodada começa livre. */
  private tarefaQueContinua(situacao: Situacao, tipo?: TipoEtapa): string | null {
    const anterior = situacao.andamento ?? situacao.ultima;
    if (anterior === null) return null;
    const ciclos = this.fontes.lerDia().foco;
    const proxima = tipo ?? this.proxima(situacao, ciclos);
    if (proxima === "foco" && this.cicloDoProximoFoco(situacao, ciclos) === 1) return null;
    return anterior.tarefa_id;
  }

  /** Grava a etapa nova; quem chama já está numa transação, se precisa. */
  private comecar(
    e: {
      tipo: TipoEtapa;
      tarefaId: string | null;
      ciclo: number;
      minutos?: number | undefined;
      inicio: Date;
    },
    carimbo: Carimbo,
  ): void {
    const ciclos = this.fontes.lerDia().foco;
    const minutos =
      e.minutos ??
      (e.tipo === "foco" ? ciclos.focoMin : e.tipo === "pausa" ? ciclos.pausaMin : ciclos.pausaLongaMin);
    this.repo.inserir(
      {
        id: this.gerarId(),
        tipo: e.tipo,
        tarefaId: e.tarefaId,
        inicio: e.inicio.toISOString(),
        terminaEm: new Date(e.inicio.getTime() + minutos * MIN).toISOString(),
        planejadaMin: minutos,
        ciclo: e.ciclo,
      },
      this.instante(),
      carimbo,
    );
  }

  /** As etapas que começaram nos dias, no fuso; o último dia do calendário não tem dia seguinte. */
  private etapasDosDias(de: string, ate: string): LinhaEtapa[] {
    let inicio: Date;
    let fim: Date | null;
    try {
      inicio = this.tempo.inicioDoDia(de);
      fim = ate >= "9999-12-31" ? null : this.tempo.inicioDoDia(somarDias(ate, 1));
    } catch (erro) {
      if (erro instanceof RangeError) throw new ErroDoFoco(MENSAGEM_DIA);
      throw erro;
    }
    return this.repo.doIntervalo(inicio.toISOString(), fim?.toISOString() ?? null);
  }

  // Os avisos.

  /** "Ciclo 2 de 4 terminou": a Alba propõe a pausa, uma vez. */
  private avisoDoCiclo(etapaId: string, ciclos: CiclosFoco): NovoAviso {
    const etapa = this.repo.etapa(etapaId);
    const ciclo = etapa === null ? 1 : cicloDe(etapa);
    const longa = ciclo >= ciclos.ciclosAtePausaLonga;
    const tarefa =
      etapa === null || etapa.tarefa_id === null
        ? null
        : (this.repo.titulos([etapa.tarefa_id]).get(etapa.tarefa_id) ?? null);
    const foco = duracaoEmTexto(etapa?.duracao_real_min ?? ciclos.focoMin);
    const pausa = longa
      ? `a pausa longa de ${duracaoEmTexto(ciclos.pausaLongaMin)}`
      : `a pausa de ${duracaoEmTexto(ciclos.pausaMin)}`;
    return {
      agenteId: ALBA,
      tipo: "lembrete",
      titulo: `Ciclo ${ciclo} de ${ciclos.ciclosAtePausaLonga} terminou`,
      corpo: `${foco} de foco${tarefa === null ? "" : ` em ${tarefa}`}. Começo ${pausa}?`,
      referencia: referenciaDe(etapaId),
      botoes: BOTOES_DO_CICLO,
    };
  }

  /** "Rodada completa": quantos focos e quanto tempo desde o ciclo 1, e a escolha de seguir. */
  private avisoDaRodada(etapaId: string): NovoAviso {
    const etapa = this.repo.etapa(etapaId);
    const ate = etapa?.inicio ?? this.instante();
    const desde = this.repo.inicioDaRodada(ate) ?? ate;
    const focos = this.repo.doIntervalo(desde, ate).filter((l) => l.tipo === "foco");
    const { minutos, ciclos } = somaDosFocos(focos);
    return {
      agenteId: ALBA,
      tipo: "lembrete",
      titulo: "Rodada completa",
      corpo: `${ciclos === 1 ? "1 ciclo" : `${ciclos} ciclos`}, ${duracaoEmTexto(minutos)} de foco. Começo outra rodada?`,
      referencia: referenciaDe(etapaId),
      botoes: BOTOES_DA_RODADA,
    };
  }

  /** O botão do aviso: só vale com nada correndo e a etapa do aviso ainda como a última. */
  private aoClicar(alvo: string, botao: string): Promise<boolean> {
    try {
      const { andamento, ultima } = this.situacao();
      if (andamento !== null || ultima?.id !== alvo) return Promise.resolve(false);
      if (ultima.tipo === "foco" && botao === "pausa") this.iniciar({});
      else if (ultima.tipo === "foco" && botao === "pular") this.pularPausa();
      else if (ultima.tipo === "foco" && botao === "mais") this.estender({ minutos: MINUTOS_DO_AVISO });
      else if (ultima.tipo === "pausa_longa" && botao === "outra") this.iniciar({ tipo: "foco" });
      else return Promise.resolve(false);
      return Promise.resolve(true);
    } catch (erro) {
      if (erro instanceof ErroDoFoco) return Promise.resolve(false);
      return Promise.reject(erro instanceof Error ? erro : new Error(String(erro)));
    }
  }

  private async avisar(aviso: NovoAviso): Promise<void> {
    try {
      await this.fontes.notificacoes.avisar(aviso);
    } catch (erro) {
      console.error(`foco: aviso não saiu: ${String(erro)}`);
    }
  }

  /**
   * Avisa as janelas e rearma o relógio. Quando a etapa que terminou (`deixada`) deu lugar a outra
   * ou voltou a correr, o aviso dela sai da Central de Notificações.
   */
  private mudou(deixada: LinhaEtapa | null): EstadoFoco {
    const estado = this.obter();
    this.avisos.mudou(estado);
    this.fontes.relogio?.mudou();
    if (deixada !== null) {
      this.fontes.notificacoes
        .resolvido(referenciaDe(deixada.id))
        .catch((erro: unknown) => console.error(`foco: aviso não retirado: ${String(erro)}`));
    }
    return estado;
  }

  private exigirAndamento(): LinhaEtapa {
    const andamento = this.repo.emAndamento();
    if (andamento === null) throw new ErroDoFoco(MENSAGEM_PARADO);
    return andamento;
  }

  private instante(): string {
    return this.agora().toISOString();
  }
}

const camposDe = (l: LinhaEtapa): CamposEtapa => ({
  fim: l.fim,
  termina_em: new Date(terminaEmDe(l)).toISOString(),
  pausada_em: l.pausada_em,
  duracao_planejada_min: l.duracao_planejada_min,
  duracao_real_min: l.duracao_real_min,
  interrompida: l.interrompida === 1,
});

/** O ciclo do foco seguinte: depois do último da rodada, volta ao 1. */
function proximoCiclo(ciclo: number, ciclos: CiclosFoco): number {
  return ciclo >= ciclos.ciclosAtePausaLonga ? 1 : ciclo + 1;
}

/** Minutos de foco terminados e quantos deles foram completos. */
function somaDosFocos(linhas: readonly LinhaEtapa[]): { minutos: number; ciclos: number } {
  let minutos = 0;
  let ciclos = 0;
  for (const l of linhas) {
    if (l.tipo !== "foco" || l.fim === null) continue;
    minutos += l.duracao_real_min ?? 0;
    if (l.interrompida === 0) ciclos += 1;
  }
  return { minutos, ciclos };
}
