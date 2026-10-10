import type { Aprovacao, Conversa, FalaParcial, Mensagem, SituacaoAgente } from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel, type EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTES, DADOS_AGENTES, eAgente, type Agente } from "../componentes/personagem/agentes.ts";
import { formatarHora } from "../componentes/personagem/quando.ts";
import {
  eFalhaDoProvedor,
  falaDaFalha,
  type FalaCartao,
  type ModeloDoAgente,
} from "../componentes/personagem/situacao.ts";
import { juntarAprovacao } from "./aprovacoes.ts";
import { servico } from "./conexao.ts";

/**
 * As conversas da área Agentes (Conversas.dc.html; PRODUCT.md §6 "Conversas"): a do time e uma por
 * agente, a fala em andamento chegando em pedaços (`conversas.parcial`) e, pronta, gravada
 * (`conversas.mensagem`). Quem decide quem responde é o serviço; aqui só se mostra e se pede.
 */

/** Com quem: `null` é o time. */
export type Interlocutor = Agente | null;

/** Quantas mensagens a conversa abre mostrando; as mais antigas vêm por "Mensagens anteriores". */
export const PAGINA_MENSAGENS = 50;

/** A conversa em uso com cada um: a mais nova não arquivada, como o serviço escolhe ao abrir. */
export function conversaEmUso(conversas: readonly Conversa[], com: Interlocutor): Conversa | null {
  let achada: Conversa | null = null;
  for (const c of conversas) {
    if (c.arquivada) continue;
    if (com === null ? c.tipo !== "time" : c.agenteId !== com) continue;
    if (!achada || c.id > achada.id) achada = c;
  }
  return achada;
}

/** Troca a conversa que já estava na lista, ou põe a nova. */
export function juntarConversa(lista: readonly Conversa[], conversa: Conversa): Conversa[] {
  return lista.some((c) => c.id === conversa.id)
    ? lista.map((c) => (c.id === conversa.id ? conversa : c))
    : [...lista, conversa];
}

/**
 * Põe a mensagem na conversa aberta, na ordem em que foi dita (o ULID ordena), sem repetir a que
 * já veio pela resposta do pedido.
 */
export function juntarMensagem(lista: readonly Mensagem[], mensagem: Mensagem): Mensagem[] {
  if (lista.some((m) => m.id === mensagem.id)) return [...lista];
  return [...lista, mensagem].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** As respostas em andamento na conversa aberta, por execução. */
export type Andamento = Readonly<Record<string, FalaParcial>>;

/**
 * Um pedaço novo de resposta. O texto vem inteiro até ali, então o mais novo substitui; pedaço de
 * execução que já virou mensagem não volta.
 */
export function aplicarParcial(
  andamento: Andamento,
  parcial: FalaParcial,
  gravadas: ReadonlySet<string>,
): Andamento {
  if (gravadas.has(parcial.execucaoId)) return andamento;
  return { ...andamento, [parcial.execucaoId]: parcial };
}

/** A resposta gravada tira a fala em andamento da mesma execução. */
export function encerrarParcial(andamento: Andamento, mensagem: Mensagem): Andamento {
  if (!mensagem.execucaoId || !(mensagem.execucaoId in andamento)) return andamento;
  const { [mensagem.execucaoId]: _feita, ...resto } = andamento;
  return resto;
}

const DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** Meia-noite local do dia do instante. */
function inicioDoDia(data: Date): number {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
}

/**
 * Quando, curto, como a lista de conversas escreve: "14:31" hoje, "ontem", "seg" na semana e
 * "02/10" antes disso.
 */
export function quandoCurto(instante: string, agora: Date = new Date()): string {
  const data = new Date(instante);
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(data)) / 86_400_000);
  if (dias <= 0) return formatarHora(data);
  if (dias === 1) return "ontem";
  if (dias < 7) return DIA_SEMANA.format(data).replace(".", "");
  return DIA_MES.format(data);
}

/**
 * A fala que é só o erro de uma execução, quando é a última de quem ainda dorme por falha do
 * provedor: diz a falha como o cartão do painel ({@link falaDaFalha}: CLI sem login com o comando
 * para entrar, a hora da nova tentativa), não com o texto cru do provedor ("Not logged in · Please
 * run /login"). Fora disso, `null`: a fala vale como foi gravada.
 */
export function falhaNaConversa(
  mensagem: Mensagem,
  ultimaDele: boolean,
  situacao: SituacaoAgente | undefined,
  modelo: ModeloDoAgente | null,
  agora: Date,
): FalaCartao | null {
  if (!mensagem.erroDaExecucao || !ultimaDele || situacao?.estado !== "dormindo") return null;
  const motivo = situacao.motivoSono;
  return eFalhaDoProvedor(motivo) ? falaDaFalha(motivo, modelo, situacao.dormeAte, agora, false) : null;
}

/** A fala do cartão numa linha só, com o comando no meio, para onde não cabe o código à parte. */
export function textoDaFala(fala: FalaCartao): string {
  return fala.comando ? `${fala.texto}${fala.comando.codigo}${fala.comando.depois}` : fala.texto;
}

