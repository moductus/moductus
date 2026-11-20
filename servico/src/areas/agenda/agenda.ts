import type { DatabaseSync } from "node:sqlite";
import {
  Alertas,
  CALENDARIO_LOCAL,
  type Agenda,
  type Apagados,
  type Calendario,
  type ConfigDia,
  type EventoAgenda,
  type MudancaAgenda,
  type MudancaCalendario,
  type MudancaEvento,
  type NovoEvento,
  type Origem,
  type PedidoAgenda,
  type PedidoAplicarSugestao,
  type PedidoEvento,
  type SugestaoAplicada,
} from "@moductus/contrato";
import { z } from "zod";
import { PRAZO_DESFAZER_MS } from "../../agentes/execucoes.ts";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { RecusaDesfazer, type ContextoDesfazer } from "../../ferramentas/ferramenta.ts";
import { lerRecorrencia } from "../dia/recorrencia.ts";
import {
  PRIMEIRO_NUMERO,
  ULTIMO_NUMERO,
  diaNoFuso,
  inicioDoDia,
  numeroDoDia,
  somarDias,
} from "../dia/tempo.ts";
import {
  MAX_OCORRENCIAS_POR_EVENTO,
  duracaoPassaDoPeriodo,
  montarDias,
  ocorrenciasNoIntervalo,
  type EventoParaExpandir,
} from "./livre.ts";
import type { RepositorioTarefasDoDia } from "./tarefas-do-dia.ts";

/**
 * Agenda da Alba (DATA.md §2, migração 014): o calendário local com eventos e recorrência, a
 * consulta de um intervalo, os blocos livres do expediente de `config`, o "dia cheio" e o encaixe
 * que a Alba sugere e só o clique aplica.
 */

export const MENSAGEM_CALENDARIO_NAO_ENCONTRADO = "calendário não encontrado";
export const MENSAGEM_EVENTO_NAO_ENCONTRADO = "evento não encontrado";

export const MENSAGEM_REGRA_DE_FORA = (motivo: string) =>
  `o Moductus não sabe repetir este evento (${motivo})`;
export const MENSAGEM_DURACAO_PASSA_DA_REGRA =
  "o evento dura mais que o intervalo entre as repetições: encurte o evento ou espace a regra";
export const MENSAGEM_TAREFA_NAO_ENCONTRADA = "tarefa não encontrada";
export const MENSAGEM_TAREFA_FECHADA = "a tarefa não está aberta";
export const MENSAGEM_TAREFA_COM_HORA = "a tarefa já tem hora marcada";
export const MENSAGEM_TAREFA_NA_AGENDA = "a tarefa já está na agenda";
export const MENSAGEM_ENCAIXE_SAIU = "o evento do encaixe já saiu da agenda";
export const MENSAGEM_ENCAIXE_MUDOU = "o evento do encaixe foi mudado depois";
export const MENSAGEM_DESFAZER_SAIU = "o evento já saiu da agenda";
export const MENSAGEM_DESFAZER_MUDOU = "o evento foi mudado depois";

/** O nome da chamada que o desfazer do histórico procura no catálogo (`ferramentas/agenda`). */
export const FERRAMENTA_APLICAR_SUGESTAO = "agenda.aplicar_sugestao";

interface LinhaCalendario {
  id: string;
  nome: string;
  cor: string | null;
}

const COLUNAS_CALENDARIO = "id, nome, cor";

const paraCalendario = (l: LinhaCalendario): Calendario => ({ id: l.id, nome: l.nome, cor: l.cor });

