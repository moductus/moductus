import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Credenciais } from "../../../casca/credenciais.ts";
import type { ClienteOAuth, EnderecosGoogle } from "../cliente.ts";

/**
 * Um Google de mentira em 127.0.0.1 para os testes (nenhum pedido sai da máquina): o endpoint de
 * token confere o PKCE, o `redirect_uri` e o cliente como o Google confere; o de revogação e o do
 * calendário principal respondem como os de verdade. O "navegador" lê a URL de autorização e faz
 * o redirecionamento que o Google faria depois do consentimento.
 */

/** O que o navegador falso faz com a URL de autorização. */
export type Navegacao =
  | "autorizar"
  | "negar"
  | "state-errado"
  /** Não volta nunca: o usuário fechou a aba. */
  | "nada";

interface Pedido {
  rota: string;
  campos: Record<string, string>;
}

const base64url = (b: Buffer) => b.toString("base64url");

export interface GoogleFalso {
  enderecos: EnderecosGoogle;
  /** Abre a URL "no navegador": o que a casca faria, sem casca. */
  abrir: { endereco(url: string): Promise<void> };
  navegacao: Navegacao;
  /** A última URL de autorização aberta. */
  autorizacoes: URL[];
  pedidos: Pedido[];
  revogados: string[];
  /** Escopos que o usuário deixa marcados; `null` concede os pedidos. */
  escoposConcedidos: string[] | null;
  falharRevogacao: boolean;
  /** Mata todos os refresh tokens, como quando o usuário tira o acesso no Google. */
  revogarTudoNoGoogle(): void;
  /** O redirecionamento feito pelo navegador falso, para esperar por ele. */
  redirecionamentos: Promise<Response | Error>[];
  fechar(): Promise<void>;
}

export async function abrirGoogleFalso(
  cliente: ClienteOAuth,
  conta = "voce@gmail.com",
): Promise<GoogleFalso> {
  const codigos = new Map<string, { desafio: string; redirecionamento: string; escopos: string[] }>();
  const renovacoes = new Map<string, string[]>();
  const acessos = new Set<string>();
  let serie = 0;

  const responder = (res: ServerResponse, status: number, corpo: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(corpo));
  };

  const ler = (req: IncomingMessage) =>
    new Promise<Record<string, string>>((pronto) => {
      const partes: Buffer[] = [];
      req.on("data", (p: Buffer) => partes.push(p));
      req.on("end", () => pronto(Object.fromEntries(new URLSearchParams(Buffer.concat(partes).toString()))));
    });

  const clienteConfere = (campos: Record<string, string>) =>
    campos.client_id === cliente.id && (campos.client_secret ?? null) === cliente.segredo;

  const http: Server = createServer((req, res) => {
    void (async () => {
      const rota = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (rota === "/primary") {
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        return token && acessos.has(token)
          ? responder(res, 200, { id: conta, primary: true })
          : responder(res, 401, { error: { code: 401 } });
      }
      const campos = await ler(req);
      falso.pedidos.push({ rota, campos });
      if (rota === "/revoke") {
        if (falso.falharRevogacao) return responder(res, 503, { error: "backend_error" });
        renovacoes.delete(campos.token ?? "");
        acessos.delete(campos.token ?? "");
        falso.revogados.push(campos.token ?? "");
        return responder(res, 200, {});
      }
      if (rota !== "/token") return responder(res, 404, {});
      if (!clienteConfere(campos)) return responder(res, 401, { error: "invalid_client" });
      const novoAcesso = () => {
        const token = `acesso-${++serie}`;
        acessos.add(token);
        return token;
      };
      if (campos.grant_type === "authorization_code") {
        const pedido = codigos.get(campos.code ?? "");
        codigos.delete(campos.code ?? "");
        const desafio = base64url(
          createHash("sha256")
            .update(campos.code_verifier ?? "")
            .digest(),
        );
        if (!pedido || pedido.desafio !== desafio || pedido.redirecionamento !== campos.redirect_uri) {
          return responder(res, 400, { error: "invalid_grant" });
        }
        const renovacao = `renovacao-${++serie}`;
        renovacoes.set(renovacao, pedido.escopos);
        return responder(res, 200, {
          access_token: novoAcesso(),
          refresh_token: renovacao,
          expires_in: 3599,
          scope: pedido.escopos.join(" "),
          token_type: "Bearer",
        });
      }
      if (campos.grant_type === "refresh_token") {
        const escopos = renovacoes.get(campos.refresh_token ?? "");
        if (!escopos) return responder(res, 400, { error: "invalid_grant" });
        return responder(res, 200, {
          access_token: novoAcesso(),
          expires_in: 3599,
          scope: escopos.join(" "),
          token_type: "Bearer",
        });
      }
      return responder(res, 400, { error: "unsupported_grant_type" });
    })();
  });
  const porta = await new Promise<number>((pronto) =>
    http.listen(0, "127.0.0.1", () => {
      const endereco = http.address();
      pronto(typeof endereco === "object" && endereco ? endereco.port : 0);
    }),
  );
  const raiz = `http://127.0.0.1:${porta}`;

  const falso: GoogleFalso = {
    enderecos: {
      autorizacao: `${raiz}/auth`,
      token: `${raiz}/token`,
      revogacao: `${raiz}/revoke`,
      calendarioPrincipal: `${raiz}/primary`,
    },
    navegacao: "autorizar",
    autorizacoes: [],
    pedidos: [],
    revogados: [],
    escoposConcedidos: null,
    falharRevogacao: false,
    redirecionamentos: [],
    revogarTudoNoGoogle: () => renovacoes.clear(),
    abrir: {
      endereco(endereco) {
        const url = new URL(endereco);
        falso.autorizacoes.push(url);
        const p = url.searchParams;
        const volta = new URL(p.get("redirect_uri") ?? "");
        if (falso.navegacao === "nada") return Promise.resolve();
        if (falso.navegacao === "negar") {
          volta.search = new URLSearchParams({
            error: "access_denied",
            state: p.get("state") ?? "",
          }).toString();
        } else {
          const codigo = `codigo-${++serie}`;
          codigos.set(codigo, {
            desafio: p.get("code_challenge") ?? "",
            redirecionamento: p.get("redirect_uri") ?? "",
            escopos: falso.escoposConcedidos ?? (p.get("scope") ?? "").split(" "),
          });
          const state = falso.navegacao === "state-errado" ? "outro-state" : (p.get("state") ?? "");
          volta.search = new URLSearchParams({ code: codigo, state, scope: p.get("scope") ?? "" }).toString();
        }
        // O navegador volta depois que a casca já respondeu que abriu.
        falso.redirecionamentos.push(
          new Promise<void>((r) => setImmediate(r)).then(() =>
            fetch(volta).catch((erro: unknown) => erro as Error),
          ),
        );
        return Promise.resolve();
      },
    },
    fechar: () =>
      new Promise((fechado) => {
        http.closeAllConnections();
        http.close(() => fechado());
      }),
  };
  return falso;
}

/** O Gerenciador de Credenciais num mapa: nada vai ao Windows. */
export function credenciaisNaMemoria(): Credenciais & { valores: Map<string, string> } {
  const valores = new Map<string, string>();
  return {
    valores,
    ler: (nome) => Promise.resolve(valores.get(nome) ?? null),
    guardar: (nome, valor) => {
      valores.set(nome, valor);
      return Promise.resolve();
    },
    apagar: (nome) => {
      valores.delete(nome);
      return Promise.resolve();
    },
  };
}
