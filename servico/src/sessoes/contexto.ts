import type { FerramentaSessao, MudancaSessao } from "@moductus/contrato";
import type { RepositorioSessoes } from "./sessoes.ts";
import {
  lerLinhaTranscript,
  lerTranscriptDoDisco,
  pastaDosProjetosClaude,
  transcriptPermitido,
  type LerTranscript,
} from "./transcript.ts";

/**
 * Contexto e uso das sessões do Claude Code (AGENTS.md §2 Nuno "Lembrete de contexto" e "Gasto",
 * F2-24), pela leitura incremental do transcript que o hook informa.
 *
 * - **Contexto:** os tokens que a última resposta da sessão principal leu (entrada mais cache);
 *   depois de uma compactação, o tamanho que o Claude Code anotou nela.
 * - **Janela:** a que a própria ferramenta informar no transcript; sem isso, a da tabela
 *   {@link JANELAS_POR_MODELO}. Modelo fora da tabela, sem transcript ou sem resposta: o contexto
 *   fica sem janela e a área diz que não sabe. Nada de janela presumida.
 * - **Aviso aos 80%:** só com janela da ferramenta ou da tabela, uma vez por trecho da sessão; a
 *   compactação abre um trecho novo.
 * - **Uso por dia:** cada resposta conta uma vez no PC inteiro (`uso_ia_mensagens`, migração
 *   008), no dia local da linha, com os números que o Claude Code registrou (`fonte` =
 *   `ferramenta`). Um `--fork-session` ou `--resume` que copia o histórico para outra sessão não
 *   conta de novo. Custo fica vazio: é assinatura ou preço que o Moductus ainda não tem (F2-09).
 *
 * As execuções dos próprios agentes do Moductus (`claude -p` pelo adaptador CLI) ficam fora de
 * `uso_ia` por aqui: o CLI delas não recebe `MODUCTUS_HOOKS_TOKEN` (`ambienteDoCli` tira toda
 * variável `MODUCTUS_*`), então os hooks delas levam 401 e nenhuma sessão nem leitura nasce. O uso
 * delas é registrado pela execução (F2-09), sem contar duas vezes.
 */

/** Fração da janela que dispara o aviso (AGENTS.md §2 Nuno). */
export const LIMITE_AVISO = 0.8;

const UM_MILHAO = 1_000_000;
const DUZENTOS_MIL = 200_000;

/**
 * Janela de contexto por id de modelo, versionada aqui. Fonte: documentação oficial da Anthropic,
 * "Context windows" (https://platform.claude.com/docs/en/build-with-claude/context-windows) e
 * "Models overview" (https://platform.claude.com/docs/en/about-claude/models/overview),
 * consultadas em 09/10/2026: os modelos listados com 1M têm 1M como padrão, sem cabeçalho beta;
 * "outros modelos Claude, inclusive o Claude Sonnet 4.5" têm 200k. Modelo novo entra aqui com a
 * fonte; o que não está aqui não tem janela.
 */
export const JANELAS_POR_MODELO: Readonly<Record<string, number>> = {
  "claude-fable-5-1": UM_MILHAO,
  "claude-mythos-5-1": UM_MILHAO,
  "claude-fable-5": UM_MILHAO,
  "claude-mythos-5": UM_MILHAO,
  "claude-mythos-preview": UM_MILHAO,
  "claude-opus-5-5": UM_MILHAO,
  "claude-opus-5": UM_MILHAO,
  "claude-opus-4-8": UM_MILHAO,
  "claude-opus-4-7": UM_MILHAO,
  "claude-opus-4-6": UM_MILHAO,
  "claude-sonnet-5-5": UM_MILHAO,
  "claude-sonnet-5": UM_MILHAO,
  "claude-sonnet-4-6": UM_MILHAO,
  "claude-haiku-5-5": UM_MILHAO,
  "claude-opus-4-5": DUZENTOS_MIL,
  "claude-opus-4-1": DUZENTOS_MIL,
  "claude-opus-4": DUZENTOS_MIL,
  "claude-opus-4-0": DUZENTOS_MIL,
  "claude-sonnet-4-5": DUZENTOS_MIL,
  "claude-sonnet-4": DUZENTOS_MIL,
  "claude-sonnet-4-0": DUZENTOS_MIL,
  "claude-haiku-4-5": DUZENTOS_MIL,
  "claude-3-7-sonnet": DUZENTOS_MIL,
  "claude-3-5-sonnet": DUZENTOS_MIL,
  "claude-3-5-haiku": DUZENTOS_MIL,
  "claude-3-opus": DUZENTOS_MIL,
  "claude-3-haiku": DUZENTOS_MIL,
};

