// Faz o papel do `claude -p` nos testes do adaptador: lê a entrada padrão, anota o que recebeu e
// devolve uma saída gravada, linha a linha, como o CLI de verdade. Nenhuma rede, nenhum modelo.
//
// Uso: node cli-falso.mjs <saida.jsonl | -> <modo> <anotacao.json | -> -- <argumentos do claude...>
//   modo "normal": escreve a saída e sai com 0
//   modo "pendurar": escreve a saída e fica vivo até ser encerrado
//   modo "falhar": escreve a saída, uma mensagem no stderr e sai com 1
import { readFileSync, writeFileSync } from "node:fs";

const [saida, modo, anotacao, separador, ...argumentos] = process.argv.slice(2);
if (separador !== "--") throw new Error("uso: cli-falso.mjs <saida> <modo> <anotacao> -- <argumentos>");

let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (pedaco) => (entrada += pedaco));
process.stdin.on("end", () => {
  if (anotacao !== "-")
    writeFileSync(anotacao, JSON.stringify({ argumentos, entrada, pasta: process.cwd() }));
  const linhas = saida === "-" ? [] : readFileSync(saida, "utf8").split(/\r?\n/).filter(Boolean);
  for (const linha of linhas) process.stdout.write(linha + "\n");
  if (modo === "pendurar") setInterval(() => {}, 60_000);
  else if (modo === "falhar") {
    process.stderr.write("Error: No conversation found with session ID: 0000\n");
    process.exitCode = 1;
  }
});
