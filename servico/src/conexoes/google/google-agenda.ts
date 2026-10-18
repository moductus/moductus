import type { Conexao } from "@moductus/contrato";
import type { AbrirNaCasca } from "../../casca/abrir.ts";
import type { Credenciais } from "../../casca/credenciais.ts";
import type { RepositorioConexoes } from "../conexoes.ts";
import {
  CLIENTE_DO_AUTOR,
  ENDERECOS_GOOGLE,
  ESCOPOS_AO_CONECTAR,
  validarCliente,
  type ClienteOAuth,
  type EnderecosGoogle,
} from "./cliente.ts";
import {
  abrirReceptorOAuth,
  ErroOAuth,
  FalhaAutorizacao,
  gerarPkce,
  gerarState,
  lerConta,
  PRAZO_AUTORIZACAO_MS,
  renovar,
  revogar,
  trocarCodigo,
  urlDeAutorizacao,
  type ReceptorOAuth,
} from "./oauth.ts";

/** Nomes no Gerenciador de Credenciais (ficam "Moductus/google-agenda" e "Moductus/google-agenda-cliente"). */
export const CREDENCIAL_GOOGLE = "google-agenda";
export const CREDENCIAL_CLIENTE_GOOGLE = "google-agenda-cliente";

/** Ditos na Conexão (AGENTS.md §2 Voz: o que aconteceu, depois o que fazer). */
export const AVISO_SEM_CLIENTE =
  "Esta versão do Moductus ainda não tem o cliente do Google. Use o seu próprio cliente em Configurações › Conexões.";
export const AVISO_PRAZO = "Passaram 5 minutos sem a autorização no navegador. Conecte de novo.";
export const AVISO_NEGADO = "A autorização foi negada no Google. Conecte de novo quando quiser.";
export const AVISO_STATE = "A resposta que chegou do navegador não é deste pedido. Conecte de novo.";
export const AVISO_RECUSADO = "O Google não concluiu a autorização. Conecte de novo.";
export const AVISO_CODIGO_VENCIDO = "A autorização venceu antes de chegar ao Moductus. Conecte de novo.";
export const AVISO_CLIENTE_INVALIDO =
  "O Google não reconhece o cliente OAuth. Confira o client ID e o secret, ou use o seu próprio cliente.";
export const AVISO_SEM_RENOVACAO = "O Google não deu a autorização duradoura. Conecte de novo.";
export const AVISO_ESCOPOS =
  "Faltou marcar permissões na tela do Google. Conecte de novo e deixe todas marcadas.";
/** `invalid_grant` na renovação: a autorização foi revogada, venceu ou a senha mudou. */
export const AVISO_RECONECTAR =
  "O Google não aceita mais a autorização do Moductus. Reconecte em Configurações › Conexões.";
export const AVISO_DESLIGADA = "O Google Agenda não está conectado. Conecte em Configurações › Conexões.";
export const AVISO_REVOGACAO =
  "Desconectado aqui, mas o Google não confirmou a revogação. Se quiser, tire o Moductus em myaccount.google.com/permissions.";
export const AVISO_TROCAR_CLIENTE = "Desconecte o Google Agenda antes de trocar o cliente.";
/**
 * A fala de erro da Alba (AGENTS.md §2 "Voz dos agentes"), com o intervalo da leitura (F3-23): o
 * título vai no aviso e as duas frases juntas na Conexão.
 */
export const TITULO_LEITURA_FALHOU = "Não consegui ler o Google Agenda.";
export const CORPO_LEITURA_FALHOU =
  "Os eventos de hoje podem estar incompletos; tento de novo em 10 minutos.";
export const AVISO_LEITURA = `${TITULO_LEITURA_FALHOU} ${CORPO_LEITURA_FALHOU}`;
export const avisoNavegador = (motivo: string) =>
  `Não consegui abrir o navegador (${motivo}). Conecte de novo.`;
export const avisoFalhou = (motivo: string) =>
  `Não consegui conectar ao Google (${motivo}). Conecte de novo.`;

/** Token de acesso que vence nisso é renovado antes de usar. */
const MARGEM_RENOVACAO_MS = 60_000;

/** O que fica no Gerenciador de Credenciais; no banco, só o nome dele (ADR-0031, ADR-0007). */
interface Guardada {
  tokenDeRenovacao: string;
  escopos: string[];
  conta: string | null;
}

