import type { FerramentaSessao, ListaSessoes, Projeto, SessaoIa } from "@moductus/contrato";
import { invoke } from "@tauri-apps/api/core";
import { useId, type ReactNode } from "react";
import { contextoDaSessao, estadoDaSessao, ultimaAcao } from "../../areas/sessoes/sessoes.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { CartaoAprovacao } from "../../componentes/CartaoAprovacao.tsx";
import { Progresso } from "../../componentes/Progresso.tsx";
import type { TomSelo } from "../../componentes/Selo.tsx";
import type { Leitura } from "../../areas/leitura.ts";
import type { DadosSessoes } from "../../areas/sessoes/sessoes.ts";
import { claudeCodeLigado } from "../../areas/sessoes/sessoes.ts";
import { decidirPedido, detalheDoPedido, type PedidosDoTerminal } from "../../servico/aprovacoes.ts";
import { itensDasSessoes, projetosNaTela, tempoDaSessao, TOM_DA_SESSAO, type ItemSessao } from "./sessoes.ts";

/** Nome de cada ferramenta de sessão, como o Agentes.dc.html escreve na linha da sessão. */
export const NOME_FERRAMENTA: Readonly<Record<FerramentaSessao, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
  antigravity: "Antigravity",
};

/** Abre uma área do Sistema e fecha o painel. */
export function abrirNoSistema(area: string) {
  void invoke("sistema_abrir", { area });
  void invoke("painel_fechar");
}

interface PropsCabeca {
  tom: TomSelo;
  projeto: string | null;
  ferramenta: FerramentaSessao | null;
  /** O que vai à direita: o tempo, o contexto ou "esperando você". */
  direita?: ReactNode;
}

/** A linha de cima de cada sessão: ponto do estado, projeto em negrito, ferramenta e o que vai à direita. */
function CabecaSessao({ tom, projeto, ferramenta, direita }: PropsCabeca) {
  return (
    <div className="sessao-cabeca">
      <span className="sessao-ponto" data-tom={tom} aria-hidden="true" />
      <span className="sessao-projeto">{projeto ?? "Sem projeto"}</span>
      {ferramenta && <span className="sessao-ferramenta">{NOME_FERRAMENTA[ferramenta]}</span>}
      {direita}
    </div>
  );
}

/**
 * O pedido de uma sessão, com Negar, Sempre neste projeto e Permitir (Agentes.dc.html): a frase é
 * a do serviço ("Quer rodar o comando abaixo.") e o comando, o arquivo ou o endereço vem inteiro
 * logo abaixo, de qualquer ferramenta que o traga.
 */
function PedidoDaSessao({ item }: { item: Extract<ItemSessao, { tipo: "pedido" }> }) {
  const { aprovacao } = item;
  const detalhe = detalheDoPedido(aprovacao.acao);
  const pendente = aprovacao.estado === "pendente";
  return (
    <CartaoAprovacao
      aprovacao={aprovacao}
      origem={
        <CabecaSessao
          tom={pendente ? "aviso" : "apagado"}
          projeto={item.projeto}
          ferramenta={item.ferramenta}
          // Depois da resposta, quem diz o que valeu é o desfecho do próprio cartão.
          direita={
            pendente && (
              <span className="sessao-direita" data-tom="aviso">
                esperando você
              </span>
            )
          }
        />
      }
      detalhe={detalhe && <code>{detalhe}</code>}
      aoDecidir={decidirPedido}
    />
  );
}

interface PropsSessao {
  sessao: SessaoIa;
  projeto: Projeto | null;
  agora: Date;
  /** Painel Dev: o contexto à direita e a barra embaixo, em aviso a partir de 80%. */
  comContexto?: boolean;
}

