import {
  NOTA_BLOCO_RAPIDO,
  type Destaque,
  type Nota,
  type Origem,
  type PedidoSalvarNota,
  type ResultadoBuscaNota,
  type ResumoNota,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico, type EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AGENTES, DADOS_AGENTES, eAgente, type Agente } from "../../componentes/personagem/agentes.ts";
import { servico } from "../../servico/conexao.ts";
import { comArtigo, noGenero } from "../agentes/nomes.ts";
import type { Leitura } from "../leitura.ts";
import { haQuanto } from "../tempo.ts";
import { NOTA_SUMIU, RascunhoNota, type EstadoRascunho } from "./salvamento.ts";

/**
 * Notas (PRODUCT.md §5, AreaNotas.dc.html, PainelNotas.dc.html) lidas do serviço (F3-19): a lista,
 * a busca sem acento, as tarefas que nasceram de uma nota e o texto aberto, que salva sozinho
 * (`salvamento.ts`). A regra (versão, conflito, bloco rápido que esvazia) é do serviço; aqui só se
 * lê, se junta e se diz em texto.
 */

export const ehBlocoRapido = (id: string) => id === NOTA_BLOCO_RAPIDO;

/** Nota sem título aparece assim na lista e no alto do texto. */
export const SEM_TITULO = "Sem título";

export const tituloDaNota = (titulo: string) => titulo.trim() || SEM_TITULO;

const DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const MES = new Intl.DateTimeFormat("pt-BR", { month: "short" });

const inicioDoDia = (data: Date) => new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();

/** "2 out", "20 nov 2025": o mês curto sem o ponto, e o ano só quando não é o de agora. */
function diaEMes(data: Date, agora: Date): string {
  const mes = MES.format(data).replace(".", "");
  const ano = data.getFullYear() === agora.getFullYear() ? "" : ` ${data.getFullYear()}`;
  return `${data.getDate()} ${mes}${ano}`;
}

/**
 * Quando a nota mudou, como a lista escreve (AreaNotas.dc.html): "hoje", "ontem", "seg" na
 * semana e "2 out" antes disso. Instante inválido não vira data inventada.
 */
export function quandoDaNota(instante: string, agora: Date): string {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return "";
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(data)) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return DIA_SEMANA.format(data).replace(".", "");
  return diaEMes(data, agora);
}

/** O dia de uma tarefa (`AAAA-MM-DD`, no fuso do usuário) do jeito curto: "20 nov". */
export function diaDaTarefa(dia: string, agora: Date): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  if (!ano || !mes || !d) return dia;
  return diaEMes(new Date(ano, mes - 1, d), agora);
}

/** Um pedaço do trecho da busca e se ele bateu. */
export interface PedacoTrecho {
  texto: string;
  marcado: boolean;
}

/**
 * O trecho da busca em pedaços, pelas posições que o serviço manda (UTF-16, as mesmas do
 * JavaScript). Posição fora do texto, fora de ordem ou sobreposta é ignorada: nunca corta letra
 * nem repete pedaço.
 */
export function pedacosDoTrecho(trecho: string, destaques: readonly Destaque[]): PedacoTrecho[] {
  const pedacos: PedacoTrecho[] = [];
  let posicao = 0;
  for (const { inicio, fim } of [...destaques].sort((a, b) => a.inicio - b.inicio)) {
    if (inicio < posicao || fim > trecho.length || fim <= inicio) continue;
    if (inicio > posicao) pedacos.push({ texto: trecho.slice(posicao, inicio), marcado: false });
    pedacos.push({ texto: trecho.slice(inicio, fim), marcado: true });
    posicao = fim;
  }
  if (posicao < trecho.length) pedacos.push({ texto: trecho.slice(posicao), marcado: false });
  return pedacos;
}

/** Quem fez algo, pelo carimbo de origem: um agente do time ou você. */
export function agenteDaOrigem(origem: Origem, agenteId: string | null): Agente | null {
  return origem === "agente" && eAgente(agenteId) ? agenteId : null;
}

