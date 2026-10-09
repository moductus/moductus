import type { FerramentaOferecida } from "../provedor.ts";

/**
 * O `PreToolUse` dos agentes do Moductus no Claude Code (AGENTS.md §5.1, ADR-0017). No `claude -p`
 * o `PermissionRequest` não serve de porta, e o `PreToolUse` é o ponto em que o serviço vê cada
 * chamada antes de ela rodar. O hook é `http` e vai ao mesmo servidor do MCP, com o acesso da
 * execução: o serviço sabe de qual execução é a chamada e quais ferramentas ela tem.
 *
 * - Ferramenta do catálogo desta execução: o hook decide sozinho e deixa passar. `leitura` e
 *   `interno` rodam direto; `externo` segue para a chamada pelo MCP, onde o executor da execução
 *   segura a resposta até o cartão de aprovação ser decidido (o único lugar com a entrada já
 *   validada e o texto do cartão). Assim há um cartão por chamada, nunca dois.
 * - Qualquer outra ferramenta (Bash, Edit, Write, a de um plugin, a do catálogo que o agente não
 *   tem): negada, com o motivo que o modelo lê.
 */

/** A rota do hook no servidor do MCP; o `--settings` de cada execução aponta para ela. */
export const ROTA_PRE_TOOL_USE = "/hooks/pre-tool-use";

/**
 * Quanto o CLI espera o hook, em segundos. A decisão é imediata (não espera cartão), então um
 * prazo curto só cobre um serviço engasgado. No prazo estourado o CLI segue o fluxo normal de
 * permissão, que continua fechado pelo `--tools ""` e pelo `--allowedTools`.
 */
export const PRAZO_PRE_TOOL_USE_S = 30;

export type DecisaoPreToolUse = "allow" | "deny";

/** A resposta que o Claude Code lê do hook (`hookSpecificOutput`). */
export interface RespostaPreToolUse {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: DecisaoPreToolUse;
    permissionDecisionReason: string;
  };
}

/** O prefixo dos nomes que o CLI dá às ferramentas do MCP do Moductus. */
export const PREFIXO_MCP = "mcp__moductus__";

/**
 * O nome com que o CLI vê uma ferramenta oferecida. O nome já vem no formato do modelo
 * (`sessoes__listar`), que é o que o servidor MCP publica; o resto só protege o que o MCP não aceita.
 */
export function nomeNoCli(nome: string): string {
  return PREFIXO_MCP + nome.replace(/[^A-Za-z0-9_-]/g, "_");
}

function responder(decisao: DecisaoPreToolUse, motivo: string): RespostaPreToolUse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decisao,
      permissionDecisionReason: motivo,
    },
  };
}

/** O nome da ferramenta só entra no motivo limpo e curto: ele vai ao modelo e ao log do CLI. */
function nomeLegivel(nome: string): string {
  const limpo = nome.replace(/[^\w.:-]/g, "").slice(0, 80);
  return limpo || "sem nome";
}

/**
 * Decide uma chamada pelo corpo que o Claude Code mandou ao hook. Corpo que não é um `PreToolUse`
 * legível é negado: na dúvida, nada roda.
 */
export function decidirPreToolUse(
  corpo: unknown,
  ferramentas: readonly FerramentaOferecida[],
): RespostaPreToolUse {
  const evento = typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>) : {};
  const nome = evento.tool_name;
  if (evento.hook_event_name !== "PreToolUse" || typeof nome !== "string") {
    return responder("deny", "O Moductus não entendeu o pedido do hook. Nada foi feito.");
  }
  if (ferramentas.some((f) => nomeNoCli(f.nome) === nome)) {
    return responder("allow", "Ferramenta do catálogo do Moductus para este agente.");
  }
  return responder(
    "deny",
    `"${nomeLegivel(nome)}" não é uma ferramenta deste agente. Os agentes do Moductus agem só pelas ferramentas do catálogo (mcp__moductus__*); comandos, arquivos e outras ferramentas do Claude Code ficam fora. Nada foi feito.`,
  );
}

/**
 * O `--settings` de uma execução: só o hook `PreToolUse` do Moductus, para toda ferramenta. O
 * token vai pelo ambiente (`variavel`), que o CLI expande no cabeçalho; nunca literal.
 */
export function configuracaoDoHook(url: string, variavel: string): string {
  const hook = {
    type: "http",
    url,
    timeout: PRAZO_PRE_TOOL_USE_S,
    headers: { Authorization: `Bearer \${${variavel}}` },
    allowedEnvVars: [variavel],
  };
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [hook] }] } });
}
