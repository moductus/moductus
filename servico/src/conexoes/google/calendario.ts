import { ehDia, instanteNoFuso, somarDias } from "../../areas/dia/tempo.ts";
import type { EnderecosGoogle } from "./cliente.ts";

/**
 * A Calendar API v3 do Google (F3-23, ADR-0035): a lista de calendários da conta e os eventos de
 * cada um, por página, na leitura completa (desde 7 dias atrás) ou na incremental (pelo
 * `nextSyncToken`). Aqui só o pedido e a leitura da resposta; o que entra no cache e quando ler
 * é da `LeituraGoogleAgenda`. Resposta grande ou malformada vira erro, nunca trava o serviço, e o
 * token de acesso não aparece em mensagem nenhuma.
 *
 * A escrita (F3-24) é no calendário "Moductus": criar e conferir o calendário, e inserir, mudar
 * e apagar evento nele. Quando e o quê é do `EspelhoGoogleAgenda`. Inserir e mudar servem também
 * aos outros calendários, com aprovação (F3-25, `EscritaGoogleAgenda`).
 */

/** Pedido ao Google que não responde nisso desiste: a rede caiu ou está lenta demais. */
const LIMITE_PEDIDO_MS = 30_000;

/**
 * Uma página bem maior que isso não é do Google: é defeito, e não vale ler. O corpo é lido aos
 * pedaços, contando, e o pedido é cancelado no teto, com ou sem `content-length`.
 */
export const MAXIMO_RESPOSTA_BYTES = 16 * 1024 * 1024;

/** Eventos por página: o padrão do Google (250) e o máximo que ele aceita (2500). */
export const EVENTOS_POR_PAGINA = 2500;

/** Os limites do que se guarda de um evento lido: texto maior que isso não é do dia de ninguém. */
const MAXIMO_TITULO = 1000;
const MAXIMO_DESCRICAO = 10_000;
const MAXIMO_LOCAL = 500;
/** O tamanho que o contrato aceita para a regra (`Recorrencia`). */
const MAXIMO_REGRA = 500;
/** Id de evento ou de calendário maior que isso não é do Google (os de lá têm dezenas de letras). */
const MAXIMO_ID = 1024;
/** Uma linha `EXDATE` maior que isso, ou com mais datas, não é lida: é defeito, não agenda. */
const MAXIMO_LINHA_EXDATE = 20_000;
const MAXIMO_DATAS_POR_EXDATE = 1000;
/** O nome mais longo da base de fusos do IANA tem 32 letras. */
const MAXIMO_FUSO = 64;

/**
 * Por que o pedido falhou: `sincronizacao-vencida` é o 410 do `syncToken` (a leitura recomeça do
 * zero), `cota` é o 403 de limite e o 429 (espera), `acesso` é o 401 (o token de acesso não vale
 * mais), `recusado` é qualquer outra resposta de erro, e `rede` é não ter chegado ou ter chegado
 * sem forma.
 */
export type FalhaCalendario = "sincronizacao-vencida" | "cota" | "acesso" | "recusado" | "rede";

export class ErroCalendario extends Error {
  constructor(
    readonly falha: FalhaCalendario,
    mensagem: string,
    /** O status HTTP, quando houve resposta. */
    readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = "ErroCalendario";
  }
}

/** As razões do 403 que são de limite de uso, não de permissão (guides/errors da Calendar API). */
const RAZOES_DE_COTA = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"];

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** O que veio no corpo do erro do Google, para separar cota de permissão. */
function razoesDoErro(corpo: unknown): string[] {
  if (!ehObjeto(corpo) || !ehObjeto(corpo.error)) return [];
  const erros = corpo.error.errors;
  if (!Array.isArray(erros)) return [];
  return erros.flatMap((e) => (ehObjeto(e) && typeof e.reason === "string" ? [e.reason] : []));
}

/**
 * O corpo da resposta como JSON e quantos bytes ele tinha. Lê aos pedaços e desiste no
 * {@link MAXIMO_RESPOSTA_BYTES}, cancelando o resto: o que o Google declara não basta, porque a
 * resposta pode não declarar nada. JSON que não se lê volta `null`.
 */
