import { abrirBanco, pastaDeDados } from "./banco/conexao.ts";
import { VERSAO_PROTOCOLO } from "@moductus/contrato";
import { abrirServidorWs } from "./api/servidor.ts";
import { CanalCasca } from "./casca/canal.ts";

/**
 * moductus-servico: sobe pela casca como sidecar. Recebe a pasta de dados e o token
 * por variável de ambiente, abre o servidor em 127.0.0.1 numa porta aleatória e avisa
 * a casca pelo stdout. Se cair, a casca sobe outro.
 */
const banco = abrirBanco(pastaDeDados());
const canal = new CanalCasca(process.stdout);
canal.ouvir(process.stdin);

const token = process.env.MODUCTUS_TOKEN;
if (!token) {
  console.error("MODUCTUS_TOKEN ausente: o serviço só sobe pela casca");
  process.exit(1);
}

const servidor = await abrirServidorWs(token, {
  "sistema.ping": () => ({ protocolo: VERSAO_PROTOCOLO, pid: process.pid }),
});
console.error(`servico pronto na porta ${servidor.porta}, pid ${process.pid}`);
canal.avisar({ tipo: "pronto", porta: servidor.porta, pid: process.pid });

// A casca fechou o stdin: ela saiu, então o serviço sai junto.
process.stdin.on("end", () => {
  banco.close();
  process.exit(0);
});
