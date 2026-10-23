import type {
  AcaoEscolhida,
  Agenda,
  ApresentacaoRotina,
  EstadoAgente,
  HistoricoFoco,
  LinhaRotina,
  Ocorrencia,
  PedidoAgenda,
  PedidoAgirRotina,
  PedidoHistoricoFoco,
  PedidoTarefas,
  RotinasDeHoje,
  Tarefa,
  TipoRotina,
} from "@moductus/contrato";
import type { HoraDoFechamento, Redigir } from "../../agentes/vigias/alba.ts";
import type { NovoAviso } from "../../notificacoes/notificacoes.ts";
import { BRIEFING, FECHAMENTO, HORA_DA_MANHA, type RepositorioAtividade } from "./atividade.ts";
import {
  ESPERA_DO_AVISO_MS,
  TITULO_NA_LINHA,
  duracao,
  oQueFoiFeito,
  oQueFoiFeitoParaModelo,
  porPrioridade,
  quantos,
  referenciaDoBriefing,
  resumosDosAgentes,
  umaLinha,
  type DadosDoBriefing,
  type DiaSemFechamento,
  type Montagem,
  type PainelHoje,
  type ResumoDoAgente,
} from "./briefing.ts";
import type { Conferencia, FonteDoRelogio } from "./relogio.ts";
import type { RepositorioRegistroRotinas } from "./rotinas.ts";
import { diaDaSemana, diaNoFuso, horaNoFuso, instanteNoFuso, somarDias } from "./tempo.ts";

/**
 * O fechamento do dia (AGENTS.md §2 "Fechamento do dia", ADR-0039): na hora de parar (padrão
 * 18:00, o vigia da Alba avisa), as linhas saem por código: o que foi feito (tarefas e foco), o que
 * ficou aberto (com Amanhã, Outra data e Descartar, que a janela faz pelas Tarefas), amanhã numa
 * linha e o resumo dos outros agentes (hoje o Nuno). A Alba só redige a abertura, sem ferramentas
 * e com prazo; sem modelo, sai o molde. O painel Hoje se abre e, fechado 10 minutos sem resposta,
 * vira aviso do Windows, como o briefing.
 *
 * "Adiar 30 min" faz o fechamento voltar, montado de novo; "Encerrar o dia" responde "Dia
 * encerrado." e cala o aviso do Windows até a manhã, menos aprovações e lembretes (o silêncio mora
 * nas notificações). Os dois ficam em `rotinas_registro` e sobrevivem ao serviço reiniciando. Se o
 * PC suspender antes da hora de parar (ou depois de adiar), o dia sem fechamento vira o "Ontem" no
 * topo do briefing seguinte ({@link ServicoFechamento.semFechamento}).
 */

const ALBA = "alba";

/** "Adiar 30 min". */
export const ESPERA_DO_ADIAR_MS = 30 * 60_000;

/** Até onde o "Ontem" procura o último dia em que o fechamento valia. */
const DIAS_PARA_TRAS = 7;

/** O que vai ao modelo de cada título, como dado. */
const TITULO_NOS_DADOS = 200;

export const PEDIDO_DO_FECHAMENTO =
  "Escreva a frase de abertura do fechamento do dia, na voz da Alba: calma, sem cobrar. Primeiro o que foi feito, depois o que ficou aberto.";

export const TITULO_DO_AVISO = "Fechamento do dia";

/** O mesmo prefixo do briefing: o clique no aviso abre o painel Hoje. */
export const referenciaDoFechamento = referenciaDoBriefing;

export const MENSAGEM_ROTINA_NAO_ENCONTRADA = "Esse briefing ou fechamento não existe mais.";
export const MENSAGEM_ACAO_DE_OUTRA_ROTINA = "Essa ação não vale para esta rotina.";

/** Erro da regra das rotinas: a mensagem vai à janela como está. */
export class ErroDasRotinas extends Error {}

/** O que cada rotina oferece (o `fechar` das duas é o X do painel). */
const ACOES: Record<TipoRotina, readonly AcaoEscolhida[]> = {
  briefing: ["comecar", "ajustar", "fechar"],
  fechamento: ["adiar", "encerrar", "fechar"],
};

/** O que o fechamento lê para montar as linhas. */
export interface DadosDoFechamento {
  fuso: string;
  /** As feitas no dia, sem as subtarefas. */
  feitas: number;
  /** Os minutos de foco do dia. */
  focoMin: number;
  /** As abertas do dia e de antes, sem as subtarefas: o "Ficou aberto". */
  abertas: readonly Tarefa[];
  /** As ocorrências de amanhã, de todos os calendários lidos. */
  ocorrenciasDeAmanha: readonly Ocorrencia[];
  /** As abertas de amanhã, sem as subtarefas. */
  tarefasDeAmanha: readonly Tarefa[];
  resumos: DadosDoBriefing["resumos"];
}

