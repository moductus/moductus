import {
  fusoDoSistema,
  LISTA_ENTRADA,
  TipoLancavel,
  type CamposCaptura,
  type Lembrete,
  type Lista,
  type PreviaCaptura,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel, type EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useState } from "react";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import type { Leitura } from "../leitura.ts";
import {
  dataDoDia,
  diaCurto,
  diaPorExtenso,
  formatarAntes,
  formatarMinutos,
  hojeNoFuso,
  lancado,
  relogioNoFuso,
  repeticaoNaLinha,
  somarDias,
  veioDe,
} from "../dia.ts";
import { dataCurta } from "../Pagina.tsx";

/**
 * A área Tarefas (AreaTarefas.dc.html, sem a coluna Agenda, que é a F3-35): as vistas Hoje,
 * Próximos 7 dias, Todas e Lembretes, as listas, e o campo em linguagem natural. Quem decide o que
 * entra em cada recorte (hoje, atrasadas, próximas, no fuso do usuário) é o serviço; aqui as
 * tarefas que ele mandou viram grupos e linhas.
 */

/** Uma vista da área: as fixas ou uma lista (`lista:<id>`). */
export type IdVista = "hoje" | "proximos" | "todas" | "lembretes" | `lista:${string}`;

export const VISTAS_FIXAS = [
  { id: "hoje", nome: "Hoje" },
  { id: "proximos", nome: "Próximos 7 dias" },
  { id: "todas", nome: "Todas" },
  { id: "lembretes", nome: "Lembretes" },
] as const satisfies readonly { id: IdVista; nome: string }[];

/** Quantos dias depois de hoje a vista "Próximos 7 dias" alcança. */
export const DIAS_PROXIMOS = 7;

/**
 * A antecedência do lembrete que a tarefa com hora ganha quando a frase não diz outra (o padrão
 * das Tarefas no serviço, `MINUTOS_ANTES_PADRAO`): o "Entendi:" mostra o que vai acontecer.
 */
export const LEMBRETE_PADRAO_MIN = 15;

export const idDaLista = (vista: IdVista): string | null =>
  vista.startsWith("lista:") ? vista.slice("lista:".length) : null;

// ---------- Linhas e grupos ----------

/** Uma linha da lista: a tarefa e o que aparece em volta dela. */
export interface LinhaTarefa {
  tarefa: Tarefa;
  /** A segunda linha, em texto: "veio de ontem", "subtarefas 1 de 3", "repete todo mês". */
  nota: string;
  /** A coluna da direita: a hora no recorte de um dia, o dia curto nos outros. */
  quando: string;
  /** A ordem só muda entre tarefas do mesmo dia e da mesma hora: o resto segue o relógio. */
  chaveOrdem: string;
}

export interface GrupoTarefas {
  id: string;
  nome: string;
  /** O grupo das atrasadas vem no tom de aviso e oferece trazer para hoje. */
  atrasado: boolean;
  linhas: LinhaTarefa[];
}

const feita = (t: Tarefa) => t.estado === "feita";

/**
 * As linhas de um recorte: a subtarefa cuja mãe veio junto não vira linha (ela entra no "1 de 3"
 * da mãe); a que veio sozinha, pelo próprio dia, vira.
 */
function principais(tarefas: readonly Tarefa[]): { linhas: Tarefa[]; filhas: Map<string, Tarefa[]> } {
  // Dois recortes juntos (atrasadas e hoje) podem trazer a mesma subtarefa: ela conta uma vez.
  const unicas = [...new Map(tarefas.map((t) => [t.id, t])).values()];
  const ids = new Set(unicas.map((t) => t.id));
  const filhas = new Map<string, Tarefa[]>();
  const linhas: Tarefa[] = [];
  for (const t of unicas) {
    if (t.tarefaPaiId !== null && ids.has(t.tarefaPaiId)) {
      filhas.set(t.tarefaPaiId, [...(filhas.get(t.tarefaPaiId) ?? []), t]);
    } else {
      linhas.push(t);
    }
  }
  return { linhas, filhas };
}

