import {
  FERRAMENTAS_SESSAO,
  type Conexao,
  type EstadoSessao,
  type EventoSessao,
  type FerramentaSessao,
  type ListaSessoes,
  type MudancaSessao,
  type Projeto,
  type SessaoIa,
  type UsoIa,
} from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useRef, useState } from "react";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import { diaLocal, haQuanto } from "../tempo.ts";

/**
 * A área Sessões de IA (AreaSessoes.dc.html) lida dos dados reais: o que cada sessão está
 * fazendo, o contexto, os tokens do dia e da semana. Números honestos (AGENTS.md §5 "Consumo"):
 * contexto sem janela conhecida diz "não sei", limite da assinatura não aparece porque o Claude
 * Code não o expõe, e o que foi contado aqui sai marcado como estimativa.
 */

/** Fração da janela que acende o aviso, a mesma do serviço (AGENTS.md §2 Nuno). */
export const LIMITE_CONTEXTO = 0.8;

/** Dias do gráfico de uso, hoje incluído. */
export const DIAS_GRAFICO = 7;

const ESTADOS: Readonly<Record<EstadoSessao, { texto: string; tom: TomSelo }>> = {
  trabalhando: { texto: "trabalhando", tom: "sucesso" },
  esperando: { texto: "esperando você", tom: "aviso" },
  terminou: { texto: "terminou", tom: "apagado" },
  erro: { texto: "erro", tom: "perigo" },
  parada: { texto: "parada", tom: "apagado" },
};

/** O estado com texto, como no quadro: "parada há 2 h" diz desde quando não há evento. */
export function estadoDaSessao(sessao: SessaoIa, agora: Date): { texto: string; tom: TomSelo } {
  const base = ESTADOS[sessao.estado];
  if (sessao.estado === "parada" && sessao.ultimoEventoEm) {
    return { ...base, texto: `parada ${haQuanto(sessao.ultimoEventoEm, agora)}` };
  }
  return base;
}

export interface ContextoMostrado {
  /** Percentual inteiro da janela; `null` quando não há janela conhecida. */
  pct: number | null;
  texto: string;
  /** Passou de 80%: barra e número em aviso. */
  alto: boolean;
}

/**
 * O contexto da sessão; sem número da ferramenta, a área diz que não sabe em vez de inventar. A
 * porcentagem arredonda para baixo, como a do serviço: 79,9% ainda não é 80%, nem na tela.
 */
export function contextoDaSessao(sessao: SessaoIa): ContextoMostrado {
  const contexto = sessao.contexto;
  if (!contexto) return { pct: null, texto: "não sei", alto: false };
  const pct = Math.floor((contexto.usadoTokens * 100) / contexto.janelaTokens);
  return {
    pct,
    texto: `${pct}%`,
    alto: contexto.usadoTokens >= contexto.janelaTokens * LIMITE_CONTEXTO,
  };
}

/** Verbos das ferramentas do Claude Code na linha da sessão ("Editando src/appbar.rs"). */
const VERBOS: Readonly<Record<string, string>> = {
  Bash: "Rodando",
  Edit: "Editando",
  MultiEdit: "Editando",
  NotebookEdit: "Editando",
  Write: "Escrevendo",
  Read: "Lendo",
  Grep: "Buscando",
  Glob: "Procurando",
  WebFetch: "Abrindo",
  WebSearch: "Pesquisando",
  Task: "Delegando",
};

/** Ferramentas cujo resumo é um caminho de arquivo, mostrado a partir da pasta do projeto. */
const DE_ARQUIVO = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write", "Read"]);

/** `V:\projeto\src\a.rs` vira `src/a.rs` quando está dentro do projeto; fora dele, fica inteiro. */
export function caminhoNoProjeto(caminho: string, projeto: string | null): string {
  if (!projeto) return caminho;
  const normalizar = (c: string) => c.replace(/\\/g, "/").replace(/\/+$/, "");
  const arquivo = normalizar(caminho);
  const raiz = normalizar(projeto);
  if (arquivo.toLowerCase().startsWith(`${raiz.toLowerCase()}/`)) return arquivo.slice(raiz.length + 1);
  return caminho;
}

/**
 * O que a sessão fez por último, em uma linha, pelo último evento do hook. O pedido do usuário não
 * aparece: o serviço nem guarda (é conversa dele, fica no transcript).
 */
