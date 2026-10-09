import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createInterface } from "node:readline";
import type { ConfigProvedor, EventoAgente, PedidoDoAgente, Provedor } from "../provedor.ts";
import type { FabricaProvedor } from "../registro.ts";
import { LeitorStreamJson } from "./leitor.ts";

/**
 * Adaptador do Claude Code CLI (AGENTS.md §3): roda `claude -p` como subprocesso sem janela, com a
 * assinatura do usuário, e lê o `stream-json`. O CLI roda o próprio ciclo de agente; as
 * ferramentas do Moductus chegam a ele pelo MCP do Moductus, e o adaptador só relata as chamadas.
 * No máximo um processo por agente: execuções do mesmo agente esperam em fila, agentes diferentes
 * rodam em paralelo.
 */

const PREFIXO_MCP = "mcp__moductus__";

/** Quanto esperar o CLI sair sozinho depois do `result` (ele grava a sessão do `--resume`). */
const ESPERA_SAIDA_MS = 5000;

/** Quanto esperar o processo sair depois de encerrado, para não deixar a execução pendurada. */
const ESPERA_ENCERRAR_MS = 2000;

/**
 * A variável de ambiente que leva o token do MCP ao CLI, que a expande no cabeçalho. O nome evita
 * TOKEN, KEY, SECRET, PASSWORD e AUTH: a documentação do Claude Code lê como vazias as variáveis de
 * credencial conhecidas no cabeçalho de servidor remoto e tira do ambiente de helpers os nomes com
 * essas palavras, e um nome neutro fica longe das duas regras.
 */
export const VARIAVEL_ACESSO_MCP = "MODUCTUS_MCP_ACESSO";

/** O `--resume` apontou para uma sessão que o CLI não tem mais (apagada, outra máquina). */
const SESSAO_PERDIDA = /no conversation found/i;

class SessaoPerdida extends Error {}

