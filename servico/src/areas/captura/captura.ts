import {
  PedidoDesfazerCaptura,
  PedidoEntender,
  PedidoLancar,
  TipoLancavel,
  type CamposCaptura,
  type LancamentoCaptura,
  type NovaTarefa,
  type PreviaCaptura,
  type TipoCaptura,
  type TrechoReconhecido,
} from "@moductus/contrato";
import { novoId } from "../../banco/ulid.ts";
import type { ServicoAgenda } from "../agenda/agenda.ts";
import { MENSAGEM_DURACAO_PASSA_DA_REGRA, MENSAGEM_EVENTO_NAO_ENCONTRADO } from "../agenda/agenda.ts";
import { entenderFrase, type FraseEntendida } from "../dia/frases.ts";
import { lerRecorrencia } from "../dia/recorrencia.ts";
import { ehDia, somarDias, TempoDoDia } from "../dia/tempo.ts";
import { MENSAGEM_NAO_ENCONTRADO as LEMBRETE_NAO_ENCONTRADO } from "../lembretes/lembretes.ts";
import type { ServicoLembretes } from "../lembretes/lembretes.ts";
import { MENSAGEM_NAO_ENCONTRADA as NOTA_NAO_ENCONTRADA } from "../notas/notas.ts";
import type { ServicoNotas } from "../notas/notas.ts";
import { ErroDasTarefas, type ServicoTarefas } from "../tarefas/tarefas.ts";
import type { Interpretacao, Interprete } from "./modelo.ts";

/**
 * A captura rápida (PRODUCT.md §3; ADR-0034): a frase solta vira uma prévia ("entendeu como") e só
 * depois do Enter vira tarefa, lembrete, evento ou nota, criada pela área de cada um. Quem entende
 * é o entendedor de frases; o modelo da Alba só entra quando ele não reconhece nada além do título,
 * e sem modelo a frase vira tarefa sem data na Entrada. Gasto e memória são reconhecidos, mas só
 * chegam com a Tula e a Memória: a prévia diz isso e oferece tarefa ou nota.
 *
 * O lançamento dá para desfazer por 10 s; depois, o desfazer diz por quê não dá mais.
 */

/** Quanto tempo depois de lançar o desfazer vale (o quadro `Captura`). */
export const PRAZO_DESFAZER_MS = 10_000;

/** Por quanto tempo o lançamento é lembrado, para o desfazer atrasado explicar por quê. */
const MEMORIA_DOS_LANCAMENTOS_MS = 60 * 60_000;

/** Quantas respostas do modelo ficam guardadas: a mesma frase não pergunta de novo. */
const RESPOSTAS_GUARDADAS = 32;

/** O evento com hora sem duração dita dura uma hora. */
const DURACAO_PADRAO_DO_EVENTO_MIN = 60;

/** Erro da regra da captura: a janela mostra como veio. */
export class ErroDaCaptura extends Error {}

export const AVISO_GASTO = "Gastos chegam com a Tula. Por enquanto, dá para lançar como tarefa ou nota.";
export const AVISO_MEMORIA = "A Memória ainda não chegou. Por enquanto, dá para lançar como nota ou tarefa.";
export const MENSAGEM_FRASE_VAZIA = "Escreva o que quer capturar.";
export const MENSAGEM_LEMBRETE_SEM_HORA = "O lembrete precisa de dia e hora: preencha com Tab.";
export const MENSAGEM_EVENTO_SEM_DIA = "O evento precisa de um dia: preencha com Tab.";
export const MENSAGEM_HORA_SEM_DIA = "A hora precisa de um dia: preencha com Tab.";
export const MENSAGEM_DIA_INVALIDO = "Essa data não existe no calendário.";
export const MENSAGEM_REPETICAO = (motivo: string) => `O Moductus não sabe repetir assim (${motivo}).`;
export const MENSAGEM_JA_DESFEITO = "Este lançamento já foi desfeito.";
export const MENSAGEM_DESFAZER_SUMIU =
  "Este lançamento não dá mais para desfazer: os 10 s passaram ou o Moductus reiniciou desde então.";

/** O que fica e onde tirar, para o desfazer que chegou depois dos 10 s. */
const ONDE_TIRAR: Record<TipoLancavel, string> = {
  tarefa: "A tarefa ficou; para tirar, apague pela área Tarefas.",
  lembrete: "O lembrete ficou; para tirar, cancele pelos lembretes.",
  evento: "O evento ficou; para tirar, apague pela Agenda.",
  nota: "A nota ficou; para tirar, apague pela área Notas.",
};
export const MENSAGEM_PRAZO_DESFAZER = (tipo: TipoLancavel) =>
  `Já passaram os 10 s para desfazer. ${ONDE_TIRAR[tipo]}`;