interface LinhaEvento {
  id: string;
  calendario_id: string;
  titulo: string;
  descricao: string | null;
  inicio: string;
  fim: string;
  dia_inteiro: number;
  local: string | null;
  recorrencia: string | null;
  alertas: string;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

const COLUNAS_EVENTO = `e.id, e.calendario_id, e.titulo, e.descricao, e.inicio, e.fim, e.dia_inteiro, e.local,
  e.recorrencia, e.alertas, e.origem, e.agente_id, e.execucao_id, e.criado_em, e.atualizado_em`;

const paraEvento = (l: LinhaEvento): EventoAgenda => ({
  id: l.id,
  calendarioId: l.calendario_id,
  titulo: l.titulo,
  descricao: l.descricao,
  inicio: l.inicio,
  fim: l.fim,
  diaInteiro: l.dia_inteiro === 1,
  local: l.local,
  recorrencia: l.recorrencia,
  alertas: JSON.parse(l.alertas) as number[],
  origem: l.origem,
  agenteId: l.agente_id,
  execucaoId: l.execucao_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});

const paraExpandir = (l: LinhaEvento): EventoParaExpandir => ({
  id: l.id,
  calendarioId: l.calendario_id,
  titulo: l.titulo,
  inicio: l.inicio,
  fim: l.fim,
  diaInteiro: l.dia_inteiro === 1,
  local: l.local,
  recorrencia: l.recorrencia,
});

/** Um aviso de compromisso: a ocorrência (como a agenda a mostra), quando ela começa e quando toca. */
export interface AlertaDeCompromisso {
  eventoId: string;
  titulo: string;
  local: string | null;
  diaInteiro: boolean;
  /** O começo da ocorrência como a agenda o escreve: instante, ou dia no de dia inteiro. */
  inicio: string;
  comeca: Date;
  minutos: number;
  toca: Date;
}

/** Os minutos de cada alerta, sem repetir; o que não passa no contrato fica de fora. */
function alertasValidos(texto: string): number[] {
  let lidos: unknown;
  try {
    lidos = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(lidos)) return [];
  const minutos = lidos.filter((m): m is number => Alertas.element.safeParse(m).success);
  return [...new Set(minutos)];
}

/** Os campos que se gravam de um evento. */
export interface CamposEvento {
  titulo: string;
  descricao: string | null;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local: string | null;
  recorrencia: string | null;
  alertas: number[];
}

/** `calendarios` e `eventos` (migração 014). O que está na lixeira não aparece. */
export class RepositorioAgenda {
  constructor(private readonly db: DatabaseSync) {}

