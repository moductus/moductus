// Teste de fumaça do bundle do serviço: sobe servico/dist/servico.mjs como a casca faz
// e espera o aviso "pronto" no stdout. Pega erro que só aparece no bundle (import
// duplicado, require de CommonJS), que os testes do código-fonte não veem.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pasta = mkdtempSync(join(tmpdir(), "moductus-fumaca-"));
const script = join(raiz, "servico", "dist", "servico.mjs");
const filho = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", script], {
  env: { ...process.env, MODUCTUS_PASTA: pasta, MODUCTUS_TOKEN: "f".repeat(64) },
  stdio: ["pipe", "pipe", "pipe"],
});

let erros = "";
let resultado = null;
filho.stderr.on("data", (d) => (erros += d));

// Só apaga a pasta depois que o processo sai: o banco fica preso até lá.
const fim = (codigo, mensagem) => {
  if (resultado) return;
  resultado = { codigo, mensagem };
  filho.kill();
};

const prazo = setTimeout(() => fim(1, `serviço não ficou pronto em 10 s\n${erros}`), 10_000);

filho.stdout.on("data", (d) => {
  const linha = String(d).split("\n")[0];
  if (linha.includes('"tipo":"pronto"')) fim(0, `serviço pronto: ${linha}`);
});

filho.on("exit", (saida) => {
  if (!resultado)
    resultado = { codigo: 1, mensagem: `serviço saiu com ${saida} antes de ficar pronto\n${erros}` };
  clearTimeout(prazo);
  console.log(resultado.mensagem);
  rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(resultado.codigo);
});
