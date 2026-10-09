import {
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
import { servico } from "../../servico/conexao.ts";
import "./PrimeirosPassos.css";

/** As cinco missões (Tutorial.dc.html). Sem `fase`, a missão já pode ser feita nesta versão. */
const MISSOES: Readonly<
  Record<
    MissaoTutorial,
    { agente: Agente; estado: EstadoPersonagem; nome: string; dica: string; fase?: string }
  >
> = {
  "alba-lembrete": {
    agente: "alba",
    estado: "ocioso",
    nome: "Peça um lembrete à Alba",
    dica: "“me lembra de beber água às 15h”, pela captura ou pela conversa",
    fase: "fase 3",
  },
  "tula-extrato": {
    agente: "tula",
    estado: "ocioso",
    nome: "Mande um extrato para a Tula",
    dica: "Arraste um OFX ou CSV para o painel de Finanças",
    fase: "fase 4",
  },
  "faina-aprovacao": {
    agente: "faina",
    estado: "esperando",
    nome: "Responda o cartão de aprovação da Faina",
    dica: "Um treino: ela pede para mover 3 arquivos de exemplo",
  },
  "faina-downloads": {
    agente: "faina",
    estado: "ocioso",
    nome: "Peça à Faina para olhar seus Downloads",
    dica: "Ela monta uma prévia e não mexe em nada até você aprovar",
    fase: "fase 5",
  },
  "nuno-sessao": {
    agente: "nuno",
    estado: "ocioso",
    nome: "Abra uma sessão do Claude Code",
    dica: "O Nuno mostra o contexto, o gasto e os pedidos dela",
    fase: "fase 2",
  },
};

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
 * "Primeiros passos" no alto do Início: uma missão por agente e o cartão de aprovação de
 * treino. Some quando as cinco ficam feitas ou com "Pular"; volta em Configurações, Geral.
 */
export function PrimeirosPassos({ estado, aoMudar }: PropsPrimeirosPassos) {
  const idTitulo = useId();
  const [erro, setErro] = useState<string | null>(null);
  const feitas = MISSOES_TUTORIAL.filter((m) => estado.missoes[m] === "feito").length;
  const total = MISSOES_TUTORIAL.length;

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
            Uma missão por agente. Some quando você terminar e volta em Configurações, Geral.
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
        <ol className="primeiros-passos-missoes">
          {MISSOES_TUTORIAL.map((id) => {
            const m = MISSOES[id];
            const feita = estado.missoes[id] === "feito";
            return (
              <li key={id} className="missao" data-missao={id} data-feita={feita}>
                <span className="missao-caixa" aria-hidden="true">
                  {feita ? "✓" : ""}
                </span>
                <Personagem agente={m.agente} modo="cabeca" tamanho="missao" estado={m.estado} />
                <span className="missao-textos">
                  <span className="missao-nome">
                    {m.nome}
                    {feita && <span className="so-leitor"> (feita)</span>}
                  </span>
                  <span className="primeiros-passos-rotulo">{m.dica}</span>
                </span>
                {m.fase && !feita && <Selo>{m.fase}</Selo>}
              </li>
            );
          })}
        </ol>
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

/** Entrada em Configurações, Geral: traz os Primeiros passos de volta ao Início e vai até lá. */
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
          Uma missão por agente e um cartão de aprovação de treino, no alto do Início.
        </span>
      </span>
      <Botao onClick={rever}>Rever o tutorial</Botao>
      {erro && (
        <p className="primeiros-passos-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
