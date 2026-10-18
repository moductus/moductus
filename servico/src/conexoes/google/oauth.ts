import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ClienteOAuth, EnderecosGoogle } from "./cliente.ts";

/**
 * O OAuth de app instalado do Google (ADR-0031; developers.google.com/identity/protocols/oauth2/native-app):
 * receptor em `http://127.0.0.1:<porta aleatória>/`, PKCE S256, `state`, troca do código,
 * renovação e revogação. Nada aqui guarda token: quem chama decide onde ele mora.
 */

/** Prazo para o usuário autorizar no navegador; passou, o receptor fecha. */
export const PRAZO_AUTORIZACAO_MS = 5 * 60_000;

/** Pedido ao Google que não responde nisso desiste: a rede caiu ou está lenta demais. */
const LIMITE_PEDIDO_MS = 30_000;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** PKCE S256 (RFC 7636): verificador de 43 caracteres e o desafio, que é o hash dele. */
export function gerarPkce(sortear: (n: number) => Buffer = randomBytes): {
  verificador: string;
  desafio: string;
} {
  const verificador = base64url(sortear(32));
  return { verificador, desafio: base64url(createHash("sha256").update(verificador).digest()) };
}

/** O `state` que amarra a resposta ao pedido que este processo fez. */
export const gerarState = (sortear: (n: number) => Buffer = randomBytes) => base64url(sortear(32));

