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

export type IniciarProcesso = (
  argumentos: string[],
  opcoes: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface OpcoesClaudeCli {
  /** Executável do CLI; a detecção (F2-08) passa o caminho achado. */
  comando?: string;
  /** Pasta de trabalho do CLI. O `--resume` só acha a sessão na mesma pasta, então ela é fixa. */
  pasta?: string;
  /**
   * Servidor MCP do Moductus (ADR-0014). O token vai por variável de ambiente, nunca literal:
   * a configuração leva `${variavelToken}` e o CLI expande.
   */
  mcp?: { url: string; variavelToken: string };
  /** Variáveis somadas ao ambiente do serviço (ex.: o token do MCP). */
  ambiente?: Record<string, string>;
  /** Como iniciar o processo; os testes trocam o CLI por um roteiro gravado. */
  iniciar?: IniciarProcesso;
  agora?: () => Date;
}

/** O nome com que o CLI vê uma ferramenta do catálogo: MCP aceita só letras, números, `_` e `-`. */
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

export function argumentosDoClaude(
  pedido: PedidoDoAgente,
  config: ConfigProvedor,
  opcoes: OpcoesClaudeCli = {},
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
  ];
  if (pedido.instrucoes) argumentos.push("--append-system-prompt", pedido.instrucoes);
  if (config.modelo) argumentos.push("--model", config.modelo);
  if (pedido.continuarDe) argumentos.push("--resume", pedido.continuarDe);
  if (opcoes.mcp && pedido.ferramentas.length > 0) {
    const servidor = {
      type: "http",
      url: opcoes.mcp.url,
      headers: { Authorization: `Bearer \${${opcoes.mcp.variavelToken}}` },
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
    const liberar = await this.entrarNaFila(pedido.agenteId, sinal);
    try {
      yield* this.rodar(pedido, sinal);
    } finally {
      liberar();
    }
  }

  private async entrarNaFila(agenteId: string, sinal: AbortSignal): Promise<() => void> {
    const anterior = this.filas.get(agenteId) ?? Promise.resolve();
    let soltar!: () => void;
    const minha = new Promise<void>((resolve) => (soltar = resolve));
    const cauda = anterior.then(() => minha);
    this.filas.set(agenteId, cauda);
    const liberar = () => {
      soltar();
      if (this.filas.get(agenteId) === cauda) this.filas.delete(agenteId);
    };
    try {
      await esperarOuCancelar(anterior, sinal);
    } catch (erro) {
      liberar();
      throw erro;
    }
    return liberar;
  }

  private async *rodar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente> {
    sinal.throwIfAborted();
    const comando = this.opcoes.comando ?? "claude";
    const iniciar: IniciarProcesso = this.opcoes.iniciar ?? ((args, o) => spawn(comando, args, o));
    const processo = iniciar(argumentosDoClaude(pedido, this.config, this.opcoes), {
      cwd: this.opcoes.pasta,
      env: { ...process.env, ...this.opcoes.ambiente },
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
    try {
      for await (const linha of createInterface({ input: processo.stdout, crlfDelay: Infinity })) {
        yield* leitor.ler(linha);
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
      const detalhe = erros.trim() ? `: ${erros.trim()}` : "";
      throw new Error(`O Claude Code saiu sem resposta (código ${codigo})${detalhe}`);
    } finally {
      sinal.removeEventListener("abort", aoAbortar);
      if (processo.exitCode === null && processo.signalCode === null) {
        if (leitor.terminou && !sinal.aborted) await Promise.race([saida, pausa(ESPERA_SAIDA_MS)]);
        if (processo.exitCode === null && processo.signalCode === null) processo.kill();
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

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
