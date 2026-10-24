import type {
  ApresentacaoRotina,
  LinhaRotina,
  RespostaDosIgnorados,
  RotinasDeHoje,
  Tarefa,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatarDia } from "../../areas/dia.ts";
import type { Leitura } from "../../areas/leitura.ts";
import { DADOS_AGENTES, eAgente, type Agente } from "../../componentes/personagem/agentes.ts";
import { servico } from "../../servico/conexao.ts";

/**
 * O briefing da manhã e o fechamento do dia no painel Hoje (Briefing.dc.html, Fechamento.dc.html,
 * AGENTS.md §2). O serviço monta as linhas, decide quando cada rotina aparece e abre o painel na
 * área Hoje; aqui só se escolhe qual mostrar e como escrever cada linha. A rotina sem ação ocupa o
 * painel; respondida (ou fechada sozinha, `ignorado`), o painel volta a ser o Hoje.
 */

/**
 * A rotina que ocupa o painel agora. Depois que o fechamento apareceu (com ação ou sem) ou com o
 * dia encerrado, o briefing já passou: só o fechamento sem ação ocupa o painel, e adiado ou
 * encerrado o painel é o Hoje. Antes disso, o briefing sem ação.
 */
export function rotinaDaVez(hoje: RotinasDeHoje | null): ApresentacaoRotina | null {
  if (!hoje) return null;
  if (hoje.fechamento) return hoje.fechamento.acao === null ? hoje.fechamento : null;
  if (hoje.diaEncerrado) return null;
  if (hoje.briefing && hoje.briefing.acao === null) return hoje.briefing;
  return null;
}

/**
 * As rotinas com uma vez nova (a que apareceu, a que voltou do adiar, a que você respondeu). A
 * outra rotina de outro dia já não vale ao lado dela: o briefing de hoje tira o fechamento de
 * ontem (e o dia encerrado que vinha dele).
 */
export function comApresentacao(hoje: RotinasDeHoje, apresentacao: ApresentacaoRotina): RotinasDeHoje {
  if (apresentacao.tipo === "briefing") {
    const outroDia = hoje.fechamento !== null && hoje.fechamento.dia !== apresentacao.dia;
    return outroDia
      ? { ...hoje, briefing: apresentacao, fechamento: null, diaEncerrado: false }
      : { ...hoje, briefing: apresentacao };
  }
  const briefing = hoje.briefing !== null && hoje.briefing.dia !== apresentacao.dia ? null : hoje.briefing;
  return {
    ...hoje,
    briefing,
    fechamento: apresentacao,
    diaEncerrado: apresentacao.acao === "encerrar" ? true : hoje.diaEncerrado,
  };
}

/** De quem é a linha e como ela se apresenta ("Alba · o dia", "Alba · ontem", "Nuno"). */
export interface RotuloDaLinha {
  /** A cabeça que vai ao lado; sem agente conhecido, nenhuma. */
  agente: Agente | null;
  texto: string;
}

export function rotuloDaLinha(linha: LinhaRotina): RotuloDaLinha {
  const agente = eAgente(linha.agenteId) ? linha.agenteId : null;
  if (!agente) return { agente: null, texto: linha.rotulo ?? linha.agenteId ?? "" };
  const nome = DADOS_AGENTES[agente].nome;
  if (linha.rotulo !== null) return { agente, texto: `${nome} · ${linha.rotulo.toLowerCase()}` };
  // A primeira linha da Alba é o dia dela (AGENTS.md §2, "Alba, o dia").
  return { agente, texto: agente === "alba" ? `${nome} · o dia` : nome };
}

/** O "Ontem" do briefing, com as tarefas que ficaram abertas: a linha do [Trazer para hoje]. */
export const ehOntem = (linha: LinhaRotina) => linha.rotulo === "Ontem" && linha.tarefaIds.length > 0;

/**
 * As tarefas do "Ontem" que ainda estão atrasadas e abertas, as que o [Trazer para hoje] leva.
 * Sem as atrasadas lidas (`null`), vale a lista da linha: quem confere é o serviço.
 */
export function pendentesDoOntem(linha: LinhaRotina, atrasadas: readonly Tarefa[] | null): string[] {
  if (atrasadas === null) return [...linha.tarefaIds];
  const abertas = new Set(atrasadas.filter((t) => t.estado === "aberta").map((t) => t.id));
  return linha.tarefaIds.filter((id) => abertas.has(id));
}

/**
 * O "Ficou aberto" do fechamento como está agora: sem as que você já resolveu aqui e, com as
 * tarefas do dia lidas, sem as que deixaram de estar abertas no dia (feitas, adiadas ou descartadas
 * por outro caminho).
 */
