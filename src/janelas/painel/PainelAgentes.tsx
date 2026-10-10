import type { Aprovacao } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState } from "react";
import { useDadosDev } from "../../areas/dev/dev.ts";
import { nomesDosProjetos, useDadosSessoes } from "../../areas/sessoes/sessoes.ts";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { AGENTES, DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { lerSituacao } from "../../componentes/personagem/situacao.ts";
import { Selo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import { usePedidosDoTerminal } from "../../servico/aprovacoes.ts";
import {
  cartoesDeEstado,
  linhaDoAgente,
  linhaDoNuno,
  modeloDoTime,
  resumoDoTime,
  sessoesEsperando,
  timeDoServico,
  timeSemModelo,
  ultimaDeCada,
  type AcaoEstado,
  type CartaoEstado,
  type TimeDoServico,
} from "./agentes.ts";
import {
  useAgentes,
  useAtalhoDoSistema,
  useExecucoes,
  usePedidosDosAgentes,
  useProvedores,
} from "./dados.ts";
import { CabecalhoPainel, ConviteModelo, SemNoticiaDoTime } from "./Cabecalho.tsx";
import { abrirNoSistema, SessoesDoPainel, situacaoDasSessoes } from "./PedidosSessoes.tsx";

/** O cartão de um estado que pede decisão (Estados.dc.html): o corpo, a fala e as saídas. */
function CartaoDeEstado({ cartao, aoDispensar }: { cartao: CartaoEstado; aoDispensar: () => void }) {
  const idTitulo = useId();
  const [erro, setErro] = useState<string | null>(null);
  const agir = (acao: AcaoEstado) => {
    setErro(null);
    if (acao.tipo === "modelos") abrirNoSistema("configuracoes/modelos");
    if (acao.tipo === "dispensar") aoDispensar();
    if (acao.tipo === "retomar") {
      // Sem lista, o time todo; com lista, um pedido por agente do grupo.
      const pedidos = acao.agenteIds
        ? acao.agenteIds.map((agenteId) => servico.pedir("agentes.retomar", { agenteId }))
        : [servico.pedir("agentes.retomar", {})];
      Promise.all(pedidos).catch(() => setErro("Não consegui retomar agora. Tente de novo."));
    }
  };
  const [primeiro] = cartao.agentes as [Agente];
  return (
    <section className="estado-cartao" data-tipo={cartao.tipo} aria-labelledby={idTitulo}>
      <div className="estado-cartao-topo">
        <span className="estado-cartao-quem">{cartao.quem}</span>
        <Selo tom={cartao.estado.tom}>{cartao.estado.texto}</Selo>
      </div>
      <div className="estado-cartao-fala">
        {/* O corpo ilustra; quem e o estado já estão escritos no alto do cartão. */}
        <span className="estado-cartao-corpo" aria-hidden="true">
          <Personagem agente={primeiro} modo="inteiro" tamanho="vazio" estado={expressaoDoCartao(cartao)} />
        </span>
        <div className="estado-cartao-texto">
          <h3 id={idTitulo} className="estado-cartao-titulo">
            {cartao.titulo}
          </h3>
          <p>{cartao.texto}</p>
        </div>
      </div>
      {erro && (
        <p className="estado-cartao-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="estado-cartao-acoes">
        {cartao.secundaria && (
          <Botao onClick={() => agir(cartao.secundaria!.acao)}>{cartao.secundaria.texto}</Botao>
        )}
        <Botao variante="primario" onClick={() => agir(cartao.primaria.acao)}>
          {cartao.primaria.texto}
        </Botao>
      </div>
    </section>
  );
}

/** A expressão do corpo no cartão: dormindo no sono e na pausa, preocupado no erro e no teto. */
function expressaoDoCartao(cartao: CartaoEstado) {
  return cartao.tipo === "falha" || cartao.tipo === "teto" ? "erro" : "dormindo";
}

interface PropsTime {
  time: TimeDoServico;
  linha: (id: Agente) => string;
}

/** "Seu time" (Agentes.dc.html): cabeça de 36, nome, status com texto e o que está fazendo. */
function SeuTime({ time, linha }: PropsTime) {
  const idTitulo = useId();
  return (
    <section className="painel-secao" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="painel-secao-cabecalho painel-secao-titulo">
        Seu time
      </h2>
      <ul className="time-lista">
        {AGENTES.map((id) => {
          const leitura = lerSituacao(time[id]?.situacao);
          const nome = DADOS_AGENTES[id].nome;
          const trabalhando = leitura.expressao === "trabalhando";
          return (
            <li key={id} className="time-linha" data-agente={id}>
              {/* O nome e o status vêm escritos ao lado: a cabeça não repete para o leitor. */}
              <span className="time-cabeca" aria-hidden="true">
                <Personagem
                  agente={id}
                  modo="cabeca"
                  tamanho="painel"
                  estado={leitura.expressao}
                  moldura={leitura.moldura}
                />
              </span>
              <div className="time-corpo">
                <div className="time-nome">
                  <span className="time-nome-texto">{nome}</span>
                  <Selo tom={leitura.tom}>{leitura.texto}</Selo>
                </div>
                <span className="time-acao">{linha(id)}</span>
                {/* A barra que corre enquanto trabalha; o selo já diz "trabalhando". */}
                {trabalhando && <span className="time-correndo" aria-hidden="true" />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Pedido mais novo de cada agente do Moductus esperando você. */
function pedidoDeCada(pedidos: readonly Aprovacao[]): Partial<Record<string, Aprovacao>> {
  const porAgente: Partial<Record<string, Aprovacao>> = {};
  for (const p of pedidos) if (p.estado === "pendente" && p.agenteId) porAgente[p.agenteId] = p;
  return porAgente;
}

/**
 * O painel Agentes do dock (Agentes.dc.html e Estados.dc.html): o resumo de quem trabalha e de
 * quem espera você, os cartões dos estados que pedem decisão (pausa, limite, erro de provedor,
 * teto), o time com o que cada um faz, as sessões de IA com os pedidos do terminal e o modelo do
 * time. Tudo vem do serviço; sem modelo, o time dorme com o convite de sempre, e as sessões do
 * terminal continuam aqui, porque aprovar pelo dock não depende de modelo. Sem resposta sobre o
 * time, o painel diz que não sabe, em vez de pedir um modelo que talvez já esteja conectado.
 */
export function PainelAgentes({ canal, abertura }: { canal: EstadoConexao; abertura: number }) {
  const agora = useAgora();
  const agentes = useAgentes(canal, abertura);
  const provedores = useProvedores(canal, abertura) ?? [];
  const execucoes = useExecucoes(canal, abertura) ?? [];
  const pedidosDosAgentes = usePedidosDosAgentes(canal, abertura) ?? [];
  const atalho = useAtalhoDoSistema(canal);
  // Cada abertura relê os pedidos: os já respondidos da vez anterior saem da tela.
  const pedidos = usePedidosDoTerminal(canal, abertura);
  const sessoes = useDadosSessoes(canal, agora);
  const github = useDadosDev(canal);
  // Cartões que você dispensou ("Esperar"), pela chave do estado: um sono novo volta a aparecer.
  const [dispensados, setDispensados] = useState<ReadonlySet<string>>(new Set());

  const time = timeDoServico(agentes ?? []);
  const lista = sessoes.estado === "pronta" ? sessoes.dados.lista : null;
  const itensGithub = github.estado === "pronta" ? github.dados.situacao.itens : [];
  const projetos = lista ? nomesDosProjetos(lista) : new Map();
  const ultimas = ultimaDeCada(execucoes);
  const pedidoDoAgente = pedidoDeCada(pedidosDosAgentes);
  const doNuno = linhaDoNuno(
    lista?.sessoes ?? [],
    (s) => (s.projetoId ? (projetos.get(s.projetoId)?.nome ?? null) : null),
    sessoesEsperando(pedidos.aprovacoes),
    itensGithub,
  );

  const linha = (id: Agente) => {
    const agente = time[id];
    const leitura = lerSituacao(agente?.situacao, agora);
    if (id === "nuno" && doNuno && leitura.expressao === "ocioso") return doNuno;
    return linhaDoAgente(id, agente, leitura, ultimas[id], pedidoDoAgente[id], agora);
  };
  const cartoes = cartoesDeEstado(time, provedores, agora).filter((c) => !dispensados.has(c.chave));
  const semNoticia = agentes === null;
  const semModelo = !semNoticia && timeSemModelo(time);
  const modelo = modeloDoTime(time, provedores);

  return (
    <>
      <CabecalhoPainel
        titulo="Agentes"
        subtitulo={semNoticia ? undefined : resumoDoTime(time, pedidos.aprovacoes)}
        sistema="agentes"
        atalho={atalho ?? undefined}
      />
      <div className="painel-corpo">
        {semNoticia ? (
          <SemNoticiaDoTime />
        ) : semModelo ? (
          <ConviteModelo />
        ) : (
          <>
            {cartoes.map((cartao) => (
              <CartaoDeEstado
                key={cartao.chave}
                cartao={cartao}
                aoDispensar={() => setDispensados((d) => new Set(d).add(cartao.chave))}
              />
            ))}
            <SeuTime time={time} linha={linha} />
          </>
        )}
        <SessoesDoPainel
          lista={lista}
          pedidos={pedidos}
          situacao={situacaoDasSessoes(sessoes)}
          agora={agora}
        />
        {!semNoticia && !semModelo && (
          <footer className="painel-rodape">
            <span>{modelo.texto}</span>
            <Botao
              variante="fantasma"
              tamanho="pequeno"
              onClick={() => abrirNoSistema("configuracoes/modelos")}
            >
              {modelo.acao}
            </Botao>
          </footer>
        )}
      </div>
    </>
  );
}