function notaDa(tarefa: Tarefa, filhas: readonly Tarefa[], hoje: string, atrasada: boolean): string {
  const partes: string[] = [];
  if (atrasada && tarefa.venceEm) partes.push(veioDe(tarefa.venceEm, hoje));
  const contadas = filhas.filter((f) => f.estado !== "cancelada");
  if (contadas.length > 0) partes.push(`subtarefas ${contadas.filter(feita).length} de ${contadas.length}`);
  if (tarefa.recorrencia) partes.push(repeticaoNaLinha(tarefa.recorrencia));
  return partes.join(" · ");
}

/** A chave de quem vem antes: dia e hora em geral; só a hora nos períodos do Hoje. */
type Chave = (t: Tarefa) => string;

const porDiaEHoraChave: Chave = (t) => `${t.venceEm ?? "9999-99-99"} ${t.hora ?? "99:99"}`;
/** No Hoje tudo é de hoje, inclusive a atrasada feita hoje: só a hora ordena. */
const soHora: Chave = (t) => t.hora ?? "99:99";

/** Mesma ordem do serviço (dia, posição), com a hora antes da posição; a ordenação é estável. */
function ordenarPor(tarefas: readonly Tarefa[], chave: Chave): Tarefa[] {
  return [...tarefas].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
}

const porDiaEHora = (tarefas: readonly Tarefa[]) => ordenarPor(tarefas, porDiaEHoraChave);

function linha(
  tarefa: Tarefa,
  filhas: Map<string, Tarefa[]>,
  hoje: string,
  {
    atrasada,
    quando,
    chave = porDiaEHoraChave,
  }: { atrasada: boolean; quando: "hora" | "dia"; chave?: Chave },
): LinhaTarefa {
  const dia =
    quando === "hora" || !tarefa.venceEm
      ? (tarefa.hora ?? "")
      : tarefa.venceEm === hoje
        ? (tarefa.hora ?? "hoje")
        : diaCurto(tarefa.venceEm, hoje);
  return {
    tarefa,
    nota: notaDa(tarefa, filhas.get(tarefa.id) ?? [], hoje, atrasada),
    quando: dia,
    chaveOrdem: chave(tarefa),
  };
}

const grupo = (id: string, nome: string, linhas: LinhaTarefa[], atrasado = false): GrupoTarefas => ({
  id,
  nome,
  atrasado,
  linhas,
});

const naoVazios = (grupos: GrupoTarefas[]) => grupos.filter((g) => g.linhas.length > 0);

/** O período do dia de uma hora: manhã até 12:00, tarde até 18:00, noite depois. */
function periodo(hora: string | null): "manha" | "tarde" | "noite" | "semHora" {
  if (hora === null) return "semHora";
  if (hora < "12:00") return "manha";
  return hora < "18:00" ? "tarde" : "noite";
}

/**
 * O Hoje do quadro: as atrasadas no alto (com o dia em que venciam), depois as de hoje por período,
 * as feitas no lugar delas, riscadas. A atrasada que foi feita hoje já não está atrasada.
 */
export function gruposDoHoje(
  deHoje: readonly Tarefa[],
  atrasadas: readonly Tarefa[],
  hoje: string,
): GrupoTarefas[] {
  const { linhas, filhas } = principais([...atrasadas, ...deHoje]);
  const idsAtrasadas = new Set(atrasadas.map((t) => t.id));
  const ehAtrasada = (t: Tarefa) => idsAtrasadas.has(t.id) && t.estado === "aberta";
  const doDia = ordenarPor(
    linhas.filter((t) => !ehAtrasada(t)),
    soHora,
  );
  const doPeriodo = (p: ReturnType<typeof periodo>) =>
    doDia
      .filter((t) => periodo(t.hora) === p)
      .map((t) => linha(t, filhas, hoje, { atrasada: false, quando: "hora", chave: soHora }));
  return naoVazios([
    grupo(
      "atrasadas",
      "Atrasada",
      porDiaEHora(linhas.filter(ehAtrasada)).map((t) =>
        linha(t, filhas, hoje, { atrasada: true, quando: "dia" }),
      ),
      true,
    ),
    grupo("manha", "Manhã", doPeriodo("manha")),
    grupo("tarde", "Tarde", doPeriodo("tarde")),
    grupo("noite", "Noite", doPeriodo("noite")),
    grupo("semHora", "Sem hora", doPeriodo("semHora")),
  ]);
}