export function ultimaAcao(evento: EventoSessao | null, projeto: string | null): string | null {
  if (!evento) return null;
  const ferramenta = evento.ferramentaUsada;
  const resumo =
    evento.entradaResumo && ferramenta && DE_ARQUIVO.has(ferramenta)
      ? caminhoNoProjeto(evento.entradaResumo, projeto)
      : evento.entradaResumo;
  switch (evento.tipo) {
    case "PreToolUse":
    case "PostToolUse": {
      if (!ferramenta) return resumo;
      const verbo = VERBOS[ferramenta];
      if (verbo) return resumo ? `${verbo} ${resumo}` : verbo;
      return `Usando ${ferramenta}`;
    }
    case "PostToolUseFailure":
      return ferramenta ? `${ferramenta} falhou` : "Uma ferramenta falhou";
    case "PermissionRequest":
      if (ferramenta === "Bash" && resumo) return `Pediu para rodar ${resumo}`;
      return ferramenta ? `Pediu para usar ${ferramenta}` : "Pediu permissão";
    case "Notification":
      return resumo ?? "Avisou no terminal";
    case "UserPromptSubmit":
      return "Recebeu um pedido seu";
    case "Stop":
      return "Terminou o turno";
    case "SubagentStop":
      return "Um subagente terminou";
    case "PreCompact":
      return "Compactando o contexto";
    case "SessionStart":
      return "Abriu a sessão";
    case "SessionEnd":
      return "Encerrou a sessão";
    default:
      return resumo;
  }
}

const NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const DOLAR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tokens curtos: "820", "12,4 mil", "1,2 mi". */
export function formatarTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${NUMERO.format(tokens / 1000)} mil`;
  return `${NUMERO.format(tokens / 1_000_000)} mi`;
}

/** Microdólares em "US$ 1,86". */
export function formatarDolares(microdolares: number): string {
  return `US$ ${DOLAR.format(microdolares / 1_000_000)}`;
}

const totalDe = (u: UsoIa) => u.tokensEntrada + u.tokensSaida + u.tokensCache;

export interface GastoMostrado {
  texto: string;
  /** O que o leitor de tela lê quando o texto visível é curto demais ("cerca de"). */
  rotulo: string;
  vazio: boolean;
}

/**
 * O gasto de hoje da sessão, pelo `uso_ia` do projeto e da ferramenta dela: custo quando todas as
 * linhas têm preço (sempre estimativa, pela tabela do serviço); senão, os tokens. Assinatura e
 * modelo sem preço ficam sem custo, nunca com zero.
 */
export function gastoDeHoje(uso: readonly UsoIa[], sessao: SessaoIa, hoje: string): GastoMostrado {
  const linhas = uso.filter(
    (u) => u.dia === hoje && u.ferramenta === sessao.ferramenta && u.projetoId === sessao.projetoId,
  );
  if (linhas.length === 0) return { texto: "sem uso", rotulo: "sem uso registrado hoje", vazio: true };
  const comCusto = linhas.every((u) => u.custoEstimadoMicrodolares !== null);
  if (comCusto) {
    const custo = formatarDolares(linhas.reduce((s, u) => s + (u.custoEstimadoMicrodolares ?? 0), 0));
    return { texto: `≈ ${custo}`, rotulo: `cerca de ${custo}, estimativa`, vazio: false };
  }
  const tokens = `${formatarTokens(linhas.reduce((s, u) => s + totalDe(u), 0))} tokens`;
  const estimativa = linhas.some((u) => u.fonte === "estimativa");
  return estimativa
    ? { texto: `≈ ${tokens}`, rotulo: `cerca de ${tokens}, estimativa`, vazio: false }
    : { texto: tokens, rotulo: tokens, vazio: false };
}

const DIA_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export interface DiaDeUso {
  dia: string;
  rotulo: string;
  tokens: number;
  /** Altura da barra, de 0 a 100, contra o maior dia da semana. */
  pct: number;
  hoje: boolean;
}

export interface SemanaDeUso {
  dias: DiaDeUso[];
  total: number;
  /** Algum número foi contado pelo Moductus, não informado pela ferramenta. */
  estimativa: boolean;
}

/** O primeiro e o último dia do gráfico (os 7 dias até hoje), para pedir `sessoes.uso`. */
export function periodoDoGrafico(agora: Date): { de: string; ate: string } {
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - (DIAS_GRAFICO - 1));
  return { de: diaLocal(inicio), ate: diaLocal(agora) };
}

/** Tokens por dia nos últimos 7 dias, todas as ferramentas somadas; dia sem uso fica com zero. */
export function semanaDeUso(uso: readonly UsoIa[], agora: Date): SemanaDeUso {
  const porDia = new Map<string, number>();
  for (const u of uso) porDia.set(u.dia, (porDia.get(u.dia) ?? 0) + totalDe(u));
  const hoje = diaLocal(agora);
  const dias: Omit<DiaDeUso, "pct">[] = [];
  for (let i = DIAS_GRAFICO - 1; i >= 0; i--) {
    const data = new Date(agora);
    data.setDate(data.getDate() - i);
    const dia = diaLocal(data);
    dias.push({
      dia,
      rotulo: DIA_DA_SEMANA[data.getDay()]!,
      tokens: porDia.get(dia) ?? 0,
      hoje: dia === hoje,
    });
  }
  const maior = Math.max(0, ...dias.map((d) => d.tokens));
  const dentro = new Set(dias.map((d) => d.dia));
  return {
    dias: dias.map((d) => ({ ...d, pct: maior > 0 ? Math.round((d.tokens / maior) * 100) : 0 })),
    total: dias.reduce((s, d) => s + d.tokens, 0),
    estimativa: uso.some((u) => dentro.has(u.dia) && u.fonte === "estimativa"),
  };
}

/** Junta uma sessão que mudou à lista: a que já estava troca de lugar com a nova, que vai ao topo. */
export function juntarSessao(lista: ListaSessoes, { sessao, projeto }: MudancaSessao): ListaSessoes {
  const sessoes = [sessao, ...lista.sessoes.filter((s) => s.id !== sessao.id)];
  const projetos = projeto ? [...lista.projetos.filter((p) => p.id !== projeto.id), projeto] : lista.projetos;
  return { projetos, sessoes };
}

export interface DadosSessoes {
  lista: ListaSessoes;
  uso: UsoIa[];
  /** A ligação dos hooks do Claude Code; `null` enquanto o serviço não disse. */
  conexao: Conexao | null;
}

/** A ligação dos hooks está de pé: as sessões novas do Claude Code chegam aqui. */
export const claudeCodeLigado = (conexao: Conexao | null) => conexao?.estado === "ligada";

/**
 * As ferramentas acompanhadas, na ordem do contrato, para o alto da área: o Claude Code quando os
 * hooks estão ligados e toda ferramenta que tem sessão na lista. Nada de ferramenta só prometida.
 */
export function ferramentasAcompanhadas({ lista, conexao }: DadosSessoes): FerramentaSessao[] {
  const presentes = new Set<FerramentaSessao>(lista.sessoes.map((s) => s.ferramenta));
  if (claudeCodeLigado(conexao)) presentes.add("claude-code");
  return FERRAMENTAS_SESSAO.filter((f) => presentes.has(f));
}

/** O nome do projeto de cada sessão; a que ainda não virou projeto fica sem nome. */
export function nomesDosProjetos(lista: ListaSessoes): ReadonlyMap<string, Projeto> {
  return new Map(lista.projetos.map((p) => [p.id, p]));
}

/** Depois de uma sessão mudar, o uso é relido uma vez neste intervalo, não a cada evento. */
export const ESPERA_USO_MS = 3000;

/**
 * As sessões, o uso da semana e a ligação do Claude Code, pelo canal: a lista ao conectar e cada
 * mudança depois (`sessoes.mudou`, `conexoes.mudou`). O uso não tem aviso próprio: muda quando o
 * serviço lê o transcript, que sempre vem com uma sessão mudando. Mudança que chega enquanto a
 * lista está a caminho é aplicada de novo sobre ela. Sem conexão, `null`.
 */
export function useDadosSessoes(canal: EstadoConexao, agora: Date): DadosSessoes | null {
  const [lista, setLista] = useState<ListaSessoes | null>(null);
  const [uso, setUso] = useState<UsoIa[]>([]);
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [releituraUso, setReleituraUso] = useState(0);
  const durante = useRef<MudancaSessao[] | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoje = diaLocal(agora);

  useEffect(() => {
    const paradas = [
      servico.ouvir("sessoes.mudou", (mudanca) => {
        durante.current?.push(mudanca);
        setLista((l) => (l ? juntarSessao(l, mudanca) : l));
        if (espera.current === null) {
          espera.current = setTimeout(() => {
            espera.current = null;
            setReleituraUso((n) => n + 1);
          }, ESPERA_USO_MS);
        }
      }),
      servico.ouvir("conexoes.mudou", (c) => {
        if (c.tipo === "hooks-claude-code") setConexao(c);
      }),
    ];
    return () => {
      paradas.forEach((parar) => parar());
      if (espera.current !== null) clearTimeout(espera.current);
      espera.current = null;
    };
  }, []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    const mudancas: MudancaSessao[] = [];
    durante.current = mudancas;
    Promise.all([servico.pedir("sessoes.listar"), servico.pedir("conexoes.listar")])
      .then(([carga, conexoes]) => {
        if (!vivo) return;
        setLista(mudancas.reduce(juntarSessao, carga));
        setConexao(conexoes.find((c) => c.tipo === "hooks-claude-code") ?? null);
      })
      .catch(() => {
        if (vivo) setLista(null);
      })
      .finally(() => {
        if (durante.current === mudancas) durante.current = null;
      });
    return () => {
      vivo = false;
      if (durante.current === mudancas) durante.current = null;
      setLista(null);
    };
  }, [canal]);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("sessoes.uso", periodoDoGrafico(new Date(`${hoje}T12:00:00`)))
      .then((linhas) => {
        if (vivo) setUso(linhas);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [canal, hoje, releituraUso]);

  return canal === "conectado" && lista ? { lista, uso, conexao } : null;
}