/** As linhas, o que vai ao modelo, a frase de molde e as tarefas do "Ficou aberto". */
export interface MontagemFechamento extends Montagem {
  abertas: Tarefa[];
}

const ficaram = (n: number) => (n === 1 ? "1 ficou aberta." : `${n} ficaram abertas.`);

/** As linhas do fechamento, por código: os números saem daqui, nunca do modelo. */
export function montarFechamento(d: DadosDoFechamento): MontagemFechamento {
  const linhas: LinhaRotina[] = [];
  const paraModelo: string[] = [];
  const dados: string[] = [];

  // 1. Alba: o que foi feito; o que ficou aberto vai em `abertas`, com as ações de cada uma.
  const feito = oQueFoiFeito(d.feitas, d.focoMin);
  if (feito !== null) {
    linhas.push({ agenteId: ALBA, rotulo: null, texto: feito, tarefaIds: [] });
    paraModelo.push(`Alba, o dia: ${oQueFoiFeitoParaModelo(d.feitas, d.focoMin)}.`);
  }
  if (d.abertas.length > 0)
    paraModelo.push(`Ficou aberto: ${quantos(d.abertas.length, "tarefa", "tarefas")}.`);

  // 2. Amanhã numa linha: o primeiro compromisso e a prioridade.
  const primeiro =
    d.ocorrenciasDeAmanha
      .filter((o) => !o.diaInteiro)
      .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))[0] ?? null;
  const prioridade = [...d.tarefasDeAmanha].sort(porPrioridade)[0] ?? null;
  const hora = primeiro ? horaNoFuso(new Date(primeiro.inicio), d.fuso) : "";
  const compromisso = primeiro ? `${umaLinha(primeiro.titulo, TITULO_NA_LINHA)} às ${hora}` : null;
  const titulo = prioridade ? umaLinha(prioridade.titulo, TITULO_NA_LINHA) : null;
  let amanha: string;
  if (compromisso !== null && titulo !== null) amanha = `${compromisso}, e a prioridade é ${titulo}.`;
  else if (compromisso !== null) amanha = `${compromisso}.`;
  else if (titulo !== null) amanha = `A prioridade é ${titulo}.`;
  else amanha = "Nada marcado ainda.";
  linhas.push({
    agenteId: ALBA,
    rotulo: "Amanhã",
    texto: amanha,
    tarefaIds: prioridade ? [prioridade.id] : [],
  });
  const doAmanha: string[] = [];
  if (primeiro) {
    doAmanha.push(`o primeiro compromisso às ${hora}`);
    dados.push(umaLinha(primeiro.titulo, TITULO_NOS_DADOS));
  }
  if (prioridade) {
    doAmanha.push("a prioridade");
    dados.push(umaLinha(prioridade.titulo, TITULO_NOS_DADOS));
  }
  paraModelo.push(
    doAmanha.length > 0
      ? `Amanhã: ${doAmanha.join(" e ")}; os títulos estão nos dados.`
      : "Amanhã: nada marcado ainda.",
  );

  // 3 a 5. Tula, Nuno e Faina, cada um numa linha, só quando têm novidade.
  for (const r of d.resumos) {
    linhas.push({ agenteId: r.agenteId, rotulo: null, texto: r.texto, tarefaIds: [] });
    paraModelo.push(`${r.nome}: ${r.texto}`);
  }

  // A frase de molde, na voz da Alba: até duas frases, o feito antes do aberto, sem cobrar.
  const partes: string[] = [];
  if (d.feitas > 0) partes.push(quantos(d.feitas, "feita", "feitas"));
  if (d.focoMin > 0) partes.push(`${duracao(d.focoMin)} de foco`);
  let molde = partes.length > 0 ? `Hora de parar: ${partes.join(", ")}.` : "Hora de parar.";
  if (d.abertas.length > 0) molde += ` ${ficaram(d.abertas.length)}`;
  else if (partes.length > 0) molde += " Nada ficou aberto.";

  return { linhas, paraModelo, dados, molde, abertas: [...d.abertas] };
}