  /** O local primeiro, depois os outros por nome. */
  calendarios(): Calendario[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_CALENDARIO} FROM calendarios WHERE apagado_em IS NULL
          ORDER BY id <> '${CALENDARIO_LOCAL}', nome, id`,
      )
      .all() as unknown as LinhaCalendario[];
    return linhas.map(paraCalendario);
  }

  calendario(id: string): LinhaCalendario | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_CALENDARIO} FROM calendarios WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaCalendario | undefined;
    return linha ?? null;
  }

  definirCalendario(
    id: string,
    campos: { nome: string; cor: string | null },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE calendarios SET nome = ?, cor = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(campos.nome, campos.cor, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  /**
   * Os eventos vivos que podem encostar no intervalo. É uma peneira larga
   * (texto do dia contra texto do instante, com um dia de folga de cada lado, o que cobre qualquer
   * fuso); a conta exata é a da expansão. O recorrente que começou antes entra sempre. Sem
   * `antesDe` (o intervalo chega ao fim do calendário), não há teto.
   */
  eventosQuePodemEncostar(desde: string, antesDe: string | null): LinhaEvento[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS_EVENTO} FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE e.apagado_em IS NULL AND c.apagado_em IS NULL
            AND (? IS NULL OR e.inicio < ?) AND (e.recorrencia IS NOT NULL OR e.fim >= ?)`,
      )
      .all(antesDe, antesDe, desde) as unknown as LinhaEvento[];
  }

  /**
   * Os eventos vivos que têm algum alerta e podem ainda começar depois de
   * `desde` (dia, com a mesma peneira larga de {@link eventosQuePodemEncostar}).
   */
  eventosComAlerta(desde: string): LinhaEvento[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS_EVENTO} FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE e.apagado_em IS NULL AND c.apagado_em IS NULL
            AND json_array_length(e.alertas) > 0 AND (e.recorrencia IS NOT NULL OR e.fim >= ?)`,
      )
      .all(desde) as unknown as LinhaEvento[];
  }

  /** O evento vivo, de calendário vivo. */
  evento(id: string): LinhaEvento | null {
    const linha = this.db
      .prepare(
        `SELECT ${COLUNAS_EVENTO} FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE e.id = ? AND e.apagado_em IS NULL AND c.apagado_em IS NULL`,
      )
      .get(id) as unknown as LinhaEvento | undefined;
    return linha ?? null;
  }

  criarEvento(id: string, calendarioId: string, campos: CamposEvento, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO eventos (id, calendario_id, titulo, descricao, inicio, fim, dia_inteiro, local, recorrencia,
           alertas, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        calendarioId,
        campos.titulo,
        campos.descricao,
        campos.inicio,
        campos.fim,
        campos.diaInteiro ? 1 : 0,
        campos.local,
        campos.recorrencia,
        JSON.stringify(campos.alertas),
        agora,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  mudarEvento(id: string, campos: CamposEvento, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE eventos SET titulo = ?, descricao = ?, inicio = ?, fim = ?, dia_inteiro = ?, local = ?,
           recorrencia = ?, alertas = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        campos.titulo,
        campos.descricao,
        campos.inicio,
        campos.fim,
        campos.diaInteiro ? 1 : 0,
        campos.local,
        campos.recorrencia,
        JSON.stringify(campos.alertas),
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        id,
      );
  }

  /** Passa o evento para outro calendário. */
  mudarCalendarioDoEvento(id: string, calendarioId: string): void {
    this.db
      .prepare("UPDATE eventos SET calendario_id = ? WHERE id = ? AND apagado_em IS NULL")
      .run(calendarioId, id);
  }

  /** Manda à lixeira. */
  apagarEvento(id: string, agora: string, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE eventos SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
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

export interface AvisosAgenda {
  /** Eventos que mudaram, de qualquer janela, ferramenta ou desfazer. */
  mudou: (mudanca: MudancaAgenda) => void;
  /** A lista de calendários, a cada mudança. */
  calendarios: (calendarios: Calendario[]) => void;
}

/** Onde fica registrada a chamada que o encaixe aplicado deixa para o desfazer (`chamadas_ferramenta`). */
export interface RegistroChamadas {
  registrarChamadaDoUsuario(c: {
    id: string;
    ferramenta: string;
    efeito: "interno";
    entrada: unknown;
    resultado: unknown;
    agora: string;
  }): void;
}

export interface DependenciasAgenda {
  repo: RepositorioAgenda;
  tarefas: RepositorioTarefasDoDia;
  chamadas: RegistroChamadas;
  /**
   * Fuso e expediente de `config` e os dias de trabalho (as rotinas), lidos a cada pergunta: mudou
   * no Sistema, vale na hora. Sem os dias, todo dia tem expediente.
   */
  lerDia: () => Pick<ConfigDia, "fuso" | "expediente"> & { diasDeTrabalho?: readonly number[] };
}

export interface OpcoesAgenda {
  agora?: () => Date;
  gerarId?: () => string;
}

/** O que o encaixe aplicado guarda no resultado da chamada: o que o desfazer precisa para voltar. */
const ResultadoDoEncaixe = z.object({ eventoId: z.string(), tarefaId: z.string(), versao: z.string() });

export class ServicoAgenda {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;

  constructor(
    private readonly deps: DependenciasAgenda,
    private readonly avisos: AvisosAgenda,
    opcoes: OpcoesAgenda = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  calendarios(): Calendario[] {
    return this.deps.repo.calendarios();
  }

  /** Nome e cor do calendário. */
  definirCalendario(mudanca: MudancaCalendario, carimbo: Carimbo = DO_USUARIO): Calendario {
    const atual = this.deps.repo.calendario(mudanca.id);
    if (!atual) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    const campos = {
      nome: mudanca.nome ?? atual.nome,
      cor: mudanca.cor === undefined ? atual.cor : mudanca.cor,
    };
    const mudou = campos.nome !== atual.nome || campos.cor !== atual.cor;
    if (mudou) {
      this.deps.repo.definirCalendario(atual.id, campos, this.agora().toISOString(), carimbo);
      this.avisos.calendarios(this.deps.repo.calendarios());
    }
    const calendario = this.deps.repo.calendario(atual.id);
    if (!calendario) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    return paraCalendario(calendario);
  }

  /**
   * Os dias de `de` a `ate`: as ocorrências, e cada dia com os blocos livres, o planejado, o "dia
   * cheio" e os encaixes.
   */
  consultar(pedido: PedidoAgenda): Agenda {
    const { fuso, expediente, diasDeTrabalho } = this.deps.lerDia();
    const agora = this.agora();
    // A folga da peneira para nas pontas do calendário (0001-01-01 e 9999-12-31).
    const desde = numeroDoDia(pedido.de) > PRIMEIRO_NUMERO ? somarDias(pedido.de, -1) : pedido.de;
    const antesDe = numeroDoDia(pedido.ate) + 2 <= ULTIMO_NUMERO ? somarDias(pedido.ate, 2) : null;
    const linhas = this.deps.repo.eventosQuePodemEncostar(desde, antesDe);
    const ocorrencias = ocorrenciasNoIntervalo(
      linhas.map(paraExpandir),
      pedido.de,
      pedido.ate,
      fuso,
      (eventoId) =>
        console.error(
          `agenda: o evento ${eventoId} passou de ${MAX_OCORRENCIAS_POR_EVENTO} ocorrências de ${pedido.de} a ${pedido.ate}; o resto ficou de fora`,
        ),
    );
    const dias = montarDias({
      de: pedido.de,
      ate: pedido.ate,
      hoje: diaNoFuso(agora, fuso),
      agora,
      fuso,
      expediente,
      diasDeTrabalho,
      ocorrencias,
      tarefas: this.deps.tarefas.abertasAte(pedido.ate),
    });
    return { ocorrencias, dias };
  }

  /**
   * Os avisos de compromisso (os `alertas` do evento, em minutos antes do começo) para o relógio da
   * Alba: cada ocorrência que começa depois de `comecamDepoisDe`, com cada alerta dela que toca até
   * `tocamAte`, inclusive os que já tocaram; quem decide o que avisar é o vigia. O de dia inteiro
   * começa à meia-noite do dia no fuso. Alerta fora do que o contrato aceita (veio de outro PC) não
   * conta. Em ordem de toque.
   */
  alertasDeCompromissos(janela: { comecamDepoisDe: Date; tocamAte: Date }): AlertaDeCompromisso[] {
    const { fuso } = this.deps.lerDia();
    const de = janela.comecamDepoisDe.getTime();
    const ate = janela.tocamAte.getTime();
    const diaDe = diaNoFuso(janela.comecamDepoisDe, fuso);
    const desde = numeroDoDia(diaDe) > PRIMEIRO_NUMERO ? somarDias(diaDe, -1) : diaDe;
    const linhas = this.deps.repo.eventosComAlerta(desde);
    const alertasDe = new Map<string, number[]>();
    let maiorMin = 0;
    for (const l of linhas) {
      const minutos = alertasValidos(l.alertas);
      if (minutos.length === 0) continue;
      alertasDe.set(l.id, minutos);
      maiorMin = Math.max(maiorMin, ...minutos);
    }
    if (alertasDe.size === 0) return [];
    // A ocorrência mais longe que ainda toca até `tocamAte` começa no máximo o maior alerta depois.
    const limite = Math.min(ate + maiorMin * 60_000, (ULTIMO_NUMERO + 1) * 86_400_000 - 1);
    const diaAte = diaNoFuso(new Date(Math.max(limite, de)), fuso);
    const ocorrencias = ocorrenciasNoIntervalo(
      linhas.filter((l) => alertasDe.has(l.id)).map(paraExpandir),
      diaDe,
      diaAte,
      fuso,
    );
    const alertas: AlertaDeCompromisso[] = [];
    for (const o of ocorrencias) {
      const comeca = o.diaInteiro ? inicioDoDia(o.inicio, fuso).getTime() : Date.parse(o.inicio);
      if (comeca <= de) continue;
      for (const minutos of alertasDe.get(o.eventoId) ?? []) {
        const toca = comeca - minutos * 60_000;
        if (toca > ate) continue;
        alertas.push({
          eventoId: o.eventoId,
          titulo: o.titulo,
          local: o.local,
          diaInteiro: o.diaInteiro,
          inicio: o.inicio,
          comeca: new Date(comeca),
          minutos,
          toca: new Date(toca),
        });
      }
    }
    return alertas.sort((a, b) => a.toca.getTime() - b.toca.getTime());
  }

  obterEvento(pedido: PedidoEvento): EventoAgenda {
    return paraEvento(this.exigir(pedido.id));
  }

  /** Sem calendário, vai para o local. */
  criarEvento(novo: NovoEvento, carimbo: Carimbo = DO_USUARIO): EventoAgenda {
    const calendario = this.deps.repo.calendario(novo.calendarioId ?? CALENDARIO_LOCAL);
    if (!calendario) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    const campos: CamposEvento = {
      titulo: novo.titulo,
      descricao: novo.descricao ?? null,
      inicio: novo.inicio,
      fim: novo.fim,
      diaInteiro: novo.diaInteiro,
      local: novo.local ?? null,
      recorrencia: regraQueSeRepete(novo.recorrencia ?? null),
      alertas: novo.alertas ?? [],
    };
    if (duracaoPassaDoPeriodo(campos)) throw new Error(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    const id = this.gerarId();
    const agora = this.agora().toISOString();
    this.deps.repo.criarEvento(id, calendario.id, campos, agora, carimbo);
    return this.avisar(this.exigir(id));
  }

  /** Mudança parcial; com `calendarioId`, o evento passa para aquele calendário. */
  definirEvento(mudanca: MudancaEvento, carimbo: Carimbo = DO_USUARIO): EventoAgenda {
    const atual = this.exigir(mudanca.id);
    const destino =
      mudanca.calendarioId === undefined || mudanca.calendarioId === atual.calendario_id
        ? null
        : this.deps.repo.calendario(mudanca.calendarioId);
    if (mudanca.calendarioId !== undefined && mudanca.calendarioId !== atual.calendario_id && !destino)
      throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    const campos: CamposEvento = {
      titulo: mudanca.titulo ?? atual.titulo,
      descricao: mudanca.descricao === undefined ? atual.descricao : mudanca.descricao,
      inicio: mudanca.inicio ?? atual.inicio,
      fim: mudanca.fim ?? atual.fim,
      diaInteiro: mudanca.diaInteiro ?? atual.dia_inteiro === 1,
      local: mudanca.local === undefined ? atual.local : mudanca.local,
      // A regra que já estava fica como veio; só a nova precisa ser entendida.
      recorrencia:
        mudanca.recorrencia === undefined ? atual.recorrencia : regraQueSeRepete(mudanca.recorrencia),
      alertas: mudanca.alertas ?? (JSON.parse(atual.alertas) as number[]),
    };
    // Só quem mexe no quando ou na regra é conferido: renomear o que já veio assim não é recusado.
    const mexeNoQuando = mudanca.inicio !== undefined || mudanca.recorrencia !== undefined;
    if (mexeNoQuando && duracaoPassaDoPeriodo(campos)) throw new Error(MENSAGEM_DURACAO_PASSA_DA_REGRA);
    const agora = this.agora().toISOString();
    this.deps.repo.transacao(() => {
      this.deps.repo.mudarEvento(atual.id, campos, agora, carimbo);
      if (destino) this.deps.repo.mudarCalendarioDoEvento(atual.id, destino.id);
    });
    return this.avisar(this.exigir(atual.id));
  }

  /** Manda à lixeira e devolve o que foi. A tarefa do encaixe continua ligada: volta junto se ele voltar. */
  apagarEvento(pedido: PedidoEvento, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigir(pedido.id);
    this.deps.repo.apagarEvento(atual.id, this.agora().toISOString(), carimbo);
    this.avisos.mudou({ eventos: [], apagados: [atual.id] });
    return { ids: [atual.id] };
  }

  /**
   * Aplica o encaixe da Alba com o clique (`interno`, AGENTS.md §4): cria no calendário local o
   * evento com o título da tarefa, no bloco pedido, e liga a tarefa a ele (`tarefas.evento_id`),
   * para ela não contar duas vezes no planejado nem ser sugerida de novo. A chamada fica registrada
   * para `execucoes.desfazer` por 24 h. Tudo numa transação.
   */
  aplicarSugestao(pedido: PedidoAplicarSugestao): SugestaoAplicada {
    const tarefa = this.deps.tarefas.tarefa(pedido.tarefaId);
    if (!tarefa) throw new Error(MENSAGEM_TAREFA_NAO_ENCONTRADA);
    if (tarefa.estado !== "aberta") throw new Error(MENSAGEM_TAREFA_FECHADA);
    if (tarefa.hora !== null) throw new Error(MENSAGEM_TAREFA_COM_HORA);
    if (tarefa.eventoVivoId !== null) throw new Error(MENSAGEM_TAREFA_NA_AGENDA);
    const id = this.gerarId();
    const chamadaId = this.gerarId();
    const agora = this.agora().toISOString();
    const campos: CamposEvento = {
      titulo: tarefa.titulo,
      descricao: null,
      inicio: pedido.inicio,
      fim: pedido.fim,
      diaInteiro: false,
      local: null,
      recorrencia: null,
      alertas: [],
    };
    this.deps.repo.transacao(() => {
      this.deps.repo.criarEvento(id, CALENDARIO_LOCAL, campos, agora, DO_USUARIO);
      this.deps.tarefas.ligarEvento(tarefa.id, id, agora, DO_USUARIO);
      this.deps.chamadas.registrarChamadaDoUsuario({
        id: chamadaId,
        ferramenta: FERRAMENTA_APLICAR_SUGESTAO,
        efeito: "interno",
        entrada: pedido,
        // O formato que o runtime grava (`ResultadoDeFerramenta`): o desfazer lê o `valor`.
        resultado: { ok: true, valor: { eventoId: id, tarefaId: tarefa.id, versao: agora } },
        agora,
      });
    });
    const evento = this.avisar(this.exigir(id));
    return {
      evento,
      chamadaId,
      desfazerAte: new Date(Date.parse(agora) + PRAZO_DESFAZER_MS).toISOString(),
    };
  }

  /**
   * A inversa do encaixe, na transação do desfazer: o evento vai à lixeira e a tarefa se solta
   * dele. Se o evento já saiu ou foi mudado depois, recusa: apagar levaria a mudança de quem mexeu.
   */
  desfazerSugestao(resultado: unknown, ctx: ContextoDesfazer): void {
    const { eventoId, tarefaId, versao } = ResultadoDoEncaixe.parse(resultado);
    const evento = this.deps.repo.evento(eventoId);
    if (!evento) throw new RecusaDesfazer(MENSAGEM_ENCAIXE_SAIU);
    if (evento.atualizado_em !== versao) throw new RecusaDesfazer(MENSAGEM_ENCAIXE_MUDOU);
    const agora = this.agora().toISOString();
    this.deps.repo.apagarEvento(eventoId, agora, ctx.carimbo);
    this.deps.tarefas.desligarEvento(tarefaId, eventoId, agora, ctx.carimbo);
    // A inversa roda dentro da transação do desfazer: o aviso sai depois dela, se o evento saiu mesmo.
    queueMicrotask(() => {
      if (!this.deps.repo.evento(eventoId)) this.avisos.mudou({ eventos: [], apagados: [eventoId] });
    });
  }

  /**
   * A inversa de criar e de mudar um evento pelas ferramentas da Alba, na transação do desfazer:
   * sem `antes`, o evento criado vai à lixeira; com ele, os campos voltam. Só se o evento continua
   * na versão em que a chamada o deixou.
   */
  desfazerEvento(
    alvo: { eventoId: string; versao: string; antes: CamposEvento | null },
    ctx: ContextoDesfazer,
  ): void {
    const evento = this.deps.repo.evento(alvo.eventoId);
    if (!evento) throw new RecusaDesfazer(MENSAGEM_DESFAZER_SAIU);
    if (evento.atualizado_em !== alvo.versao) throw new RecusaDesfazer(MENSAGEM_DESFAZER_MUDOU);
    const agora = this.agora().toISOString();
    if (alvo.antes === null) this.deps.repo.apagarEvento(evento.id, agora, ctx.carimbo);
    else this.deps.repo.mudarEvento(evento.id, alvo.antes, agora, ctx.carimbo);
    // O aviso sai depois da transação, com o que ficou gravado.
    queueMicrotask(() => {
      const depois = this.deps.repo.evento(evento.id);
      this.avisos.mudou(
        depois ? { eventos: [paraEvento(depois)], apagados: [] } : { eventos: [], apagados: [evento.id] },
      );
    });
  }

  private exigir(id: string): LinhaEvento {
    const evento = this.deps.repo.evento(id);
    if (!evento) throw new Error(MENSAGEM_EVENTO_NAO_ENCONTRADO);
    return evento;
  }

  private avisar(linha: LinhaEvento): EventoAgenda {
    const evento = paraEvento(linha);
    this.avisos.mudou({ eventos: [evento], apagados: [] });
    return evento;
  }
}

/** A regra que o evento escrito por aqui leva: só a que o Moductus sabe repetir. */
function regraQueSeRepete(recorrencia: string | null): string | null {
  if (recorrencia === null) return null;
  const leitura = lerRecorrencia(recorrencia);
  if (!leitura.entendida) throw new Error(MENSAGEM_REGRA_DE_FORA(leitura.motivo));
  return recorrencia.trim();
}
