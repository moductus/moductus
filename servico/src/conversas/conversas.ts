import type { DatabaseSync } from "node:sqlite";
import type {
  Conversa,
  FalaParcial,
  Mensagem,
  PaginaMensagens,
  PedidoAbrirConversa,
  PedidoArquivarConversa,
  PedidoEnviar,
  PedidoMensagens,
  ResultadoEnviar,
  TipoConversa,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO, type Carimbo } from "../banco/tabela.ts";
import { novoId } from "../banco/ulid.ts";
import type { RepositorioAgentes } from "../agentes/agentes.ts";
import { HISTORICO_CURTO } from "../agentes/pedido.ts";
import type { Destino, Roteador } from "../agentes/roteador.ts";
import type { Runtime } from "../agentes/runtime.ts";
import type { MensagemModelo } from "../provedores/provedor.ts";

/**
 * Conversas com o time e com cada agente (PRODUCT.md §6 "Conversas"; AGENTS.md §1 "Conversas",
 * §2 "Roteamento"). A fala do usuário é gravada e respondida por quem o roteamento escolher; cada
 * resposta chega em streaming (`conversas.parcial`, com o texto inteiro até ali) e, pronta, é
 * gravada assinada pelo agente e pela execução que a produziu (`conversas.mensagem`).
 */

interface LinhaConversa {
  id: string;
  tipo: TipoConversa;
  do_agente_id: string | null;
  titulo: string | null;
  arquivada: number;
  criado_em: string;
}

const COLUNAS_CONVERSA = "id, tipo, do_agente_id, titulo, arquivada, criado_em";

const paraConversa = (l: LinhaConversa): Conversa => ({
  id: l.id,
  tipo: l.tipo,
  agenteId: l.do_agente_id,
  titulo: l.titulo,
  arquivada: l.arquivada === 1,
  criadoEm: l.criado_em,
});

interface LinhaMensagem {
  id: string;
  conversa_id: string;
  do_agente_id: string | null;
  conteudo: string;
  da_execucao_id: string | null;
  criado_em: string;
}

const COLUNAS_MENSAGEM = "id, conversa_id, do_agente_id, conteudo, da_execucao_id, criado_em";

const paraMensagem = (l: LinhaMensagem): Mensagem => ({
  id: l.id,
  conversaId: l.conversa_id,
  agenteId: l.do_agente_id,
  conteudo: l.conteudo,
  execucaoId: l.da_execucao_id,
  criadoEm: l.criado_em,
});

export interface NovaConversa {
  id: string;
  agenteId: string | null;
  agora: string;
}

export interface NovaMensagem {
  id: string;
  conversaId: string;
  /** Vazio é o usuário. */
  agenteId: string | null;
  conteudo: string;
  execucaoId: string | null;
  agora: string;
}

/** Quantas mensagens uma página traz quando o pedido não diz. */
const PAGINA_PADRAO = 50;

/** `conversas` e `mensagens` (migração 003). O que está na lixeira não aparece. */
export class RepositorioConversas {
  constructor(private readonly db: DatabaseSync) {}