export interface DependenciasFechamento {
  lerFuso: () => string;
  agenda: { consultar(pedido: PedidoAgenda): Agenda };
  tarefas: { listar(pedido: PedidoTarefas): Tarefa[]; feitasNoDia(dia: string): number };
  foco: { historico(pedido: PedidoHistoricoFoco): HistoricoFoco };
  resumos: readonly ResumoDoAgente[];
  /** O estado do agente agora: pausado ou desligado, a linha dele não entra. */
  estadoDo: (agenteId: string) => EstadoAgente | null;
  redigir: Redigir;
  registro: Pick<RepositorioRegistroRotinas, "doDia" | "porId" | "gravar" | "agir" | "reabrir">;
  /** A rotina do fechamento: a hora e os dias, para o "Ontem". */
  rotinas: Pick<RepositorioAtividade, "fechamento">;
  painel: PainelHoje;
  avisar: (aviso: NovoAviso) => Promise<unknown>;
  /** O relógio do dia, para se rearmar pelo aviso dos 10 minutos e pelo adiar. */
  relogio: { mudou(): void };
  /** O fechamento que acabou de aparecer, ou voltou do adiar (`rotinas.apareceu`). */
  apareceu: (apresentacao: ApresentacaoRotina) => void;
}

export interface OpcoesFechamento {
  agora?: () => Date;
}

/** De 1 (segunda) a 7 (domingo), como a ISO 8601 e `rotinas.dias_semana`. */
const diaIso = (dia: string) => {
  const d = diaDaSemana(dia);
  return d === 0 ? 7 : d;
};

interface Espera {
  id: string;
  dia: string;
  ate: number;
}

/**
 * Monta e mostra o fechamento quando o vigia da Alba avisa a hora de parar, atende `rotinas.hoje` e
 * `rotinas.agir` (das duas rotinas), diz às notificações se o dia está encerrado e é a fonte do
 * relógio do dia que confere o aviso dos 10 minutos e a volta do adiar.
 */
export class ServicoFechamento implements FonteDoRelogio {
  readonly nome = "fechamento do dia";
  private readonly agora: () => Date;
  /** O fechamento que ainda pode virar aviso do Windows: só o deste serviço, uma vez. */
  private pendente: Espera | null = null;
  /** O fechamento adiado, lido do registro na primeira vez: o adiar sobrevive ao serviço reiniciando. */
  private adiado: Espera | null = null;
  private adiadoLido = false;