/**
 * A última fala numa linha da lista: no time, com quem disse ("Faina: Achei 38…"); na conversa
 * de um agente, só o texto, como no quadro. A falha dita do jeito da janela
 * ({@link falhaNaConversa}) entra no lugar do erro cru.
 */
export function previa(mensagem: Mensagem, doTime: boolean, falha: FalaCartao | null = null): string {
  const texto = (falha ? textoDaFala(falha) : mensagem.conteudo).replace(/\s+/g, " ").trim();
  if (!doTime) return mensagem.agenteId === null ? `Você: ${texto}` : texto;
  if (mensagem.agenteId === null) return `Você: ${texto}`;
  const nome = eAgente(mensagem.agenteId) ? DADOS_AGENTES[mensagem.agenteId].nome : mensagem.agenteId;
  return `${nome}: ${texto}`;
}

/** Põe "@tula " no começo do que está escrito, sem repetir a menção que já está lá. */
export function mencionar(texto: string, agente: Agente): string {
  const apelido = DADOS_AGENTES[agente].apelido;
  if (new RegExp(`(^|\\s)${apelido}(\\s|$)`, "i").test(texto)) return texto;
  const resto = texto.trimStart();
  return resto ? `${apelido} ${resto}` : `${apelido} `;
}

/** O que dizer quando um pedido de conversa não valeu. */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ServicoIndisponivel)
    return "O serviço não está respondendo. Nada foi enviado; tente de novo.";
  if (erro instanceof RecusaDoServico) return primeiraMaiuscula(erro.message);
  return "Não consegui confirmar. Confira a conversa de novo.";
}

const primeiraMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

export interface EstadoConversas {
  /** A conversa em uso de cada um, para a lista (o time e os quatro). */
  emUso: Readonly<Record<string, Conversa | null>>;
  /** A última fala de cada conversa, pelo id dela. */
  ultimas: Readonly<Record<string, Mensagem>>;
  /** A conversa aberta; `null` enquanto abre. */
  aberta: Conversa | null;
  mensagens: readonly Mensagem[];
  /** Há mensagens mais antigas que as mostradas. */
  temAnteriores: boolean;
  andamento: Andamento;
  /** Quem o roteamento escolheu e ainda não começou a responder. */
  aguardando: readonly Agente[];
  /** Pedidos de aprovação de agentes do Moductus (pendentes e os decididos nesta tela). */
  aprovacoes: readonly Aprovacao[];
  erro: string | null;
  conectado: boolean;
}

export interface AcoesConversas {
  /** Manda a fala; devolve se o serviço aceitou. */
  enviar: (texto: string) => Promise<boolean>;
  /** Arquiva a conversa aberta e começa outra com o mesmo interlocutor. */
  nova: () => Promise<void>;
  /** Manda a conversa aberta para a lixeira e abre outra vazia. */
  apagar: () => Promise<boolean>;
  anteriores: () => Promise<void>;
  limparErro: () => void;
}

const chave = (com: Interlocutor) => com ?? "time";

/**
 * As conversas pelo canal: a lista ao conectar, a conversa do interlocutor escolhido (aberta, ou
 * criada, por `conversas.abrir`) e cada evento depois. Sem conexão, nada some da tela, mas nada
 * se envia.
 */