/**
 * Janela de um id de modelo pela tabela. Aceita o id como o Claude Code e as nuvens o escrevem:
 * com data (`claude-haiku-4-5-20251001`, `claude-opus-4-5@20251101`), com prefixo e versão do
 * Bedrock (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) e com o `[1m]` do modo de 1 milhão,
 * que pede essa janela a um modelo que a tabela conhece. Fora da tabela: `null`.
 */
export function janelaDaTabela(modelo: string | null): number | null {
  if (!modelo) return null;
  let id = modelo.trim().toLowerCase();
  const umMilhao = /\[1m\]$/.test(id);
  id = id.replace(/\[1m\]$/, "");
  const inicio = id.indexOf("claude-");
  if (inicio === -1) return null;
  id = id
    .slice(inicio)
    .replace(/-v\d+(:\d+)?$/, "")
    .replace(/[-@]\d{8}$/, "");
  const janela = Object.hasOwn(JANELAS_POR_MODELO, id) ? JANELAS_POR_MODELO[id] : undefined;
  if (janela === undefined) return null;
  return umMilhao ? Math.max(janela, UM_MILHAO) : janela;
}

/** Dia local (`AAAA-MM-DD`) de um instante: o uso entra no dia do relógio do usuário. */
export function diaLocal(instante: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${instante.getFullYear()}-${dois(instante.getMonth() + 1)}-${dois(instante.getDate())}`;
}

/** Porcentagem inteira, para baixo: 79,9% ainda não é 80%. */
export const porcentagem = (usado: number, janela: number) => Math.floor((usado * 100) / janela);

/** Nome das ferramentas na fala do Nuno. */
export const NOME_DA_FERRAMENTA: Readonly<Record<FerramentaSessao, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
  antigravity: "Antigravity",
};

export interface AvisoContexto {
  sessaoId: string;
  titulo: string;
  corpo: string;
  usadoTokens: number;
  janelaTokens: number;
}

/** A fala do aviso, na voz do Nuno: número primeiro, até duas frases, a saída no fim. */
export function textoDoAviso(
  ferramenta: FerramentaSessao,
  projeto: string | null,
  usado: number,
  janela: number,
): Pick<AvisoContexto, "titulo" | "corpo"> {
  const pct = porcentagem(usado, janela);
  const onde = projeto ? ` em ${projeto}` : "";
  return {
    titulo: `Contexto em ${pct}%`,
    corpo: `A sessão do ${NOME_DA_FERRAMENTA[ferramenta]}${onde} chegou a ${pct}% do contexto. Vale compactar com /compact ou encerrar.`,
  };
}

/** Uso somado por dia e modelo. */
export interface UsoDoDia {
  dia: string;
  modelo: string;
  entrada: number;
  saida: number;
  cache: number;
}

/** O uso de uma resposta, com a chave que a identifica no PC inteiro (`null`: sem id, conta sempre). */
export interface UsoDaResposta extends UsoDoDia {
  chave: string | null;
}

/** Soma por dia e modelo as respostas que contam, sem as que não gastaram nada. */
export function somarPorDia(respostas: readonly UsoDoDia[]): UsoDoDia[] {
  const usos = new Map<string, UsoDoDia>();
  for (const r of respostas) {
    const chave = `${r.dia}\u0000${r.modelo}`;
    const soma = usos.get(chave) ?? { dia: r.dia, modelo: r.modelo, entrada: 0, saida: 0, cache: 0 };
    soma.entrada += r.entrada;
    soma.saida += r.saida;
    soma.cache += r.cache;
    usos.set(chave, soma);
  }
  return [...usos.values()].filter((u) => u.entrada + u.saida + u.cache > 0);
}

/** De onde a leitura parte (o que está gravado na sessão). */
export interface PontoDeLeitura {
  usado: number | null;
  modelo: string | null;
}

/**
 * Soma as linhas de uma leitura: o contexto e o modelo da última resposta da sessão principal,
 * cada resposta uma vez, a janela que a ferramenta informou e se houve compactação.
 */
export class SomaDaLeitura {
  usado: number | null;
  modelo: string | null;
  compactou = false;
  /** Leu alguma linha que interessa: há o que gravar. */
  mudou = false;
  /** Janela por modelo, quando a própria ferramenta informa. */
  readonly janelasDaFerramenta = new Map<string, number>();
  private readonly respostas = new Map<string, UsoDaResposta>();
  private readonly semId: UsoDaResposta[] = [];

  constructor(
    inicio: PontoDeLeitura,
    private readonly agora: () => Date,
  ) {
    this.usado = inicio.usado;
    this.modelo = inicio.modelo;
  }

  linha(bruta: string): void {
    const lida = lerLinhaTranscript(bruta);
    if (!lida) return;
    this.mudou = true;
    if (lida.tipo === "compactacao") {
      this.usado = lida.tokensDepois;
      this.compactou = true;
      return;
    }
    if (lida.tipo === "janela") {
      for (const [modelo, janela] of Object.entries(lida.janelas))
        this.janelasDaFerramenta.set(modelo, janela);
      return;
    }
    if (!lida.lateral) {
      this.usado = lida.entrada + lida.cacheCriado + lida.cacheLido;
      this.modelo = lida.modelo;
    }
    const chave = lida.mensagemId ? `${lida.mensagemId}\u0000${lida.requisicaoId ?? ""}` : null;
    // As linhas de uma resposta repetem o mesmo uso: vale a primeira.
    if (chave && this.respostas.has(chave)) return;
    const instante = lida.instante ? new Date(lida.instante) : this.agora();
    const resposta: UsoDaResposta = {
      chave,
      dia: diaLocal(Number.isNaN(instante.getTime()) ? this.agora() : instante),
      modelo: lida.modelo,
      entrada: lida.entrada,
      saida: lida.saida,
      cache: lida.cacheCriado + lida.cacheLido,
    };
    if (chave) this.respostas.set(chave, resposta);
    else this.semId.push(resposta);
  }

  /** As respostas lidas; `comSemId` falso deixa de fora as que não dá para reconhecer depois. */
  usoPorResposta(comSemId: boolean): UsoDaResposta[] {
    return [...this.respostas.values(), ...(comSemId ? this.semId : [])];
  }

  /** A janela do modelo atual: a que a ferramenta informou nesta leitura, senão a da tabela. */
  janela(): number | null {
    if (!this.modelo) return null;
    return this.janelasDaFerramenta.get(this.modelo) ?? janelaDaTabela(this.modelo);
  }
}

/** O que a leitura do contexto precisa de fora; os testes trocam o disco e a pasta do Claude Code. */
export interface Transcripts {
  ler: LerTranscript;
  /** A pasta `projects` do Claude Code: transcript fora dela não é lido. */
  pastaProjetos: () => string;
}

export const TRANSCRIPTS_DO_DISCO: Transcripts = {
  ler: lerTranscriptDoDisco,
  pastaProjetos: () => pastaDosProjetosClaude(),
};

export interface OpcoesContexto {
  agora: () => Date;
  /** Quem registra e entrega o aviso (notificações) e quem mais quer saber dele (o vigia do Nuno). */
  aoAvisar?: (aviso: AvisoContexto) => void;
}

/**
 * Acompanha o transcript de cada sessão: a cada evento, lê só o que o arquivo ganhou desde a
 * última vez, grava contexto e uso, avisa aos 80% e manda a sessão de novo às janelas. Leituras da
 * mesma sessão nunca correm juntas; evento que chega durante uma leitura pede outra no fim. Nada
 * disso segura a resposta do hook.
 */
export class AcompanhamentoContexto {
  private readonly emAndamento = new Map<string, { pronta: Promise<void>; deNovo: boolean }>();

  constructor(
    private readonly repo: RepositorioSessoes,
    private readonly emitir: (mudanca: MudancaSessao) => void,
    private readonly transcripts: Transcripts,
    private readonly opcoes: OpcoesContexto,
  ) {}

  /** Pede a leitura da sessão; volta na hora. */
  agendar(sessaoId: string): void {
    const atual = this.emAndamento.get(sessaoId);
    if (atual) {
      atual.deNovo = true;
      return;
    }
    const estado = { pronta: Promise.resolve(), deNovo: false };
    this.emAndamento.set(sessaoId, estado);
    estado.pronta = (async () => {
      try {
        do {
          estado.deNovo = false;
          await this.ler(sessaoId);
        } while (estado.deNovo);
      } catch (erro) {
        console.error(`sessões: leitura do transcript falhou: ${String(erro)}`);
      } finally {
        this.emAndamento.delete(sessaoId);
      }
    })();
  }

  /** Espera as leituras em andamento (testes e fechamento). */
  async ociosas(): Promise<void> {
    while (this.emAndamento.size > 0) {
      await Promise.all([...this.emAndamento.values()].map((e) => e.pronta));
    }
  }

  private async ler(sessaoId: string): Promise<void> {
    const ponto = this.repo.leituraTranscript(sessaoId);
    if (!ponto?.caminho) return;
    const real = transcriptPermitido(ponto.caminho, this.transcripts.pastaProjetos());
    if (!real) return;
    const soma = new SomaDaLeitura(ponto, this.opcoes.agora);
    const fim = await this.transcripts.ler(real, ponto.lidoAte, (linha) => soma.linha(linha));
    if (!fim || (fim.lidoAte === ponto.lidoAte && !soma.mudou)) return;

    const agora = this.opcoes.agora().toISOString();
    const janela = soma.janela();
    // A compactação abre um trecho novo: o aviso volta a valer.
    let avisadoEm = soma.compactou ? null : ponto.avisadoEm;
    let aviso: AvisoContexto | null = null;
    if (soma.usado !== null && janela !== null && soma.usado >= janela * LIMITE_AVISO && !avisadoEm) {
      avisadoEm = agora;
      const projeto = ponto.projetoId ? this.repo.projeto(ponto.projetoId) : null;
      aviso = {
        sessaoId,
        ...textoDoAviso(ponto.ferramenta, projeto?.nome ?? null, soma.usado, janela),
        usadoTokens: soma.usado,
        janelaTokens: janela,
      };
    }

    const caminho = ponto.caminho;
    const valeu = this.repo.transacao(() => {
      const gravou = this.repo.gravarLeitura(sessaoId, {
        caminho,
        lidoAte: fim.lidoAte,
        usado: soma.usado,
        janela,
        modelo: soma.modelo,
        avisadoEm,
        agora,
      });
      // Cada resposta conta uma vez no PC: a já contada (por esta sessão, antes de o arquivo ser
      // trocado, ou por outra que copiou o histórico) fica de fora. Arquivo relido do início não
      // conta resposta sem id, que não dá para reconhecer. Se a sessão passou para outro arquivo
      // durante a leitura, o uso lido ainda conta; o resto, não.
      const contam = soma
        .usoPorResposta(!fim.recomecou)
        .filter((r) => r.chave === null || this.repo.marcarRespostaContada(r.chave, agora));
      for (const uso of somarPorDia(contam)) {
        this.repo.somarUso({
          ...uso,
          ferramenta: ponto.ferramenta,
          projetoId: ponto.projetoId,
          fonte: "ferramenta",
          agora,
        });
      }
      return gravou;
    });

    // Só linhas que não interessam: o ponto de leitura andou, mas a sessão não mudou para ninguém.
    if (!soma.mudou || !valeu) return;
    const sessao = this.repo.sessao(sessaoId);
    if (sessao) {
      this.emitir({ sessao, projeto: sessao.projetoId ? this.repo.projeto(sessao.projetoId) : null });
    }
    if (aviso) this.opcoes.aoAvisar?.(aviso);
  }
}
