import type { Aprovacao, FalaParcial, Mensagem } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { CartaoAprovacao } from "../../componentes/CartaoAprovacao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { AGENTES, DADOS_AGENTES, eAgente, type Agente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { lerSituacao } from "../../componentes/personagem/situacao.ts";
import { Selo } from "../../componentes/Selo.tsx";
import { agoraDoAgente } from "../../servico/agente.ts";
import { decidirPedido } from "../../servico/aprovacoes.ts";
import {
  chaveInterlocutor,
  mencionar,
  previa,
  quandoCurto,
  useConversas,
  type Interlocutor,
} from "../../servico/conversas.ts";
import { useTime, type ModelosDoTime, type SituacaoTime } from "../../servico/time.ts";
import { useAgora } from "../tempo.ts";
import { comArtigo, deAgente } from "./nomes.ts";

interface PropsConversas {
  canal: EstadoConexao;
  /** Com quem: `null` é o time. */
  com: Interlocutor;
  aoEscolher: (com: Interlocutor) => void;
  aoAbrirPagina: (agente: Agente) => void;
  aoAbrirMemoria: () => void;
}

const NOME_TIME = "Time";
const SOBRE_TIME = "Alba, Tula, Faina e Nuno · quem souber responde, e assina";

/** Nome de quem fala, para o rótulo da conversa. */
const nomeDe = (com: Interlocutor) => (com === null ? NOME_TIME : DADOS_AGENTES[com].nome);

/**
 * Sistema · Agentes (Conversas.dc.html): a lista com o time e os quatro à esquerda e a conversa
 * aberta ao lado, com a resposta chegando em pedaços e o cartão de aprovação dentro da fala de
 * quem pediu.
 */
export function Conversas({ canal, com, aoEscolher, aoAbrirPagina, aoAbrirMemoria }: PropsConversas) {
  const conversas = useConversas(canal, com);
  const { situacoes: time, modelos } = useTime(canal);
  const { conectado, aberta } = conversas;

  return (
    <div className="conversas">
      <div className="conversas-lista">
        <div className="conversas-lista-cabecalho">
          <h1 className="conversas-titulo">Agentes</h1>
          <Botao tamanho="pequeno" disabled={!conectado || !aberta} onClick={() => void conversas.nova()}>
            Nova conversa
          </Botao>
        </div>
        <nav aria-label="Conversas">
          <ul className="conversas-itens">
            {[null, ...AGENTES].map((quem) => (
              <ItemConversa
                key={chaveInterlocutor(quem)}
                quem={quem}
                ativo={quem === com}
                time={time}
                ultima={ultimaDe(conversas, quem)}
                aoEscolher={() => aoEscolher(quem)}
              />
            ))}
          </ul>
        </nav>
        <p className="conversas-nota">
          A conversa com o time e as conversas com cada um usam a mesma memória.
        </p>
      </div>

      <section className="conversa" aria-label={`Conversa com ${com === null ? "o time" : comArtigo(com)}`}>
        <CabecalhoConversa
          com={com}
          time={time}
          podeApagar={conectado && aberta !== null}
          apagar={conversas.apagar}
          aoAbrirPagina={aoAbrirPagina}
          aoAbrirMemoria={aoAbrirMemoria}
        />
        <Mensagens com={com} time={time} modelos={modelos} conversas={conversas} />
        <Escrever
          key={chaveInterlocutor(com)}
          com={com}
          pronto={conectado && aberta !== null}
          conectado={conectado}
          erro={conversas.erro}
          enviar={conversas.enviar}
        />
      </section>
    </div>
  );
}

interface PropsCabecalho {
  com: Interlocutor;
  time: SituacaoTime;
  podeApagar: boolean;
  apagar: () => Promise<boolean>;
  aoAbrirPagina: (agente: Agente) => void;
  aoAbrirMemoria: () => void;
}

/**
 * Quem está na conversa e as ações dela. Apagar pede confirmação ali mesmo: o foco vai para
 * "Manter", Esc desiste, e ao fechar o foco volta para "Apagar". A confirmação é da conversa em
 * que abriu: trocar de interlocutor fecha, e ela nunca passa para outra.
 */
