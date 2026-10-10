import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MudancaArquivo } from "@moductus/contrato";
import { VARIAVEL_TOKEN, type SituacaoLigacao } from "./ligacao.ts";
import { ROTAS_HOOKS } from "./receptor.ts";

/**
 * Ligação do OpenCode ao receptor dos hooks (AGENTS.md §5, ADR-0010): um plugin de um arquivo só em
 * `~/.config/opencode/plugins/`, que o OpenCode carrega sozinho ao abrir. O plugin traduz os
 * eventos do OpenCode para o formato dos hooks do Claude Code e posta na rota `/hooks/opencode`
 * com o token de `MODUCTUS_HOOKS_TOKEN` no cabeçalho; o serviço não precisa saber nada do OpenCode.
 * O OpenCode não oferece um bloco de configuração para o Moductus dividir com o usuário, então a
 * ligação é o arquivo inteiro: o Moductus só cria, troca e apaga o que traz a marca dele.
 */

/** Primeira linha do plugin: é por ela que o Moductus reconhece o arquivo como seu. */
export const MARCA_PLUGIN =
  "// Moductus: ligação do OpenCode. Gerado pelo Moductus; ligar de novo reescreve.";

export const NOME_DO_PLUGIN = "moductus.js";

const ROTA = Object.keys(ROTAS_HOOKS).find((rota) => ROTAS_HOOKS[rota] === "opencode") ?? "/hooks/opencode";

/** Quanto o plugin espera o receptor: o evento só informa, e um Moductus travado não segura o OpenCode. */
export const ESPERA_PLUGIN_MS = 3000;

/**
 * O plugin, com a porta escrita nele. Regras do que está dentro:
 * - Todo `export` de um plugin do OpenCode é chamado como plugin, então só `Moductus` é exportado.
 * - Nada aqui lança nem espera: sem token, sem Moductus aberto ou com o receptor lento, o OpenCode
 *   segue como se o plugin não existisse.
 * - Da ferramenta em uso vão só comando, caminho, padrão, URL e descrição; o conteúdo de `write`,
 *   `edit` e a saída das ferramentas nunca saem do OpenCode.
 * - Sessão filha (subagente) não vira sessão do Moductus: o trabalho dela aparece na sessão pai.
 */
export function codigoDoPlugin(porta: number): string {
  return `${MARCA_PLUGIN}
const URL_DO_MODUCTUS = "http://127.0.0.1:${porta}${ROTA}";
const ESPERA_MS = ${ESPERA_PLUGIN_MS};
const CAMPOS = ["command", "pattern", "url", "query", "description"];

export const Moductus = async ({ directory }) => {
  const token = process.env.${VARIAVEL_TOKEN};
  if (!token) return {};
  const filhas = new Set();
  const andamento = new Map();

  const enviar = (corpo) => {
    try {
      fetch(URL_DO_MODUCTUS, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ cwd: directory, ...corpo }),
        signal: AbortSignal.timeout(ESPERA_MS),
      }).catch(() => {});
    } catch {}
  };

  const entradaDe = (entrada) => {
    const saida = {};
    if (!entrada || typeof entrada !== "object") return saida;
    for (const campo of CAMPOS) if (typeof entrada[campo] === "string") saida[campo] = entrada[campo];
    if (typeof entrada.filePath === "string") saida.file_path = entrada.filePath;
    return saida;
  };

  const traduzir = (evento) => {
    const p = evento.properties ?? {};
    const info = p.info ?? {};
    switch (evento.type) {
      case "session.created":
        if (info.parentID) {
          filhas.add(info.id);
          return null;
        }
        return { hook_event_name: "SessionStart", session_id: info.id, cwd: info.directory ?? directory, source: "startup" };
      case "session.status":
        return p.status?.type === "busy" ? { hook_event_name: "UserPromptSubmit", session_id: p.sessionID } : null;
      case "session.idle":
        return { hook_event_name: "Stop", session_id: p.sessionID };
      case "session.deleted":
        return { hook_event_name: "SessionEnd", session_id: info.id };
      case "permission.asked":
        return { hook_event_name: "Notification", notification_type: "permission_prompt", session_id: p.sessionID, message: typeof p.permission === "string" ? p.permission : "permissão" };
      case "message.part.updated": {
        const parte = p.part;
        if (!parte || parte.type !== "tool" || !parte.state) return null;
        const status = parte.state.status;
        if (andamento.get(parte.callID) === status) return null;
        andamento.set(parte.callID, status);
        const base = { session_id: parte.sessionID, tool_name: parte.tool, tool_input: entradaDe(parte.state.input) };
        if (status === "running") return { hook_event_name: "PreToolUse", ...base };
        if (status === "completed") return { hook_event_name: "PostToolUse", ...base };
        if (status === "error") return { hook_event_name: "PostToolUseFailure", ...base };
        return null;
      }
      default:
        return null;
    }
  };

  return {
    event: async ({ event }) => {
      try {
        const corpo = traduzir(event);
        if (corpo && corpo.session_id && !filhas.has(corpo.session_id)) enviar(corpo);
      } catch {}
    },
  };
};
`;
}

