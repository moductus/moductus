import type { DatabaseSync } from "node:sqlite";
import type { Conexao, EstadoLigacao, PedidoConexao, PreviaConexao, TipoConexao } from "@moductus/contrato";
import type { Origem } from "../banco/tabela.ts";
import { novoId } from "../banco/ulid.ts";
import type { AmbienteDoUsuario } from "../casca/ambiente.ts";
import { EVENTOS_LIGADOS, VARIAVEL_TOKEN, type LigacaoClaudeCode } from "../sessoes/ligacao.ts";
import { CREDENCIAL_HOOKS } from "../sessoes/token.ts";

/** Ditos ao usuário na tela de conexões (AGENTS.md §2 Voz: curto, o que fazer). */
export const AVISO_SAIU = "Os hooks do Moductus saíram do settings.json. Ligue de novo.";
export const AVISO_DESATUALIZADA = "A ligação com o Claude Code está desatualizada. Ligue de novo.";

interface LinhaConexao {
  id: string;
  estado: string;
  conta: string | null;
  ultimo_erro: string | null;
  conectada_em: string | null;
  lida_em: string | null;
  /** Nome no Gerenciador de Credenciais; o valor nunca está no banco. */
  credencial: string | null;
  /** JSON lista dos escopos concedidos (a do Google); `[]` nas que não têm. */
  escopos: string;
}

/**
 * Quem mudou a linha (DATA.md §1): `usuario` quando foi um clique dele (ligar, desligar),
 * `conexao` quando foi a própria conexão trabalhando sozinha (o vigia do GitHub).
 */
export type OrigemConexao = Exclude<Origem, "agente">;

/** A linha viva de cada tipo em `conexoes` (DATA.md §7); a apagada fica na lixeira. */
export class RepositorioConexoes {
  constructor(private readonly db: DatabaseSync) {}