/** "criada pela Alba", na linha de baixo da nota que um agente escreveu (DESIGN.md §5 "Origem"). */
export function origemDaNota(nota: Pick<ResumoNota, "origem" | "agenteId">): string | null {
  const agente = agenteDaOrigem(nota.origem, nota.agenteId);
  if (agente) return `criada ${noGenero(agente, "pela", "pelo")} ${DADOS_AGENTES[agente].nome}`;
  return nota.origem === "agente" ? "criada por um agente" : null;
}

/** Uma linha de "Ligado a esta nota": quem criou e quantas, com as tarefas embaixo. */
export interface GrupoLigado {
  agente: Agente | null;
  texto: string;
  tarefas: Tarefa[];
}

const tarefas = (n: number) => `${n} ${n === 1 ? "tarefa" : "tarefas"}`;

/**
 * As tarefas que nasceram da nota, por quem as criou (AreaNotas.dc.html, "A Alba criou 2 tarefas
 * a partir dos itens marcados"): primeiro as dos agentes, na ordem do time, depois as suas.
 */
export function gruposLigados(lista: readonly Tarefa[]): GrupoLigado[] {
  const grupos: GrupoLigado[] = [];
  for (const agente of AGENTES) {
    const delas = lista.filter((t) => agenteDaOrigem(t.origem, t.agenteId) === agente);
    if (delas.length === 0) continue;
    const quem = comArtigo(agente);
    grupos.push({
      agente,
      texto: `${quem[0]?.toUpperCase()}${quem.slice(1)} criou ${tarefas(delas.length)} a partir desta nota.`,
      tarefas: delas,
    });
  }
  const suas = lista.filter((t) => agenteDaOrigem(t.origem, t.agenteId) === null);
  if (suas.length > 0) {
    const todasSuas = suas.every((t) => t.origem === "usuario");
    grupos.push({
      agente: null,
      texto: todasSuas
        ? `Você criou ${tarefas(suas.length)} a partir desta nota.`
        : `${suas.length === 1 ? "1 tarefa veio" : `${suas.length} tarefas vieram`} desta nota.`,
      tarefas: suas,
    });
  }
  return grupos;
}

/**
 * O que o alto do texto diz do salvamento: "salvo agora", "salvo há 5 min", "salvando". A nota
 * fixa do painel fala no feminino ("salva agora"), como no quadro.
 */
export function textoDoSalvo(
  estado: EstadoRascunho,
  agora: Date,
  palavra: "salvo" | "salva" = "salvo",
): string {
  switch (estado.situacao) {
    case "salvo":
      return `${palavra} ${haQuanto(estado.nota.atualizadoEm, agora)}`;
    case "esperando":
    case "salvando":
      return "salvando";
    case "falhou":
    case "conflito":
      return "não salvou";
    case "apagada":
      return "na Lixeira";
  }
}

// ---------- leituras ----------

/**
 * A lista de notas (a fixa primeiro, depois da mais mexida), lida ao conectar e de novo a cada
 * `notas.mudou`: o serviço monta o trecho de cada uma, e a lista mostra o mesmo em toda janela.
 * Uma queda curta do canal não apaga o que já foi lido.
 */