/** "Amanhã" e depois o dia por extenso ("Sábado, 10 de outubro"), um grupo por dia. */
export function gruposDosProximos(proximas: readonly Tarefa[], hoje: string): GrupoTarefas[] {
  const de = somarDias(hoje, 1);
  const ate = somarDias(hoje, DIAS_PROXIMOS);
  // As subtarefas vêm com a mãe em qualquer dia: primeiro cada uma acha a mãe, depois o corte.
  const { linhas, filhas } = principais(proximas);
  const naSemana = linhas.filter((t) => t.venceEm !== null && t.venceEm >= de && t.venceEm <= ate);
  const grupos = new Map<string, LinhaTarefa[]>();
  for (const t of porDiaEHora(naSemana)) {
    const dia = t.venceEm!;
    grupos.set(dia, [
      ...(grupos.get(dia) ?? []),
      linha(t, filhas, hoje, { atrasada: false, quando: "hora" }),
    ]);
  }
  return [...grupos].map(([dia, l]) =>
    grupo(dia, dia === somarDias(hoje, 1) ? "Amanhã" : dataCurta(dataDoDia(dia)), l),
  );
}

/** Todas as abertas (ou as de uma lista): atrasadas, hoje, as próximas e as sem data. */
export function gruposDasAbertas(abertas: readonly Tarefa[], hoje: string): GrupoTarefas[] {
  const { linhas, filhas } = principais(abertas);
  const ordem = porDiaEHora(linhas);
  const de = (filtro: (t: Tarefa) => boolean, atrasada = false) =>
    ordem.filter(filtro).map((t) => linha(t, filhas, hoje, { atrasada, quando: "dia" }));
  return naoVazios([
    grupo(
      "atrasadas",
      "Atrasadas",
      de((t) => t.venceEm !== null && t.venceEm < hoje, true),
      true,
    ),
    grupo(
      "hoje",
      "Hoje",
      de((t) => t.venceEm === hoje),
    ),
    grupo(
      "proximas",
      "Próximas",
      de((t) => t.venceEm !== null && t.venceEm > hoje),
    ),
    grupo(
      "semData",
      "Sem data",
      de((t) => t.venceEm === null),
    ),
  ]);
}

/** Quantas linhas um recorte mostra (a contagem da sub-navegação). */
export const contarLinhas = (tarefas: readonly Tarefa[]) => principais(tarefas).linhas.length;

/** "3 de 7 feitas", no alto do Hoje. */
export function progressoDoHoje(grupos: readonly GrupoTarefas[]): string {
  const linhas = grupos.flatMap((g) => g.linhas);
  const feitas = linhas.filter((l) => feita(l.tarefa)).length;
  return `${feitas} de ${linhas.length} ${linhas.length === 1 ? "feita" : "feitas"}`;
}

/** "12 abertas", no alto das outras vistas. */
export function totalDasAbertas(grupos: readonly GrupoTarefas[]): string {
  const n = grupos.reduce((soma, g) => soma + g.linhas.length, 0);
  return `${n} ${n === 1 ? "aberta" : "abertas"}`;
}

/** Prioridade com texto (o traço colorido nunca diz sozinho): 3 alta, 2 média, 1 baixa. */
export function textoDaPrioridade(prioridade: number): string | null {
  return prioridade >= 3
    ? "prioridade alta"
    : prioridade === 2
      ? "prioridade média"
      : prioridade === 1
        ? "prioridade baixa"
        : null;
}

// ---------- Ordenar ----------

/**
 * A nova ordem de um grupo com a tarefa um passo acima ou abaixo. Só troca com a vizinha do mesmo
 * dia e da mesma hora: entre horas diferentes quem manda é o relógio, e a troca não mudaria nada
 * na tela. Sem troca possível, `null`.
 */
export function moverNoGrupo(linhas: readonly LinhaTarefa[], id: string, passo: -1 | 1): string[] | null {
  const trecho = trechoDaChave(linhas, id);
  const i = trecho.findIndex((l) => l === id);
  if (i < 0 || i + passo < 0 || i + passo >= trecho.length) return null;
  [trecho[i], trecho[i + passo]] = [trecho[i + passo]!, trecho[i]!];
  return trecho;
}

