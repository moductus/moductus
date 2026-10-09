import type { DatabaseSync } from "node:sqlite";
import type { Conexao, EstadoLigacao, PedidoConexao, PreviaConexao, TipoConexao } from "@moductus/contrato";
import { novoId } from "../banco/ulid.ts";
import type { AmbienteDoUsuario } from "../casca/ambiente.ts";
import { VARIAVEL_TOKEN, type LigacaoClaudeCode } from "../sessoes/ligacao.ts";
import { CREDENCIAL_HOOKS } from "../sessoes/token.ts";

/** Ditos ao usuário na tela de conexões (AGENTS.md §2 Voz: curto, o que fazer). */
export const AVISO_SAIU = "Os hooks do Moductus saíram do settings.json. Ligue de novo.";
export const AVISO_DESATUALIZADA = "A ligação com o Claude Code está desatualizada. Ligue de novo.";

interface LinhaConexao {
  id: string;
  estado: string;
  ultimo_erro: string | null;
  conectada_em: string | null;
}

/** A linha viva de cada tipo em `conexoes` (DATA.md §7); a apagada fica na lixeira. */
export class RepositorioConexoes {
  constructor(private readonly db: DatabaseSync) {}

  obter(tipo: TipoConexao): LinhaConexao | null {
    const linha = this.db
      .prepare(
        `SELECT id, estado, ultimo_erro, conectada_em FROM conexoes
          WHERE tipo = ? AND apagado_em IS NULL ORDER BY id DESC LIMIT 1`,
      )
      .get(tipo) as LinhaConexao | undefined;
    return linha ?? null;
  }

  gravar(
    tipo: TipoConexao,
    dados: {
      estado: EstadoLigacao;
      ultimoErro: string | null;
      conectadaEm: string | null;
      credencial: string | null;
    },
    agora: string,
  ): void {
    const atual = this.obter(tipo);
    if (atual) {
      this.db
        .prepare(
          `UPDATE conexoes SET estado = ?, ultimo_erro = ?, conectada_em = ?, credencial = ?,
                  origem = 'usuario', atualizado_em = ? WHERE id = ?`,
        )
        .run(dados.estado, dados.ultimoErro, dados.conectadaEm, dados.credencial, agora, atual.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO conexoes (id, tipo, credencial, estado, ultimo_erro, conectada_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(novoId(), tipo, dados.credencial, dados.estado, dados.ultimoErro, dados.conectadaEm, agora, agora);
  }
}

export interface DependenciasConexoes {
  ligacao: LigacaoClaudeCode;
  ambiente: AmbienteDoUsuario;
  /** O token dos hooks (`tokenDosHooks`), lido do Gerenciador de Credenciais na hora. */
  token: () => Promise<string>;
  agora?: () => Date;
}

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

/**
 * Conexões da tela de Configurações › Conexões. Nesta tarefa, a do Claude Code (F2-22): ligar
 * mostra antes o que muda no `settings.json`, publica `MODUCTUS_HOOKS_TOKEN` e grava os hooks;
 * desligar tira só o que é do Moductus e apaga a variável. A do GitHub chega com a F2-25.
 */
export class ServicoConexoes {
  private readonly agora: () => Date;

  constructor(
    private readonly repositorio: RepositorioConexoes,
    private readonly deps: DependenciasConexoes,
    private readonly avisar: (conexao: Conexao) => void,
  ) {
    this.agora = deps.agora ?? (() => new Date());
  }

  listar(): Conexao[] {
    return [this.claudeCode()];
  }

  previa(pedido: PedidoConexao): PreviaConexao {
    this.soClaudeCode(pedido.tipo);
    return { tipo: pedido.tipo, arquivos: [this.deps.ligacao.previa()] };
  }

  /**
   * A variável vem antes do arquivo: hook gravado sem token publicado só geraria recusas. Falha
   * no meio vira estado `erro` com o motivo, que a tela mostra; o arquivo não fica pela metade.
   */
  async ligar(pedido: PedidoConexao): Promise<Conexao> {
    this.soClaudeCode(pedido.tipo);
    const agora = this.agora().toISOString();
    try {
      // Arquivo que o Moductus não sabe editar recusa antes de publicar qualquer coisa.
      this.deps.ligacao.previa();
      await this.deps.ambiente.definir(VARIAVEL_TOKEN, await this.deps.token());
      this.deps.ligacao.ligar();
      this.repositorio.gravar(
        "hooks-claude-code",
        { estado: "ligada", ultimoErro: null, conectadaEm: agora, credencial: CREDENCIAL_HOOKS },
        agora,
      );
    } catch (erro) {
      const atual = this.repositorio.obter("hooks-claude-code");
      this.repositorio.gravar(
        "hooks-claude-code",
        {
          estado: "erro",
          ultimoErro: mensagem(erro),
          conectadaEm: atual?.conectada_em ?? null,
          credencial: CREDENCIAL_HOOKS,
        },
        agora,
      );
    }
    return this.mudou();
  }

  /** O arquivo sai antes da variável, pelo mesmo motivo de ligar ao contrário. */
  async desligar(pedido: PedidoConexao): Promise<Conexao> {
    this.soClaudeCode(pedido.tipo);
    const agora = this.agora().toISOString();
    try {
      this.deps.ligacao.desligar();
      await this.deps.ambiente.apagar(VARIAVEL_TOKEN);
      this.repositorio.gravar(
        "hooks-claude-code",
        { estado: "desligada", ultimoErro: null, conectadaEm: null, credencial: null },
        agora,
      );
    } catch (erro) {
      const atual = this.repositorio.obter("hooks-claude-code");
      this.repositorio.gravar(
        "hooks-claude-code",
        {
          estado: "erro",
          ultimoErro: mensagem(erro),
          conectadaEm: atual?.conectada_em ?? null,
          credencial: CREDENCIAL_HOOKS,
        },
        agora,
      );
    }
    return this.mudou();
  }

  private mudou(): Conexao {
    const conexao = this.claudeCode();
    this.avisar(conexao);
    return conexao;
  }

  private soClaudeCode(tipo: TipoConexao): void {
    if (tipo !== "hooks-claude-code") {
      throw new Error(`a conexão ${tipo} ainda não está disponível nesta versão do serviço`);
    }
  }

  /**
   * O estado sai do arquivo, que é a verdade: o usuário pode ter mexido nele à mão. A linha do
   * banco diz quando ligou e o último erro, e distingue "nunca ligou" de "os hooks sumiram".
   */
  private claudeCode(): Conexao {
    const linha = this.repositorio.obter("hooks-claude-code");
    const base = {
      tipo: "hooks-claude-code" as const,
      conta: null,
      conectadaEm: linha?.conectada_em ?? null,
    };
    if (linha?.estado === "erro") return { ...base, estado: "erro", ultimoErro: linha.ultimo_erro };
    let situacao;
    try {
      situacao = this.deps.ligacao.situacao();
    } catch (erro) {
      return { ...base, estado: "erro", ultimoErro: mensagem(erro) };
    }
    if (situacao === "ligada") return { ...base, estado: "ligada", ultimoErro: null };
    if (situacao === "desatualizada") return { ...base, estado: "erro", ultimoErro: AVISO_DESATUALIZADA };
    if (linha?.estado === "ligada") return { ...base, estado: "erro", ultimoErro: AVISO_SAIU };
    return { ...base, estado: "desligada", ultimoErro: null, conectadaEm: null };
  }
}
