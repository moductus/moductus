import { MENSAGEM_EVENTO_NAO_ENCONTRADO, MENSAGEM_REGRA_DE_FORA } from "../../areas/agenda/agenda.ts";
import { lerRecorrencia } from "../../areas/dia/recorrencia.ts";
import { ENDERECOS_GOOGLE, type EnderecosGoogle } from "./cliente.ts";
import { ErroCalendario, inserirEvento, mudarEvento } from "./calendario.ts";
import { novoIdExterno } from "./espelho.ts";
import { AVISO_DESLIGADA, AVISO_RECONECTAR, type ServicoGoogleAgenda } from "./google-agenda.ts";
import type { EventoDoCache, LinhaCalendarioGoogle, RepositorioLeituraGoogle } from "./leitura.ts";

/**
 * Criar e mudar evento nos outros calendários do Google (F3-25; AGENTS.md §2 Alba, §4): o de
 * trabalho, o da família, nunca o "Moductus" nem o local, que a Alba escreve sem pedir. Quem chama
 * é a ferramenta `externo`, depois do sim do cartão; aqui só a conferência do alvo, a permissão
 * (`calendar.events`, pedida no navegador na primeira vez, ADR-0031) e o pedido à Calendar API. O
 * que foi escrito volta ao cache pela leitura, que é chamada logo depois. Não há desfazer: o que
 * saiu do Moductus não volta por uma função daqui.
 */

export const MENSAGEM_NAO_E_DE_FORA =
  'calendário do Google não encontrado; no local e no "Moductus", use agenda.criar_evento e agenda.mudar_evento';
export const mensagemSoVer = (nome: string) =>
  `você só pode ver o calendário "${nome}" no Google, não editar`;
export const MENSAGEM_REPETE_NO_GOOGLE =
  "o horário de um evento que se repete muda pelo Google Agenda, onde dá para escolher quais repetições";
export const MENSAGEM_MUDOU_DESDE_O_CARTAO = "o evento mudou no Google desde o cartão; peça de novo";
export const MENSAGEM_NADA_A_MUDAR =
  "nada para mudar: diga o título, o quando, a descrição, o local ou os alertas";
export const MENSAGEM_COTA =
  "o Google pediu para esperar (limite de uso); nada foi escrito, tente daqui a pouco";
export const MENSAGEM_SEM_PERMISSAO_NO_GOOGLE = "o Google não deixou escrever neste calendário";
export const mensagemSumiu = (alvo: "calendário" | "evento") => `o ${alvo} não existe mais no Google`;
export const mensagemSemRede = (motivo: string) => `não consegui falar com o Google (${motivo})`;
export const mensagemRecusa = (motivo: string) => `o Google recusou o pedido (${motivo})`;

/** Início e fim como no banco: instantes UTC no evento com hora, dias no de dia inteiro. */
export interface QuandoNoGoogle {
  inicio: string;
  fim: string;
  diaInteiro: boolean;
}

export interface NovoNoGoogle extends QuandoNoGoogle {
  titulo: string;
  descricao: string | null;
  local: string | null;
  /** RRULE sem o `RRULE:`; só a que o Moductus sabe repetir, para a agenda mostrar igual ao Google. */
  recorrencia: string | null;
  /** Minutos antes de cada aviso; `null` deixa os do calendário. */
  alertas: number[] | null;
}

/** Só o que vier muda; o resto do evento (convidados, cor) fica como está lá. */
export interface MudancaNoGoogle {
  titulo?: string;
  quando?: QuandoNoGoogle;
  descricao?: string | null;
  local?: string | null;
  alertas?: number[];
}

/** O evento como ficou no Google, pelo que foi mandado. */
export interface EventoNoGoogle extends QuandoNoGoogle {
  calendarioId: string;
  calendario: string;
  idExterno: string;
  titulo: string;
}

/** O evento do cache que vai mudar e o calendário dele. */
export interface AlvoNoGoogle {
  evento: EventoDoCache;
  calendario: LinhaCalendarioGoogle;
}

export interface DependenciasEscrita {
  google: Pick<
    ServicoGoogleAgenda,
    "conexao" | "tokenDeAcesso" | "acessoRecusado" | "escreveNosOutros" | "permitirEscrita"
  >;
  repo: Pick<RepositorioLeituraGoogle, "calendario" | "evento">;
  /** O fuso de `config`: é onde a regra do recorrente anda no Google. */
  lerFuso: () => string;
  /** Escreveu: a leitura traz o evento para o cache. */
  aoEscrever: () => void;
  enderecos?: Pick<EnderecosGoogle, "calendario">;
  buscar?: typeof fetch;
  gerarIdExterno?: () => string;
}

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

/** Uma ponta do evento como a Calendar API pede; ao mudar, o outro formato é limpo. */
function ponta(valor: string, diaInteiro: boolean, fuso: string, limpar: boolean): Record<string, unknown> {
  if (diaInteiro) return limpar ? { date: valor, dateTime: null, timeZone: null } : { date: valor };
  return limpar ? { dateTime: valor, timeZone: fuso, date: null } : { dateTime: valor, timeZone: fuso };
}