/**
 * Mensagens das áreas que são da regra (o que a pessoa pode corrigir), não falha por dentro: passam
 * para a janela como vieram.
 */
const MENSAGENS_DAS_AREAS = new Set([
  MENSAGEM_DURACAO_PASSA_DA_REGRA,
  MENSAGEM_EVENTO_NAO_ENCONTRADO,
  LEMBRETE_NAO_ENCONTRADO,
  NOTA_NAO_ENCONTRADA,
]);

export interface DependenciasCaptura {
  lerFuso: () => string;
  tarefas: Pick<ServicoTarefas, "listas" | "criar" | "apagar">;
  lembretes: Pick<ServicoLembretes, "criar" | "cancelar">;
  agenda: Pick<ServicoAgenda, "criarEvento" | "apagarEvento">;
  notas: Pick<ServicoNotas, "criar" | "apagar">;
  /** O modelo da Alba; sem ele, a captura fica só com o código. */
  interpretar?: Interprete | null;
  /** Lançou um lembrete pedido pela captura: a missão "peça um lembrete à Alba" fica feita. */
  pediuLembrete?: () => void;
}

export interface OpcoesCaptura {
  agora?: () => Date;
  gerarId?: () => string;
}

interface Registro {
  lancamento: LancamentoCaptura;
  desfeito: boolean;
}

export class ServicoCaptura {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  private readonly tempo: TempoDoDia;
  private readonly lancamentos = new Map<string, Registro>();
  /** As respostas do modelo por dia e frase, da mais velha para a mais nova. */
  private readonly respostas = new Map<string, Interpretacao | null>();
  /** A pergunta ao modelo em curso: a frase seguinte a cancela. */
  private emCurso: AbortController | null = null;

  constructor(
    private readonly deps: DependenciasCaptura,
    opcoes: OpcoesCaptura = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
    this.tempo = new TempoDoDia(deps.lerFuso, this.agora);
  }

  /** A prévia: o tipo, os campos, o trecho que deu cada um e o "Na verdade é". Nada é criado. */
  async entender(pedido: PedidoEntender): Promise<PreviaCaptura> {
    const { texto } = PedidoEntender.parse(pedido);
    const listas = this.deps.tarefas
      .listas()
      .filter((l) => !l.arquivada)
      .map((l) => ({ id: l.id, nome: l.nome }));
    let frase: FraseEntendida;
    try {
      frase = entenderFrase(texto, this.tempo, { listas });
    } catch (erro) {
      // Só sinal de controle, sem letra nem número: o `PedidoEntender` deixa passar, o entendedor não.
      if (erro instanceof RangeError) throw new ErroDaCaptura(MENSAGEM_FRASE_VAZIA);
      throw erro;
    }
    let tipo: TipoCaptura = frase.tipo;
    let campos: CamposCaptura = frase.campos;
    let trechos: TrechoReconhecido[] = frase.trechos;
    let entendidoPor: PreviaCaptura["entendidoPor"] = "codigo";
    if (!frase.reconheceu) {
      const doModelo = await this.perguntarAoModelo(texto);
      const aplicada = doModelo === null ? null : this.aplicar(doModelo, campos);
      if (aplicada !== null) {
        ({ tipo, campos } = aplicada);
        trechos = [];
        entendidoPor = "modelo";
      }
    }
    return {
      texto,
      tipo,
      campos,
      trechos,
      alternativas: alternativasDe(tipo),
      aviso: tipo === "gasto" ? AVISO_GASTO : tipo === "memoria" ? AVISO_MEMORIA : null,
      entendidoPor,
    };
  }

  /** Lança o que a prévia mostrou, pela área do tipo, e devolve até quando dá para desfazer. */
  async lancar(pedido: PedidoLancar): Promise<LancamentoCaptura> {
    const { texto, tipo, campos } = PedidoLancar.parse(pedido);
    conferir(tipo, campos);
    // Nenhum tipo lançável guarda o valor do gasto: a frase inteira vai junto, para ele não se perder.
    const frase = campos.valorCentavos === null ? null : texto;
    const itemId = await this.pelaArea(async () => {
      switch (tipo) {
        case "tarefa":
          return this.deps.tarefas.criar(this.novaTarefa(campos, frase)).id;
        case "lembrete":
          return (await this.deps.lembretes.criar(this.novoLembrete(campos))).id;
        case "evento":
          return this.deps.agenda.criarEvento(this.novoEvento(campos)).id;
        case "nota":
          return this.deps.notas.criar({
            titulo: campos.titulo,
            ...(frase === null ? {} : { conteudo: frase }),
          }).id;
      }
    });
    const agora = this.agora().getTime();
    this.esquecerAntigos(agora);
    const lancamento: LancamentoCaptura = {
      id: this.gerarId(),
      tipo,
      itemId,
      desfazerAte: new Date(agora + PRAZO_DESFAZER_MS).toISOString(),
    };
    this.lancamentos.set(lancamento.id, { lancamento, desfeito: false });
    if (tipo === "lembrete" || (tipo === "tarefa" && campos.lembreteMinutosAntes !== null)) {
      this.avisarLembrete();
    }
    return lancamento;
  }

