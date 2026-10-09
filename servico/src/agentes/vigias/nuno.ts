import type { DatabaseSync } from "node:sqlite";
import type { EstadoSessao, ItemGithub, MudancaSessao, SituacaoGithub } from "@moductus/contrato";
import { novoId } from "../../banco/ulid.ts";
import { motivoDoItem } from "../../conexoes/github/github.ts";
import { LIMITE_AVISO, NOME_DA_FERRAMENTA, type AvisoContexto } from "../../sessoes/contexto.ts";
import type { PedidoExecucao, ResultadoExecucao } from "../runtime.ts";

/**
 * Os vigias do Nuno (AGENTS.md §6 "Sempre vivos"): código sem token que acompanha as sessões de
 * IA, o contexto delas e o GitHub, e anota numa pauta o que passou a precisar de você. O modelo
 * só acorda para **resumir** (um item do GitHub que passou a precisar de você) ou **priorizar**
 * (duas ou mais coisas pendentes ao mesmo tempo). Uma coisa só, que não seja do GitHub, já aparece
 * sozinha no dock (o estado da sessão, o aviso de contexto gravado pela leitura do transcript) e
 * não pede julgamento: espera companhia na pauta.
 *
 * O que sai do modelo vira um aviso do Nuno em `notificacoes`; quem entrega é a área de
 * notificações. Sem modelo, nada se perde: a pauta fica e o próximo evento (no máximo a próxima
 * leitura do GitHub) tenta de novo.
 */

export const NUNO = "nuno";

/**
 * Quanto uma sessão espera você antes de entrar na conta: quem responde logo não precisa de aviso,
 * e o `idle_prompt` do Claude Code chega a cada fim de turno.
 */
export const JANELA_SESSAO_MS = 5 * 60_000;

/** Espaço mínimo entre dois despertares que não trazem novidade do GitHub, e depois de uma falha. */
export const INTERVALO_MINIMO_MS = 15 * 60_000;

type Fonte = "github" | "sessao" | "contexto";

interface Fato {
  chave: string;
  fonte: Fonte;
  /** Uma linha, na voz do Nuno, que vai ao modelo. */
  texto: string;
  /** A partir de quando o fato entra na conta (a sessão esperando passa da janela). */
  prontoEm: number;
}

/** O que o despertar produziu, para virar notificação do Nuno. */
export interface AvisoDoNuno {
  titulo: string;
  corpo: string;
  referencia: string;
  execucaoId: string;
}

export interface DependenciasVigiaNuno {
  /** O runtime: o despertar entra na fila do Nuno como qualquer execução. */
  executar: (pedido: PedidoExecucao) => Promise<ResultadoExecucao>;
  /** O cache do GitHub na subida: o que já estava lá não é novidade. */
  githubConhecido: readonly ItemGithub[];
  avisar: (aviso: AvisoDoNuno) => void;
}

export interface OpcoesVigiaNuno {
  agora?: () => Date;
  janelaSessaoMs?: number;
  intervaloMinimoMs?: number;
}

const chaveItem = (i: Pick<ItemGithub, "repositorio" | "numero">) =>
  `${i.repositorio.toLowerCase()}#${i.numero}`;

/** Há o que resumir (novidade do GitHub) ou o que priorizar (duas coisas ou mais). */
function pedeJulgamento(fatos: readonly Fato[]): boolean {
  return fatos.length >= 2 || fatos.some((f) => f.fonte === "github");
}

/** O pedido ao modelo: a pauta e o que fazer com ela. Nada de agir: é um aviso. */
export function pedidoDaPauta(fatos: readonly Fato[]): string {
  return [
    "Os vigias anotaram o que passou a precisar do usuário:",
    ...fatos.map((f) => `- ${f.texto}`),
    "",
    "Resuma e priorize em até duas frases: o que ele deve olhar primeiro e por quê. Confira nas ferramentas antes de afirmar (github.detalhe para resumir um PR). Não comente, não aprove e não aja fora do Moductus: isto é só um aviso.",
  ].join("\n");
}

