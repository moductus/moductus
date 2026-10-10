import type { Capacidade, Execucao } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { horaCurta } from "../../componentes/personagem/quando.ts";
import { lerSituacao, modeloDoAgente } from "../../componentes/personagem/situacao.ts";
import { Selo, type TomSelo } from "../../componentes/Selo.tsx";
import {
  agoraDoAgente,
  tomDoModelo,
  custoDaExecucao,
  deHoje,
  desfaziveis,
  descreverProvedor,
  LINHAS_HOJE,
  resumoDoDia,
  textoDaExecucao,
  useAgente,
  vigiasDoAgente,
  type DadosAgente,
} from "../../servico/agente.ts";
import { EstadoVazio } from "../Pagina.tsx";
import { useAgora } from "../tempo.ts";
import { comArtigo, deAgente } from "./nomes.ts";

const ABAS = [
  { id: "geral", nome: "Visão geral" },
  { id: "historico", nome: "Histórico" },
  { id: "instrucoes", nome: "Instruções" },
  { id: "ferramentas", nome: "Ferramentas" },
  { id: "memoria", nome: "Memória" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

interface PropsPaginaAgente {
  canal: EstadoConexao;
  agente: Agente;
  aoConversar: () => void;
  aoTrocarModelo: () => void;
}

/**
 * A página de um agente (AreaAgente.dc.html): quem é e o que está fazendo agora, pausar ou
 * retomar, e em abas a visão geral (vigias, modelo, permissões, o dia), o histórico com desfazer,
 * as instruções, as ferramentas e a memória.
 */
export function PaginaAgente({ canal, agente, aoConversar, aoTrocarModelo }: PropsPaginaAgente) {
  const dados = useAgente(canal, agente);
  // A frase de quem dorme diz uma hora: o relógio da tela a tira de lá quando ela chega.
  const agora = useAgora();
  const [aba, setAba] = useState<Aba>("geral");
  const idAbas = useId();
  const { agente: doServico, conectado } = dados;
  const situacao = doServico?.situacao ?? null;
  const leitura = lerSituacao(situacao);
  const rodando = dados.execucoes.find((e) => e.estado === "rodando") ?? null;
  const nome = doServico?.nome ?? DADOS_AGENTES[agente].nome;

  return (
    <div className="pagina-agente">
      <header className="pagina-agente-cabecalho">
        <Personagem agente={agente} modo="inteiro" tamanho="paginaAgente" estado={leitura.expressao} />
        <div className="pagina-agente-quem">
          <span className="pagina-agente-rotulo">
            {`Agentes · ${doServico && !doServico.deFabrica ? "criado por você" : "de fábrica"}`}
          </span>
          <div className="pagina-agente-nome">
            <h1 className="pagina-agente-titulo">{nome}</h1>
            {situacao && <Selo tom={leitura.tom}>{leitura.texto}</Selo>}
          </div>
          <span className="pagina-agente-funcao">{doServico?.funcao ?? DADOS_AGENTES[agente].funcao}</span>
          <span className="pagina-agente-rotulo">
            {situacao
              ? agoraDoAgente(situacao, rodando, agora, dados.provedor)
              : "Sem notícia do serviço agora."}
          </span>
        </div>
        <div className="pagina-agente-acoes">
          <BotaoPausa agente={agente} dados={dados} />
          <Botao variante="primario" onClick={aoConversar}>
            Conversar
          </Botao>
        </div>
      </header>
      {dados.erro && (
        <p className="pagina-agente-erro" role="alert">
          {dados.erro}
        </p>
      )}

      <Abas id={idAbas} ativa={aba} aoEscolher={setAba} />
      <div
        className="pagina-agente-aba"
        role="tabpanel"
        id={`${idAbas}-${aba}`}
        aria-labelledby={`${idAbas}-${aba}-aba`}
      >
        {aba === "geral" && (
          <VisaoGeral
            agente={agente}
            dados={dados}
            aoVerHistorico={() => setAba("historico")}
            aoTrocarModelo={aoTrocarModelo}
          />
        )}
        {aba === "historico" && <Historico dados={dados} />}
        {aba === "instrucoes" && (
          <Cartao como="section" aria-label="Instruções">
            <p className="pagina-agente-instrucoes">
              {doServico ? doServico.instrucoes || "Sem instruções." : "Lendo no serviço…"}
            </p>
          </Cartao>
        )}
        {aba === "ferramentas" && <Ferramentas capacidades={dados.capacidades} conectado={conectado} />}
        {aba === "memoria" && (
          <EstadoVazio
            agentes={[agente]}
            nivel={3}
            titulo={`A memória ${deAgente(agente)}`}
            texto="Os fatos e as decisões que o time guardar aparecem aqui, para você ver e editar."
            quando="Fase 5"
          />
        )}
      </div>
    </div>
  );
}

/** Pausar, retomar ou ligar: o que vale para o estado dele agora. */
function BotaoPausa({ agente, dados }: { agente: Agente; dados: ReturnType<typeof useAgente> }) {
  const estado = dados.agente?.situacao.estado;
  const travado = !dados.conectado || !dados.agente;
  if (estado === "desligado") {
    return (
      <Botao disabled={travado} onClick={() => void dados.ligar()}>
        {`Ligar ${comArtigo(agente)}`}
      </Botao>
    );
  }
  if (estado === "pausado") {
    return (
      <Botao disabled={travado} onClick={() => void dados.retomar()}>
        {`Retomar ${comArtigo(agente)}`}
      </Botao>
    );
  }
  return (
    <Botao disabled={travado} onClick={() => void dados.pausar()}>
      {`Pausar ${comArtigo(agente)}`}
    </Botao>
  );
}

const PROXIMA = new Set(["ArrowRight", "ArrowDown"]);
const ANTERIOR = new Set(["ArrowLeft", "ArrowUp"]);

/** Abas: um Tab entra na ativa, as setas andam e já abrem, Home e End vão às pontas. */
function Abas({ id, ativa, aoEscolher }: { id: string; ativa: Aba; aoEscolher: (aba: Aba) => void }) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const ir = (indice: number) => {
    const aba = ABAS[indice];
    if (!aba) return;
    botoes.current[indice]?.focus();
    aoEscolher(aba.id);
  };
  const aoTeclar = (e: KeyboardEvent, indice: number) => {
    const n = ABAS.length;
    let alvo: number | undefined;
    if (PROXIMA.has(e.key)) alvo = (indice + 1) % n;
    else if (ANTERIOR.has(e.key)) alvo = (indice - 1 + n) % n;
    else if (e.key === "Home") alvo = 0;
    else if (e.key === "End") alvo = n - 1;
    if (alvo === undefined) return;
    e.preventDefault();
    ir(alvo);
  };
  return (
    <div className="pagina-agente-abas" role="tablist" aria-label="Seções do agente">
      {ABAS.map((aba, i) => (
        <button
          key={aba.id}
          ref={(el) => {
            botoes.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${id}-${aba.id}-aba`}
          className="pagina-agente-abas-item"
          aria-selected={aba.id === ativa}
          aria-controls={aba.id === ativa ? `${id}-${aba.id}` : undefined}
          tabIndex={aba.id === ativa ? 0 : -1}
          onClick={() => ir(i)}
          onKeyDown={(e) => aoTeclar(e, i)}
        >
          {aba.nome}
        </button>
      ))}
    </div>
  );
}

/** Cartão da visão geral: rótulo à esquerda e, quando há, uma ação à direita. */
function CartaoGeral({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <Cartao como="section" className="pagina-agente-cartao" aria-labelledby={id}>
      <div className="pagina-agente-cartao-cabecalho">
        <h2 id={id} className="pagina-agente-cartao-titulo">
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </Cartao>
  );
}

const TOM_LIGACAO: Record<"ligada" | "desligada" | "erro", TomSelo> = {
  ligada: "sucesso",
  desligada: "apagado",
  erro: "perigo",
};

interface PropsVisaoGeral {
  agente: Agente;
  dados: ReturnType<typeof useAgente>;
  aoVerHistorico: () => void;
  aoTrocarModelo: () => void;
}

function VisaoGeral({ agente, dados, aoVerHistorico, aoTrocarModelo }: PropsVisaoGeral) {
  const { agente: doServico, execucoes, capacidades } = dados;
  const vigias = vigiasDoAgente(agente, doServico?.gatilhos ?? [], dados.conexoes);
  const hoje = deHoje(execucoes);
  const semPerguntar = capacidades.filter((c) => c.efeito !== "externo");
  const perguntaAntes = capacidades.filter((c) => c.efeito === "externo");

  return (
    <div className="pagina-agente-geral">
      <CartaoGeral titulo="Vigias · trabalham sem gastar modelo">
        {vigias.length === 0 ? (
          <p className="pagina-agente-vazio">
            {`Nenhum vigia ligado ainda. Por enquanto, ${comArtigo(agente)} trabalha quando você pede na conversa.`}
          </p>
        ) : (
          <ul className="pagina-agente-linhas">
            {vigias.map((v) => (
              <li key={`${v.nome}-${v.quando}`} className="pagina-agente-vigia">
                <span className="pagina-agente-vigia-textos">
                  <span>{v.nome}</span>
                  <span className="pagina-agente-rotulo">{v.quando}</span>
                </span>
                {v.estado && <Selo tom={TOM_LIGACAO[v.estado]}>{v.estado}</Selo>}
              </li>
            ))}
          </ul>
        )}
      </CartaoGeral>

      <div className="pagina-agente-coluna">
        <CartaoGeral titulo="Modelo">
          <div className="pagina-agente-modelo">
            <Selo forma="ponto" tom={doServico?.provedorId ? tomDoModelo(doServico.situacao) : "apagado"}>
              {textoDoModelo(dados)}
            </Selo>
            <Botao variante="fantasma" tamanho="pequeno" onClick={aoTrocarModelo}>
              {doServico?.provedorId ? "Trocar" : "Escolher"}
            </Botao>
          </div>
          <span className="pagina-agente-rotulo">{resumoDoDia(hoje)}</span>
        </CartaoGeral>
        <CartaoGeral titulo="Permissões">
          <Permissao titulo="Faz sem perguntar" tom="sucesso" capacidades={semPerguntar} />
          <Permissao titulo="Pergunta antes" tom="aviso" capacidades={perguntaAntes} />
        </CartaoGeral>
      </div>

      <CartaoGeral
        titulo="Hoje"
        acao={
          <Botao variante="fantasma" tamanho="pequeno" onClick={aoVerHistorico}>
            histórico completo
          </Botao>
        }
      >
        {hoje.length === 0 ? (
          <p className="pagina-agente-vazio">Nada ainda hoje.</p>
        ) : (
          <LinhasExecucao execucoes={hoje.slice(0, LINHAS_HOJE)} dados={dados} />
        )}
      </CartaoGeral>
    </div>
  );
}

/**
 * "Claude Code · sua assinatura"; sem a lista de provedores, a forma de pagar da última execução;
 * sem modelo, o convite.
 */
function textoDoModelo({ agente, provedor, execucoes }: DadosAgente): string {
  if (!agente?.provedorId) return "Nenhum modelo escolhido";
  if (provedor) return descreverProvedor(provedor);
  const cobranca = execucoes.find((e) => e.cobranca !== null)?.cobranca;
  if (cobranca === "assinatura") return "Modelo escolhido · sua assinatura";
  if (cobranca === "por_token") return "Modelo escolhido · por token";
  return "Modelo escolhido";
}

function Permissao({
  titulo,
  tom,
  capacidades,
}: {
  titulo: string;
  tom: TomSelo;
  capacidades: readonly Capacidade[];
}) {
  return (
    <div className="pagina-agente-permissao" data-tom={tom}>
      <span className="pagina-agente-permissao-titulo">{titulo}</span>
      <span className="pagina-agente-permissao-itens">
        {capacidades.length === 0 ? "nada" : capacidades.map((c) => c.nome).join(", ")}
      </span>
    </div>
  );
}

/** Linhas do dia ou do histórico: hora, o que fez e, quando ainda dá, desfazer. */
function LinhasExecucao({
  execucoes,
  dados,
  comCusto = false,
}: {
  execucoes: readonly Execucao[];
  dados: ReturnType<typeof useAgente>;
  comCusto?: boolean;
}) {
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const desfazer = async (id: string) => {
    setErro(null);
    setDesfazendo(id);
    setErro(await dados.desfazer(id));
    setDesfazendo(null);
  };
  return (
    <>
      <ul className="pagina-agente-linhas">
        {execucoes.map((e) => {
          const custo = comCusto ? custoDaExecucao(e) : null;
          const podeDesfazer = desfaziveis(dados.detalhes[e.id]).length > 0;
          const texto = textoDaExecucao(e, modeloDoAgente(e.provedorId, dados.provedores));
          return (
            <li key={e.id} className="pagina-agente-execucao" data-estado={e.estado}>
              <span className="pagina-agente-hora">{e.inicio ? horaCurta(e.inicio) : ""}</span>
              <span className="pagina-agente-execucao-texto">{texto}</span>
              {custo && <span className="pagina-agente-custo">{custo}</span>}
              {podeDesfazer && (
                <Botao
                  variante="fantasma"
                  tamanho="pequeno"
                  disabled={!dados.conectado || desfazendo !== null}
                  aria-label={`Desfazer: ${texto}`}
                  onClick={() => void desfazer(e.id)}
                >
                  Desfazer
                </Botao>
              )}
            </li>
          );
        })}
      </ul>
      {erro && (
        <p className="pagina-agente-erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}

function Historico({ dados }: { dados: ReturnType<typeof useAgente> }) {
  if (dados.execucoes.length === 0) {
    return (
      <p className="pagina-agente-vazio">
        {dados.conectado
          ? "Nenhuma execução ainda."
          : "Sem conexão com o serviço: o histórico aparece quando ele responder."}
      </p>
    );
  }
  return (
    <Cartao como="section" aria-label="Histórico">
      <LinhasExecucao execucoes={dados.execucoes} dados={dados} comCusto />
      {dados.temAnteriores && (
        <Botao variante="fantasma" className="pagina-agente-mais" onClick={() => void dados.anteriores()}>
          Mais antigas
        </Botao>
      )}
    </Cartao>
  );
}

function Ferramentas({ capacidades, conectado }: { capacidades: readonly Capacidade[]; conectado: boolean }) {
  if (capacidades.length === 0) {
    return (
      <p className="pagina-agente-vazio">
        {conectado
          ? "Nenhuma ferramenta ainda."
          : "Sem conexão com o serviço: as ferramentas aparecem quando ele responder."}
      </p>
    );
  }
  return (
    <Cartao como="section" aria-label="Ferramentas">
      <ul className="pagina-agente-linhas">
        {capacidades.map((c) => (
          <li key={c.nome} className="pagina-agente-ferramenta">
            <span className="pagina-agente-ferramenta-nome">{c.nome}</span>
            <Selo tom={c.efeito === "externo" ? "aviso" : c.efeito === "interno" ? "sucesso" : "neutro"}>
              {ROTULO_EFEITO[c.efeito]}
            </Selo>
            <span className="pagina-agente-ferramenta-descricao">{c.descricao}</span>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

const ROTULO_EFEITO: Record<Capacidade["efeito"], string> = {
  leitura: "só lê",
  interno: "muda no Moductus, com desfazer",
  externo: "sai do Moductus, pergunta antes",
};
