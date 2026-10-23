import type { DatabaseSync } from "node:sqlite";
import {
  CALENDARIO_LOCAL,
  type Agenda,
  type Apagados,
  type Calendario,
  type ConfigDia,
  type EventoAgenda,
  type FonteCalendario,
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
import { PRIMEIRO_NUMERO, ULTIMO_NUMERO, diaNoFuso, numeroDoDia, somarDias } from "../dia/tempo.ts";
import {
  MAX_OCORRENCIAS_POR_EVENTO,
  duracaoPassaDoPeriodo,
  montarDias,
  ocorrenciasNoIntervalo,
  type EventoParaExpandir,
} from "./livre.ts";
import type { RepositorioTarefasDoDia } from "./tarefas-do-dia.ts";

/**
 * Agenda da Alba (DATA.md §2, migração 014, ADR-0035): o calendário local com eventos e
 * recorrência, a consulta de um intervalo que junta o local e o cache do Google, os blocos livres
 * do expediente de `config`, o "dia cheio" e o encaixe que a Alba sugere e só o clique aplica.
 *
 * Escrever vale no local e no "Moductus" (o espelho no Google); o evento do espelho entra também
 * na fila `agenda_saida`, que leva a mudança ao Google (F3-24). Os outros calendários são só
 * leitura por aqui: mudar neles é ferramenta `externo`, com cartão (F3-25).
 */

export const MENSAGEM_CALENDARIO_NAO_ENCONTRADO = "calendário não encontrado";
export const MENSAGEM_EVENTO_NAO_ENCONTRADO = "evento não encontrado";
export const MENSAGEM_SO_LEITURA = "este calendário é só leitura por aqui: peça à Alba para mudar";
export const MENSAGEM_NOME_SO_DO_LOCAL = "nome e cor só mudam no calendário local";
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
  fonte: FonteCalendario;
  cor: string | null;
  espelho: number;
  pode_escrever: number;
  ler: number;
  sincronizado_em: string | null;
}

const COLUNAS_CALENDARIO = "id, nome, fonte, cor, espelho, pode_escrever, ler, sincronizado_em";

const paraCalendario = (l: LinhaCalendario): Calendario => ({
  id: l.id,
  nome: l.nome,
  fonte: l.fonte,
  cor: l.cor,
  espelho: l.espelho === 1,
  podeEscrever: l.pode_escrever === 1,
  ler: l.ler === 1,
  sincronizadoEm: l.sincronizado_em,
});

/** Por aqui se escreve no local e no "Moductus"; nos outros, só a Alba, com cartão. */
const ehEditavel = (c: { fonte: FonteCalendario; espelho: number }) => c.fonte === "local" || c.espelho === 1;

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
  id_externo: string | null;
  alertas: string;
  /** Lista JSON dos inícios que a regra não gera mais (migração 020). */
  excecoes: string;
  /** O fuso em que a regra anda; vazio é o do usuário (migração 020). */
  fuso: string | null;
  origem: Origem;
  agente_id: string | null;
  execucao_id: string | null;
  criado_em: string;
  atualizado_em: string;
  /** Do calendário, pela junção. */
  editavel: number;
  espelho: number;
}

const COLUNAS_EVENTO = `e.id, e.calendario_id, e.titulo, e.descricao, e.inicio, e.fim, e.dia_inteiro, e.local,
  e.recorrencia, e.id_externo, e.alertas, e.excecoes, e.fuso, e.origem, e.agente_id, e.execucao_id, e.criado_em, e.atualizado_em,
  (c.fonte = 'local' OR c.espelho = 1) AS editavel, c.espelho`;

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
  editavel: l.editavel === 1,
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
  editavel: l.editavel === 1,
  excecoes: JSON.parse(l.excecoes) as string[],
  fuso: l.fuso,
});

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

export type OperacaoSaida = "criar" | "mudar" | "apagar";

/** `calendarios`, `eventos` e a fila `agenda_saida` (migração 014). O que está na lixeira não aparece. */
export class RepositorioAgenda {
  constructor(private readonly db: DatabaseSync) {}

