import type { Agenda, BlocoLivre, Calendario, Conexao, Expediente, Ocorrencia } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Encaixe } from "../../janelas/painel/foco.ts";
import { servico } from "../../servico/conexao.ts";
import type { Leitura } from "../leitura.ts";
import { relogioNoFuso } from "../dia.ts";

/**
 * A coluna Agenda da área Tarefas (AreaTarefas.dc.html): o dia de hoje numa régua de horas, com as
 * ocorrências do local, do "Moductus" e dos calendários que a Alba lê, e o encaixe que ela sugere
 * num bloco livre. Quem lê os calendários, acha os blocos livres e escolhe o encaixe é o serviço
 * (`agenda.consultar`); aqui as ocorrências viram posições na régua, no fuso do usuário.
 */

const MINUTOS_DIA = 24 * 60;

/** A ocorrência sem duração (início igual ao fim) aparece com este tanto, para ser vista. */
export const MINUTOS_MINIMOS = 15;

/** Minutos desde a meia-noite de `dia` no fuso: antes dele vale 0, depois dele, 24 h. */
export function minutoNoDia(instante: string, dia: string, fuso: string | null): number {
  const relogio = relogioNoFuso(new Date(instante), fuso);
  if (relogio.dia < dia) return 0;
  if (relogio.dia > dia) return MINUTOS_DIA;
  return minutosDaHora(relogio.hora);
}

const minutosDaHora = (hora: string) => {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  return h * 60 + m;
};

const dois = (n: number) => String(n).padStart(2, "0");

/** A hora na régua, como no quadro: "10h", "9:30". */
export function horaNaRegua(minuto: number): string {
  const h = Math.floor(minuto / 60);
  const m = minuto % 60;
  return m === 0 ? `${h}h` : `${h}:${dois(m)}`;
}

/** A hora na fala da Alba: "16h", "16h30". */
export function horaNaFala(minuto: number): string {
  const h = Math.floor(minuto / 60);
  const m = minuto % 60;
  return m === 0 ? `${h}h` : `${h}h${dois(m)}`;
}

/** Um bloco na régua: um compromisso ou a sugestão da Alba. */
export interface BlocoDaColuna {
  chave: string;
  /** O evento que o bloco abre no detalhe; a sugestão não tem. */
  eventoId: string | null;
  nome: string;
  /** "9:30–10h". */
  hora: string;
  /** Minutos desde a meia-noite, já presos ao dia. */
  inicio: number;
  fim: number;
  tipo: "evento" | "sugestao";
  /** Compromissos que se sobrepõem dividem a largura: a coluna deste e quantas há no grupo. */
  coluna: number;
  colunas: number;
}

export interface ColunaDoDia {
  /** A primeira e a última hora da régua (o expediente, alargado para caber o que há no dia). */
  de: number;
  ate: number;
  /** As horas com risco e rótulo, de `de` até a anterior a `ate`. */
  horas: number[];
  blocos: BlocoDaColuna[];
  /** Os compromissos de dia inteiro, que não cabem na régua. */
  diaTodo: { chave: string; eventoId: string; nome: string }[];
  /** Os blocos livres em texto ("13h–15h"), para quem lê a tela. */
  livres: string[];
  /** Os minutos de agora, quando o dia é hoje e agora cai na régua. */
  agora: number | null;
}

interface PedidoColuna {
  ocorrencias: readonly Ocorrencia[];
  livres: readonly BlocoLivre[];
  dia: string;
  fuso: string | null;
  expediente: Expediente;
  /** A sugestão ainda não aplicada, desenhada tracejada no bloco livre. */
  sugestao: { inicio: string; fim: string; titulo: string } | null;
  agora: Date;
}

/** O título que o Google pode mandar vazio. */
const nomeDe = (titulo: string) => (titulo.trim() === "" ? "Sem título" : titulo);

/** O dia inteiro de `inicio` até a véspera de `fim` (o `fim` é o dia seguinte ao último). */
const cobreODia = (o: Ocorrencia, dia: string) => o.inicio <= dia && dia < o.fim;