export interface DependenciasGoogle {
  conexoes: RepositorioConexoes;
  credenciais: Credenciais;
  /** A casca abre a URL de autorização no navegador padrão (ADR-0038). */
  abrir: Pick<AbrirNaCasca, "endereco">;
  avisar: (conexao: Conexao) => void;
  /** O cliente do Moductus; o teste usa um client id de teste. */
  clienteDoAutor?: ClienteOAuth | null;
  enderecos?: EnderecosGoogle;
  buscar?: typeof fetch;
  agora?: () => Date;
  prazoMs?: number;
}

const mesma = (a: Conexao, b: Conexao) => JSON.stringify(a) === JSON.stringify(b);
const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

function lerJson<T>(texto: string | null, valido: (v: Record<string, unknown>) => boolean): T | null {
  if (!texto) return null;
  try {
    const valor = JSON.parse(texto) as unknown;
    return valor && typeof valor === "object" && valido(valor as Record<string, unknown>)
      ? (valor as T)
      : null;
  } catch {
    return null;
  }
}

/** O que dizer ao usuário quando conectar não chegou ao fim. */
function avisoDe(erro: unknown): string {
  if (erro instanceof FalhaAutorizacao) {
    switch (erro.motivo) {
      case "prazo":
        return AVISO_PRAZO;
      case "negado":
        return AVISO_NEGADO;
      case "state":
        return AVISO_STATE;
      default:
        return AVISO_RECUSADO;
    }
  }
  if (erro instanceof ErroOAuth) {
    if (erro.codigo === "invalid_grant") return AVISO_CODIGO_VENCIDO;
    if (erro.codigo === "invalid_client" || erro.codigo === "unauthorized_client")
      return AVISO_CLIENTE_INVALIDO;
  }
  return avisoFalhou(mensagem(erro));
}

/**
 * A conexão com o Google Agenda da Alba (ADR-0031). Conectar abre o receptor em 127.0.0.1, pede à
 * casca para abrir a autorização no navegador e espera até 5 minutos; com o código, troca pelos
 * tokens, confere os escopos e guarda o refresh token no Gerenciador de Credenciais. O token de
 * acesso fica só na memória. Desconectar revoga no Google e apaga a credencial mesmo se o revoke
 * falhar. `invalid_grant` na renovação põe a conexão em erro pedindo para reconectar.
 */
export class ServicoGoogleAgenda {
  private readonly agora: () => Date;
  private readonly enderecos: EnderecosGoogle;
  private readonly buscar: typeof fetch;
  private emAndamento: Promise<Conexao> | null = null;
  private receptor: ReceptorOAuth | null = null;
  /** Muda a cada desconectar: o que começou antes não grava depois. */
  private geracao = 0;
  private acesso: { token: string; venceEm: number } | null = null;
  private renovando: Promise<string> | null = null;

  constructor(private readonly deps: DependenciasGoogle) {
    this.agora = deps.agora ?? (() => new Date());
    this.enderecos = deps.enderecos ?? ENDERECOS_GOOGLE;
    this.buscar = deps.buscar ?? fetch;
  }

  conexao(): Conexao {
    const linha = this.deps.conexoes.obter("google-agenda");
    const estado = linha?.estado === "ligada" || linha?.estado === "erro" ? linha.estado : "desligada";
    return {
      tipo: "google-agenda",
      estado,
      conta: estado === "desligada" ? null : (linha?.conta ?? null),
      // Desligada pode trazer o aviso de que o Google não confirmou a revogação.
      ultimoErro: estado === "ligada" ? null : (linha?.ultimo_erro ?? null),
      conectadaEm: estado === "desligada" ? null : (linha?.conectada_em ?? null),
    };
  }

  /** Dois cliques em "Conectar" viram um fluxo só. */
  ligar(): Promise<Conexao> {
    if (this.emAndamento) return this.emAndamento;
    const fluxo = this.conectar(this.geracao).finally(() => {
      if (this.emAndamento === fluxo) this.emAndamento = null;
    });
    this.emAndamento = fluxo;
    return fluxo;
  }

