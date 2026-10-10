import type {
  Agente,
  Capacidade,
  ChamadaFerramenta,
  Conexao,
  EstadoLigacao,
  Execucao,
  ExecucaoDetalhada,
  Gatilho,
  Provedor,
  SituacaoAgente,
  TipoConexao,
  TipoGatilho,
} from "@moductus/contrato";
import { TIPOS_PROVEDOR_CLI } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useState } from "react";
import { servico } from "./conexao.ts";
import { mensagemDeErro } from "./conversas.ts";

/**
 * A página de um agente (AreaAgente.dc.html): a configuração e a situação dele, o que ele pode
 * fazer, o histórico do que fez com o desfazer, e pausar ou retomar. Quem decide tudo é o
 * serviço; aqui só se mostra e se pede.
 */

/** Quantas execuções a página lê de uma vez: o dia de hoje cabe, e o histórico pede mais. */
export const PAGINA_EXECUCOES = 50;

/** Quantas linhas o cartão "Hoje" mostra; o resto fica no histórico completo. */
export const LINHAS_HOJE = 6;

/** Meia-noite local de hoje, em ISO, para separar o que o agente fez hoje. */
export function inicioDeHoje(agora: Date = new Date()): string {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
}

/** As execuções que começaram hoje, da mais nova para a mais antiga. */
export function deHoje(execucoes: readonly Execucao[], agora: Date = new Date()): Execucao[] {
  const desde = inicioDeHoje(agora);
  return execucoes.filter((e) => (e.inicio ?? "") >= desde);
}

/** Troca a execução que já estava na lista, ou põe a nova no alto (a mais nova primeiro). */
export function juntarExecucao(lista: readonly Execucao[], execucao: Execucao): Execucao[] {
  if (lista.some((e) => e.id === execucao.id)) return lista.map((e) => (e.id === execucao.id ? execucao : e));
  return [execucao, ...lista].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Quanto tempo o serviço deixa desfazer uma chamada `interno` (AGENTS.md §4, DATA.md §6). */
export const HORAS_DESFAZER = 24;

/**
 * As execuções que podem ter algo a desfazer: terminaram dentro do prazo. Só delas a página lê
 * as chamadas, em vez de pedir o detalhe do histórico inteiro.
 */
export function aindaDesfaziveis(execucoes: readonly Execucao[], agora: Date = new Date()): Execucao[] {
  const desde = new Date(agora.getTime() - HORAS_DESFAZER * 3_600_000).toISOString();
  return execucoes.filter((e) => e.estado !== "rodando" && (e.fim ?? e.inicio ?? "") >= desde);
}

/** As chamadas que ainda se desfazem agora, da última para a primeira (a ordem de desfazer). */
export function desfaziveis(
  execucao: ExecucaoDetalhada | undefined,
  agora: Date = new Date(),
): ChamadaFerramenta[] {
  if (!execucao || execucao.estado === "rodando") return [];
  return execucao.chamadas
    .filter(
      (c) => c.desfeitaEm === null && c.desfazerAte !== null && Date.parse(c.desfazerAte) > agora.getTime(),
    )
    .reverse();
}

const ROTULO_GATILHO: Record<TipoGatilho, string> = {
  mensagem: "Respondeu na conversa",
  horario: "Trabalhou no horário marcado",
  intervalo: "Conferiu no intervalo marcado",
  evento: "Atendeu um aviso",
};

/** A linha do histórico: o resumo, o erro ou, sem os dois, o que disparou. */
export function textoDaExecucao(execucao: Execucao): string {
  if (execucao.estado === "rodando") return `${ROTULO_GATILHO[execucao.gatilho]}: trabalhando agora`;
  if (execucao.estado === "adiada") return "Ficou para quando o modelo voltar";
  if (execucao.estado === "erro") return execucao.erro ?? "Não deu certo";
  return execucao.resumo ?? ROTULO_GATILHO[execucao.gatilho];
}

/**
 * Microdólares em dólar, sem arredondar para zero: o que custou menos de um centavo diz isso, em
 * vez de "US$ 0,00".
 */
export function custoEmTexto(microdolares: number): string {
  if (microdolares > 0 && microdolares < 10_000) return "menos de US$ 0,01";
  const valor = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    microdolares / 1_000_000,
  );
  return `US$ ${valor}`;
}

/**
 * O custo de uma execução com a fonte dita (AGENTS.md §5 "Consumo"): "assinatura", a estimativa
 * marcada como estimativa, ou "sem preço". Sem provedor, nada.
 */