export class VigiaNuno {
  private readonly pauta = new Map<string, Fato>();
  /** O GitHub da última leitura, para saber o que é novo. */
  private conhecidos: Map<string, ItemGithub>;
  /** Último estado de cada sessão viva, para ver a entrada em "esperando você". */
  private readonly estados = new Map<string, EstadoSessao>();
  private readonly agora: () => Date;
  private readonly janelaSessaoMs: number;
  private readonly intervaloMinimoMs: number;
  private relogio: ReturnType<typeof setTimeout> | null = null;
  private despertar: Promise<void> | null = null;
  /** Chegou fato durante o despertar: confere de novo quando ele terminar. */
  private pendente = false;
  private ultimoDespertar: number | null = null;
  private ultimoFalhou = false;
  private parado = false;

  constructor(
    private readonly deps: DependenciasVigiaNuno,
    opcoes: OpcoesVigiaNuno = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.janelaSessaoMs = opcoes.janelaSessaoMs ?? JANELA_SESSAO_MS;
    this.intervaloMinimoMs = opcoes.intervaloMinimoMs ?? INTERVALO_MINIMO_MS;
    this.conhecidos = new Map(deps.githubConhecido.map((i) => [chaveItem(i), i]));
  }

  /**
   * Cada leitura do GitHub que deu certo (e o desligar, que esvazia). Item que passou a precisar de
   * você, ou mudou o motivo (o CI quebrou num PR que já tinha mudanças pedidas), entra na pauta; o
   * que deixou de precisar sai. A leitura de 15 em 15 minutos é também a hora de tentar de novo.
   */
  aoLerGithub(situacao: SituacaoGithub): void {
    const atuais = new Map(situacao.itens.map((i) => [chaveItem(i), i]));
    const agora = this.agora().getTime();
    for (const [chave, item] of atuais) {
      const motivo = motivoDoItem(item);
      if (!motivo) continue;
      const antes = this.conhecidos.get(chave);
      if (antes && motivoDoItem(antes) === motivo) continue;
      const nome = item.tipo === "pr" ? "PR" : "Issue";
      this.pauta.set(`github:${chave}`, {
        chave: `github:${chave}`,
        fonte: "github",
        texto: `${nome} #${item.numero} de ${item.repositorio} ("${item.titulo}"): ${motivo}.`,
        prontoEm: agora,
      });
    }
    for (const fato of [...this.pauta.values()]) {
      if (fato.fonte !== "github") continue;
      const item = atuais.get(fato.chave.slice("github:".length));
      if (!item || !motivoDoItem(item)) this.pauta.delete(fato.chave);
    }
    this.conhecidos = atuais;
    this.agendar();
  }

  /**
   * Cada mudança de sessão. Entrar em "esperando você" anota (conta depois da janela); sair tira.
   * O contexto que voltou para baixo de 80% (depois do `/compact`) e a sessão encerrada tiram o
   * aviso de contexto da pauta.
   */
  aoMudarSessao({ sessao, projeto }: MudancaSessao): void {
    const chaveSessao = `sessao:${sessao.id}`;
    const chaveContexto = `contexto:${sessao.id}`;
    const antes = this.estados.get(sessao.id);
    if (sessao.estado === "esperando" && antes !== "esperando") {
      const onde = projeto ? ` em ${projeto.nome}` : "";
      this.pauta.set(chaveSessao, {
        chave: chaveSessao,
        fonte: "sessao",
        texto: `A sessão do ${NOME_DA_FERRAMENTA[sessao.ferramenta]}${onde} está esperando você.`,
        prontoEm: this.agora().getTime() + this.janelaSessaoMs,
      });
    } else if (sessao.estado !== "esperando") {
      this.pauta.delete(chaveSessao);
    }
    const ctx = sessao.contexto;
    if (sessao.encerradaEm || (ctx && ctx.usadoTokens < ctx.janelaTokens * LIMITE_AVISO)) {
      this.pauta.delete(chaveContexto);
    }
    // Encerrada ou parada não volta a esperar sem passar por outro estado: sai do acompanhamento.
    if (sessao.encerradaEm || sessao.estado === "parada") this.estados.delete(sessao.id);
    else this.estados.set(sessao.id, sessao.estado);
    this.agendar();
  }

  /** O aviso de contexto alto, depois de gravado pela leitura do transcript. */
  aoAvisarContexto(aviso: AvisoContexto): void {
    const chave = `contexto:${aviso.sessaoId}`;
    this.pauta.set(chave, { chave, fonte: "contexto", texto: aviso.corpo, prontoEm: this.agora().getTime() });
    this.agendar();
  }

  /** Para os relógios; um despertar em andamento termina, mas não agenda outro. */
  parar(): void {
    this.parado = true;
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
  }