/**
 * Os ids da sequência seguida de linhas com a mesma chave da tarefa: é só ela que muda de posição,
 * e só ela vai ao `tarefas.ordenar` (o resto do grupo segue o relógio).
 */
function trechoDaChave(linhas: readonly LinhaTarefa[], id: string): string[] {
  const i = linhas.findIndex((l) => l.tarefa.id === id);
  if (i < 0) return [];
  const chave = linhas[i]!.chaveOrdem;
  let inicio = i;
  let fim = i;
  while (inicio > 0 && linhas[inicio - 1]!.chaveOrdem === chave) inicio--;
  while (fim < linhas.length - 1 && linhas[fim + 1]!.chaveOrdem === chave) fim++;
  return linhas.slice(inicio, fim + 1).map((l) => l.tarefa.id);
}

/** Arrastar uma tarefa para o lugar de outra do mesmo grupo, com as mesmas regras de troca. */
export function soltarNoGrupo(linhas: readonly LinhaTarefa[], id: string, alvoId: string): string[] | null {
  const trecho = trechoDaChave(linhas, id);
  const de = trecho.indexOf(id);
  const para = trecho.indexOf(alvoId);
  if (de < 0 || para < 0 || de === para) return null;
  const [movida] = trecho.splice(de, 1);
  trecho.splice(para, 0, movida!);
  return trecho;
}

/** Quantos ids cabem num pedido de adiar ou ordenar (`LIMITE_IDS` do serviço). */
export const LIMITE_IDS = 1000;

/** Os ids em lotes que o serviço aceita. */
export function emLotes(ids: readonly string[], tamanho = LIMITE_IDS): string[][] {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) lotes.push(ids.slice(i, i + tamanho));
  return lotes;
}

// ---------- Lembretes ----------

export interface LinhaLembrete {
  lembrete: Lembrete;
  quando: string;
  selo: { texto: string; tom: TomSelo } | null;
}

export interface GrupoLembretes {
  id: string;
  nome: string;
  atrasado: boolean;
  linhas: LinhaLembrete[];
}

/** Quando o lembrete toca de novo: o adiado, no fim do adiamento. */
const proximoToque = (l: Lembrete) => l.adiadoAte ?? l.quando;

/**
 * Os lembretes vivos: os que estão tocando ou venceram sem você ver no alto, depois os de hoje e
 * os próximos, na ordem em que tocam.
 */
export function gruposDosLembretes(
  lembretes: readonly Lembrete[],
  fuso: string,
  agora: Date,
): GrupoLembretes[] {
  const hoje = relogioNoFuso(agora, fuso).dia;
  const ordem = [...lembretes].sort((a, b) => Date.parse(proximoToque(a)) - Date.parse(proximoToque(b)));
  const linhaDe = (l: Lembrete): LinhaLembrete => {
    const { dia, hora } = relogioNoFuso(new Date(proximoToque(l)), fuso);
    const selo =
      l.estado === "perdido"
        ? { texto: "atrasado", tom: "aviso" as const }
        : l.estado === "disparado"
          ? { texto: "tocando", tom: "aviso" as const }
          : l.estado === "adiado"
            ? { texto: "adiado", tom: "neutro" as const }
            : null;
    return { lembrete: l, quando: dia === hoje ? hora : `${diaCurto(dia, hoje)} ${hora}`, selo };
  };
  const atrasado = (l: Lembrete) => l.estado === "perdido" || l.estado === "disparado";
  const doDia = (l: Lembrete) => relogioNoFuso(new Date(proximoToque(l)), fuso).dia;
  const grupos: GrupoLembretes[] = [
    { id: "atrasados", nome: "Atrasados", atrasado: true, linhas: ordem.filter(atrasado).map(linhaDe) },
    {
      id: "hoje",
      nome: "Hoje",
      atrasado: false,
      linhas: ordem.filter((l) => !atrasado(l) && doDia(l) <= hoje).map(linhaDe),
    },
    {
      id: "proximos",
      nome: "Próximos",
      atrasado: false,
      linhas: ordem.filter((l) => !atrasado(l) && doDia(l) > hoje).map(linhaDe),
    },
  ];
  return grupos.filter((g) => g.linhas.length > 0);
}