export function custoDaExecucao(execucao: Execucao): string | null {
  if (execucao.cobranca === "assinatura") return "assinatura";
  if (execucao.cobranca === "por_token") {
    return execucao.custoEstimadoMicrodolares === null
      ? "sem preço"
      : `${custoEmTexto(execucao.custoEstimadoMicrodolares)} estimado`;
  }
  return null;
}

/** "Hoje: 9 execuções, pela assinatura." O número só aparece com fonte. */
export function resumoDoDia(hoje: readonly Execucao[]): string {
  if (hoje.length === 0) return "Hoje: nenhuma execução.";
  const quantas = `Hoje: ${hoje.length} ${hoje.length === 1 ? "execução" : "execuções"}`;
  const estimado = hoje.reduce((soma, e) => soma + (e.custoEstimadoMicrodolares ?? 0), 0);
  const partes: string[] = [];
  if (hoje.some((e) => e.custoEstimadoMicrodolares !== null))
    partes.push(`${custoEmTexto(estimado)} estimado`);
  if (hoje.some((e) => e.cobranca === "assinatura")) partes.push("pela assinatura");
  if (hoje.some((e) => e.cobranca === "por_token" && e.custoEstimadoMicrodolares === null))
    partes.push("parte sem preço");
  return partes.length > 0 ? `${quantas}, ${partes.join(", ")}.` : `${quantas}.`;
}

/** "Claude Code · sua assinatura" ou "OpenAI · por token". */
export function descreverProvedor(provedor: Provedor): string {
  const cli = (TIPOS_PROVEDOR_CLI as readonly string[]).includes(provedor.tipo);
  const nome = provedor.modelo ? `${provedor.nome} (${provedor.modelo})` : provedor.nome;
  return `${nome} · ${cli ? "sua assinatura" : "por token"}`;
}

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/**
 * "14:00" hoje, "sex 9:00" em outro dia. Montado em duas partes: junto, o pt-BR escreve
 * "sex., 09:00".
 */
export function horaCurta(instante: string, agora: Date = new Date()): string {
  const data = new Date(instante);
  const hora = HORA.format(data);
  if (data.toDateString() === agora.toDateString()) return hora;
  return `${DIA_SEMANA.format(data).replace(".", "")} ${hora}`;
}

const MOTIVO_SONO: Record<NonNullable<SituacaoAgente["motivoSono"]>, string> = {
  limite: "o limite de uso acabou",
  fora_do_ar: "o provedor está fora do ar",
  credencial: "a credencial foi recusada",
  ausente: "o CLI não foi encontrado",
  teto: "chegou ao teto de gasto de hoje",
  sem_modelo: "nenhum modelo escolhido",
};

/**
 * O que o agente está fazendo agora, numa linha: o trabalho em andamento, a espera por você, o
 * sono com o motivo e a hora de acordar, a pausa. A fila entra quando há pedido esperando.
 */
export function agoraDoAgente(
  situacao: SituacaoAgente,
  rodando: Execucao | null,
  agora: Date = new Date(),
): string {
  const fila = situacao.fila > 0 ? ` · ${situacao.fila} na fila` : "";
  switch (situacao.estado) {
    case "desligado":
      return "Desligado: não trabalha nem responde.";
    case "pausado":
      return `Pausado ${situacao.pausadoAte ? `até ${horaCurta(situacao.pausadoAte, agora)}` : "até você retomar"}${fila}`;
    case "dormindo": {
      const motivo = situacao.motivoSono ? `: ${MOTIVO_SONO[situacao.motivoSono]}` : "";
      const ate = situacao.dormeAte ? ` até ${horaCurta(situacao.dormeAte, agora)}` : "";
      return `Dormindo${ate}${motivo}${fila}`;
    }
    case "ativo":
      if (situacao.atividade === "esperando") return `Agora: esperando sua resposta num pedido${fila}`;
      if (situacao.atividade === "trabalhando" || rodando) {
        const oQue = rodando ? ROTULO_GATILHO[rodando.gatilho].toLowerCase() : "trabalhando";
        return `Agora: ${oQue.replace(/^respondeu na conversa$/, "respondendo na conversa")}${fila}`;
      }
      if (situacao.atividade === "erro") return `A última execução deu erro${fila}`;
      return situacao.fila > 0 ? `${situacao.fila} na fila` : "Sem nada em andamento.";
  }
}

