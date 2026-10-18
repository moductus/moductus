import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Credenciais } from "../../../casca/credenciais.ts";
import type { ClienteOAuth, EnderecosGoogle } from "../cliente.ts";

/**
 * Um Google de mentira em 127.0.0.1 para os testes (nenhum pedido sai da máquina): o endpoint de
 * token confere o PKCE, o `redirect_uri` e o cliente como o Google confere; o de revogação e o do
 * calendário principal respondem como os de verdade. O "navegador" lê a URL de autorização e faz
 * o redirecionamento que o Google faria depois do consentimento. A Calendar API (F3-23) tem a
 * lista de calendários e os eventos de cada um, com `timeMin`, páginas, `nextSyncToken` (o que
 * mudou desde ele, com os apagados como `cancelled`), o 410 do token vencido e as respostas de cota.
 * A escrita (F3-24) cria e confere calendário e insere, muda (PATCH) e apaga evento, com o 409 do
 * `id` repetido, o 404 do que não existe e o 410 do já apagado, como o Google.
 */

/** Um calendário da lista da conta, como o `calendarList` devolve. */
export interface CalendarioFalso {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

interface EventoGuardado {
  corpo: Record<string, unknown>;
  versao: number;
  cancelado: boolean;
}

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
  /** A renovação devolve um refresh token novo, como o Google às vezes faz. */
  trocarRenovacao: boolean;
  /** Mata todos os refresh tokens, como quando o usuário tira o acesso no Google. */
  revogarTudoNoGoogle(): void;
  /** O redirecionamento feito pelo navegador falso, para esperar por ele. */
  redirecionamentos: Promise<Response | Error>[];
  /** A lista de calendários da conta (`calendarList`). */
  calendarios: CalendarioFalso[];
  /** Grava um evento (novo ou mudado): a mudança entra na próxima leitura incremental. */
  gravarEvento(calendarioId: string, evento: Record<string, unknown> & { id: string }): void;
  /** Apaga um evento: a incremental o devolve como `cancelled`, a completa não o devolve mais. */
  apagarEvento(calendarioId: string, id: string): void;
  /** Os tokens de sincronização dados até aqui deixam de valer: o próximo pedido com eles é 410. */
  vencerSincronizacao(): void;
  /** Os próximos `restantes` pedidos à Calendar API respondem que passou da cota. */
  cota: { restantes: number; status: 403 | 429 };
  /** Todo pedido à Calendar API responde com este status (500 é o Google fora do ar). */
  falharCalendario: number | null;
  /** Eventos por página, para a leitura passar por mais de uma. */
  porPagina: number;
  /** Os pedidos à Calendar API, em ordem. */
  pedidosCalendario: URL[];
  /** Os tokens de acesso dados deixam de valer, como quando o Google os recusa antes de vencer. */
  esquecerAcessos(): void;
  /** Muda um evento como você faria no celular: junta os campos e o etag muda. */
  mudarEvento(calendarioId: string, id: string, mudanca: Record<string, unknown>): void;
  /** Os eventos vivos de um calendário, como estão agora. */
  eventosDe(calendarioId: string): Record<string, unknown>[];
  /** Apaga o calendário inteiro, com os eventos, como você faria nas configurações do Google. */
  apagarCalendario(id: string): void;
  /** As escritas na Calendar API (POST, PATCH, DELETE), em ordem. */
  escritas: { metodo: string; rota: string; corpo: Record<string, unknown> | null }[];
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

  const eventos = new Map<string, Map<string, EventoGuardado>>();
  let versao = 0;
  let validoDesde = 0;

  const erroGoogle = (res: ServerResponse, status: number, razao: string) =>
    responder(res, status, { error: { code: status, errors: [{ reason: razao }] } });

  /** Termina depois de `desde` (o `timeMin` do Google): o recorrente vale enquanto a regra valer. */
  const terminaDepois = (corpo: Record<string, unknown>, desde: number) => {
    if (Array.isArray(corpo.recurrence)) return true;
    const fim = corpo.end as { date?: string; dateTime?: string } | undefined;
    const quando = Date.parse(fim?.dateTime ?? fim?.date ?? "");
    return !Number.isFinite(desde) || !Number.isFinite(quando) || quando > desde;
  };

  /** O que o Google devolve de um apagado: só o id e, da ocorrência, de qual recorrente ela é. */
  const cancelado = (corpo: Record<string, unknown>) => ({
    id: corpo.id,
    status: "cancelled",
    ...(corpo.recurringEventId
      ? { recurringEventId: corpo.recurringEventId, originalStartTime: corpo.originalStartTime }
      : {}),
  });