export function useNotas(canal: EstadoConexao): Leitura<ResumoNota[]> {
  const [lista, setLista] = useState<ResumoNota[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [mudou, setMudou] = useState(0);
  const tentarDeNovo = useCallback(() => {
    setFalhou(false);
    setTentativa((n) => n + 1);
  }, []);

  useEffect(() => servico.ouvir("notas.mudou", () => setMudou((n) => n + 1)), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("notas.listar", {})
      .then((carga) => {
        if (!vivo) return;
        setLista(carga);
        setFalhou(false);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [canal, tentativa, mudou]);

  if (lista) return { estado: "pronta", dados: lista };
  return falhou ? { estado: "falhou", tentarDeNovo } : { estado: "esperando" };
}

/** Espera depois da última letra antes de buscar. */
export const ESPERA_BUSCA_MS = 150;

/** O máximo que a busca aceita (contrato `PedidoBuscarNotas`). */
export const TAMANHO_BUSCA = 200;

/**
 * A busca sem acento nas notas, com o trecho e o que bateu. Sem texto, `null` (a lista volta).
 * Notas que mudam enquanto a busca está aberta buscam de novo.
 */
export function useBuscaNotas(canal: EstadoConexao, texto: string): Leitura<ResultadoBuscaNota[]> | null {
  const pedido = texto.trim().slice(0, TAMANHO_BUSCA);
  const [resposta, setResposta] = useState<{ pedido: string; itens: ResultadoBuscaNota[] | null } | null>(
    null,
  );
  const [tentativa, setTentativa] = useState(0);
  const [mudou, setMudou] = useState(0);
  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => servico.ouvir("notas.mudou", () => setMudou((n) => n + 1)), []);

  useEffect(() => {
    if (!pedido || canal !== "conectado") return;
    let vivo = true;
    const relogio = setTimeout(() => {
      servico
        .pedir("notas.buscar", { texto: pedido })
        .then((itens) => {
          if (vivo) setResposta({ pedido, itens });
        })
        .catch(() => {
          if (vivo) setResposta({ pedido, itens: null });
        });
    }, ESPERA_BUSCA_MS);
    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [canal, pedido, tentativa, mudou]);

  if (!pedido) return null;
  if (resposta?.pedido !== pedido) return { estado: "esperando" };
  return resposta.itens ? { estado: "pronta", dados: resposta.itens } : { estado: "falhou", tentarDeNovo };
}

/** As tarefas que nasceram da nota, feitas também, lidas de novo a cada `tarefas.mudou`. */
export function useTarefasDaNota(canal: EstadoConexao, notaId: string | null): Leitura<Tarefa[]> {
  const [resposta, setResposta] = useState<{ notaId: string; tarefas: Tarefa[] | null } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [mudou, setMudou] = useState(0);
  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => servico.ouvir("tarefas.mudou", () => setMudou((n) => n + 1)), []);

  useEffect(() => {
    if (!notaId || canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("tarefas.listar", { notaId, todas: true })
      .then((lista) => {
        if (vivo) setResposta({ notaId, tarefas: lista });
      })
      .catch(() => {
        if (vivo) setResposta((r) => (r?.notaId === notaId && r.tarefas ? r : { notaId, tarefas: null }));
      });
    return () => {
      vivo = false;
    };
  }, [canal, notaId, tentativa, mudou]);

  if (!notaId || resposta?.notaId !== notaId) return { estado: "esperando" };
  return resposta.tarefas
    ? { estado: "pronta", dados: resposta.tarefas }
    : { estado: "falhou", tentarDeNovo };
}

// ---------- o texto aberto ----------

/**
 * Os rascunhos desta janela, um por nota aberta. Ficam aqui, fora dos componentes: quem troca de
 * área ou de nota no meio da digitação não leva o texto embora, e o que não salvou (canal caído)
 * continua tentando. Um rascunho sai quando ninguém o mostra e não há nada pendente.
 */
interface Entrada {
  rascunho: RascunhoNota | null;
  telas: Set<() => void>;
}
const entradas = new Map<string, Entrada>();

const salvar = (pedido: PedidoSalvarNota) => servico.pedir("notas.salvar", pedido);

function descarregarTodos(): void {
  for (const { rascunho } of entradas.values()) rascunho?.descarregar();
}

let vigiando = false;

/**
 * Uma vez por janela: o aviso de mudança das notas vai a cada rascunho, e a janela que perde o foco,
 * some ou fecha salva na hora o que estiver pendente, sem esperar a pausa de 800 ms.
 */
function vigiar(): void {
  if (vigiando) return;
  vigiando = true;
  servico.ouvir("notas.mudou", ({ notas, apagadas }) => {
    for (const nota of notas) entradas.get(nota.id)?.rascunho?.chegou(nota);
    for (const id of apagadas) entradas.get(id)?.rascunho?.apagou();
  });
  window.addEventListener("blur", descarregarTodos);
  window.addEventListener("pagehide", descarregarTodos);
  window.addEventListener("beforeunload", descarregarTodos);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") descarregarTodos();
  });
}

function esquecerSeQuieto(id: string, entrada: Entrada): void {
  if (entrada.telas.size > 0) return;
  // Nota que foi para a Lixeira não abre de novo: o texto dela só vale enquanto está na tela.
  const { rascunho } = entrada;
  if (rascunho && !rascunho.quieto && rascunho.atual.situacao !== "apagada") return;
  entrada.rascunho?.encerrar();
  if (entradas.get(id) === entrada) entradas.delete(id);
}

function entradaDe(id: string): Entrada {
  let entrada = entradas.get(id);
  if (!entrada) {
    entrada = { rascunho: null, telas: new Set() };
    entradas.set(id, entrada);
  }
  return entrada;
}

/** Abre o rascunho da nota lida do serviço, ou entrega a ele a versão que chegou. */
function receber(nota: Nota): void {
  vigiar();
  const entrada = entradaDe(nota.id);
  if (entrada.rascunho) {
    entrada.rascunho.chegou(nota);
    // Voltou a conexão: o que ficou pendente sai agora.
    entrada.rascunho.descarregar();
    return;
  }
  const rascunho = new RascunhoNota(nota, { salvar });
  entrada.rascunho = rascunho;
  rascunho.ouvir(() => {
    for (const tela of entrada.telas) tela();
    esquecerSeQuieto(nota.id, entrada);
  });
  for (const tela of entrada.telas) tela();
  // Quem pediu já saiu da tela: sem nada pendente, não há o que guardar.
  esquecerSeQuieto(nota.id, entrada);
}

/** Só para os testes: esquece os rascunhos entre um caso e outro. */
export function esquecerRascunhos(): void {
  for (const { rascunho } of entradas.values()) rascunho?.encerrar();
  entradas.clear();
}

export interface UsoRascunho {
  leitura: Leitura<EstadoRascunho>;
  /** Para editar, salvar já e escolher no conflito; `null` enquanto a nota não foi lida. */
  rascunho: RascunhoNota | null;
}

/**
 * A nota aberta, que salva sozinha: lida ao conectar (e de novo quando o canal volta) e mantida
 * pelos avisos. Ao sair da tela, o que estiver pendente sai na hora.
 */
export function useRascunho(canal: EstadoConexao, id: string | null): UsoRascunho {
  const [falhou, setFalhou] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const tentarDeNovo = useCallback(() => {
    setFalhou(null);
    setTentativa((n) => n + 1);
  }, []);

  const assinar = useCallback(
    (avisar: () => void) => {
      if (!id) return () => undefined;
      const entrada = entradaDe(id);
      entrada.telas.add(avisar);
      return () => {
        entrada.telas.delete(avisar);
        entrada.rascunho?.descarregar();
        esquecerSeQuieto(id, entrada);
      };
    },
    [id],
  );
  const estado = useSyncExternalStore(assinar, () =>
    id ? (entradas.get(id)?.rascunho?.atual ?? null) : null,
  );

  useEffect(() => {
    if (!id || canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("notas.obter", { id })
      .then((nota) => {
        if (vivo) receber(nota);
      })
      .catch((erro: unknown) => {
        if (!vivo) return;
        const rascunho = entradas.get(id)?.rascunho;
        if (rascunho) {
          if (erro instanceof RecusaDoServico && erro.message === NOTA_SUMIU) rascunho.apagou();
          return;
        }
        setFalhou(id);
      });
    return () => {
      vivo = false;
    };
  }, [canal, id, tentativa]);

  const rascunho = id ? (entradas.get(id)?.rascunho ?? null) : null;
  if (estado && rascunho) return { leitura: { estado: "pronta", dados: estado }, rascunho };
  if (id && falhou === id) return { leitura: { estado: "falhou", tentarDeNovo }, rascunho: null };
  return { leitura: { estado: "esperando" }, rascunho: null };
}
