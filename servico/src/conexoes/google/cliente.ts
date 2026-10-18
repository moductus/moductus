/**
 * O cliente OAuth do Moductus no Google (ADR-0031): um "Desktop app" num projeto do autor,
 * publicado sem verificação. Segredo de app instalado não é confidencial (o Google diz isso na
 * documentação de apps nativos): ele vai no código, e a proteção do fluxo é o PKCE.
 */
export interface ClienteOAuth {
  id: string;
  /** O Google trata como opcional no cliente Desktop; quando há, vai na troca e na renovação. */
  segredo: string | null;
}

/**
 * O cliente do autor. Fica `null` até a F3-21, quando o humano cria o projeto no Google Cloud e
 * entrega o client ID e o secret: sem ele, só conecta quem usa o próprio cliente.
 */
// F3-21: trocar `null` por { id: "<client id>.apps.googleusercontent.com", segredo: "<secret>" }.
export const CLIENTE_DO_AUTOR: ClienteOAuth | null = null;

/**
 * Escopos ao conectar (ADR-0031): criar e escrever no calendário "Moductus" e ler os outros.
 * Escrever nos outros (`calendar.events`) pede o consentimento de novo, na primeira vez (F3-25).
 */
export const ESCOPOS_AO_CONECTAR = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

/** Onde o fluxo bate; o teste troca por um servidor OAuth falso em 127.0.0.1. */
export interface EnderecosGoogle {
  autorizacao: string;
  token: string;
  revogacao: string;
  /** O calendário principal, cujo id é o e-mail da conta (`calendarList/primary`). */
  calendarioPrincipal: string;
  /** A raiz da Calendar API v3: a lista de calendários e os eventos de cada um (F3-23). */
  calendario: string;
}

export const ENDERECOS_GOOGLE: EnderecosGoogle = {
  autorizacao: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revogacao: "https://oauth2.googleapis.com/revoke",
  calendarioPrincipal: "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
  calendario: "https://www.googleapis.com/calendar/v3",
};

/** Lê o cliente que o usuário trouxe; o que não tem a forma certa é recusado com o motivo. */
export function validarCliente(cliente: { id: string; segredo?: string | null }): ClienteOAuth {
  const id = cliente.id.trim();
  const segredo = cliente.segredo?.trim() || null;
  if (!id || /\s/.test(id)) throw new Error("O client ID está vazio ou tem espaço no meio.");
  if (segredo !== null && /\s/.test(segredo)) throw new Error("O client secret tem espaço no meio.");
  return { id, segredo };
}