function CabecalhoConversa({ com, time, podeApagar, apagar, aoAbrirPagina, aoAbrirMemoria }: PropsCabecalho) {
  const [apagando, setApagando] = useState(false);
  // Trocou de interlocutor: a confirmação fecha já neste quadro, sem passar para a outra conversa.
  const [comVisto, setComVisto] = useState(com);
  if (comVisto !== com) {
    setComVisto(com);
    setApagando(false);
  }
  const manter = useRef<HTMLButtonElement>(null);
  const botaoApagar = useRef<HTMLButtonElement>(null);
  // Onde estava aberta no último quadro: o foco só volta a "Apagar" na mesma conversa (trocar de
  // interlocutor deixa o foco onde o usuário clicou).
  const abertaEm = useRef<Interlocutor | undefined>(undefined);

  useEffect(() => {
    if (apagando) manter.current?.focus();
    else if (abertaEm.current === com) botaoApagar.current?.focus();
    abertaEm.current = apagando ? com : undefined;
  }, [apagando, com]);

  return (
    <header className="conversa-cabecalho">
      <div className="conversa-quem">
        <h2 className="conversa-nome">{nomeDe(com)}</h2>
        <span className="conversa-sobre">{com === null ? SOBRE_TIME : DADOS_AGENTES[com].funcao}</span>
      </div>
      {apagando ? (
        <div
          className="conversa-confirmar"
          role="group"
          aria-label="Apagar a conversa"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setApagando(false);
          }}
        >
          <span>Apagar esta conversa? Ela fica 30 dias na lixeira.</span>
          <Botao ref={manter} tamanho="pequeno" onClick={() => setApagando(false)}>
            Manter
          </Botao>
          <Botao
            variante="primario"
            tamanho="pequeno"
            onClick={() => void apagar().then(() => setApagando(false))}
          >
            Apagar conversa
          </Botao>
        </div>
      ) : (
        <div className="conversa-acoes">
          {com !== null && (
            <Selo forma="ponto" tom={lerSituacao(time[com]).tom}>
              {lerSituacao(time[com]).texto}
            </Selo>
          )}
          {com === null ? (
            <Botao variante="fantasma" onClick={aoAbrirMemoria}>
              Memória do time
            </Botao>
          ) : (
            <Botao variante="fantasma" onClick={() => aoAbrirPagina(com)}>
              {`Página ${deAgente(com)}`}
            </Botao>
          )}
          <Botao
            ref={botaoApagar}
            variante="fantasma"
            disabled={!podeApagar}
            onClick={() => setApagando(true)}
          >
            Apagar
          </Botao>
        </div>
      )}
    </header>
  );
}

type EstadoDaConversa = ReturnType<typeof useConversas>;

/** A última fala da conversa em uso com cada um, para a linha da lista. */
function ultimaDe(conversas: EstadoDaConversa, quem: Interlocutor): Mensagem | null {
  const emUso = conversas.emUso[chaveInterlocutor(quem)];
  return (emUso && conversas.ultimas[emUso.id]) ?? null;
}

interface PropsItemConversa {
  quem: Interlocutor;
  ativo: boolean;
  time: SituacaoTime;
  ultima: Mensagem | null;
  aoEscolher: () => void;
}

/** Uma linha da lista: cabeça (as quatro, no time), nome, quando e a última fala. */
function ItemConversa({ quem, ativo, time, ultima, aoEscolher }: PropsItemConversa) {
  const vazio = quem === null ? "Pergunte ao time; quem souber responde." : DADOS_AGENTES[quem].funcao;
  return (
    <li>
      <button
        type="button"
        className="conversas-item"
        aria-current={ativo ? "page" : undefined}
        onClick={aoEscolher}
      >
        <span className="conversas-item-cabeca" aria-hidden="true">
          {quem === null ? (
            <span className="conversas-item-time">
              {AGENTES.map((a) => (
                <Personagem
                  key={a}
                  agente={a}
                  modo="cabeca"
                  tamanho="mini"
                  estado={lerSituacao(time[a]).expressao}
                />
              ))}
            </span>
          ) : (
            <Personagem
              agente={quem}
              modo="cabeca"
              tamanho="dock"
              estado={lerSituacao(time[quem]).expressao}
            />
          )}
        </span>
        <span className="conversas-item-textos">
          <span className="conversas-item-linha">
            <span className="conversas-item-nome">{nomeDe(quem)}</span>
            {ultima && <span className="conversas-item-quando">{quandoCurto(ultima.criadoEm)}</span>}
          </span>
          <span className="conversas-item-ultima">{ultima ? previa(ultima, quem === null) : vazio}</span>
        </span>
      </button>
    </li>
  );
}