  /** A do time primeiro; depois as outras, da que falou por último para a mais parada. */
  conversas(): Conversa[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_CONVERSA} FROM conversas c WHERE apagado_em IS NULL
          ORDER BY tipo = 'time' DESC,
            COALESCE((SELECT MAX(m.id) FROM mensagens m WHERE m.conversa_id = c.id AND m.apagado_em IS NULL), c.id) DESC`,
      )
      .all() as unknown as LinhaConversa[];
    return linhas.map(paraConversa);
  }

  conversa(id: string): Conversa | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_CONVERSA} FROM conversas WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaConversa | undefined;
    return linha ? paraConversa(linha) : null;
  }

  /** A conversa em uso com o agente (ou a do time, com `null`): a mais nova não arquivada. */
  emUso(agenteId: string | null): Conversa | null {
    const linha = this.db
      .prepare(
        `SELECT ${COLUNAS_CONVERSA} FROM conversas
          WHERE apagado_em IS NULL AND arquivada = 0 AND tipo = ? AND do_agente_id IS ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(agenteId === null ? "time" : "agente", agenteId) as unknown as LinhaConversa | undefined;
    return linha ? paraConversa(linha) : null;
  }

  criar(c: NovaConversa): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `INSERT INTO conversas (id, tipo, do_agente_id, criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.agenteId === null ? "time" : "agente",
        c.agenteId,
        c.agora,
        c.agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  arquivar(id: string, arquivada: boolean, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `UPDATE conversas SET arquivada = ?, atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
          WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(arquivada ? 1 : 0, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  /**
   * Manda a conversa para a lixeira com as mensagens dela: mensagem viva seguraria a conversa na
   * limpeza dos 30 dias (migração 003). Nenhum método do canal apaga conversa ainda; a área
   * Agentes (F2-31) usa daqui.
   */
  apagar(id: string, agora: string): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE mensagens SET apagado_em = ?, atualizado_em = ? WHERE conversa_id = ? AND apagado_em IS NULL",
        )
        .run(agora, agora, id);
      this.db
        .prepare("UPDATE conversas SET apagado_em = ?, atualizado_em = ? WHERE id = ? AND apagado_em IS NULL")
        .run(agora, agora, id);
      this.db.exec("COMMIT");
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }

  /** A fala do usuário é dele; a do agente, carimbada pelo agente e pela execução que a produziu. */
  gravarMensagem(m: NovaMensagem): void {
    const carimbo: Carimbo =
      m.agenteId === null ? DO_USUARIO : { origem: "agente", agenteId: m.agenteId, execucaoId: m.execucaoId };
    const origem = colunasDeOrigem(carimbo);
    this.db
      .prepare(
        `INSERT INTO mensagens (id, conversa_id, do_agente_id, conteudo, da_execucao_id, criado_em, atualizado_em,
           origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.conversaId,
        m.agenteId,
        m.conteudo,
        m.execucaoId,
        m.agora,
        m.agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  mensagem(id: string): Mensagem | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS_MENSAGEM} FROM mensagens WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaMensagem | undefined;
    return linha ? paraMensagem(linha) : null;
  }

  /** Da mais nova para a mais antiga; o ULID ordena pela criação. */
  pagina(pedido: PedidoMensagens): PaginaMensagens {
    const limite = pedido.limite ?? PAGINA_PADRAO;
    const valores: (string | number)[] = [pedido.conversaId];
    let antes = "";
    if (pedido.antesDe !== undefined) {
      antes = "AND id < ?";
      valores.push(pedido.antesDe);
    }
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_MENSAGEM} FROM mensagens WHERE conversa_id = ? AND apagado_em IS NULL ${antes}
          ORDER BY id DESC LIMIT ?`,
      )
      .all(...valores, limite + 1) as unknown as LinhaMensagem[];
    const itens = linhas.slice(0, limite).map(paraMensagem);
    return { itens, proximo: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
  }

  /** As últimas `limite` mensagens até a dada (inclusive), na ordem da conversa. */
  ate(conversaId: string, ateId: string, limite: number): Mensagem[] {
    const linhas = this.db
      .prepare(
        `SELECT ${COLUNAS_MENSAGEM} FROM mensagens WHERE conversa_id = ? AND apagado_em IS NULL AND id <= ?
          ORDER BY id DESC LIMIT ?`,
      )
      .all(conversaId, ateId, limite) as unknown as LinhaMensagem[];
    return linhas.reverse().map(paraMensagem);
  }

  /** Qual agente falou por último na conversa; `null` se nenhum falou. */
  ultimoAResponder(conversaId: string): string | null {
    const linha = this.db
      .prepare(
        `SELECT do_agente_id FROM mensagens
          WHERE conversa_id = ? AND do_agente_id IS NOT NULL AND apagado_em IS NULL
          ORDER BY id DESC LIMIT 1`,
      )
      .get(conversaId) as unknown as { do_agente_id: string } | undefined;
    return linha?.do_agente_id ?? null;
  }
}

export interface AvisosConversas {
  /** Conversa criada ou mudada (arquivada). */
  conversa: (conversa: Conversa) => void;
  /** Mensagem gravada, do usuário ou do agente. */
  mensagem: (mensagem: Mensagem) => void;
  /** Resposta em andamento, com o texto inteiro até agora. */
  parcial: (parcial: FalaParcial) => void;
}

export interface DependenciasConversas {
  repo: RepositorioConversas;
  agentes: Pick<RepositorioAgentes, "agentes" | "agente">;
  runtime: Pick<Runtime, "executar">;
  roteador: Roteador;
}

export interface OpcoesConversas {
  agora?: () => Date;
  gerarId?: () => string;
}

