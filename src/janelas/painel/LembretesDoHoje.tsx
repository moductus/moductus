import {
  ADIAR_ATRASADOS_MIN,
  ADIAR_LEMBRETE_MIN,
  MENSAGEM_LEMBRETE_NAO_TOCA,
  type Lembrete,
  type LembretesDeHoje,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { useId, useState } from "react";
import { haQuanto } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { servico } from "../../servico/conexao.ts";
import { emQuanto, horaNoFuso } from "./dia.ts";
import {
  acoesDosAtrasados,
  contextoDoTocando,
  falaDosAtrasados,
  horaDoLembrete,
  linhaDoChegando,
  metaDaAusencia,
  tarefaDoLembrete,
} from "./lembretes.ts";

/**
 * Uma ação do lembrete pelo serviço: o botão trava até a resposta, e a falha diz o que não deu, sem
 * o texto cru do serviço. O cartão sai pelo aviso `lembretes.hoje` que a ação provoca.
 */
function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const agir = (pedido: () => Promise<unknown>, falha: string) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    pedido()
      // A ocorrência que já não toca (o aviso do Windows decidiu antes) diz isso; o resto, só a falha.
      .catch((e: unknown) =>
        setErro(
          e instanceof RecusaDoServico && e.message === MENSAGEM_LEMBRETE_NAO_TOCA
            ? "Este lembrete já não está tocando."
            : falha,
        ),
      )
      .finally(() => setOcupado(false));
  };
  return { ocupado, erro, agir };
}

/**
 * "Adiar 10 min" e "Feito", os mesmos pedidos do aviso do Windows (lembretes.ts no serviço). O
 * lembrete tocando leva a ocorrência (`quando`): se ela já não toca, o serviço recusa, como recusa o
 * botão de um aviso velho. Os atrasados vão em grupo, sem ocorrência.
 */
export const adiarLembrete = (ids: string[], minutos: number, quando?: string) =>
  servico.pedir("lembretes.adiar", quando === undefined ? { ids, minutos } : { ids, minutos, quando });
export const concluirLembrete = (ids: string[], quando?: string) =>
  servico.pedir("lembretes.concluir", quando === undefined ? { ids } : { ids, quando });

interface PropsTocando {
  lembrete: Lembrete;
  tarefa: Tarefa | null;
  hoje: string;
  fuso: string;
  agora: Date;
}