interface PropsMensagens {
  com: Interlocutor;
  time: SituacaoTime;
  modelos: ModelosDoTime;
  conversas: EstadoDaConversa;
}

/** Distância do fim, em px de tela, até onde a conversa ainda acompanha a resposta que chega. */
const PERTO_DO_FIM = 48;

/**
 * As falas na ordem em que foram ditas, depois as respostas em andamento e quem ainda não
 * começou a responder. A conversa desce sozinha enquanto você está no fim dela.
 */
function Mensagens({ com, time, modelos, conversas }: PropsMensagens) {
  // A frase de quem dorme diz uma hora: o relógio da tela a tira de lá quando ela chega.
  const agora = useAgora();
  const lista = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  const { mensagens, andamento, aguardando, aprovacoes, aberta, temAnteriores } = conversas;
  const emAndamento = Object.values(andamento).sort((a, b) => (a.execucaoId < b.execucaoId ? -1 : 1));
  const esperando = aguardando.filter((a) => !emAndamento.some((p) => p.agenteId === a));

  useLayoutEffect(() => {
    const el = lista.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  });

  const cartoes = (execucaoId: string | null) =>
    execucaoId ? aprovacoes.filter((a) => a.execucaoId === execucaoId) : [];

  const vazia =
    aberta !== null && mensagens.length === 0 && emAndamento.length === 0 && esperando.length === 0;

  return (
    <div
      ref={lista}
      className="conversa-mensagens"
      role="log"
      aria-label={`Mensagens com ${com === null ? "o time" : comArtigo(com)}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PERTO_DO_FIM;
      }}
    >
      {temAnteriores && (
        <Botao
          variante="fantasma"
          className="conversa-anteriores"
          onClick={() => void conversas.anteriores()}
        >
          Mensagens anteriores
        </Botao>
      )}
      {vazia && (
        <p className="conversa-vazia">
          {com === null
            ? "Escreva o que precisa. Quem souber responde, e assina; com @ você fala com um só."
            : `Fale com ${comArtigo(com)}: ${DADOS_AGENTES[com].funcao.toLowerCase()}.`}
        </p>
      )}
      {mensagens.map((m) => (
        <Fala key={m.id} mensagem={m} cartoes={cartoes(m.execucaoId)} />
      ))}
      {emAndamento.map((p) => (
        <FalaEmAndamento key={p.execucaoId} parcial={p} cartoes={cartoes(p.execucaoId)} />
      ))}
      {esperando.map((a) => {
        const situacao = time[a];
        // Dormindo ou pausado, a resposta espera na fila: diz até quando, em vez de "pensando".
        const parado =
          situacao && situacao.estado !== "ativo"
            ? agoraDoAgente(situacao, null, agora, modelos[a] ?? null)
            : null;
        return (
          <FalaAgente key={a} agente={a} estado={parado ? lerSituacao(situacao).expressao : "trabalhando"}>
            <span className="conversa-pensando">{parado ?? "pensando…"}</span>
          </FalaAgente>
        );
      })}
    </div>
  );
}

/**
 * Cartões de aprovação dentro da fala de quem pediu, com os botões do tamanho da conversa. A fala
 * logo acima já diz o que vai acontecer (Conversas.dc.html): a descrição fica só para o leitor.
 */
function Cartoes({ cartoes }: { cartoes: readonly Aprovacao[] }) {
  if (cartoes.length === 0) return null;
  return (
    <>
      {cartoes.map((a) => (
        <CartaoAprovacao key={a.id} aprovacao={a} tamanho="pequeno" semDescricao aoDecidir={decidirPedido} />
      ))}
    </>
  );
}

function Fala({ mensagem, cartoes }: { mensagem: Mensagem; cartoes: readonly Aprovacao[] }) {
  const { agenteId, conteudo } = mensagem;
  if (agenteId === null) {
    return (
      <p className="conversa-eu">
        <span className="so-leitor">Você: </span>
        {conteudo}
      </p>
    );
  }
  if (!eAgente(agenteId)) {
    // Agente criado por você (fase 7) ainda não tem personagem aqui: fica o nome e a fala.
    return (
      <p className="conversa-outro">
        <strong>{agenteId}</strong> {conteudo}
      </p>
    );
  }
  return (
    <FalaAgente agente={agenteId} acao={cartoes.length > 0 && <Cartoes cartoes={cartoes} />}>
      {conteudo}
    </FalaAgente>
  );
}

function FalaEmAndamento({ parcial, cartoes }: { parcial: FalaParcial; cartoes: readonly Aprovacao[] }) {
  const { agenteId, texto } = parcial;
  if (!eAgente(agenteId)) return null;
  // Pedido antes de qualquer texto: a descrição do cartão é a fala dele.
  const pediu = cartoes.find((a) => a.estado === "pendente");
  const fala = texto || pediu?.descricao;
  return (
    <div aria-busy="true">
      <FalaAgente
        agente={agenteId}
        estado={pediu ? "esperando" : "trabalhando"}
        acao={cartoes.length > 0 && <Cartoes cartoes={cartoes} />}
      >
        {fala ? fala : <span className="conversa-pensando">pensando…</span>}
      </FalaAgente>
    </div>
  );
}

interface PropsEscrever {
  com: Interlocutor;
  /** Há conversa aberta e conexão: dá para mandar. */
  pronto: boolean;
  conectado: boolean;
  erro: string | null;
  enviar: (texto: string) => Promise<boolean>;
}

/**
 * Onde se escreve: Enter manda, Shift+Enter quebra a linha. Na conversa do time, as menções
 * entram com um clique. O texto só some quando o serviço aceitou.
 */
function Escrever({ com, pronto, conectado, erro, enviar }: PropsEscrever) {
  const id = useId();
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const podeMandar = pronto && !enviando && texto.trim() !== "";

  const mandar = async () => {
    if (!podeMandar) return;
    setEnviando(true);
    if (await enviar(texto)) setTexto("");
    setEnviando(false);
    campo.current?.focus();
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void mandar();
  };

  const dica =
    com === null ? "Escreva para o time. Use @ para falar com um só." : `Escreva para ${comArtigo(com)}.`;

  return (
    <form
      className="escrever"
      onSubmit={(e) => {
        e.preventDefault();
        void mandar();
      }}
    >
      {erro && (
        <p className="conversa-erro" role="alert">
          {erro}
        </p>
      )}
      {!conectado && (
        <p className="conversa-erro" role="status">
          O serviço do Moductus não está conectado. A conversa volta quando ele responder.
        </p>
      )}
      <div className="escrever-caixa">
        <label htmlFor={id} className="so-leitor">
          {`Mensagem para ${com === null ? "o time" : comArtigo(com)}`}
        </label>
        <textarea
          ref={campo}
          id={id}
          className="escrever-campo"
          rows={2}
          placeholder={dica}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclar}
        />
        <div className="escrever-acoes">
          {com === null &&
            AGENTES.map((a) => (
              <button
                key={a}
                type="button"
                className="escrever-mencao"
                aria-label={`Mencionar ${DADOS_AGENTES[a].nome}`}
                onClick={() => {
                  setTexto((t) => mencionar(t, a));
                  campo.current?.focus();
                }}
              >
                {DADOS_AGENTES[a].apelido}
              </button>
            ))}
          <Botao variante="primario" type="submit" className="escrever-enviar" disabled={!podeMandar}>
            Enviar
          </Botao>
        </div>
      </div>
    </form>
  );
}
