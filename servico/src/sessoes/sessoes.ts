import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { win32 } from "node:path";
import {
  PedidoEventosSessao,
  PedidoUso,
  type EstadoSessao,
  type EventoSessao,
  type FerramentaSessao,
  type FonteUso,
  type ListaSessoes,
  type MudancaSessao,
  type Projeto,
  type SessaoIa,
  type UsoIa,
} from "@moductus/contrato";
import { novoId } from "../banco/ulid.ts";
import { AcompanhamentoContexto, type AvisoContexto, type Transcripts, type UsoDoDia } from "./contexto.ts";
import { estadoDepois, type EventoHook } from "./hooks.ts";

/** Sem evento por este tempo, a sessão aberta vira `parada` (AGENTS.md §5). */
export const LIMITE_PARADA_MS = 30 * 60_000;
/** Sessões encerradas ou paradas continuam na lista por um dia depois do último evento. */
const RECENTE_MS = 24 * 60 * 60_000;
/** Por quanto tempo uma resposta contada em `uso_ia` é lembrada (contra cópia de histórico). */
export const GUARDA_RESPOSTAS_MS = 90 * 24 * 60 * 60_000;
const LIMITE_LISTA = 100;
const LIMITE_EVENTOS = 50;

/** Linhas gravadas pelos hooks levam a origem `conexao` (DATA.md §1): ninguém as digitou. */
const ORIGEM = "conexao";

interface LinhaProjeto {
  id: string;
  nome: string;
  caminho: string;
  repositorio: string | null;
  arquivado: number;
}

interface LinhaSessao {
  id: string;
  projeto_id: string | null;
  ferramenta: FerramentaSessao;
  id_externo: string;
  modelo: string | null;
  estado: EstadoSessao;
  iniciada_em: string | null;
  ultimo_evento_em: string | null;
  encerrada_em: string | null;
  contexto_usado_tokens: number | null;
  contexto_janela_tokens: number | null;
  e_id: string | null;
  e_tipo: string | null;
  e_ferramenta: string | null;
  e_resumo: string | null;
  e_criado_em: string | null;
}

interface LinhaEvento {
  id: string;
  sessao_id: string;
  tipo: string;
  ferramenta_usada: string | null;
  entrada_resumo: string | null;
  criado_em: string;
}

const SELECT_SESSAO = `
  SELECT s.id, s.projeto_id, s.ferramenta, s.id_externo, s.modelo, s.estado, s.iniciada_em,
         s.ultimo_evento_em, s.encerrada_em, s.contexto_usado_tokens, s.contexto_janela_tokens,
         e.id AS e_id, e.tipo AS e_tipo, e.ferramenta_usada AS e_ferramenta,
         e.entrada_resumo AS e_resumo, e.criado_em AS e_criado_em
    FROM sessoes_ia s
    LEFT JOIN eventos_sessao e
      ON e.id = (SELECT id FROM eventos_sessao WHERE sessao_id = s.id ORDER BY id DESC LIMIT 1)`;

/** Onde parou a leitura do transcript de uma sessão (migração 007), e o que ela já sabe. */
export interface LeituraGravada {
  ferramenta: FerramentaSessao;
  projetoId: string | null;
  caminho: string | null;
  lidoAte: number;
  usado: number | null;
  janela: number | null;
  modelo: string | null;
  avisadoEm: string | null;
}

interface LinhaLeitura {
  ferramenta: FerramentaSessao;
  projeto_id: string | null;
  transcript_caminho: string | null;
  transcript_lido_bytes: number | null;
  contexto_usado_tokens: number | null;
  contexto_janela_tokens: number | null;
  modelo: string | null;
  contexto_avisado_em: string | null;
}

interface LinhaUso {
  dia: string;
  ferramenta: FerramentaSessao;
  modelo: string | null;
  projeto_id: string | null;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache: number;
  custo_estimado_microdolares: number | null;
  fonte: FonteUso;
}

/** O agente que fala das sessões de IA; o aviso de contexto sai em nome dele. */
const NUNO = "nuno";

const paraProjeto = (l: LinhaProjeto): Projeto => ({
  id: l.id,
  nome: l.nome,
  caminho: l.caminho,
  repositorio: l.repositorio,
  arquivado: l.arquivado === 1,
});