/** "todo dia às 8:30", "a cada 15 min", "quando chega arquivo.chegou". */
export function descreverGatilho(gatilho: Gatilho): string {
  switch (gatilho.tipo) {
    case "horario":
      return `todo dia às ${gatilho.hora.replace(/^0(\d)/, "$1")}`;
    case "intervalo":
      return `a cada ${gatilho.minutos} min`;
    case "evento":
      return `quando acontece ${gatilho.nome}`;
  }
}

/** Uma linha do cartão "Vigias": o que observa, quando, e se está ligado (conexões). */
export interface Vigia {
  nome: string;
  quando: string;
  /** Só as conexões têm: o gatilho do agente vale enquanto ele estiver ligado. */
  estado: EstadoLigacao | null;
}

/** As conexões que são vigias de alguém (AGENTS.md §6): hoje, as do Nuno. */
const VIGIAS_DE_CONEXAO: Readonly<Record<TipoConexao, { agente: string; nome: string; quando: string }>> = {
  "hooks-claude-code": { agente: "nuno", nome: "Sessões do Claude Code", quando: "na hora, pelos hooks" },
  github: { agente: "nuno", nome: "GitHub", quando: "a cada 15 min" },
};

const NOME_GATILHO: Record<Gatilho["tipo"], string> = {
  horario: "Horário marcado",
  intervalo: "Conferência periódica",
  evento: "Aviso",
};

/**
 * O que trabalha pelo agente sem gastar modelo: as conexões que ele observa (com a conta, quando
 * há) e os gatilhos dele (AreaAgente.dc.html, cartão "Vigias").
 */
export function vigiasDoAgente(
  agenteId: string,
  gatilhos: readonly Gatilho[],
  conexoes: readonly Conexao[],
): Vigia[] {
  const daConexao = conexoes.flatMap((c) => {
    const vigia = VIGIAS_DE_CONEXAO[c.tipo];
    if (vigia.agente !== agenteId) return [];
    const quando = c.conta ? `${vigia.quando} · ${c.conta}` : vigia.quando;
    return [{ nome: vigia.nome, quando, estado: c.estado }];
  });
  const doGatilho = gatilhos.map((g) => ({
    // O aviso já diz o nome do evento: o "quando" não o repete.
    nome: g.tipo === "evento" ? `${NOME_GATILHO.evento} ${g.nome}` : NOME_GATILHO[g.tipo],
    quando: g.tipo === "evento" ? "quando acontece" : descreverGatilho(g),
    estado: null,
  }));
  return [...daConexao, ...doGatilho];
}

export interface DadosAgente {
  agente: Agente | null;
  capacidades: readonly Capacidade[];
  /** `null` quando o serviço não diz (provedores ainda sem atendimento) ou o agente não tem. */
  provedor: Provedor | null;
  conexoes: readonly Conexao[];
  execucoes: readonly Execucao[];
  /** Há execuções mais antigas que as lidas. */
  temAnteriores: boolean;
  /** O detalhe (as chamadas) das execuções que a tela pediu. */
  detalhes: Readonly<Record<string, ExecucaoDetalhada>>;
  conectado: boolean;
  /** O último pedido recusado (pausar, retomar, ligar), como o serviço disse. */
  erro: string | null;
}

export interface AcoesAgente {
  pausar: () => Promise<void>;
  retomar: () => Promise<void>;
  ligar: () => Promise<void>;
  /** Lê as chamadas de uma execução, para o desfazer. */
  detalhar: (id: string) => Promise<void>;
  /** Desfaz o que a execução fez dentro do Moductus; devolve o erro do serviço, ou `null`. */
  desfazer: (execucaoId: string) => Promise<string | null>;
  anteriores: () => Promise<void>;
}

/**
 * Os dados da página de um agente pelo canal: lidos ao conectar e acompanhados por
 * `agentes.mudou`, `execucoes.mudou` e `conexoes.mudou`.
 */