  /** O local primeiro, depois o espelho e os de fora, por nome. */
  calendarios(): Calendario[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_CALENDARIO} FROM calendarios WHERE apagado_em IS NULL
          ORDER BY fonte <> 'local', espelho DESC, nome, id`,
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
    campos: { nome: string; cor: string | null; ler: boolean },
    agora: string,
    carimbo: Carimbo,
  ): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `UPDATE calendarios SET nome = ?, cor = ?, ler = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        campos.nome,
        campos.cor,
        campos.ler ? 1 : 0,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        id,
      );
  }

  /**
   * Os eventos vivos dos calendários lidos que podem encostar no intervalo. É uma peneira larga
   * (texto do dia contra texto do instante, com um dia de folga de cada lado, o que cobre qualquer
   * fuso); a conta exata é a da expansão. O recorrente que começou antes entra sempre. Sem
   * `antesDe` (o intervalo chega ao fim do calendário), não há teto.
   */
  eventosQuePodemEncostar(desde: string, antesDe: string | null): LinhaEvento[] {
    return this.db
      .prepare(
        `SELECT ${COLUNAS_EVENTO} FROM eventos e JOIN calendarios c ON c.id = e.calendario_id
          WHERE e.apagado_em IS NULL AND c.apagado_em IS NULL AND c.ler = 1
            AND (? IS NULL OR e.inicio < ?) AND (e.recorrencia IS NOT NULL OR e.fim >= ?)`,
      )
      .all(antesDe, antesDe, desde) as unknown as LinhaEvento[];
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

  /**
   * Passa o evento para outro calendário. O id de lá sai junto: o que já foi ao Google continua no
   * mapa do espelho (`agenda_espelho`), que o apaga; e a leitura de volta não o acha mais por ele.
   */
  mudarCalendarioDoEvento(id: string, calendarioId: string): void {
    this.db
      .prepare(
        "UPDATE eventos SET calendario_id = ?, id_externo = NULL, etag_externo = NULL WHERE id = ? AND apagado_em IS NULL",
      )
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

  /**
   * Uma mudança do evento do espelho para o Google (ADR-0035): a nova substitui a pendente e volta
   * a tentar já. O que ainda não chegou lá (sem `id_externo`) continua um `criar` ao mudar, e
   * apagado antes de chegar sai da fila sem ir.
   */
  enfileirarSaida(eventoId: string, operacao: OperacaoSaida, jaNoGoogle: boolean, agora: string): void {
    if (operacao === "apagar" && !jaNoGoogle) {
      this.db.prepare("DELETE FROM agenda_saida WHERE item_tipo = 'evento' AND item_id = ?").run(eventoId);
      return;
    }
    const vai = operacao === "mudar" && !jaNoGoogle ? "criar" : operacao;
    this.db
      .prepare(
        `INSERT INTO agenda_saida (id, item_tipo, item_id, operacao, proxima_tentativa_em, criado_em, atualizado_em)
         VALUES (?, 'evento', ?, ?, ?, ?, ?)
         ON CONFLICT (item_tipo, item_id) DO UPDATE SET operacao = excluded.operacao, tentativas = 0,
           ultimo_erro = NULL, proxima_tentativa_em = excluded.proxima_tentativa_em,
           atualizado_em = excluded.atualizado_em`,
      )
      .run(novoId(), eventoId, vai, agora, agora, agora);
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
  /** Fuso e expediente de `config`, lidos a cada pergunta: mudou no Sistema, vale na hora. */
  lerDia: () => Pick<ConfigDia, "fuso" | "expediente">;
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

  /** Se a Alba lê o calendário; nome e cor só do local (os outros vêm de onde nasceram). */
  definirCalendario(mudanca: MudancaCalendario, carimbo: Carimbo = DO_USUARIO): Calendario {
    const atual = this.deps.repo.calendario(mudanca.id);
    if (!atual) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    const mexeNoNome = mudanca.nome !== undefined || mudanca.cor !== undefined;
    if (mexeNoNome && atual.fonte !== "local") throw new Error(MENSAGEM_NOME_SO_DO_LOCAL);
    const campos = {
      nome: mudanca.nome ?? atual.nome,
      cor: mudanca.cor === undefined ? atual.cor : mudanca.cor,
      ler: mudanca.ler ?? atual.ler === 1,
    };
    const mudou = campos.nome !== atual.nome || campos.cor !== atual.cor || campos.ler !== (atual.ler === 1);
    if (mudou) {
      this.deps.repo.definirCalendario(atual.id, campos, this.agora().toISOString(), carimbo);
      this.avisos.calendarios(this.deps.repo.calendarios());
    }
    const calendario = this.deps.repo.calendario(atual.id);
    if (!calendario) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    return paraCalendario(calendario);
  }

  /**
   * Os dias de `de` a `ate`: as ocorrências de todos os calendários lidos (o local e o cache do
   * Google), e cada dia com os blocos livres, o planejado, o "dia cheio" e os encaixes.
   */
  consultar(pedido: PedidoAgenda): Agenda {
    const { fuso, expediente } = this.deps.lerDia();
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
      ocorrencias,
      tarefas: this.deps.tarefas.abertasAte(pedido.ate),
    });
    return { ocorrencias, dias };
  }

  obterEvento(pedido: PedidoEvento): EventoAgenda {
    return paraEvento(this.exigir(pedido.id));
  }

  /** Sem calendário, vai para o local. */
  criarEvento(novo: NovoEvento, carimbo: Carimbo = DO_USUARIO): EventoAgenda {
    const calendario = this.deps.repo.calendario(novo.calendarioId ?? CALENDARIO_LOCAL);
    if (!calendario) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
    if (!ehEditavel(calendario)) throw new Error(MENSAGEM_SO_LEITURA);
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
    this.deps.repo.transacao(() => {
      this.deps.repo.criarEvento(id, calendario.id, campos, agora, carimbo);
      if (calendario.espelho === 1) this.deps.repo.enfileirarSaida(id, "criar", false, agora);
    });
    return this.avisar(this.exigir(id));
  }

  /**
   * Mudança parcial; o evento que não é do local nem do "Moductus" não muda por aqui. Trocar de
   * calendário só vale entre esses dois: ir ao "Moductus" é criar lá, sair dele é apagar lá.
   */
  definirEvento(mudanca: MudancaEvento, carimbo: Carimbo = DO_USUARIO): EventoAgenda {
    const atual = this.exigir(mudanca.id);
    if (atual.editavel !== 1) throw new Error(MENSAGEM_SO_LEITURA);
    const destino =
      mudanca.calendarioId === undefined || mudanca.calendarioId === atual.calendario_id
        ? null
        : this.deps.repo.calendario(mudanca.calendarioId);
    if (mudanca.calendarioId !== undefined && mudanca.calendarioId !== atual.calendario_id) {
      if (!destino) throw new Error(MENSAGEM_CALENDARIO_NAO_ENCONTRADO);
      if (!ehEditavel(destino)) throw new Error(MENSAGEM_SO_LEITURA);
    }
    const campos: CamposEvento = {
      titulo: mudanca.titulo ?? atual.titulo,
      descricao: mudanca.descricao === undefined ? atual.descricao : mudanca.descricao,
      inicio: mudanca.inicio ?? atual.inicio,
      fim: mudanca.fim ?? atual.fim,
      diaInteiro: mudanca.diaInteiro ?? atual.dia_inteiro === 1,
      local: mudanca.local === undefined ? atual.local : mudanca.local,
      // A regra que já estava (vinda do Google) fica como veio; só a nova precisa ser entendida.
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
      if (destino) {
        this.deps.repo.mudarCalendarioDoEvento(atual.id, destino.id);
        if (atual.espelho === 1)
          this.deps.repo.enfileirarSaida(atual.id, "apagar", atual.id_externo !== null, agora);
        if (destino.espelho === 1) this.deps.repo.enfileirarSaida(atual.id, "criar", false, agora);
      } else if (atual.espelho === 1) {
        this.deps.repo.enfileirarSaida(atual.id, "mudar", atual.id_externo !== null, agora);
      }
    });
    return this.avisar(this.exigir(atual.id));
  }

  /** Manda à lixeira e devolve o que foi. A tarefa do encaixe continua ligada: volta junto se ele voltar. */
  apagarEvento(pedido: PedidoEvento, carimbo: Carimbo = DO_USUARIO): Apagados {
    const atual = this.exigir(pedido.id);
    if (atual.editavel !== 1) throw new Error(MENSAGEM_SO_LEITURA);
    const agora = this.agora().toISOString();
    this.deps.repo.transacao(() => {
      this.deps.repo.apagarEvento(atual.id, agora, carimbo);
      if (atual.espelho === 1)
        this.deps.repo.enfileirarSaida(atual.id, "apagar", atual.id_externo !== null, agora);
    });
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
   * na versão em que a chamada o deixou (a leitura do Google também conta como mudança). O do
   * "Moductus" leva a volta ao Google pela fila, como qualquer escrita.
   */
  desfazerEvento(
    alvo: { eventoId: string; versao: string; antes: CamposEvento | null },
    ctx: ContextoDesfazer,
  ): void {
    const evento = this.deps.repo.evento(alvo.eventoId);
    if (!evento) throw new RecusaDesfazer(MENSAGEM_DESFAZER_SAIU);
    if (evento.atualizado_em !== alvo.versao) throw new RecusaDesfazer(MENSAGEM_DESFAZER_MUDOU);
    const agora = this.agora().toISOString();
    if (alvo.antes === null) {
      this.deps.repo.apagarEvento(evento.id, agora, ctx.carimbo);
      if (evento.espelho === 1)
        this.deps.repo.enfileirarSaida(evento.id, "apagar", evento.id_externo !== null, agora);
    } else {
      this.deps.repo.mudarEvento(evento.id, alvo.antes, agora, ctx.carimbo);
      if (evento.espelho === 1)
        this.deps.repo.enfileirarSaida(evento.id, "mudar", evento.id_externo !== null, agora);
    }
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

/**
 * A regra que o evento escrito por aqui leva: só a que o Moductus sabe repetir, porque ninguém
 * mais vai expandi-la. A do Google fica como veio, na leitura (F3-23).
 */
function regraQueSeRepete(recorrencia: string | null): string | null {
  if (recorrencia === null) return null;
  const leitura = lerRecorrencia(recorrencia);
  if (!leitura.entendida) throw new Error(MENSAGEM_REGRA_DE_FORA(leitura.motivo));
  return recorrencia.trim();
}