const avisos = (alertas: readonly number[]) => ({
  useDefault: false,
  overrides: alertas.map((minutes) => ({ method: "popup", minutes })),
});

/** O corpo do `events.insert`; o id escolhido aqui faz a repetição do pedido dar 409, nunca dois eventos. */
export function corpoDoNovo(novo: NovoNoGoogle, idExterno: string, fuso: string): Record<string, unknown> {
  return {
    id: idExterno,
    summary: novo.titulo,
    ...(novo.descricao !== null ? { description: novo.descricao } : {}),
    ...(novo.local !== null ? { location: novo.local } : {}),
    start: ponta(novo.inicio, novo.diaInteiro, fuso, false),
    end: ponta(novo.fim, novo.diaInteiro, fuso, false),
    ...(novo.recorrencia !== null ? { recurrence: [`RRULE:${novo.recorrencia}`] } : {}),
    reminders: novo.alertas === null ? { useDefault: true } : avisos(novo.alertas),
  };
}

/** O corpo do `events.patch`: só os campos que mudam. */
export function corpoDaMudanca(m: MudancaNoGoogle, fuso: string): Record<string, unknown> {
  return {
    ...(m.titulo !== undefined ? { summary: m.titulo } : {}),
    ...(m.descricao !== undefined ? { description: m.descricao ?? "" } : {}),
    ...(m.local !== undefined ? { location: m.local ?? "" } : {}),
    ...(m.quando !== undefined
      ? {
          start: ponta(m.quando.inicio, m.quando.diaInteiro, fuso, true),
          end: ponta(m.quando.fim, m.quando.diaInteiro, fuso, true),
        }
      : {}),
    ...(m.alertas !== undefined ? { reminders: avisos(m.alertas) } : {}),
  };
}

const vazia = (m: MudancaNoGoogle) =>
  m.titulo === undefined &&
  m.quando === undefined &&
  m.descricao === undefined &&
  m.local === undefined &&
  m.alertas === undefined;

/** O erro da Calendar API na voz da Alba; o token nunca aparece. */
function motivoDoGoogle(erro: unknown, alvo: "calendário" | "evento"): Error {
  if (!(erro instanceof ErroCalendario)) return erro instanceof Error ? erro : new Error(String(erro));
  if (erro.falha === "cota") return new Error(MENSAGEM_COTA);
  if (erro.falha === "acesso") return new Error(AVISO_RECONECTAR);
  if (erro.status === 404 || erro.status === 410) return new Error(mensagemSumiu(alvo));
  if (erro.status === 403) return new Error(MENSAGEM_SEM_PERMISSAO_NO_GOOGLE);
  if (erro.falha === "rede") return new Error(mensagemSemRede(erro.message));
  return new Error(mensagemRecusa(erro.message));
}

export class EscritaGoogleAgenda {
  private readonly enderecos: Pick<EnderecosGoogle, "calendario">;
  private readonly buscar: typeof fetch;
  private readonly gerarIdExterno: () => string;

  constructor(private readonly deps: DependenciasEscrita) {
    this.enderecos = deps.enderecos ?? ENDERECOS_GOOGLE;
    this.buscar = deps.buscar ?? fetch;
    this.gerarIdExterno = deps.gerarIdExterno ?? novoIdExterno;
  }

  /** Se o Google ainda vai pedir a permissão de editar eventos no navegador: o cartão avisa. */
  pedePermissao(): boolean {
    return !this.deps.google.escreveNosOutros();
  }

  /** O calendário de fora em que dá para criar; lança o motivo quando não dá. */
  calendarioParaEscrever(id: string): LinhaCalendarioGoogle {
    if (this.deps.google.conexao().estado === "desligada") throw new Error(AVISO_DESLIGADA);
    const calendario = this.deps.repo.calendario(id);
    if (!calendario || calendario.espelho === 1) throw new Error(MENSAGEM_NAO_E_DE_FORA);
    if (calendario.pode_escrever !== 1) throw new Error(mensagemSoVer(calendario.nome));
    return calendario;
  }

  /** O evento de um calendário de fora que dá para mudar, com o calendário. */
  alvo(eventoId: string): AlvoNoGoogle {
    if (this.deps.google.conexao().estado === "desligada") throw new Error(AVISO_DESLIGADA);
    const evento = this.deps.repo.evento(eventoId);
    if (!evento) throw new Error(MENSAGEM_EVENTO_NAO_ENCONTRADO);
    // Primeiro o calendário: o evento do local e o do "Moductus" têm o caminho deles, sem cartão.
    const calendario = this.deps.repo.calendario(evento.calendario_id);
    if (!calendario || calendario.espelho === 1) throw new Error(MENSAGEM_NAO_E_DE_FORA);
    if (calendario.pode_escrever !== 1) throw new Error(mensagemSoVer(calendario.nome));
    if (evento.id_externo === null) throw new Error(MENSAGEM_EVENTO_NAO_ENCONTRADO);
    return { evento, calendario };
  }