export function useAgente(canal: EstadoConexao, agenteId: string): DadosAgente & AcoesAgente {
  const conectado = canal === "conectado";
  const [agente, setAgente] = useState<Agente | null>(null);
  const [capacidades, setCapacidades] = useState<Capacidade[]>([]);
  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Record<string, ExecucaoDetalhada>>({});
  const [erro, setErro] = useState<string | null>(null);

  const detalhar = useCallback(async (id: string) => {
    try {
      const detalhe = await servico.pedir("execucoes.obter", { id });
      setDetalhes((d) => ({ ...d, [id]: detalhe }));
    } catch {
      // Sem o detalhe, a linha só não oferece desfazer.
    }
  }, []);

  useEffect(() => {
    const paradas = [
      servico.ouvir("agentes.mudou", (a) => {
        if (a.id === agenteId) setAgente(a);
      }),
      servico.ouvir("execucoes.mudou", (e) => {
        if (e.agenteId !== agenteId) return;
        setExecucoes((lista) => juntarExecucao(lista, e));
        // Terminou ou foi desfeita: as chamadas mudaram, e o detalhe que a tela tem fica velho.
        if (e.estado !== "rodando") void detalhar(e.id);
      }),
      servico.ouvir("conexoes.mudou", (c) =>
        setConexoes((lista) =>
          lista.some((x) => x.tipo === c.tipo)
            ? lista.map((x) => (x.tipo === c.tipo ? c : x))
            : [...lista, c],
        ),
      ),
      servico.ouvir("provedores.mudou", setProvedores),
    ];
    return () => paradas.forEach((parar) => parar());
  }, [agenteId, detalhar]);

  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    setDetalhes({});
    servico
      .pedir("agentes.obter", { id: agenteId })
      .then((a) => vivo && setAgente(a))
      .catch(() => undefined);
    servico
      .pedir("agentes.capacidades", { id: agenteId })
      .then((c) => vivo && setCapacidades(c))
      .catch(() => undefined);
    // Provedores e conexões são complemento: sem resposta, a página diz menos, mas abre.
    servico
      .pedir("provedores.listar")
      .then((p) => vivo && setProvedores(p))
      .catch(() => undefined);
    servico
      .pedir("conexoes.listar")
      .then((c) => vivo && setConexoes(c))
      .catch(() => undefined);
    servico
      .pedir("execucoes.listar", { agenteId, limite: PAGINA_EXECUCOES })
      .then((pagina) => {
        if (!vivo) return;
        setExecucoes(pagina.itens);
        setProximo(pagina.proximo);
        // O desfazer precisa das chamadas: só das execuções ainda dentro do prazo.
        for (const e of aindaDesfaziveis(pagina.itens)) void detalhar(e.id);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [conectado, agenteId, detalhar]);

  // Pausar, retomar e ligar devolvem o agente como ficou: a página não espera o `agentes.mudou`.
  const pedir = useCallback(
    async (fazer: () => Promise<Agente | readonly Agente[]>) => {
      setErro(null);
      try {
        const resposta = await fazer();
        const novo = Array.isArray(resposta)
          ? (resposta as readonly Agente[]).find((a) => a.id === agenteId)
          : (resposta as Agente);
        if (novo) setAgente(novo);
      } catch (e) {
        setErro(mensagemDeErro(e));
      }
    },
    [agenteId],
  );

  const desfazer = useCallback(
    async (execucaoId: string) => {
      const chamadas = desfaziveis(detalhes[execucaoId]);
      try {
        for (const c of chamadas) await servico.pedir("execucoes.desfazer", { chamadaId: c.id });
        return null;
      } catch (e) {
        return mensagemDeErro(e);
      } finally {
        await detalhar(execucaoId);
      }
    },
    [detalhes, detalhar],
  );

  const anteriores = useCallback(async () => {
    if (!proximo) return;
    try {
      const pagina = await servico.pedir("execucoes.listar", {
        agenteId,
        limite: PAGINA_EXECUCOES,
        antesDe: proximo,
      });
      setExecucoes((lista) => pagina.itens.reduce(juntarExecucao, lista));
      setProximo(pagina.proximo);
      for (const e of aindaDesfaziveis(pagina.itens)) void detalhar(e.id);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [agenteId, proximo, detalhar]);

  const provedor = agente?.provedorId ? (provedores.find((p) => p.id === agente.provedorId) ?? null) : null;

  return {
    agente,
    capacidades,
    provedor,
    conexoes,
    execucoes,
    temAnteriores: proximo !== null,
    detalhes,
    conectado,
    erro,
    pausar: () => pedir(() => servico.pedir("agentes.pausar", { agenteId, ate: null })),
    retomar: () => pedir(() => servico.pedir("agentes.retomar", { agenteId })),
    ligar: () => pedir(() => servico.pedir("agentes.ligar", { id: agenteId, ligado: true })),
    detalhar,
    desfazer,
    anteriores,
  };
}
