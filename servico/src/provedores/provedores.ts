import type { DatabaseSync } from "node:sqlite";
import {
  TIPOS_PROVEDOR_CLI,
  type FalhaProvedor,
  type MudancaProvedor,
  type NovoProvedor,
  type PedidoProvedor,
  type Provedor,
  type ProvedorDetectado,
  type ResultadoTesteProvedor,
  type TipoProvedor,
} from "@moductus/contrato";
import { colunasDeOrigem, DO_USUARIO } from "../banco/tabela.ts";
import { novoId } from "../banco/ulid.ts";
import type { Credenciais } from "../casca/credenciais.ts";
import type { ConfigProvedor } from "./provedor.ts";
import type { RegistroProvedores } from "./registro.ts";

/**
 * Os provedores de modelo configurados (DATA.md §6 `provedores`; AGENTS.md §3): criar, mudar,
 * remover e testar de verdade. A chave vai direto ao Gerenciador de Credenciais; o banco guarda só
 * o nome dela, e nenhuma saída, log ou mensagem de erro leva a chave nem o endereço inteiro.
 */

interface LinhaProvedor {
  id: string;
  tipo: TipoProvedor;
  nome: string;
  modelo: string | null;
  base_url: string | null;
  credencial: string | null;
  testado_em: string | null;
}

const COLUNAS = "id, tipo, nome, modelo, base_url, credencial, testado_em";

/** O nome da chave do provedor no Gerenciador de Credenciais (fica "Moductus/provedor-<id>"). */
export const credencialDoProvedor = (id: string) => `provedor-${id}`;

/** Quanto o teste espera a resposta do modelo antes de dar o provedor como fora do ar. */
export const PRAZO_TESTE_MS = 60_000;

/** A chamada curta do teste: uma palavra de volta, para gastar o mínimo da assinatura ou da conta. */
export const INSTRUCOES_TESTE = "Teste de conexão do Moductus. Responda só com a palavra ok, sem mais nada.";
export const PERGUNTA_TESTE = "ok?";

/** Quanto do texto de um erro inesperado entra na falha que a tela mostra. */
const TAMANHO_DETALHE = 300;

const ehCli = (tipo: TipoProvedor) => (TIPOS_PROVEDOR_CLI as readonly string[]).includes(tipo);

/** Leitura e escrita de `provedores` (migração 003). O que está na lixeira não aparece. */
export class RepositorioProvedores {
  constructor(private readonly db: DatabaseSync) {}

  listar(): LinhaProvedor[] {
    return this.db
      .prepare(`SELECT ${COLUNAS} FROM provedores WHERE apagado_em IS NULL ORDER BY criado_em, id`)
      .all() as unknown as LinhaProvedor[];
  }

  obter(id: string): LinhaProvedor | null {
    const linha = this.db
      .prepare(`SELECT ${COLUNAS} FROM provedores WHERE id = ? AND apagado_em IS NULL`)
      .get(id) as unknown as LinhaProvedor | undefined;
    return linha ?? null;
  }

  inserir(linha: LinhaProvedor, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `INSERT INTO provedores (id, tipo, nome, modelo, base_url, credencial, testado_em,
           criado_em, atualizado_em, origem, agente_id, execucao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        linha.id,
        linha.tipo,
        linha.nome,
        linha.modelo,
        linha.base_url,
        linha.credencial,
        linha.testado_em,
        agora,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
      );
  }

  atualizar(linha: LinhaProvedor, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `UPDATE provedores SET nome = ?, modelo = ?, base_url = ?, credencial = ?, testado_em = ?,
           atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(
        linha.nome,
        linha.modelo,
        linha.base_url,
        linha.credencial,
        linha.testado_em,
        agora,
        origem.origem,
        origem.agente_id,
        origem.execucao_id,
        linha.id,
      );
  }

  /** O último teste que passou; não conta como mudança de quem configurou. */
  marcarTestado(id: string, quando: string): void {
    this.db
      .prepare("UPDATE provedores SET testado_em = ? WHERE id = ? AND apagado_em IS NULL")
      .run(quando, id);
  }

