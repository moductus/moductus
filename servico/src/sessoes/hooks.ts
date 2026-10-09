import type { EstadoSessao } from "@moductus/contrato";

/**
 * O que o Moductus lê de um hook do Claude Code (AGENTS.md §5). O corpo chega em JSON com os
 * campos comuns (`hook_event_name`, `session_id`, `cwd`, `transcript_path`) e os do evento. A
 * leitura é tolerante: campo novo é ignorado e campo ausente vira `null`, porque o formato muda
 * entre versões; só o nome do evento e a sessão são obrigatórios.
 */
export interface EventoHook {
  /** Nome do hook: `SessionStart`, `PreToolUse`, `Stop`… */
  tipo: string;
  idSessao: string;
  cwd: string | null;
  transcript: string | null;
  modelo: string | null;
  /** `tool_name` dos eventos de ferramenta. */
  ferramenta: string | null;
  /** Comando, arquivo ou mensagem em uma linha curta; o conteúdo inteiro fica no transcript. */
  resumo: string | null;
  /**
   * `tool_input` inteiro, só para decidir um `PermissionRequest` (a regra compara o comando ou o
   * caminho exato); não é gravado em `eventos_sessao`.
   */
  entrada: unknown;
  /** `notification_type` do `Notification` (`idle_prompt`, `permission_prompt`…). */
  aviso: string | null;
  /** `source` do `SessionStart` (`startup`, `resume`, `clear`, `compact`). */
  origem: string | null;
}

/** Tamanho do resumo guardado em `eventos_sessao`: o bastante para "Quer rodar npm test". */
export const RESUMO_MAXIMO = 200;

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

function encurtar(valor: string): string {
  const linha = valor.replace(/\s+/g, " ").trim();
  return linha.length > RESUMO_MAXIMO ? `${linha.slice(0, RESUMO_MAXIMO - 1)}…` : linha;
}

/**
 * O que a ferramenta está fazendo, em uma linha: o comando do Bash, o arquivo do Edit e do Read,
 * o padrão da busca, a URL. O pedido do usuário (`UserPromptSubmit`) não é guardado: é conversa
 * dele e continua só no transcript.
 */
function resumir(corpo: Record<string, unknown>): string | null {
  const entrada = corpo.tool_input;
  if (entrada && typeof entrada === "object") {
    const campos = entrada as Record<string, unknown>;
    for (const chave of ["command", "file_path", "notebook_path", "pattern", "url", "query", "description"]) {
      const valor = texto(campos[chave]);
      if (valor) return encurtar(valor);
    }
    return null;
  }
  const mensagem = texto(corpo.message);
  return mensagem ? encurtar(mensagem) : null;
}

/** Lê o corpo de um hook; `null` quando falta o nome do evento ou a sessão. */
export function lerEventoHook(corpo: unknown): EventoHook | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  const tipo = texto(c.hook_event_name);
  const idSessao = texto(c.session_id);
  if (!tipo || !idSessao) return null;
  // O `model` do SessionStart vem como texto ou, em versões novas, como objeto com `id`.
  const modelo =
    texto(c.model) ??
    (c.model && typeof c.model === "object" ? texto((c.model as { id?: unknown }).id) : null);
  return {
    tipo,
    idSessao,
    cwd: texto(c.cwd),
    transcript: texto(c.transcript_path),
    modelo,
    ferramenta: texto(c.tool_name),
    resumo: tipo === "UserPromptSubmit" ? null : resumir(c),
    entrada: c.tool_input ?? null,
    aviso: texto(c.notification_type),
    origem: texto(c.source),
  };
}

/** Avisos do `Notification` que não pedem nada do usuário. */
const AVISOS_SEM_PEDIDO = new Set(["auth_success"]);

/**
 * Estado da sessão depois do evento (AGENTS.md §5 "Estados mostrados"). `esperando` é "esperando
 * você": pedido de permissão, pergunta, ou o próprio Claude Code avisando que espera o próximo
 * pedido (`idle_prompt`, 60 s depois do fim do turno). Sessão recém-aberta também espera o
 * primeiro pedido. `parada` não vem de evento: é a falta deles (`ServicoSessoes.marcarParadas`).
 * Evento desconhecido não muda o estado, a não ser o de uma sessão parada, que voltou a falar.
 */
export function estadoDepois(evento: EventoHook, atual: EstadoSessao | null): EstadoSessao {
  const vivo = (): EstadoSessao => (atual && atual !== "parada" ? atual : "trabalhando");
  switch (evento.tipo) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PreCompact":
    case "SubagentStop":
      return "trabalhando";
    case "PermissionRequest":
      return "esperando";
    case "Notification":
      return evento.aviso && AVISOS_SEM_PEDIDO.has(evento.aviso) ? vivo() : "esperando";
    case "Stop":
    case "SessionEnd":
      return "terminou";
    case "SessionStart":
      // A compactação automática abre a sessão de novo no meio do trabalho.
      return evento.origem === "compact" ? vivo() : "esperando";
    default:
      return vivo();
  }
}