export function useConversas(canal: EstadoConexao, com: Interlocutor): EstadoConversas & AcoesConversas {
  const conectado = canal === "conectado";
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [ultimas, setUltimas] = useState<Record<string, Mensagem>>({});
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [andamento, setAndamento] = useState<Andamento>({});
  const [aguardando, setAguardando] = useState<Agente[]>([]);
  const [aprovacoes, setAprovacoes] = useState<Aprovacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  // Os eventos chegam por ouvintes registrados uma vez: leem a conversa aberta daqui.
  const abertaRef = useRef<string | null>(null);
  const gravadas = useRef(new Set<string>());

  useEffect(() => {
    const paradas = [
      servico.ouvir("conversas.mudou", (c) => setConversas((lista) => juntarConversa(lista, c))),
      servico.ouvir("conversas.mensagem", (m) => {
        setUltimas((u) => (u[m.conversaId] && u[m.conversaId]!.id > m.id ? u : { ...u, [m.conversaId]: m }));
        if (m.conversaId !== abertaRef.current) return;
        if (m.execucaoId) gravadas.current.add(m.execucaoId);
        setMensagens((lista) => juntarMensagem(lista, m));
        setAndamento((a) => encerrarParcial(a, m));
        if (m.agenteId !== null) setAguardando((lista) => lista.filter((a) => a !== m.agenteId));
      }),
      servico.ouvir("conversas.parcial", (p) => {
        if (p.conversaId !== abertaRef.current) return;
        setAndamento((a) => aplicarParcial(a, p, gravadas.current));
        setAguardando((lista) => lista.filter((a) => a !== p.agenteId));
      }),
      servico.ouvir("aprovacoes.mudou", (a) => {
        if (a.fonte === "moductus") setAprovacoes((lista) => juntarAprovacao(lista, a));
      }),
    ];
    return () => paradas.forEach((parar) => parar());
  }, []);

  // A lista ao conectar, com a última fala de cada conversa em uso.
  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    void (async () => {
      try {
        const [lista, pendentes] = await Promise.all([
          servico.pedir("conversas.listar"),
          servico.pedir("aprovacoes.pendentes"),
        ]);
        if (!vivo) return;
        setConversas(lista);
        setAprovacoes(pendentes.filter((a) => a.fonte === "moductus"));
        const emUso = [null, ...AGENTES].flatMap((c) => conversaEmUso(lista, c) ?? []);
        const paginas = await Promise.all(
          emUso.map((c) => servico.pedir("conversas.mensagens", { conversaId: c.id, limite: 1 })),
        );
        if (!vivo) return;
        const novas: Record<string, Mensagem> = {};
        for (const p of paginas) {
          const [ultima] = p.itens;
          if (ultima) novas[ultima.conversaId] = ultima;
        }
        setUltimas((u) => ({ ...novas, ...u }));
      } catch {
        // Sem a lista, a conversa aberta ainda funciona; a lista vem na próxima conexão.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [conectado]);

  const mostrar = useCallback(async (conversa: Conversa) => {
    abertaRef.current = conversa.id;
    gravadas.current = new Set();
    setAberta(conversa);
    setAndamento({});
    setAguardando([]);
    setConversas((lista) => juntarConversa(lista, conversa));
    const pagina = await servico.pedir("conversas.mensagens", {
      conversaId: conversa.id,
      limite: PAGINA_MENSAGENS,
    });
    if (abertaRef.current !== conversa.id) return;
    // O que chegou por evento enquanto a página vinha fica junto.
    setMensagens((atuais) =>
      pagina.itens.reduce(
        juntarMensagem,
        atuais.filter((m) => m.conversaId === conversa.id),
      ),
    );
    setProximo(pagina.proximo);
  }, []);

  // A conversa do interlocutor escolhido: o serviço devolve a em uso ou cria.
  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    // Até a conversa nova chegar, nada se envia: a fala não pode cair na de antes.
    abertaRef.current = null;
    setAberta(null);
    setMensagens([]);
    setProximo(null);
    setErro(null);
    servico
      .pedir("conversas.abrir", com === null ? {} : { agenteId: com })
      .then((conversa) => (vivo ? mostrar(conversa) : undefined))
      .catch((e: unknown) => {
        if (vivo) setErro(mensagemDeErro(e));
      });
    return () => {
      vivo = false;
    };
  }, [conectado, com, mostrar]);

  const enviar = useCallback(
    async (texto: string) => {
      const conversa = aberta;
      if (!conversa || texto.trim() === "") return false;
      setErro(null);
      try {
        const r = await servico.pedir("conversas.enviar", { conversaId: conversa.id, conteudo: texto });
        if (abertaRef.current === conversa.id) {
          setMensagens((lista) => juntarMensagem(lista, r.mensagem));
          setAguardando((lista) => [...new Set([...lista, ...r.agentes.filter(eAgente)])]);
        }
        setUltimas((u) => ({ ...u, [conversa.id]: r.mensagem }));
        return true;
      } catch (e) {
        setErro(mensagemDeErro(e));
        return false;
      }
    },
    [aberta],
  );

  const nova = useCallback(async () => {
    if (!aberta) return;
    setErro(null);
    try {
      await servico.pedir("conversas.arquivar", { id: aberta.id, arquivada: true });
      await mostrar(await servico.pedir("conversas.abrir", com === null ? {} : { agenteId: com }));
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [aberta, com, mostrar]);

  const apagar = useCallback(async () => {
    if (!aberta) return false;
    setErro(null);
    try {
      setConversas(await servico.pedir("conversas.apagar", { id: aberta.id }));
      setUltimas(({ [aberta.id]: _apagada, ...resto }) => resto);
      await mostrar(await servico.pedir("conversas.abrir", com === null ? {} : { agenteId: com }));
      return true;
    } catch (e) {
      setErro(mensagemDeErro(e));
      return false;
    }
  }, [aberta, com, mostrar]);

  const anteriores = useCallback(async () => {
    if (!aberta || !proximo) return;
    try {
      const pagina = await servico.pedir("conversas.mensagens", {
        conversaId: aberta.id,
        limite: PAGINA_MENSAGENS,
        antesDe: proximo,
      });
      if (abertaRef.current !== aberta.id) return;
      setMensagens((atuais) => pagina.itens.reduce(juntarMensagem, atuais));
      setProximo(pagina.proximo);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [aberta, proximo]);

  const emUso: Record<string, Conversa | null> = {};
  for (const c of [null, ...AGENTES]) emUso[chave(c)] = conversaEmUso(conversas, c);

  return {
    emUso,
    ultimas,
    aberta,
    mensagens,
    temAnteriores: proximo !== null,
    andamento,
    aguardando,
    aprovacoes,
    erro,
    conectado,
    enviar,
    nova,
    apagar,
    anteriores,
    limparErro: () => setErro(null),
  };
}

export { chave as chaveInterlocutor };
