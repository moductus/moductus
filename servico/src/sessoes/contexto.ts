import { readFileSync } from "node:fs";
import type { FerramentaSessao, MudancaSessao } from "@moductus/contrato";
import { caminhoSettingsClaude } from "./ligacao.ts";
import type { RepositorioSessoes } from "./sessoes.ts";
import { lerLinhaTranscript, lerTranscriptDoDisco, type LerTranscript } from "./transcript.ts";

/**
 * Contexto e uso das sessões do Claude Code (AGENTS.md §2 Nuno "Lembrete de contexto" e "Gasto",
 * F2-24), pela leitura incremental do transcript que o hook informa.
 *
 * - **Contexto:** os tokens que a última resposta da sessão principal leu (entrada mais cache);
 *   depois de uma compactação, o tamanho que o Claude Code anotou nela. A janela não está no
 *   transcript: vem de {@link janelaDoContexto}. Sem transcript, sem resposta ou com modelo que o
 *   Moductus não conhece, o contexto fica vazio e a área diz que não sabe.
 * - **Aviso aos 80%:** uma vez por trecho da sessão; a compactação abre um trecho novo.
 * - **Uso por dia:** cada resposta conta uma vez em `uso_ia`, no dia local da linha, com os
 *   números que o Claude Code registrou (`fonte` = `ferramenta`). Custo fica vazio: é assinatura
 *   ou preço que o Moductus ainda não tem (F2-09), e número sem fonte não aparece.
 */

/** Janela padrão dos modelos Claude no Claude Code. */
export const JANELA_PADRAO = 200_000;
/** Janela do modo de 1 milhão (`opus[1m]`, `sonnet[1m]`). */
export const JANELA_ESTENDIDA = 1_000_000;
/** Fração da janela que dispara o aviso (AGENTS.md §2 Nuno). */
export const LIMITE_AVISO = 0.8;

const FAMILIAS = ["opus", "sonnet", "haiku"] as const;
type Familia = (typeof FAMILIAS)[number];

function familia(modelo: string): Familia | null {
  const minusculo = modelo.toLowerCase();
  return FAMILIAS.find((f) => minusculo.includes(f)) ?? null;
}

const temUmMilhao = (modelo: string) => /\[1m\]\s*$/i.test(modelo);

/**
 * A janela de contexto de uma sessão. O transcript traz o id do modelo sem dizer se a sessão
 * usa o modo de 1 milhão, então a janela é a estendida quando há prova: o `[1m]` no próprio id,
 * um contexto que já passou da padrão, ou o `model` do `settings.json` do Claude Code pedindo o
 * modo estendido para a mesma família. Uma vez estendida, a sessão não volta à padrão. Modelo que
 * não é Claude (um proxy, um modelo local) não tem janela conhecida: `null`.
 */
export function janelaDoContexto(
  modelo: string | null,
  usado: number | null,
  configurado: () => string | null,
  anterior: number | null,
): number | null {
  if (!modelo || !/claude-/i.test(modelo)) return anterior;
  const estendida =
    temUmMilhao(modelo) ||
    (usado ?? 0) > JANELA_PADRAO ||
    (anterior ?? 0) > JANELA_PADRAO ||
    ((): boolean => {
      const doUsuario = configurado();
      if (!doUsuario || !temUmMilhao(doUsuario)) return false;
      const deQuem = familia(doUsuario);
      return deQuem !== null && deQuem === familia(modelo);
    })();
  return estendida ? JANELA_ESTENDIDA : JANELA_PADRAO;
}

/** O `model` do `settings.json` do Claude Code; `null` sem arquivo, sem a chave ou com JSON inválido. */
export function modeloDoSettings(caminho: string = caminhoSettingsClaude()): string | null {
  try {
    const dado: unknown = JSON.parse(readFileSync(caminho, "utf8").replace(/^\uFEFF/, ""));
    const modelo = (dado as { model?: unknown } | null)?.model;
    return typeof modelo === "string" && modelo.trim() !== "" ? modelo.trim() : null;
  } catch {
    return null;
  }
}