  /** Tudo o que se confere antes do cartão, e de novo antes de escrever. */
  conferirNovo(calendarioId: string, novo: Pick<NovoNoGoogle, "recorrencia">): LinhaCalendarioGoogle {
    const calendario = this.calendarioParaEscrever(calendarioId);
    if (novo.recorrencia !== null) {
      const leitura = lerRecorrencia(novo.recorrencia);
      if (!leitura.entendida) throw new Error(MENSAGEM_REGRA_DE_FORA(leitura.motivo));
    }
    return calendario;
  }

  /**
   * Com `vistos` (o início e o fim que o cartão mostrou), recusa o evento que mudou desde então: o
   * sim foi dado para o evento como estava.
   */
  conferirMudanca(
    eventoId: string,
    mudanca: MudancaNoGoogle,
    vistos?: { inicio: string; fim: string },
  ): AlvoNoGoogle {
    const alvo = this.alvo(eventoId);
    if (vistos && (alvo.evento.inicio !== vistos.inicio || alvo.evento.fim !== vistos.fim))
      throw new Error(MENSAGEM_MUDOU_DESDE_O_CARTAO);
    if (vazia(mudanca)) throw new Error(MENSAGEM_NADA_A_MUDAR);
    // Mexer no início do recorrente leva a série inteira junto; pelo Google dá para escolher.
    if (mudanca.quando !== undefined && alvo.evento.recorrencia !== null)
      throw new Error(MENSAGEM_REPETE_NO_GOOGLE);
    return alvo;
  }

  /** Cria o evento; na primeira vez, o Google pede antes a permissão no navegador. */
  async criar(calendarioId: string, novo: NovoNoGoogle): Promise<EventoNoGoogle> {
    this.conferirNovo(calendarioId, novo);
    await this.deps.google.permitirEscrita();
    // O navegador pode ter ficado aberto um tempo: o calendário confere de novo.
    const calendario = this.conferirNovo(calendarioId, novo);
    const idExterno = this.gerarIdExterno();
    const corpo = corpoDoNovo(novo, idExterno, this.deps.lerFuso());
    try {
      await this.comAcesso((token) =>
        inserirEvento(this.buscar, this.enderecos, token, calendario.id_externo, corpo),
      );
    } catch (erro) {
      console.error(`google: criar evento num calendário de fora falhou: ${mensagem(erro)}`);
      throw motivoDoGoogle(erro, "calendário");
    }
    this.deps.aoEscrever();
    return {
      calendarioId: calendario.id,
      calendario: calendario.nome,
      idExterno,
      titulo: novo.titulo,
      inicio: novo.inicio,
      fim: novo.fim,
      diaInteiro: novo.diaInteiro,
    };
  }

  /** Muda o evento lá e devolve como ficou e como estava. */
  async mudar(
    eventoId: string,
    mudanca: MudancaNoGoogle,
    vistos?: { inicio: string; fim: string },
  ): Promise<{
    evento: EventoNoGoogle;
    antes: Omit<EventoNoGoogle, "calendarioId" | "calendario" | "idExterno">;
  }> {
    this.conferirMudanca(eventoId, mudanca, vistos);
    await this.deps.google.permitirEscrita();
    const { evento, calendario } = this.conferirMudanca(eventoId, mudanca, vistos);
    const idExterno = evento.id_externo!;
    const corpo = corpoDaMudanca(mudanca, this.deps.lerFuso());
    try {
      await this.comAcesso((token) =>
        mudarEvento(this.buscar, this.enderecos, token, calendario.id_externo, idExterno, corpo),
      );
    } catch (erro) {
      console.error(`google: mudar evento num calendário de fora falhou: ${mensagem(erro)}`);
      throw motivoDoGoogle(erro, "evento");
    }
    this.deps.aoEscrever();
    const antes = {
      titulo: evento.titulo,
      inicio: evento.inicio,
      fim: evento.fim,
      diaInteiro: evento.dia_inteiro === 1,
    };
    return {
      evento: {
        calendarioId: calendario.id,
        calendario: calendario.nome,
        idExterno,
        titulo: mudanca.titulo ?? antes.titulo,
        ...(mudanca.quando ?? { inicio: antes.inicio, fim: antes.fim, diaInteiro: antes.diaInteiro }),
      },
      antes,
    };
  }

  /** Um pedido com o token: o 401 renova uma vez e repete, porque nada foi escrito. */
  private async comAcesso<T>(fazer: (token: string) => Promise<T>): Promise<T> {
    const token = await this.deps.google.tokenDeAcesso();
    try {
      return await fazer(token);
    } catch (erro) {
      if (!(erro instanceof ErroCalendario && erro.falha === "acesso")) throw erro;
      this.deps.google.acessoRecusado(token);
      return fazer(await this.deps.google.tokenDeAcesso());
    }
  }
}