const paraEvento = (l: LinhaEvento): EventoSessao => ({
  id: l.id,
  sessaoId: l.sessao_id,
  tipo: l.tipo,
  ferramentaUsada: l.ferramenta_usada,
  entradaResumo: l.entrada_resumo,
  recebidoEm: l.criado_em,
});

function paraSessao(l: LinhaSessao): SessaoIa {
  const usado = l.contexto_usado_tokens;
  const janela = l.contexto_janela_tokens;
  return {
    id: l.id,
    projetoId: l.projeto_id,
    ferramenta: l.ferramenta,
    idExterno: l.id_externo,
    modelo: l.modelo,
    estado: l.estado,
    iniciadaEm: l.iniciada_em,
    ultimoEventoEm: l.ultimo_evento_em,
    encerradaEm: l.encerrada_em,
    // Sem os dois números, não há contexto: a área diz que não sabe.
    contexto:
      usado !== null && janela !== null && janela > 0 ? { usadoTokens: usado, janelaTokens: janela } : null,
    ultimoEvento:
      l.e_id && l.e_tipo && l.e_criado_em
        ? paraEvento({
            id: l.e_id,
            sessao_id: l.id,
            tipo: l.e_tipo,
            ferramenta_usada: l.e_ferramenta,
            entrada_resumo: l.e_resumo,
            criado_em: l.e_criado_em,
          })
        : null,
  };
}

