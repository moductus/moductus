import {
  Alertas,
  HoraDoDia,
  Id,
  PedidoAgenda,
  PedidoAplicarSugestao,
  Recorrencia,
  type EventoAgenda,
} from "@moductus/contrato";
import { z } from "zod";
import {
  FERRAMENTA_APLICAR_SUGESTAO,
  type CamposEvento,
  type ServicoAgenda,
} from "../../areas/agenda/agenda.ts";
import { descreverRegra, lerRecorrencia } from "../../areas/dia/recorrencia.ts";
import { diaDaSemana, somarDias, type TempoDoDia } from "../../areas/dia/tempo.ts";
import type {
  EscritaGoogleAgenda,
  MudancaNoGoogle,
  NovoNoGoogle,
  QuandoNoGoogle,
} from "../../conexoes/google/escrita.ts";
import { DiaDaFerramenta, resolverDia } from "../dia.ts";
import { carimboDe, ferramenta, type Ferramenta, type TextoCartao } from "../ferramenta.ts";

/** Quem chama a ferramenta do encaixe pelo nome, sem o clique, ouve isto. */
export const MENSAGEM_SO_PELO_CLIQUE = "o encaixe da Alba só se aplica com o clique na agenda";

export const MENSAGEM_SO_LOCAL_E_MODUCTUS =
  'por aqui só se escreve no calendário local e no "Moductus"; nos outros do Google, use agenda.criar_evento_em ou agenda.mudar_evento_em, que pedem a aprovação do usuário';

/** Criar e mudar nos outros calendários, resolvidos antes do cartão (`conferir`). */
interface CriarResolvido {
  calendarioId: string;
  novo: NovoNoGoogle;
}
interface MudarResolvido {
  id: string;
  mudanca: MudancaNoGoogle;
  vistos: { inicio: string; fim: string };
}

/** A regra em frase ("toda segunda e quarta, até 30/11/2026"); a que o Moductus não entende, como veio. */
const repeticaoLegivel = (regra: string) => {
  const leitura = lerRecorrencia(regra);
  return leitura.entendida ? descreverRegra(leitura.regra) : regra;
};

/** A escrita nos outros calendários do Google (F3-25), como as ferramentas `externo` a usam. */
export type EscritaNosOutros = Pick<
  EscritaGoogleAgenda,
  "pedePermissao" | "alvo" | "conferirNovo" | "conferirMudanca" | "criar" | "mudar"
>;

/** Uma hora de evento quando o modelo não diz quanto dura. */
export const DURACAO_PADRAO_MIN = 60;

export const MENSAGEM_DIA_INTEIRO_COM_HORA = "evento de dia inteiro não leva hora";

/**
 * Quando um evento acontece, como o modelo manda: o dia e, no evento com hora, a hora e quanto dura,
 * no fuso do usuário. A conta do instante é do serviço (ADR-0008). Ao mudar, o que não vem fica como
 * o evento já era: trocar só o dia mantém a hora e a duração, e o evento com hora só vira de dia
 * inteiro com `diaInteiro: true`.
 */
const Quando = z.object({
  dia: DiaDaFerramenta,
  hora: HoraDoDia.optional().describe(
    "A hora de começo, HH:MM. Ao criar, sem ela o evento é de dia inteiro; ao mudar, sem ela fica a hora que era",
  ),
  duracaoMin: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe(`Quanto dura, em minutos; ao criar, padrão ${DURACAO_PADRAO_MIN}; ao mudar, fica a que era`),
  diaInteiro: z.boolean().optional().describe("true para o evento ocupar o dia inteiro, sem hora"),
});

/** A hora e a duração do evento com hora, para o `quando` que muda só o dia. */
interface HorarioAtual {
  hora: string;
  duracaoMin: number;
}

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** O que vai entre aspas no cartão: o título ou o nome, cortado se for longo demais para ler. */
const citar = (texto: string, maximo = 80) =>
  `"${texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto}"`;

