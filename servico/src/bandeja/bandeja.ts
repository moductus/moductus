import type { Agente, PedidoPausar, PedidoRetomar } from "@moductus/contrato";
import { inicioDoDiaSeguinte } from "../agentes/estado.ts";
import type { CanalCasca } from "../casca/canal.ts";

/**
 * Pausar pela bandeja (AGENTS.md §6 "Pausar"): o menu do ícone na bandeja mostra o estado de cada
 * agente e pausa o time ou um só, por 30 minutos, 1 hora ou até amanhã. A regra mora aqui: o
 * serviço monta o menu (textos, o que está habilitado) e interpreta o clique; a casca só desenha o
 * menu nativo do Windows e devolve o id do item clicado (`src-tauri/src/bandeja.rs`).
 *
 * Pausado, o agente não chama o modelo; os vigias e o agendador continuam anotando, e o que chega
 * fica na fila dele, que roda ao retomar (agentes/estado.ts).
 */

/** Tipo do aviso que leva o menu à casca, sem pedido: ela só redesenha. */
export const MENU_DA_BANDEJA = "bandeja";

/** Tipo do aviso que a casca manda, sem pedido, quando o usuário escolhe um item do serviço. */
export const CLIQUE_NA_BANDEJA = "bandeja-clique";

/** Por quanto tempo a bandeja pausa. "Até amanhã" vai até a meia-noite, como o teto do dia. */
export const DURACOES = ["30min", "1h", "amanha"] as const;
export type DuracaoPausa = (typeof DURACOES)[number];

const ROTULO_DURACAO: Readonly<Record<DuracaoPausa, string>> = {
  "30min": "30 minutos",
  "1h": "1 hora",
  amanha: "amanhã",
};

/** Um item do menu como a casca recebe: opção (com submenu ou não) ou separador. */
export type ItemBandeja =
  { id: string; rotulo: string; habilitado: boolean; itens?: ItemBandeja[] } | { separador: true };

/** O que a casca desenha: a dica do ícone e os itens do serviço, entre os fixos dela. */
export interface MenuBandeja {
  dica: string;
  itens: ItemBandeja[];
}

/** O clique que a bandeja relata, já entendido. `agenteId` ausente é o time todo. */
export type AcaoBandeja =
  { acao: "pausar"; agenteId?: string; por: DuracaoPausa } | { acao: "retomar"; agenteId?: string };

/** No id do item, `*` é o time todo. */
const TODOS = "*";

const SEPARADOR: ItemBandeja = { separador: true };