async function lerCorpo(resposta: Response): Promise<{ corpo: unknown; bytes: number }> {
  const grande = () => new ErroCalendario("rede", "resposta grande demais");
  const declarado = Number(resposta.headers.get("content-length") ?? "0");
  if (declarado > MAXIMO_RESPOSTA_BYTES) {
    await resposta.body?.cancel().catch(() => undefined);
    throw grande();
  }
  const partes: Uint8Array[] = [];
  let bytes = 0;
  if (resposta.body) {
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAXIMO_RESPOSTA_BYTES) {
        await leitor.cancel().catch(() => undefined);
        throw grande();
      }
      partes.push(value);
    }
  }
  try {
    return { corpo: JSON.parse(Buffer.concat(partes).toString("utf8")) as unknown, bytes };
  } catch {
    return { corpo: null, bytes };
  }
}

/** O que vai num pedido que escreve: o método e, menos no DELETE, o corpo em JSON. */
interface Envio {
  metodo: "POST" | "PATCH" | "DELETE";
  corpo?: Objeto;
}

/**
 * Um pedido à API com o token (GET, ou o que `envio` disser), com o corpo e o tamanho dele; a
 * resposta de erro vira {@link ErroCalendario} pela falha. O DELETE responde sem corpo: vale o
 * objeto vazio.
 */
async function pedir(
  buscar: typeof fetch,
  url: URL,
  tokenDeAcesso: string,
  envio: Envio | null = null,
): Promise<{ corpo: Objeto; bytes: number }> {
  let resposta: Response;
  try {
    resposta = await buscar(url, {
      method: envio?.metodo ?? "GET",
      headers: {
        authorization: `Bearer ${tokenDeAcesso}`,
        accept: "application/json",
        ...(envio?.corpo ? { "content-type": "application/json" } : {}),
      },
      ...(envio?.corpo ? { body: JSON.stringify(envio.corpo) } : {}),
      signal: AbortSignal.timeout(LIMITE_PEDIDO_MS),
    });
  } catch (erro) {
    const motivo =
      erro instanceof Error && erro.name === "TimeoutError" ? "o Google não respondeu" : "sem rede";
    throw new ErroCalendario("rede", motivo);
  }
  const { corpo, bytes } = await lerCorpo(resposta).catch((erro: unknown) => {
    if (erro instanceof ErroCalendario) throw erro;
    throw new ErroCalendario("rede", "a resposta não chegou inteira");
  });
  if (resposta.ok) {
    if (envio?.metodo === "DELETE") return { corpo: {}, bytes };
    if (!ehObjeto(corpo)) throw new ErroCalendario("rede", "resposta sem forma");
    return { corpo, bytes };
  }
  const status = resposta.status;
  if (status === 410) throw new ErroCalendario("sincronizacao-vencida", "HTTP 410", status);
  if (status === 429 || (status === 403 && razoesDoErro(corpo).some((r) => RAZOES_DE_COTA.includes(r)))) {
    throw new ErroCalendario("cota", `HTTP ${status}`, status);
  }
  if (status === 401) throw new ErroCalendario("acesso", "HTTP 401", status);
  throw new ErroCalendario("recusado", `HTTP ${status}`, status);
}

/** Um calendário da lista da conta (`calendarList`). */
export interface CalendarioLido {
  idExterno: string;
  nome: string;
  cor: string | null;
  /** O principal, cujo id é o e-mail da conta: o único que a Alba lê sem você escolher. */
  principal: boolean;
  /** Se a conta edita os eventos dele (`accessRole` `owner` ou `writer`), com aprovação (F3-25). */
  podeEscrever: boolean;
}