/** "quinta, 22/10/2026, das 15:00 às 16:00"; "quinta, 22/10/2026, o dia inteiro". */
export function quandoLegivel(q: QuandoNoGoogle, tempo: TempoDoDia): string {
  const data = (dia: string) =>
    `${DIAS_DA_SEMANA[diaDaSemana(dia)]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
  if (q.diaInteiro) {
    const ultimo = somarDias(q.fim, -1);
    return ultimo === q.inicio
      ? `${data(q.inicio)}, o dia inteiro`
      : `de ${data(q.inicio)} a ${data(ultimo)}, o dia inteiro`;
  }
  const inicio = new Date(q.inicio);
  const fim = new Date(q.fim);
  const [diaInicio, diaFim] = [tempo.diaDe(inicio), tempo.diaDe(fim)];
  if (diaInicio === diaFim) return `${data(diaInicio)}, das ${tempo.horaDe(inicio)} às ${tempo.horaDe(fim)}`;
  return `de ${data(diaInicio)}, ${tempo.horaDe(inicio)}, a ${data(diaFim)}, ${tempo.horaDe(fim)}`;
}

/** "10 e 30 min antes", "na hora". */
function alertasLegiveis(alertas: readonly number[]): string {
  if (alertas.length === 0) return "sem aviso";
  const minutos = [...alertas].sort((a, b) => a - b).map((m) => (m === 0 ? "na hora" : `${m} min antes`));
  return minutos.length === 1 ? minutos[0]! : `${minutos.slice(0, -1).join(", ")} e ${minutos.at(-1)!}`;
}

const AVISO_SEM_DESFAZER = "não se desfaz por aqui";
const AVISO_PERMISSAO = "na primeira vez, o Google pede no navegador a permissão de editar eventos";

/** O fim da primeira frase do cartão: o que não volta e, se for o caso, o navegador que vai abrir. */
const ressalvas = (pede: boolean) =>
  pede ? `${AVISO_SEM_DESFAZER}; ${AVISO_PERMISSAO}` : AVISO_SEM_DESFAZER;

/** Os detalhes que vão depois do resumo, um por linha. */
const detalhes = (linhas: (string | null)[]) => {
  const ditas = linhas.filter((l): l is string => l !== null);
  return ditas.length === 0 ? "" : `\n\n${ditas.join("\n")}`;
};

const campos = {
  titulo: z.string().trim().min(1).max(500).describe("O nome do compromisso"),
  descricao: z.string().max(10_000).nullable().describe("Detalhes"),
  local: z.string().max(500).nullable().describe("Onde"),
  alertas: Alertas.describe("Minutos antes de cada aviso, até 5"),
};

/** Criar num calendário de fora do Google (F3-25): o calendário é obrigatório. */
const EntradaCriarEm = z.object({
  calendarioId: Id.describe('O calendário do Google, de agenda.calendarios; não o local nem o "Moductus"'),
  titulo: campos.titulo,
  quando: Quando,
  descricao: campos.descricao.optional(),
  local: campos.local.optional(),
  recorrencia: Recorrencia.optional().describe("Regra RRULE do iCalendar, como FREQ=WEEKLY;BYDAY=MO"),
  alertas: campos.alertas
    .optional()
    .describe("Minutos antes de cada aviso, até 5; sem eles, valem os do calendário"),
});

/** Mudar num calendário de fora: só o que vier muda; a regra de repetição fica como está lá. */
const EntradaMudarEm = z.object({
  id: Id.describe('O evento, de um calendário do Google que não é o "Moductus"'),
  titulo: campos.titulo.optional(),
  quando: Quando.optional(),
  descricao: campos.descricao.optional(),
  local: campos.local.optional(),
  alertas: campos.alertas.optional(),
});

/** O que a inversa lê do valor gravado: o evento como a chamada o deixou e, ao mudar, como era. */
const EventoGravado = z.object({ id: z.string(), atualizadoEm: z.string() });
const CamposGravados = z.object({
  titulo: z.string(),
  descricao: z.string().nullable(),
  inicio: z.string(),
  fim: z.string(),
  diaInteiro: z.boolean(),
  local: z.string().nullable(),
  recorrencia: z.string().nullable(),
  alertas: z.array(z.number()),
});

/**
 * As ferramentas `agenda.*` da Alba (AGENTS.md §2): ler os calendários, o dia com os blocos livres e
 * um evento; criar e mudar evento no calendário local e no "Moductus", como `interno` com desfazer
 * (ADR-0029). Mudar nos outros calendários é `externo`, com cartão (F3-25). O encaixe aplicado
 * (`agenda.aplicar_sugestao`) existe só para o desfazer do histórico achar a inversa: nenhum agente o
 * vê, porque a Alba sugere e quem aplica é você ("Lota a agenda sem perguntar" está no "Nunca").
 */
export function ferramentasAgenda(
  agenda: ServicoAgenda,
  tempo: TempoDoDia,
  outros: EscritaNosOutros,
): Ferramenta[] {
  /** Início e fim do evento: instantes no evento com hora, dias no de dia inteiro. */
  const pontas = (q: z.infer<typeof Quando>, atual: HorarioAtual | null = null) => {
    const dia = resolverDia(tempo, q.dia);
    if (q.diaInteiro === true && q.hora !== undefined) throw new Error(MENSAGEM_DIA_INTEIRO_COM_HORA);
    const hora = q.diaInteiro === true ? undefined : (q.hora ?? atual?.hora);
    if (hora === undefined) return { inicio: dia, fim: somarDias(dia, 1), diaInteiro: true };
    const inicio = tempo.instante(dia, hora);
    const minutos = q.duracaoMin ?? atual?.duracaoMin ?? DURACAO_PADRAO_MIN;
    const fim = new Date(inicio.getTime() + minutos * 60_000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString(), diaInteiro: false };
  };

  /** A hora e a duração de agora, no fuso do usuário; o de dia inteiro não tem. */
  const horarioDe = (e: Pick<EventoAgenda, "diaInteiro" | "inicio" | "fim">): HorarioAtual | null =>
    e.diaInteiro
      ? null
      : {
          hora: tempo.horaDe(new Date(e.inicio)),
          duracaoMin: Math.round((Date.parse(e.fim) - Date.parse(e.inicio)) / 60_000),
        };

  /** O evento novo de um calendário de fora, com o quando já em instantes ou dias. */
  const novoNoGoogle = (e: z.infer<typeof EntradaCriarEm>): NovoNoGoogle => ({
    titulo: e.titulo,
    ...pontas(e.quando),
    descricao: e.descricao ?? null,
    local: e.local ?? null,
    recorrencia: e.recorrencia?.trim() ?? null,
    alertas: e.alertas ?? null,
  });

  /**
   * Criar resolvido antes do cartão: o calendário conferido e o quando em instantes ou dias. É o que
   * o cartão mostra e o que roda com o sim.
   */
  const resolverCriar = (e: z.infer<typeof EntradaCriarEm>): CriarResolvido => {
    const novo = novoNoGoogle(e);
    outros.conferirNovo(e.calendarioId, novo);
    return { calendarioId: e.calendarioId, novo };
  };

  /**
   * Mudar resolvido antes do cartão: o quando pela metade completa com o horário que o evento tem, e
   * o início e o fim que o cartão viu vão junto, para o sim não valer para um evento que já mudou.
   */
  const resolverMudar = (e: z.infer<typeof EntradaMudarEm>): MudarResolvido => {
    const { evento } = outros.alvo(e.id);
    const atual = { diaInteiro: evento.dia_inteiro === 1, inicio: evento.inicio, fim: evento.fim };
    const mudanca: MudancaNoGoogle = {
      ...(e.titulo !== undefined ? { titulo: e.titulo } : {}),
      ...(e.quando !== undefined ? { quando: pontas(e.quando, horarioDe(atual)) } : {}),
      ...(e.descricao !== undefined ? { descricao: e.descricao } : {}),
      ...(e.local !== undefined ? { local: e.local } : {}),
      ...(e.alertas !== undefined ? { alertas: e.alertas } : {}),
    };
    const vistos = { inicio: evento.inicio, fim: evento.fim };
    outros.conferirMudanca(e.id, mudanca, vistos);
    return { id: e.id, mudanca, vistos };
  };

  const cartaoDeCriar = ({ calendarioId, novo }: CriarResolvido): TextoCartao => {
    const calendario = outros.conferirNovo(calendarioId, novo);
    return {
      descricao: `Vou criar ${citar(novo.titulo)} no calendário ${citar(calendario.nome, 60)} do Google, ${quandoLegivel(novo, tempo)}; ${ressalvas(outros.pedePermissao())}.${detalhes(
        [
          novo.local !== null ? `Local: ${novo.local}` : null,
          novo.recorrencia !== null ? `Repete: ${repeticaoLegivel(novo.recorrencia)}` : null,
          novo.alertas !== null ? `Avisos: ${alertasLegiveis(novo.alertas)}` : null,
          novo.descricao !== null ? `Descrição: ${citar(novo.descricao, 300)}` : null,
        ],
      )}`,
      rotulo: `Criar em ${calendario.nome.length > 30 ? `${calendario.nome.slice(0, 29)}…` : calendario.nome}`,
      rotuloRecusar: "Não criar",
      desfazivel: false,
    };
  };

  const cartaoDeMudar = ({ id, mudanca, vistos }: MudarResolvido): TextoCartao => {
    const { evento, calendario } = outros.conferirMudanca(id, mudanca, vistos);
    const atual = { diaInteiro: evento.dia_inteiro === 1, inicio: evento.inicio, fim: evento.fim };
    const recorrente = evento.recorrencia !== null;
    const mudancas = [
      mudanca.titulo !== undefined ? `o título vira ${citar(mudanca.titulo)}` : null,
      mudanca.quando !== undefined
        ? `passa de ${quandoLegivel(atual, tempo)} para ${quandoLegivel(mudanca.quando, tempo)}`
        : null,
      mudanca.local === undefined
        ? null
        : mudanca.local === null
          ? "o local sai"
          : `o local vira ${citar(mudanca.local)}`,
      mudanca.descricao === undefined
        ? null
        : mudanca.descricao === null
          ? "a descrição sai"
          : "a descrição muda",
      mudanca.alertas === undefined
        ? null
        : mudanca.alertas.length === 0
          ? "fica sem aviso"
          : `os avisos ficam ${alertasLegiveis(mudanca.alertas)}`,
    ].filter((m): m is string => m !== null);
    // Sem mudar o quando, o quando de agora diz qual é o evento; o recorrente, que repete.
    const qual = recorrente
      ? ", em todas as repetições,"
      : mudanca.quando === undefined
        ? ` (${quandoLegivel(atual, tempo)})`
        : "";
    const ressalva = ressalvas(outros.pedePermissao());
    return {
      descricao: `Vou mudar ${citar(evento.titulo)}${qual} no calendário ${citar(calendario.nome, 60)} do Google: ${mudancas.join("; ")}. ${ressalva.charAt(0).toUpperCase()}${ressalva.slice(1)}.${detalhes(
        [mudanca.descricao ? `Descrição: ${citar(mudanca.descricao, 300)}` : null],
      )}`,
      rotulo: `Mudar em ${calendario.nome.length > 30 ? `${calendario.nome.slice(0, 29)}…` : calendario.nome}`,
      rotuloRecusar: "Não mudar",
      desfazivel: false,
    };
  };

  const exigirEditavel = (calendarioId: string) => {
    const calendario = agenda.calendarios().find((c) => c.id === calendarioId);
    if (calendario && calendario.fonte !== "local" && !calendario.espelho) {
      throw new Error(MENSAGEM_SO_LOCAL_E_MODUCTUS);
    }
  };

  return [
    ferramenta({
      nome: FERRAMENTA_APLICAR_SUGESTAO,
      descricao: "Aplica o encaixe de uma tarefa num bloco livre da agenda, como evento do calendário local.",
      entrada: PedidoAplicarSugestao,
      efeito: "interno",
      soPelaInterface: true,
      executar: () => {
        throw new Error(MENSAGEM_SO_PELO_CLIQUE);
      },
      desfazer: (resultado, ctx) => agenda.desfazerSugestao(resultado, ctx),
    }),
    ferramenta({
      nome: "agenda.calendarios",
      descricao:
        'Os calendários que o Moductus conhece: o local, o "Moductus" (o espelho no Google, que avisa no celular) e os outros do Google, com quais a Alba lê e em quais escreve.',
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => agenda.calendarios(),
    }),
    ferramenta({
      nome: "agenda.consultar",
      descricao:
        "A agenda de um intervalo de dias (até 62), no fuso do usuário: os compromissos de todos os calendários lidos e, em cada dia, os blocos livres no expediente, quanto as tarefas do dia estimam e se o dia está cheio. Traz também a data de hoje.",
      entrada: z.object({
        de: DiaDaFerramenta.describe("O primeiro dia: hoje, amanha ou AAAA-MM-DD"),
        ate: DiaDaFerramenta.describe("O último dia, inclusive"),
      }),
      efeito: "leitura",
      executar: ({ de, ate }) => {
        const pedido = PedidoAgenda.parse({ de: resolverDia(tempo, de), ate: resolverDia(tempo, ate) });
        return { hoje: tempo.hoje(), ...agenda.consultar(pedido) };
      },
    }),
    ferramenta({
      nome: "agenda.obter_evento",
      descricao:
        "Um evento pelo id, como agenda.consultar devolve (eventoId), com descrição, local e alertas.",
      entrada: z.object({ id: Id.describe("O evento") }),
      efeito: "leitura",
      executar: ({ id }) => agenda.obterEvento({ id }),
    }),
    ferramenta({
      nome: "agenda.criar_evento",
      descricao:
        'Cria um compromisso no calendário local ou no "Moductus" (que leva ao Google e avisa no celular). Sem hora, é de dia inteiro. O usuário pode desfazer pelo histórico.',
      entrada: z.object({
        titulo: campos.titulo,
        quando: Quando,
        calendarioId: Id.optional().describe('O calendário; sem ele, o local. Só o local e o "Moductus"'),
        descricao: campos.descricao.optional(),
        local: campos.local.optional(),
        recorrencia: Recorrencia.optional().describe("Regra RRULE do iCalendar, como FREQ=WEEKLY;BYDAY=MO"),
        alertas: campos.alertas.optional(),
      }),
      efeito: "interno",
      executar: ({ quando, calendarioId, ...resto }, ctx) => {
        if (calendarioId !== undefined) exigirEditavel(calendarioId);
        return agenda.criarEvento({ ...resto, ...pontas(quando), calendarioId }, carimboDe(ctx));
      },
      desfazer: (resultado, ctx) => {
        const evento = EventoGravado.parse(resultado);
        agenda.desfazerEvento({ eventoId: evento.id, versao: evento.atualizadoEm, antes: null }, ctx);
      },
    }),
    ferramenta({
      nome: "agenda.mudar_evento",
      descricao:
        'Muda um compromisso do calendário local ou do "Moductus": só o que vier muda. No quando, o dia é obrigatório e o resto fica como era: trocar só o dia mantém a hora e a duração, e o evento com hora só vira de dia inteiro com diaInteiro: true. Devolve o evento e como ele estava.',
      entrada: z.object({
        id: Id.describe("O evento"),
        titulo: campos.titulo.optional(),
        quando: Quando.optional(),
        descricao: campos.descricao.optional(),
        local: campos.local.optional(),
        recorrencia: Recorrencia.nullable().optional().describe("Regra RRULE; null para de repetir"),
        alertas: campos.alertas.optional(),
      }),
      efeito: "interno",
      executar: ({ id, quando, ...resto }, ctx) => {
        const antes = agenda.obterEvento({ id });
        exigirEditavel(antes.calendarioId);
        const evento = agenda.definirEvento(
          { id, ...resto, ...(quando === undefined ? {} : pontas(quando, horarioDe(antes))) },
          carimboDe(ctx),
        );
        const anterior: CamposEvento = {
          titulo: antes.titulo,
          descricao: antes.descricao,
          inicio: antes.inicio,
          fim: antes.fim,
          diaInteiro: antes.diaInteiro,
          local: antes.local,
          recorrencia: antes.recorrencia,
          alertas: antes.alertas,
        };
        return { evento, anterior };
      },
      desfazer: (resultado, ctx) => {
        const { evento, anterior } = z
          .object({ evento: EventoGravado, anterior: CamposGravados })
          .parse(resultado);
        agenda.desfazerEvento({ eventoId: evento.id, versao: evento.atualizadoEm, antes: anterior }, ctx);
      },
    }),
    ferramenta({
      nome: "agenda.criar_evento_em",
      descricao:
        'Cria um compromisso num calendário do Google que não é o "Moductus" (o do trabalho, o da família), só depois de o usuário aprovar no cartão. O id do calendário vem de agenda.calendarios (podeEscrever). Sem hora, é de dia inteiro; sem alertas, valem os do calendário. Não se desfaz pelo histórico.',
      entrada: EntradaCriarEm,
      efeito: "externo",
      conferir: resolverCriar,
      cartao: cartaoDeCriar,
      executar: ({ calendarioId, novo }) => outros.criar(calendarioId, novo),
    }),
    ferramenta({
      nome: "agenda.mudar_evento_em",
      descricao:
        'Muda um compromisso de um calendário do Google que não é o "Moductus", só depois de o usuário aprovar no cartão: só o que vier muda, e o quando pela metade fica como era (como em agenda.mudar_evento). O horário de evento que se repete não muda por aqui. Devolve o evento e como ele estava; não se desfaz pelo histórico.',
      entrada: EntradaMudarEm,
      efeito: "externo",
      conferir: resolverMudar,
      cartao: cartaoDeMudar,
      executar: ({ id, mudanca, vistos }) => outros.mudar(id, mudanca, vistos),
    }),
  ];
}