  /**
   * Manda o provedor para a lixeira e o tira dos agentes que o usavam, como principal ou reserva,
   * numa transação. Devolve os agentes que mudaram.
   */
  remover(id: string, agora: string): string[] {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db.exec("BEGIN");
    try {
      const agentes = this.agentesDo(id);
      this.db
        .prepare(
          `UPDATE provedores SET apagado_em = ?, credencial = NULL, atualizado_em = ?, origem = ?,
             agente_id = ?, execucao_id = ?
           WHERE id = ? AND apagado_em IS NULL`,
        )
        .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
      this.db
        .prepare(
          `UPDATE agentes SET
             provedor_id = CASE WHEN provedor_id = ? THEN NULL ELSE provedor_id END,
             provedor_reserva_id = CASE WHEN provedor_reserva_id = ? THEN NULL ELSE provedor_reserva_id END,
             atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
           WHERE (provedor_id = ? OR provedor_reserva_id = ?) AND apagado_em IS NULL`,
        )
        .run(id, id, agora, origem.origem, origem.agente_id, origem.execucao_id, id, id);
      this.db.exec("COMMIT");
      return agentes;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }

  /** Os agentes que usam o provedor, como principal ou reserva. */
  agentesDo(id: string): string[] {
    const linhas = this.db
      .prepare(
        `SELECT id FROM agentes WHERE (provedor_id = ? OR provedor_reserva_id = ?) AND apagado_em IS NULL
         ORDER BY id`,
      )
      .all(id, id) as unknown as { id: string }[];
    return linhas.map((l) => l.id);
  }

  /**
   * Dá o provedor como principal a quem está sem modelo: sem provedor nenhum ou com um que foi
   * para a lixeira (AGENTS.md §3: o primeiro uso conecta um modelo e o atribui aos quatro). Se ele
   * era a reserva do agente, passa a principal e a reserva fica vazia. Devolve quem recebeu.
   */
  atribuirAosSemModelo(id: string, agora: string): string[] {
    const origem = colunasDeOrigem(DO_USUARIO);
    const semModelo = `apagado_em IS NULL AND (provedor_id IS NULL OR provedor_id NOT IN
      (SELECT id FROM provedores WHERE apagado_em IS NULL))`;
    this.db.exec("BEGIN");
    try {
      const linhas = this.db
        .prepare(`SELECT id FROM agentes WHERE ${semModelo} ORDER BY id`)
        .all() as unknown as { id: string }[];
      this.db
        .prepare(
          `UPDATE agentes SET provedor_id = ?,
             provedor_reserva_id = CASE WHEN provedor_reserva_id = ? THEN NULL ELSE provedor_reserva_id END,
             atualizado_em = ?, origem = ?, agente_id = ?, execucao_id = ?
           WHERE ${semModelo}`,
        )
        .run(id, id, agora, origem.origem, origem.agente_id, origem.execucao_id);
      this.db.exec("COMMIT");
      return linhas.map((l) => l.id);
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

export interface DependenciasProvedores {
  /** O Gerenciador de Credenciais pela casca; a chave só passa pela memória. */
  credenciais: Pick<Credenciais, "guardar" | "apagar">;
  /** O mesmo registro do runtime: o teste chama o adaptador que os agentes vão usar. */
  registro: Pick<RegistroProvedores, "obter" | "esquecer">;
  /** Os CLIs no PC (`deteccao.ts`). */
  detectar: () => Promise<ProvedorDetectado[]>;
  agora?: () => Date;
  /** Relógio da latência, em ms; os testes trocam pelo falso. */
  cronometro?: () => number;
  prazoTesteMs?: number;
}

export interface AvisosProvedores {
  provedores: (lista: Provedor[]) => void;
  /** Agentes que trocaram de modelo: receberam o primeiro que funcionou, ou perderam o removido. */
  agentesMudaram: (ids: string[]) => void;
  /** O provedor passou no teste: quem dormia por causa dele pode tentar de novo já. */
  provedorVoltou: (agentes: string[]) => void;
}

/**
 * A regra dos provedores. O teste é a única coisa aqui que chama o modelo, e só quando o usuário
 * pede: uma chamada curta pelo mesmo adaptador dos agentes, com a latência medida. Passou, grava
 * `testado_em`, dá o provedor aos agentes que ainda não têm modelo e acorda quem dormia por ele.
 */
export class ServicoProvedores {
  private readonly agora: () => Date;
  private readonly cronometro: () => number;

  constructor(
    private readonly repositorio: RepositorioProvedores,
    private readonly deps: DependenciasProvedores,
    private readonly avisos: AvisosProvedores,
  ) {
    this.agora = deps.agora ?? (() => new Date());
    this.cronometro = deps.cronometro ?? (() => performance.now());
  }

  listar(): Provedor[] {
    return this.repositorio.listar().map(paraProvedor);
  }

  detectar(): Promise<ProvedorDetectado[]> {
    return this.deps.detectar();
  }

  async criar(novo: NovoProvedor): Promise<Provedor> {
    const baseUrl = novo.baseUrl ?? null;
    validar(novo.tipo, baseUrl, novo.chave);
    const id = novoId();
    let credencial: string | null = null;
    if (novo.chave !== undefined) {
      credencial = credencialDoProvedor(id);
      await this.deps.credenciais.guardar(credencial, novo.chave);
    }
    const linha: LinhaProvedor = {
      id,
      tipo: novo.tipo,
      nome: novo.nome,
      modelo: novo.modelo ?? null,
      base_url: baseUrl,
      credencial,
      testado_em: null,
    };
    this.repositorio.inserir(linha, this.agora().toISOString());
    this.mudou();
    return paraProvedor(linha);
  }

  /**
   * Mudança parcial. Trocar o endereço de um provedor que tem chave pede a chave de novo: ela não
   * vai para um servidor que o usuário não confirmou junto com ela. Endereço, modelo ou chave
   * novos apagam o último teste, que valia para a configuração de antes.
   */
  async definir(mudanca: MudancaProvedor): Promise<Provedor> {
    const atual = this.obter(mudanca.id);
    const baseUrl = mudanca.baseUrl === undefined ? atual.base_url : mudanca.baseUrl;
    const modelo = mudanca.modelo === undefined ? atual.modelo : mudanca.modelo;
    validar(atual.tipo, baseUrl, mudanca.chave ?? undefined);
    const trocouEndereco = baseUrl !== atual.base_url;
    if (trocouEndereco && atual.credencial !== null && mudanca.chave === undefined) {
      throw new Error(
        "Trocar o endereço pede a chave de novo: informe a chave junto, ou apague a que está guardada.",
      );
    }
    let credencial = atual.credencial;
    if (typeof mudanca.chave === "string") {
      credencial ??= credencialDoProvedor(atual.id);
      await this.deps.credenciais.guardar(credencial, mudanca.chave);
    } else if (mudanca.chave === null && credencial !== null) {
      await this.deps.credenciais.apagar(credencial);
      credencial = null;
    }
    const outraConfig = trocouEndereco || modelo !== atual.modelo || mudanca.chave !== undefined;
    const linha: LinhaProvedor = {
      ...atual,
      nome: mudanca.nome ?? atual.nome,
      modelo,
      base_url: baseUrl,
      credencial,
      testado_em: outraConfig ? null : atual.testado_em,
    };
    this.repositorio.atualizar(linha, this.agora().toISOString());
    this.deps.registro.esquecer(atual.id);
    this.mudou();
    return paraProvedor(linha);
  }

  /** Vai para a lixeira, a chave sai do Gerenciador e os agentes que o usavam ficam sem ele. */
  async remover(pedido: PedidoProvedor): Promise<Provedor[]> {
    const atual = this.obter(pedido.id);
    if (atual.credencial !== null) await this.deps.credenciais.apagar(atual.credencial);
    const agentes = this.repositorio.remover(atual.id, this.agora().toISOString());
    this.deps.registro.esquecer(atual.id);
    const lista = this.mudou();
    if (agentes.length > 0) this.avisos.agentesMudaram(agentes);
    return lista;
  }

  /**
   * Teste de verdade: CLI que não está no PC, velho demais ou sem login nem chega a ser chamado
   * (a detecção diz por quê, sem gastar nada); o resto faz a chamada curta e mede quanto o modelo
   * levou para responder inteiro. Falha do provedor volta tipada, como a dos agentes.
   */
  async testar(pedido: PedidoProvedor): Promise<ResultadoTesteProvedor> {
    const linha = this.obter(pedido.id);
    const impedimento = ehCli(linha.tipo) ? await this.impedimentoDoCli(linha) : null;
    const medido = impedimento ? { falha: impedimento } : await this.chamar(linha);
    const testadoEm = this.agora().toISOString();
    if ("falha" in medido) return { ok: false, provedorId: linha.id, falha: medido.falha, testadoEm };

    this.repositorio.marcarTestado(linha.id, testadoEm);
    const atribuidos = this.repositorio.atribuirAosSemModelo(linha.id, testadoEm);
    this.mudou();
    if (atribuidos.length > 0) this.avisos.agentesMudaram(atribuidos);
    this.avisos.provedorVoltou(this.repositorio.agentesDo(linha.id));
    return { ok: true, provedorId: linha.id, latenciaMs: medido.latenciaMs, testadoEm };
  }

  private obter(id: string): LinhaProvedor {
    const linha = this.repositorio.obter(id);
    if (!linha) throw new Error("provedor não encontrado");
    return linha;
  }

  private mudou(): Provedor[] {
    const lista = this.listar();
    this.avisos.provedores(lista);
    return lista;
  }

  private async impedimentoDoCli(linha: LinhaProvedor): Promise<FalhaProvedor | null> {
    const achado = (await this.deps.detectar()).find((d) => d.tipo === linha.tipo);
    if (!achado) {
      return falha("ausente", `${linha.nome} não está no PATH deste PC. Instale e teste de novo.`);
    }
    if (achado.versaoMinima) {
      const qual = achado.versao ? `${linha.nome} ${achado.versao}` : linha.nome;
      return falha(
        "ausente",
        `${qual} é mais velho do que o Moductus pede (${achado.versaoMinima} ou mais novo). Atualize e teste de novo.`,
      );
    }
    if (achado.logado === false) {
      return falha(
        "credencial",
        `${linha.nome} está sem login. Abra um terminal, entre com a sua conta e teste de novo.`,
      );
    }
    return null;
  }

  /** A chamada curta, pelo adaptador do registro, com prazo; o cancelamento por prazo é falha. */
  private async chamar(linha: LinhaProvedor): Promise<{ latenciaMs: number } | { falha: FalhaProvedor }> {
    const config: ConfigProvedor = {
      id: linha.id,
      tipo: linha.tipo,
      modelo: linha.modelo,
      baseUrl: linha.base_url,
      credencial: linha.credencial,
    };
    const prazoMs = this.deps.prazoTesteMs ?? PRAZO_TESTE_MS;
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(new Error("prazo do teste")), prazoMs);
    const inicio = this.cronometro();
    try {
      const eventos = this.deps.registro.obter(config).executar(
        {
          agenteId: "teste",
          execucaoId: novoId(),
          instrucoes: INSTRUCOES_TESTE,
          mensagens: [{ papel: "usuario", texto: PERGUNTA_TESTE }],
          ferramentas: [],
          executarFerramenta: () => Promise.resolve({ ok: false, erro: "O teste não usa ferramentas." }),
          continuarDe: null,
          // Fila própria: o teste não espera nem segura a fila de nenhum agente.
          fila: `teste-${linha.id}`,
        },
        controle.signal,
      );
      for await (const evento of eventos) {
        if (evento.tipo === "erro") return { falha: evento.falha };
        if (evento.tipo === "fim") return { latenciaMs: Math.max(0, Math.round(this.cronometro() - inicio)) };
      }
      return { falha: falha("fora_do_ar", `${linha.nome} parou sem responder.`) };
    } catch (erro) {
      if (controle.signal.aborted) {
        return {
          falha: falha("fora_do_ar", `${linha.nome} não respondeu em ${Math.ceil(prazoMs / 1000)} s.`),
        };
      }
      const detalhe = (erro instanceof Error ? erro.message : String(erro)).trim().slice(0, TAMANHO_DETALHE);
      return { falha: falha("fora_do_ar", detalhe || `${linha.nome} falhou sem dizer por quê.`) };
    } finally {
      clearTimeout(prazo);
    }
  }
}

/**
 * O que cada tipo aceita. CLI usa o login do próprio CLI; a OpenAI tem endereço fixo; o
 * compatível precisa do endereço. Endereço com usuário ou senha embutidos é recusado, e a
 * mensagem não repete o endereço, que carrega o segredo.
 */
function validar(tipo: TipoProvedor, baseUrl: string | null, chave: string | undefined): void {
  if (ehCli(tipo) && (baseUrl !== null || chave !== undefined)) {
    throw new Error("Provedor de CLI usa o login do próprio CLI: não leva endereço nem chave.");
  }
  if (tipo === "openai" && baseUrl !== null) {
    throw new Error(
      "A OpenAI tem endereço fixo. Para outro endereço, use um provedor compatível com OpenAI.",
    );
  }
  if (tipo === "openai-compativel" && baseUrl === null) {
    throw new Error("Falta o endereço (base_url) do provedor compatível com OpenAI.");
  }
  if (baseUrl !== null) {
    let endereco: URL;
    try {
      endereco = new URL(baseUrl);
    } catch {
      throw new Error("O endereço (base_url) não é válido.");
    }
    if (endereco.username || endereco.password) {
      throw new Error(
        "O endereço (base_url) tem usuário ou senha embutidos. Tire-os do endereço e informe a chave no campo próprio.",
      );
    }
  }
}

function falha(motivo: FalhaProvedor["motivo"], mensagem: string): FalhaProvedor {
  return { motivo, mensagem, voltaEm: null };
}

/** O que sai pelo canal: se há chave, nunca qual nem com que nome. */
function paraProvedor(linha: LinhaProvedor): Provedor {
  return {
    id: linha.id,
    tipo: linha.tipo,
    nome: linha.nome,
    modelo: linha.modelo,
    baseUrl: linha.base_url,
    temChave: linha.credencial !== null,
    testadoEm: linha.testado_em,
  };
}