  /** Espera o despertar em andamento (testes e fechamento). */
  async ocioso(): Promise<void> {
    while (this.despertar) await this.despertar;
  }

  /** O que está na pauta agora, para conferir. */
  anotados(): string[] {
    return [...this.pauta.keys()].sort();
  }

  private agendar(): void {
    if (this.parado) return;
    if (this.despertar) {
      this.pendente = true;
      return;
    }
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
    const quando = this.proximaConferencia();
    if (quando === null) return;
    this.relogio = setTimeout(
      () => {
        this.relogio = null;
        this.despertar = this.conferir().finally(() => {
          this.despertar = null;
          if (this.pendente) {
            this.pendente = false;
            this.agendar();
          }
        });
      },
      Math.max(0, quando - this.agora().getTime()),
    );
    this.relogio.unref?.();
  }

  /** O primeiro instante em que a pauta pede julgamento, respeitando o espaço entre despertares. */
  private proximaConferencia(): number | null {
    const fatos = [...this.pauta.values()];
    const tempos = [...new Set(fatos.map((f) => f.prontoEm))].sort((a, b) => a - b);
    const quando = tempos.find((t) => pedeJulgamento(fatos.filter((f) => f.prontoEm <= t)));
    if (quando === undefined) return null;
    return Math.max(quando, this.liberadoEm(fatos.filter((f) => f.prontoEm <= quando)));
  }

  /** Novidade do GitHub sai logo; o resto, e tudo depois de uma falha, espera o intervalo. */
  private liberadoEm(fatos: readonly Fato[]): number {
    if (this.ultimoDespertar === null) return 0;
    if (!this.ultimoFalhou && fatos.some((f) => f.fonte === "github")) return 0;
    return this.ultimoDespertar + this.intervaloMinimoMs;
  }

  private async conferir(): Promise<void> {
    const agora = this.agora().getTime();
    const prontos = [...this.pauta.values()].filter((f) => f.prontoEm <= agora);
    if (!pedeJulgamento(prontos) || agora < this.liberadoEm(prontos)) {
      // A pauta mudou desde o agendamento: agenda de novo pelo que ela é agora.
      this.pendente = true;
      return;
    }
    this.ultimoDespertar = agora;
    let resultado: ResultadoExecucao;
    try {
      resultado = await this.deps.executar({
        agenteId: NUNO,
        gatilho: "evento",
        mensagens: [{ papel: "usuario", texto: pedidoDaPauta(prontos) }],
      });
    } catch (erro) {
      this.ultimoFalhou = true;
      console.error(`vigia do Nuno: despertar falhou: ${String(erro)}`);
      return;
    }
    // Sem modelo, com limite ou com erro: a pauta fica para a próxima vez.
    this.ultimoFalhou = resultado.execucao.estado !== "ok";
    if (this.ultimoFalhou) return;
    // Sai da pauta o que foi ao modelo; o que mudou enquanto ele pensava fica.
    for (const fato of prontos) if (this.pauta.get(fato.chave) === fato) this.pauta.delete(fato.chave);
    const corpo = resultado.texto.trim();
    if (corpo === "") return;
    this.deps.avisar({
      titulo: `${prontos.length} ${prontos.length === 1 ? "item precisa" : "itens precisam"} de você`,
      corpo,
      referencia: `vigia:${NUNO}:${resultado.execucao.id}`,
      execucaoId: resultado.execucao.id,
    });
  }
}

/**
 * Grava o aviso do Nuno em `notificacoes` (migração 005), com o carimbo da execução que o escreveu.
 * Quem entrega (aviso do Windows, ponto no dock) é a área de notificações.
 */
export function gravarAvisoDoNuno(db: DatabaseSync): (aviso: AvisoDoNuno) => void {
  const inserir = db.prepare(
    `INSERT INTO notificacoes (id, do_agente_id, tipo, titulo, corpo, referencia, canal, criado_em,
       atualizado_em, origem, agente_id, execucao_id)
     VALUES (?, ?, 'aviso', ?, ?, ?, 'dock', ?, ?, 'agente', ?, ?)`,
  );
  return (aviso) => {
    const agora = new Date().toISOString();
    inserir.run(
      novoId(),
      NUNO,
      aviso.titulo,
      aviso.corpo,
      aviso.referencia,
      agora,
      agora,
      NUNO,
      aviso.execucaoId,
    );
  };
}
