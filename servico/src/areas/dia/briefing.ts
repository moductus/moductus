import {
  LINHAS_DO_BRIEFING,
  LINHAS_DO_BRIEFING_CURTO,
  type Agenda,
  type ApresentacaoRotina,
  type DiaDaAgenda,
  type EstadoAgente,
  type LinhaRotina,
  type Ocorrencia,
  type PedidoAgenda,
  type PedidoTarefas,
  type Tarefa,
} from "@moductus/contrato";
import type { Redigir } from "../../agentes/vigias/alba.ts";
import type { NovoAviso } from "../../notificacoes/notificacoes.ts";
import { BRIEFING, FECHAMENTO, type InicioDoDia } from "./atividade.ts";
import type { Conferencia, FonteDoRelogio } from "./relogio.ts";
import type { RepositorioRegistroRotinas } from "./rotinas.ts";
import { diaNoFuso, horaNoFuso } from "./tempo.ts";

/**
 * O briefing da manhã (AGENTS.md §2 "Briefing da manhã e fechamento do dia", ADR-0039): as linhas
 * são montadas por código, na ordem do AGENTS (Alba, Ontem, Tula, Nuno, Faina), até 6, a partir da
 * agenda, das tarefas e do resumo que cada agente fornece (`resumoDoDia()`). Agente sem novidade
 * não aparece. A Alba só redige a frase de abertura, sem ferramentas e com prazo (o despertar
 * contido de `agentes/vigias/alba.ts`); sem modelo, sai a frase de molde. O que apareceu fica em
 * `rotinas_registro`, o painel Hoje se abre ao lado do dock e, se ele ficar fechado 10 minutos sem
 * resposta, a Alba avisa pelo Windows.
 */

const ALBA = "alba";

/** Depois disto com o painel fechado e sem ação, o briefing vira aviso do Windows. */
export const ESPERA_DO_AVISO_MS = 10 * 60_000;

/** As prioridades do dia que entram na linha da Alba. */
export const PRIORIDADES_NA_LINHA = 3;

/** Título de tarefa na linha: o bastante para reconhecer, sem quebrar a leitura. */
export const TITULO_NA_LINHA = 40;

/** O que vai ao modelo de cada título, como dado. */
const TITULO_NOS_DADOS = 200;

/** Os resumos dos outros agentes, na ordem do AGENTS.md; agente de fora da lista vem depois. */
const ORDEM_DOS_RESUMOS = ["tula", "nuno", "faina"];

export const PEDIDO_DA_ABERTURA =
  "Escreva a frase de abertura do briefing da manhã, na voz da Alba: calma, organizada, sem cobrar. Se o dia está cheio, diga isso primeiro.";

export const TITULO_DO_AVISO = "Briefing da manhã";

/** A referência do aviso do briefing: o clique nele abre o painel Hoje. */
export const referenciaDoBriefing = (registroId: string) => `rotina:${registroId}`;

/** O resumo que um agente manda ao briefing: uma linha, só com o que ele mesmo contou, ou `null`. */
export interface ResumoDoAgente {
  agenteId: string;
  /** Como o agente aparece no pedido ao modelo ("Nuno"). */
  nome: string;
  resumoDoDia(): string | null;
}

/**
 * O último dia em que o fechamento valia e não chegou ao fim (o PC suspendeu antes da hora de parar,
 * ou depois de "Adiar 30 min"), com o que foi feito nele: vira o "Ontem" no topo do briefing.
 */
export interface DiaSemFechamento {
  dia: string;
  feitas: number;
  focoMin: number;
}

/** O que o briefing lê para montar as linhas. */
export interface DadosDoBriefing {
  agora: Date;
  fuso: string;
  /** As ocorrências de hoje, de todos os calendários lidos. */
  ocorrencias: readonly Ocorrencia[];
  /** Hoje na agenda: os livres, o planejado e o "dia cheio". */
  dia: DiaDaAgenda | null;
  /** As abertas de hoje, sem as subtarefas. */
  hoje: readonly Tarefa[];
  /** As abertas de antes de hoje, sem as subtarefas: o "Ontem". */
  atrasadas: readonly Tarefa[];
  /** Os resumos que vieram, já na ordem e sem os vazios. */
  resumos: readonly { agenteId: string; nome: string; texto: string }[];
  /** O fechamento que não apareceu no último dia dele, se houve o que contar. */
  semFechamento?: DiaSemFechamento | null;
  /** O briefing mais curto que você escolheu: só as primeiras linhas, na mesma ordem. */
  curto?: boolean;
}