// ---------- O campo em linguagem natural ----------

/** O que a vista aberta acrescenta à frase que não disse: a lista dela, ou o dia de hoje no Hoje. */
export interface ContextoDaFrase {
  listaId: string | null;
  dia: string | null;
}

export interface Lancamento {
  tipo: TipoLancavel;
  campos: CamposCaptura;
}

/**
 * O que o Enter lança a partir da prévia. Gasto e memória ainda não chegaram: vão como a primeira
 * alternativa da prévia, com o aviso dela na tela. Na tarefa, o que a frase não disse vem da vista aberta: escrever
 * "comprar pão" no Hoje é para hoje, numa lista é para ela.
 */
export function lancamentoDaPrevia(previa: PreviaCaptura, contexto: ContextoDaFrase): Lancamento {
  const lancavel = TipoLancavel.safeParse(previa.tipo);
  // O que ainda não chegou vai como a primeira alternativa que a captura oferece (memória é nota).
  const tipo: TipoLancavel = lancavel.success ? lancavel.data : (previa.alternativas[0] ?? "tarefa");
  if (tipo !== "tarefa") return { tipo, campos: previa.campos };
  const { campos } = previa;
  return {
    tipo,
    campos: {
      ...campos,
      listaId: campos.listaId ?? contexto.listaId,
      dia: campos.dia ?? contexto.dia,
    },
  };
}

const NOME_TIPO: Record<TipoLancavel, string> = {
  tarefa: "tarefa",
  lembrete: "lembrete",
  evento: "evento",
  nota: "nota",
};

/**
 * Os pedaços do "Entendi:" (AreaTarefas): o tipo, o dia, a hora, a duração, a repetição, o
 * lembrete e a lista, na ordem do quadro ("tarefa · sexta, 9 out · 15:00 · lembrete 15 min antes ·
 * Pessoal"). O lembrete padrão da tarefa com hora aparece, porque ele vai ser criado.
 */
export function pedacosDoEntendi(
  { tipo, campos }: Lancamento,
  listas: readonly Lista[],
  hoje: string,
): string[] {
  const pedacos = [NOME_TIPO[tipo]];
  if (tipo === "nota") return pedacos;
  if (campos.dia) pedacos.push(diaPorExtenso(campos.dia, hoje));
  if (campos.hora) pedacos.push(campos.hora);
  if (campos.duracaoMin !== null) pedacos.push(formatarMinutos(campos.duracaoMin));
  if (campos.recorrencia) pedacos.push(repeticaoNaLinha(campos.recorrencia));
  const antes =
    campos.lembreteMinutosAntes ?? (tipo === "tarefa" && campos.hora !== null ? LEMBRETE_PADRAO_MIN : null);
  if (antes !== null && (tipo !== "lembrete" || antes > 0)) {
    pedacos.push(`${tipo === "evento" ? "alerta" : "lembrete"} ${formatarAntes(antes)}`);
  }
  if (tipo === "tarefa") {
    const id = campos.listaId ?? LISTA_ENTRADA;
    pedacos.push(listas.find((l) => l.id === id)?.nome ?? "Entrada");
  }
  return pedacos;
}

export const textoDoCriado = (tipo: TipoLancavel, titulo: string) => `${lancado(tipo)}: ${titulo}.`;

/**
 * O que a tela diz quando um pedido não deu: a recusa do serviço como veio (é a regra, que a pessoa
 * pode corrigir); o resto, sem detalhe de dentro.
 */
export function mensagemDaRecusa(erro: unknown): string {
  if (erro instanceof ServicoIndisponivel)
    return "O serviço não está respondendo. Nada mudou; tente de novo.";
  if (erro instanceof RecusaDoServico) return erro.message.charAt(0).toUpperCase() + erro.message.slice(1);
  return "Não deu certo agora. Nada mudou; tente de novo.";
}

// ---------- Leitura ----------

