import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FerramentaSessao } from "@moductus/contrato";
import { lerEventoHook, type EventoHook } from "./hooks.ts";

/** Porta fixa dos hooks (ADR-0015): o `settings.json` do usuário aponta para ela entre reinícios. */
export const PORTA_HOOKS_PADRAO = 47821;

/** Variável que troca a porta (outra instância, desenvolvimento); fora dela, a padrão. */
export function portaDosHooks(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env.MODUCTUS_HOOKS_PORTA);
  return Number.isInteger(valor) && valor > 0 && valor < 65536 ? valor : PORTA_HOOKS_PADRAO;
}

/** Corpo maior que isto é recusado: o `PostToolUse` traz a saída da ferramenta, que pode ser grande. */
export const CORPO_MAXIMO = 8 * 1024 * 1024;

/** Uma rota por ferramenta, que a ligação grava na configuração dela; a F2-27 acrescenta as outras. */
export const ROTAS_HOOKS: Record<string, FerramentaSessao> = { "/hooks/claude-code": "claude-code" };

/** Explica no próprio Claude Code (e no log dele) por que o evento foi recusado. */
export const RECUSA_TOKEN =
  "Moductus: token dos hooks ausente ou diferente. Abra um terminal novo para o Claude Code ler MODUCTUS_HOOKS_TOKEN.";

/**
 * Atende um evento já autenticado e lido; o que devolve vai como corpo JSON da resposta (a
 * decisão de um `PermissionRequest`, por exemplo). Pode demorar: a resposta espera. `conexao`
 * aborta se a ferramenta desistir antes da resposta (a conexão caiu): ninguém mais vai ler.
 */
export type AtenderHook = (
  ferramenta: FerramentaSessao,
  evento: EventoHook,
  conexao: AbortSignal,
) => object | undefined | Promise<object | undefined>;

export interface ReceptorHooks {
  porta: number;
  fechar(): Promise<void>;
}

/**
 * Compara em tempo constante, inclusive no tamanho: os dois lados viram o mesmo número de bytes
 * pelo hash antes do `timingSafeEqual`.
 */
function tokenConfere(cabecalho: string | undefined, esperado: string): boolean {
  const recebido = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho ?? "")?.[1];
  if (!recebido) return false;
  const hash = (t: string) => createHash("sha256").update(t).digest();
  return timingSafeEqual(hash(recebido), hash(esperado));
}

function responder(res: ServerResponse, status: number, corpo: object | string): void {
  const json = typeof corpo !== "string";
  res.writeHead(status, {
    "content-type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
  });
  res.end(json ? JSON.stringify(corpo) : corpo);
}

/**
 * Recusa antes de ler o corpo: avisa que fecha e derruba a conexão depois de responder, para que
 * quem não tem token não consiga fazer o receptor ler (e descartar) um corpo sem limite.
 */
function recusar(
  res: ServerResponse,
  status: number,
  texto: string,
  cabecalhos: Record<string, string> = {},
) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close", ...cabecalhos });
  res.end(texto, () => res.socket?.destroy());
}

/** O caminho do pedido; `null` quando o request-target nem é URL (o `new URL` lançaria). */
function caminhoDe(url: string | undefined): string | null {
  const base = "http://127.0.0.1";
  return URL.canParse(url ?? "/", base) ? new URL(url ?? "/", base).pathname : null;
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
 * Receptor HTTP dos hooks (AGENTS.md §5), em 127.0.0.1 na porta fixa, separado do canal das
 * janelas. Cada ferramenta posta numa rota (`POST /hooks/claude-code`) com o token no cabeçalho
 * `Authorization: Bearer`; sem ele, 401 antes de ler o corpo. O token nunca vai para o log.
 */
export function abrirReceptorHooks(
  token: string,
  atender: AtenderHook,
  porta = PORTA_HOOKS_PADRAO,
): Promise<ReceptorHooks> {
  if (!token) throw new Error("receptor dos hooks sem token");

  // Nenhuma falha no atendimento pode virar rejeição solta: o Node derrubaria o serviço inteiro.
  const http: Server = createServer((req, res) => {
    tratar(req, res).catch((erro: unknown) => {
      console.error(`hooks: pedido não atendido: ${String(erro)}`);
      if (!res.headersSent) recusar(res, 500, "pedido não atendido");
      else res.destroy();
    });
  });

  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const caminho = caminhoDe(req.url);
    if (caminho === null) return recusar(res, 400, "rota inválida");
    // `hasOwn`: o caminho vem de fora e não pode achar nada no protótipo.
    const ferramenta = Object.hasOwn(ROTAS_HOOKS, caminho) ? ROTAS_HOOKS[caminho] : undefined;
    if (!ferramenta) return recusar(res, 404, "rota desconhecida");
    if (req.method !== "POST") return recusar(res, 405, "use POST", { allow: "POST" });
    if (!tokenConfere(req.headers.authorization, token)) {
      console.error(`hooks: evento de ${ferramenta} sem token válido recusado`);
      return recusar(res, 401, RECUSA_TOKEN);
    }
    let texto: string | null;
    try {
      texto = await lerCorpo(req, CORPO_MAXIMO);
    } catch {
      return responder(res, 400, "corpo interrompido");
    }
    if (texto === null) return responder(res, 413, "evento grande demais");
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      return responder(res, 400, "corpo não é JSON");
    }
    const evento = lerEventoHook(corpo);
    if (!evento) return responder(res, 400, "evento sem hook_event_name ou session_id");
    // A conexão fechada antes da resposta (o Claude Code desistiu, o receptor fechou) avisa quem
    // está segurando a resposta, para ele soltar o que segurava.
    const conexao = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) conexao.abort(new Error("a conexão do hook caiu antes da resposta"));
    });
    try {
      responder(res, 200, (await atender(ferramenta, evento, conexao.signal)) ?? {});
    } catch (erro) {
      console.error(`hooks: ${evento.tipo} de ${ferramenta} não registrado: ${String(erro)}`);
      // Sem decisão: a ferramenta segue como se o hook não existisse.
      responder(res, 500, "evento não registrado");
    }
  }

  return new Promise((pronto, falhou) => {
    http.once("error", falhou);
    http.listen(porta, "127.0.0.1", () => {
      http.off("error", falhou);
      const endereco = http.address();
      pronto({
        porta: typeof endereco === "object" && endereco ? endereco.port : 0,
        fechar: () =>
          new Promise((fechado) => {
            http.closeAllConnections();
            http.close(() => fechado());
          }),
      });
    });
  });
}
