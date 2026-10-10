import type { DatabaseSync } from "node:sqlite";
import type {
  Conexao,
  EstadoCi,
  EstadoItemGithub,
  ItemGithub,
  SituacaoGithub,
  TipoItemGithub,
} from "@moductus/contrato";
import { novoId } from "../../banco/ulid.ts";
import type { OrigemConexao, RepositorioConexoes } from "../conexoes.ts";
import { comentar, lerDetalhe, SemLoginGh, type AlvoGithub, type DetalheGithub } from "./acoes.ts";
import { lerGithub, type ItemLido, type LeituraGithub } from "./cliente.ts";
import { GhAusente, type ExecutorGh } from "./gh.ts";

/** O GitHub é consultado a cada 15 minutos (AGENTS.md §6, vigia do Nuno). */
export const INTERVALO_GITHUB_MS = 15 * 60_000;

/** Ditos na Conexão (AGENTS.md §2 Voz: o impacto, depois a saída). */
export const AVISO_SEM_GH =
  "O GitHub CLI (gh) não está instalado. Instale pelo cli.github.com e conecte de novo.";
export const AVISO_SEM_LOGIN =
  "O gh não está conectado a uma conta. Rode gh auth login no terminal e conecte de novo.";
export const avisoFalhou = (motivo: string) =>
  `Não consegui ler o GitHub (${motivo}). Tento de novo em 15 minutos.`;
/** O Nuno não sabe nada do GitHub com a conexão desligada, e não vai lá sem ela. */
export const AVISO_DESLIGADA =
  "O GitHub não está conectado, então não sei o que tem lá. Conecte em Configurações › Conexões.";

/** Por que o item precisa de você, na fala do Nuno; `null` quando ele não precisa. */
export function motivoDoItem(item: ItemGithub): string | null {
  if (!item.precisaDeMim) return null;
  switch (item.meuPapel) {
    case "revisor":
      return "review pedido a você";
    case "atribuido":
      return item.tipo === "issue" ? "issue atribuída a você" : "PR atribuído a você";
    default:
      // Seu PR precisa de você quando o CI quebrou ou alguém pediu mudanças (cliente.ts).
      return item.ciEstado === "falhou" ? "CI quebrado no seu PR" : "mudanças pedidas no seu PR";
  }
}

export interface PendenciaGithub {
  repositorio: string;
  numero: number;
  tipo: TipoItemGithub;
  titulo: string;
  autor: string | null;
  motivo: string;
  ciEstado: EstadoCi | null;
  atualizadoNoGithub: string | null;
  url: string;
}

/** O que precisa de você no GitHub, com a data da leitura e o aviso quando ela não vale. */
export interface PendenciasGithub {
  conexao: Conexao["estado"];
  /** Por que a lista pode estar velha ou vazia sem querer dizer "nada"; `null` quando vale. */
  aviso: string | null;
  lidoEm: string | null;
  itens: PendenciaGithub[];
}

/** Linhas gravadas pela leitura do GitHub levam a origem `conexao` (DATA.md §1). */
const ORIGEM = "conexao";

interface LinhaItem {
  id: string;
  repositorio: string;
  numero: number;
  tipo: ItemGithub["tipo"];
  titulo: string;
  autor: string | null;
  estado: string;
  meu_papel: ItemGithub["meuPapel"];
  precisa_de_mim: number;
  ci_estado: string | null;
  atualizado_no_github: string | null;
  url: string;
}

const ESTADOS: readonly string[] = ["aberto", "fechado", "mesclado"] satisfies EstadoItemGithub[];
const CIS: readonly string[] = ["passou", "falhou", "rodando"] satisfies EstadoCi[];