/** Monta a coluna do dia: o que entra na régua, onde, e a régua que cabe tudo. */
export function montarColuna(pedido: PedidoColuna): ColunaDoDia {
  const { dia, fuso } = pedido;
  const noDia = (instante: string) => minutoNoDia(instante, dia, fuso);
  const blocos: Omit<BlocoDaColuna, "coluna" | "colunas">[] = [];
  const diaTodo: ColunaDoDia["diaTodo"] = [];
  for (const o of pedido.ocorrencias) {
    const chave = `${o.eventoId}@${o.inicio}`;
    if (o.diaInteiro) {
      if (cobreODia(o, dia)) diaTodo.push({ chave, eventoId: o.eventoId, nome: nomeDe(o.titulo) });
      continue;
    }
    const inicio = noDia(o.inicio);
    const fim = Math.min(MINUTOS_DIA, Math.max(noDia(o.fim), inicio + MINUTOS_MINIMOS));
    // A que só encosta no dia (termina à meia-noite em que ele começa) fica de fora; a sem duração
    // fica se acontece nele, inclusive à meia-noite.
    const semDuracao = Date.parse(o.fim) <= Date.parse(o.inicio);
    const encosta = semDuracao ? relogioNoFuso(new Date(o.inicio), fuso).dia !== dia : noDia(o.fim) <= 0;
    if (inicio >= MINUTOS_DIA || encosta) continue;
    blocos.push({
      chave,
      eventoId: o.eventoId,
      nome: nomeDe(o.titulo),
      hora: intervalo(inicio, fim),
      inicio,
      fim,
      tipo: "evento",
    });
  }
  if (pedido.sugestao) {
    const inicio = noDia(pedido.sugestao.inicio);
    const fim = noDia(pedido.sugestao.fim);
    blocos.push({
      chave: "sugestao",
      eventoId: null,
      nome: `Sugestão: ${pedido.sugestao.titulo}`,
      hora: intervalo(inicio, fim),
      inicio,
      fim,
      tipo: "sugestao",
    });
  }

  const { de, ate } = reguaDoDia(pedido.expediente, blocos);
  const relogio = relogioNoFuso(pedido.agora, fuso);
  const agora = relogio.dia === dia ? minutosDaHora(relogio.hora) : null;
  return {
    de,
    ate,
    horas: Array.from({ length: ate - de }, (_, i) => de + i),
    blocos: emColunas(blocos),
    diaTodo,
    livres: pedido.livres.map((b) => intervalo(noDia(b.inicio), noDia(b.fim))),
    agora: agora !== null && agora >= de * 60 && agora <= ate * 60 ? agora : null,
  };
}

const intervalo = (inicio: number, fim: number) => `${horaNaRegua(inicio)}–${horaNaRegua(fim)}`;

/** A régua do expediente, alargada em horas cheias para caber o primeiro e o último bloco. */
export function reguaDoDia(
  expediente: Expediente,
  blocos: readonly { inicio: number; fim: number }[],
): { de: number; ate: number } {
  const de = Math.min(
    Math.floor(minutosDaHora(expediente.inicio) / 60),
    ...blocos.map((b) => Math.floor(b.inicio / 60)),
  );
  const ate = Math.max(
    Math.ceil(minutosDaHora(expediente.fim) / 60),
    ...blocos.map((b) => Math.ceil(b.fim / 60)),
  );
  const inicio = Math.max(0, Math.min(23, de));
  return { de: inicio, ate: Math.max(inicio + 1, Math.min(24, ate)) };
}

/**
 * Os blocos em ordem, com a coluna de cada um: os que se sobrepõem formam um grupo e dividem a
 * largura; cada bloco vai na primeira coluna do grupo que já ficou livre quando ele começa.
 */
export function emColunas<T extends { inicio: number; fim: number }>(
  blocos: readonly T[],
): (T & { coluna: number; colunas: number })[] {
  const ordem = [...blocos].sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  const saida: (T & { coluna: number; colunas: number })[] = [];
  let grupo: (T & { coluna: number; colunas: number })[] = [];
  let fins: number[] = [];
  let fimDoGrupo = -1;
  const fechar = () => {
    for (const b of grupo) b.colunas = fins.length;
    saida.push(...grupo);
    grupo = [];
    fins = [];
  };
  for (const b of ordem) {
    if (b.inicio >= fimDoGrupo) fechar();
    let coluna = fins.findIndex((fim) => fim <= b.inicio);
    if (coluna < 0) coluna = fins.push(b.fim) - 1;
    else fins[coluna] = b.fim;
    grupo.push({ ...b, coluna, colunas: 1 });
    fimDoGrupo = Math.max(fimDoGrupo, b.fim);
  }
  fechar();
  return saida;
}

/**
 * De onde vem a agenda. Quem diz se o Google está conectado é a conexão `google-agenda` (desligada
 * ou ausente, não está, mesmo com calendários dele ainda no banco); os calendários só escolhem o
 * rótulo: com o espelho, "Google · Moductus".
 */
export function fonteDaAgenda(
  conexao: Conexao | null,
  calendarios: readonly Calendario[],
): { rotulo: string; temGoogle: boolean } {
  if (!conexao || conexao.estado === "desligada") return { rotulo: "Local", temGoogle: false };
  const espelho = calendarios.some((c) => c.fonte === "google" && c.espelho);
  return { rotulo: espelho ? "Google · Moductus" : "Google", temGoogle: true };
}