  /** Desfaz pela área, dentro dos 10 s; depois, diz por quê não dá mais e onde tirar. */
  async desfazer(pedido: PedidoDesfazerCaptura): Promise<LancamentoCaptura> {
    const { id } = PedidoDesfazerCaptura.parse(pedido);
    const registro = this.lancamentos.get(id);
    if (!registro) throw new ErroDaCaptura(MENSAGEM_DESFAZER_SUMIU);
    if (registro.desfeito) throw new ErroDaCaptura(MENSAGEM_JA_DESFEITO);
    const { lancamento } = registro;
    if (this.agora().getTime() > Date.parse(lancamento.desfazerAte)) {
      throw new ErroDaCaptura(MENSAGEM_PRAZO_DESFAZER(lancamento.tipo));
    }
    // Marcado antes de ir à área: dois desfazer seguidos não apagam duas vezes.
    registro.desfeito = true;
    try {
      await this.pelaArea(async () => {
        const item = { id: lancamento.itemId };
        switch (lancamento.tipo) {
          case "tarefa":
            return this.deps.tarefas.apagar(item);
          case "lembrete":
            return this.deps.lembretes.cancelar({ ids: [lancamento.itemId] });
          case "evento":
            return this.deps.agenda.apagarEvento(item);
          case "nota":
            return this.deps.notas.apagar(item);
        }
      });
    } catch (erro) {
      registro.desfeito = false;
      throw erro;
    }
    return lancamento;
  }

  // Lançar

  private novaTarefa(campos: CamposCaptura, frase: string | null): NovaTarefa {
    return {
      titulo: campos.titulo,
      ...(campos.listaId === null ? {} : { listaId: campos.listaId }),
      venceEm: campos.dia,
      hora: campos.hora,
      duracaoEstimadaMin: campos.duracaoMin,
      recorrencia: campos.recorrencia,
      // Sem antecedência dita, a tarefa com hora ganha o lembrete padrão das Tarefas.
      ...(campos.lembreteMinutosAntes === null ? {} : { lembreteMinutosAntes: campos.lembreteMinutosAntes }),
      ...(frase === null ? {} : { notas: frase }),
    };
  }

  /** O lembrete toca na hora dita, ou antes dela se a frase deu a antecedência. */
  private novoLembrete(campos: CamposCaptura) {
    const hora = this.tempo.instante(campos.dia!, campos.hora!).getTime();
    const quando = new Date(hora - (campos.lembreteMinutosAntes ?? 0) * 60_000).toISOString();
    return { texto: campos.titulo, quando, recorrencia: campos.recorrencia };
  }

  /** Com hora, do início à duração dita (uma hora sem ela); sem hora, o dia inteiro. */
  private novoEvento(campos: CamposCaptura) {
    const base = {
      titulo: campos.titulo,
      recorrencia: campos.recorrencia,
      alertas: campos.lembreteMinutosAntes === null ? [] : [campos.lembreteMinutosAntes],
    };
    const dia = campos.dia!;
    if (campos.hora === null) {
      return { ...base, inicio: dia, fim: somarDias(dia, 1), diaInteiro: true };
    }
    const inicio = this.tempo.instante(dia, campos.hora);
    const minutos = campos.duracaoMin ?? DURACAO_PADRAO_DO_EVENTO_MIN;
    const fim = new Date(inicio.getTime() + minutos * 60_000);
    return { ...base, inicio: inicio.toISOString(), fim: fim.toISOString(), diaInteiro: false };
  }

  /**
   * Erro da regra de uma área vira erro da captura, com a mensagem dela; o resto (o banco, uma
   * conta) segue como falha por dentro, que o canal não deixa vazar.
   */
  private async pelaArea<T>(fazer: () => Promise<T>): Promise<T> {
    try {
      return await fazer();
    } catch (erro) {
      if (
        erro instanceof ErroDasTarefas ||
        (erro instanceof Error && MENSAGENS_DAS_AREAS.has(erro.message))
      ) {
        throw new ErroDaCaptura(erro.message, { cause: erro });
      }
      throw erro;
    }
  }

  private avisarLembrete(): void {
    try {
      this.deps.pediuLembrete?.();
    } catch (erro) {
      // A missão do tutorial não desfaz o lembrete que já foi criado.
      console.error(`captura: missão do lembrete não marcada: ${String(erro)}`);
    }
  }

