// Faz o papel do `claude -p` que chama uma ferramenta do Moductus pelo MCP: lê a entrada padrão,
// acha o servidor no `--mcp-config`, expande o token do ambiente como o CLI faz, chama a primeira
// ferramenta do `--allowedTools` com a entrada dada e devolve um `result` de stream-json. Só fala
// com o 127.0.0.1 do teste; nenhum modelo.
//
// Uso: node cli-mcp-falso.mjs <entrada.json> -- <argumentos do claude...>
const [entradaJson, separador, ...argumentos] = process.argv.slice(2);
if (separador !== "--") throw new Error("uso: cli-mcp-falso.mjs <entrada> -- <argumentos>");
const valorDe = (flag) => argumentos[argumentos.indexOf(flag) + 1];

process.stdin.resume();
process.stdin.on("end", async () => {
  const servidor = JSON.parse(valorDe("--mcp-config")).mcpServers.moductus;
  const autorizacao = servidor.headers.Authorization.replace(
    /\$\{(\w+)\}/g,
    (_, nome) => process.env[nome] ?? "",
  );
  const nome = valorDe("--allowedTools")
    .split(",")[0]
    .replace(/^mcp__moductus__/, "");
  const resposta = await fetch(servidor.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: autorizacao,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: nome, arguments: JSON.parse(entradaJson) },
    }),
  });
  const corpo = await resposta.json();
  const texto = corpo.result?.content?.[0]?.text ?? JSON.stringify(corpo);
  const resultado = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: texto,
    session_id: "sessao-mcp",
    usage: { input_tokens: 3, output_tokens: 1 },
  };
  process.stdout.write(JSON.stringify(resultado) + "\n");
});