  private async conectar(geracao: number): Promise<Conexao> {
    const antes = this.conexao();
    let receptor: ReceptorOAuth | null = null;
    try {
      const cliente = await this.cliente();
      if (!cliente) return this.falhar(AVISO_SEM_CLIENTE, antes);
      const { verificador, desafio } = gerarPkce();
      const state = gerarState();
      receptor = await abrirReceptorOAuth(state, this.deps.prazoMs ?? PRAZO_AUTORIZACAO_MS);
      this.receptor = receptor;
      const url = urlDeAutorizacao(this.enderecos, {
        cliente,
        redirecionamento: receptor.redirecionamento,
        escopos: ESCOPOS_AO_CONECTAR,
        desafio,
        state,
      });
      try {
        await this.deps.abrir.endereco(url);
      } catch (erro) {
        return this.falhar(avisoNavegador(mensagem(erro)), antes);
      }
      const codigo = await receptor.codigo;
      const tokens = await trocarCodigo(
        this.buscar,
        this.enderecos,
        { cliente, codigo, verificador, redirecionamento: receptor.redirecionamento },
        this.agora().getTime(),
      );
      // Desconectou enquanto o código era trocado: o token novo não fica valendo.
      if (geracao !== this.geracao) {
        await this.revogarSemFalhar(tokens.tokenDeRenovacao ?? tokens.tokenDeAcesso);
        return this.conexao();
      }
      if (!tokens.tokenDeRenovacao) {
        await this.revogarSemFalhar(tokens.tokenDeAcesso);
        return this.falhar(AVISO_SEM_RENOVACAO, antes);
      }
      // A tela do Google deixa desmarcar permissões: sem as três, a Alba falharia aos pedaços.
      if (ESCOPOS_AO_CONECTAR.some((e) => !tokens.escopos.includes(e))) {
        await this.revogarSemFalhar(tokens.tokenDeRenovacao);
        return this.falhar(AVISO_ESCOPOS, antes);
      }
      const conta = await lerConta(this.buscar, this.enderecos, tokens.tokenDeAcesso);
      const guardada: Guardada = {
        tokenDeRenovacao: tokens.tokenDeRenovacao,
        escopos: tokens.escopos,
        conta,
      };
      try {
        await this.deps.credenciais.guardar(CREDENCIAL_GOOGLE, JSON.stringify(guardada));
      } catch (erro) {
        // Sem onde guardar, o refresh token novo ficaria valendo no Google sem ninguém para usá-lo.
        await this.revogarSemFalhar(tokens.tokenDeRenovacao);
        throw erro;
      }
      // Desconectou enquanto lia a conta ou guardava: o que acabou de ser guardado sai de novo.
      if (geracao !== this.geracao) {
        await this.revogarSemFalhar(tokens.tokenDeRenovacao);
        await this.deps.credenciais.apagar(CREDENCIAL_GOOGLE).catch(() => undefined);
        return this.conexao();
      }
      this.acesso = { token: tokens.tokenDeAcesso, venceEm: tokens.venceEm };
      const agora = this.agora().toISOString();
      return this.gravar(antes, {
        estado: "ligada",
        ultimoErro: null,
        conectadaEm: agora,
        credencial: CREDENCIAL_GOOGLE,
        conta,
        escopos: tokens.escopos,
      });
    } catch (erro) {
      // Desconectar no meio cancela o receptor: não é erro, a conexão já está desligada.
      if (geracao !== this.geracao) return this.conexao();
      console.error(`google: conectar falhou: ${mensagem(erro)}`);
      return this.falhar(avisoDe(erro), antes);
    } finally {
      receptor?.cancelar();
      if (this.receptor === receptor) this.receptor = null;
    }
  }

  /**
   * Revoga no Google e apaga a credencial; o revoke que falha não segura a credencial aqui, e a
   * conexão sai desligada com o aviso de onde tirar o acesso à mão. Um conectar no meio é cancelado.
   */
  async desligar(): Promise<Conexao> {
    this.geracao++;
    this.receptor?.cancelar();
    this.emAndamento = null;
    this.acesso = null;
    this.renovando = null;
    const antes = this.conexao();
    let aviso: string | null = null;
    const guardada = await this.guardada().catch(() => null);
    if (guardada) {
      try {
        await revogar(this.buscar, this.enderecos, guardada.tokenDeRenovacao);
      } catch (erro) {
        // `invalid_token` é o token que o Google já não reconhece: já revogado, nada a tirar à mão.
        if (!(erro instanceof ErroOAuth && erro.codigo === "invalid_token")) {
          console.error(`google: revogação falhou: ${mensagem(erro)}`);
          aviso = AVISO_REVOGACAO;
        }
      }
    }
    try {
      await this.deps.credenciais.apagar(CREDENCIAL_GOOGLE);
    } catch (erro) {
      return this.falhar(
        `Não consegui apagar a credencial do Google (${mensagem(erro)}). Tente de novo.`,
        antes,
      );
    }
    return this.gravar(antes, {
      estado: "desligada",
      ultimoErro: aviso,
      conectadaEm: null,
      credencial: null,
      conta: null,
      escopos: [],
      lidaEm: null,
    });
  }