  constructor(
    private readonly deps: DependenciasFechamento,
    opcoes: OpcoesFechamento = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /** As linhas de agora para o fechamento do dia. */
  montar(dia: string): MontagemFechamento {
    const fuso = this.deps.lerFuso();
    const amanha = somarDias(dia, 1);
    const agenda = this.deps.agenda.consultar({ de: amanha, ate: amanha });
    // As abertas com dia, numa leitura só: as de hoje e de antes ficaram abertas; as de amanhã dão a
    // prioridade. Depois da meia-noite (o adiar que volta), o "hoje" das Tarefas já é outro.
    const abertas = this.deps.tarefas
      .listar({})
      .filter((t) => t.estado === "aberta" && t.tarefaPaiId === null);
    return montarFechamento({
      fuso,
      feitas: this.deps.tarefas.feitasNoDia(dia),
      focoMin: this.focoNoDia(dia),
      abertas: abertas.filter((t) => t.venceEm !== null && t.venceEm <= dia),
      // O evento de hoje que atravessa a meia-noite não é o primeiro compromisso de amanhã.
      ocorrenciasDeAmanha: agenda.ocorrencias.filter(
        (o) => !o.diaInteiro && diaNoFuso(new Date(o.inicio), fuso) === amanha,
      ),
      tarefasDeAmanha: abertas.filter((t) => t.venceEm === amanha),
      resumos: resumosDosAgentes(this.deps.resumos, this.deps.estadoDo),
    });
  }

  /**
   * A hora de parar chegou: monta, pede a abertura à Alba (até 15 s; sem modelo, o molde), grava,
   * avisa as janelas e abre o painel Hoje. O fechamento do dia que já apareceu não repete. Se falhar
   * aqui, o vigia não tenta de novo no mesmo dia: o dia fica sem fechamento e vira o "Ontem" do
   * briefing seguinte.
   */
  async aparecer(hora: HoraDoFechamento): Promise<ApresentacaoRotina> {
    const ja = this.deps.registro.doDia(FECHAMENTO, hora.dia);
    if (ja) return ja;
    const montagem = this.montar(hora.dia);
    const redacao = await this.redigir(montagem);
    const apresentacao = this.deps.registro.gravar({
      rotinaId: FECHAMENTO,
      dia: hora.dia,
      abertura: redacao.texto,
      linhas: montagem.linhas,
      abertas: montagem.abertas,
      daExecucaoId: redacao.execucaoId,
    });
    await this.mostrar(apresentacao);
    return apresentacao;
  }

  /** O briefing e o fechamento de hoje, se já apareceram, e se o dia está encerrado. */
  hoje(): RotinasDeHoje {
    const dia = diaNoFuso(this.agora(), this.deps.lerFuso());
    return {
      briefing: this.deps.registro.doDia(BRIEFING, dia),
      fechamento: this.deps.registro.doDia(FECHAMENTO, dia),
      diaEncerrado: this.diaEncerrado(),
    };
  }

  /**
   * A ação escolhida no briefing ou no fechamento, gravada com a hora (a última vale). No
   * fechamento, "Adiar 30 min" programa a volta e "Encerrar o dia" cala o Windows até a manhã;
   * qualquer ação tira o aviso dos 10 minutos.
   */
  agir(pedido: PedidoAgirRotina): ApresentacaoRotina {
    const atual = this.deps.registro.porId(pedido.id);
    if (!atual) throw new ErroDasRotinas(MENSAGEM_ROTINA_NAO_ENCONTRADA);
    if (!ACOES[atual.tipo].includes(pedido.acao)) throw new ErroDasRotinas(MENSAGEM_ACAO_DE_OUTRA_ROTINA);
    if (atual.tipo === "fechamento") this.adiadoAgora();
    const agida = this.deps.registro.agir(atual.id, pedido.acao);
    if (!agida) throw new Error(`o registro da rotina ${atual.id} não se lê depois da ação`);
    if (agida.tipo === "fechamento") {
      if (this.pendente?.id === agida.id) this.pendente = null;
      if (pedido.acao === "adiar") {
        this.adiado = { id: agida.id, dia: agida.dia, ate: Date.parse(agida.acaoEm!) + ESPERA_DO_ADIAR_MS };
      } else if (this.adiado?.id === agida.id) this.adiado = null;
      this.deps.relogio.mudou();
    }
    return agida;
  }

  /**
   * Se você encerrou o dia e a manhã seguinte (05:00) ainda não chegou: o "Encerrar o dia" depois da
   * meia-noite vale até a manhã do mesmo dia. Banco com problema não cala aviso nenhum.
   */
  diaEncerrado(): boolean {
    try {
      const agora = this.agora();
      const fuso = this.deps.lerFuso();
      const hoje = diaNoFuso(agora, fuso);
      for (const dia of [hoje, somarDias(hoje, -1)]) {
        const fechamento = this.deps.registro.doDia(FECHAMENTO, dia);
        if (fechamento?.acao === "encerrar" && agora.getTime() < this.manhaDepois(dia, fuso)) return true;
      }
      return false;
    } catch (erro) {
      console.error(`fechamento: não deu para saber se o dia está encerrado: ${String(erro)}`);
      return false;
    }
  }

  /**
   * O último dia antes de hoje em que o fechamento valia, se ele não chegou ao fim (não apareceu, ou
   * ficou adiado) e houve o que contar: vira o "Ontem" no topo do briefing.
   */
  semFechamento(hoje: string): DiaSemFechamento | null {
    const rotina = this.deps.rotinas.fechamento();
    if (!rotina?.ativa || rotina.hora === null) return null;
    let dia: string | null = null;
    for (let i = 1; i <= DIAS_PARA_TRAS && dia === null; i++) {
      const candidato = somarDias(hoje, -i);
      if (rotina.diasSemana.includes(diaIso(candidato))) dia = candidato;
    }
    if (dia === null) return null;
    const fechamento = this.deps.registro.doDia(FECHAMENTO, dia);
    if (fechamento && fechamento.acao !== "adiar") return null;
    const feitas = this.deps.tarefas.feitasNoDia(dia);
    const focoMin = this.focoNoDia(dia);
    if (feitas === 0 && focoMin === 0) return null;
    return { dia, feitas, focoMin };
  }

  proximo(): Date | null {
    const adiado = this.adiadoAgora();
    const candidatos = [this.pendente?.ate, adiado?.ate].filter((c): c is number => c !== undefined);
    if (candidatos.length === 0) return null;
    // No passado, o relógio confere já.
    return new Date(Math.min(...candidatos));
  }

  async conferir({ agora }: Conferencia): Promise<void> {
    let falha: unknown = null;
    try {
      await this.voltarDoAdiar(agora);
    } catch (erro) {
      falha = erro;
    }
    // O aviso confere mesmo com a volta falhando; a falha volta ao relógio no fim.
    await this.conferirAviso(agora);
    if (falha !== null) throw falha;
  }

  /**
   * Passados 30 minutos do adiar, o fechamento volta montado de novo, como se acabasse de aparecer.
   * O adiado que a manhã seguinte já alcançou fica como está: vira o "Ontem" do briefing.
   */
  private async voltarDoAdiar(agora: Date): Promise<void> {
    const adiado = this.adiadoAgora();
    if (!adiado || agora.getTime() < adiado.ate) return;
    const atual = this.deps.registro.porId(adiado.id);
    if (
      !atual ||
      atual.acao !== "adiar" ||
      agora.getTime() >= this.manhaDepois(atual.dia, this.deps.lerFuso())
    ) {
      this.adiado = null;
      return;
    }
    const montagem = this.montar(atual.dia);
    const redacao = await this.redigir(montagem);
    // A ação pode ter mudado enquanto a Alba redigia ("Encerrar o dia" no painel).
    if (this.deps.registro.porId(adiado.id)?.acao !== "adiar") {
      this.adiado = null;
      return;
    }
    const reaberta = this.deps.registro.reabrir(adiado.id, {
      abertura: redacao.texto,
      linhas: montagem.linhas,
      abertas: montagem.abertas,
      daExecucaoId: redacao.execucaoId,
    });
    this.adiado = null;
    if (reaberta) await this.mostrar(reaberta);
  }

  /**
   * Passados 10 minutos: o fechamento sem ação e com o painel Hoje fechado vira um aviso do
   * Windows, uma vez. Com o painel aberto, o prazo recomeça. A casca que não responde conta como
   * fechado.
   */
  private async conferirAviso(agora: Date): Promise<void> {
    const pendente = this.pendente;
    if (!pendente || agora.getTime() < pendente.ate) return;
    this.pendente = null;
    if (agora.getTime() >= this.manhaDepois(pendente.dia, this.deps.lerFuso())) return;
    const fechamento = this.deps.registro.porId(pendente.id);
    if (!fechamento || fechamento.acao !== null) return;
    const aberto = await this.deps.painel.aberto().catch((erro: unknown) => {
      console.error(`fechamento: a casca não disse se o painel está aberto: ${String(erro)}`);
      return false;
    });
    if (aberto) {
      this.pendente = { ...pendente, ate: agora.getTime() + ESPERA_DO_AVISO_MS };
      return;
    }
    await this.deps.avisar({
      agenteId: ALBA,
      tipo: "rotina",
      titulo: TITULO_DO_AVISO,
      corpo: fechamento.abertura,
      referencia: referenciaDoFechamento(fechamento.id),
      // O clique abre o Hoje, não o painel do time.
      semPainelDoTime: true,
    });
  }

  /** Avisa as janelas, abre o painel Hoje e programa o aviso dos 10 minutos. */
  private async mostrar(apresentacao: ApresentacaoRotina): Promise<void> {
    this.deps.apareceu(apresentacao);
    try {
      await this.deps.painel.mostrar();
    } catch (erro) {
      // Sem o painel, o aviso dos 10 minutos ainda leva ao fechamento.
      console.error(`fechamento: o painel Hoje não abriu: ${String(erro)}`);
    }
    this.pendente = {
      id: apresentacao.id,
      dia: apresentacao.dia,
      ate: this.agora().getTime() + ESPERA_DO_AVISO_MS,
    };
    this.deps.relogio.mudou();
  }

  private redigir(montagem: MontagemFechamento) {
    return this.deps.redigir({
      gatilho: "horario",
      pedido: PEDIDO_DO_FECHAMENTO,
      linhas: montagem.paraModelo,
      dados: montagem.dados,
      molde: montagem.molde,
    });
  }

  /** O fechamento adiado de hoje ou de ontem (o adiar perto da meia-noite), lido uma vez do registro. */
  private adiadoAgora(): Espera | null {
    if (!this.adiadoLido) {
      this.adiadoLido = true;
      const hoje = diaNoFuso(this.agora(), this.deps.lerFuso());
      for (const dia of [hoje, somarDias(hoje, -1)]) {
        const f = this.deps.registro.doDia(FECHAMENTO, dia);
        if (f?.acao === "adiar" && f.acaoEm !== null) {
          this.adiado = { id: f.id, dia: f.dia, ate: Date.parse(f.acaoEm) + ESPERA_DO_ADIAR_MS };
          break;
        }
      }
    }
    return this.adiado;
  }

  private focoNoDia(dia: string): number {
    return this.deps.foco.historico({ de: dia, ate: dia }).porDia.find((p) => p.dia === dia)?.minutos ?? 0;
  }

  /** As 05:00 do dia seguinte: a manhã em que o dia encerrado volta a falar. */
  private manhaDepois(dia: string, fuso: string): number {
    return instanteNoFuso(somarDias(dia, 1), HORA_DA_MANHA, fuso).getTime();
  }
}