/** Quando acaba a pausa pedida agora. */
export function fimDaPausa(por: DuracaoPausa, agora: Date): string {
  switch (por) {
    case "30min":
      return new Date(agora.getTime() + 30 * 60_000).toISOString();
    case "1h":
      return new Date(agora.getTime() + 60 * 60_000).toISOString();
    case "amanha":
      return inicioDoDiaSeguinte(agora).toISOString();
  }
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Até quando, no relógio local, sem palavra relativa ("amanhã" ficaria errado depois da
 * meia-noite, e o menu só muda quando o estado muda): meia-noite pelo nome, menos de um dia pela
 * hora, mais longe com a data.
 */
export function ateQuando(ate: string, agora: Date): string {
  const fim = new Date(ate);
  if (fim.getHours() === 0 && fim.getMinutes() === 0) {
    if (fim.getTime() - agora.getTime() <= 24 * 3_600_000) return "até meia-noite";
  }
  const hora = `${doisDigitos(fim.getHours())}:${doisDigitos(fim.getMinutes())}`;
  if (fim.getTime() - agora.getTime() < 24 * 3_600_000) return `até ${hora}`;
  return `até ${doisDigitos(fim.getDate())}/${doisDigitos(fim.getMonth() + 1)}, ${hora}`;
}

/**
 * O estado do agente numa linha, com as mesmas palavras do Sistema (componentes/personagem/
 * situacao.ts). O menu mostra o estado guardado, não a atividade: assim ele não se refaz a cada
 * execução. Pausado ou dormindo, diz quantos pedidos esperam para rodar na volta.
 */
export function estadoEmTexto(situacao: Agente["situacao"], agora: Date): string {
  const naFila = situacao.fila > 0 ? `, ${situacao.fila} na fila` : "";
  switch (situacao.estado) {
    case "desligado":
      return "desligado";
    case "pausado":
      return `pausado ${situacao.pausadoAte ? ateQuando(situacao.pausadoAte, agora) : "até retomar"}${naFila}`;
    case "dormindo":
      if (situacao.motivoSono === "sem_modelo") return "sem modelo";
      if (situacao.motivoSono === "teto") return `parado no teto de hoje${naFila}`;
      return `dormindo${situacao.dormeAte ? ` ${ateQuando(situacao.dormeAte, agora)}` : ""}${naFila}`;
    case "ativo":
      return "ativo";
  }
}

const idPausar = (alvo: string, por: DuracaoPausa) => `pausar:${alvo}:${por}`;
const idRetomar = (alvo: string) => `retomar:${alvo}`;

/** "Por 30 minutos" no submenu do time; "Pausar por 30 minutos" no de um agente. */
const opcoesDePausa = (alvo: string, comVerbo: boolean): ItemBandeja[] =>
  DURACOES.map((por) => {
    const quanto = `${por === "amanha" ? "até" : "por"} ${ROTULO_DURACAO[por]}`;
    return {
      id: idPausar(alvo, por),
      rotulo: comVerbo ? `Pausar ${quanto}` : quanto.charAt(0).toUpperCase() + quanto.slice(1),
      habilitado: true,
    };
  });

/**
 * O menu do time: pausar todos (e retomar todos, quando alguém está pausado), depois uma linha
 * por agente com o estado e, no submenu, pausar ou retomar só ele. Desligado aparece, sem ação:
 * ligar de novo é no Sistema.
 */
export function montarMenu(agentes: readonly Agente[], agora: Date): MenuBandeja {
  const ligados = agentes.filter((a) => a.situacao.estado !== "desligado");
  const pausados = ligados.filter((a) => a.situacao.estado === "pausado");
  const itens: ItemBandeja[] = [
    {
      id: "pausar-todos",
      rotulo: "Pausar todos os agentes",
      habilitado: ligados.length > 0,
      itens: opcoesDePausa(TODOS, false),
    },
  ];
  if (pausados.length > 0) {
    itens.push({ id: idRetomar(TODOS), rotulo: "Retomar todos os agentes", habilitado: true });
  }
  itens.push(SEPARADOR);
  for (const agente of agentes) {
    const rotulo = `${agente.nome}: ${estadoEmTexto(agente.situacao, agora)}`;
    if (agente.situacao.estado === "desligado") {
      itens.push({ id: `agente:${agente.id}`, rotulo, habilitado: false });
      continue;
    }
    const pausado = agente.situacao.estado === "pausado";
    itens.push({
      id: `agente:${agente.id}`,
      rotulo,
      habilitado: true,
      itens: [
        ...(pausado
          ? [{ id: idRetomar(agente.id), rotulo: "Retomar agora", habilitado: true }, SEPARADOR]
          : []),
        ...opcoesDePausa(agente.id, true),
      ],
    });
  }
  return { dica: dicaDoIcone(ligados.length, pausados), itens };
}

/** A dica do ícone: "Moductus" e, se houver, quem está pausado. */
function dicaDoIcone(ligados: number, pausados: readonly Agente[]): string {
  if (pausados.length === 0) return "Moductus";
  if (pausados.length === ligados) return "Moductus: agentes pausados";
  return `Moductus: ${pausados.map((a) => a.nome).join(", ")} em pausa`;
}

/** O id do item clicado vira a ação; id de outra coisa é `null`. */
export function lerClique(item: unknown): AcaoBandeja | null {
  if (typeof item !== "string") return null;
  const partes = item.split(":");
  const alvo = partes[1];
  if (!alvo) return null;
  const agenteId = alvo === TODOS ? {} : { agenteId: alvo };
  if (partes[0] === "retomar" && partes.length === 2) return { acao: "retomar", ...agenteId };
  const por = partes[2] as DuracaoPausa | undefined;
  if (partes[0] === "pausar" && partes.length === 3 && por && DURACOES.includes(por)) {
    return { acao: "pausar", ...agenteId, por };
  }
  return null;
}

export interface DependenciasBandeja {
  agentes: {
    listar(): Agente[];
    pausar(pedido: PedidoPausar): unknown;
    retomar(pedido: PedidoRetomar): unknown;
  };
  canal: Pick<CanalCasca, "avisar" | "aoAvisar">;
  agora?: () => Date;
}

/**
 * Liga a bandeja ao time: escuta o clique da casca e devolve `atualizar`, que o serviço chama a
 * cada mudança de agente. O menu só vai à casca quando muda, para não refazer o menu nativo à toa.
 */
export function ligarBandeja(deps: DependenciasBandeja): { atualizar(): void } {
  const agora = deps.agora ?? (() => new Date());
  let ultimo = "";
  const atualizar = () => {
    const menu = montarMenu(deps.agentes.listar(), agora());
    const linha = JSON.stringify(menu);
    if (linha === ultimo) return;
    ultimo = linha;
    deps.canal.avisar({ tipo: MENU_DA_BANDEJA, ...menu });
  };
  deps.canal.aoAvisar(CLIQUE_NA_BANDEJA, (aviso) => {
    const acao = lerClique(aviso.item);
    if (!acao) return;
    const alvo = acao.agenteId !== undefined ? { agenteId: acao.agenteId } : {};
    try {
      if (acao.acao === "pausar") deps.agentes.pausar({ ...alvo, ate: fimDaPausa(acao.por, agora()) });
      else deps.agentes.retomar(alvo);
    } catch (erro) {
      // O estado mudou entre abrir o menu e clicar (o agente foi desligado): o menu se refaz.
      console.error(`bandeja: ${acao.acao} falhou: ${String(erro)}`);
    }
    atualizar();
  });
  return { atualizar };
}