/** Lê uma página da lista de calendários; o que não tem a forma de um calendário fica de fora. */
export async function paginaDeCalendarios(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  pagina: string | null,
): Promise<{ calendarios: CalendarioLido[]; proxima: string | null }> {
  const url = new URL(`${enderecos.calendario}/users/me/calendarList`);
  url.searchParams.set("maxResults", "250");
  if (pagina) url.searchParams.set("pageToken", pagina);
  const { corpo } = await pedir(buscar, url, tokenDeAcesso);
  const itens = Array.isArray(corpo.items) ? corpo.items : [];
  const calendarios: CalendarioLido[] = [];
  for (const item of itens) {
    if (!ehObjeto(item) || item.deleted === true) continue;
    const id = texto(item.id);
    if (!id || id.length > MAXIMO_ID) continue;
    const nome = (texto(item.summaryOverride) ?? texto(item.summary) ?? "").trim() || id;
    calendarios.push({
      idExterno: id,
      nome: nome.slice(0, 200),
      cor: texto(item.backgroundColor)?.slice(0, 32) || null,
      principal: item.primary === true,
      podeEscrever: item.accessRole === "owner" || item.accessRole === "writer",
    });
  }
  return { calendarios, proxima: texto(corpo.nextPageToken) || null };
}

/** De onde a leitura parte: do zero (a partir de `desde`) ou do último `nextSyncToken`. */
export type PontoDeLeitura = { completa: true; desde: string } | { completa: false; sincronizacao: string };

/**
 * Uma página dos eventos de um calendário. A completa pede desde `desde` (o fim do evento depois
 * dele); a incremental só o que mudou desde o token, com as exclusões. As duas pedem a regra do
 * recorrente, não as ocorrências (`singleEvents` falso), e com os mesmos parâmetros, como o Google
 * exige. `sincronizacao` só vem na última página.
 */
export async function paginaDeEventos(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  calendarioId: string,
  ponto: PontoDeLeitura,
  pagina: string | null,
): Promise<{ itens: unknown[]; proxima: string | null; sincronizacao: string | null; bytes: number }> {
  const url = new URL(`${enderecos.calendario}/calendars/${encodeURIComponent(calendarioId)}/events`);
  url.searchParams.set("maxResults", String(EVENTOS_POR_PAGINA));
  if (ponto.completa) url.searchParams.set("timeMin", ponto.desde);
  else url.searchParams.set("syncToken", ponto.sincronizacao);
  if (pagina) url.searchParams.set("pageToken", pagina);
  const { corpo, bytes } = await pedir(buscar, url, tokenDeAcesso);
  return {
    itens: Array.isArray(corpo.items) ? corpo.items : [],
    proxima: texto(corpo.nextPageToken) || null,
    sincronizacao: texto(corpo.nextSyncToken) || null,
    bytes,
  };
}

/**
 * Cria um calendário secundário da conta (o "Moductus") e devolve o id que o Google deu. A
 * `marca` vai na descrição: é por ela que {@link procurarCalendario} o acha de novo.
 */
export async function criarCalendario(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  campos: { nome: string; fuso: string; marca: string },
): Promise<{ idExterno: string }> {
  const url = new URL(`${enderecos.calendario}/calendars`);
  const { corpo } = await pedir(buscar, url, tokenDeAcesso, {
    metodo: "POST",
    corpo: { summary: campos.nome, description: campos.marca, timeZone: campos.fuso },
  });
  const id = texto(corpo.id);
  if (!id || id.length > MAXIMO_ID) throw new ErroCalendario("rede", "o calendário criado veio sem id");
  return { idExterno: id };
}

/** Páginas da lista de calendários que a procura lê: conta nenhuma tem mais que isso. */
const MAXIMO_PAGINAS_DA_LISTA = 20;

/**
 * O calendário da conta com este nome e esta marca na descrição: o que o Moductus criou numa
 * tentativa cuja resposta se perdeu. Um "Moductus" que você criou à mão não tem a marca.
 */