  const lerJson = (req: IncomingMessage) =>
    new Promise<Record<string, unknown> | null>((pronto) => {
      const partes: Buffer[] = [];
      req.on("data", (p: Buffer) => partes.push(p));
      req.on("end", () => {
        try {
          pronto(JSON.parse(Buffer.concat(partes).toString()) as Record<string, unknown>);
        } catch {
          pronto(null);
        }
      });
    });

  let calendariosCriados = 0;
  /** O etag que o Google dá a cada versão de um evento. */
  const etagDe = (n: number) => `"e${n}"`;

  /** As escritas: calendário novo, e inserir, mudar e apagar evento num calendário que existe. */
  const escritaApi = (
    res: ServerResponse,
    metodo: string,
    rota: string,
    corpo: Record<string, unknown> | null,
  ) => {
    falso.escritas.push({ metodo, rota, corpo });
    if (rota === "/calendars" && metodo === "POST") {
      const id = `moductus-${++calendariosCriados}@group.calendar.google.com`;
      falso.calendarios.push({ id, summary: String(corpo?.summary ?? "") });
      return responder(res, 200, { kind: "calendar#calendar", id, summary: corpo?.summary, etag: '"c1"' });
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(rota);
    const calendarioId = m ? decodeURIComponent(m[1]!) : "";
    if (!m || !falso.calendarios.some((c) => c.id === calendarioId)) return erroGoogle(res, 404, "notFound");
    const doCalendario = eventos.get(calendarioId) ?? new Map<string, EventoGuardado>();
    eventos.set(calendarioId, doCalendario);
    const eventoId = m[2] === undefined ? null : decodeURIComponent(m[2]);
    if (eventoId === null && metodo === "POST") {
      const id = typeof corpo?.id === "string" ? corpo.id : `gerado${++serie}`;
      if (!/^[a-v0-9]{5,1024}$/.test(id)) return erroGoogle(res, 400, "invalid");
      if (doCalendario.has(id)) return erroGoogle(res, 409, "duplicate");
      const n = ++versao;
      const guardado = { ...corpo, id, etag: etagDe(n), status: "confirmed" };
      doCalendario.set(id, { corpo: guardado, versao: n, cancelado: false });
      return responder(res, 200, guardado);
    }
    const atual = eventoId === null ? undefined : doCalendario.get(eventoId);
    if (!atual || eventoId === null) return erroGoogle(res, 404, "notFound");
    if (metodo === "PATCH") {
      const n = ++versao;
      const guardado = { ...atual.corpo, ...corpo, id: eventoId, etag: etagDe(n) };
      doCalendario.set(eventoId, { corpo: guardado, versao: n, cancelado: atual.cancelado });
      return responder(res, 200, { ...guardado, status: atual.cancelado ? "cancelled" : "confirmed" });
    }
    if (metodo === "DELETE") {
      if (atual.cancelado) return erroGoogle(res, 410, "deleted");
      doCalendario.set(eventoId, { ...atual, versao: ++versao, cancelado: true });
      res.writeHead(204);
      return res.end();
    }
    return erroGoogle(res, 400, "invalid");
  };

  const calendarioApi = (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    corpo: Record<string, unknown> | null,
  ) => {
    falso.pedidosCalendario.push(url);
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token || !acessos.has(token)) return erroGoogle(res, 401, "authError");
    if (falso.falharCalendario !== null) return erroGoogle(res, falso.falharCalendario, "backendError");
    if (falso.cota.restantes > 0) {
      falso.cota.restantes--;
      return erroGoogle(res, falso.cota.status, "rateLimitExceeded");
    }
    const rota = url.pathname.slice("/calendar/v3".length);
    const metodo = req.method ?? "GET";
    if (metodo !== "GET") return escritaApi(res, metodo, rota, corpo);
    if (rota === "/users/me/calendarList") {
      return responder(res, 200, { kind: "calendar#calendarList", items: falso.calendarios });
    }
    const calendario = /^\/calendars\/([^/]+)$/.exec(rota);
    if (calendario) {
      const id = decodeURIComponent(calendario[1]!);
      return falso.calendarios.some((c) => c.id === id)
        ? responder(res, 200, { kind: "calendar#calendar", id })
        : erroGoogle(res, 404, "notFound");
    }
    const m = /^\/calendars\/([^/]+)\/events$/.exec(rota);
    const calendarioId = m ? decodeURIComponent(m[1]!) : "";
    if (!m || !falso.calendarios.some((c) => c.id === calendarioId)) return erroGoogle(res, 404, "notFound");
    const doCalendario = [...(eventos.get(calendarioId)?.values() ?? [])].sort(
      (a, b) => a.versao - b.versao || String(a.corpo.id).localeCompare(String(b.corpo.id)),
    );
    const p = url.searchParams;
    const [, deslocado, foto] = /^p:(\d+):(\d+)$/.exec(p.get("pageToken") ?? "") ?? [];
    const instantanea = foto === undefined ? versao : Number(foto);
    const sincronizacao = p.get("syncToken");
    let itens: unknown[];
    if (sincronizacao !== null) {
      const desde = Number(/^sync:(\d+)$/.exec(sincronizacao)?.[1] ?? -1);
      if (desde < validoDesde) return erroGoogle(res, 410, "fullSyncRequired");
      itens = doCalendario
        .filter((e) => e.versao > desde && e.versao <= instantanea)
        .map((e) => (e.cancelado ? cancelado(e.corpo) : e.corpo));
    } else {
      const desde = Date.parse(p.get("timeMin") ?? "");
      // Sem `showDeleted`, a completa ainda traz a ocorrência cancelada de um recorrente.
      itens = doCalendario
        .filter((e) => e.versao <= instantanea)
        .filter((e) => (e.cancelado ? Boolean(e.corpo.recurringEventId) : terminaDepois(e.corpo, desde)))
        .map((e) => (e.cancelado ? cancelado(e.corpo) : e.corpo));
    }
    const inicio = Number(deslocado ?? 0);
    const pagina = itens.slice(inicio, inicio + falso.porPagina);
    const resta = inicio + falso.porPagina < itens.length;
    return responder(res, 200, {
      kind: "calendar#events",
      items: pagina,
      ...(resta
        ? { nextPageToken: `p:${inicio + falso.porPagina}:${instantanea}` }
        : { nextSyncToken: `sync:${instantanea}` }),
    });
  };