export function urlDeAutorizacao(
  enderecos: Pick<EnderecosGoogle, "autorizacao">,
  pedido: {
    cliente: ClienteOAuth;
    redirecionamento: string;
    escopos: readonly string[];
    desafio: string;
    state: string;
  },
): string {
  const url = new URL(enderecos.autorizacao);
  url.search = new URLSearchParams({
    client_id: pedido.cliente.id,
    redirect_uri: pedido.redirecionamento,
    response_type: "code",
    scope: pedido.escopos.join(" "),
    code_challenge: pedido.desafio,
    code_challenge_method: "S256",
    state: pedido.state,
    // Sem `offline` não vem refresh token; sem `consent`, reconectar pode voltar sem ele.
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

/** Por que a autorização no navegador não chegou ao fim. */
export type MotivoFalha = "state" | "negado" | "recusado" | "prazo" | "cancelado";

export class FalhaAutorizacao extends Error {
  constructor(
    readonly motivo: MotivoFalha,
    detalhe: string,
  ) {
    super(detalhe);
    this.name = "FalhaAutorizacao";
  }
}

export interface ReceptorOAuth {
  /** O `redirect_uri` do pedido, igual na autorização e na troca. */
  redirecionamento: string;
  /** O código, ou {@link FalhaAutorizacao}. O receptor fecha sozinho quando ela termina. */
  codigo: Promise<string>;
  /** Desiste agora (o usuário desconectou no meio): `codigo` falha com `cancelado`. */
  cancelar(): void;
}

/** Compara em tempo constante, inclusive no tamanho, pelo hash dos dois lados. */
function confere(recebido: string, esperado: string): boolean {
  const hash = (t: string) => createHash("sha256").update(t).digest();
  return timingSafeEqual(hash(recebido), hash(esperado));
}

/** Páginas que o navegador mostra depois do redirecionamento, sem nada além de texto. */
const PAGINA_OK = "Pronto: o Google Agenda está conectado. Pode fechar esta aba e voltar ao Moductus.";
const PAGINA_FALHOU = "A autorização não terminou. Volte ao Moductus e conecte de novo.";

function pagina(res: ServerResponse, status: number, texto: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  });
  res.end(texto);
}

/**
 * Abre o receptor em 127.0.0.1, porta escolhida pelo sistema, e espera um único redirecionamento
 * com o `state` deste pedido. `state` diferente é resposta que este processo não pediu: falha o
 * fluxo, em vez de aceitar o código de outro; pedido sem `state` não é resposta e não encerra nada.
 * Outros caminhos (o `favicon.ico`) recebem 404.
 */
export function abrirReceptorOAuth(state: string, prazoMs = PRAZO_AUTORIZACAO_MS): Promise<ReceptorOAuth> {
  let terminar: (resultado: { codigo: string } | { falha: FalhaAutorizacao }) => void = () => undefined;
  const codigo = new Promise<string>((pronto, falhou) => {
    terminar = (r) => ("codigo" in r ? pronto(r.codigo) : falhou(r.falha));
  });
  // Quem chama pode desistir antes de esperar o código: a falha não pode virar rejeição solta.
  codigo.catch(() => undefined);
  let terminou = false;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (terminou || req.method !== "GET" || url.pathname !== "/") return pagina(res, 404, "Nada aqui.");
    const recebido = url.searchParams.get("state");
    // Sem `state` nem é resposta de autorização (uma aba recarregada, um curioso): segue esperando.
    if (recebido === null) return pagina(res, 400, PAGINA_FALHOU);
    if (!confere(recebido, state)) {
      pagina(res, 400, PAGINA_FALHOU);
      return acabar({ falha: new FalhaAutorizacao("state", "a resposta não é do pedido deste Moductus") });
    }
    const erro = url.searchParams.get("error");
    if (erro !== null) {
      pagina(res, 200, PAGINA_FALHOU);
      const motivo = erro === "access_denied" ? "negado" : "recusado";
      return acabar({ falha: new FalhaAutorizacao(motivo, `o Google respondeu ${erro}`) });
    }
    const valor = url.searchParams.get("code");
    if (!valor) {
      pagina(res, 400, PAGINA_FALHOU);
      return acabar({ falha: new FalhaAutorizacao("recusado", "o Google não mandou o código") });
    }
    pagina(res, 200, PAGINA_OK);
    acabar({ codigo: valor });
  });

  const prazo = setTimeout(
    () => acabar({ falha: new FalhaAutorizacao("prazo", "o prazo para autorizar acabou") }),
    prazoMs,
  );
  prazo.unref();

  function acabar(resultado: { codigo: string } | { falha: FalhaAutorizacao }): void {
    if (terminou) return;
    terminou = true;
    clearTimeout(prazo);
    terminar(resultado);
    // A resposta ao navegador sai antes de derrubar as conexões que sobraram.
    setImmediate(() => {
      http.close();
      http.closeAllConnections();
    });
  }

  return new Promise((pronto, falhou) => {
    http.once("error", (erro) => {
      clearTimeout(prazo);
      falhou(erro);
    });
    http.listen(0, "127.0.0.1", () => {
      const endereco = http.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      pronto({
        redirecionamento: `http://127.0.0.1:${porta}/`,
        codigo,
        cancelar: () => acabar({ falha: new FalhaAutorizacao("cancelado", "a conexão foi cancelada") }),
      });
    });
  });
}

/** O Google recusou o pedido: `codigo` é o `error` do OAuth (`invalid_grant`, `invalid_client`…). */
export class ErroOAuth extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
  ) {
    super(`o Google recusou o pedido (${codigo})`);
    this.name = "ErroOAuth";
  }
}

export interface TokensOAuth {
  tokenDeAcesso: string;
  /** Ausente na renovação: o Google não troca o refresh token. */
  tokenDeRenovacao: string | null;
  /** Em milissegundos desde a época, pelo `expires_in`. */
  venceEm: number;
  escopos: string[];
}

/**
 * POST de formulário ao Google, sem levar o corpo nem a resposta ao log: os dois têm token. A
 * mensagem de erro de rede é a do `fetch`, que tem só o endereço, sem segredo.
 */
async function postar(buscar: typeof fetch, url: string, campos: Record<string, string>): Promise<Response> {
  return buscar(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(campos).toString(),
    signal: AbortSignal.timeout(LIMITE_PEDIDO_MS),
  });
}