/** Sem o Google, a coluna mostra só o que é do calendário local. */
export function ocorrenciasDaFonte(
  ocorrencias: readonly Ocorrencia[],
  calendarios: readonly Calendario[],
  temGoogle: boolean,
): Ocorrencia[] {
  if (temGoogle) return [...ocorrencias];
  const locais = new Set(calendarios.filter((c) => c.fonte === "local").map((c) => c.id));
  return ocorrencias.filter((o) => locais.has(o.calendarioId));
}

/**
 * A fala da Alba sobre o encaixe (até duas frases, como no quadro): o bloco livre e o que ela
 * desenhou nele, que só vale com o "Guardar o bloco".
 */
export function falaDaSugestao({ bloco, titulo }: Encaixe, dia: string, fuso: string | null): string {
  return `O bloco das ${horaNaFala(minutoNoDia(bloco.inicio, dia, fuso))} está livre. Coloquei “${titulo}” ali como sugestão.`;
}

/** O que ficou depois do "Guardar o bloco". */
export function falaDoGuardado({ sugestao, titulo }: Encaixe, dia: string, fuso: string | null): string {
  const de = horaNaFala(minutoNoDia(sugestao.inicio, dia, fuso));
  const ate = horaNaFala(minutoNoDia(sugestao.fim, dia, fuso));
  return `Guardei das ${de} às ${ate} para “${titulo}”.`;
}

// ---------- Leitura ----------

export interface DadosAgenda {
  agenda: Agenda;
  calendarios: Calendario[];
  /** A conexão `google-agenda`, ou `null` quando o serviço não a lista. */
  google: Conexao | null;
  /** O dia para o qual a agenda foi pedida. */
  dia: string;
  /** Conta as releituras que chegaram: muda a cada uma, mesmo com a mesma agenda. */
  carga: number;
}

type Lidos = Omit<DadosAgenda, "google">;

/**
 * A agenda de hoje, os calendários e a conexão do Google, pelo canal: ao conectar, quando o dia
 * muda e de novo a cada `agenda.mudou`, `agenda.calendarios`, `tarefas.mudou` (a tarefa nova ou
 * feita muda o encaixe que o serviço sugere) e `config.mudou` (fuso e expediente mudam os blocos
 * livres). A conexão segue também o `conexoes.mudou`; o aviso que chega com a carga a caminho é
 * mais novo que ela. Avisos do mesmo instante viram uma recarga só; a recarga que falha com dados
 * do mesmo dia na tela mantém o que já estava. Dados de outro dia nunca valem: na virada, até a
 * agenda nova chegar a leitura espera, e se ela falhar, falhou.
 */
export function useAgendaDoDia(canal: EstadoConexao, dia: string): Leitura<DadosAgenda> {
  const [lidos, setLidos] = useState<Lidos | null>(null);
  // `undefined` é "ainda não sei"; `null`, o serviço não lista a conexão.
  const [google, setGoogle] = useState<Conexao | null | undefined>(undefined);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const chegouConexao = useRef(false);
  const tentarDeNovo = useCallback(() => {
    setFalhou(false);
    setVersao((v) => v + 1);
  }, []);

  useEffect(() => {
    let pendente: ReturnType<typeof setTimeout> | null = null;
    const recarregar = () => {
      if (pendente) return;
      pendente = setTimeout(() => {
        pendente = null;
        setVersao((v) => v + 1);
      }, 0);
    };
    const paradas = [
      servico.ouvir("agenda.mudou", recarregar),
      servico.ouvir("agenda.calendarios", recarregar),
      servico.ouvir("tarefas.mudou", recarregar),
      servico.ouvir("config.mudou", recarregar),
      servico.ouvir("conexoes.mudou", (c) => {
        if (c.tipo !== "google-agenda") return;
        // Os calendários que a conexão traz ou leva chegam pelo `agenda.calendarios`.
        chegouConexao.current = true;
        setGoogle(c);
      }),
    ];
    return () => {
      paradas.forEach((parar) => parar());
      if (pendente) clearTimeout(pendente);
    };
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    chegouConexao.current = false;
    Promise.all([
      servico.pedir("agenda.consultar", { de: dia, ate: dia }),
      servico.pedir("agenda.calendarios"),
      servico.pedir("conexoes.listar"),
    ])
      .then(([agenda, calendarios, conexoes]) => {
        if (!vivo) return;
        setFalhou(false);
        setLidos((antes) => ({ agenda, calendarios, dia, carga: (antes?.carga ?? 0) + 1 }));
        if (!chegouConexao.current) setGoogle(conexoes.find((c) => c.tipo === "google-agenda") ?? null);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [canal, versao, dia]);

  if (canal !== "conectado") return { estado: "esperando" };
  if (lidos && lidos.dia === dia && google !== undefined) {
    return { estado: "pronta", dados: { ...lidos, google } };
  }
  return falhou ? { estado: "falhou", tentarDeNovo } : { estado: "esperando" };
}