export async function procurarCalendario(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  campos: { nome: string; marca: string },
): Promise<string | null> {
  let pagina: string | null = null;
  for (let n = 0; n < MAXIMO_PAGINAS_DA_LISTA; n++) {
    const url = new URL(`${enderecos.calendario}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pagina) url.searchParams.set("pageToken", pagina);
    const { corpo } = await pedir(buscar, url, tokenDeAcesso);
    for (const item of Array.isArray(corpo.items) ? corpo.items : []) {
      if (!ehObjeto(item) || item.deleted === true) continue;
      const id = texto(item.id);
      if (id && id.length <= MAXIMO_ID && item.summary === campos.nome && item.description === campos.marca)
        return id;
    }
    pagina = texto(corpo.nextPageToken) || null;
    if (pagina === null) return null;
  }
  return null;
}

/** Confere que o calendário existe e é acessível: o 404 (ou o 403) diz que não. */
export async function conferirCalendario(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  calendarioId: string,
): Promise<void> {
  const url = new URL(`${enderecos.calendario}/calendars/${encodeURIComponent(calendarioId)}`);
  await pedir(buscar, url, tokenDeAcesso);
}

/** O que o Google respondeu a uma escrita de evento: o etag novo e se o evento está cancelado. */
export interface EventoEscrito {
  etag: string | null;
  cancelado: boolean;
}

const urlDoEvento = (
  enderecos: Pick<EnderecosGoogle, "calendario">,
  calendarioId: string,
  eventoId: string | null,
) =>
  new URL(
    `${enderecos.calendario}/calendars/${encodeURIComponent(calendarioId)}/events${
      eventoId === null ? "" : `/${encodeURIComponent(eventoId)}`
    }`,
  );

const escrito = (corpo: Objeto): EventoEscrito => ({
  etag: cortar(corpo.etag, 200),
  cancelado: corpo.status === "cancelled",
});

/** `events.insert`. O corpo leva o `id` escolhido aqui: repetir o pedido dá 409, nunca dois eventos. */
export async function inserirEvento(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  calendarioId: string,
  evento: Record<string, unknown>,
): Promise<EventoEscrito> {
  const { corpo } = await pedir(buscar, urlDoEvento(enderecos, calendarioId, null), tokenDeAcesso, {
    metodo: "POST",
    corpo: evento,
  });
  return escrito(corpo);
}

/** `events.patch`: só os campos que vão mudam; o resto do evento (cor, convidados) fica. */
export async function mudarEvento(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  calendarioId: string,
  eventoId: string,
  evento: Record<string, unknown>,
): Promise<EventoEscrito> {
  const { corpo } = await pedir(buscar, urlDoEvento(enderecos, calendarioId, eventoId), tokenDeAcesso, {
    metodo: "PATCH",
    corpo: evento,
  });
  return escrito(corpo);
}

/** `events.delete`. Quem chama decide o que o 404 e o 410 (já apagado) querem dizer. */
export async function apagarEvento(
  buscar: typeof fetch,
  enderecos: Pick<EnderecosGoogle, "calendario">,
  tokenDeAcesso: string,
  calendarioId: string,
  eventoId: string,
): Promise<void> {
  await pedir(buscar, urlDoEvento(enderecos, calendarioId, eventoId), tokenDeAcesso, { metodo: "DELETE" });
}

/** Os campos que se gravam de um evento lido do Google, no formato da tabela `eventos`. */
export interface CamposLidos {
  titulo: string;
  descricao: string | null;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local: string | null;
  recorrencia: string | null;
  excecoes: string[];
  /** O fuso em que a regra anda (o `timeZone` do evento com hora); vazio é o do usuário. */
  fuso: string | null;
}

/** A ocorrência de um recorrente que o Google tirou da regra: o id do recorrente e o início dela. */
export interface ExcecaoLida {
  doRecorrente: string;
  inicioOriginal: string;
}

/**
 * O que um item da lista quer dizer para o cache: um evento para guardar (a ocorrência mudada de
 * lugar também, com a exceção que ela abre no recorrente), ou um que sai (cancelado, recusado por
 * você, local de trabalho), que pode tirar uma ocorrência do recorrente.
 */
export type EventoLido =
  | {
      tipo: "guardar";
      idExterno: string;
      etag: string | null;
      campos: CamposLidos;
      excecao: ExcecaoLida | null;
    }
  | { tipo: "tirar"; idExterno: string; excecao: ExcecaoLida | null };

/** O formato dos instantes do banco: com milissegundos e `Z`, de 0001 a 9999. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATA_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const VALOR_ICAL = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/** O instante em UTC no formato do banco; o que não se lê ou cai fora de 0001 a 9999 volta vazio. */
function emUtc(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return INSTANTE.test(iso) ? iso : null;
}

/** O nome do fuso, se o Node o conhece; o que não conhece volta vazio (vale o do usuário). */
function fusoConhecido(fuso: string | null): string | null {
  if (fuso === null || fuso === "" || fuso.length > MAXIMO_FUSO) return null;
  try {
    return Intl.DateTimeFormat("en-US", { timeZone: fuso }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Um `dateTime` do Google: com deslocamento ou `Z`, direto; sem, no relógio do `timeZone`. */
function instanteDe(dataHora: string, fuso: string): string | null {
  const m = DATA_HORA.exec(dataHora);
  if (m === null || !ehDia(m[1]!)) return null;
  if (m[3] !== undefined) return emUtc(Date.parse(dataHora));
  try {
    return emUtc(instanteNoFuso(m[1]!, m[2]!, fuso).getTime());
  } catch {
    return null;
  }
}

/** Um `start`, `end` ou `originalStartTime`: o dia (`date`) ou o instante (`dateTime`). */
function ponta(v: unknown, fuso: string): { diaInteiro: boolean; valor: string } | null {
  if (!ehObjeto(v)) return null;
  const dia = texto(v.date);
  if (dia !== null) return ehDia(dia) ? { diaInteiro: true, valor: dia } : null;
  const dataHora = texto(v.dateTime);
  if (dataHora === null) return null;
  const valor = instanteDe(dataHora, texto(v.timeZone) ?? fuso);
  return valor === null ? null : { diaInteiro: false, valor };
}

/**
 * Os inícios de uma linha `EXDATE` (`EXDATE;TZID=America/Sao_Paulo:20261020T090000,...`,
 * `EXDATE;VALUE=DATE:20261020`, `EXDATE:20261020T120000Z`) no formato do início do evento.
 */
function lerExdate(linha: string, diaInteiro: boolean, fuso: string): string[] {
  if (linha.length > MAXIMO_LINHA_EXDATE) return [];
  const doisPontos = linha.indexOf(":");
  if (doisPontos < 0) return [];
  const parametros = linha.slice(0, doisPontos).split(";").slice(1);
  const tzid = parametros.find((p) => /^TZID=/i.test(p))?.slice(5) ?? fuso;
  const inicios: string[] = [];
  for (const valor of linha.slice(doisPontos + 1).split(",", MAXIMO_DATAS_POR_EXDATE)) {
    const m = VALOR_ICAL.exec(valor.trim());
    if (m === null) continue;
    const dia = `${m[1]}-${m[2]}-${m[3]}`;
    if (!ehDia(dia)) continue;
    if (diaInteiro) {
      inicios.push(dia);
      continue;
    }
    if (m[4] === undefined) continue;
    const hora = `${m[4]}:${m[5]}:${m[6]}`;
    const inicio = m[7] === "Z" ? emUtc(Date.parse(`${dia}T${hora}Z`)) : instanteDe(`${dia}T${hora}`, tzid);
    if (inicio !== null) inicios.push(inicio);
  }
  return inicios;
}

/**
 * A regra do recorrente (`recurrence`): uma RRULE só fica como o Moductus guarda (sem o
 * `RRULE:`), e os `EXDATE` viram exceções. RDATE, EXRULE ou mais de uma regra ficam como vieram,
 * uma por linha: o Moductus não as expande e mostra "repete (definido no Google)". O que passa do
 * tamanho do contrato é cortado com "…", que nenhuma regra entendida tem.
 */
function lerRegra(
  recorrencia: unknown,
  diaInteiro: boolean,
  fuso: string,
): { recorrencia: string | null; excecoes: string[] } {
  if (!Array.isArray(recorrencia)) return { recorrencia: null, excecoes: [] };
  const linhas = recorrencia.flatMap((l) => (typeof l === "string" && l.trim() ? [l.trim()] : []));
  const excecoes = linhas
    .filter((l) => /^EXDATE[;:]/i.test(l))
    .flatMap((l) => lerExdate(l, diaInteiro, fuso));
  const regras = linhas.filter((l) => !/^EXDATE[;:]/i.test(l));
  if (regras.length === 0) return { recorrencia: null, excecoes: [] };
  const regra = regras.length === 1 && /^RRULE:/i.test(regras[0]!) ? regras[0]!.slice(6) : regras.join("\n");
  return {
    recorrencia: regra.length > MAXIMO_REGRA ? `${regra.slice(0, MAXIMO_REGRA - 1)}…` : regra,
    excecoes: [...new Set(excecoes)],
  };
}

const cortar = (v: unknown, maximo: number): string | null => {
  const t = texto(v);
  return t === null || t === "" ? null : t.slice(0, maximo);
};

/** Se você recusou o convite: o Google mostra riscado, e o horário fica livre. */
function recusadoPorVoce(item: Objeto): boolean {
  return (
    Array.isArray(item.attendees) &&
    item.attendees.some((a) => ehObjeto(a) && a.self === true && a.responseStatus === "declined")
  );
}

/**
 * Um item de `events.list` no que o cache faz com ele. `fuso` vale para a data e hora sem fuso
 * nenhum (o Google manda o do evento; sem ele, o do usuário). Item sem a forma de um evento volta
 * `null` e é ignorado: um evento estranho não derruba a leitura do resto.
 */
export function lerEvento(item: unknown, fuso: string): EventoLido | null {
  if (!ehObjeto(item)) return null;
  const idExterno = texto(item.id);
  if (!idExterno || idExterno.length > MAXIMO_ID) return null;
  const fusoDeLa = fusoConhecido(ehObjeto(item.start) ? texto(item.start.timeZone) : null);
  const fusoDoEvento = fusoDeLa ?? fuso;
  const recorrenteId = texto(item.recurringEventId);
  const doRecorrente = recorrenteId && recorrenteId.length <= MAXIMO_ID ? recorrenteId : null;
  const original = doRecorrente ? ponta(item.originalStartTime, fusoDoEvento) : null;
  const excecao = doRecorrente && original ? { doRecorrente, inicioOriginal: original.valor } : null;

  if (item.status === "cancelled" || item.eventType === "workingLocation" || recusadoPorVoce(item)) {
    return { tipo: "tirar", idExterno, excecao };
  }
  const inicio = ponta(item.start, fusoDoEvento);
  const fim = ponta(item.end, fusoDoEvento);
  if (inicio === null || fim === null || inicio.diaInteiro !== fim.diaInteiro) return null;
  let fimValido = fim.valor;
  if (inicio.diaInteiro && fim.valor <= inicio.valor) {
    // Dia inteiro termina no dia seguinte ao último; o que vier sem isso dura um dia.
    try {
      fimValido = somarDias(inicio.valor, 1);
    } catch {
      return null;
    }
  }
  if (!inicio.diaInteiro && Date.parse(fim.valor) < Date.parse(inicio.valor)) fimValido = inicio.valor;
  // A ocorrência mudada de lugar é um evento à parte: a regra é a do recorrente, não dela.
  const regra = doRecorrente
    ? { recorrencia: null, excecoes: [] }
    : lerRegra(item.recurrence, inicio.diaInteiro, fusoDoEvento);
  return {
    tipo: "guardar",
    idExterno,
    etag: cortar(item.etag, 200),
    excecao,
    campos: {
      titulo: (texto(item.summary) ?? "").slice(0, MAXIMO_TITULO),
      descricao: cortar(item.description, MAXIMO_DESCRICAO),
      inicio: inicio.valor,
      fim: fimValido,
      diaInteiro: inicio.diaInteiro,
      local: cortar(item.location, MAXIMO_LOCAL),
      recorrencia: regra.recorrencia,
      excecoes: regra.excecoes,
      fuso: inicio.diaInteiro ? null : fusoDeLa,
    },
  };
}