/** `estado` e `ci_estado` são texto livre no banco (DATA.md §5); o que o contrato não conhece não sai. */
const paraItem = (l: LinhaItem): ItemGithub => ({
  id: l.id,
  repositorio: l.repositorio,
  numero: l.numero,
  tipo: l.tipo,
  titulo: l.titulo,
  autor: l.autor,
  estado: ESTADOS.includes(l.estado) ? (l.estado as EstadoItemGithub) : "aberto",
  meuPapel: l.meu_papel,
  precisaDeMim: l.precisa_de_mim === 1,
  ciEstado: l.ci_estado && CIS.includes(l.ci_estado) ? (l.ci_estado as EstadoCi) : null,
  atualizadoNoGithub: l.atualizado_no_github,
  url: l.url,
});

/** O cache `github_itens` (migração 004): o que o GitHub mostrou na última leitura que deu certo. */
export class RepositorioGithub {
  constructor(private readonly db: DatabaseSync) {}

  /** O que precisa de você primeiro; depois o atualizado mais recentemente no GitHub. */
  itens(): ItemGithub[] {
    const linhas = this.db
      .prepare(
        `SELECT id, repositorio, numero, tipo, titulo, autor, estado, meu_papel, precisa_de_mim,
                ci_estado, atualizado_no_github, url
           FROM github_itens
          ORDER BY precisa_de_mim DESC, atualizado_no_github DESC, id`,
      )
      .all() as unknown as LinhaItem[];
    return linhas.map(paraItem);
  }

  /**
   * Troca o cache pelo que a leitura trouxe: o item que continua guarda o id, o novo ganha um, e o
   * que saiu das buscas (fechado, review feito, desatribuído) sai do cache. Roda dentro da
   * {@link transacao} que também marca a leitura na conexão.
   */
  substituir(itens: readonly ItemLido[], agora: string): void {
    const gravar = this.db.prepare(
      `INSERT INTO github_itens (id, repositorio, numero, tipo, titulo, autor, estado, meu_papel,
         precisa_de_mim, ci_estado, atualizado_no_github, url, criado_em, atualizado_em, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repositorio, numero) DO UPDATE SET
         tipo = excluded.tipo, titulo = excluded.titulo, autor = excluded.autor,
         estado = excluded.estado, meu_papel = excluded.meu_papel,
         precisa_de_mim = excluded.precisa_de_mim, ci_estado = excluded.ci_estado,
         atualizado_no_github = excluded.atualizado_no_github, url = excluded.url,
         atualizado_em = excluded.atualizado_em, origem = excluded.origem`,
    );
    for (const i of itens) {
      gravar.run(
        novoId(),
        i.repositorio,
        i.numero,
        i.tipo,
        i.titulo,
        i.autor,
        i.estado,
        i.meuPapel,
        i.precisaDeMim ? 1 : 0,
        i.ciEstado,
        i.atualizadoNoGithub,
        i.url,
        agora,
        agora,
        ORIGEM,
      );
    }
    // Tudo o que a leitura trouxe ficou com este `atualizado_em`; o resto saiu do GitHub.
    this.db.prepare("DELETE FROM github_itens WHERE atualizado_em <> ?").run(agora);
  }