  const http: Server = createServer((req, res) => {
    void (async () => {
      const endereco = new URL(req.url ?? "/", "http://127.0.0.1");
      const rota = endereco.pathname;
      if (rota.startsWith("/calendar/v3/")) return calendarioApi(req, res, endereco, await lerJson(req));
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
        // Token que o Google não conhece mais (já revogado): 400 `invalid_token`, como o de verdade.
        if (!renovacoes.has(campos.token ?? "") && !acessos.has(campos.token ?? "")) {
          return responder(res, 400, {
            error: "invalid_token",
            error_description: "Token expired or revoked",
          });
        }
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
        let trocado: string | undefined;
        if (falso.trocarRenovacao) {
          trocado = `renovacao-${++serie}`;
          renovacoes.set(trocado, escopos);
        }
        return responder(res, 200, {
          ...(trocado ? { refresh_token: trocado } : {}),
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
      calendario: `${raiz}/calendar/v3`,
    },
    navegacao: "autorizar",
    autorizacoes: [],
    pedidos: [],
    revogados: [],
    escoposConcedidos: null,
    falharRevogacao: false,
    trocarRenovacao: false,
    redirecionamentos: [],
    revogarTudoNoGoogle: () => renovacoes.clear(),
    calendarios: [{ id: conta, summary: conta, primary: true, backgroundColor: "#9fe1e7" }],
    gravarEvento(calendarioId, evento) {
      const doCalendario = eventos.get(calendarioId) ?? new Map<string, EventoGuardado>();
      eventos.set(calendarioId, doCalendario);
      doCalendario.set(evento.id, {
        corpo: evento,
        versao: ++versao,
        cancelado: evento.status === "cancelled",
      });
    },
    apagarEvento(calendarioId, id) {
      const atual = eventos.get(calendarioId)?.get(id);
      if (atual) eventos.get(calendarioId)!.set(id, { ...atual, versao: ++versao, cancelado: true });
    },
    vencerSincronizacao: () => {
      validoDesde = ++versao;
    },
    cota: { restantes: 0, status: 429 },
    falharCalendario: null,
    porPagina: 250,
    pedidosCalendario: [],
    esquecerAcessos: () => acessos.clear(),
    mudarEvento(calendarioId, id, mudanca) {
      const atual = eventos.get(calendarioId)?.get(id);
      if (!atual) throw new Error(`o evento ${id} não existe no Google falso`);
      const n = ++versao;
      eventos.get(calendarioId)!.set(id, {
        corpo: { ...atual.corpo, ...mudanca, etag: etagDe(n) },
        versao: n,
        cancelado: atual.cancelado,
      });
    },
    eventosDe: (calendarioId) =>
      [...(eventos.get(calendarioId)?.values() ?? [])].filter((e) => !e.cancelado).map((e) => e.corpo),
    apagarCalendario(id) {
      falso.calendarios = falso.calendarios.filter((c) => c.id !== id);
      eventos.delete(id);
    },
    escritas: [],
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
