import {
  LISTA_ENTRADA,
  LISTAS_PADRAO,
  type Apagados,
  type ConclusaoTarefa,
  type Etiqueta,
  type Lembrete,
  type Lista,
  type MudancaLembretes,
  type MudancaLista,
  type MudancaTarefa,
  type MudancaTarefas,
  type NovaLista,
  type NovaTarefa,
  type PedidoAdiarTarefas,
  type PedidoLista,
  type PedidoMoverTarefa,
  type PedidoOrdenar,
  type PedidoTarefa,
  type PedidoTarefas,
  type Tarefa,
} from "@moductus/contrato";
import { nomeChave } from "../../banco/nome-chave.ts";
import { DO_USUARIO, type Carimbo } from "../../banco/tabela.ts";
import { novoId } from "../../banco/ulid.ts";
import { diasNoIntervalo, escreverRecorrencia, lerRecorrencia, proximoDia } from "../dia/recorrencia.ts";
import { MENSAGEM_NOTA_DA_TAREFA } from "../notas/notas.ts";
import { diasEntre, ehDia, instanteNoFuso, noFuso, somarDias, TempoDoDia } from "../dia/tempo.ts";
import {
  RepositorioTarefas,
  type CamposTarefa,
  type FiltroTarefas,
  type LinhaLembrete,
  type LinhaLista,
  type LinhaTarefa,
} from "./repositorio.ts";

/**
 * Tarefas (PRODUCT.md §5 "Tarefas", DATA.md §2): listas, tarefas com subtarefa de um nível,
 * etiquetas e lixeira. A regra mora aqui, para a tela, a captura e as ferramentas da Alba fazerem
 * a mesma coisa:
 *
 * - **Recorrente:** concluir (ou descartar) gera a próxima, no primeiro dia da regra a partir de
 *   hoje; o `COUNT` desconta as ocorrências que ficaram para trás.
 * - **Lembrete:** a tarefa aberta com hora tem um lembrete ligado, 15 min antes por padrão, que
 *   acompanha o título, o dia e a hora dela. `lembreteMinutosAntes: null` tira. Fechar a tarefa
 *   manda o lembrete à lixeira, carimbado com o instante do fechamento; reabrir o traz de volta.
 * - **Atrasadas:** a aberta de antes de hoje não muda de dia sozinha. Ela vem em
 *   `vista: "atrasadas"` com o dia em que vencia (é a marca: "veio de ontem"), e o Hoje mostra as
 *   duas vistas. Trazer para hoje é o `adiar` para `hoje`, do briefing ou da tela.
 * - **Listas padrão:** Entrada, Trabalho e Pessoal não vão à lixeira, e a Entrada, para onde vai a
 *   captura, também não se arquiva.
 */

export const MINUTOS_ANTES_PADRAO = 15;

/**
 * Quantos ids um pedido de ordenar ou adiar leva: entrada enorme não prende o serviço, que é uma
 * linha só. Com 5000, adiar com hora (um lembrete por tarefa) passava de meio segundo.
 */
export const LIMITE_IDS = 1000;

/** Erro com texto para quem usa; o que não for daqui sai pelo canal como erro genérico. */
export class ErroDasTarefas extends Error {}

export const MENSAGEM_TAREFA_NAO_ENCONTRADA = "tarefa não encontrada";
export const MENSAGEM_LISTA_NAO_ENCONTRADA = "lista não encontrada";
export const MENSAGEM_ETIQUETA_NAO_ENCONTRADA = "etiqueta não encontrada";
export const MENSAGEM_LISTA_PADRAO = "as listas Entrada, Trabalho e Pessoal não vão para a lixeira";
export const MENSAGEM_ENTRADA_ARQUIVADA = "a Entrada não se arquiva: é para onde vai a captura";
export const MENSAGEM_UM_NIVEL = "subtarefa só tem um nível";
export const MENSAGEM_ELA_MESMA = "a tarefa não pode ser subtarefa dela mesma";
export const MENSAGEM_MAE_FECHADA = "a tarefa mãe já está fechada";
export const MENSAGEM_LISTA_DA_MAE = "a subtarefa fica na lista da tarefa mãe";
export const MENSAGEM_HORA_SEM_DIA = "hora só com o dia";
export const MENSAGEM_LEMBRETE_SEM_HORA = "lembrete só em tarefa com hora";
export const MENSAGEM_DIA_INVALIDO = "data que não existe no calendário";
export const MENSAGEM_LEMBRETE_FORA = "o lembrete cairia antes do começo do calendário";
export const MENSAGEM_ETIQUETA_REPETIDA = "já existe uma etiqueta com esse nome";
/** Como o nome da etiqueta na entrada do contrato (`NovaTarefa.etiquetas`). */
const TAMANHO_ETIQUETA = 60;
export const MENSAGEM_ETIQUETA_NOME = `a etiqueta tem de 1 a ${TAMANHO_ETIQUETA} caracteres`;
export const MENSAGEM_IDS_REPETIDOS = "o mesmo id veio mais de uma vez";
export const MENSAGEM_IDS_DEMAIS = `um pedido leva no máximo ${LIMITE_IDS} ids`;

export interface AvisosTarefas {
  /** As tarefas que mudaram e as que foram para a lixeira (`tarefas.mudou`). */
  tarefas: (mudanca: MudancaTarefas) => void;
  /** Todas as listas vivas, a cada mudança numa delas (`listas.mudou`). */
  listas: (listas: Lista[]) => void;
  /** O lembrete que a tarefa criou, mudou ou levou junto (`lembretes.mudou`). */
  lembretes: (mudanca: MudancaLembretes) => void;
}

export interface DependenciasTarefas {
  /** O fuso de `config` (`dia.fuso`), lido a cada pergunta. */
  lerFuso: () => string;
  /** A nota de onde a tarefa nasce (`tarefas.nota_id`): só nota viva. */
  notas: { notaParaTarefa(notaId: string | null | undefined): string | null };
}

export interface OpcoesTarefas {
  agora?: () => Date;
  gerarId?: () => string;
}

/** O que o lembrete da tarefa deve virar: minutos antes, nenhum, ou ficar como está. */
type Desejo = number | null | "intocado";