async function lerTokens(resposta: Response, agora: number): Promise<TokensOAuth> {
  let corpo: Record<string, unknown> = {};
  try {
    corpo = (await resposta.json()) as Record<string, unknown>;
  } catch {
    // Corpo que não é JSON: o status decide abaixo.
  }
  if (!resposta.ok) {
    throw new ErroOAuth(
      typeof corpo.error === "string" ? corpo.error : `http_${resposta.status}`,
      resposta.status,
    );
  }
  if (typeof corpo.access_token !== "string" || !corpo.access_token) {
    throw new ErroOAuth("resposta_sem_token", resposta.status);
  }
  const expira = typeof corpo.expires_in === "number" ? corpo.expires_in : 3600;
  return {
    tokenDeAcesso: corpo.access_token,
    tokenDeRenovacao:
      typeof corpo.refresh_token === "string" && corpo.refresh_token ? corpo.refresh_token : null,
    venceEm: agora + expira * 1000,
    escopos: typeof corpo.scope === "string" ? corpo.scope.split(" ").filter(Boolean) : [],
  };
}

const credenciaisDoCliente = (cliente: ClienteOAuth) => ({
  client_id: cliente.id,
  ...(cliente.segredo ? { client_secret: cliente.segredo } : {}),
});

/** Troca o código pelo par de tokens, com o verificador do PKCE e o mesmo `redirect_uri`. */
export async function trocarCodigo(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "token">,
  pedido: { cliente: ClienteOAuth; codigo: string; verificador: string; redirecionamento: string },
  agora = Date.now(),
): Promise<TokensOAuth> {
  const resposta = await postar(buscar, enderecos.token, {
    ...credenciaisDoCliente(pedido.cliente),
    code: pedido.codigo,
    code_verifier: pedido.verificador,
    grant_type: "authorization_code",
    redirect_uri: pedido.redirecionamento,
  });
  return lerTokens(resposta, agora);
}

/** Um token de acesso novo pelo refresh token; `invalid_grant` quer dizer que ele morreu. */
export async function renovar(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "token">,
  pedido: { cliente: ClienteOAuth; tokenDeRenovacao: string },
  agora = Date.now(),
): Promise<TokensOAuth> {
  const resposta = await postar(buscar, enderecos.token, {
    ...credenciaisDoCliente(pedido.cliente),
    grant_type: "refresh_token",
    refresh_token: pedido.tokenDeRenovacao,
  });
  return lerTokens(resposta, agora);
}

/** Revoga o refresh token (e os de acesso que saíram dele). 200 é revogado; o resto, erro. */
export async function revogar(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "revogacao">,
  token: string,
): Promise<void> {
  const resposta = await postar(buscar, enderecos.revogacao, { token });
  if (!resposta.ok) {
    let codigo = `http_${resposta.status}`;
    try {
      const corpo = (await resposta.json()) as Record<string, unknown>;
      if (typeof corpo.error === "string") codigo = corpo.error;
    } catch {
      // Sem corpo JSON: fica o status.
    }
    throw new ErroOAuth(codigo, resposta.status);
  }
}

/**
 * O e-mail da conta, que é o id do calendário principal (`calendarList/primary`, lido com
 * `calendar.calendarlist.readonly`): o Moductus não pede escopo de perfil só para mostrar a conta.
 * Falha não impede a conexão: a conta fica vazia.
 */
export async function lerConta(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendarioPrincipal">,
  tokenDeAcesso: string,
): Promise<string | null> {
  try {
    const resposta = await buscar(enderecos.calendarioPrincipal, {
      headers: { authorization: `Bearer ${tokenDeAcesso}` },
      signal: AbortSignal.timeout(LIMITE_PEDIDO_MS),
    });
    if (!resposta.ok) return null;
    const corpo = (await resposta.json()) as Record<string, unknown>;
    return typeof corpo.id === "string" && corpo.id ? corpo.id : null;
  } catch {
    return null;
  }
}
