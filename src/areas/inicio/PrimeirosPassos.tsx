import {
  MISSOES_QUE_VALEM,
  MISSOES_TUTORIAL,
  type EstadoPrimeiroUso,
  type MissaoTutorial,
  type PedidoMarcarTutorial,
} from "@moductus/contrato";
import { useId, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import type { Agente, EstadoPersonagem } from "../../componentes/personagem/agentes.ts";
import { Progresso } from "../../componentes/Progresso.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { iniciarTour } from "../../janelas/tour/tour.ts";
import { servico } from "../../servico/conexao.ts";
import type { Destino } from "../areas.ts";
import "./PrimeirosPassos.css";

interface DadosMissao {
  agente: Agente;
  nome: string;
  dica: string;
  /** Botão ao lado da missão e para onde ele leva. */
  acao?: { rotulo: string; destino: Destino };
  /** A área com que a missão chega, enquanto ela não vale (TutorialTour.dc.html). */
  chegaCom?: string;
  /** A dica enquanto ela não vale. */
  dicaDepois?: string;
}

/**
 * As cinco missões (Tutorial.dc.html) e, nesta versão, as que ainda não valem
 * (TutorialTour.dc.html). Quais valem vem do contrato, o mesmo que o serviço usa para encerrar.
 */
const MISSOES: Readonly<Record<MissaoTutorial, DadosMissao>> = {
  "alba-lembrete": {
    agente: "alba",
    nome: "Peça um lembrete à Alba",
    // Feita pelo serviço quando a captura lança um lembrete.
    dica: "“me lembra de beber água às 15h”, pela captura ou pela conversa",
  },
  "tula-extrato": {
    agente: "tula",
    nome: "Mande um extrato para a Tula",
    dica: "Arraste um OFX ou CSV para o painel de Finanças",
    chegaCom: "Finanças",
    dicaDepois: "A Tula começa a ler extratos quando Finanças chegar.",
  },
  "faina-aprovacao": {
    agente: "faina",
    nome: "Responda o cartão de aprovação da Faina",
    dica: "Um treino: ela pede para mover 3 arquivos de exemplo",
  },
  "faina-downloads": {
    agente: "faina",
    nome: "Peça à Faina para olhar seus Downloads",
    dica: "Ela monta uma prévia e não mexe em nada até você aprovar",
    chegaCom: "Arquivos",
    dicaDepois: "Ela precisa das pastas autorizadas, que chegam com Arquivos.",
  },
  "nuno-sessao": {
    agente: "nuno",
    nome: "Abra uma sessão do Claude Code",
    // Feita pelo serviço quando chega o primeiro evento de uma sessão (hooks ligados em Conexões).
    dica: "O Nuno mostra o contexto, o gasto e os pedidos dela",
    acao: { rotulo: "Como funciona", destino: { area: "sessoes" } },
  },
};

const VALEM: readonly MissaoTutorial[] = MISSOES_QUE_VALEM;
const DEPOIS = MISSOES_TUTORIAL.filter((m) => !VALEM.includes(m));

const ARQUIVOS_TREINO = ["exemplo-1.tmp", "exemplo-2.tmp", "exemplo-3.tmp"];

function marcar(pedido: PedidoMarcarTutorial): Promise<EstadoPrimeiroUso> {
  return servico.pedir("primeiroUso.marcar", pedido);
}

interface PropsPrimeirosPassos {
  estado: EstadoPrimeiroUso;
  /** Estado novo gravado pelo serviço (o evento também chega, mas a resposta vem antes). */
  aoMudar: (estado: EstadoPrimeiroUso) => void;
}

/**
 * "Primeiros passos" no alto do Início: uma missão por agente e o cartão de aprovação de treino
 * (Tutorial.dc.html, TutorialTour.dc.html). Contam só as missões que valem nesta versão; as outras
 * ficam embaixo, apagadas. Some quando as que valem ficam feitas (a regra é do serviço) ou com
 * "Pular"; o tour e a lista voltam pela Ajuda da bandeja e em Configurações, Geral.
 */
export function PrimeirosPassos({ estado, aoMudar }: PropsPrimeirosPassos) {
  const idTitulo = useId();
  const idDepois = useId();
  const { ir } = useAcoesSistema();
  const [erro, setErro] = useState<string | null>(null);
  const feitas = VALEM.filter((m) => estado.missoes[m] === "feito").length;
  const total = VALEM.length;
  // A missão da vez fica em negrito: a primeira que falta.
  const daVez = VALEM.find((m) => estado.missoes[m] !== "feito");

  const pedir = (pedido: PedidoMarcarTutorial) => {
    setErro(null);
    marcar(pedido)
      .then(aoMudar)
      .catch(() => setErro("O serviço não respondeu; tente de novo em instantes."));
  };

  return (
    <section className="primeiros-passos" aria-labelledby={idTitulo}>
      <div className="primeiros-passos-topo">
        <div className="primeiros-passos-titulos">
          <h2 id={idTitulo} className="primeiros-passos-titulo">
            Primeiros passos
          </h2>
          <span className="primeiros-passos-rotulo">
            Uma missão por agente. Some quando você terminar e volta pelo menu Ajuda.
          </span>
        </div>
        <span className="primeiros-passos-contagem" aria-hidden="true">
          {feitas} de {total}
        </span>
        <div className="primeiros-passos-barra">
          <Progresso
            valor={feitas}
            maximo={total}
            rotulo="Missões feitas"
            textoValor={`${feitas} de ${total}`}
          />
        </div>
        <Botao variante="fantasma" onClick={() => void iniciarTour()}>
          Ver o tour de novo
        </Botao>
        <Botao variante="fantasma" onClick={() => pedir({ alvo: "tutorial", estado: "pulado" })}>
          Pular
        </Botao>
      </div>
      {erro && (
        <p className="primeiros-passos-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="primeiros-passos-grade">
        <div className="primeiros-passos-listas">
          <ol className="primeiros-passos-missoes">
            {VALEM.map((id) => {
              const m = MISSOES[id];
              const feita = estado.missoes[id] === "feito";
              const atual = id === daVez;
              const expressao: EstadoPersonagem = atual ? "esperando" : "ocioso";
              return (
                <li
                  key={id}
                  className="missao"
                  data-missao={id}
                  data-feita={feita}
                  data-atual={atual || undefined}
                >
                  <span className="missao-caixa" aria-hidden="true">
                    {feita ? "✓" : ""}
                  </span>
                  <Personagem agente={m.agente} modo="cabeca" tamanho="missao" estado={expressao} />
                  <span className="missao-textos">
                    <span className="missao-nome">
                      {m.nome}
                      {feita && <span className="so-leitor"> (feita)</span>}
                    </span>
                    <span className="primeiros-passos-rotulo">{m.dica}</span>
                  </span>
                  {m.acao && !feita && (
                    <Botao tamanho="pequeno" onClick={() => ir(m.acao!.destino)}>
                      {m.acao.rotulo}
                    </Botao>
                  )}
                </li>
              );
            })}
          </ol>
          <h3 id={idDepois} className="primeiros-passos-depois">
            Chegam depois · não contam agora
          </h3>
          <ul className="primeiros-passos-missoes" aria-labelledby={idDepois}>
            {DEPOIS.map((id) => {
              const m = MISSOES[id];
              return (
                <li key={id} className="missao" data-missao={id} data-depois="">
                  <span className="missao-caixa" aria-hidden="true" />
                  <span className="missao-cabeca-depois">
                    <Personagem agente={m.agente} modo="cabeca" tamanho="missao" estado="ocioso" />
                  </span>
                  <span className="missao-textos">
                    <span className="missao-nome">{m.nome}</span>
                    <span className="primeiros-passos-rotulo">{m.dicaDepois ?? m.dica}</span>
                  </span>
                  {m.chegaCom && <Selo tom="apagado">chega com {m.chegaCom}</Selo>}
                </li>
              );
            })}
          </ul>
        </div>
        <CartaoTreino
          feito={estado.missoes["faina-aprovacao"] === "feito"}
          aoResponder={() => pedir({ alvo: "missao", missao: "faina-aprovacao", estado: "feito" })}
          aoRefazer={() => pedir({ alvo: "missao", missao: "faina-aprovacao", estado: "pendente" })}
        />
      </div>
    </section>
  );
}

interface PropsCartaoTreino {
  feito: boolean;
  aoResponder: () => void;
  aoRefazer: () => void;
}

/** O cartão de aprovação de verdade, com arquivos de exemplo: responder não mexe em nada. */
function CartaoTreino({ feito, aoResponder, aoRefazer }: PropsCartaoTreino) {
  const idNome = useId();
  const [resposta, setResposta] = useState<"mover" | "nao-mover" | null>(null);
  const responder = (r: "mover" | "nao-mover") => {
    setResposta(r);
    aoResponder();
  };
  return (
    <div className="treino" role="group" aria-labelledby={idNome}>
      <div className="treino-topo">
        <Personagem agente="faina" modo="cabeca" tamanho="lista" estado="esperando" />
        <span id={idNome} className="treino-nome">
          Faina
        </span>
        <Selo tom="aviso">treino</Selo>
        <span className="primeiros-passos-rotulo treino-nota">nada de verdade muda</span>
      </div>
      {feito ? (
        <>
          <p className="treino-texto" role="status">
            {resposta === "nao-mover"
              ? "Você recusou: a Faina não mexe em nada e segue com o resto."
              : resposta === "mover"
                ? "Você aprovou: num pedido de verdade, os 3 arquivos iriam para a Lixeira, com desfazer."
                : "Respondido. Era treino: nenhum arquivo mudou."}
          </p>
          <div className="treino-acoes">
            <Botao
              onClick={() => {
                setResposta(null);
                aoRefazer();
              }}
            >
              Treinar de novo
            </Botao>
          </div>
        </>
      ) : (
        <>
          <p className="treino-texto">
            Vou mover 3 arquivos de exemplo (12 KB) para a Lixeira. Dá para desfazer.
          </p>
          <ul className="treino-arquivos" aria-label="Arquivos do pedido">
            {ARQUIVOS_TREINO.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="primeiros-passos-rotulo">
            É assim que um agente pede para agir fora do Moductus. O botão sempre diz o que vai acontecer.
          </p>
          <div className="treino-acoes">
            <Botao onClick={() => responder("nao-mover")}>Não mover</Botao>
            <Botao variante="primario" onClick={() => responder("mover")}>
              Mover 3 arquivos
            </Botao>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Entrada em Configurações, Geral, além da Ajuda da bandeja: o tour de novo, ou os Primeiros passos
 * de volta ao Início, indo até lá.
 */
export function ReverTutorial() {
  const { ir, aoMudarPrimeiroUso } = useAcoesSistema();
  const [erro, setErro] = useState<string | null>(null);
  const rever = () => {
    setErro(null);
    marcar({ alvo: "tutorial", estado: "pendente" })
      .then((estado) => {
        aoMudarPrimeiroUso(estado);
        ir({ area: "inicio" });
      })
      .catch(() => setErro("O serviço não respondeu; tente de novo em instantes."));
  };
  return (
    <div className="rever-tutorial">
      <span className="missao-textos">
        <span className="missao-nome">Primeiros passos</span>
        <span className="primeiros-passos-rotulo">
          O tour pelo dock, um painel, o Sistema e a captura; e, no alto do Início, uma missão por agente com
          um cartão de aprovação de treino.
        </span>
      </span>
      <Botao onClick={() => void iniciarTour()}>Ver o tour</Botao>
      <Botao onClick={rever}>Rever o tutorial</Botao>
      {erro && (
        <p className="primeiros-passos-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