  private esquecerAntigos(agora: number): void {
    for (const [id, { lancamento }] of this.lancamentos) {
      if (Date.parse(lancamento.desfazerAte) + MEMORIA_DOS_LANCAMENTOS_MS >= agora) break;
      this.lancamentos.delete(id);
    }
  }

  // O modelo

  /** A resposta do modelo para a frase; a mesma frase no mesmo dia não pergunta de novo. */
  private async perguntarAoModelo(texto: string): Promise<Interpretacao | null> {
    const interpretar = this.deps.interpretar;
    if (!interpretar) return null;
    const hoje = this.tempo.hoje();
    const chave = `${hoje}\n${texto}`;
    if (this.respostas.has(chave)) return this.respostas.get(chave)!;
    // A frase anterior ainda esperava: ela fica com o que o código entendeu.
    this.emCurso?.abort();
    const controle = new AbortController();
    this.emCurso = controle;
    let resposta: Interpretacao | null;
    try {
      resposta = await interpretar({ texto, hoje, agora: this.tempo.momento().hora, sinal: controle.signal });
    } catch (erro) {
      console.error(
        `captura: o modelo da Alba falhou: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      resposta = null;
    } finally {
      if (this.emCurso === controle) this.emCurso = null;
    }
    // Cancelada pela frase seguinte não é resposta: pode perguntar de novo.
    if (controle.signal.aborted) return null;
    this.respostas.set(chave, resposta);
    if (this.respostas.size > RESPOSTAS_GUARDADAS) this.respostas.delete(this.respostas.keys().next().value!);
    return resposta;
  }

  /**
   * O que o modelo disse sobre a frase que o código não entendeu, com as mesmas regras do
   * entendedor: hora sem dia é hoje (amanhã, se já passou), antecedência só com hora, evento sem dia
   * e lembrete sem hora viram tarefa. Só o título, sem mais nada, não muda a prévia (`null`).
   */
  private aplicar(
    m: Interpretacao,
    doCodigo: CamposCaptura,
  ): { tipo: TipoCaptura; campos: CamposCaptura } | null {
    let dia = m.dia;
    if (dia === null && m.hora !== null) {
      dia = m.hora > this.tempo.momento().hora ? this.tempo.hoje() : this.tempo.amanha();
    }
    const hora = dia === null ? null : m.hora;
    const campos: CamposCaptura = {
      titulo: m.titulo ?? doCodigo.titulo,
      dia,
      hora,
      duracaoMin: m.duracaoMin,
      recorrencia: m.recorrencia,
      lembreteMinutosAntes: hora === null ? null : m.lembreteMinutosAntes,
      listaId: doCodigo.listaId,
      valorCentavos: m.tipo === "gasto" ? m.valorCentavos : null,
    };
    let tipo: TipoCaptura = m.tipo ?? "tarefa";
    if ((tipo === "evento" && dia === null) || (tipo === "lembrete" && hora === null)) tipo = "tarefa";
    const algoMais =
      tipo !== "tarefa" || campos.dia !== null || campos.duracaoMin !== null || campos.recorrencia !== null;
    return algoMais ? { tipo, campos } : null;
  }
}

/** Os outros tipos do "Na verdade é", na ordem das teclas 1, 2 e 3. */
export function alternativasDe(tipo: TipoCaptura): TipoLancavel[] {
  if (tipo === "gasto") return ["tarefa", "nota"];
  if (tipo === "memoria") return ["nota", "tarefa"];
  return TipoLancavel.options.filter((t) => t !== tipo);
}

/** O que cada tipo precisa para ser lançado; o que falta a pessoa preenche com Tab. */
function conferir(tipo: TipoLancavel, campos: CamposCaptura): void {
  if (campos.dia !== null && !ehDia(campos.dia)) throw new ErroDaCaptura(MENSAGEM_DIA_INVALIDO);
  if (tipo === "lembrete" && (campos.dia === null || campos.hora === null)) {
    throw new ErroDaCaptura(MENSAGEM_LEMBRETE_SEM_HORA);
  }
  if (tipo === "evento" && campos.dia === null) throw new ErroDaCaptura(MENSAGEM_EVENTO_SEM_DIA);
  if (campos.hora !== null && campos.dia === null) throw new ErroDaCaptura(MENSAGEM_HORA_SEM_DIA);
  if (campos.recorrencia !== null) {
    let motivo: string | null;
    try {
      const leitura = lerRecorrencia(campos.recorrencia);
      motivo = leitura.entendida ? null : leitura.motivo;
    } catch (erro) {
      motivo = erro instanceof Error ? erro.message : String(erro);
    }
    if (motivo !== null) throw new ErroDaCaptura(MENSAGEM_REPETICAO(motivo));
  }
}