export type IniciarProcesso = (
  argumentos: string[],
  opcoes: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface OpcoesClaudeCli {
  /** Executável do CLI; a detecção (F2-08) passa o caminho achado. */
  comando?: string;
  /**
   * Pasta de trabalho do CLI, própria do Moductus e sempre a mesma. O CLI lê `CLAUDE.md` e
   * `.claude/` da pasta onde roda: numa pasta própria o agente não herda instruções nem
   * configuração de um projeto qualquer, e as sessões dos agentes ficam juntas num projeto só em
   * `~/.claude/projects`. (O `--resume` por ID acha a sessão em qualquer projeto desde a 2.1.223.)
   */
  pasta?: string;
  /**
   * Servidor MCP do Moductus (ADR-0014). Cada execução abre o próprio acesso e o fecha ao terminar.
   * O token vai no ambiente do processo, em `VARIAVEL_ACESSO_MCP`, nunca nos argumentos: a
   * configuração leva `${VARIAVEL}` e o CLI expande.
   */
  mcp?: AberturaMcp;
  /** Como iniciar o processo; os testes trocam o CLI por um roteiro gravado. */
  iniciar?: IniciarProcesso;
  agora?: () => Date;
}

/**
 * Quem dá a uma execução o acesso às ferramentas dela pelo MCP (`ServidorMcp` em `mcp/`): só as do
 * pedido, rodadas pelo `executarFerramenta` dele, com um token que vale até `fechar`.
 */
export interface AberturaMcp {
  abrir(execucao: Pick<PedidoDoAgente, "execucaoId" | "ferramentas" | "executarFerramenta">): {
    url: string;
    token: string;
    fechar(): void;
  };
}

/**
 * O nome com que o CLI vê uma ferramenta oferecida. O nome já vem no formato do modelo
 * (`sessoes__listar`), que é o que o servidor MCP publica; o resto só protege o que o MCP não aceita.
 */
export function nomeNoCli(nome: string): string {
  return PREFIXO_MCP + nome.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * O que vai pela entrada padrão. Continuando a sessão, o CLI já tem o histórico e recebe só o que
 * chegou depois da última fala do agente; numa sessão nova, o histórico curto vai junto.
 */
export function montarPrompt(pedido: PedidoDoAgente): string {
  const ultimaDoAgente = pedido.mensagens.findLastIndex((m) => m.papel === "agente");
  const novas = pedido.mensagens.slice(ultimaDoAgente + 1).map((m) => m.texto);
  const anteriores = pedido.mensagens.slice(0, ultimaDoAgente + 1);
  if (pedido.continuarDe || anteriores.length === 0) return novas.join("\n\n");
  const historico = anteriores.map((m) => `${m.papel === "agente" ? "Você" : "Usuário"}: ${m.texto}`);
  return `Conversa até aqui:\n${historico.join("\n")}\n\nMensagem nova:\n${novas.join("\n\n")}`;
}

/**
 * O ambiente do processo do CLI: o do serviço sem nenhuma variável `MODUCTUS_*` (token do canal
 * das janelas, pasta de dados...), porque hooks e plugins do usuário rodam dentro do CLI e as
 * herdariam. Só entra o acesso ao MCP desta execução, quando houver.
 */
export function ambienteDoCli(base: NodeJS.ProcessEnv, acessoMcp: string | null): NodeJS.ProcessEnv {
  const ambiente = Object.fromEntries(Object.entries(base).filter(([nome]) => !/^MODUCTUS_/i.test(nome)));
  if (acessoMcp !== null) ambiente[VARIAVEL_ACESSO_MCP] = acessoMcp;
  return ambiente;
}

/** `mcpUrl` é o endereço do acesso aberto para esta execução; sem ele, nenhuma ferramenta. */
export function argumentosDoClaude(
  pedido: PedidoDoAgente,
  config: ConfigProvedor,
  mcpUrl: string | null = null,
): string[] {
  const argumentos = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Nenhuma ferramenta nativa (Bash, Edit, Write...): o agente age só pelo catálogo (ADR-0017).
    "--tools",
    "",
    "--strict-mcp-config",
    // Sem isso o CLI reaproveita, no --resume, o prompt de sistema gravado na primeira chamada, e
    // instruções editadas do agente só valeriam depois de compactar a conversa (2.1.257+).
    "--system-prompt-snapshot",
    "off",
  ];
  if (pedido.instrucoes) argumentos.push("--append-system-prompt", pedido.instrucoes);
  if (config.modelo) argumentos.push("--model", config.modelo);
  if (pedido.continuarDe) argumentos.push("--resume", pedido.continuarDe);
  if (mcpUrl && pedido.ferramentas.length > 0) {
    const servidor = {
      type: "http",
      url: mcpUrl,
      headers: { Authorization: `Bearer \${${VARIAVEL_ACESSO_MCP}}` },
    };
    argumentos.push("--mcp-config", JSON.stringify({ mcpServers: { moductus: servidor } }));
    argumentos.push("--allowedTools", pedido.ferramentas.map((f) => nomeNoCli(f.nome)).join(","));
  }
  return argumentos;
}

export class ProvedorClaudeCli implements Provedor {
  readonly id: string;
  /** A cauda da fila de cada agente: resolve quando a última execução enfileirada termina. */
  private readonly filas = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigProvedor,
    private readonly opcoes: OpcoesClaudeCli = {},
  ) {
    this.id = config.id;
  }

  async *executar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente> {
    sinal.throwIfAborted();
    const liberar = await this.entrarNaFila(pedido.fila ?? pedido.agenteId, sinal);
    try {
      try {
        yield* this.rodar(pedido, sinal);
      } catch (erro) {
        if (!(erro instanceof SessaoPerdida)) throw erro;
        // A sessão a continuar sumiu: começa outra, com o histórico curto no prompt. O `fim`
        // traz a continuação nova, e o runtime passa a usar essa.
        yield* this.rodar({ ...pedido, continuarDe: null }, sinal);
      }
    } finally {
      liberar();
    }
  }

  /**
   * Entra no fim da fila do agente e espera a vez. Cancelar na espera só solta a própria vez: quem
   * chegou depois continua esperando quem estava antes. A entrada do mapa sai quando a fila
   * inteira esvazia.
   */
  private async entrarNaFila(agenteId: string, sinal: AbortSignal): Promise<() => void> {
    const anterior = this.filas.get(agenteId) ?? Promise.resolve();
    let soltar!: () => void;
    const minha = new Promise<void>((resolve) => (soltar = resolve));
    const cauda = anterior.then(() => minha);
    this.filas.set(agenteId, cauda);
    void cauda.then(() => {
      if (this.filas.get(agenteId) === cauda) this.filas.delete(agenteId);
    });
    try {
      await esperarOuCancelar(anterior, sinal);
    } catch (erro) {
      soltar();
      throw erro;
    }
    return soltar;
  }

  /** O acesso ao MCP vale enquanto o processo roda: o token morre junto com ele. */
  private async *rodar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente> {
    sinal.throwIfAborted();
    const acesso = this.opcoes.mcp && pedido.ferramentas.length > 0 ? this.opcoes.mcp.abrir(pedido) : null;
    try {
      yield* this.rodarProcesso(pedido, sinal, acesso);
    } finally {
      acesso?.fechar();
    }
  }

  private async *rodarProcesso(
    pedido: PedidoDoAgente,
    sinal: AbortSignal,
    acesso: { url: string; token: string } | null,
  ): AsyncIterable<EventoAgente> {
    const comando = this.opcoes.comando ?? "claude";
    const iniciar: IniciarProcesso = this.opcoes.iniciar ?? ((args, o) => spawn(comando, args, o));
    const processo = iniciar(argumentosDoClaude(pedido, this.config, acesso?.url ?? null), {
      cwd: this.opcoes.pasta,
      env: ambienteDoCli(process.env, acesso?.token ?? null),
      windowsHide: true,
    });
    const saida = new Promise<{ codigo: number | null; erro: Error | null }>((resolve) => {
      processo.once("error", (erro) => resolve({ codigo: null, erro }));
      processo.once("close", (codigo) => resolve({ codigo, erro: null }));
    });
    let erros = "";
    processo.stderr.setEncoding("utf8");
    processo.stderr.on("data", (pedaco: string) => (erros = (erros + pedaco).slice(-2000)));
    const aoAbortar = () => processo.kill();
    sinal.addEventListener("abort", aoAbortar, { once: true });
    // CLI que não sobe (ou sai antes de ler) fecha a entrada; o erro de verdade vem da saída.
    processo.stdin.on("error", () => {});
    processo.stdin.end(montarPrompt(pedido), "utf8");

    const leitor = new LeitorStreamJson({
      nomeDaFerramenta: (nome) => this.nomeNoCatalogo(nome, pedido),
      agora: this.opcoes.agora ?? (() => new Date()),
    });
    // Sessão perdida só é reconhecida antes de qualquer evento: depois disso, recomeçar repetiria a fala.
    let emitiu = false;
    const sessaoPerdida = (texto: string) =>
      pedido.continuarDe !== null && !emitiu && SESSAO_PERDIDA.test(texto);
    try {
      for await (const linha of createInterface({ input: processo.stdout, crlfDelay: Infinity })) {
        let eventos: EventoAgente[];
        try {
          eventos = leitor.ler(linha);
        } catch (erro) {
          if (sessaoPerdida(String((erro as Error).message))) throw new SessaoPerdida(String(erro));
          throw erro;
        }
        for (const evento of eventos) {
          emitiu = true;
          yield evento;
        }
        if (leitor.terminou) return;
      }
      sinal.throwIfAborted();
      const { codigo, erro } = await saida;
      if ((erro as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        yield {
          tipo: "erro",
          falha: {
            motivo: "ausente",
            mensagem: `O Claude Code não foi encontrado (${comando}). Instale o CLI ou escolha outro modelo para o agente.`,
            voltaEm: null,
          },
        };
        return;
      }
      if (erro) throw erro;
      if (sessaoPerdida(erros)) throw new SessaoPerdida(erros.trim());
      const detalhe = erros.trim() ? `: ${erros.trim()}` : "";
      throw new Error(`O Claude Code saiu sem resposta (código ${codigo})${detalhe}`);
    } finally {
      // O cancelamento vale até o processo sair, inclusive na espera depois do `result`.
      try {
        if (vivo(processo)) {
          if (leitor.terminou && !sinal.aborted) await Promise.race([saida, pausa(ESPERA_SAIDA_MS)]);
          if (vivo(processo)) {
            processo.kill();
            await Promise.race([saida, pausa(ESPERA_ENCERRAR_MS)]);
          }
        }
      } finally {
        sinal.removeEventListener("abort", aoAbortar);
      }
    }
  }

  /** Volta do nome do CLI ao do catálogo; ferramenta de fora do Moductus fica com o nome dela. */
  private nomeNoCatalogo(nome: string, pedido: PedidoDoAgente): string {
    const daLista = pedido.ferramentas.find((f) => nomeNoCli(f.nome) === nome);
    if (daLista) return daLista.nome;
    return nome.startsWith(PREFIXO_MCP) ? nome.slice(PREFIXO_MCP.length) : nome;
  }
}

/** Registro do tipo `claude-cli`: `registro.registrar("claude-cli", fabricaClaudeCli(opcoes))`. */
export function fabricaClaudeCli(opcoes: OpcoesClaudeCli = {}): FabricaProvedor {
  return (config) => new ProvedorClaudeCli(config, opcoes);
}

function esperarOuCancelar(promessa: Promise<void>, sinal: AbortSignal): Promise<void> {
  sinal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aoAbortar = () => reject(sinal.reason);
    sinal.addEventListener("abort", aoAbortar, { once: true });
    void promessa.then(() => {
      sinal.removeEventListener("abort", aoAbortar);
      resolve();
    });
  });
}

function vivo(processo: ChildProcessWithoutNullStreams): boolean {
  return processo.exitCode === null && processo.signalCode === null;
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