/** O que uma operação mexeu, para avisar as janelas depois de gravar. */
interface Registro {
  tarefas: Set<string>;
  apagadas: Set<string>;
  lembretes: Set<string>;
  lembretesRemovidos: Set<string>;
  /** O `quando` de antes dos lembretes que mudaram de horário: o aviso da ocorrência trocada sai. */
  lembretesAnteriores: Map<string, string>;
  listas: boolean;
}

const paraLista = (l: LinhaLista): Lista => ({
  id: l.id,
  nome: l.nome,
  ordem: l.ordem,
  cor: l.cor,
  arquivada: l.arquivada === 1,
});

const paraLembrete = (l: LinhaLembrete): Lembrete => ({
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

const camposDe = (t: LinhaTarefa): CamposTarefa => ({
  lista_id: t.lista_id,
  tarefa_pai_id: t.tarefa_pai_id,
  titulo: t.titulo,
  notas: t.notas,
  nota_id: t.nota_id,
  prioridade: t.prioridade,
  vence_em: t.vence_em,
  hora: t.hora,
  duracao_estimada_min: t.duracao_estimada_min,
  recorrencia: t.recorrencia,
  estado: t.estado,
  concluida_em: t.concluida_em,
  ordem: t.ordem,
  fechada_em: t.fechada_em,
  gerada_por: t.gerada_por,
});

/** A tarefa como o lembrete a vê: dia, hora, título e se está aberta. */
type BaseDoLembrete = Pick<LinhaTarefa, "id" | "titulo" | "vence_em" | "hora" | "estado" | "fechada_em">;

/**
 * A próxima de uma recorrente: o primeiro dia da regra depois do dia dela que não fique para trás
 * de hoje (a atrasada concluída hoje volta hoje, a de hoje volta no próximo). Com `COUNT`, a regra
 * da próxima conta só o que sobra. `null` quando a regra acabou ou o Moductus não a expande.
 *
 * O `UNTIL` com hora vale pelo instante: com `Z`, lido no fuso; a tarefa com hora passa dele se a
 * hora dela no dia passa, a sem hora, se o dia passa.
 */
export function proximaOcorrencia(
  recorrencia: string,
  venceEm: string | null,
  hoje: string,
  quando: { hora: string | null; fuso: string } = { hora: null, fuso: "UTC" },
): { dia: string; recorrencia: string } | null {
  const leitura = lerRecorrencia(recorrencia);
  if (!leitura.entendida) return null;
  // Dia que não existe (vindo de outro PC) conta como sem dia.
  const inicio = venceEm !== null && ehDia(venceEm) ? venceEm : hoje;
  // Não fica para trás de hoje: depois de ontem, ou do próprio início se ele não é de antes de hoje.
  const depoisDe = inicio >= hoje ? inicio : somarDias(hoje, -1);
  const dia = proximoDia(recorrencia, inicio, depoisDe);
  if (dia === null) return null;
  const ate = leitura.regra.ate;
  if (ate !== null && ate.hora !== null) {
    const limite = ate.utc ? noFuso(new Date(`${ate.dia}T${ate.hora}Z`), quando.fuso) : null;
    const limiteDia = limite?.dia ?? ate.dia;
    const limiteHora =
      limite === null ? ate.hora : `${limite.hora}:${String(limite.segundo).padStart(2, "0")}`;
    const passou =
      quando.hora === null ? dia > limiteDia : `${dia}T${quando.hora}:00` > `${limiteDia}T${limiteHora}`;
    if (passou) return null;
  }
  if (leitura.regra.contagem === null) return { dia, recorrencia };
  // As ocorrências do início até a próxima, as duas inclusive: as de antes dela já foram.
  const passadas = diasNoIntervalo(recorrencia, inicio, inicio, dia).ocorrencias.length - 1;
  const restantes = leitura.regra.contagem - passadas;
  if (restantes < 1) return null;
  return { dia, recorrencia: escreverRecorrencia({ ...leitura.regra, contagem: restantes }) };
}

export class ServicoTarefas {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly tempo: TempoDoDia;
  /** O último instante gravado, em ms: cada operação grava um instante maior que o da anterior. */
  private ultimoInstante = 0;
  /** O fuso e os instantes já calculados na operação em curso (um pedido de milhares repete a conta). */
  private daVez: { fuso: string; instantes: Map<string, number> } | null = null;

  constructor(
    private readonly repo: RepositorioTarefas,
    private readonly deps: DependenciasTarefas,
    private readonly avisos: AvisosTarefas,
    opcoes: OpcoesTarefas = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    // Durante uma operação o fuso é lido uma vez só (no serviço, cada leitura vai ao banco).
    this.tempo = new TempoDoDia(() => this.daVez?.fuso ?? deps.lerFuso(), this.agora);
  }

  // Listas

  listas(): Lista[] {
    return this.repo.listas().map(paraLista);
  }

  criarLista(nova: NovaLista, carimbo: Carimbo = DO_USUARIO): Lista {
    return this.operar((r, agora) => {
      const id = this.gerarId();
      this.repo.criarLista(
        { id, nome: nova.nome, cor: nova.cor ?? null, ordem: this.repo.proximaOrdemDeLista() },
        agora,
        carimbo,
      );
      r.listas = true;
      return paraLista(this.exigirLista(id));
    });
  }

  definirLista(mudanca: MudancaLista, carimbo: Carimbo = DO_USUARIO): Lista {
    return this.operar((r, agora) => {
      const atual = this.exigirLista(mudanca.id);
      if (atual.id === LISTA_ENTRADA && mudanca.arquivada === true) {
        throw new ErroDasTarefas(MENSAGEM_ENTRADA_ARQUIVADA);
      }
      const campos = {
        nome: mudanca.nome ?? atual.nome,
        cor: mudanca.cor === undefined ? atual.cor : mudanca.cor,
        arquivada: mudanca.arquivada ?? atual.arquivada === 1,
        ordem: atual.ordem,
      };
      const igual =
        campos.nome === atual.nome &&
        campos.cor === atual.cor &&
        campos.arquivada === (atual.arquivada === 1);
      if (igual) return paraLista(atual);
      this.repo.definirLista(atual.id, campos, agora, carimbo);
      r.listas = true;
      return paraLista(this.exigirLista(atual.id));
    });
  }

  /** A nova ordem das listas dadas; as outras ficam onde estavam. Volta todas. */
  ordenarListas(pedido: PedidoOrdenar, carimbo: Carimbo = DO_USUARIO): Lista[] {
    const ids = idsDoPedido(pedido.ids);
    return this.operar((r, agora) => {
      const vivas = new Map(this.repo.listas().map((l) => [l.id, l]));
      const listas = ids.map((id) => {
        const l = vivas.get(id);
        if (l === undefined) throw new ErroDasTarefas(MENSAGEM_LISTA_NAO_ENCONTRADA);
        return l;
      });
      listas.forEach((l, ordem) => {
        if (l.ordem === ordem) return;
        this.repo.definirLista(
          l.id,
          { nome: l.nome, cor: l.cor, arquivada: l.arquivada === 1, ordem },
          agora,
          carimbo,
        );
        r.listas = true;
      });
      return this.listas();
    });
  }

  /** Manda a lista à lixeira com as tarefas dela e os lembretes delas. Volta as listas que ficam. */
  apagarLista(pedido: PedidoLista, carimbo: Carimbo = DO_USUARIO): Lista[] {
    if ((LISTAS_PADRAO as readonly string[]).includes(pedido.id)) {
      throw new ErroDasTarefas(MENSAGEM_LISTA_PADRAO);
    }
    return this.operar((r, agora) => {
      const lista = this.exigirLista(pedido.id);
      const tarefas = this.repo.idsDaLista(lista.id);
      this.mandarParaLixeira(tarefas, r, agora, carimbo);
      this.repo.apagarLista(lista.id, agora, carimbo);
      r.listas = true;
      return this.listas();
    });
  }

  // Tarefas

  /**
   * O recorte pedido. "Hoje" é o dia no fuso de `config`: as abertas de hoje e as feitas hoje (de
   * qualquer dia). As subtarefas das que entram vêm junto, em todos os estados, para a tela contar
   * "1 de 3".
   */
  listar(pedido: PedidoTarefas): Tarefa[] {
    const hoje = this.tempo.hoje();
    const filtro: FiltroTarefas = {
      estados: pedido.todas === true ? undefined : ["aberta"],
      listaId: pedido.listaId,
      etiquetaId: pedido.etiquetaId,
      notaId: pedido.notaId,
    };
    switch (pedido.vista) {
      case "hoje":
        filtro.dia = { op: "=", dia: hoje };
        filtro.feitasEntre = {
          de: this.tempo.inicioDoDia(hoje).toISOString(),
          // O amanhã do mesmo hoje: ler o relógio de novo poderia cair depois da meia-noite.
          ate: this.tempo.inicioDoDia(somarDias(hoje, 1)).toISOString(),
        };
        break;
      case "atrasadas":
        filtro.dia = { op: "<", dia: hoje };
        break;
      case "semData":
        filtro.dia = { op: "sem" };
        break;
      case "proximas":
        filtro.dia = { op: ">", dia: hoje };
        break;
      case undefined:
        break;
    }
    const linhas = this.repo.buscar(filtro);
    const vistas = new Set(linhas.map((l) => l.id));
    const maes = linhas.filter((l) => l.tarefa_pai_id === null).map((l) => l.id);
    const filhas = this.repo.subtarefas(maes).filter((l) => !vistas.has(l.id));
    return this.paraTarefas([...linhas, ...filhas]);
  }

  /**
   * As pendentes de hoje, a contagem da área (`areas.contagens`): as abertas de hoje e as
   * atrasadas, que o Hoje mostra junto. Subtarefa com dia conta como as outras.
   */
  pendentesDeHoje(): number {
    return this.repo.contarAbertasAte(this.tempo.hoje());
  }

  obter(pedido: PedidoTarefa): Tarefa {
    return this.paraTarefa(this.exigir(pedido.id));
  }

  /** Sem lista, vai para a Entrada; subtarefa fica na lista da mãe. */
  criar(nova: NovaTarefa, carimbo: Carimbo = DO_USUARIO): Tarefa {
    return this.operar((r, agora) => {
      const mae = nova.tarefaPaiId == null ? null : this.exigirMae(nova.tarefaPaiId, null);
      if (mae !== null && nova.listaId !== undefined && nova.listaId !== mae.lista_id) {
        throw new ErroDasTarefas(MENSAGEM_LISTA_DA_MAE);
      }
      const listaId = mae?.lista_id ?? nova.listaId ?? LISTA_ENTRADA;
      this.exigirLista(listaId);
      const campos: CamposTarefa = {
        lista_id: listaId,
        tarefa_pai_id: mae?.id ?? null,
        titulo: nova.titulo,
        notas: nova.notas ?? null,
        nota_id: this.notaDaTarefa(nova.notaId),
        prioridade: nova.prioridade ?? 0,
        vence_em: nova.venceEm ?? null,
        hora: nova.hora ?? null,
        duracao_estimada_min: nova.duracaoEstimadaMin ?? null,
        recorrencia: nova.recorrencia ?? null,
        estado: "aberta",
        concluida_em: null,
        ordem: this.repo.proximaOrdemDeTarefa(listaId, mae?.id ?? null),
        fechada_em: null,
        gerada_por: null,
      };
      conferirDiaEHora(campos, nova.lembreteMinutosAntes);
      const id = this.gerarId();
      this.repo.criarTarefa(id, campos, agora, carimbo);
      if (nova.etiquetas !== undefined) this.ligarEtiquetas(id, nova.etiquetas, agora, carimbo);
      const desejo = desejoDoLembrete(null, campos, nova.lembreteMinutosAntes, null, null);
      this.ajustarLembrete({ id, ...campos }, null, desejo, r, agora, carimbo);
      r.tarefas.add(id);
      return this.paraTarefa(this.exigir(id));
    });
  }

  /** Só o que vem muda; `null` limpa. Sem o dia, a hora sai junto. */
  definir(mudanca: MudancaTarefa, carimbo: Carimbo = DO_USUARIO): Tarefa {
    return this.operar((r, agora) => {
      const atual = this.exigir(mudanca.id);
      const campos = camposDe(atual);
      if (mudanca.titulo !== undefined) campos.titulo = mudanca.titulo;
      if (mudanca.notas !== undefined) campos.notas = mudanca.notas;
      if (mudanca.notaId !== undefined) campos.nota_id = this.notaDaTarefa(mudanca.notaId);
      if (mudanca.prioridade !== undefined) campos.prioridade = mudanca.prioridade;
      if (mudanca.venceEm !== undefined) {
        campos.vence_em = mudanca.venceEm;
        if (mudanca.venceEm === null) campos.hora = null;
      }
      if (mudanca.hora !== undefined) campos.hora = mudanca.hora;
      if (mudanca.duracaoEstimadaMin !== undefined) campos.duracao_estimada_min = mudanca.duracaoEstimadaMin;
      if (mudanca.recorrencia !== undefined) campos.recorrencia = mudanca.recorrencia;
      conferirDiaEHora(campos, mudanca.lembreteMinutosAntes);
      if (mudanca.etiquetas !== undefined) this.ligarEtiquetas(atual.id, mudanca.etiquetas, agora, carimbo);
      this.gravar(atual, campos, mudanca.lembreteMinutosAntes, r, agora, carimbo);
      return this.paraTarefa(this.exigir(atual.id));
    });
  }

  /**
   * Conclui a tarefa e as subtarefas abertas dela. A recorrente gera a próxima (com as subtarefas
   * de novo abertas), que volta junto. Concluir a já feita não muda nada.
   */
  concluir(pedido: PedidoTarefa, carimbo: Carimbo = DO_USUARIO): ConclusaoTarefa {
    return this.operar((r, agora) => {
      const atual = this.exigir(pedido.id);
      if (atual.estado === "feita") return { tarefa: this.paraTarefa(atual), proxima: null };
      const proxima = this.fechar(atual, "feita", r, agora, carimbo);
      return {
        tarefa: this.paraTarefa(this.exigir(atual.id)),
        proxima: proxima === null ? null : this.paraTarefa(this.exigir(proxima)),
      };
    });
  }

  /**
   * "Descartar": fica cancelada, fora das abertas, com as subtarefas abertas. Na recorrente, descarta
   * só esta vez: a próxima nasce como no concluir e sai no aviso.
   */
  cancelar(pedido: PedidoTarefa, carimbo: Carimbo = DO_USUARIO): Tarefa {
    return this.operar((r, agora) => {
      const atual = this.exigir(pedido.id);
      if (atual.estado === "cancelada") return this.paraTarefa(atual);
      this.fechar(atual, "cancelada", r, agora, carimbo);
      return this.paraTarefa(this.exigir(atual.id));
    });
  }

  /** Volta a aberta, com o lembrete que tinha. Subtarefa de mãe fechada reabre a mãe também. */
  reabrir(pedido: PedidoTarefa, carimbo: Carimbo = DO_USUARIO): Tarefa {
    return this.operar((r, agora) => {
      const atual = this.exigir(pedido.id);
      if (atual.estado === "aberta") return this.paraTarefa(atual);
      if (atual.tarefa_pai_id !== null) {
        const mae = this.repo.tarefa(atual.tarefa_pai_id);
        if (mae !== null && mae.estado !== "aberta") this.abrir(mae, r, agora, carimbo);
      }
      this.abrir(atual, r, agora, carimbo);
      return this.paraTarefa(this.exigir(atual.id));
    });
  }

  /** Muda o dia (e a hora, se vier) de várias; o lembrete acompanha. */
  adiar(pedido: PedidoAdiarTarefas, carimbo: Carimbo = DO_USUARIO): Tarefa[] {
    const ids = idsDoPedido(pedido.ids);
    return this.operar((r, agora) => {
      const dia =
        pedido.para === "hoje"
          ? this.tempo.hoje()
          : pedido.para === "amanha"
            ? this.tempo.amanha()
            : pedido.para;
      for (const atual of this.exigirVarias(ids)) {
        const campos = { ...camposDe(atual), vence_em: dia };
        if (pedido.hora !== undefined) campos.hora = pedido.hora;
        conferirDiaEHora(campos, undefined);
        this.gravar(atual, campos, undefined, r, agora, carimbo);
      }
      return this.paraTarefas(this.exigirVarias(ids));
    });
  }

  /**
   * Outra lista ou outra mãe. A mãe que muda de lista leva as subtarefas; a subtarefa que vai para
   * outra lista sem mãe nova volta a ser tarefa. Fica por último entre as novas irmãs.
   */
  mover(pedido: PedidoMoverTarefa, carimbo: Carimbo = DO_USUARIO): Tarefa {
    return this.operar((r, agora) => {
      const atual = this.exigir(pedido.id);
      const filhas = this.repo.subtarefas([atual.id]);
      let paiId = pedido.tarefaPaiId === undefined ? atual.tarefa_pai_id : pedido.tarefaPaiId;
      let listaId = pedido.listaId ?? atual.lista_id;
      if (pedido.tarefaPaiId === undefined && paiId !== null && pedido.listaId !== undefined) {
        const maeAtual = this.repo.tarefa(paiId);
        if (maeAtual === null || maeAtual.lista_id !== pedido.listaId) paiId = null;
      }
      if (paiId !== null) {
        // A mãe nova passa pela conferência; a que já era continua valendo mesmo fechada.
        const mae = paiId === atual.tarefa_pai_id ? this.repo.tarefa(paiId) : this.novaMae(paiId, atual);
        if (mae !== null) {
          if (pedido.listaId !== undefined && pedido.listaId !== mae.lista_id) {
            throw new ErroDasTarefas(MENSAGEM_LISTA_DA_MAE);
          }
          listaId = mae.lista_id;
        }
      }
      this.exigirLista(listaId);
      if (listaId === atual.lista_id && paiId === atual.tarefa_pai_id) return this.paraTarefa(atual);
      const campos = {
        ...camposDe(atual),
        lista_id: listaId,
        tarefa_pai_id: paiId,
        ordem: this.repo.proximaOrdemDeTarefa(listaId, paiId),
      };
      this.gravar(atual, campos, undefined, r, agora, carimbo);
      if (listaId !== atual.lista_id) {
        for (const filha of filhas) {
          this.gravar(filha, { ...camposDe(filha), lista_id: listaId }, undefined, r, agora, carimbo);
        }
      }
      return this.paraTarefa(this.exigir(atual.id));
    });
  }

  /** A nova ordem das tarefas dadas, na ordem em que vêm. */
  ordenar(pedido: PedidoOrdenar, carimbo: Carimbo = DO_USUARIO): Tarefa[] {
    const ids = idsDoPedido(pedido.ids);
    return this.operar((r, agora) => {
      // Só a posição muda: o lembrete e o fechamento não dependem dela.
      this.exigirVarias(ids).forEach((atual, ordem) => {
        if (atual.ordem === ordem) return;
        this.repo.ordemDaTarefa(atual.id, ordem, agora, carimbo);
        r.tarefas.add(atual.id);
      });
      return this.paraTarefas(this.exigirVarias(ids));
    });
  }

  /** Manda à lixeira com as subtarefas e os lembretes; volta o que foi. */
  apagar(pedido: PedidoTarefa, carimbo: Carimbo = DO_USUARIO): Apagados {
    return this.operar((r, agora) => {
      const atual = this.exigir(pedido.id);
      const ids = [atual.id, ...this.repo.subtarefas([atual.id]).map((f) => f.id)];
      this.mandarParaLixeira(ids, r, agora, carimbo);
      return { ids };
    });
  }

  // Etiquetas

  etiquetas(): Etiqueta[] {
    return this.repo.etiquetas();
  }

  /** O nome novo vale em toda tarefa que a leva; não pode bater com outra etiqueta viva. */
  renomearEtiqueta(pedido: { id: string; nome: string }, carimbo: Carimbo = DO_USUARIO): Etiqueta {
    return this.operar((r, agora) => {
      const atual = this.repo.etiqueta(pedido.id);
      if (atual === null) throw new ErroDasTarefas(MENSAGEM_ETIQUETA_NAO_ENCONTRADA);
      const nome = pedido.nome.normalize("NFC").trim();
      if (nome === "" || nome.length > TAMANHO_ETIQUETA) throw new ErroDasTarefas(MENSAGEM_ETIQUETA_NOME);
      const chave = nomeChave(nome);
      const outra = this.repo.etiquetaPelaChave(chave);
      if (outra !== null && outra.id !== atual.id) throw new ErroDasTarefas(MENSAGEM_ETIQUETA_REPETIDA);
      if (nome === atual.nome) return atual;
      this.repo.renomearEtiqueta(atual.id, nome, chave, agora, carimbo);
      for (const id of this.repo.idsComEtiqueta(atual.id)) r.tarefas.add(id);
      return { id: atual.id, nome };
    });
  }

  /** Manda a etiqueta à lixeira; as tarefas deixam de mostrá-la. */
  apagarEtiqueta(pedido: { id: string }, carimbo: Carimbo = DO_USUARIO): Apagados {
    return this.operar((r, agora) => {
      const atual = this.repo.etiqueta(pedido.id);
      if (atual === null) throw new ErroDasTarefas(MENSAGEM_ETIQUETA_NAO_ENCONTRADA);
      for (const id of this.repo.idsComEtiqueta(atual.id)) r.tarefas.add(id);
      this.repo.apagarEtiqueta(atual.id, agora, carimbo);
      return { ids: [atual.id] };
    });
  }

  // Por dentro

  /** Roda numa transação e, depois de gravar, avisa as janelas do que mudou. */
  private operar<T>(fazer: (r: Registro, agora: string) => T): T {
    const r: Registro = {
      tarefas: new Set(),
      apagadas: new Set(),
      lembretes: new Set(),
      lembretesRemovidos: new Set(),
      lembretesAnteriores: new Map(),
      listas: false,
    };
    // Sempre crescente, mesmo duas operações no mesmo milissegundo ou com o relógio voltando: a marca
    // do fechamento é comparada por igualdade, e um instante repetido traria de volta o que não deve.
    const ms = Math.max(this.agora().getTime(), this.ultimoInstante + 1);
    this.ultimoInstante = ms;
    const agora = new Date(ms).toISOString();
    this.daVez = { fuso: this.deps.lerFuso(), instantes: new Map() };
    try {
      const resultado = this.repo.transacao(() => fazer(r, agora));
      this.avisar(r);
      return resultado;
    } finally {
      this.daVez = null;
    }
  }

  private avisar(r: Registro): void {
    if (r.listas) this.avisos.listas(this.listas());
    const mudadas = [...r.tarefas].filter((id) => !r.apagadas.has(id));
    if (mudadas.length > 0 || r.apagadas.size > 0) {
      this.avisos.tarefas({
        tarefas: this.paraTarefas(this.repo.tarefasDosIds(mudadas)),
        apagadas: [...r.apagadas],
      });
    }
    const lembretes = [...r.lembretes].filter((id) => !r.lembretesRemovidos.has(id));
    if (lembretes.length > 0 || r.lembretesRemovidos.size > 0) {
      const vivos = this.repo.lembretesDosIds(lembretes);
      const anteriores = [...r.lembretesAnteriores]
        .filter(([id]) => !r.lembretesRemovidos.has(id))
        .map(([id, quando]) => ({ id, quando }));
      this.avisos.lembretes({
        lembretes: vivos.map(paraLembrete),
        removidos: [...r.lembretesRemovidos],
        ...(anteriores.length > 0 ? { anteriores } : {}),
      });
    }
  }

  /**
   * Grava a tarefa e cuida do lembrete dela. Fechar marca a tarefa (`fechada_em`) e manda os
   * lembretes à lixeira com o mesmo instante; reabrir traz de volta os que têm a marca. Enquanto a
   * tarefa está fechada a marca não muda, venha a escrita daqui ou de outra área.
   */
  private gravar(
    antes: LinhaTarefa,
    campos: CamposTarefa,
    minutosPedidos: number | null | undefined,
    r: Registro,
    agora: string,
    carimbo: Carimbo,
  ): void {
    const fechadaAntes = antes.estado !== "aberta";
    const fechadaDepois = campos.estado !== "aberta";
    const alvo = this.lembreteProprio(antes);
    const marca = !fechadaDepois ? null : fechadaAntes ? (antes.fechada_em ?? agora) : agora;
    const gravados: CamposTarefa = { ...campos, fechada_em: marca };
    this.repo.gravarTarefa(antes.id, gravados, agora, carimbo);
    r.tarefas.add(antes.id);
    if (!fechadaAntes && fechadaDepois) {
      const ids = this.repo.idsDosLembretes([antes.id]);
      this.repo.apagarLembretes(ids, agora, carimbo);
      ids.forEach((id) => r.lembretesRemovidos.add(id));
      return;
    }
    if (fechadaAntes && !fechadaDepois) {
      if (antes.fechada_em === null) return;
      const ids = this.repo.idsDosLembretesApagadosEm(antes.id, antes.fechada_em);
      this.repo.restaurarLembretes(ids, agora, carimbo);
      ids.forEach((id) => r.lembretes.add(id));
      return;
    }
    const minutosAtuais = alvo === null ? null : this.minutosAntes(antes, alvo);
    const desejo = desejoDoLembrete(antes, campos, minutosPedidos, alvo, minutosAtuais);
    // O lembrete que a tarefa fechada perde fica sem a marca: o reabrir não o traz.
    if (fechadaAntes && desejo === null && alvo !== null) {
      this.repo.marcarLembretesApagados([alvo.id], agora, agora);
    }
    this.ajustarLembrete({ id: antes.id, ...gravados }, alvo, desejo, r, agora, carimbo);
  }

  /**
   * Põe o lembrete como o desejo manda: cria, muda o horário (volta a agendado), muda só o texto ou
   * tira. O da tarefa fechada fica na lixeira, com a marca do fechamento dela.
   */
  private ajustarLembrete(
    tarefa: BaseDoLembrete,
    alvo: LinhaLembrete | null,
    desejo: Desejo,
    r: Registro,
    agora: string,
    carimbo: Carimbo,
  ): void {
    const fechada = tarefa.estado !== "aberta";
    if (desejo === "intocado") {
      if (alvo === null || alvo.texto === tarefa.titulo) return;
      this.repo.textoDoLembrete(alvo.id, tarefa.titulo, agora, carimbo);
      if (!fechada) r.lembretes.add(alvo.id);
      return;
    }
    if (desejo === null || tarefa.vence_em === null || tarefa.hora === null) {
      if (alvo !== null && !fechada) {
        this.repo.apagarLembretes([alvo.id], agora, carimbo);
        r.lembretesRemovidos.add(alvo.id);
      }
      return;
    }
    const quando = this.quandoToca(tarefa.vence_em, tarefa.hora, desejo);
    if (alvo === null) {
      const id = this.gerarId();
      this.repo.criarLembrete({ id, texto: tarefa.titulo, quando, tarefaId: tarefa.id }, agora, carimbo);
      if (fechada) this.repo.marcarLembretesApagados([id], tarefa.fechada_em ?? agora, agora);
      else r.lembretes.add(id);
      return;
    }
    if (alvo.quando !== quando) {
      // O primeiro horário da operação é o do aviso que pode estar na Central de Notificações.
      if (!r.lembretesAnteriores.has(alvo.id)) r.lembretesAnteriores.set(alvo.id, alvo.quando);
      this.repo.reagendarLembrete(alvo.id, tarefa.titulo, quando, agora, carimbo);
    } else if (alvo.texto !== tarefa.titulo)
      this.repo.textoDoLembrete(alvo.id, tarefa.titulo, agora, carimbo);
    else return;
    if (!fechada) r.lembretes.add(alvo.id);
  }

  /** O lembrete da tarefa: o vivo, se ela está aberta; o que foi com o fechamento, se fechada. */
  private lembreteProprio(t: LinhaTarefa): LinhaLembrete | null {
    if (t.estado === "aberta") return this.repo.lembretesDasTarefas([t.id]).get(t.id) ?? null;
    return t.fechada_em === null ? null : this.repo.lembreteApagadoEm(t.id, t.fechada_em);
  }

  /** Fecha a tarefa e as subtarefas abertas; a recorrente gera a próxima. Volta o id da próxima. */
  private fechar(
    atual: LinhaTarefa,
    estado: "feita" | "cancelada",
    r: Registro,
    agora: string,
    carimbo: Carimbo,
  ): string | null {
    // O que a próxima herda é lido antes de fechar: o lembrete da aberta é o vivo. Só a aberta gera,
    // e só se a próxima que ela já gerou não está viva (fechar, reabrir e fechar de novo não duplica).
    const filhas = this.repo.subtarefas([atual.id]);
    const gera =
      atual.recorrencia !== null && atual.estado === "aberta" && this.repo.geradaPor(atual.id) === null;
    const heranca = gera ? this.heranca(atual, filhas) : null;
    const concluidaEm = estado === "feita" ? agora : null;
    for (const filha of filhas) {
      if (filha.estado !== "aberta") continue;
      this.gravar(
        filha,
        { ...camposDe(filha), estado, concluida_em: concluidaEm },
        undefined,
        r,
        agora,
        carimbo,
      );
    }
    this.gravar(
      atual,
      { ...camposDe(atual), estado, concluida_em: concluidaEm },
      undefined,
      r,
      agora,
      carimbo,
    );
    return heranca === null ? null : this.criarProxima(atual, heranca, r, agora, carimbo);
  }

  private abrir(atual: LinhaTarefa, r: Registro, agora: string, carimbo: Carimbo): void {
    this.gravar(
      atual,
      { ...camposDe(atual), estado: "aberta", concluida_em: null },
      undefined,
      r,
      agora,
      carimbo,
    );
    this.levarProximaIntocada(atual, r, agora, carimbo);
  }

  /**
   * Reabrir a recorrente leva para a lixeira a próxima que ela gerou, se ninguém a tocou (aberta e
   * nunca escrita depois de nascer, nem as subtarefas). A que alguém mexeu fica.
   */
  private levarProximaIntocada(atual: LinhaTarefa, r: Registro, agora: string, carimbo: Carimbo): void {
    const proxima = this.repo.geradaPor(atual.id);
    if (proxima === null) return;
    const juntas = [proxima, ...this.repo.subtarefas([proxima.id])];
    if (!juntas.every((t) => t.estado === "aberta" && t.criado_em === t.atualizado_em)) return;
    this.mandarParaLixeira(
      juntas.map((t) => t.id),
      r,
      agora,
      carimbo,
    );
  }

  /** O lembrete e as etiquetas da tarefa e de cada subtarefa, para a próxima ocorrência. */
  private heranca(atual: LinhaTarefa, filhas: LinhaTarefa[]): Heranca {
    const etiquetas = this.repo.etiquetasDasTarefas([atual.id, ...filhas.map((f) => f.id)]);
    const minutos = (t: LinhaTarefa): number | null => {
      const alvo = this.lembreteProprio(t);
      return alvo === null ? null : this.minutosAntes(t, alvo);
    };
    return {
      minutos: minutos(atual),
      etiquetas: (etiquetas.get(atual.id) ?? []).map((e) => e.id),
      filhas: filhas.map((f) => ({
        linha: f,
        minutos: minutos(f),
        etiquetas: (etiquetas.get(f.id) ?? []).map((e) => e.id),
      })),
    };
  }

  /**
   * A próxima ocorrência: os mesmos campos no dia seguinte da regra, aberta e por último entre as
   * irmãs, ligada à de onde nasceu (`gerada_por`); o lembrete com os mesmos minutos, as etiquetas e
   * as subtarefas de novo abertas, com o dia de cada uma andando o mesmo tanto.
   */
  private criarProxima(
    atual: LinhaTarefa,
    heranca: Heranca,
    r: Registro,
    agora: string,
    carimbo: Carimbo,
  ): string | null {
    const venceEm = atual.vence_em !== null && ehDia(atual.vence_em) ? atual.vence_em : null;
    const proxima = proximaOcorrencia(atual.recorrencia!, venceEm, this.tempo.hoje(), {
      hora: venceEm === null ? null : atual.hora,
      fuso: this.tempo.fuso,
    });
    if (proxima === null) return null;
    const salto = venceEm === null ? 0 : diasEntre(venceEm, proxima.dia);
    const nova = (
      base: LinhaTarefa,
      paiId: string | null,
      geradaPor: string | null,
      venceEm: string | null,
      hora: string | null,
      recorrencia: string | null,
      minutos: number | null,
      etiquetas: string[],
    ): string => {
      const campos: CamposTarefa = {
        ...camposDe(base),
        tarefa_pai_id: paiId,
        vence_em: venceEm,
        hora,
        recorrencia,
        estado: "aberta",
        concluida_em: null,
        ordem: this.repo.proximaOrdemDeTarefa(base.lista_id, paiId),
        fechada_em: null,
        gerada_por: geradaPor,
      };
      const id = this.gerarId();
      this.repo.criarTarefa(id, campos, agora, carimbo);
      if (etiquetas.length > 0) this.repo.ligarEtiquetas(id, etiquetas, agora, this.gerarId);
      this.ajustarLembrete({ id, ...campos }, null, hora === null ? null : minutos, r, agora, carimbo);
      r.tarefas.add(id);
      return id;
    };
    const id = nova(
      atual,
      atual.tarefa_pai_id,
      atual.id,
      proxima.dia,
      atual.hora,
      proxima.recorrencia,
      heranca.minutos,
      heranca.etiquetas,
    );
    for (const filha of heranca.filhas) {
      const valido = filha.linha.vence_em !== null && ehDia(filha.linha.vence_em);
      const dia = valido ? diaQueAnda(filha.linha.vence_em!, salto) : null;
      nova(
        filha.linha,
        id,
        null,
        dia,
        dia === null ? null : filha.linha.hora,
        filha.linha.recorrencia,
        filha.minutos,
        filha.etiquetas,
      );
    }
    return id;
  }

  /** As tarefas, as subtarefas delas e os lembretes, tudo para a lixeira no mesmo instante. */
  private mandarParaLixeira(ids: readonly string[], r: Registro, agora: string, carimbo: Carimbo): void {
    const lembretes = this.repo.idsDosLembretes(ids);
    this.repo.apagarLembretes(lembretes, agora, carimbo);
    this.repo.apagarTarefas(ids, agora, carimbo);
    lembretes.forEach((id) => r.lembretesRemovidos.add(id));
    ids.forEach((id) => r.apagadas.add(id));
  }

  /** Troca as etiquetas pelas dos nomes; a que ainda não existe nasce, sem diferença de caixa. */
  private ligarEtiquetas(tarefaId: string, nomes: readonly string[], agora: string, carimbo: Carimbo): void {
    const ids: string[] = [];
    const chaves = new Set<string>();
    for (const bruto of nomes) {
      const nome = bruto.normalize("NFC").trim();
      if (nome === "" || nome.length > TAMANHO_ETIQUETA) throw new ErroDasTarefas(MENSAGEM_ETIQUETA_NOME);
      const chave = nomeChave(nome);
      if (chaves.has(chave)) continue;
      chaves.add(chave);
      const existente = this.repo.etiquetaPelaChave(chave);
      if (existente !== null) {
        ids.push(existente.id);
        continue;
      }
      const id = this.gerarId();
      this.repo.criarEtiqueta({ id, nome, chave }, agora, carimbo);
      ids.push(id);
    }
    this.repo.ligarEtiquetas(tarefaId, ids, agora, this.gerarId);
  }

  private quandoToca(dia: string, hora: string, minutos: number): string {
    const quando = new Date(this.instanteDe(dia, hora, this.tempo.fuso) - minutos * 60_000);
    if (quando.getUTCFullYear() < 1) throw new ErroDasTarefas(MENSAGEM_LEMBRETE_FORA);
    return quando.toISOString();
  }

  /**
   * Quantos minutos antes da hora da tarefa o lembrete toca; fora da faixa do contrato, ou com um
   * dia que não existe (vindo de outro PC), nenhum. A lista passa o fuso lido uma vez só.
   */
  private minutosAntes(t: BaseDoLembrete, lembrete: LinhaLembrete, fuso = this.tempo.fuso): number | null {
    if (t.vence_em === null || t.hora === null || !ehDia(t.vence_em)) return null;
    const hora = this.instanteDe(t.vence_em, t.hora, fuso);
    const minutos = (hora - Date.parse(lembrete.quando)) / 60_000;
    return Number.isInteger(minutos) && minutos >= 0 && minutos <= 40_320 ? minutos : null;
  }

  /** O instante (ms) de hora no dia, no fuso, guardado durante a operação. */
  private instanteDe(dia: string, hora: string, fuso: string): number {
    const chave = `${fuso} ${dia} ${hora}`;
    const guardado = this.daVez?.instantes.get(chave);
    if (guardado !== undefined) return guardado;
    const ms = instanteNoFuso(dia, hora, fuso).getTime();
    this.daVez?.instantes.set(chave, ms);
    return ms;
  }

  private paraTarefa(linha: LinhaTarefa): Tarefa {
    return this.paraTarefas([linha])[0]!;
  }

  private paraTarefas(linhas: readonly LinhaTarefa[]): Tarefa[] {
    const ids = linhas.map((l) => l.id);
    const etiquetas = this.repo.etiquetasDasTarefas(ids);
    const lembretes = this.repo.lembretesDasTarefas(ids);
    const dasFechadas = this.repo.lembretesDasFechadas(
      linhas.flatMap((l) =>
        l.estado !== "aberta" && l.fechada_em !== null ? [{ id: l.id, fechadaEm: l.fechada_em }] : [],
      ),
    );
    const fuso = this.tempo.fuso;
    return linhas.map((l) => {
      const lembrete = l.estado === "aberta" ? lembretes.get(l.id) : dasFechadas.get(l.id);
      // Dia que não existe (vindo de outro PC) sai como sem dia, e a hora junto: o contrato o recusaria.
      const diaValido = l.vence_em !== null && ehDia(l.vence_em);
      return {
        id: l.id,
        listaId: l.lista_id,
        tarefaPaiId: l.tarefa_pai_id,
        titulo: l.titulo,
        notas: l.notas,
        notaId: l.nota_id,
        prioridade: l.prioridade,
        venceEm: diaValido ? l.vence_em : null,
        hora: diaValido ? l.hora : null,
        duracaoEstimadaMin: l.duracao_estimada_min,
        recorrencia: l.recorrencia,
        estado: l.estado,
        concluidaEm: l.concluida_em,
        ordem: l.ordem,
        etiquetas: etiquetas.get(l.id) ?? [],
        lembreteMinutosAntes: lembrete == null ? null : this.minutosAntes(l, lembrete, fuso),
        origem: l.origem,
        agenteId: l.agente_id,
        execucaoId: l.execucao_id,
        criadoEm: l.criado_em,
        atualizadoEm: l.atualizado_em,
      };
    });
  }

  private exigir(id: string): LinhaTarefa {
    const t = this.repo.tarefa(id);
    if (t === null) throw new ErroDasTarefas(MENSAGEM_TAREFA_NAO_ENCONTRADA);
    return t;
  }

  /** As vivas dos ids, na ordem do pedido, numa leitura só; id que não existe recusa o pedido. */
  private exigirVarias(ids: readonly string[]): LinhaTarefa[] {
    const linhas = new Map(this.repo.tarefasDosIds(ids).map((l) => [l.id, l]));
    return ids.map((id) => {
      const linha = linhas.get(id);
      if (linha === undefined) throw new ErroDasTarefas(MENSAGEM_TAREFA_NAO_ENCONTRADA);
      return linha;
    });
  }

  private exigirLista(id: string): LinhaLista {
    const l = this.repo.lista(id);
    if (l === null) throw new ErroDasTarefas(MENSAGEM_LISTA_NAO_ENCONTRADA);
    return l;
  }

  /** A mãe para onde a tarefa vai: ela não pode ter subtarefas (um nível só). */
  private novaMae(paiId: string, tarefa: LinhaTarefa): LinhaTarefa {
    if (paiId === tarefa.id) throw new ErroDasTarefas(MENSAGEM_ELA_MESMA);
    // Conta as filhas da lixeira também, como o gatilho da 013: elas ainda podem voltar.
    if (this.repo.temFilhas(tarefa.id)) throw new ErroDasTarefas(MENSAGEM_UM_NIVEL);
    return this.exigirMae(paiId, tarefa.id);
  }

  /** A mãe de uma subtarefa: viva, aberta e ela mesma sem mãe. */
  private exigirMae(id: string, filhaId: string | null): LinhaTarefa {
    if (id === filhaId) throw new ErroDasTarefas(MENSAGEM_ELA_MESMA);
    const mae = this.exigir(id);
    if (mae.tarefa_pai_id !== null) throw new ErroDasTarefas(MENSAGEM_UM_NIVEL);
    if (mae.estado !== "aberta") throw new ErroDasTarefas(MENSAGEM_MAE_FECHADA);
    return mae;
  }

  private notaDaTarefa(notaId: string | null | undefined): string | null {
    try {
      return this.deps.notas.notaParaTarefa(notaId);
    } catch (erro) {
      // Só a recusa da regra das Notas vai à janela como veio; o resto é erro de dentro.
      if (erro instanceof Error && erro.message === MENSAGEM_NOTA_DA_TAREFA) {
        throw new ErroDasTarefas(erro.message, { cause: erro });
      }
      throw erro;
    }
  }
}

interface Heranca {
  minutos: number | null;
  etiquetas: string[];
  filhas: { linha: LinhaTarefa; minutos: number | null; etiquetas: string[] }[];
}

/**
 * O que o lembrete vira depois de uma escrita. Sem hora, nenhum. Pedido explícito vale. Sem pedido:
 * a tarefa nova ou que acabou de ganhar hora leva o padrão; a que já tinha hora fica com o que tinha
 * (os mesmos minutos antes, no horário novo).
 */
function desejoDoLembrete(
  antes: LinhaTarefa | null,
  depois: CamposTarefa,
  pedido: number | null | undefined,
  atual: LinhaLembrete | null,
  minutosAtuais: number | null,
): Desejo {
  if (depois.vence_em === null || depois.hora === null) return null;
  if (pedido !== undefined) return pedido;
  if (antes === null || antes.hora === null || antes.vence_em === null) return MINUTOS_ANTES_PADRAO;
  if (atual === null) return null;
  return minutosAtuais ?? "intocado";
}

/** Dia que existe, hora só com dia e lembrete só com hora. */
function conferirDiaEHora(campos: CamposTarefa, minutos: number | null | undefined): void {
  if (campos.vence_em !== null && !ehDia(campos.vence_em)) throw new ErroDasTarefas(MENSAGEM_DIA_INVALIDO);
  if (campos.hora !== null && campos.vence_em === null) throw new ErroDasTarefas(MENSAGEM_HORA_SEM_DIA);
  if (typeof minutos === "number" && campos.hora === null)
    throw new ErroDasTarefas(MENSAGEM_LEMBRETE_SEM_HORA);
}

/** Os ids de um pedido de vários: sem repetição e sem passar do limite. */
function idsDoPedido(ids: readonly string[]): string[] {
  if (ids.length > LIMITE_IDS) throw new ErroDasTarefas(MENSAGEM_IDS_DEMAIS);
  if (new Set(ids).size !== ids.length) throw new ErroDasTarefas(MENSAGEM_IDS_REPETIDOS);
  return [...ids];
}

/** O dia da subtarefa na próxima ocorrência; fora do calendário, ela fica sem dia. */
function diaQueAnda(dia: string, salto: number): string | null {
  try {
    return somarDias(dia, salto);
  } catch {
    return null;
  }
}
