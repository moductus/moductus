import {
  PERGUNTA_DOS_IGNORADOS,
  RespostaDosIgnorados,
  type PedidoResponderPergunta,
  type PerguntaDosIgnorados,
  type Rotina,
} from "@moductus/contrato";
import { z } from "zod";
import type { MarcasDosVigias } from "../../agentes/vigias/marcas.ts";
import { BRIEFING } from "./atividade.ts";
import { ErroDasRotinas } from "./fechamento.ts";
import type { ServicoRotinas } from "./horarios.ts";
import type { RepositorioRegistroRotinas } from "./rotinas.ts";
import { diaNoFuso } from "./tempo.ts";

/**
 * Rituais ignorados (AGENTS.md §2 "Se você ignorar", ADR-0039). Nada se acumula: o briefing e o
 * fechamento de um dia que continuam sem resposta fecham sozinhos quando uma rotina de outro dia
 * aparece (`ignorado`, em `RepositorioRegistroRotinas.fecharSozinhas`); o briefing de hoje espera
 * o de amanhã, porque pode ter aparecido depois da hora de parar. O fechamento ignorado volta
 * resumido no "Ontem" do briefing seguinte (`ServicoFechamento.semFechamento`).
 *
 * Aqui mora a pergunta: com os 3 últimos briefings fechados sozinhos, seguidos (o dia sem briefing,
 * como o fim de semana fora dos dias dele, não quebra a sequência), a Alba pergunta junto do
 * briefing seguinte "Deixo o briefing mais curto ou desligo?". Uma vez só, em todo o uso deste PC:
 * a marca em `vigias_marcas` guarda o dia em que ela saiu e a resposta. Ela espera resposta só no
 * dia em que saiu; sem resposta, fica como estava. Com o briefing já curto ou desligado, ela não
 * sai nem aparece. A escolha grava na rotina do briefing com o
 * carimbo do usuário, como em Configurações › O dia. Desligado o briefing, lembretes, compromissos
 * e os outros avisos de prazo continuam: nenhum deles depende dele.
 */

const ALBA = "alba";

/** Quantos briefings ignorados seguidos levam à pergunta. */
export const IGNORADOS_SEGUIDOS = 3;

/** A marca da pergunta em `vigias_marcas`: existir é já ter perguntado. */
export const MARCA_PERGUNTA = "alba.ignorados";

export const MENSAGEM_SEM_PERGUNTA = "A Alba não tem pergunta esperando resposta.";
export const MENSAGEM_JA_RESPONDIDA = "Essa pergunta já foi respondida.";

/** As respostas, na ordem em que a fala as oferece. */
const RESPOSTAS = RespostaDosIgnorados.options;

const Marca = z.object({
  dia: z.string(),
  perguntadaEm: z.string(),
  resposta: RespostaDosIgnorados.nullable(),
  respondidaEm: z.string().nullable(),
});
type Marca = z.infer<typeof Marca>;

export interface DependenciasIgnorados {
  lerFuso: () => string;
  registro: Pick<RepositorioRegistroRotinas, "ultimasAcoes">;
  marcas: MarcasDosVigias;
  rotinas: Pick<ServicoRotinas, "definir" | "listar">;
  /** As rotinas como ficaram (`rotinas.mudou`): toda resposta avisa, também o "manter". */
  emitir: (rotinas: Rotina[]) => void;
}

export interface OpcoesIgnorados {
  agora?: () => Date;
}

export class ServicoIgnorados {
  private readonly agora: () => Date;

  constructor(
    private readonly deps: DependenciasIgnorados,
    opcoes: OpcoesIgnorados = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /**
   * O briefing de `dia` apareceu: com os 3 anteriores ignorados seguidos e a pergunta nunca feita,
   * ela sai hoje. Com o briefing já curto (ou desligado), não há o que perguntar, e ela fica para
   * depois. Devolve se perguntou agora.
   */
  conferir(dia: string): boolean {
    if (this.marca() !== null || !this.cabePerguntar()) return false;
    const acoes = this.deps.registro.ultimasAcoes(BRIEFING, dia, IGNORADOS_SEGUIDOS);
    if (acoes.length < IGNORADOS_SEGUIDOS || acoes.some((a) => a !== "ignorado")) return false;
    this.gravar({ dia, perguntadaEm: this.agora().toISOString(), resposta: null, respondidaEm: null });
    return true;
  }

  /**
   * A pergunta à espera de resposta, só no dia em que saiu e enquanto o briefing segue ligado e
   * inteiro: curto ou desligado por Configurações › O dia, ela some.
   */
  pergunta(): PerguntaDosIgnorados | null {
    const marca = this.marca();
    if (marca === null || marca.resposta !== null) return null;
    if (marca.dia !== diaNoFuso(this.agora(), this.deps.lerFuso())) return null;
    if (!this.cabePerguntar()) return null;
    return { agenteId: ALBA, dia: marca.dia, texto: PERGUNTA_DOS_IGNORADOS, respostas: [...RESPOSTAS] };
  }

  /**
   * Grava a escolha: "mais curto" liga o briefing curto, "desligar" desliga o briefing, "manter"
   * deixa como está. Avisa `rotinas.mudou` uma vez, mesmo sem nada mudar: a janela relê
   * `rotinas.hoje` por ele. Volta o briefing como ficou.
   */
  responder(pedido: PedidoResponderPergunta): Rotina {
    const resposta = RespostaDosIgnorados.parse(pedido.resposta);
    const marca = this.marca();
    if (marca === null || this.pergunta() === null) {
      throw new ErroDasRotinas(marca?.resposta ? MENSAGEM_JA_RESPONDIDA : MENSAGEM_SEM_PERGUNTA);
    }
    const antes = this.briefing();
    let briefing: Rotina | null;
    if (resposta === "curto") briefing = this.deps.rotinas.definir({ id: BRIEFING, curta: true });
    else if (resposta === "desligar") briefing = this.deps.rotinas.definir({ id: BRIEFING, ativa: false });
    else briefing = antes;
    if (!briefing) throw new Error("a rotina do briefing não se lê");
    this.gravar({ ...marca, resposta, respondidaEm: this.agora().toISOString() });
    // `definir` só avisa quando grava algo diferente; aqui o aviso sai sempre, uma vez.
    if (JSON.stringify(briefing) === JSON.stringify(antes)) this.deps.emitir(this.deps.rotinas.listar());
    return briefing;
  }

  private briefing(): Rotina | null {
    return this.deps.rotinas.listar().find((r) => r.id === BRIEFING) ?? null;
  }

  /** Só se pergunta pelo briefing que está ligado e inteiro. */
  private cabePerguntar(): boolean {
    const briefing = this.briefing();
    return briefing !== null && briefing.ativa && !briefing.curta;
  }

  /** A marca da pergunta; a que não se lê conta como feita (melhor calar do que repetir). */
  private marca(): Marca | null {
    const valor = this.deps.marcas.ler(MARCA_PERGUNTA);
    if (valor === null) return null;
    let bruto: unknown;
    try {
      bruto = JSON.parse(valor);
    } catch {
      bruto = null;
    }
    const lida = Marca.safeParse(bruto);
    if (lida.success) return lida.data;
    console.error("ignorados: a marca da pergunta não se lê; ela não sai de novo");
    return { dia: "", perguntadaEm: "", resposta: "manter", respondidaEm: null };
  }

  private gravar(marca: Marca): void {
    this.deps.marcas.gravar(MARCA_PERGUNTA, JSON.stringify(marca));
  }
}