  obter(tipo: TipoConexao): LinhaConexao | null {
    const linha = this.db
      .prepare(
        `SELECT id, estado, conta, ultimo_erro, conectada_em, lida_em, credencial, escopos FROM conexoes
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
      /** Usuário da conta conectada (o login do GitHub); vazio quando não há. */
      conta?: string | null;
      /** Última leitura que deu certo; ausente mantém a de antes, `null` apaga. */
      lidaEm?: string | null;
      /** Escopos concedidos; ausente mantém os de antes. */
      escopos?: readonly string[];
    },
    agora: string,
    origem: OrigemConexao = "usuario",
  ): void {
    const atual = this.obter(tipo);
    const conta = dados.conta ?? null;
    const lidaEm = dados.lidaEm === undefined ? (atual?.lida_em ?? null) : dados.lidaEm;
    const escopos = JSON.stringify(dados.escopos ?? JSON.parse(atual?.escopos ?? "[]"));
    if (atual) {
      this.db
        .prepare(
          `UPDATE conexoes SET estado = ?, ultimo_erro = ?, conectada_em = ?, credencial = ?, conta = ?,
                  lida_em = ?, escopos = ?, origem = ?, atualizado_em = ? WHERE id = ?`,
        )
        .run(
          dados.estado,
          dados.ultimoErro,
          dados.conectadaEm,
          dados.credencial,
          conta,
          lidaEm,
          escopos,
          origem,
          agora,
          atual.id,
        );
      return;
    }
    this.db
      .prepare(
        `INSERT INTO conexoes (id, tipo, conta, credencial, estado, ultimo_erro, conectada_em, lida_em,
           escopos, origem, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        novoId(),
        tipo,
        conta,
        dados.credencial,
        dados.estado,
        dados.ultimoErro,
        dados.conectadaEm,
        lidaEm,
        escopos,
        origem,
        agora,
        agora,
      );
  }
}

/** Uma conexão que cuida de si e avisa as janelas ela mesma: o GitHub, o Google Agenda. */
export interface ConexaoPropria {
  conexao(): Conexao;
  ligar(): Promise<Conexao>;
  desligar(): Promise<Conexao>;
}

export interface DependenciasConexoes {
  ligacao: LigacaoClaudeCode;
  ambiente: AmbienteDoUsuario;
  /** O token dos hooks (`tokenDosHooks`), lido do Gerenciador de Credenciais na hora. */
  token: () => Promise<string>;
  /** A do GitHub (`ServicoGithub`). */
  github: ConexaoPropria;
  /** A do Google Agenda da Alba (`ServicoGoogleAgenda`, F3-22). */
  google: ConexaoPropria;
  agora?: () => Date;
}

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

/**
 * Conexões da tela de Configurações › Conexões. A do Claude Code (F2-22): ligar mostra antes o que
 * muda no `settings.json`, publica `MODUCTUS_HOOKS_TOKEN` e grava os hooks; desligar tira só o que
 * é do Moductus e apaga a variável. A do GitHub (F2-25) não mexe em arquivo nenhum: ligar é ler o
 * GitHub pelo `gh` já autenticado, e o `ServicoGithub` cuida dela. A do Google Agenda (F3-22) é o
 * OAuth no navegador, e o `ServicoGoogleAgenda` cuida dela.
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
    return [this.claudeCode(), this.deps.github.conexao(), this.deps.google.conexao()];
  }

  previa(pedido: PedidoConexao): PreviaConexao {
    if (pedido.tipo !== "hooks-claude-code") return { tipo: pedido.tipo, arquivos: [] };
    return { tipo: pedido.tipo, arquivos: [this.deps.ligacao.previa()] };
  }

  /**
   * A variável vem antes do arquivo: hook gravado sem token publicado só geraria recusas. Falha
   * no meio vira estado `erro` com o motivo, que a tela mostra; o arquivo não fica pela metade.
   */
  async ligar(pedido: PedidoConexao): Promise<Conexao> {
    const propria = this.propria(pedido.tipo);
    if (propria) return propria.ligar();
    const agora = this.agora().toISOString();
    let publicou = false;
    let nadaNoArquivo = false;
    try {
      // Arquivo que o Moductus não sabe editar recusa antes de publicar qualquer coisa.
      this.deps.ligacao.previa();
      nadaNoArquivo = this.deps.ligacao.situacao() === "desligada";
      await this.deps.ambiente.definir(VARIAVEL_TOKEN, await this.deps.token());
      publicou = true;
      this.deps.ligacao.ligar();
      this.repositorio.gravar(
        "hooks-claude-code",
        { estado: "ligada", ultimoErro: null, conectadaEm: agora, credencial: CREDENCIAL_HOOKS },
        agora,
      );
    } catch (erro) {
      // A variável publicada agora, sem hook nenhum que a use, sai de novo (melhor esforço). Se os
      // hooks já estavam lá, ela fica: é o que mantém a ligação de antes funcionando.
      if (publicou && nadaNoArquivo) await this.deps.ambiente.apagar(VARIAVEL_TOKEN).catch(() => undefined);
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
    const propria = this.propria(pedido.tipo);
    if (propria) return propria.desligar();
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

  /** As que não mexem em arquivo do usuário; `null` é a do Claude Code, que mora aqui. */
  private propria(tipo: TipoConexao): ConexaoPropria | null {
    if (tipo === "github") return this.deps.github;
    if (tipo === "google-agenda") return this.deps.google;
    return null;
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
    if (situacao === "ligada") {
      const { ligacao } = this.deps;
      return {
        ...base,
        estado: "ligada",
        ultimoErro: null,
        ligacao: {
          caminho: ligacao.caminho,
          eventos: EVENTOS_LIGADOS.length,
          porta: ligacao.porta,
          copia: ligacao.ultimaCopia(),
        },
      };
    }
    if (situacao === "desatualizada") return { ...base, estado: "erro", ultimoErro: AVISO_DESATUALIZADA };
    if (linha?.estado === "ligada") return { ...base, estado: "erro", ultimoErro: AVISO_SAIU };
    return { ...base, estado: "desligada", ultimoErro: null, conectadaEm: null };
  }
}
