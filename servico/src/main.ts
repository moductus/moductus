import { createServer } from "node:http";
import { CanalCasca } from "./casca/canal.ts";

/**
 * moductus-servico: sobe pela casca como sidecar. Recebe a pasta de dados e o token
 * por variável de ambiente, abre o servidor em 127.0.0.1 numa porta aleatória e avisa
 * a casca pelo stdout. Se cair, a casca sobe outro.
 */
const canal = new CanalCasca(process.stdout);
canal.ouvir(process.stdin);

const servidor = createServer((_req, res) => {
  res.statusCode = 426;
  res.end();
});

servidor.listen(0, "127.0.0.1", () => {
  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  console.error(`servico pronto na porta ${porta}, pid ${process.pid}`);
  canal.avisar({ tipo: "pronto", porta, pid: process.pid });
});

// A casca fechou o stdin: ela saiu, então o serviço sai junto.
process.stdin.on("end", () => process.exit(0));