/** A pasta de configuração do OpenCode: `XDG_CONFIG_HOME` quando definida, senão `~/.config`. */
export function caminhoPluginOpenCode(
  env: NodeJS.ProcessEnv = process.env,
  casa: string = homedir(),
): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return join(xdg ? xdg : join(casa, ".config"), "opencode", "plugins", NOME_DO_PLUGIN);
}

/** Já existe um arquivo com esse nome que não é do Moductus; ele não é tocado. */
export class PluginDeOutro extends Error {}

export interface OpcoesLigacaoOpenCode {
  /** O arquivo do plugin (`caminhoPluginOpenCode()`; nos testes, uma pasta temporária). */
  caminho: string;
  /** Porta do receptor (`portaDosHooks()`). */
  porta: number;
}

/** Instala e desinstala o plugin do Moductus no OpenCode; ver o comentário do arquivo. */
export class LigacaoOpenCode {
  constructor(private readonly opcoes: OpcoesLigacaoOpenCode) {}

  get caminho(): string {
    return this.opcoes.caminho;
  }

  private ler(): string | null {
    return existsSync(this.caminho) ? readFileSync(this.caminho, "utf8") : null;
  }

  private eDoMoductus(texto: string): boolean {
    return texto.replace(/^\uFEFF/, "").startsWith(MARCA_PLUGIN);
  }

  situacao(): SituacaoLigacao {
    const texto = this.ler();
    if (texto === null || !this.eDoMoductus(texto)) return "desligada";
    return texto === codigoDoPlugin(this.opcoes.porta) ? "ligada" : "desatualizada";
  }

  /** O que ligar muda, sem gravar nada: o arquivo inteiro, antes e depois. */
  previa(): MudancaArquivo {
    const antes = this.ler();
    if (antes !== null && !this.eDoMoductus(antes)) {
      throw new PluginDeOutro(
        `${this.caminho} já existe e não é do Moductus; renomeie ou apague antes de ligar`,
      );
    }
    return {
      caminho: this.caminho,
      trecho: "plugins/" + NOME_DO_PLUGIN,
      antes,
      depois: codigoDoPlugin(this.opcoes.porta),
    };
  }

  ligar(): { mudou: boolean } {
    const { antes, depois } = this.previa();
    if (antes === depois) return { mudou: false };
    mkdirSync(dirname(this.caminho), { recursive: true });
    const temporario = `${this.caminho}.moductus-tmp`;
    writeFileSync(temporario, depois, "utf8");
    renameSync(temporario, this.caminho);
    return { mudou: true };
  }

  /** Só apaga o arquivo que tem a marca do Moductus. */
  desligar(): { mudou: boolean } {
    const texto = this.ler();
    if (texto === null || !this.eDoMoductus(texto)) return { mudou: false };
    rmSync(this.caminho);
    return { mudou: true };
  }
}