/** Caminho do Windows para comparar: barra invertida, sem barra no fim, sem diferença de caixa. */
function chaveCaminho(caminho: string): string {
  return caminho.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** `cwd` dentro de `base` (ou igual a ela). */
function dentroDe(cwd: string, base: string): boolean {
  const a = chaveCaminho(cwd);
  const b = chaveCaminho(base);
  return a === b || a.startsWith(`${b}\\`);
}

/**
 * Pasta do projeto de um `cwd` ainda sem projeto: a primeira acima dele (ou ele mesmo) com
 * `.git`, como o repositório onde a sessão roda; sem repositório, o próprio `cwd`.
 */
export function raizPeloGit(cwd: string, existe: (caminho: string) => boolean = existsSync): string {
  let atual = win32.resolve(cwd);
  for (;;) {
    if (existe(win32.join(atual, ".git"))) return atual;
    const acima = win32.dirname(atual);
    if (acima === atual) return win32.resolve(cwd);
    atual = acima;
  }
}

/** Leitura e gravação de `projetos`, `sessoes_ia` e `eventos_sessao` (migração 004). */
export class RepositorioSessoes {
  constructor(private readonly db: DatabaseSync) {}

  projetosVivos(): Projeto[] {
    const linhas = this.db
      .prepare("SELECT id, nome, caminho, repositorio, arquivado FROM projetos WHERE apagado_em IS NULL")
      .all() as unknown as LinhaProjeto[];
    return linhas.map(paraProjeto);
  }

  projeto(id: string): Projeto | null {
    const linha = this.db
      .prepare(
        "SELECT id, nome, caminho, repositorio, arquivado FROM projetos WHERE id = ? AND apagado_em IS NULL",
      )
      .get(id) as unknown as LinhaProjeto | undefined;
    return linha ? paraProjeto(linha) : null;
  }

  criarProjeto(id: string, nome: string, caminho: string, agora: string): void {
    this.db
      .prepare(
        "INSERT INTO projetos (id, nome, caminho, criado_em, atualizado_em, origem) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, nome, caminho, agora, agora, ORIGEM);
  }

  sessaoPorExterno(ferramenta: FerramentaSessao, idExterno: string): SessaoIa | null {
    const linha = this.db
      .prepare(`${SELECT_SESSAO} WHERE s.ferramenta = ? AND s.id_externo = ?`)
      .get(ferramenta, idExterno) as unknown as LinhaSessao | undefined;
    return linha ? paraSessao(linha) : null;
  }

  sessao(id: string): SessaoIa | null {
    const linha = this.db.prepare(`${SELECT_SESSAO} WHERE s.id = ?`).get(id) as unknown as
      LinhaSessao | undefined;
    return linha ? paraSessao(linha) : null;
  }

  criarSessao(s: {
    id: string;
    projetoId: string | null;
    ferramenta: FerramentaSessao;
    idExterno: string;
    modelo: string | null;
    estado: EstadoSessao;
    agora: string;
    encerrada: boolean;
    transcript: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sessoes_ia (id, projeto_id, ferramenta, id_externo, modelo, estado, iniciada_em,
           ultimo_evento_em, encerrada_em, transcript_caminho, criado_em, atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id,
        s.projetoId,
        s.ferramenta,
        s.idExterno,
        s.modelo,
        s.estado,
        s.agora,
        s.agora,
        s.encerrada ? s.agora : null,
        s.transcript,
        s.agora,
        s.agora,
        ORIGEM,
      );
  }

  /**
   * Atualiza a sessão com o evento; o que o evento não traz continua como estava. Transcript em
   * outro arquivo é lido do início (no `SET`, a coluna ainda tem o valor de antes).
   */
  atualizarSessao(s: {
    id: string;
    projetoId: string | null;
    modelo: string | null;
    estado: EstadoSessao;
    agora: string;
    encerrada: boolean;
    transcript: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE sessoes_ia
            SET projeto_id = coalesce(?, projeto_id), modelo = coalesce(?, modelo), estado = ?,
                ultimo_evento_em = ?, encerrada_em = ?, transcript_caminho = coalesce(?, transcript_caminho),
                transcript_lido_bytes = CASE WHEN coalesce(?, transcript_caminho) IS transcript_caminho
                                             THEN transcript_lido_bytes END,
                atualizado_em = ?, origem = ?, agente_id = NULL, execucao_id = NULL
          WHERE id = ?`,
      )
      .run(
        s.projetoId,
        s.modelo,
        s.estado,
        s.agora,
        s.encerrada ? s.agora : null,
        s.transcript,
        s.transcript,
        s.agora,
        ORIGEM,
        s.id,
      );
  }

  inserirEvento(e: {
    id: string;
    sessaoId: string;
    tipo: string;
    ferramenta: string | null;
    resumo: string | null;
    agora: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO eventos_sessao (id, sessao_id, tipo, ferramenta_usada, entrada_resumo, criado_em,
           atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.sessaoId, e.tipo, e.ferramenta, e.resumo, e.agora, e.agora, ORIGEM);
  }

  /** Abertas e ainda vivas, mais tudo que teve evento desde `desde`; a mais recente primeiro. */
  listar(desde: string, limite: number): SessaoIa[] {
    const linhas = this.db
      .prepare(
        `${SELECT_SESSAO}
          WHERE s.ultimo_evento_em >= ? OR (s.encerrada_em IS NULL AND s.estado <> 'parada')
          ORDER BY s.ultimo_evento_em DESC, s.id DESC
          LIMIT ?`,
      )
      .all(desde, limite) as unknown as LinhaSessao[];
    return linhas.map(paraSessao);
  }

  eventos(sessaoId: string, limite: number): EventoSessao[] {
    const linhas = this.db
      .prepare(
        `SELECT id, sessao_id, tipo, ferramenta_usada, entrada_resumo, criado_em
           FROM eventos_sessao WHERE sessao_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(sessaoId, limite) as unknown as LinhaEvento[];
    return linhas.map(paraEvento);
  }

  /** Marca como paradas as sessões abertas sem evento desde `antes`; devolve os ids. */
  marcarParadas(antes: string, agora: string): string[] {
    const linhas = this.db
      .prepare(
        `UPDATE sessoes_ia SET estado = 'parada', atualizado_em = ?
          WHERE encerrada_em IS NULL AND estado <> 'parada' AND ultimo_evento_em < ?
          RETURNING id`,
      )
      .all(agora, antes) as unknown as { id: string }[];
    return linhas.map((l) => l.id);
  }

  leituraTranscript(id: string): LeituraGravada | null {
    const l = this.db
      .prepare(
        `SELECT ferramenta, projeto_id, transcript_caminho, transcript_lido_bytes, contexto_usado_tokens, contexto_janela_tokens, modelo, contexto_avisado_em
           FROM sessoes_ia WHERE id = ?`,
      )
      .get(id) as unknown as LinhaLeitura | undefined;
    if (!l) return null;
    return {
      ferramenta: l.ferramenta,
      projetoId: l.projeto_id,
      caminho: l.transcript_caminho,
      lidoAte: l.transcript_lido_bytes ?? 0,
      usado: l.contexto_usado_tokens,
      janela: l.contexto_janela_tokens,
      modelo: l.modelo,
      avisadoEm: l.contexto_avisado_em,
    };
  }

  /**
   * Grava o que a leitura do transcript achou; o modelo só muda quando a leitura achou um. Não
   * grava (e devolve `false`) se a sessão passou para outro arquivo enquanto a leitura corria.
   */
  gravarLeitura(
    id: string,
    g: {
      caminho: string;
      lidoAte: number;
      usado: number | null;
      janela: number | null;
      modelo: string | null;
      avisadoEm: string | null;
      agora: string;
    },
  ): boolean {
    const gravou = this.db
      .prepare(
        `UPDATE sessoes_ia
            SET transcript_lido_bytes = ?, contexto_usado_tokens = ?, contexto_janela_tokens = ?,
                modelo = coalesce(?, modelo), contexto_avisado_em = ?, atualizado_em = ?
          WHERE id = ? AND transcript_caminho = ?`,
      )
      .run(g.lidoAte, g.usado, g.janela, g.modelo, g.avisadoEm, g.agora, id, g.caminho);
    return Number(gravou.changes) > 0;
  }

  /**
   * Marca a resposta (`message.id` + `requestId`) como contada no PC; `false` quando ela já tinha
   * sido contada, por esta ou por outra sessão.
   */
  marcarRespostaContada(chave: string, agora: string): boolean {
    const marcou = this.db
      .prepare(
        `INSERT INTO uso_ia_mensagens (id, chave, criado_em, atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (chave) DO NOTHING`,
      )
      .run(novoId(), chave, agora, agora, ORIGEM);
    return Number(marcou.changes) > 0;
  }

  /** Esquece as respostas contadas antes de `antes`; devolve quantas. */
  podarRespostasContadas(antes: string): number {
    return Number(this.db.prepare("DELETE FROM uso_ia_mensagens WHERE criado_em < ?").run(antes).changes);
  }

  /**
   * Soma o uso na linha do dia, ferramenta, modelo e projeto (a chave única da 004). A soma com
   * qualquer parte estimada é estimativa.
   */
  somarUso(
    u: UsoDoDia & {
      ferramenta: FerramentaSessao;
      projetoId: string | null;
      fonte: FonteUso;
      agora: string;
    },
  ): void {
    const somou = this.db
      .prepare(
        `UPDATE uso_ia
            SET tokens_entrada = tokens_entrada + ?, tokens_saida = tokens_saida + ?,
                tokens_cache = tokens_cache + ?,
                fonte = CASE WHEN fonte = 'estimativa' OR ? = 'estimativa' THEN 'estimativa' ELSE 'ferramenta' END,
                atualizado_em = ?
          WHERE dia = ? AND ferramenta = ? AND coalesce(modelo, '') = coalesce(?, '')
            AND coalesce(projeto_id, '') = coalesce(?, '')`,
      )
      .run(u.entrada, u.saida, u.cache, u.fonte, u.agora, u.dia, u.ferramenta, u.modelo, u.projetoId);
    if (Number(somou.changes) > 0) return;
    this.db
      .prepare(
        `INSERT INTO uso_ia (id, dia, ferramenta, modelo, projeto_id, tokens_entrada, tokens_saida,
           tokens_cache, fonte, criado_em, atualizado_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        novoId(),
        u.dia,
        u.ferramenta,
        u.modelo,
        u.projetoId,
        u.entrada,
        u.saida,
        u.cache,
        u.fonte,
        u.agora,
        u.agora,
        ORIGEM,
      );
  }

  usoEntre(de: string, ate: string): UsoIa[] {
    const linhas = this.db
      .prepare(
        `SELECT dia, ferramenta, modelo, projeto_id, tokens_entrada, tokens_saida, tokens_cache,
                custo_estimado_microdolares, fonte
           FROM uso_ia WHERE dia BETWEEN ? AND ?
          ORDER BY dia, ferramenta, coalesce(modelo, ''), coalesce(projeto_id, '')`,
      )
      .all(de, ate) as unknown as LinhaUso[];
    return linhas.map((l) => ({
      dia: l.dia,
      ferramenta: l.ferramenta,
      modelo: l.modelo,
      projetoId: l.projeto_id,
      tokensEntrada: l.tokens_entrada,
      tokensSaida: l.tokens_saida,
      tokensCache: l.tokens_cache,
      custoEstimadoMicrodolares: l.custo_estimado_microdolares,
      fonte: l.fonte,
    }));
  }

  /**
   * Guarda o aviso de contexto alto em `notificacoes` (migração 005), em nome do Nuno, com a
   * sessão como referência. Quem entrega (aviso do Windows, ponto no dock) é a F2-20.
   */
  registrarAviso(aviso: AvisoContexto, agora: string): void {
    this.db
      .prepare(
        `INSERT INTO notificacoes (id, do_agente_id, tipo, titulo, corpo, referencia, canal, criado_em,
           atualizado_em, origem)
         VALUES (?, ?, 'aviso', ?, ?, ?, 'dock', ?, ?, ?)`,
      )
      .run(novoId(), NUNO, aviso.titulo, aviso.corpo, `sessao:${aviso.sessaoId}`, agora, agora, ORIGEM);
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

export interface OpcoesSessoes {
  agora?: () => Date;
  /** Pasta do projeto de um `cwd` novo; o padrão sobe até achar `.git`. */
  raizDoProjeto?: (cwd: string) => string;
  /**
   * Leitura do transcript do Claude Code para contexto e uso (F2-24); sem ela, o contexto fica
   * vazio. O serviço passa `TRANSCRIPTS_DO_DISCO`.
   */
  transcripts?: Transcripts;
  /** Recebe o aviso de contexto alto, depois de gravado. */
  aoAvisarContexto?: (aviso: AvisoContexto) => void;
}

/**
 * A regra das sessões de IA (AGENTS.md §5): cada hook recebido acha ou cria a sessão pelo id da
 * ferramenta, reconhece o projeto pelo `cwd`, guarda o resumo do evento, muda o estado e avisa as
 * janelas. Sessão aberta sem evento há {@link LIMITE_PARADA_MS} vira `parada`.
 */
export class ServicoSessoes {
  private readonly agora: () => Date;
  private readonly raizDoProjeto: (cwd: string) => string;
  private readonly contexto: AcompanhamentoContexto | null;

  constructor(
    private readonly repo: RepositorioSessoes,
    private readonly emitir: (mudanca: MudancaSessao) => void,
    opcoes: OpcoesSessoes = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.raizDoProjeto = opcoes.raizDoProjeto ?? ((cwd) => raizPeloGit(cwd));
    this.contexto = opcoes.transcripts
      ? new AcompanhamentoContexto(repo, emitir, opcoes.transcripts, {
          agora: this.agora,
          aoAvisar: opcoes.aoAvisarContexto,
        })
      : null;
  }

  /** Um hook de uma ferramenta: grava, muda o estado e avisa. */
  registrar(ferramenta: FerramentaSessao, evento: EventoHook): MudancaSessao {
    const agora = this.agora().toISOString();
    const mudanca = this.repo.transacao(() => {
      const atual = this.repo.sessaoPorExterno(ferramenta, evento.idSessao);
      const projeto = evento.cwd ? this.projetoDe(evento.cwd, agora) : null;
      const estado = estadoDepois(evento, atual?.estado ?? null);
      const id = atual?.id ?? novoId();
      const dados = {
        id,
        projetoId: projeto?.id ?? null,
        modelo: evento.modelo,
        estado,
        agora,
        // Qualquer outro evento reabre: `claude --resume` volta com o mesmo session id.
        encerrada: evento.tipo === "SessionEnd",
        transcript: evento.transcript,
      };
      if (atual) this.repo.atualizarSessao(dados);
      else this.repo.criarSessao({ ...dados, ferramenta, idExterno: evento.idSessao });
      this.repo.inserirEvento({
        id: novoId(),
        sessaoId: id,
        tipo: evento.tipo,
        ferramenta: evento.ferramenta,
        resumo: evento.resumo,
        agora,
      });
      const sessao = this.repo.sessao(id);
      if (!sessao) throw new Error("sessão gravada e não encontrada");
      const doProjeto = sessao.projetoId ? this.repo.projeto(sessao.projetoId) : null;
      return { sessao, projeto: doProjeto };
    });
    this.emitir(mudanca);
    // Só o transcript do Claude Code tem formato conhecido; a leitura corre depois da resposta.
    if (ferramenta === "claude-code") this.contexto?.agendar(mudanca.sessao.id);
    return mudanca;
  }

  /** Uso por dia, ferramenta, modelo e projeto no intervalo (os dois dias inclusos). */
  uso(entrada: PedidoUso): UsoIa[] {
    const pedido = PedidoUso.parse(entrada);
    return this.repo.usoEntre(pedido.de, pedido.ate);
  }

  /** Espera as leituras de transcript em andamento (testes e fechamento). */
  async leiturasOciosas(): Promise<void> {
    await this.contexto?.ociosas();
  }

  listar(): ListaSessoes {
    const desde = new Date(this.agora().getTime() - RECENTE_MS).toISOString();
    const sessoes = this.repo.listar(desde, LIMITE_LISTA);
    const ids = new Set(sessoes.map((s) => s.projetoId).filter((id): id is string => id !== null));
    const projetos = this.repo.projetosVivos().filter((p) => ids.has(p.id));
    return { projetos, sessoes };
  }

  /** Os projetos que não estão na lixeira, para dar nome ao `projetoId` do uso. */
  projetos(): Projeto[] {
    return this.repo.projetosVivos();
  }

  eventos(entrada: PedidoEventosSessao): EventoSessao[] {
    const pedido = PedidoEventosSessao.parse(entrada);
    return this.repo.eventos(pedido.sessaoId, pedido.limite ?? LIMITE_EVENTOS);
  }

  /** Sessões abertas sem evento há mais do limite viram `parada`, com aviso a cada uma. */
  marcarParadas(): MudancaSessao[] {
    const agora = this.agora();
    const antes = new Date(agora.getTime() - LIMITE_PARADA_MS).toISOString();
    const ids = this.repo.marcarParadas(antes, agora.toISOString());
    const mudancas: MudancaSessao[] = [];
    for (const id of ids) {
      const sessao = this.repo.sessao(id);
      if (!sessao) continue;
      mudancas.push({ sessao, projeto: sessao.projetoId ? this.repo.projeto(sessao.projetoId) : null });
    }
    for (const m of mudancas) this.emitir(m);
    return mudancas;
  }

  /**
   * Esquece as respostas contadas há mais de {@link GUARDA_RESPOSTAS_MS}: uma cópia de histórico
   * mais velha que isso voltaria a contar, e a tabela não cresce sem fim.
   */
  podarRespostasContadas(): number {
    const antes = new Date(this.agora().getTime() - GUARDA_RESPOSTAS_MS).toISOString();
    return this.repo.podarRespostasContadas(antes);
  }

  /**
   * Vigia sem token (AGENTS.md §6): confere as paradas a cada minuto e poda as respostas contadas.
   * Não segura o processo aberto; devolve como parar.
   */
  vigiar(intervaloMs = 60_000): () => void {
    const relogio = setInterval(() => {
      try {
        this.marcarParadas();
        this.podarRespostasContadas();
      } catch (erro) {
        console.error(`sessões: conferência de paradas falhou: ${String(erro)}`);
      }
    }, intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  /** O projeto que contém o `cwd` (o mais específico); sem nenhum, cria pela raiz do repositório. */
  private projetoDe(cwd: string, agora: string): Projeto | null {
    const contem = this.repo
      .projetosVivos()
      .filter((p) => dentroDe(cwd, p.caminho))
      .sort((a, b) => b.caminho.length - a.caminho.length);
    if (contem[0]) return contem[0];
    const caminho = this.raizDoProjeto(cwd);
    // A raiz achada pode já ser um projeto escrito de outro jeito (barra, caixa).
    const igual = this.repo.projetosVivos().find((p) => chaveCaminho(p.caminho) === chaveCaminho(caminho));
    if (igual) return igual;
    const id = novoId();
    this.repo.criarProjeto(id, win32.basename(caminho) || caminho, caminho, agora);
    return this.repo.projeto(id);
  }
}