/** O que fica na conversa quando a execução terminou sem texto e sem erro a mostrar. */
export const MENSAGEM_SEM_RESPOSTA = "Não consegui responder desta vez. Pode mandar de novo?";

export class ServicoConversas {
  private readonly agora: () => Date;
  private readonly gerarId: () => string;
  /**
   * A sessão do provedor de cada agente em cada conversa, para o `--resume` seguir dela. Fica na
   * memória: depois de reiniciar, a próxima resposta começa sessão nova com o histórico curto.
   */
  private readonly continuacoes = new Map<string, string>();
  /** A última resposta pedida a cada agente em cada conversa: a próxima espera esta terminar. */
  private readonly vezes = new Map<string, Promise<void>>();
  private readonly andamento = new Set<Promise<void>>();

  constructor(
    private readonly deps: DependenciasConversas,
    private readonly avisos: AvisosConversas,
    opcoes: OpcoesConversas = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gerarId = opcoes.gerarId ?? novoId;
  }

  listar(): Conversa[] {
    return this.deps.repo.conversas();
  }

  /** A conversa em uso com o agente, ou a do time; cria se ainda não existe ou se foi arquivada. */
  abrir(pedido: PedidoAbrirConversa): Conversa {
    const agenteId = pedido.agenteId ?? null;
    if (agenteId !== null && !this.deps.agentes.agente(agenteId)) throw new Error("agente não encontrado");
    const emUso = this.deps.repo.emUso(agenteId);
    if (emUso) return emUso;
    const id = this.gerarId();
    this.deps.repo.criar({ id, agenteId, agora: this.agora().toISOString() });
    const conversa = this.exigir(id);
    this.avisos.conversa(conversa);
    return conversa;
  }

  mensagens(pedido: PedidoMensagens): PaginaMensagens {
    this.exigir(pedido.conversaId);
    return this.deps.repo.pagina(pedido);
  }

  arquivar(pedido: PedidoArquivarConversa): Conversa {
    this.exigir(pedido.id);
    this.deps.repo.arquivar(pedido.id, pedido.arquivada, this.agora().toISOString());
    const conversa = this.exigir(pedido.id);
    this.avisos.conversa(conversa);
    return conversa;
  }

  /**
   * Grava a fala do usuário, escolhe quem responde e põe cada resposta para rodar. Volta quando o
   * roteamento decidiu, sem esperar as respostas, que chegam por evento.
   */
  async enviar(pedido: PedidoEnviar): Promise<ResultadoEnviar> {
    const conversa = this.exigir(pedido.conversaId);
    if (conversa.arquivada) throw new Error("a conversa está arquivada");
    const mensagem = this.gravar(conversa.id, null, pedido.conteudo, null);
    const destinos = await this.destinos(conversa, mensagem.conteudo);
    for (const destino of destinos) this.responder(conversa.id, mensagem, destino, destinos);
    return { mensagem, agentes: destinos.map((d) => d.agenteId) };
  }

  /** Espera as respostas em andamento: para os testes e para sair sem cortar uma resposta. */
  async ocioso(): Promise<void> {
    while (this.andamento.size > 0) await Promise.all(this.andamento);
  }

  private async destinos(conversa: Conversa, texto: string): Promise<Destino[]> {
    if (conversa.agenteId !== null) {
      if (!this.deps.agentes.agente(conversa.agenteId)) throw new Error("agente não encontrado");
      return [{ agenteId: conversa.agenteId, parte: null }];
    }
    const disponiveis = this.deps.agentes.agentes().filter((a) => a.estado !== "desligado");
    return this.deps.roteador.rotear(texto, disponiveis, this.deps.repo.ultimoAResponder(conversa.id));
  }

  /**
   * Põe a resposta na vez do agente nesta conversa: a seguinte só monta o pedido quando esta
   * terminar, para continuar da sessão que esta deixou.
   */
  private responder(
    conversaId: string,
    gatilho: Mensagem,
    destino: Destino,
    todos: readonly Destino[],
  ): void {
    const chave = `${conversaId}:${destino.agenteId}`;
    const anterior = this.vezes.get(chave) ?? Promise.resolve();
    const vez = anterior
      .then(() => this.rodar(conversaId, gatilho, destino, todos))
      .catch((erro: unknown) => {
        console.error(`resposta de ${destino.agenteId} na conversa ${conversaId} falhou: ${String(erro)}`);
      });
    this.vezes.set(chave, vez);
    this.andamento.add(vez);
    void vez.finally(() => {
      this.andamento.delete(vez);
      if (this.vezes.get(chave) === vez) this.vezes.delete(chave);
    });
  }

