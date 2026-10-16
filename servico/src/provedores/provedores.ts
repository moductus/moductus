import type { DatabaseSync } from "node:sqlite";
import {
  MotivoFalhaProvedor,
  TIPOS_PROVEDOR_CLI,
  type FalhaProvedor,
  type MudancaProvedor,
  type NovoProvedor,
  type PedidoProvedor,
  type PedidoTesteProvedor,
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

/** Quanto o teste de um CLI espera a detecção (versão e login) antes de desistir. */
export const PRAZO_DETECCAO_MS = 20_000;

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

  /**
   * Manda o provedor para a lixeira e o tira dos agentes que o usavam, como principal ou reserva,
   * numa transação. Devolve os agentes que mudaram.
   */
  remover(id: string, agora: string): string[] {
    return this.emTransacao(() => {
      const agentes = this.agentesDo(id);
      this.trocarNosAgentes(id, null, agora);
      this.paraALixeira(id, agora);
      return agentes;
    });
  }

  /**
   * Depois de um teste que passou, numa transação só: grava `testado_em`, o provedor toma o lugar
   * dos que ele substitui (os agentes deles passam a usá-lo, e eles vão para a lixeira) e vira o
   * principal de quem está sem modelo. Nada acontece se, enquanto o teste rodava, o provedor saiu
   * ou mudou de configuração: o teste valia para a de antes. Substituído que já não existe é
   * ignorado. Devolve os agentes que mudaram, os substituídos e as credenciais deles, para apagar.
   */
  depoisDePassar(
    testado: LinhaProvedor,
    substitui: readonly string[],
    quando: string,
  ): { agentes: string[]; credenciais: string[]; substituidos: string[] } | null {
    return this.emTransacao(() => {
      const atual = this.obter(testado.id);
      if (!atual || !mesmaConfig(atual, testado)) return null;
      this.db.prepare("UPDATE provedores SET testado_em = ? WHERE id = ?").run(quando, testado.id);
      const agentes = new Set<string>();
      const credenciais: string[] = [];
      const substituidos: string[] = [];
      for (const velho of new Set(substitui)) {
        const linha = velho === testado.id ? null : this.obter(velho);
        if (!linha) continue;
        for (const agente of this.agentesDo(velho)) agentes.add(agente);
        this.trocarNosAgentes(velho, testado.id, quando);
        this.paraALixeira(velho, quando);
        substituidos.push(velho);
        if (linha.credencial) credenciais.push(linha.credencial);
      }
      for (const agente of this.atribuirAosSemModelo(testado.id, quando)) agentes.add(agente);
      return { agentes: [...agentes].sort(), credenciais, substituidos };
    });
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
   * Os que usam o provedor e dormem por causa de um provedor (limite, queda, credencial, CLI
   * ausente). Quem dorme pelo teto de gasto continua dormindo: o provedor voltar não muda o teto.
   */
  dormindoPeloProvedor(id: string): string[] {
    const motivos = MotivoFalhaProvedor.options.map((m) => `'${m}'`).join(", ");
    const linhas = this.db
      .prepare(
        `SELECT id FROM agentes WHERE (provedor_id = ? OR provedor_reserva_id = ?) AND apagado_em IS NULL
           AND estado = 'dormindo' AND motivo_sono IN (${motivos})
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
  private atribuirAosSemModelo(id: string, agora: string): string[] {
    const origem = colunasDeOrigem(DO_USUARIO);
    const semModelo = `apagado_em IS NULL AND (provedor_id IS NULL OR provedor_id NOT IN
      (SELECT id FROM provedores WHERE apagado_em IS NULL))`;
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
    return linhas.map((l) => l.id);
  }

  /**
   * Nos agentes, troca `velho` por `novo` (ou por nada), como principal e como reserva. Se a troca
   * deixaria principal e reserva iguais, a reserva fica vazia.
   */
  private trocarNosAgentes(velho: string, novo: string | null, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    const principal = "CASE WHEN provedor_id = :velho THEN :novo ELSE provedor_id END";
    const reserva = "CASE WHEN provedor_reserva_id = :velho THEN :novo ELSE provedor_reserva_id END";
    this.db
      .prepare(
        `UPDATE agentes SET
           provedor_id = ${principal},
           provedor_reserva_id = CASE WHEN ${reserva} = ${principal} THEN NULL ELSE ${reserva} END,
           atualizado_em = :agora, origem = :origem, agente_id = :agente, execucao_id = :execucao
         WHERE (provedor_id = :velho OR provedor_reserva_id = :velho) AND apagado_em IS NULL`,
      )
      .run({
        velho,
        novo,
        agora,
        origem: origem.origem,
        agente: origem.agente_id,
        execucao: origem.execucao_id,
      });
  }

  private paraALixeira(id: string, agora: string): void {
    const origem = colunasDeOrigem(DO_USUARIO);
    this.db
      .prepare(
        `UPDATE provedores SET apagado_em = ?, credencial = NULL, atualizado_em = ?, origem = ?,
           agente_id = ?, execucao_id = ?
         WHERE id = ? AND apagado_em IS NULL`,
      )
      .run(agora, agora, origem.origem, origem.agente_id, origem.execucao_id, id);
  }

  private emTransacao<T>(fazer: () => T): T {
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

/** O que o adaptador usa: com isso igual, o teste feito vale para a linha de agora. */
function mesmaConfig(a: LinhaProvedor, b: LinhaProvedor): boolean {
  return (
    a.tipo === b.tipo && a.modelo === b.modelo && a.base_url === b.base_url && a.credencial === b.credencial
  );
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
  prazoDeteccaoMs?: number;
}

export interface AvisosProvedores {
  provedores: (lista: Provedor[]) => void;
  /** Agentes que trocaram de modelo: receberam o primeiro que funcionou, ou perderam o removido. */
  agentesMudaram: (ids: string[]) => void;
  /**
   * O provedor passou no teste: quem dormia por causa dele pode tentar de novo já. Quem dorme pelo
   * teto de gasto não vem aqui.
   */
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
   * Teste de verdade: CLI que não está no PC, velho demais, sem login ou que o Moductus não usa
   * nem chega a ser chamado (a detecção diz por quê, sem gastar nada); o resto faz a chamada curta
   * e mede quanto o modelo levou para responder inteiro. Falha do provedor volta tipada, como a dos
   * agentes, e não muda nada. Passou: o provedor toma o lugar dos que `substitui` (é assim que o
   * time fica com um modelo só quando o primeiro uso troca de escolha) e vai aos agentes sem modelo.
   */
  async testar(pedido: PedidoTesteProvedor): Promise<ResultadoTesteProvedor> {
    const linha = this.obter(pedido.id);
    const impedimento = ehCli(linha.tipo) ? await this.impedimentoDoCli(linha) : null;
    const medido = impedimento ? { falha: impedimento } : await this.chamar(linha);
    const testadoEm = this.agora().toISOString();
    if ("falha" in medido) return { ok: false, provedorId: linha.id, falha: medido.falha, testadoEm };

    const efeito = this.repositorio.depoisDePassar(linha, pedido.substitui ?? [], testadoEm);
    if (efeito) {
      for (const id of efeito.substituidos) this.deps.registro.esquecer(id);
      // A linha já saiu; a chave que sobrar no Gerenciador não é usada por ninguém.
      for (const credencial of efeito.credenciais) {
        await this.deps.credenciais
          .apagar(credencial)
          .catch((erro: unknown) =>
            console.error(`provedores: chave de um provedor substituído não apagada: ${String(erro)}`),
          );
      }
      this.mudou();
      if (efeito.agentes.length > 0) this.avisos.agentesMudaram(efeito.agentes);
      const dormindo = this.repositorio.dormindoPeloProvedor(linha.id);
      if (dormindo.length > 0) this.avisos.provedorVoltou(dormindo);
    }
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

  /** A detecção tem prazo próprio: um CLI travado não segura o teste nem a tela. */
  private async impedimentoDoCli(linha: LinhaProvedor): Promise<FalhaProvedor | null> {
    const prazoMs = this.deps.prazoDeteccaoMs ?? PRAZO_DETECCAO_MS;
    let prazo: ReturnType<typeof setTimeout> | undefined;
    const estourou = new Promise<"prazo">((resolve) => {
      prazo = setTimeout(() => resolve("prazo"), prazoMs);
    });
    const detectados = await Promise.race([this.deps.detectar(), estourou]).finally(() =>
      clearTimeout(prazo),
    );
    if (detectados === "prazo") {
      return falha(
        "fora_do_ar",
        `${linha.nome} não respondeu à versão nem ao login em ${Math.ceil(prazoMs / 1000)} s.`,
      );
    }
    const achado = detectados.find((d) => d.tipo === linha.tipo);
    if (!achado) {
      return falha("ausente", `${linha.nome} não está no PATH deste PC. Instale e teste de novo.`);
    }
    if (achado.impedimento === "instalado_pelo_npm") {
      return falha(
        "ausente",
        `${linha.nome} foi instalado pelo npm, e o Moductus usa o do instalador nativo. Instale por ele e teste de novo.`,
      );
    }
    if (achado.impedimento === "sem_adaptador") {
      return falha("ausente", `Esta versão do Moductus ainda não conecta ao ${linha.nome}.`);
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