/** Dia local (`AAAA-MM-DD`) de um instante: o uso entra no dia do relógio do usuário. */
export function diaLocal(instante: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${instante.getFullYear()}-${dois(instante.getMonth() + 1)}-${dois(instante.getDate())}`;
}

/** Porcentagem inteira, para baixo: 79,9% ainda não é 80%. */
export const porcentagem = (usado: number, janela: number) => Math.floor((usado * 100) / janela);

/** Nome das ferramentas na fala do Nuno. */
const NOME: Readonly<Record<FerramentaSessao, string>> = {
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
    corpo: `A sessão do ${NOME[ferramenta]}${onde} chegou a ${pct}% do contexto. Vale compactar com /compact ou encerrar.`,
  };
}

/** Uso somado por dia e modelo numa leitura. */
export interface UsoDoDia {
  dia: string;
  modelo: string;
  entrada: number;
  saida: number;
  cache: number;
}

/** De onde a leitura parte (o que está gravado na sessão). */
export interface PontoDeLeitura {
  usado: number | null;
  modelo: string | null;
  ultimaMensagem: string | null;
}

/**
 * Soma as linhas de uma leitura: o contexto e o modelo da última resposta da sessão principal,
 * o uso de cada resposta uma vez só, e se houve compactação.
 */
export class SomaDaLeitura {
  usado: number | null;
  modelo: string | null;
  ultimaMensagem: string | null;
  compactou = false;
  /** O maior contexto visto nesta leitura, mesmo antes de uma compactação: prova da janela. */
  maiorContexto: number | null;
  /** Leu alguma linha que interessa: há o que gravar. */
  mudou = false;
  private readonly usos = new Map<string, UsoDoDia>();
  /** As respostas já contadas nesta leitura; as linhas de uma resposta vêm em sequência. */
  private readonly contadas = new Set<string>();

  constructor(
    inicio: PontoDeLeitura,
    private readonly agora: () => Date,
  ) {
    this.usado = inicio.usado;
    this.maiorContexto = inicio.usado;
    this.modelo = inicio.modelo;
    this.ultimaMensagem = inicio.ultimaMensagem;
    if (inicio.ultimaMensagem) this.contadas.add(inicio.ultimaMensagem);
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
    if (!lida.lateral) {
      this.usado = lida.entrada + lida.cacheCriado + lida.cacheLido;
      this.maiorContexto = Math.max(this.maiorContexto ?? 0, this.usado);
      this.modelo = lida.modelo;
    }
    if (lida.mensagemId) {
      if (this.contadas.has(lida.mensagemId)) return;
      this.contadas.add(lida.mensagemId);
      this.ultimaMensagem = lida.mensagemId;
    }
    const instante = lida.instante ? new Date(lida.instante) : this.agora();
    const dia = diaLocal(Number.isNaN(instante.getTime()) ? this.agora() : instante);
    const chave = `${dia}\u0000${lida.modelo}`;
    const soma = this.usos.get(chave) ?? { dia, modelo: lida.modelo, entrada: 0, saida: 0, cache: 0 };
    soma.entrada += lida.entrada;
    soma.saida += lida.saida;
    soma.cache += lida.cacheCriado + lida.cacheLido;
    this.usos.set(chave, soma);
  }

  /** O uso por dia e modelo, sem as respostas que não gastaram nada. */
  usoPorDia(): UsoDoDia[] {
    return [...this.usos.values()].filter((u) => u.entrada + u.saida + u.cache > 0);
  }
}

/** O que a leitura do contexto precisa de fora; os testes trocam o disco e o `settings.json`. */
export interface Transcripts {
  ler: LerTranscript;
  /** O `model` que o usuário deixou no Claude Code (o `[1m]` muda a janela). */
  modeloConfigurado: () => string | null;
}

export const TRANSCRIPTS_DO_DISCO: Transcripts = {
  ler: lerTranscriptDoDisco,
  modeloConfigurado: () => modeloDoSettings(),
};

export interface OpcoesContexto {
  agora: () => Date;
  /** Quem mais quer saber do aviso (o vigia do Nuno, F2-26). */
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
    // Só o JSONL que o hook informou: outro arquivo não é transcript.
    if (!ponto?.caminho || !/\.jsonl$/i.test(ponto.caminho)) return;
    const soma = new SomaDaLeitura(ponto, this.opcoes.agora);
    const fim = await this.transcripts.ler(ponto.caminho, ponto.lidoAte, (linha) => soma.linha(linha));
    if (!fim || (fim.lidoAte === ponto.lidoAte && !soma.mudou)) return;

    const agora = this.opcoes.agora().toISOString();
    const janela = janelaDoContexto(
      soma.modelo,
      soma.maiorContexto,
      this.transcripts.modeloConfigurado,
      ponto.janela,
    );
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
        ultimaMensagem: soma.ultimaMensagem,
        usado: soma.usado,
        janela,
        modelo: soma.modelo,
        avisadoEm,
        agora,
      });
      // Arquivo trocado: o uso do que já foi lido já foi contado, e não há como separar o novo. Se a
      // sessão passou para outro arquivo durante a leitura, o uso lido ainda conta; o resto, não.
      if (!fim.recomecou) {
        for (const uso of soma.usoPorDia()) {
          this.repo.somarUso({
            ...uso,
            ferramenta: ponto.ferramenta,
            projetoId: ponto.projetoId,
            fonte: "ferramenta",
            agora,
          });
        }
      }
      if (aviso && gravou) this.repo.registrarAviso(aviso, agora);
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