/** Uma sessão aberta: o estado em ponto e texto, o tempo (ou o contexto) e o que fez por último. */
export function CartaoSessao({ sessao, projeto, agora, comContexto = false }: PropsSessao) {
  const estado = estadoDaSessao(sessao, agora);
  const tempo = tempoDaSessao(sessao, agora);
  const contexto = contextoDaSessao(sessao);
  const alto = comContexto && contexto.alto;
  const acao = alto
    ? "Contexto quase cheio. Vale compactar no terminal."
    : ultimaAcao(sessao.ultimoEvento, projeto?.caminho ?? null);
  return (
    <div className="sessao-cartao" data-alto={alto || undefined}>
      <CabecaSessao
        tom={TOM_DA_SESSAO[sessao.estado]}
        projeto={projeto?.nome ?? null}
        ferramenta={sessao.ferramenta}
        direita={
          <>
            <span className="so-leitor">{estado.texto}</span>
            {comContexto ? (
              // A coluna diz "contexto" no alto da seção; o leitor de tela ouve por extenso.
              <span className="sessao-direita sessao-numero" data-tom={alto ? "aviso" : undefined}>
                {contexto.texto}
                <span className="so-leitor"> do contexto</span>
              </span>
            ) : (
              tempo && <span className="sessao-direita sessao-numero">{tempo}</span>
            )}
          </>
        }
      />
      {comContexto && contexto.pct !== null && (
        <Progresso
          valor={contexto.pct}
          rotulo={`Contexto de ${projeto?.nome ?? "uma sessão"}`}
          textoValor={`${contexto.pct}% da janela`}
          tom={alto ? "aviso" : "neutro"}
        />
      )}
      {acao && <p className="sessao-acao">{acao}</p>}
    </div>
  );
}

/** O que se sabe das sessões: lendo, falhou, ou lido com o Claude Code ligado ou não. */
export type SituacaoSessoes = "esperando" | "falhou" | "ligado" | "desligado";

export function situacaoDasSessoes(leitura: Leitura<DadosSessoes>): SituacaoSessoes {
  if (leitura.estado !== "pronta") return leitura.estado;
  return claudeCodeLigado(leitura.dados.conexao) ? "ligado" : "desligado";
}

/** O vazio da seção, pelo que se sabe: lendo diz só isso; sem ligação, convida a ligar. */
const VAZIO_DAS_SESSOES: Readonly<Record<SituacaoSessoes, string>> = {
  esperando: "Lendo as sessões.",
  falhou: "Não consegui ler as sessões agora.",
  ligado: "Nenhuma sessão aberta. As do Claude Code aparecem aqui quando começam.",
  desligado: "Ligue o Claude Code em Conexões para aprovar os pedidos dele por aqui.",
};

/**
 * A seção "Sessões de IA" do painel Agentes (Agentes.dc.html): o pedido de cada sessão do
 * terminal com os três botões e as sessões abertas com o que fazem agora. A resposta vai ao
 * serviço, que a devolve ao Claude Code pelo hook. Sem sessão nem pedido, diz o que se sabe: lendo,
 * não leu, nenhuma aberta, ou convida a ligar o Claude Code.
 */
export function SessoesDoPainel({
  lista,
  pedidos,
  situacao,
  agora,
}: {
  lista: ListaSessoes | null;
  pedidos: PedidosDoTerminal;
  situacao: SituacaoSessoes;
  agora: Date;
}) {
  const idTitulo = useId();
  const { itens, fora } = itensDasSessoes(lista, pedidos);
  const projetos = projetosNaTela(itens);
  return (
    <section className="painel-secao" aria-labelledby={idTitulo}>
      <header className="painel-secao-cabecalho">
        <h2 id={idTitulo} className="painel-secao-titulo">
          Sessões de IA
        </h2>
        {projetos > 0 && <span>{`${projetos} ${projetos === 1 ? "projeto" : "projetos"}`}</span>}
      </header>
      {itens.length === 0 && (
        <div className="painel-secao-vazia" role={situacao === "esperando" ? "status" : undefined}>
          <p>{VAZIO_DAS_SESSOES[situacao]}</p>
          {situacao === "desligado" && (
            <Botao tamanho="pequeno" onClick={() => abrirNoSistema("configuracoes/conexoes")}>
              Abrir Conexões
            </Botao>
          )}
        </div>
      )}
      {itens.map((item) =>
        item.tipo === "pedido" ? (
          <PedidoDaSessao key={item.aprovacao.id} item={item} />
        ) : (
          <CartaoSessao key={item.sessao.id} sessao={item.sessao} projeto={item.projeto} agora={agora} />
        ),
      )}
      {fora > 0 && (
        <Botao variante="fantasma" tamanho="pequeno" onClick={() => abrirNoSistema("sessoes")}>
          {`Mais ${fora} em Sessões de IA`}
        </Botao>
      )}
    </section>
  );
}