  private async rodar(
    conversaId: string,
    gatilho: Mensagem,
    destino: Destino,
    todos: readonly Destino[],
  ): Promise<void> {
    const { agenteId } = destino;
    const chave = `${conversaId}:${agenteId}`;
    const nomes = new Map(this.deps.agentes.agentes().map((a) => [a.id, a.nome]));
    const historico = this.deps.repo
      .ate(conversaId, gatilho.id, HISTORICO_CURTO.mensagens)
      .map((m) =>
        m.id === gatilho.id ? pedidoDe(m, destino, todos, nomes) : paraModelo(m, agenteId, nomes),
      );

    let texto = "";
    const resultado = await this.deps.runtime.executar({
      agenteId,
      gatilho: "mensagem",
      mensagens: historico,
      continuarDe: this.continuacoes.get(chave) ?? null,
      aoEvento: (evento, execucaoId) => {
        if (evento.tipo === "texto") texto += evento.texto;
        // Ferramenta sem texto ainda é "pensando": a janela sabe que a execução está viva.
        else if (evento.tipo !== "ferramenta") return;
        this.avisos.parcial({ conversaId, agenteId, execucaoId, texto });
      },
    });
    if (resultado.continuacao !== null) this.continuacoes.set(chave, resultado.continuacao);
    else if (resultado.execucao.estado === "ok") this.continuacoes.delete(chave);

    // Falhou sem dizer nada: o erro da execução fica na conversa, para ninguém esperar à toa.
    const conteudo = resultado.texto.trim() || resultado.execucao.erro || MENSAGEM_SEM_RESPOSTA;
    if (!this.deps.repo.conversa(conversaId)) return;
    this.gravar(conversaId, agenteId, conteudo, resultado.execucao.id);
  }

  private gravar(
    conversaId: string,
    agenteId: string | null,
    conteudo: string,
    execucaoId: string | null,
  ): Mensagem {
    const id = this.gerarId();
    this.deps.repo.gravarMensagem({
      id,
      conversaId,
      agenteId,
      conteudo,
      execucaoId,
      agora: this.agora().toISOString(),
    });
    const mensagem = this.deps.repo.mensagem(id);
    if (!mensagem) throw new Error(`mensagem ${id} sumiu do banco`);
    this.avisos.mensagem(mensagem);
    return mensagem;
  }

  private exigir(id: string): Conversa {
    const conversa = this.deps.repo.conversa(id);
    if (!conversa) throw new Error("conversa não encontrada");
    return conversa;
  }
}

/**
 * Uma fala da conversa vista pelo agente que vai responder: as dele são "agente"; as do usuário e,
 * na conversa do time, as dos outros agentes, assinadas, chegam como fala de fora.
 */
export function paraModelo(
  m: Mensagem,
  agenteId: string,
  nomes: ReadonlyMap<string, string>,
): MensagemModelo {
  if (m.agenteId === agenteId) return { papel: "agente", texto: m.conteudo };
  if (m.agenteId === null) return { papel: "usuario", texto: m.conteudo };
  return { papel: "usuario", texto: `${nomes.get(m.agenteId) ?? m.agenteId} respondeu: ${m.conteudo}` };
}

/** "Tula", "Tula e Nuno", "Alba, Tula e Nuno". */
function emLista(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)!}`;
}

/**
 * A mensagem a responder. Dividida no time, vai com a parte que cabe a este agente e quem fica com
 * o resto, para cada um responder só o que é seu.
 */
export function pedidoDe(
  m: Mensagem,
  destino: Destino,
  todos: readonly Destino[],
  nomes: ReadonlyMap<string, string>,
): MensagemModelo {
  if (todos.length < 2) return { papel: "usuario", texto: m.conteudo };
  const outros = todos
    .filter((d) => d.agenteId !== destino.agenteId)
    .map((d) => nomes.get(d.agenteId) ?? d.agenteId);
  const nota = destino.parte
    ? `(Esta mensagem foi dividida no time. Responda só a esta parte: "${destino.parte}". O resto fica com ${emLista(outros)}.)`
    : `(${emLista(outros)} também ${outros.length > 1 ? "vão" : "vai"} responder esta mensagem. Responda só o que é da sua área.)`;
  return { papel: "usuario", texto: `${m.conteudo}\n\n${nota}` };
}