export interface DadosTarefas {
  listas: Lista[];
  /** As de hoje (abertas e feitas hoje), as atrasadas, todas as abertas e as de amanhã em diante. */
  hoje: Tarefa[];
  atrasadas: Tarefa[];
  abertas: Tarefa[];
  proximas: Tarefa[];
  lembretes: Lembrete[];
  fuso: string;
  /** O dia de hoje no fuso, o mesmo para o qual os recortes foram pedidos. */
  dia: string;
}

type Recortes = Pick<DadosTarefas, "listas" | "hoje" | "atrasadas" | "abertas" | "proximas">;

/**
 * Tudo o que a área mostra, pelo canal: ao conectar e de novo a cada `tarefas.mudou` e
 * `listas.mudou`, de qualquer caminho (esta tela, a captura, a Alba), e quando o dia de hoje muda
 * (a meia-noite ou outro fuso em Configurações › Dia). Recarregar os recortes inteiros, em vez de
 * remendar, deixa o serviço decidir de novo onde cada tarefa cai; avisos do mesmo instante viram
 * uma recarga só, e `lembretes.mudou` recarrega só os lembretes. Uma recarga que falha com dados na
 * tela mantém o que já estava.
 */
export function useDadosTarefas(canal: EstadoConexao, agora: Date): Leitura<DadosTarefas> {
  const [recortes, setRecortes] = useState<Recortes | null>(null);
  const [lembretes, setLembretes] = useState<Lembrete[] | null>(null);
  const [fuso, setFuso] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [versao, setVersao] = useState(0);
  const [versaoLembretes, setVersaoLembretes] = useState(0);
  const tentarDeNovo = useCallback(() => {
    setFalhou(false);
    setVersao((v) => v + 1);
    setVersaoLembretes((v) => v + 1);
  }, []);
  // Até a configuração chegar, o fuso do Windows, que é o padrão dela.
  const fusoDoDia = fuso ?? fusoDoSistema();
  const dia = hojeNoFuso(agora, fusoDoDia);

  useEffect(() => {
    const pendentes = new Map<string, ReturnType<typeof setTimeout>>();
    const juntar = (chave: string, fazer: () => void) => () => {
      if (pendentes.has(chave)) return;
      pendentes.set(
        chave,
        setTimeout(() => {
          pendentes.delete(chave);
          fazer();
        }, 0),
      );
    };
    const recarregar = juntar("recortes", () => setVersao((v) => v + 1));
    const paradas = [
      servico.ouvir("tarefas.mudou", recarregar),
      servico.ouvir("listas.mudou", recarregar),
      servico.ouvir(
        "lembretes.mudou",
        juntar("lembretes", () => setVersaoLembretes((v) => v + 1)),
      ),
      servico.ouvir("config.mudou", (estado) => setFuso(estado.config.dia.fuso)),
    ];
    return () => {
      paradas.forEach((parar) => parar());
      pendentes.forEach((relogio) => clearTimeout(relogio));
    };
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("config.obter")
      .then((estado) => {
        if (vivo) setFuso(estado.config.dia.fuso);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [canal]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    Promise.all([
      servico.pedir("listas.listar"),
      servico.pedir("tarefas.listar", { vista: "hoje" }),
      servico.pedir("tarefas.listar", { vista: "atrasadas" }),
      servico.pedir("tarefas.listar", {}),
      servico.pedir("tarefas.listar", { vista: "proximas" }),
    ])
      .then(([listas, hoje, atrasadas, abertas, proximas]) => {
        if (!vivo) return;
        setFalhou(false);
        setRecortes({ listas, hoje, atrasadas, abertas, proximas });
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
    // O dia entra para os recortes de hoje, atrasadas e próximas virarem com ele.
  }, [canal, versao, dia]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("lembretes.listar", {})
      .then((lidos) => {
        if (vivo) setLembretes(lidos);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [canal, versaoLembretes]);

  if (canal !== "conectado") return { estado: "esperando" };
  if (recortes && lembretes) {
    return { estado: "pronta", dados: { ...recortes, lembretes, fuso: fusoDoDia, dia } };
  }
  return falhou ? { estado: "falhou", tentarDeNovo } : { estado: "esperando" };
}
