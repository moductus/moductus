import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import pacote from "../../package.json" with { type: "json" };
import { atenderMensagem, ERRO_JSON_RPC, erroJsonRpc, type ExecucaoMcp } from "./protocolo.ts";

/**
 * Servidor MCP do Moductus (AGENTS.md §3 e §4, ADR-0014): HTTP "streamable" dentro do serviço, em
 * 127.0.0.1, sobre o catálogo. Cada execução de agente em CLI abre o próprio acesso: um token
 * sorteado que só enxerga as ferramentas daquela execução e deixa de valer quando ela termina. O
 * CLI recebe o token pelo ambiente e o manda em `Authorization: Bearer`; sem ele, 401 antes de ler
 * o corpo. O token nunca vai para o log.
 */

/** A única rota: o `--mcp-config` de cada execução aponta para ela. */
export const ROTA_MCP = "/mcp";

/** Uma chamada de ferramenta é pequena; corpo maior que isto é recusado sem ser guardado. */
export const CORPO_MAXIMO_MCP = 1024 * 1024;

export const RECUSA_TOKEN_MCP = "Moductus: acesso ao MCP ausente ou encerrado.";

/** O acesso de uma execução: endereço e token para o `--mcp-config`, até `fechar`. */
export interface AcessoMcp {
  url: string;
  token: string;
  /** Revoga o token; pedido que chegar depois recebe 401. Chamar duas vezes não faz mal. */
  fechar(): void;
}

export interface ServidorMcp {
  porta: number;
  url: string;
  /** Abre o acesso de uma execução às ferramentas dela. */
  abrir(execucao: ExecucaoMcp): AcessoMcp;
  fechar(): Promise<void>;
}

/** O token não fica guardado: só o hash, que é a chave da execução. */
function hashDe(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenDe(cabecalho: string | undefined): string | null {
  return /^Bearer\s+(\S+)\s*$/i.exec(cabecalho ?? "")?.[1] ?? null;
}

/** O caminho do pedido; `null` quando o request-target nem é URL. */
function caminhoDe(url: string | undefined): string | null {
  const base = "http://127.0.0.1";
  return URL.canParse(url ?? "/", base) ? new URL(url ?? "/", base).pathname : null;
}

/**
 * Recusa antes de ler o corpo: avisa que fecha e derruba a conexão depois de responder, para quem
 * não tem acesso não fazer o servidor ler um corpo sem limite.
 */
function recusar(
  res: ServerResponse,
  status: number,
  texto: string,
  cabecalhos: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close", ...cabecalhos });
  res.end(texto, () => res.socket?.destroy());
}

function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

/** Lê o corpo até o limite; acima dele, `null`. */
function lerCorpo(req: IncomingMessage, limite: number): Promise<string | null> {
  return new Promise((pronto, falhou) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    let estourou = false;
    req.on("data", (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > limite) estourou = true;
      if (!estourou) partes.push(parte);
    });
    req.on("end", () => pronto(estourou ? null : Buffer.concat(partes).toString("utf8")));
    req.on("error", falhou);
  });
}

/**
 * Sobe o servidor. A porta padrão é 0 (o sistema escolhe): o `--mcp-config` é gerado a cada
 * execução, então não precisa de endereço estável.
 */
export function abrirServidorMcp(porta = 0): Promise<ServidorMcp> {
  const execucoes = new Map<string, ExecucaoMcp>();

  // Nenhuma falha no atendimento pode virar rejeição solta: o Node derrubaria o serviço inteiro.
  const http: Server = createServer((req, res) => {
    tratar(req, res).catch((erro: unknown) => {
      console.error(`mcp: pedido não atendido: ${String(erro)}`);
      if (!res.headersSent) recusar(res, 500, "pedido não atendido");
      else res.destroy();
    });
  });

  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (caminhoDe(req.url) !== ROTA_MCP) return recusar(res, 404, "rota desconhecida");
    // Sem fluxo SSE do servidor (GET) nem sessão para encerrar (DELETE): o MCP responde 405.
    if (req.method !== "POST") return recusar(res, 405, "use POST", { allow: "POST" });
    // Navegador sempre manda Origin; o CLI não. Barra página web tentando falar com o 127.0.0.1.
    if (req.headers.origin !== undefined) return recusar(res, 403, "origem não permitida");
    const token = tokenDe(req.headers.authorization);
    const execucao = token ? execucoes.get(hashDe(token)) : undefined;
    if (!execucao) {
      console.error("mcp: pedido sem acesso válido recusado");
      return recusar(res, 401, RECUSA_TOKEN_MCP);
    }

    let texto: string | null;
    try {
      texto = await lerCorpo(req, CORPO_MAXIMO_MCP);
    } catch {
      return recusar(res, 400, "corpo interrompido");
    }
    if (texto === null) return recusar(res, 413, "pedido grande demais");
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      return responderJson(res, 400, erroJsonRpc(null, ERRO_JSON_RPC.json, "corpo não é JSON"));
    }

    // Lote (protocolo 2025-03-26) ou mensagem única; só notificações e respostas: 202 sem corpo.
    const lote = Array.isArray(corpo);
    const mensagens: unknown[] = Array.isArray(corpo) ? corpo : [corpo];
    if (lote && mensagens.length === 0) {
      return responderJson(res, 400, erroJsonRpc(null, ERRO_JSON_RPC.pedidoInvalido, "lote vazio"));
    }
    const respostas = (
      await Promise.all(mensagens.map((m) => atenderMensagem(m, execucao, pacote.version)))
    ).filter((r) => r !== null);
    if (respostas.length === 0) {
      res.writeHead(202);
      res.end();
      return;
    }
    responderJson(res, 200, lote ? respostas : respostas[0]);
  }

  return new Promise((pronto, falhou) => {
    http.once("error", falhou);
    http.listen(porta, "127.0.0.1", () => {
      http.off("error", falhou);
      const endereco = http.address();
      const portaAberta = typeof endereco === "object" && endereco ? endereco.port : 0;
      const url = `http://127.0.0.1:${portaAberta}${ROTA_MCP}`;
      pronto({
        porta: portaAberta,
        url,
        abrir(execucao) {
          const token = randomBytes(32).toString("base64url");
          const chave = hashDe(token);
          execucoes.set(chave, execucao);
          return { url, token, fechar: () => void execucoes.delete(chave) };
        },
        fechar: () =>
          new Promise((fechado) => {
            execucoes.clear();
            http.closeAllConnections();
            http.close(() => fechado());
          }),
      });
    });
  });
}
