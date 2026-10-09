import type { DatabaseSync } from "node:sqlite";
import {
  Aprovacao,
  PedidoDecidir,
  PedidoRegra,
  type AcaoAprovacao,
  type Decisao,
  type EscopoRegra,
  type EscopoSempre,
  type EstadoAprovacao,
  type FonteAprovacao,
  type RegraPermissao,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../banco/tabela.ts";
import { novoId } from "../banco/ulid.ts";
import { cobre, dentroDe, ehDeArquivo, padraoDe } from "./padrao.ts";

/** O que volta a quem pediu quando o usuário nega sem escrever nada (contrato, `PedidoDecidir`). */
export const MENSAGEM_NEGADO = "Negado pelo dock do Moductus";

interface LinhaAprovacao {
  id: string;
  da_execucao_id: string | null;
  do_agente_id: string | null;
  fonte: FonteAprovacao;
  sessao_id: string | null;
  descricao: string;
  acao: string;
  estado: EstadoAprovacao;
  criado_em: string;
  decidida_em: string | null;
  regra_criada_id: string | null;
}

interface LinhaRegra {
  id: string;
  escopo: EscopoRegra;
  projeto_id: string | null;
  do_agente_id: string | null;
  ferramenta: string;
  padrao: string;
  decisao: Decisao;
  criado_em: string;
  expira_em: string | null;
}

const COLUNAS_APROVACAO = `id, da_execucao_id, do_agente_id, fonte, sessao_id, descricao, acao, estado,
  criado_em, decidida_em, regra_criada_id`;

const COLUNAS_REGRA =
  "id, escopo, projeto_id, do_agente_id, ferramenta, padrao, decisao, criado_em, expira_em";

/** Regra que vale agora: fora da lixeira e não vencida (DATA.md §6). */
const REGRA_VALE = "apagado_em IS NULL AND (expira_em IS NULL OR expira_em > ?)";

const paraAprovacao = (l: LinhaAprovacao): Aprovacao => ({
  id: l.id,
  fonte: l.fonte,
  agenteId: l.do_agente_id,
  execucaoId: l.da_execucao_id,
  sessaoId: l.sessao_id,
  descricao: l.descricao,
  // Gravada só depois de passar pelo contrato (`pedir`).
  acao: JSON.parse(l.acao) as AcaoAprovacao,
  estado: l.estado,
  criadoEm: l.criado_em,
  decididaEm: l.decidida_em,
  regraCriadaId: l.regra_criada_id,
});

const paraRegra = (l: LinhaRegra): RegraPermissao => ({
  id: l.id,
  escopo: l.escopo,
  projetoId: l.projeto_id,
  agenteId: l.do_agente_id,
  ferramenta: l.ferramenta,
  padrao: l.padrao,
  decisao: l.decisao,
  criadoEm: l.criado_em,
  expiraEm: l.expira_em,
});

/** Leitura e gravação de `aprovacoes` e `regras_permissao` (migração 003). */
export class RepositorioAprovacoes {
  constructor(private readonly db: DatabaseSync) {}

  aprovacao(id: string): Aprovacao | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_APROVACAO} FROM aprovacoes WHERE id = ?`)
      .get(id) as unknown as LinhaAprovacao | undefined;
    return linha ? paraAprovacao(linha) : null;
  }

  /** Os cartões pendentes, o mais antigo primeiro. */
  pendentes(): Aprovacao[] {
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS_APROVACAO} FROM aprovacoes WHERE estado = 'pendente' ORDER BY criado_em, id`)
      .all() as unknown as LinhaAprovacao[];
    return linhas.map(paraAprovacao);
  }

  /** Pendentes vindos de sessões do terminal, de qualquer ferramenta. */
  pendentesDoTerminal(): string[] {
    const linhas = this.db
      .prepare(
        "SELECT id FROM aprovacoes WHERE estado = 'pendente' AND fonte <> 'moductus' ORDER BY criado_em, id",
      )
      .all() as unknown as { id: string }[];
    return linhas.map((l) => l.id);
  }

  pendentesDaSessao(sessaoId: string): string[] {
    const linhas = this.db
      .prepare("SELECT id FROM aprovacoes WHERE estado = 'pendente' AND sessao_id = ? ORDER BY criado_em, id")
      .all(sessaoId) as unknown as { id: string }[];
    return linhas.map((l) => l.id);
  }

  inserirAprovacao(a: Aprovacao, carimbo: Carimbo): void {
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO aprovacoes (id, da_execucao_id, do_agente_id, fonte, sessao_id, descricao, acao, estado,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.execucaoId,
        a.agenteId,
        a.fonte,
        a.sessaoId,
        a.descricao,
        JSON.stringify(a.acao),
        a.criadoEm,
        a.criadoEm,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /**
   * Tira o cartão de `pendente`. Só muda se ainda estiver pendente: devolve se mudou, para quem
   * decidiu ao mesmo tempo saber que chegou depois.
   */
  encerrar(
    id: string,
    estado: Exclude<EstadoAprovacao, "pendente">,
    agora: string,
    regraId: string | null,
  ): boolean {
    const origem = colunasDeOrigem(DO_USUARIO);
    const r = this.db
      .prepare(
        `UPDATE aprovacoes
            SET estado = ?, decidida_em = ?, regra_criada_id = ?, atualizado_em = ?,
                origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND estado = 'pendente'`,
      )
      .run(estado, agora, regraId, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
    return Number(r.changes) > 0;
  }

  /** O cartão expirou sozinho: o carimbo fica como estava, ninguém mexeu nele. */
  expirar(id: string, agora: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE aprovacoes SET estado = 'expirada', decidida_em = ?, atualizado_em = ?
          WHERE id = ? AND estado = 'pendente'`,
      )
      .run(agora, agora, id);
    return Number(r.changes) > 0;
  }

  /** O projeto da sessão do terminal de onde veio o pedido. */
  projetoDaSessao(sessaoId: string): string | null {
    const linha = this.db
      .prepare("SELECT projeto_id FROM sessoes_ia WHERE id = ?")
      .get(sessaoId) as unknown as { projeto_id: string | null } | undefined;
    return linha?.projeto_id ?? null;
  }

  /** A pasta de um projeto vivo. */
  caminhoDoProjeto(id: string): string | null {
    const linha = this.db
      .prepare("SELECT caminho FROM projetos WHERE id = ? AND apagado_em IS NULL")
      .get(id) as unknown as { caminho: string } | undefined;
    return linha?.caminho ?? null;
  }

  /** Regras que valem agora para a ferramenta, no projeto ou para o agente do pedido. */
  regrasPara(
    ferramenta: string,
    projetoId: string | null,
    agenteId: string | null,
    agora: string,
  ): RegraPermissao[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_REGRA} FROM regras_permissao
          WHERE ${REGRA_VALE} AND ferramenta = ?
            AND ((escopo = 'projeto' AND projeto_id = ?) OR (escopo = 'agente' AND do_agente_id = ?))
          ORDER BY id`,
      )
      .all(agora, ferramenta, projetoId, agenteId) as unknown as LinhaRegra[];
    return linhas.map(paraRegra);
  }

  regrasVivas(agora: string): RegraPermissao[] {
    const linhas = this.db
      .prepare(`SELECT ${COLUNAS_REGRA} FROM regras_permissao WHERE ${REGRA_VALE} ORDER BY id`)
      .all(agora) as unknown as LinhaRegra[];
    return linhas.map(paraRegra);
  }

  inserirRegra(r: RegraPermissao): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `INSERT INTO regras_permissao (id, escopo, projeto_id, do_agente_id, ferramenta, padrao, decisao, expira_em,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.escopo,
        r.projetoId,
        r.agenteId,
        r.ferramenta,
        r.padrao,
        r.decisao,
        r.expiraEm,
        r.criadoEm,
        r.criadoEm,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  /** Manda a regra para a lixeira; devolve se ela estava viva. */
  removerRegra(id: string, agora: string): boolean {
    const origem = colunasDeOrigem(DO_USUARIO);
    const r = this.db
      .prepare(
        `UPDATE regras_permissao SET apagado_em = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
    return Number(r.changes) > 0;
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

/** Um pedido de permissão, de um agente do Moductus ou de uma sessão do terminal. */
export interface NovoPedido {
  fonte: FonteAprovacao;
  /** Agente e execução que pedem; só nos pedidos do Moductus. */
  agenteId?: string | null;
  execucaoId?: string | null;
  /** Sessão do terminal (`sessoes_ia.id`); o projeto do "sempre neste projeto" vem dela. */
  sessaoId?: string | null;
  descricao: string;
  acao: AcaoAprovacao;
}

/** Uma regra decidiu sem cartão, ou o cartão foi criado e espera o usuário. */
export type ResultadoPedido =
  { tipo: "regra"; decisao: Decisao; regra: RegraPermissao } | { tipo: "cartao"; aprovacao: Aprovacao };

/** Como o cartão terminou e a mensagem que volta a quem pediu (só ao negar). */
export interface Desfecho {
  aprovacao: Aprovacao;
  mensagem: string | null;
}

/**
 * Diz se a situação de um cartão pendente ainda vale (o PR continua aberto, o arquivo existe).
 * Cada área registra a sua e devolve `true` para os cartões que não são dela.
 */
export type Situacao = (aprovacao: Aprovacao) => boolean | Promise<boolean>;

export interface AvisosAprovacoes {
  aprovacao: (aprovacao: Aprovacao) => void;
  regras: (regras: RegraPermissao[]) => void;
}

export interface OpcoesAprovacoes {
  agora?: () => Date;
}

interface Espera {
  resolver: (desfecho: Desfecho) => void;
  soltar: () => void;
}

/**
 * A regra das aprovações (AGENTS.md §4 e §5, ADR-0008, ADR-0009): o pedido passa pelas regras do
 * usuário e, sem regra, vira cartão no banco, que sobrevive a fechar o app. Decidir com "sempre"
 * cria a regra que decide os próximos pedidos iguais sem cartão. O cartão expira quando a
 * situação muda (a sessão terminou, o PR foi fechado).
 *
 * Quem pediu espera pelo {@link esperar}; depois de reabrir o app, o cartão continua pendente e
 * quem voltar a esperar por ele recebe a decisão.
 */
export class ServicoAprovacoes {
  private readonly agora: () => Date;
  private readonly esperas = new Map<string, Set<Espera>>();
  private readonly situacoes = new Set<Situacao>();

  constructor(
    private readonly repo: RepositorioAprovacoes,
    private readonly avisos: AvisosAprovacoes,
    opcoes: OpcoesAprovacoes = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /** Decide pela regra do usuário, se houver; senão cria o cartão pendente e avisa as janelas. */
  pedir(pedido: NovoPedido): ResultadoPedido {
    const agenteId = pedido.agenteId ?? null;
    const execucaoId = pedido.execucaoId ?? null;
    const sessaoId = pedido.sessaoId ?? null;
    if (pedido.fonte === "moductus" && agenteId === null) {
      throw new Error("pedido do Moductus precisa do agente que pede");
    }
    if (pedido.fonte !== "moductus" && (agenteId !== null || execucaoId !== null)) {
      throw new Error("pedido de sessão do terminal não tem agente nem execução");
    }
    const agora = this.agora().toISOString();
    const projetoId = sessaoId ? this.repo.projetoDaSessao(sessaoId) : null;
    const regra = this.regraQueDecide(pedido.acao, projetoId, agenteId, agora);
    if (regra) return { tipo: "regra", decisao: regra.decisao, regra };

    const aprovacao = Aprovacao.parse({
      id: novoId(),
      fonte: pedido.fonte,
      agenteId,
      execucaoId,
      sessaoId,
      descricao: pedido.descricao,
      acao: pedido.acao,
      estado: "pendente",
      criadoEm: agora,
      decididaEm: null,
      regraCriadaId: null,
    });
    const carimbo: Carimbo =
      agenteId !== null ? { origem: "agente", agenteId, execucaoId } : { origem: "conexao" };
    this.repo.inserirAprovacao(aprovacao, carimbo);
    this.avisos.aprovacao(aprovacao);
    return { tipo: "cartao", aprovacao };
  }

  /**
   * Espera o cartão sair de `pendente`. Já decidido, responde na hora. `sinal` desiste de esperar
   * sem mexer no cartão (quem desiste decide se ele expira).
   */
  esperar(id: string, sinal?: AbortSignal): Promise<Desfecho> {
    const atual = this.repo.aprovacao(id);
    if (!atual) return Promise.reject(new Error("aprovação não encontrada"));
    if (atual.estado !== "pendente")
      return Promise.resolve({ aprovacao: atual, mensagem: mensagemDe(atual) });
    if (sinal?.aborted) return Promise.reject(sinal.reason);
    return new Promise((resolve, reject) => {
      const desistir = () => {
        this.esperas.get(id)?.delete(espera);
        reject(sinal?.reason);
      };
      const espera: Espera = {
        resolver: resolve,
        soltar: () => sinal?.removeEventListener("abort", desistir),
      };
      sinal?.addEventListener("abort", desistir, { once: true });
      const daqui = this.esperas.get(id) ?? new Set<Espera>();
      daqui.add(espera);
      this.esperas.set(id, daqui);
    });
  }

  /** Os cartões que ainda esperam o usuário, depois de expirar os que a situação já derrubou. */
  async pendentes(): Promise<Aprovacao[]> {
    await this.conferir();
    return this.repo.pendentes();
  }

  /**
   * Permitir ou negar. Com `sempre`, cria a regra no projeto da sessão ou para o agente que pediu.
   * Cartão que já saiu de pendente volta como está; cartão cuja situação mudou expira em vez de
   * ser decidido.
   */
  async decidir(entrada: PedidoDecidir): Promise<Aprovacao> {
    const pedido = PedidoDecidir.parse(entrada);
    const atual = this.repo.aprovacao(pedido.id);
    if (!atual) throw new Error("aprovação não encontrada");
    if (atual.estado !== "pendente") return atual;
    if (!(await this.vale(atual))) return this.expirar(atual.id) ?? this.repo.aprovacao(atual.id) ?? atual;

    const agora = this.agora().toISOString();
    const estado = pedido.decisao === "permitir" ? "aprovada" : "negada";
    const resultado = this.repo.transacao(() => {
      // Outra decisão pode ter chegado enquanto a situação era conferida.
      const ainda = this.repo.aprovacao(pedido.id);
      if (ainda?.estado !== "pendente") return null;
      const regra = pedido.sempre ? this.novaRegra(ainda, pedido.sempre, pedido.decisao, agora) : null;
      if (regra) this.repo.inserirRegra(regra);
      this.repo.encerrar(ainda.id, estado, agora, regra?.id ?? null);
      return { regra, aprovacao: this.repo.aprovacao(ainda.id) };
    });
    if (!resultado?.aprovacao) return this.repo.aprovacao(pedido.id) ?? atual;

    const decidida = resultado.aprovacao;
    this.avisos.aprovacao(decidida);
    if (resultado.regra) this.avisos.regras(this.regras());
    const mensagem = pedido.decisao === "negar" ? (pedido.mensagem ?? MENSAGEM_NEGADO) : null;
    this.liberar(decidida, mensagem);
    return decidida;
  }

  /** Expira um cartão pendente; devolve como ficou, ou `null` se ele não estava pendente. */
  expirar(id: string): Aprovacao | null {
    if (!this.repo.expirar(id, this.agora().toISOString())) return null;
    const expirada = this.repo.aprovacao(id);
    if (!expirada) return null;
    this.avisos.aprovacao(expirada);
    this.liberar(expirada, null);
    return expirada;
  }

  /**
   * Na subida do serviço: o pedido de uma sessão do terminal só vale enquanto o hook segura a
   * resposta, e o serviço que segurava caiu. Os do Moductus continuam esperando o usuário.
   */
  expirarDoTerminal(): Aprovacao[] {
    return this.repo
      .pendentesDoTerminal()
      .map((id) => this.expirar(id))
      .filter((a): a is Aprovacao => a !== null);
  }

  /** A sessão do terminal terminou: o que ela pedia não tem mais a quem responder. */
  expirarDaSessao(sessaoId: string): Aprovacao[] {
    return this.repo
      .pendentesDaSessao(sessaoId)
      .map((id) => this.expirar(id))
      .filter((a): a is Aprovacao => a !== null);
  }

  /** Registra como conferir se a situação de um cartão ainda vale; devolve como tirar. */
  registrarSituacao(situacao: Situacao): () => void {
    this.situacoes.add(situacao);
    return () => this.situacoes.delete(situacao);
  }

  /** Expira os pendentes cuja situação mudou; devolve os que expiraram. */
  async conferir(): Promise<Aprovacao[]> {
    if (this.situacoes.size === 0) return [];
    const expiradas: Aprovacao[] = [];
    for (const pendente of this.repo.pendentes()) {
      if (await this.vale(pendente)) continue;
      const expirada = this.expirar(pendente.id);
      if (expirada) expiradas.push(expirada);
    }
    return expiradas;
  }

  /** Vigia sem token (AGENTS.md §6): confere as situações a cada minuto, sem segurar o processo. */
  vigiar(intervaloMs = 60_000): () => void {
    const relogio = setInterval(() => {
      this.conferir().catch((erro: unknown) =>
        console.error(`aprovações: conferência das situações falhou: ${String(erro)}`),
      );
    }, intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  regras(): RegraPermissao[] {
    return this.repo.regrasVivas(this.agora().toISOString());
  }

  /** Manda a regra para a lixeira (some de vez em 30 dias) e devolve as que ficam. */
  removerRegra(entrada: PedidoRegra): RegraPermissao[] {
    const { id } = PedidoRegra.parse(entrada);
    if (!this.repo.removerRegra(id, this.agora().toISOString())) throw new Error("regra não encontrada");
    const regras = this.regras();
    this.avisos.regras(regras);
    return regras;
  }

  /**
   * Negar ganha de permitir: com as duas cobrindo o pedido, vale a mais cuidadosa. Regra de
   * arquivo no escopo do projeto só cobre caminho dentro da pasta dele.
   */
  private regraQueDecide(
    acao: AcaoAprovacao,
    projetoId: string | null,
    agenteId: string | null,
    agora: string,
  ): RegraPermissao | null {
    const padrao = padraoDe(acao.ferramenta, acao.entrada);
    if (padrao === null) return null;
    const dentroDoProjeto = this.dentroDoProjeto(acao.ferramenta, padrao, projetoId);
    const cobrem = this.repo
      .regrasPara(acao.ferramenta, projetoId, agenteId, agora)
      .filter((r) => cobre(acao.ferramenta, r.padrao, padrao) && (r.escopo !== "projeto" || dentroDoProjeto));
    return cobrem.find((r) => r.decisao === "negar") ?? cobrem[0] ?? null;
  }

  private novaRegra(
    aprovacao: Aprovacao,
    sempre: EscopoSempre,
    decisao: Decisao,
    agora: string,
  ): RegraPermissao {
    const padrao = padraoDe(aprovacao.acao.ferramenta, aprovacao.acao.entrada);
    if (padrao === null) {
      throw new Error("este pedido não tem comando, caminho ou endereço: não dá para criar a regra");
    }
    const base = {
      id: novoId(),
      ferramenta: aprovacao.acao.ferramenta,
      padrao,
      decisao,
      criadoEm: agora,
      expiraEm: null,
    };
    if (sempre === "projeto") {
      const projetoId = aprovacao.sessaoId ? this.repo.projetoDaSessao(aprovacao.sessaoId) : null;
      if (!projetoId) throw new Error("este pedido não tem projeto: não dá para criar a regra do projeto");
      if (!this.dentroDoProjeto(aprovacao.acao.ferramenta, padrao, projetoId)) {
        throw new Error("o arquivo fica fora do projeto: não dá para criar a regra do projeto");
      }
      return { ...base, escopo: "projeto", projetoId, agenteId: null };
    }
    if (!aprovacao.agenteId)
      throw new Error("este pedido não vem de um agente: não dá para criar a regra do agente");
    return { ...base, escopo: "agente", projetoId: null, agenteId: aprovacao.agenteId };
  }

  /** Ferramenta que não é de arquivo não tem caminho a conferir; a de arquivo, só dentro da pasta. */
  private dentroDoProjeto(ferramenta: string, padrao: string, projetoId: string | null): boolean {
    if (!ehDeArquivo(ferramenta)) return true;
    const caminho = projetoId ? this.repo.caminhoDoProjeto(projetoId) : null;
    return caminho !== null && dentroDe(padrao, caminho);
  }

  /** Situação que falha ao conferir não derruba o cartão: na dúvida, o usuário decide. */
  private async vale(aprovacao: Aprovacao): Promise<boolean> {
    for (const situacao of this.situacoes) {
      try {
        if (!(await situacao(aprovacao))) return false;
      } catch (erro) {
        console.error(`aprovações: situação de ${aprovacao.id} não conferida: ${String(erro)}`);
      }
    }
    return true;
  }

  private liberar(aprovacao: Aprovacao, mensagem: string | null): void {
    const esperas = this.esperas.get(aprovacao.id);
    if (!esperas) return;
    this.esperas.delete(aprovacao.id);
    for (const espera of esperas) {
      espera.soltar();
      espera.resolver({ aprovacao, mensagem });
    }
  }
}

/** Depois de reabrir, a mensagem escrita ao negar não existe mais: volta a padrão. */
function mensagemDe(aprovacao: Aprovacao): string | null {
  return aprovacao.estado === "negada" ? MENSAGEM_NEGADO : null;
}
