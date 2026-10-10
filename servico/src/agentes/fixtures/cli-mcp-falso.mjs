// Faz o papel do `claude -p` que chama uma ferramenta do Moductus pelo MCP: lê a entrada padrão,
// acha o servidor no `--mcp-config`, expande o token do ambiente como o CLI faz, pergunta antes ao
// hook `PreToolUse` do `--settings` (como o CLI faz), chama a ferramenta se o hook deixar e devolve
// um `result` de stream-json. Só fala com o 127.0.0.1 do teste; nenhum modelo.
//
// Uso: node cli-mcp-falso.mjs <entrada.json> [ferramenta] [cair-quando] -- <argumentos do claude...>
//   ferramenta: o nome como o CLI o vê (`Bash`, `mcp__moductus__x__y`); vazia ou ausente, a
//   primeira do `--allowedTools`.
//   cair-quando: um arquivo; com a chamada ao MCP em andamento, o falso sai com erro assim que ele
//   existir, sem esperar a resposta (o CLI que cai ou desiste no meio da chamada).
import { existsSync } from "node:fs";

const separador = process.argv.indexOf("--");
if (separador < 0) throw new Error("uso: cli-mcp-falso.mjs <entrada> [ferramenta] -- <argumentos>");
const [entradaJson, ferramentaPedida, cairQuando] = process.argv.slice(2, separador);
const argumentos = process.argv.slice(separador + 1);
const valorDe = (flag) => argumentos[argumentos.indexOf(flag) + 1];

/** Expande `${VAR}` como o CLI: só as variáveis permitidas; as outras viram vazio. */
const expandir = (texto, permitidas) =>
  texto.replace(/\$\{(\w+)\}/g, (_, nome) =>
    !permitidas || permitidas.includes(nome) ? (process.env[nome] ?? "") : "",
  );

/** O agente "fala" o que recebeu, como o modelo faria, e a execução termina. */
function responder(texto) {
  const fala = { type: "assistant", message: { id: "msg-falso", content: [{ type: "text", text: texto }] } };
  process.stdout.write(JSON.stringify(fala) + "\n");
  const resultado = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: texto,
    session_id: "sessao-mcp",
    usage: { input_tokens: 3, output_tokens: 1 },
  };
  process.stdout.write(JSON.stringify(resultado) + "\n");
}

process.stdin.resume();
process.stdin.on("end", async () => {
  const servidor = JSON.parse(valorDe("--mcp-config")).mcpServers.moductus;
  const nomeNoCli = ferramentaPedida || valorDe("--allowedTools").split(",")[0];
  const entrada = JSON.parse(entradaJson);

  // O PreToolUse do --settings, quando houver: o CLI pergunta antes de cada ferramenta.
  const settings = argumentos.includes("--settings") ? JSON.parse(valorDe("--settings")) : {};
  for (const grupo of settings.hooks?.PreToolUse ?? []) {
    for (const hook of grupo.hooks) {
      const cabecalhos = Object.fromEntries(
        Object.entries(hook.headers ?? {}).map(([nome, valor]) => [
          nome,
          expandir(valor, hook.allowedEnvVars ?? []),
        ]),
      );
      const resposta = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...cabecalhos },
        body: JSON.stringify({
          session_id: "sessao-mcp",
          hook_event_name: "PreToolUse",
          tool_name: nomeNoCli,
          tool_input: entrada,
        }),
      });
      // Erro HTTP é erro não bloqueante para o CLI: a chamada segue.
      if (!resposta.ok) continue;
      const saida = (await resposta.json()).hookSpecificOutput ?? {};
      if (saida.permissionDecision === "deny") return responder(`negado: ${saida.permissionDecisionReason}`);
    }
  }

  // Ferramenta que não é do MCP do Moductus: o CLI de verdade a rodaria por conta própria.
  if (!nomeNoCli.startsWith("mcp__moductus__")) return responder(`rodou ${nomeNoCli} fora do Moductus`);
  if (cairQuando) {
    setInterval(() => {
      if (existsSync(cairQuando)) process.exit(1);
    }, 20);
  }
  const resposta = await fetch(servidor.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: expandir(servidor.headers.Authorization),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: nomeNoCli.replace(/^mcp__moductus__/, ""), arguments: entrada },
    }),
  });
  const corpo = await resposta.json();
  responder(corpo.result?.content?.[0]?.text ?? JSON.stringify(corpo));
});