  /**
   * Um token de acesso válido para a API do Calendar (F3-23 em diante). Renova pelo refresh token
   * quando falta; `invalid_grant` apaga a credencial, que não vale mais, e põe a conexão em erro
   * com "Reconectar". Outras falhas (sem rede) só sobem: a conexão continua como estava.
   */
  tokenDeAcesso(): Promise<string> {
    // O token da memória só vale com a conexão ligada: em erro ou desligada, quem decide é renovar.
    if (
      this.acesso &&
      this.acesso.venceEm - MARGEM_RENOVACAO_MS > this.agora().getTime() &&
      this.conexao().estado === "ligada"
    ) {
      return Promise.resolve(this.acesso.token);
    }
    if (this.renovando) return this.renovando;
    const pedido = this.renovarAcesso(this.geracao).finally(() => {
      if (this.renovando === pedido) this.renovando = null;
    });
    this.renovando = pedido;
    return pedido;
  }

  private async renovarAcesso(geracao: number): Promise<string> {
    if (this.conexao().estado === "desligada") throw new Error(AVISO_DESLIGADA);
    const guardada = await this.guardada();
    if (!guardada) {
      if (geracao !== this.geracao) throw new Error(AVISO_DESLIGADA);
      // Ligada sem a credencial (apagada à mão no Gerenciador): sem ela não há como renovar.
      if (this.conexao().estado === "ligada") this.pedirReconexao();
      throw new Error(this.conexao().ultimoErro ?? AVISO_RECONECTAR);
    }
    const cliente = await this.cliente();
    if (!cliente) throw new Error(AVISO_SEM_CLIENTE);
    let tokens;
    try {
      tokens = await renovar(
        this.buscar,
        this.enderecos,
        { cliente, tokenDeRenovacao: guardada.tokenDeRenovacao },
        this.agora().getTime(),
      );
    } catch (erro) {
      if (erro instanceof ErroOAuth && erro.codigo === "invalid_grant" && geracao === this.geracao) {
        await this.deps.credenciais.apagar(CREDENCIAL_GOOGLE).catch(() => undefined);
        // Desconectou enquanto a credencial era apagada: a conexão já está como devia.
        if (geracao !== this.geracao) throw new Error(AVISO_DESLIGADA, { cause: erro });
        this.pedirReconexao();
        throw new Error(AVISO_RECONECTAR, { cause: erro });
      }
      throw erro;
    }
    if (geracao !== this.geracao) throw new Error(AVISO_DESLIGADA);
    // O Google às vezes troca o refresh token: o novo substitui o guardado.
    const trocado = tokens.tokenDeRenovacao;
    if (trocado && trocado !== guardada.tokenDeRenovacao) {
      await this.deps.credenciais.guardar(
        CREDENCIAL_GOOGLE,
        JSON.stringify({ ...guardada, tokenDeRenovacao: trocado } satisfies Guardada),
      );
      // Desconectou enquanto gravava: o que acabou de ser guardado ressuscitaria a credencial.
      if (geracao !== this.geracao) {
        await this.revogarSemFalhar(trocado);
        // Só apaga se ainda é a que este pedido gravou: um conectar novo pode ter guardado a dele.
        const agora = await this.guardada().catch(() => null);
        if (agora?.tokenDeRenovacao === trocado) {
          await this.deps.credenciais.apagar(CREDENCIAL_GOOGLE).catch(() => undefined);
        }
        throw new Error(AVISO_DESLIGADA);
      }
    }
    this.acesso = { token: tokens.tokenDeAcesso, venceEm: tokens.venceEm };
    return tokens.tokenDeAcesso;
  }

  /**
   * O Google recusou este token de acesso (401) antes de vencer: o próximo pedido renova. Só esquece
   * se ainda é o mesmo, para não jogar fora um que outro pedido acabou de renovar.
   */
  acessoRecusado(token: string): void {
    if (this.acesso?.token === token) this.acesso = null;
  }

