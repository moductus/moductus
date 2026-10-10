import {
  TIPOS_PROVEDOR_CLI,
  type Agente as AgenteServico,
  type Aprovacao,
  type Execucao,
  type ItemGithub,
  type Provedor,
  type SessaoIa,
} from "@moductus/contrato";
import { AGENTES, DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";
import { ateQuando, quando } from "../../componentes/personagem/quando.ts";
import {
  eFalhaDoProvedor,
  falaDaFalha,
  type FalaCartao,
  fraseDaSituacao,
  modeloDoAgente,
  naFila,
  type LeituraSituacao,
  type ModeloDoAgente,
} from "../../componentes/personagem/situacao.ts";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { contextoDaSessao } from "../../areas/sessoes/sessoes.ts";

/**
 * O painel Agentes (Agentes.dc.html) e os estados do time (Estados.dc.html) lidos dos dados
 * reais: o que cada um está fazendo, quem espera você e o cartão de cada estado que pede uma
 * decisão (sono, erro de provedor, teto e pausa). Quem decide o estado é o runtime; aqui só se
 * diz em texto, na voz do agente (até duas frases, número antes de adjetivo).
 */

/** Os quatro de fábrica com o que o serviço disse de cada um; quem não veio fica de fora. */
export type TimeDoServico = Partial<Record<Agente, AgenteServico>>;

export function timeDoServico(lista: readonly AgenteServico[]): TimeDoServico {
  const time: TimeDoServico = {};
  for (const a of lista) if ((AGENTES as readonly string[]).includes(a.id)) time[a.id as Agente] = a;
  return time;
}

/** Sem nenhum agente com modelo: o painel mostra o convite de sempre, com o time dormindo. */
export function timeSemModelo(time: TimeDoServico): boolean {
  const lidos = AGENTES.map((a) => time[a]).filter((a) => a !== undefined);
  return (
    lidos.length === 0 ||
    lidos.every((a) => a.situacao.estado === "dormindo" && a.situacao.motivoSono === "sem_modelo")
  );
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Sessões diferentes com pedido esperando você (um pedido sem sessão conta sozinho). */
export function sessoesEsperando(pedidos: readonly Aprovacao[]): number {
  const pendentes = pedidos.filter((p) => p.estado === "pendente");
  const sessoes = new Set(pendentes.map((p) => p.sessaoId ?? `pedido:${p.id}`));
  return sessoes.size;
}

/**
 * A linha do alto do painel ("1 trabalhando · 2 esperando você"): quem trabalha agora e quem
 * espera você, agentes do time e sessões do terminal juntos.
 */
export function resumoDoTime(time: TimeDoServico, pedidosDoTerminal: readonly Aprovacao[]): string {
  let trabalhando = 0;
  let esperando = sessoesEsperando(pedidosDoTerminal);
  for (const id of AGENTES) {
    const s = time[id]?.situacao;
    if (s?.estado !== "ativo") continue;
    if (s.atividade === "trabalhando") trabalhando++;
    if (s.atividade === "esperando") esperando++;
  }
  const partes: string[] = [];
  if (trabalhando > 0) partes.push(`${trabalhando} trabalhando`);
  partes.push(esperando > 0 ? `${esperando} esperando você` : "ninguém esperando você");
  return partes.join(" · ");
}

/** A última execução de cada agente, da lista que vem da mais nova para a mais antiga. */
export function ultimaDeCada(execucoes: readonly Execucao[]): Partial<Record<string, Execucao>> {
  const ultima: Partial<Record<string, Execucao>> = {};
  for (const e of execucoes) ultima[e.agenteId] ??= e;
  return ultima;
}

/**
 * O que o Nuno tem para você, das sessões e do GitHub ("api-pedidos usou 84% do contexto · 2
 * PRs esperam você"); `null` quando não há nada.
 */
export function linhaDoNuno(
  sessoes: readonly SessaoIa[],
  nomeDoProjeto: (sessao: SessaoIa) => string | null,
  esperandoNoTerminal: number,
  github: readonly ItemGithub[],
): string | null {
  const partes: string[] = [];
  if (esperandoNoTerminal > 0) {
    partes.push(plural(esperandoNoTerminal, "sessão esperando você", "sessões esperando você"));
  }
  const cheia = sessoes.find((s) => s.encerradaEm === null && contextoDaSessao(s).alto);
  if (cheia) {
    const { pct } = contextoDaSessao(cheia);
    partes.push(`${nomeDoProjeto(cheia) ?? "Uma sessão"} usou ${pct}% do contexto`);
  }
  const precisam = github.filter((i) => i.estado === "aberto" && i.precisaDeMim);
  if (precisam.length > 0) {
    const soPrs = precisam.every((i) => i.tipo === "pr");
    partes.push(
      soPrs
        ? plural(precisam.length, "PR espera você", "PRs esperam você")
        : plural(precisam.length, "item do GitHub espera você", "itens do GitHub esperam você"),
    );
  }
  return partes.length > 0 ? partes.slice(0, 2).join(" · ") : null;
}

/** "Trabalhando desde 14:05", com a fila quando há mais pedidos esperando a vez. */
function trabalhando(execucao: Execucao | undefined, fila: number): string {
  const inicio = execucao?.estado === "rodando" && execucao.inicio ? new Date(execucao.inicio) : null;
  const desde = inicio
    ? `Trabalhando desde ${inicio.getHours()}:${String(inicio.getMinutes()).padStart(2, "0")}`
    : "Trabalhando agora";
  const espera = naFila(fila);
  return espera ? `${desde} · ${espera}` : desde;
}

/**
 * A linha de cada agente no "Seu time": o que está fazendo, o que espera de você ou quando volta.
 * Ocioso, mostra o resumo do último trabalho; sem nenhum, a função dele. O `modelo` diz se a
 * falha de credencial é login (CLI) ou chave (API).
 */
export function linhaDoAgente(
  id: Agente,
  agente: AgenteServico | undefined,
  leitura: LeituraSituacao,
  execucao: Execucao | undefined,
  pedido: Aprovacao | undefined,
  agora: Date,
  modelo: ModeloDoAgente | null = null,
): string {
  const funcao = DADOS_AGENTES[id].funcao;
  const s = agente?.situacao;
  if (!s) return leitura.dica ?? funcao;
  // Parado: a mesma frase da página do agente e da conversa (fraseDaSituacao).
  const parado = fraseDaSituacao(s, agora, modelo);
  if (parado !== null) return parado;
  switch (s.atividade) {
    case "trabalhando":
      return trabalhando(execucao, s.fila);
    case "esperando":
      return pedido?.descricao ?? "Esperando sua resposta";
    case "erro":
      return execucao?.erro ?? "A última execução deu erro";
    case "ocioso":
      return execucao?.estado === "ok" && execucao.resumo ? execucao.resumo : funcao;
  }
  return funcao;
}

/** Tipos de cartão do Estados.dc.html que o painel mostra: o que pede uma decisão sua. */
export type TipoEstado = "pausa" | "limite" | "falha" | "teto";

/** O que os botões do cartão fazem; quem decide é o serviço ou a tela de Modelos. */
export type AcaoEstado =
  { tipo: "retomar"; agenteIds?: string[] } | { tipo: "modelos" } | { tipo: "dispensar" };

export interface CartaoEstado {
  /** Muda quando o estado muda: dispensar um cartão vale só para aquele sono. */
  chave: string;
  tipo: TipoEstado;
  agentes: Agente[];
  /** Quem está nesse estado ("Alba, Tula e Nuno"). */
  quem: string;
  /** O status no selo, como no quadro: "pausado", "dormindo", "erro", "parado". */
  estado: { texto: string; tom: TomSelo };
  titulo: string;
  /** A fala; o comando do terminal, quando há, vem no campo próprio e aparece como código. */
  texto: string;
  comando?: FalaCartao["comando"];
  primaria: { texto: string; acao: AcaoEstado };
  secundaria?: { texto: string; acao: AcaoEstado };
}

/** "Alba", "Alba e Tula", "Alba, Tula e Nuno". */
export function listaDeNomes(agentes: readonly Agente[]): string {
  const nomes = agentes.map((a) => DADOS_AGENTES[a].nome);
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

/** Os CLIs rodam com a conta do usuário: "sua assinatura" (Agentes.dc.html). */
const eAssinatura = (p: Provedor) => (TIPOS_PROVEDOR_CLI as readonly string[]).includes(p.tipo);

/**
 * Os cartões de estado do time, na ordem do Estados.dc.html: pausa, limite, erro de provedor e
 * teto. Quem está no mesmo estado pelo mesmo motivo divide um cartão, e a fala passa ao plural.
 */
export function cartoesDeEstado(
  time: TimeDoServico,
  provedores: readonly Provedor[],
  agora: Date,
): CartaoEstado[] {
  const grupos = new Map<string, { tipo: TipoEstado; agentes: Agente[]; modelo: AgenteServico }>();
  const juntar = (chave: string, tipo: TipoEstado, id: Agente, agente: AgenteServico) => {
    const grupo = grupos.get(chave);
    if (grupo) grupo.agentes.push(id);
    else grupos.set(chave, { tipo, agentes: [id], modelo: agente });
  };
  const ligados = AGENTES.filter((id) => time[id] && time[id].situacao.estado !== "desligado");
  for (const id of ligados) {
    const agente = time[id]!;
    const s = agente.situacao;
    if (s.estado === "pausado") juntar(`pausa:${s.pausadoAte}`, "pausa", id, agente);
    if (s.estado !== "dormindo") continue;
    const sono = `${agente.provedorId}:${s.dormeAte}`;
    if (s.motivoSono === "limite") juntar(`limite:${sono}`, "limite", id, agente);
    if (eFalhaDoProvedor(s.motivoSono)) {
      juntar(`falha:${s.motivoSono}:${sono}`, "falha", id, agente);
    }
    if (s.motivoSono === "teto") juntar(`teto:${s.dormeAte}`, "teto", id, agente);
  }

  const ordem: TipoEstado[] = ["pausa", "limite", "falha", "teto"];
  return [...grupos.entries()]
    .sort(([, a], [, b]) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo))
    .map(([chave, { tipo, agentes, modelo }]) => {
      const varios = agentes.length > 1;
      const s = modelo.situacao;
      const provedor = modeloDoAgente(modelo.provedorId, provedores);
      const base = { chave, tipo, agentes, quem: listaDeNomes(agentes) };
      switch (tipo) {
        case "pausa": {
          const ate = s.pausadoAte ? ateQuando(s.pausadoAte, agora) : null;
          const todos = agentes.length === ligados.length && varios;
          return {
            ...base,
            estado: { texto: "pausado", tom: "neutro" },
            titulo: `${todos ? "Time pausado" : `${listaDeNomes(agentes)} em pausa`} ${ate ?? "até você retomar"}`,
            // A pausa pode vir da bandeja ou da página do agente: o texto não diz de onde.
            texto: todos
              ? "Ninguém usa modelo nem mexe em nada até lá."
              : "Nada roda com modelo até lá; o resto do time segue normal.",
            primaria: {
              texto: "Retomar agora",
              // O time inteiro retoma de uma vez; um grupo, cada um do grupo (e só ele).
              acao: todos ? { tipo: "retomar" } : { tipo: "retomar", agenteIds: [...agentes] },
            },
          };
        }
        case "limite": {
          const volta = s.dormeAte ? quando(s.dormeAte, agora, "longa") : null;
          const quandoVolta = volta ? `${volta}, quando ele renova` : "quando ele renovar";
          return {
            ...base,
            estado: { texto: "dormindo", tom: "neutro" },
            titulo: `O limite ${provedor ? `do ${provedor.nome}` : "do modelo"} acabou`,
            texto: `${varios ? "Voltamos" : "Volto"} ${quandoVolta}. O que não precisa de modelo continua.`,
            primaria: { texto: "Usar outro modelo", acao: { tipo: "modelos" } },
            secundaria: { texto: "Esperar", acao: { tipo: "dispensar" } },
          };
        }
        case "falha": {
          // A chave do grupo leva o motivo: todos caíram pela mesma falha (a guarda é para o tipo).
          const motivo = eFalhaDoProvedor(s.motivoSono) ? s.motivoSono : "fora_do_ar";
          return {
            ...base,
            estado: { texto: "erro", tom: "perigo" },
            titulo: "Não consegui falar com o modelo",
            ...falaDaFalha(motivo, provedor, s.dormeAte, agora, varios),
            primaria: { texto: "Trocar modelo", acao: { tipo: "modelos" } },
          };
        }
        case "teto":
          // Sem a moeda do teto decidida, o valor não aparece (números honestos).
          return {
            ...base,
            estado: { texto: "parado", tom: "aviso" },
            titulo: varios ? "Chegamos ao teto de hoje" : "Cheguei ao teto de hoje",
            texto: `${varios ? "Paramos" : "Paro"} até meia-noite, a menos que você mude o teto em Modelos.`,
            primaria: { texto: "Mudar o teto", acao: { tipo: "modelos" } },
            secundaria: { texto: "Parar até amanhã", acao: { tipo: "dispensar" } },
          };
      }
    });
}

/** O que o rodapé diz do modelo do time e para onde o "Trocar" leva. */
export interface ModeloDoTime {
  texto: string;
  acao: string;
}

/** "Modelo dos agentes: Claude Code, sua assinatura" (Agentes.dc.html), pelos modelos de cada um. */
export function modeloDoTime(time: TimeDoServico, provedores: readonly Provedor[]): ModeloDoTime {
  const ids = new Set(
    AGENTES.map((a) => time[a])
      .filter((a) => a !== undefined && a.situacao.estado !== "desligado")
      .map((a) => a!.provedorId)
      .filter((id) => id !== null),
  );
  const usados = provedores.filter((p) => ids.has(p.id));
  if (usados.length === 0) return { texto: "Nenhum modelo conectado ao time", acao: "Conectar" };
  if (usados.length === 1) {
    const [p] = usados;
    return {
      texto: `Modelo dos agentes: ${p!.nome}${eAssinatura(p!) ? ", sua assinatura" : ""}`,
      acao: "Trocar",
    };
  }
  const nomes = usados.map((p) => p.nome);
  return {
    texto: `Modelos dos agentes: ${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`,
    acao: "Trocar",
  };
}