  limpar(): void {
    this.db.exec("DELETE FROM github_itens");
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

export interface AvisosGithub {
  github: (situacao: SituacaoGithub) => void;
  conexao: (conexao: Conexao) => void;
}

export interface OpcoesGithub {
  agora?: () => Date;
}

const mesma = (a: Conexao, b: Conexao) => JSON.stringify(a) === JSON.stringify(b);

/**
 * O GitHub pelo `gh` (AGENTS.md §2 Nuno, §6): a conexão, o cache e o vigia de 15 minutos. Ligar
 * é ler uma vez: sem `gh` ou sem login, a Conexão fica em erro dizendo o que fazer, e o vigia
 * continua tentando até dar certo. Só desligar para o vigia; o cache sai junto.
 */
export class ServicoGithub {
  private readonly agora: () => Date;
  private emAndamento: Promise<SituacaoGithub> | null = null;
  /** Muda a cada desligar: a leitura que começou antes não grava depois. */
  private geracao = 0;

  constructor(
    private readonly repo: RepositorioGithub,
    private readonly conexoes: RepositorioConexoes,
    private readonly gh: ExecutorGh,
    private readonly avisos: AvisosGithub,
    opcoes: OpcoesGithub = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /** O cache e a última leitura que deu certo, mesmo quando ela não trouxe item nenhum. */
  obter(): SituacaoGithub {
    return { itens: this.repo.itens(), atualizadoEm: this.conexoes.obter("github")?.lida_em ?? null };
  }

  conexao(): Conexao {
    const linha = this.conexoes.obter("github");
    const estado = linha?.estado === "ligada" || linha?.estado === "erro" ? linha.estado : "desligada";
    if (!linha || estado === "desligada") {
      return { tipo: "github", estado: "desligada", conta: null, ultimoErro: null, conectadaEm: null };
    }
    return {
      tipo: "github",
      estado,
      conta: linha.conta,
      ultimoErro: estado === "erro" ? linha.ultimo_erro : null,
      conectadaEm: linha.conectada_em,
    };
  }

  /**
   * O que precisa de você, pelo cache: PR esperando seu review, seu PR com mudanças pedidas ou CI
   * quebrado, issue atribuída. Desligada, a lista vem vazia com o aviso de que não há como saber;
   * em erro, com o motivo, porque a lista é a da última leitura que deu certo.
   */
  pendencias(): PendenciasGithub {
    const conexao = this.conexao();
    const { itens, atualizadoEm } = this.obter();
    const aviso =
      conexao.estado === "desligada"
        ? AVISO_DESLIGADA
        : conexao.estado === "erro"
          ? conexao.ultimoErro
          : null;
    const pendentes: PendenciaGithub[] = [];
    for (const item of itens) {
      const motivo = motivoDoItem(item);
      if (!motivo) continue;
      pendentes.push({
        repositorio: item.repositorio,
        numero: item.numero,
        tipo: item.tipo,
        titulo: item.titulo,
        autor: item.autor,
        motivo,
        ciEstado: item.ciEstado,
        atualizadoNoGithub: item.atualizadoNoGithub,
        url: item.url,
      });
    }
    return { conexao: conexao.estado, aviso, lidoEm: atualizadoEm, itens: pendentes };
  }

  /**
   * Um PR ou uma issue lidos agora no GitHub, para resumir. Sem o tipo, vale o do cache; fora do
   * cache, PR. Só com a conexão ligada ou em erro: desligada, o Nuno não vai ao GitHub.
   */
  async detalhe(alvo: AlvoGithub & { tipo?: TipoItemGithub }): Promise<DetalheGithub> {
    this.exigirConexao();
    const tipo = alvo.tipo ?? this.doCache(alvo)?.tipo ?? "pr";
    return traduzir(lerDetalhe(this.gh, { repositorio: alvo.repositorio, numero: alvo.numero, tipo }));
  }

  /** Comenta no PR ou na issue. Ação externa: quem chama já tem o sim do usuário. */
  async comentar(alvo: AlvoGithub & { texto: string }): Promise<{ url: string | null }> {
    this.exigirConexao();
    return traduzir(comentar(this.gh, alvo));
  }

  private exigirConexao(): void {
    if (this.conexao().estado === "desligada") throw new Error(AVISO_DESLIGADA);
  }

  private doCache(alvo: AlvoGithub): ItemGithub | undefined {
    const repositorio = alvo.repositorio.toLowerCase();
    return this.repo
      .itens()
      .find((i) => i.numero === alvo.numero && i.repositorio.toLowerCase() === repositorio);
  }

  /** Conectar é ler agora; o resultado diz se ficou ligada ou o que falta. */
  async ligar(): Promise<Conexao> {
    await this.ler("usuario");
    return this.conexao();
  }

  /** Para o vigia e apaga o cache; uma leitura que estava no meio é descartada. */
  async desligar(): Promise<Conexao> {
    this.geracao++;
    this.emAndamento = null;
    const antes = this.conexao();
    this.repo.transacao(() => {
      this.gravar(
        { estado: "desligada", ultimoErro: null, conectadaEm: null, conta: null, lidaEm: null },
        "usuario",
      );
      this.repo.limpar();
    });
    this.avisos.github(this.obter());
    const depois = this.conexao();
    if (!mesma(antes, depois)) this.avisos.conexao(depois);
    return depois;
  }

  /**
   * Lê o GitHub agora, se a conexão não está desligada; desligada, devolve o cache (vazio). O
   * botão "atualizar" é do usuário; o vigia lê como `conexao`.
   */
  atualizar(origem: OrigemConexao = "usuario"): Promise<SituacaoGithub> {
    if (this.conexao().estado === "desligada") return Promise.resolve(this.obter());
    return this.ler(origem);
  }

  /** Duas chamadas juntas (o vigia e o botão "atualizar") viram uma leitura só. */
  private ler(origem: OrigemConexao): Promise<SituacaoGithub> {
    if (this.emAndamento) return this.emAndamento;
    const geracao = this.geracao;
    const leitura: Promise<SituacaoGithub> = lerGithub(this.gh)
      .then((lida) => (geracao === this.geracao ? this.aplicar(lida, origem) : this.obter()))
      .finally(() => {
        if (this.emAndamento === leitura) this.emAndamento = null;
      });
    this.emAndamento = leitura;
    return leitura;
  }

  /**
   * Vigia sem token (AGENTS.md §6): lê na subida e a cada {@link INTERVALO_GITHUB_MS}. Não segura
   * o processo aberto; devolve como parar.
   */
  vigiar(intervaloMs = INTERVALO_GITHUB_MS): () => void {
    const ler = () => {
      this.atualizar("conexao").catch((erro: unknown) =>
        console.error(`github: leitura falhou: ${String(erro)}`),
      );
    };
    ler();
    const relogio = setInterval(ler, intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }

  private aplicar(leitura: LeituraGithub, origem: OrigemConexao): SituacaoGithub {
    const antes = this.conexao();
    const agora = this.agora().toISOString();
    if (leitura.tipo === "ok") {
      // Cache e data da leitura juntos: uma leitura sem item nenhum também conta como feita.
      this.repo.transacao(() => {
        this.repo.substituir(leitura.itens, agora);
        this.gravar(
          {
            estado: "ligada",
            ultimoErro: null,
            conectadaEm: antes.conectadaEm ?? agora,
            conta: leitura.conta,
            lidaEm: agora,
          },
          origem,
        );
      });
    } else {
      // O cache fica como estava: o `atualizadoEm` antigo já diz que ele envelheceu.
      const ultimoErro =
        leitura.tipo === "sem-gh"
          ? AVISO_SEM_GH
          : leitura.tipo === "sem-login"
            ? AVISO_SEM_LOGIN
            : avisoFalhou(leitura.motivo);
      this.gravar({ estado: "erro", ultimoErro, conectadaEm: antes.conectadaEm, conta: antes.conta }, origem);
    }
    const situacao = this.obter();
    if (leitura.tipo === "ok") this.avisos.github(situacao);
    const depois = this.conexao();
    if (!mesma(antes, depois)) this.avisos.conexao(depois);
    return situacao;
  }

  /** O `gh` guarda a própria autenticação: a conexão não tem credencial do Moductus. */
  private gravar(
    dados: {
      estado: Conexao["estado"];
      ultimoErro: string | null;
      conectadaEm: string | null;
      conta: string | null;
      lidaEm?: string | null;
    },
    origem: OrigemConexao,
  ): void {
    this.conexoes.gravar("github", { ...dados, credencial: null }, this.agora().toISOString(), origem);
  }
}

/** Sem `gh` ou sem login, o erro diz o que fazer, como na Conexão. */
async function traduzir<T>(acao: Promise<T>): Promise<T> {
  try {
    return await acao;
  } catch (erro) {
    if (erro instanceof GhAusente) throw new Error(AVISO_SEM_GH, { cause: erro });
    if (erro instanceof SemLoginGh) throw new Error(AVISO_SEM_LOGIN, { cause: erro });
    throw erro;
  }
}