/** Tocando: no topo, elevado, com sino, hora e origem, e [Adiar 10 min] [Feito]. */
function Tocando({ lembrete, tarefa, hoje, fuso, agora }: PropsTocando) {
  const idTitulo = useId();
  const { ocupado, erro, agir } = useAcao();
  const contexto = contextoDoTocando(lembrete, tarefa, hoje);
  return (
    <section className="lembrete lembrete--tocando" aria-labelledby={idTitulo}>
      <div className="lembrete-topo">
        <span className="lembrete-sino">
          <Icone nome="sino" tamanho={14} />
        </span>
        <span>{`Lembrete · ${horaNoFuso(lembrete.quando, fuso)}`}</span>
        <span className="lembrete-meta">{haQuanto(lembrete.disparadoEm ?? lembrete.quando, agora)}</span>
      </div>
      <div className="lembrete-corpo">
        <h2 id={idTitulo} className="lembrete-titulo">
          {lembrete.texto}
        </h2>
        {contexto && <span className="lembrete-rotulo">{contexto}</span>}
      </div>
      {erro && (
        <p className="dia-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="lembrete-acoes">
        <Botao
          disabled={ocupado}
          onClick={() =>
            agir(
              () => adiarLembrete([lembrete.id], ADIAR_LEMBRETE_MIN, lembrete.quando),
              "Não consegui adiar agora. Tente de novo.",
            )
          }
        >
          {`Adiar ${ADIAR_LEMBRETE_MIN} min`}
        </Botao>
        <Botao
          variante="primario"
          disabled={ocupado}
          onClick={() =>
            agir(
              () => concluirLembrete([lembrete.id], lembrete.quando),
              "Não consegui concluir agora. Tente de novo.",
            )
          }
        >
          Feito
        </Botao>
      </div>
    </section>
  );
}

/** Chegando: o próximo, a partir de 30 min antes, sem som, numa linha só. */
function Chegando({ lembrete, tarefa, fuso, agora }: Omit<PropsTocando, "hoje">) {
  const idTitulo = useId();
  return (
    <section className="lembrete lembrete--chegando" aria-labelledby={idTitulo}>
      <span className="lembrete-sino">
        <Icone nome="sino" tamanho={16} />
      </span>
      <div className="lembrete-corpo">
        <h2 id={idTitulo} className="lembrete-titulo-linha">
          {lembrete.texto}
        </h2>
        <span className="lembrete-rotulo">{linhaDoChegando(lembrete, tarefa, fuso)}</span>
      </div>
      <span className="lembrete-numero">{emQuanto(horaDoLembrete(lembrete), agora)}</span>
    </section>
  );
}

/**
 * Os atrasados juntos num cartão só, depois da suspensão: a fala da Alba, Feito por item e as
 * ações em grupo; nunca toca um por um.
 */
function Atrasados({ hoje, fuso }: { hoje: LembretesDeHoje; fuso: string }) {
  const idTitulo = useId();
  const { ocupado, erro, agir } = useAcao();
  const { atrasados, ausencia } = hoje;
  const ids = atrasados.map((l) => l.id);
  const acoes = acoesDosAtrasados(atrasados.length, ADIAR_ATRASADOS_MIN);
  return (
    <section className="lembrete lembrete--atrasados" aria-labelledby={idTitulo}>
      <div className="lembrete-atrasados-topo">
        <h2 id={idTitulo} className="lembrete-atrasados-titulo">
          <span className="lembrete-ponto" aria-hidden="true" />
          {`Atrasados · ${atrasados.length}`}
        </h2>
        {ausencia && <span className="lembrete-meta">{metaDaAusencia(ausencia, fuso)}</span>}
      </div>
      <FalaAgente agente="alba" estado="esperando" tamanho="lista">
        {falaDosAtrasados(atrasados.length, ausencia)}
      </FalaAgente>
      <ul className="lembrete-perdidos">
        {atrasados.map((l) => (
          <li key={l.id} className="lembrete-perdido">
            <span className="lembrete-perdido-hora">{horaNoFuso(l.quando, fuso)}</span>
            <span className="lembrete-perdido-texto" title={l.texto}>
              {l.texto}
            </span>
            <Botao
              tamanho="pequeno"
              aria-label={`Feito: ${l.texto}`}
              disabled={ocupado}
              onClick={() =>
                agir(() => concluirLembrete([l.id]), "Não consegui concluir agora. Tente de novo.")
              }
            >
              Feito
            </Botao>
          </li>
        ))}
      </ul>
      {erro && (
        <p className="dia-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="lembrete-acoes">
        <Botao
          disabled={ocupado}
          onClick={() =>
            agir(() => adiarLembrete(ids, ADIAR_ATRASADOS_MIN), "Não consegui adiar agora. Tente de novo.")
          }
        >
          {acoes.adiar}
        </Botao>
        <Botao
          variante="primario"
          disabled={ocupado}
          onClick={() => agir(() => concluirLembrete(ids), "Não consegui concluir agora. Tente de novo.")}
        >
          {acoes.concluir}
        </Botao>
      </div>
    </section>
  );
}

interface PropsLembretes {
  lembretes: LembretesDeHoje;
  /** As tarefas que o painel já leu, para dizer a hora da tarefa ligada ao lembrete. */
  tarefas: readonly Tarefa[];
  hoje: string;
  fuso: string;
  agora: Date;
}

/**
 * O lembrete no alto do Hoje (LembreteHoje.dc.html; DESIGN.md §5 "Lembrete"): os atrasados, os que
 * tocam e o que está chegando, nessa ordem. Nada a lembrar, nada aparece.
 */
export function LembretesDoHoje({ lembretes, tarefas, hoje, fuso, agora }: PropsLembretes) {
  return (
    <>
      {lembretes.atrasados.length > 0 && <Atrasados hoje={lembretes} fuso={fuso} />}
      {lembretes.tocando.map((l) => (
        <Tocando
          key={l.id}
          lembrete={l}
          tarefa={tarefaDoLembrete(l, tarefas)}
          hoje={hoje}
          fuso={fuso}
          agora={agora}
        />
      ))}
      {lembretes.chegando && (
        <Chegando
          lembrete={lembretes.chegando}
          tarefa={tarefaDoLembrete(lembretes.chegando, tarefas)}
          fuso={fuso}
          agora={agora}
        />
      )}
    </>
  );
}
