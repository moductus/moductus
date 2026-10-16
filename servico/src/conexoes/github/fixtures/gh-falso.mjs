// Um `gh` falso para o teste do executor: o primeiro argumento escolhe o que ele faz, e nada
// sai da máquina.
import { readFileSync } from "node:fs";

const [modo, ...args] = process.argv.slice(2);

if (modo === "ok") {
  process.stdout.write(readFileSync(new URL("./resposta-graphql.json", import.meta.url), "utf8"));
} else if (modo === "eco") {
  process.stdout.write(JSON.stringify(args));
} else if (modo === "sem-login") {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n");
  process.exitCode = 4;
} else if (modo === "dorme") {
  setTimeout(() => undefined, 60_000);
} else {
  process.stderr.write(`gh: modo desconhecido ${modo}\n`);
  process.exitCode = 1;
}