export function aindaAbertas(
  abertas: readonly Tarefa[],
  resolvidas: ReadonlySet<string>,
  doDia: readonly Tarefa[] | null,
): Tarefa[] {
  const naoResolvidas = abertas.filter((t) => !resolvidas.has(t.id));
  if (doDia === null) return naoResolvidas;
  const abertasAgora = new Set(doDia.filter((t) => t.estado === "aberta").map((t) => t.id));
  return naoResolvidas.filter((t) => abertasAgora.has(t.id));
}

/** A linha da Alba no alto do fechamento ("5 feitas · 2h10 de foco"): a dela, sem rótulo. */
export const linhaDoFeito = (linhas: readonly LinhaRotina[]) =>
  linhas.find((l) => l.agenteId === "alba" && l.rotulo === null) ?? null;

/** As outras linhas da Alba no fechamento ("Amanhã: …"), na ordem do serviço. */
export const linhasDaAlba = (linhas: readonly LinhaRotina[]) =>
  linhas.filter((l) => l.agenteId === "alba" && l.rotulo !== null);

/** As linhas dos outros agentes (Tula, Nuno, Faina), cada uma com a sua cabeça. */
export const linhasDosOutros = (linhas: readonly LinhaRotina[]) =>
  linhas.filter((l) => l.agenteId !== "alba");

/** "Separar comprovantes: vai para amanhã.", o aviso com o Desfazer depois de cada ação. */
export function textoDoAdiado(titulo: string, dia: string, hoje: string): string {
  const quando = formatarDia(dia, hoje);
  return `${titulo}: vai para ${quando === "Amanhã" ? "amanhã" : quando}.`;
}

/** Os três botões da pergunta dos ignorados, na ordem da fala. */
export const RESPOSTAS: readonly { resposta: RespostaDosIgnorados; texto: string }[] = [
  { resposta: "curto", texto: "Mais curto" },
  { resposta: "desligar", texto: "Desligar" },
  { resposta: "manter", texto: "Deixar como está" },
];

/** O que as rotinas de hoje dizem e como o painel aplica a resposta de uma ação, sem esperar o aviso. */
export interface RotinasNoPainel {
  leitura: Leitura<RotinasDeHoje>;
  aplicar: (apresentacao: ApresentacaoRotina) => void;
}

type Mudanca = (atual: RotinasDeHoje) => RotinasDeHoje;

/**
 * As rotinas de hoje: a carga ao conectar e a cada `recarregar` (o painel abriu de novo), a rotina
 * que `rotinas.apareceu` trouxer e a releitura em `rotinas.mudou` (a pergunta dos ignorados some
 * depois da resposta). O que muda com a carga a caminho é aplicado de novo sobre ela, para a
 * resposta mais antiga não desfazer a rotina que acabou de aparecer.
 */
export function useRotinasDeHoje(canal: EstadoConexao, recarregar?: unknown): RotinasNoPainel {
  const [lido, setLido] = useState<{ ok: true; dados: RotinasDeHoje } | { ok: false } | null>(null);
  const [vez, setVez] = useState(0);
  const durante = useRef<Mudanca[] | null>(null);
  const tentarDeNovo = useCallback(() => setVez((v) => v + 1), []);

  const mudar = useCallback((mudanca: Mudanca) => {
    durante.current?.push(mudanca);
    setLido((atual) => (atual?.ok ? { ok: true, dados: mudanca(atual.dados) } : atual));
  }, []);
  const aplicar = useCallback(
    (apresentacao: ApresentacaoRotina) => mudar((hoje) => comApresentacao(hoje, apresentacao)),
    [mudar],
  );

  useEffect(() => {
    const pararApareceu = servico.ouvir("rotinas.apareceu", aplicar);
    const pararMudou = servico.ouvir("rotinas.mudou", () => setVez((v) => v + 1));
    return () => {
      pararApareceu();
      pararMudou();
    };
  }, [aplicar]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    const mudancas: Mudanca[] = [];
    durante.current = mudancas;
    servico
      .pedir("rotinas.hoje")
      .then((hoje) => {
        if (vivo) setLido({ ok: true, dados: mudancas.reduce((h, m) => m(h), hoje) });
      })
      .catch(() => {
        if (vivo) setLido({ ok: false });
      })
      .finally(() => {
        if (durante.current === mudancas) durante.current = null;
      });
    return () => {
      vivo = false;
      if (durante.current === mudancas) durante.current = null;
    };
  }, [canal, recarregar, vez]);

  const leitura: Leitura<RotinasDeHoje> =
    canal !== "conectado" || lido === null
      ? { estado: "esperando" }
      : lido.ok
        ? { estado: "pronta", dados: lido.dados }
        : { estado: "falhou", tentarDeNovo };
  return { leitura, aplicar };
}