  /**
   * O resultado de uma leitura do Calendar (F3-23). A que deu certo anota a data e tira o erro de
   * leitura; a que falhou põe a conexão em erro com a fala da Alba. Erro de outra natureza (pedir
   * para reconectar, conectar que não terminou) fica como está: ele diz o que fazer, e a leitura
   * não sabe resolver. Desligada não muda. Devolve se a conexão acabou de entrar no erro de
   * leitura, para a Alba avisar uma vez só.
   */
  marcarLeitura(resultado: { ok: boolean }): boolean {
    const antes = this.conexao();
    if (antes.estado === "desligada") return false;
    if (antes.estado === "erro" && antes.ultimoErro !== AVISO_LEITURA) return false;
    const linha = this.deps.conexoes.obter("google-agenda");
    const agora = this.agora().toISOString();
    this.gravar(
      antes,
      {
        estado: resultado.ok ? "ligada" : "erro",
        ultimoErro: resultado.ok ? null : AVISO_LEITURA,
        conectadaEm: antes.conectadaEm,
        credencial: linha?.credencial ?? null,
        conta: antes.conta,
        ...(resultado.ok ? { lidaEm: agora } : {}),
      },
      "conexao",
    );
    return !resultado.ok && antes.estado === "ligada";
  }

  /** A credencial não vale mais: a conexão fica em erro com "Reconectar", e as janelas sabem. */
  private pedirReconexao(): void {
    this.acesso = null;
    const antes = this.conexao();
    this.gravar(
      antes,
      {
        estado: "erro",
        ultimoErro: AVISO_RECONECTAR,
        conectadaEm: antes.conectadaEm,
        credencial: null,
        conta: antes.conta,
      },
      "conexao",
    );
  }

  /** Se o usuário trouxe o próprio cliente OAuth. */
  async usaClienteProprio(): Promise<boolean> {
    return (await this.clienteProprio()) !== null;
  }

  /**
   * "Usar meu próprio cliente" (ADR-0031): client ID e secret vão ao Gerenciador de Credenciais,
   * nunca ao banco nem ao log; `null` volta ao cliente do Moductus. O refresh token é do cliente
   * que o gerou, então trocar com a conexão feita é recusado: primeiro desconecta.
   */
  async definirCliente(cliente: { id: string; segredo?: string | null } | null): Promise<void> {
    if (this.emAndamento || (await this.guardada()) !== null) throw new Error(AVISO_TROCAR_CLIENTE);
    if (cliente === null) {
      await this.deps.credenciais.apagar(CREDENCIAL_CLIENTE_GOOGLE);
      return;
    }
    await this.deps.credenciais.guardar(CREDENCIAL_CLIENTE_GOOGLE, JSON.stringify(validarCliente(cliente)));
  }

  private async clienteProprio(): Promise<ClienteOAuth | null> {
    return lerJson<ClienteOAuth>(
      await this.deps.credenciais.ler(CREDENCIAL_CLIENTE_GOOGLE),
      (v) => typeof v.id === "string" && v.id.length > 0,
    );
  }

  /** O do usuário vence o do Moductus. */
  private async cliente(): Promise<ClienteOAuth | null> {
    const proprio = await this.clienteProprio();
    if (proprio) return { id: proprio.id, segredo: proprio.segredo ?? null };
    return this.deps.clienteDoAutor === undefined ? CLIENTE_DO_AUTOR : this.deps.clienteDoAutor;
  }

  private async guardada(): Promise<Guardada | null> {
    return lerJson<Guardada>(
      await this.deps.credenciais.ler(CREDENCIAL_GOOGLE),
      (v) => typeof v.tokenDeRenovacao === "string" && v.tokenDeRenovacao.length > 0,
    );
  }

  private async revogarSemFalhar(token: string): Promise<void> {
    await revogar(this.buscar, this.enderecos, token).catch((erro: unknown) =>
      console.error(`google: revogação do token descartado falhou: ${mensagem(erro)}`),
    );
  }

  /** Erro mantém a conta e a data de antes: a credencial antiga, se havia, continua guardada. */
  private falhar(ultimoErro: string, antes: Conexao): Conexao {
    const linha = this.deps.conexoes.obter("google-agenda");
    return this.gravar(antes, {
      estado: "erro",
      ultimoErro,
      conectadaEm: antes.conectadaEm,
      credencial: linha?.credencial ?? null,
      conta: antes.conta,
    });
  }

  private gravar(
    antes: Conexao,
    dados: {
      estado: Conexao["estado"];
      ultimoErro: string | null;
      conectadaEm: string | null;
      credencial: string | null;
      conta: string | null;
      escopos?: readonly string[];
      /** A última leitura do Calendar que deu certo; ausente mantém a de antes. */
      lidaEm?: string | null;
    },
    origem: "usuario" | "conexao" = "usuario",
  ): Conexao {
    this.deps.conexoes.gravar("google-agenda", dados, this.agora().toISOString(), origem);
    const depois = this.conexao();
    if (!mesma(antes, depois)) this.deps.avisar(depois);
    return depois;
  }
}