/** As linhas prontas, o que delas vai ao modelo e a frase que sai sem ele. */
export interface Montagem {
  linhas: LinhaRotina[];
  /** Cada linha como vai ao modelo, sem texto escrito pelo usuário (que vai em `dados`). */
  paraModelo: string[];
  /** Os títulos das prioridades, marcados como dado no pedido. */
  dados: string[];
  molde: string;
}

export const quantos = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "7h", "7h30" ou "45 min". */
export function duracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** "5 feitas · 2h10 de foco"; `null` quando nada foi feito (a Alba não cobra). */
export function oQueFoiFeito(feitas: number, focoMin: number): string | null {
  const partes: string[] = [];
  if (feitas > 0) partes.push(quantos(feitas, "feita", "feitas"));
  if (focoMin > 0) partes.push(`${duracao(focoMin)} de foco`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** O mesmo, como vai ao modelo. */
export function oQueFoiFeitoParaModelo(feitas: number, focoMin: number): string {
  const partes: string[] = [];
  if (feitas > 0) partes.push(quantos(feitas, "tarefa feita", "tarefas feitas"));
  if (focoMin > 0) partes.push(`${duracao(focoMin)} de foco`);
  return partes.join(", ");
}

/** Uma linha só, aparada no tamanho: título com quebra de linha ou enorme não estica o briefing. */
export function umaLinha(texto: string, maximo: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= maximo ? limpo : `${limpo.slice(0, maximo - 1).trimEnd()}…`;
}

/** Prioridade maior primeiro; depois a que tem hora, mais cedo; depois a ordem da lista. */
export function porPrioridade(a: Tarefa, b: Tarefa): number {
  if (a.prioridade !== b.prioridade) return b.prioridade - a.prioridade;
  if (a.hora !== b.hora) return a.hora === null ? 1 : b.hora === null ? -1 : a.hora < b.hora ? -1 : 1;
  return a.ordem - b.ordem;
}

/** As linhas do briefing, por código: os números saem daqui, nunca do modelo. */
export function montarBriefing(d: DadosDoBriefing): Montagem {
  const hora = (instante: string) => horaNoFuso(new Date(instante), d.fuso);
  const reunioes = d.ocorrencias
    .filter((o) => !o.diaInteiro)
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  const proxima = reunioes.find((o) => Date.parse(o.inicio) > d.agora.getTime()) ?? null;
  const livre = (d.dia?.livres ?? [])
    .filter((b) => Date.parse(b.fim) > d.agora.getTime())
    .reduce<DiaDaAgenda["livres"][number] | null>(
      (maior, b) => (!maior || b.minutos > maior.minutos ? b : maior),
      null,
    );
  const prioridades = [...d.hoje].sort(porPrioridade).slice(0, PRIORIDADES_NA_LINHA);
  const cheio = d.dia?.cheio === true;
  const textoCheio = d.dia
    ? `${duracao(d.dia.planejadoMin)} planejadas para ${duracao(d.dia.livreMin)} livres`
    : "";

  const linhas: LinhaRotina[] = [];
  const paraModelo: string[] = [];
  const dados: string[] = [];

  // 1. Alba, o dia: o cheio, as reuniões e a próxima, o maior bloco livre e as prioridades.
  const comum: string[] = [];
  if (cheio) comum.push(`Dia cheio: ${textoCheio}.`);
  if (reunioes.length > 0) {
    const aProxima = proxima ? `, a próxima às ${hora(proxima.inicio)}` : "";
    comum.push(`${quantos(reunioes.length, "reunião", "reuniões")}${aProxima}.`);
  }
  if (comum.length > 0 || prioridades.length > 0) {
    if (livre) comum.push(`Foco livre das ${hora(livre.inicio)} às ${hora(livre.fim)}.`);
    const titulos = prioridades.map((t) => umaLinha(t.titulo, TITULO_NA_LINHA));
    const mostrar = [...comum];
    const modelo = [...comum];
    if (titulos.length > 0) {
      mostrar.push(`${titulos.length === 1 ? "Prioridade" : "Prioridades"}: ${titulos.join(", ")}.`);
      modelo.push(
        `${quantos(d.hoje.length, "tarefa", "tarefas")} para hoje; os títulos das ${quantos(prioridades.length, "prioridade", "prioridades")} estão nos dados.`,
      );
      dados.push(...prioridades.map((t) => umaLinha(t.titulo, TITULO_NOS_DADOS)));
    }
    linhas.push({
      agenteId: ALBA,
      rotulo: null,
      texto: mostrar.join(" "),
      tarefaIds: prioridades.map((t) => t.id),
    });
    paraModelo.push(`Alba, o dia: ${modelo.join(" ")}`);
  }

  // 2. Ontem: as abertas que ficaram de antes de hoje. O fechamento que não apareceu (o PC
  // suspendeu antes da hora de parar) vem junto, no topo (AGENTS.md §2 "Fechamento do dia").
  const n = d.atrasadas.length;
  const abertas = n === 0 ? null : n === 1 ? "1 ficou aberta." : `${n} ficaram abertas.`;
  const abertasParaModelo = quantos(n, "tarefa ficou aberta", "tarefas ficaram abertas");
  const feito = d.semFechamento ? oQueFoiFeito(d.semFechamento.feitas, d.semFechamento.focoMin) : null;
  if (feito !== null && d.semFechamento) {
    const s = d.semFechamento;
    linhas.unshift({
      agenteId: ALBA,
      rotulo: "Ontem",
      texto: abertas === null ? `${feito}.` : `${feito}. ${abertas}`,
      tarefaIds: d.atrasadas.map((t) => t.id),
    });
    const modelo = oQueFoiFeitoParaModelo(s.feitas, s.focoMin);
    paraModelo.unshift(
      `Ontem (o fechamento não apareceu): ${modelo}${n > 0 ? `; ${abertasParaModelo}` : ""}.`,
    );
  } else if (abertas !== null) {
    linhas.push({ agenteId: ALBA, rotulo: "Ontem", texto: abertas, tarefaIds: d.atrasadas.map((t) => t.id) });
    paraModelo.push(`Ontem: ${abertasParaModelo}.`);
  }

  // 3 a 5. Tula, Nuno e Faina, cada um numa linha, só quando têm novidade.
  for (const r of d.resumos) {
    linhas.push({ agenteId: r.agenteId, rotulo: null, texto: r.texto, tarefaIds: [] });
    paraModelo.push(`${r.nome}: ${r.texto}`);
  }

  // A frase de molde, na voz da Alba (AGENTS.md §2, "Abertura").
  let molde: string;
  if (cheio) molde = `Bom dia. O dia está cheio: ${textoCheio}.`;
  else {
    const hoje: string[] = [];
    if (reunioes.length > 0) hoje.push(quantos(reunioes.length, "reunião", "reuniões"));
    if (d.hoje.length > 0) hoje.push(quantos(d.hoje.length, "tarefa", "tarefas"));
    if (livre && hoje.length > 0) hoje.push(`foco livre das ${hora(livre.inicio)} às ${hora(livre.fim)}`);
    molde = hoje.length > 0 ? `Bom dia. Hoje: ${hoje.join(", ")}.` : "Bom dia. Nada marcado para hoje.";
  }

  const limite = d.curto ? LINHAS_DO_BRIEFING_CURTO : LINHAS_DO_BRIEFING;
  return {
    linhas: linhas.slice(0, limite),
    paraModelo: paraModelo.slice(0, limite),
    dados,
    molde,
  };
}

/** O painel Hoje, pela casca: mostrar sem ativar e perguntar se está à vista. */
export interface PainelHoje {
  mostrar(): Promise<unknown>;
  aberto(): Promise<boolean>;
}

export interface DependenciasBriefing {
  lerFuso: () => string;
  agenda: { consultar(pedido: PedidoAgenda): Agenda };
  tarefas: { listar(pedido: PedidoTarefas): Tarefa[] };
  resumos: readonly ResumoDoAgente[];
  /** O estado do agente agora: pausado ou desligado, a linha dele não entra. */
  estadoDo: (agenteId: string) => EstadoAgente | null;
  redigir: Redigir;
  registro: Pick<RepositorioRegistroRotinas, "doDia" | "porId" | "gravar" | "fecharSozinhas">;
  painel: PainelHoje;
  avisar: (aviso: NovoAviso) => Promise<unknown>;
  /** O relógio do dia, para se rearmar pelo aviso dos 10 minutos. */
  relogio: { mudou(): void };
  /** O briefing que acabou de aparecer (`rotinas.apareceu`). */
  apareceu: (apresentacao: ApresentacaoRotina) => void;
  /** O fechamento que não apareceu no último dia dele (`ServicoFechamento.semFechamento`). */
  semFechamento?: (hoje: string) => DiaSemFechamento | null;
  /** Se você escolheu o briefing mais curto (a rotina `curta`). */
  curto?: () => boolean;
  /** A pergunta dos 3 ignorados seguidos, que sai junto do briefing (`ServicoIgnorados`). */
  ignorados?: { conferir(dia: string): unknown };
}

export interface OpcoesBriefing {
  agora?: () => Date;
}

/**
 * Monta e mostra o briefing quando o dia começa (a primeira atividade, `atividade.ts`), e é a fonte
 * do relógio do dia que confere, 10 minutos depois, se ele ficou fechado.
 */
export class ServicoBriefing implements FonteDoRelogio {
  readonly nome = "aviso do briefing";
  private readonly agora: () => Date;
  /** O briefing que ainda pode virar aviso: só o deste serviço, uma vez. */
  private pendente: { id: string; dia: string; ate: number } | null = null;

  constructor(
    private readonly deps: DependenciasBriefing,
    opcoes: OpcoesBriefing = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /** As linhas de agora para o dia. */
  montar(dia: string): Montagem {
    const fuso = this.deps.lerFuso();
    const agenda = this.deps.agenda.consultar({ de: dia, ate: dia });
    const abertas = (t: Tarefa) => t.estado === "aberta" && t.tarefaPaiId === null;
    return montarBriefing({
      agora: this.agora(),
      fuso,
      ocorrencias: agenda.ocorrencias,
      dia: agenda.dias.find((d) => d.dia === dia) ?? null,
      hoje: this.deps.tarefas.listar({ vista: "hoje" }).filter((t) => abertas(t) && t.venceEm === dia),
      atrasadas: this.deps.tarefas.listar({ vista: "atrasadas" }).filter(abertas),
      resumos: resumosDosAgentes(this.deps.resumos, this.deps.estadoDo),
      semFechamento: this.semFechamento(dia),
      curto: this.deps.curto?.() ?? false,
    });
  }

  /** O fechamento de ontem que não apareceu; se a conta falhar, o briefing sai sem ele. */
  private semFechamento(dia: string): DiaSemFechamento | null {
    try {
      return this.deps.semFechamento?.(dia) ?? null;
    } catch (erro) {
      console.error(`briefing: o fechamento de ontem não se leu: ${String(erro)}`);
      return null;
    }
  }

  /**
   * O dia começou: os briefings e fechamentos de antes que ficaram sem resposta fecham sozinhos (o
   * fechamento ignorado volta resumido no "Ontem"), monta, pede a abertura à Alba (até 15 s; sem
   * modelo, o molde), grava, confere a pergunta dos ignorados, avisa as janelas e abre o painel
   * Hoje. O briefing do dia que já apareceu não repete: volta o gravado.
   */
  async aparecer(inicio: InicioDoDia): Promise<ApresentacaoRotina> {
    const ja = this.deps.registro.doDia(BRIEFING, inicio.dia);
    if (ja) return ja;
    this.deps.registro.fecharSozinhas(BRIEFING, inicio.dia);
    this.deps.registro.fecharSozinhas(FECHAMENTO, inicio.dia);
    const montagem = this.montar(inicio.dia);
    const redacao = await this.deps.redigir({
      gatilho: inicio.motivo === "horario" ? "horario" : "evento",
      pedido: PEDIDO_DA_ABERTURA,
      linhas: montagem.paraModelo,
      dados: montagem.dados,
      molde: montagem.molde,
    });
    const apresentacao = this.deps.registro.gravar({
      rotinaId: BRIEFING,
      dia: inicio.dia,
      abertura: redacao.texto,
      linhas: montagem.linhas,
      abertas: [],
      daExecucaoId: redacao.execucaoId,
    });
    // Antes de avisar as janelas: quem lê `rotinas.hoje` pelo aviso já vê a pergunta. Se a conta
    // falhar, o briefing sai sem ela.
    try {
      this.deps.ignorados?.conferir(inicio.dia);
    } catch (erro) {
      console.error(`briefing: a pergunta dos ignorados não se conferiu: ${String(erro)}`);
    }
    this.deps.apareceu(apresentacao);
    try {
      await this.deps.painel.mostrar();
    } catch (erro) {
      // Sem o painel, o aviso dos 10 minutos ainda leva ao briefing.
      console.error(`briefing: o painel Hoje não abriu: ${String(erro)}`);
    }
    this.pendente = {
      id: apresentacao.id,
      dia: apresentacao.dia,
      ate: Date.parse(apresentacao.criadoEm) + ESPERA_DO_AVISO_MS,
    };
    this.deps.relogio.mudou();
    return apresentacao;
  }

  /** O clique no corpo do aviso do briefing abre o painel Hoje (a casca abriu o do time). */
  aoClicarNoAviso(referencia: string | null): void {
    if (referencia === null || !referencia.startsWith("rotina:")) return;
    this.deps.painel
      .mostrar()
      .catch((erro: unknown) => console.error(`briefing: o painel Hoje não abriu: ${String(erro)}`));
  }

  proximo(): Date | null {
    return this.pendente ? new Date(this.pendente.ate) : null;
  }

  /**
   * Passados 10 minutos: o briefing de hoje sem ação e com o painel Hoje fechado vira um aviso do
   * Windows, uma vez. Com o painel aberto, o prazo recomeça: o aviso só sai 10 minutos depois de
   * ele ter sido visto fechado. A casca que não responde conta como fechado.
   */
  async conferir({ agora }: Conferencia): Promise<void> {
    const pendente = this.pendente;
    if (!pendente || agora.getTime() < pendente.ate) return;
    this.pendente = null;
    if (diaNoFuso(agora, this.deps.lerFuso()) !== pendente.dia) return;
    const briefing = this.deps.registro.porId(pendente.id);
    if (!briefing || briefing.acao !== null) return;
    const aberto = await this.deps.painel.aberto().catch((erro: unknown) => {
      console.error(`briefing: a casca não disse se o painel está aberto: ${String(erro)}`);
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
      corpo: briefing.abertura,
      referencia: referenciaDoBriefing(briefing.id),
      // O clique abre o Hoje (aoClicarNoAviso), não o painel do time.
      semPainelDoTime: true,
    });
  }
}

/**
 * Os resumos dos agentes na ordem do AGENTS.md; o de agente pausado ou desligado não entra, e o
 * que falha fica de fora, sem levar os outros. Vale para o briefing e para o fechamento.
 */
export function resumosDosAgentes(
  resumos: readonly ResumoDoAgente[],
  estadoDo: (agenteId: string) => EstadoAgente | null,
): DadosDoBriefing["resumos"] {
  const posicao = (id: string) => {
    const i = ORDEM_DOS_RESUMOS.indexOf(id);
    return i < 0 ? ORDEM_DOS_RESUMOS.length : i;
  };
  const ordenados = [...resumos].sort((a, b) => posicao(a.agenteId) - posicao(b.agenteId));
  const saida: { agenteId: string; nome: string; texto: string }[] = [];
  for (const r of ordenados) {
    try {
      const estado = estadoDo(r.agenteId);
      if (estado === "pausado" || estado === "desligado") continue;
      const texto = r.resumoDoDia();
      const limpo = texto === null ? "" : umaLinha(texto, 200);
      if (limpo !== "") saida.push({ agenteId: r.agenteId, nome: r.nome, texto: limpo });
    } catch (erro) {
      console.error(`rotinas: o resumo de ${r.agenteId} falhou: ${String(erro)}`);
    }
  }
  return saida;
}
